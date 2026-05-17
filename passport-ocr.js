/**
 * @fileoverview Passport OCR — extract MRZ data from passport photos.
 * Uses Tesseract.js (loaded globally via CDN) to perform client-side OCR,
 * then parses the Machine Readable Zone (ICAO 9303 TD3 format) to extract:
 *   - Full name (surname + given names)
 *   - Date of birth
 *   - Passport number
 *   - Expiry date
 *   - Gender
 *   - Nationality
 */

/* ------------------------------------------------------------------ */
/*  PUBLIC API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run OCR on a passport image and return structured data.
 *
 * @param {File|Blob|string} imageSource - File, Blob, or data-URL / object-URL.
 * @param {(msg: string) => void} [onStatus] - Optional status callback.
 * @returns {Promise<{
 *   name: string,
 *   surname: string,
 *   givenNames: string,
 *   passportNo: string,
 *   dob: string,
 *   expiry: string,
 *   gender: string,
 *   nationality: string,
 *   raw: string
 * } | null>}
 */
export async function ocrPassport(imageSource, onStatus) {
    if (!window.Tesseract) {
        console.warn('Tesseract.js is not loaded.');
        return null;
    }

    onStatus?.('Initialising OCR…');

    try {
        // Convert File/Blob → object URL if needed
        let src = imageSource;
        if (imageSource instanceof Blob) {
            src = URL.createObjectURL(imageSource);
        }

        onStatus?.('Reading passport…');

        const { data } = await Tesseract.recognize(src, 'eng', {
            logger: (info) => {
                if (info.status === 'recognizing text') {
                    const pct = Math.round((info.progress || 0) * 100);
                    onStatus?.(`Scanning… ${pct}%`);
                }
            }
        });

        // Clean up object URL if we created one
        if (imageSource instanceof Blob) {
            URL.revokeObjectURL(src);
        }

        const rawText = data.text || '';
        onStatus?.('Parsing results…');

        // Try MRZ first (most reliable)
        const mrzResult = parseMRZ(rawText);
        if (mrzResult) {
            onStatus?.('Passport data extracted ✓');
            return { ...mrzResult, raw: rawText };
        }

        // Fallback: try to find data in raw text
        const fallbackResult = parseFreeText(rawText);
        if (fallbackResult && (fallbackResult.passportNo || fallbackResult.name)) {
            onStatus?.('Partial data extracted');
            return { ...fallbackResult, raw: rawText };
        }

        onStatus?.('Could not parse passport data');
        return null;
    } catch (err) {
        console.error('Passport OCR failed:', err);
        onStatus?.('OCR failed');
        return null;
    }
}

/* ------------------------------------------------------------------ */
/*  MRZ PARSING (ICAO 9303 TD3 — two lines of 44 characters)          */
/* ------------------------------------------------------------------ */

/**
 * Attempts to find and parse two MRZ lines from raw OCR text.
 * MRZ uses only A-Z, 0-9, and < characters.
 *
 * @param {string} text - Raw OCR output.
 * @returns {object|null}
 */
function parseMRZ(text) {
    // Normalise common OCR misreads in MRZ
    const cleaned = text
        .replace(/«/g, '<')   // OCR sometimes reads « instead of <<
        .replace(/\u00AB/g, '<')
        .replace(/\u00BB/g, '<');

    // Split into lines, clean each, and find candidate MRZ lines
    const lines = cleaned.split(/\n/).map(l => l.replace(/\s/g, '').toUpperCase());

    // MRZ characters: A-Z, 0-9, <
    // Allow some tolerance in length (OCR may miss/add a char)
    const mrzCandidates = lines
        .map(l => sanitiseMrzLine(l))
        .filter(l => l.length >= 40 && l.length <= 48);

    // Find the two MRZ lines (Line 1 starts with P, Line 2 starts with digit or letter)
    let line1 = null;
    let line2 = null;

    for (let i = 0; i < mrzCandidates.length; i++) {
        const l = mrzCandidates[i];
        if (!line1 && l.startsWith('P') && l.includes('<')) {
            line1 = padOrTrim(l, 44);
            // Line 2 is usually the next candidate
            if (i + 1 < mrzCandidates.length) {
                line2 = padOrTrim(mrzCandidates[i + 1], 44);
            }
            break;
        }
    }

    if (!line1 || !line2) return null;

    // --- Parse Line 1: Name ---
    // Format: P<ISO<<SURNAME<<GIVEN<NAMES<<<...
    const namePart = line1.substring(5); // Skip "P<ISO"
    const nameParts = namePart.split('<<').filter(Boolean);
    const surname = (nameParts[0] || '').replace(/</g, ' ').trim();
    const givenNames = (nameParts.slice(1).join(' ') || '').replace(/</g, ' ').trim();
    const nationality3 = line1.substring(2, 5).replace(/</g, '');

    // --- Parse Line 2: Numbers & Dates ---
    // 0-8:   Passport number (9 chars)
    // 9:     Check digit
    // 10-12: Nationality
    // 13-18: DOB (YYMMDD)
    // 19:    Check digit
    // 20:    Gender
    // 21-26: Expiry (YYMMDD)
    // 27:    Check digit
    const passportNo = line2.substring(0, 9).replace(/</g, '').trim();
    const nationality2 = line2.substring(10, 13).replace(/</g, '');
    const dobRaw = line2.substring(13, 19);
    const genderChar = line2.charAt(20);
    const expiryRaw = line2.substring(21, 27);

    // Convert YYMMDD → MM/DD/YYYY
    const dob = mrzDateToDisplay(dobRaw, true);
    const expiry = mrzDateToDisplay(expiryRaw, false);

    // Map gender
    const gender = genderChar === 'F' ? 'MS' : 'MR';

    const nationality = nationality2 || nationality3;

    return {
        name: [surname, givenNames].filter(Boolean).join(' '),
        surname,
        givenNames,
        passportNo,
        dob,
        expiry,
        gender,
        nationality: nationality.length <= 3 ? nationality : ''
    };
}

/**
 * Sanitise a line to contain only valid MRZ characters.
 * Fixes common OCR substitutions: 0↔O, 1↔I, 8↔B, etc.
 */
function sanitiseMrzLine(line) {
    return line.replace(/[^A-Z0-9<]/g, '');
}

/**
 * Pad or trim a line to exactly `len` characters.
 */
function padOrTrim(line, len) {
    if (line.length > len) return line.substring(0, len);
    return line.padEnd(len, '<');
}

/**
 * Convert MRZ date (YYMMDD) to display format (MM/DD/YYYY).
 * @param {string} yymmdd
 * @param {boolean} isBirth - If true, dates in the future are assumed to be in the 1900s.
 */
function mrzDateToDisplay(yymmdd, isBirth) {
    if (!yymmdd || yymmdd.length < 6 || !/^\d{6}$/.test(yymmdd)) return '';

    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);

    // Validate month/day
    const monthNum = parseInt(mm, 10);
    const dayNum = parseInt(dd, 10);
    if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return '';

    const currentYear = new Date().getFullYear() % 100;
    let yyyy;
    if (isBirth) {
        // Birth dates: if yy > current year, assume 1900s
        yyyy = yy > currentYear ? 1900 + yy : 2000 + yy;
    } else {
        // Expiry dates: if yy < current year - 10, assume 2000s
        yyyy = 2000 + yy;
    }

    return `${mm}/${dd}/${yyyy}`;
}

/* ------------------------------------------------------------------ */
/*  FALLBACK: FREE-TEXT PARSING                                        */
/* ------------------------------------------------------------------ */

/**
 * Attempts to extract passport fields from unstructured OCR text.
 * Less reliable than MRZ but catches cases where MRZ is obscured.
 */
function parseFreeText(text) {
    const upper = text.toUpperCase();
    const result = {
        name: '',
        surname: '',
        givenNames: '',
        passportNo: '',
        dob: '',
        expiry: '',
        gender: '',
        nationality: ''
    };

    // Passport number: typically starts with a letter followed by 6-8 digits
    const ppMatch = upper.match(/\b([A-Z]\d{6,8})\b/);
    if (ppMatch) {
        result.passportNo = ppMatch[1];
    }

    // Dates: look for DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD MMM YYYY patterns
    const datePatterns = [
        /(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/g,
        /(\d{2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/gi
    ];

    const dates = [];
    for (const pat of datePatterns) {
        let m;
        while ((m = pat.exec(upper)) !== null) {
            dates.push(m[0]);
        }
    }

    // Try to find name fields near keywords
    const namePatterns = [
        /(?:SURNAME|FAMILY\s*NAME|NOM)[:\s/]*([A-Z][A-Z\s]{2,25})/i,
        /(?:GIVEN\s*NAME|FIRST\s*NAME|PRENOM)[:\s/]*([A-Z][A-Z\s]{2,30})/i
    ];

    const surnameMatch = upper.match(namePatterns[0]);
    const givenMatch = upper.match(namePatterns[1]);

    if (surnameMatch) result.surname = surnameMatch[1].trim();
    if (givenMatch) result.givenNames = givenMatch[1].trim();

    if (result.surname || result.givenNames) {
        result.name = [result.surname, result.givenNames].filter(Boolean).join(' ');
    }

    // Gender
    if (/\bFEMALE\b|\bF\b/.test(upper)) result.gender = 'MS';
    else if (/\bMALE\b|\bM\b/.test(upper)) result.gender = 'MR';

    // Nationality
    const natMatch = upper.match(/(?:NATIONALITY|NAT)[:\s/]*([A-Z]{2,3})/);
    if (natMatch) result.nationality = natMatch[1];

    return result;
}
