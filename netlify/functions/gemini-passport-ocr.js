const { GoogleGenAI } = require('@google/genai');

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { ok: false, error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return json(500, { ok: false, error: 'Missing GEMINI_API_KEY' });
    }

    const body = JSON.parse(event.body || '{}');
    const { imageBase64, mimeType } = body;

    if (!imageBase64) {
      return json(400, { ok: false, error: 'imageBase64 is required' });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
You are extracting data from a Myanmar passport image for a private travel agency form.

Return ONLY valid JSON. No markdown. No explanation.

Extract only clearly visible data. Do not guess. If uncertain, return empty string.

JSON format:
{
  "fullName": "",
  "passportNo": "",
  "dateOfBirth": "",
  "expiryDate": "",
  "nationality": "",
  "sex": "",
  "mrzLine1": "",
  "mrzLine2": "",
  "confidenceNotes": []
}

Rules:
- fullName must be uppercase English letters and spaces only.
- Do not include MR, MS, MSTR, MISS in fullName.
- passportNo must be Myanmar passport format: two uppercase letters followed by six digits, e.g. MF971828.
- dateOfBirth format: MM/DD/YYYY.
- expiryDate format: MM/DD/YYYY.
- nationality should be MMR for Myanmar passports.
- sex must be M or F.
- Prefer MRZ if readable.
- For MRZ names, convert < into spaces and remove trailing filler.
- Never output noisy text such as repeated C, L, K filler characters.
- If a field is not clearly readable, return empty string.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    });

    const text = response.text || '';
    const extracted = safeJsonParse(text);

    const validated = validatePassportResult(extracted);

    return json(200, {
      ok: true,
      rawGemini: extracted,
      ...validated,
    });
  } catch (error) {
    console.error('[gemini-passport-ocr error]', error);

    return json(500, {
      ok: false,
      error: error.message || 'Gemini OCR failed',
    });
  }
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function validatePassportResult(input = {}) {
  const warnings = [];

  const fullName = cleanFullName(input.fullName || '');
  const passportNo = cleanPassportNo(input.passportNo || '');
  const dateOfBirth = cleanDate(input.dateOfBirth || '');
  const expiryDate = cleanDate(input.expiryDate || '');
  const nationality = cleanNationality(input.nationality || '');
  const sex = cleanSex(input.sex || '');
  const title = inferTitle(sex, dateOfBirth);

  if (!fullName) warnings.push('Name is empty or uncertain.');
  if (!passportNo) warnings.push('Passport number is invalid or uncertain.');
  if (!dateOfBirth) warnings.push('DOB is invalid or uncertain.');
  if (!expiryDate) warnings.push('Expiry date is invalid or uncertain.');
  if (!nationality) warnings.push('Nationality is invalid or uncertain.');
  if (!sex) warnings.push('Sex is invalid or uncertain.');

  return {
    fullName,
    passportNo,
    dob: dateOfBirth,
    expiry: expiryDate,
    nationality,
    sex,
    title,
    mrzLine1: typeof input.mrzLine1 === 'string' ? input.mrzLine1 : '',
    mrzLine2: typeof input.mrzLine2 === 'string' ? input.mrzLine2 : '',
    warnings,
  };
}

function cleanFullName(value) {
  let name = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\b(MR|MS|MSTR|MISS|MRS)\b/g, ' ')
    .replace(/\b[CLK]{2,}\b.*$/g, '')
    .replace(/[CLK]{5,}.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) return '';
  if (name.length > 40) return '';
  if (/\d/.test(name)) return '';
  if (/[CLK]{5,}/.test(name)) return '';

  const words = name.split(/\s+/);
  if (words.length > 6) return '';

  const validWords = words.every((word) => /^[A-Z]{1,20}$/.test(word));
  if (!validWords) return '';

  return name;
}

function cleanPassportNo(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = text.match(/[A-Z]{2}[0-9]{6}/);

  if (!match) return '';

  return match[0];
}

function cleanNationality(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');

  if (text === 'MMR') return 'MMR';

  const repairable = ['MMN', 'MMP', 'MMK', 'MHR'];
  if (repairable.includes(text)) return 'MMR';

  return '';
}

function cleanSex(value) {
  const text = String(value || '').toUpperCase().trim();

  if (text === 'M') return 'M';
  if (text === 'F') return 'F';

  return '';
}

function cleanDate(value) {
  const text = String(value || '').trim();

  const mmddyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!mmddyyyy) return '';

  const mm = Number(mmddyyyy[1]);
  const dd = Number(mmddyyyy[2]);
  const yyyy = Number(mmddyyyy[3]);

  if (yyyy < 1900 || yyyy > 2100) return '';
  if (mm < 1 || mm > 12) return '';
  if (dd < 1 || dd > 31) return '';

  return `${String(mm).padStart(2, '0')}/${String(dd).padStart(2, '0')}/${yyyy}`;
}

function inferTitle(sex, dob) {
  if (!sex) return '';

  const age = calculateAge(dob);

  if (sex === 'M') return age < 12 ? 'MSTR' : 'MR';
  if (sex === 'F') return age < 12 ? 'MISS' : 'MS';

  return '';
}

function calculateAge(mmddyyyy) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(mmddyyyy)) {
    return 99;
  }

  const [mm, dd, yyyy] = mmddyyyy.split('/').map(Number);
  const birth = new Date(yyyy, mm - 1, dd);
  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birth.getDate())
  ) {
    age--;
  }

  return age;
}