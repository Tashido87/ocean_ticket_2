const crypto = require('node:crypto');
const { GoogleGenAI } = require('@google/genai');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ocean-ticket-bf235';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const MAX_BASE64_LENGTH = 8 * 1024 * 1024; // 8 MB max base64 payload
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

let cachedCerts = null;
let cachedCertsExpiresAt = 0;
const rateLimitBuckets = new Map();

async function getFirebasePublicCerts() {
  const now = Date.now();
  if (cachedCerts && now < cachedCertsExpiresAt) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public certs (${res.status})`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  cachedCerts = await res.json();
  cachedCertsExpiresAt = now + ttlMs;
  return cachedCerts;
}

function decodeBase64UrlJson(segment) {
  const jsonStr = Buffer.from(segment, 'base64url').toString('utf8');
  return JSON.parse(jsonStr);
}

async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Missing Firebase ID token');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token');
  }

  const [rawHeader, rawPayload, rawSignature] = parts;
  const header = decodeBase64UrlJson(rawHeader);
  const payload = decodeBase64UrlJson(rawPayload);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid token algorithm or key ID');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new Error('Invalid token audience');
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error('Invalid token issuer');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Invalid token subject');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 60) {
    throw new Error('Invalid token issued-at time');
  }

  const certs = await getFirebasePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Signing certificate not found for token');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${rawHeader}.${rawPayload}`);
  verifier.end();

  const signatureValid = verifier.verify(cert, Buffer.from(rawSignature, 'base64url'));
  if (!signatureValid) {
    throw new Error('Invalid Firebase ID token signature');
  }

  return payload;
}

function isAllowedOrigin(headers = {}) {
  const origin = String(headers.origin || headers.Origin || headers.referer || headers.Referer || '').trim();
  if (!origin) return true; // Checked further by Firebase ID Token
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.netlify.app') ||
      host.endsWith('.web.app') ||
      host.endsWith('.firebaseapp.com')
    ) {
      return true;
    }
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
    if (siteUrl) {
      const allowedHost = new URL(siteUrl).hostname.toLowerCase();
      if (host === allowedHost) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function checkRateLimit(key) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX_REQUESTS;
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { ok: false, error: 'Method not allowed' });
    }

    const headers = event.headers || {};
    if (!isAllowedOrigin(headers)) {
      return json(403, { ok: false, error: 'Forbidden origin' });
    }

    // Verify Firebase Auth Bearer token (or configured internal secret)
    const authHeader = String(headers.authorization || headers.Authorization || '').trim();
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const internalSecret = process.env.OCR_API_SECRET;
    const providedSecret = headers['x-ocr-secret'] || headers['X-OCR-Secret'];

    let verifiedUser = null;
    if (bearerMatch) {
      try {
        verifiedUser = await verifyFirebaseIdToken(bearerMatch[1].trim());
      } catch (authErr) {
        console.warn('[gemini-passport-ocr] Auth verification failed:', authErr.message);
        return json(401, { ok: false, error: 'Unauthorized: Invalid or expired Firebase Auth token' });
      }
    } else if (internalSecret && providedSecret === internalSecret) {
      verifiedUser = { sub: 'internal-secret' };
    } else {
      return json(401, { ok: false, error: 'Unauthorized: Firebase Auth Bearer token required' });
    }

    const clientIp = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || 'unknown';
    const rateKey = verifiedUser?.sub || clientIp;
    if (!checkRateLimit(rateKey)) {
      return json(429, { ok: false, error: 'Too many OCR requests. Please wait a moment and try again.' });
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
    if (cleanBase64.length > MAX_BASE64_LENGTH) {
      return json(413, { ok: false, error: 'Image payload too large' });
    }

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
- The 6 characters after the two letters MUST be digits 0-9 only. Never write O, I, S, B, Z, G as letters in the digits portion. If the printed character looks like O write 0, like I write 1, like S write 5, like B write 8, like Z write 2, like G write 6.
- dateOfBirth format: DD/MM/YYYY.
- expiryDate format: DD/MM/YYYY.
- nationality should be MMR for Myanmar passports.
- sex must be M or F.
- Prefer MRZ if readable.
- For MRZ names, convert < into spaces and remove trailing filler.
- Never output noisy text such as repeated C, L, K filler characters.
- If a field is not clearly readable, return empty string.
`;

    const candidateModels = ['gemini-3.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];
    let response = null;
    let lastError = null;

    for (const model of candidateModels) {
      try {
        const generatePromise = ai.models.generateContent({
          model,
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

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini OCR timed out on ${model}`)), 15000)
        );
        response = await Promise.race([generatePromise, timeoutPromise]);
        if (response && response.text) {
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[gemini-passport-ocr] Model ${model} failed:`, err.message);
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error('All Gemini candidate models failed');
    }

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

  // 1) Strict match: 2 letters + 6 digits.
  const strict = text.match(/[A-Z]{2}[0-9]{6}/);
  if (strict) return strict[0];

  // 2) Repair common OCR letter↔digit confusions in the 6-character suffix.
  //    Find any 8-character window of [A-Z0-9], then map possible letters to digits.
  const letterToDigit = { O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6', D: '0', Q: '0' };
  const candidate = text.match(/[A-Z]{2}[A-Z0-9]{6}/);
  if (candidate) {
    const prefix = candidate[0].slice(0, 2);
    const suffix = candidate[0].slice(2).split('').map((ch) => letterToDigit[ch] || ch).join('');
    if (/^[0-9]{6}$/.test(suffix)) return prefix + suffix;
  }

  return '';
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
  if (!text) return '';

  // DD/MM/YYYY
  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const dd = Number(ddmmyyyy[1]);
    const mm = Number(ddmmyyyy[2]);
    const yyyy = Number(ddmmyyyy[3]);
    if (yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yyyy}`;
    }
  }

  // Named month: "25 MAR 2000" or "12 FEB 2029"
  const namedMonths = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
  };
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (named) {
    const dd = Number(named[1]);
    const monthKey = named[2].toUpperCase().slice(0, 3);
    const mm = namedMonths[monthKey];
    const yyyy = Number(named[3]);
    if (mm && yyyy >= 1900 && yyyy <= 2100 && dd >= 1 && dd <= 31) {
      return `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yyyy}`;
    }
  }

  return '';
}

function inferTitle(sex, dob) {
  if (!sex) return '';

  const age = calculateAge(dob);

  if (sex === 'M') return age < 12 ? 'MSTR' : 'MR';
  if (sex === 'F') return age < 12 ? 'MISS' : 'MS';

  return '';
}

function calculateAge(ddmmyyyy) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(ddmmyyyy)) {
    return 99;
  }

  const [dd, mm, yyyy] = ddmmyyyy.split('/').map(Number);
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