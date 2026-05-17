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
 *
 * Handles Myanmar passports (PV type code, MG/MA/MC prefix numbers)
 * and common OCR misreads in the MRZ font (OCR-B).
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
        console.log('[Passport OCR] Raw text:\n', rawText);
        onStatus?.('Parsing results…');

        // Try MRZ first (most reliable for name + passport number)
        const mrzResult = parseMRZ(rawText);
        if (mrzResult) {
            console.log('[Passport OCR] MRZ result:', mrzResult);
        }

        // Always try free-text too (best for dates from printed fields)
        const freeResult = parseFreeText(rawText);
        if (freeResult) {
            console.log('[Passport OCR] Free-text result:', freeResult);
        }

        const mrzExpiry = getUsableExpiryDate(mrzResult?.expiry, freeResult?.issue);
        const fallbackExpiry = getUsableExpiryDate(extractLooseMrzExpiry(rawText), freeResult?.issue);
        if (fallbackExpiry) {
            console.log('[Passport OCR] Loose MRZ expiry:', fallbackExpiry);
        }
        const freeExpiry = getUsableFreeTextExpiry(freeResult);

        // Merge: MRZ as base, free-text fills gaps, loose MRZ as last-resort expiry.
        if (mrzResult || (freeResult && (freeResult.passportNo || freeResult.name))) {

            // Name: prefer free-text (printed field, clean spaces) over MRZ
            // (MRZ filler '<' chars are often OCR'd as garbage letters, corrupting the name).
            // MRZ name only used if free-text gives nothing.
            const freeName = freeResult?.name || '';
            let bestName = freeName || mrzResult?.name || '';

            // If neither source gave a name, try raw MRZ line recovery
            if (!bestName) {
                bestName = extractNameFromRawMrz(rawText);
            }

            const merged = {
                name:        bestName || freeName || '',
                surname:     mrzResult?.surname      || freeResult?.surname     || '',
                givenNames:  mrzResult?.givenNames   || freeResult?.givenNames  || '',
                passportNo:  mrzResult?.passportNo   || freeResult?.passportNo  || '',
                dob:         mrzResult?.dob          || freeResult?.dob         || '',
                expiry:      mrzExpiry               || fallbackExpiry          || freeExpiry || '',
                gender:      mrzResult?.gender       || freeResult?.gender      || '',
                nationality: mrzResult?.nationality  || freeResult?.nationality || '',
                raw: rawText
            };
            console.log('[Passport OCR] Merged result:', merged);
            onStatus?.('Passport data extracted ✓');
            return merged;
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
 * Last-resort name extraction: scan raw OCR text for a passport MRZ line 1
 * (starts with PV or P< + 3-letter country code) and extract the name portion.
 * Handles OCR reading '<' as spaces (common with Tesseract on MRZ fonts).
 *
 * @param {string} text - Raw OCR text
 * @returns {string} Extracted name or ''
 */
function extractNameFromRawMrz(text) {
    const lines = text.split(/\n/);
    for (const raw of lines) {
        // Sanitize: remove spaces, uppercase, fix OCR substitutions → same as MRZ lines
        let s = raw.replace(/\s/g, '').toUpperCase();
        s = sanitiseMrzLine(s);

        // Must look like a passport MRZ line 1 (P + type + country + name ≥30 chars)
        if (s.length < 25 || s.charAt(0) !== 'P') continue;

        // Verify country code at positions 2–4
        const countryCode = s.substring(2, 5);
        if (!/^[A-Z]{3}$/.test(countryCode)) continue;

        // Name section is strictly positions 5–43 (39 chars) in a 44-char MRZ line
        const nameSection = s.substring(5, 44);

        // Split on < (single < = space separator)
        const parts = nameSection.split('<').filter(Boolean);
        if (!parts.length) continue;

        // Validate parts — each should be a real word (all letters, length ≥ 1)
        const validParts = parts.filter(p => /^[A-Z]+$/.test(p));
        if (!validParts.length) continue;

        const name = validParts.join(' ').trim();
        if (name.length >= 3) {
            console.log('[Passport OCR] Raw MRZ name recovery:', name);
            return name;
        }
    }
    return '';
}

/**
 * Attempts to find and parse two MRZ lines from raw OCR text.
 * MRZ uses only A-Z, 0-9, and < characters.
 * Handles standard (P<) and Myanmar (PV) type codes.
 *
 * @param {string} text - Raw OCR output.
 * @returns {object|null}
 */
function parseMRZ(text) {

    // Normalise common OCR misreads in MRZ
    const cleaned = text
        .replace(/«/g, '<')
        .replace(/\u00AB/g, '<')
        .replace(/\u00BB/g, '<')
        .replace(/\u2039/g, '<')
        .replace(/\u203A/g, '<');

    // Split into lines, clean each, and find candidate MRZ lines
    const rawLines = cleaned.split(/\n/);
    const lines = rawLines.map(l => {
        // Remove spaces, uppercase, fix common OCR substitutions for MRZ
        let s = l.replace(/\s/g, '').toUpperCase();
        return sanitiseMrzLine(s);
    });

    // MRZ characters: A-Z, 0-9, <
    // Allow some tolerance in length (OCR may miss/add a char)
    const mrzCandidates = lines.filter(l => l.length >= 38 && l.length <= 50);

    // Find the two MRZ lines
    // Line 1 starts with P followed by type char (< or V or other) then country code
    // Line 2 starts with passport number (letter + digits)
    let line1 = null;
    let line2 = null;
    let line1Idx = -1;

    for (let i = 0; i < mrzCandidates.length; i++) {
        const l = mrzCandidates[i];
        // Line 1: starts with P, followed by type char and country code
        // Accept even with fewer < chars in case OCR read < as spaces in name section
        if (!line1 && l.charAt(0) === 'P' &&
            (l.includes('<') && countChar(l, '<') >= 3 || countChar(l, '<') >= 10)) {
            line1 = padOrTrim(l, 44);
            line1Idx = i;
            // Line 2 is usually the next candidate
            for (let j = i + 1; j < mrzCandidates.length; j++) {
                const l2 = mrzCandidates[j];
                // Line 2 should start with a letter (passport number) and contain digits
                if (/[A-Z]/.test(l2.charAt(0)) && /\d{4,}/.test(l2) && l2.includes('<')) {
                    line2 = padOrTrim(l2, 44);
                    break;
                }
            }
            break;
        }
    }

    if (!line1 || !line2) return null;

    // --- Determine format ---
    // Standard: P<ISOSURNAME<<GIVEN<<<
    // Myanmar:  PVMMRSUTT<NAW<AUNG<<<
    const typeChar = line1.charAt(1); // '<' for standard, 'V' for Myanmar PV type, etc.
    const countryStart = 2;
    const countryCode = line1.substring(countryStart, countryStart + 3).replace(/</g, '');
    const nameStart = countryStart + 3; // position 5

    // --- Parse Line 1: Name ---
    const namePart = line1.substring(nameStart);

    // Names: surname and given names separated by <<
    // Single < separates words within surname or given names
    const doubleChevronIdx = namePart.indexOf('<<');
    let surname, givenNames;

    if (doubleChevronIdx > 0) {
        // Standard format: SURNAME<<GIVEN<NAMES<<<
        surname = namePart.substring(0, doubleChevronIdx).replace(/</g, ' ').trim();
        const givenPart = namePart.substring(doubleChevronIdx + 2);
        givenNames = givenPart.replace(/<<+/g, ' ').replace(/</g, ' ').trim();
    } else {
        // Myanmar format: all name parts separated by single <, trailing <<<
        // e.g., SUTT<NAW<AUNG<<<<<<<<<
        const trimmed = namePart.replace(/(<){2,}$/g, ''); // Remove trailing <<<
        const parts = trimmed.split('<').filter(Boolean);
        if (parts.length >= 2) {
            surname = parts[0];
            givenNames = parts.slice(1).join(' ');
        } else {
            surname = trimmed.replace(/</g, ' ').trim();
            givenNames = '';
        }
    }

    // --- Parse Line 2: Numbers & Dates ---
    // 0-8:   Passport number (9 chars, padded with <)
    // 9:     Check digit
    // 10-12: Nationality (3 chars)
    // 13-18: DOB (YYMMDD)
    // 19:    Check digit
    // 20:    Gender (M/F/<)
    // 21-26: Expiry (YYMMDD)
    // 27:    Check digit
    const passportNo = line2.substring(0, 9).replace(/</g, '').trim();
    const nationality2 = line2.substring(10, 13).replace(/</g, '');
    const dobRaw = fixOcrDigits(line2.substring(13, 19));
    const genderChar = line2.charAt(20);
    const expiryRaw = fixOcrDigits(line2.substring(21, 27));

    // Validate: passport number should have at least 5 alphanumeric chars
    if (passportNo.length < 5) return null;

    // Convert YYMMDD → MM/DD/YYYY (don't hard-fail if dates are unreadable)
    const dob = mrzDateToDisplay(dobRaw, true);
    const expiry = mrzDateToDisplay(expiryRaw, false);

    // Map gender
    let gender = '';
    if (genderChar === 'F') gender = 'MS';
    else if (genderChar === 'M') gender = 'MR';

    const nationality = nationality2 || countryCode;

    const fullName = [surname, givenNames].filter(Boolean).join(' ');

    // Only return if we got at least a name or passport number
    if (!fullName && !passportNo) return null;

    return {
        name: fullName,
        surname: surname || '',
        givenNames: givenNames || '',
        passportNo,
        dob,
        expiry,
        gender,
        nationality: nationality.length <= 3 ? nationality : ''
    };
}

/**
 * Count occurrences of a character in a string.
 */
function countChar(str, ch) {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === ch) count++;
    }
    return count;
}

/**
 * Sanitise a line to contain only valid MRZ characters.
 * Also fixes common OCR substitutions in OCR-B font.
 */
function sanitiseMrzLine(line) {
    let fixed = line
        .replace(/\|/g, '<')
        .replace(/\\/g, '<')
        .replace(/\{/g, '<')
        .replace(/\[/g, '<')
        .replace(/~/g, '<');

    return fixed.replace(/[^A-Z0-9<]/g, '');
}

/**
 * Fix common OCR letter↔digit misreads for positions that should be digits.
 * OCR-B font causes: O↔0, I↔1, Z↔2, S↔5, B↔8, G↔6, T↔7
 */
function fixOcrDigits(str) {
    return str
        .replace(/O/g, '0')
        .replace(/o/g, '0')
        .replace(/I/g, '1')
        .replace(/l/g, '1')
        .replace(/Z/g, '2')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/G/g, '6')
        .replace(/T/g, '7')
        .replace(/[^0-9]/g, '');  // strip anything that's still not a digit
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
    if (!yymmdd || yymmdd.length < 6) return '';
    
    // Apply digit correction one more time
    const digits = fixOcrDigits(yymmdd);
    if (digits.length < 6 || !/^\d{6}$/.test(digits)) return '';

    const yy = parseInt(digits.substring(0, 2), 10);
    const mm = digits.substring(2, 4);
    const dd = digits.substring(4, 6);

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
        // Expiry dates: always 2000s for passports
        yyyy = 2000 + yy;
    }

    return `${mm}/${dd}/${yyyy}`;
}

/**
 * Last-resort parser for noisy MRZ line 2. This catches cases where strict MRZ
 * parsing finds the DOB/passport number but misses expiry because OCR added or
 * removed filler/check characters.
 */
function extractLooseMrzExpiry(text) {
    const lines = String(text || '')
        .replace(/«|\u00AB|\u00BB|\u2039|\u203A/g, '<')
        .split(/\n/)
        .map(line => sanitiseMrzLine(line.replace(/\s/g, '').toUpperCase()))
        .filter(line => line.length >= 24);

    const patterns = [
        // Passport + check + nationality + DOB + check + sex + expiry
        /[A-Z0-9<]{6,12}[0-9A-Z<][A-Z<]{3}([0-9OIZSBGT]{6})[0-9A-Z<]?[MFX<]([0-9OIZSBGT]{6})/,
        // More tolerant when check digits are lost around sex.
        /[A-Z0-9<]{6,12}[0-9A-Z<]{0,2}[A-Z<]{3}([0-9OIZSBGT]{6})[0-9A-Z<]{0,2}[MFX<]([0-9OIZSBGT]{6})/
    ];

    for (const line of lines) {
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (!match) continue;

            const expiryRaw = fixOcrDigits(match[2]);
            const expiry = mrzDateToDisplay(expiryRaw, false);
            if (expiry) return expiry;
        }
    }

    return '';
}

function dateYear(displayDate) {
    const m = String(displayDate || '').match(/^\d{1,2}\/\d{1,2}\/(\d{4})$/);
    return m ? parseInt(m[1], 10) : 0;
}

function getUsableFreeTextExpiry(freeResult) {
    return getUsableExpiryDate(freeResult?.expiry, freeResult?.issue);
}

function getUsableExpiryDate(expiry, issue = '') {
    if (!expiry) return '';
    if (issue && expiry === issue) return '';

    const year = dateYear(expiry);
    const currentYear = new Date().getFullYear();

    // Do not let "Date of issue" become "expiry". If OCR cannot read a future
    // expiry date, leave it blank rather than saving an already-past issue date.
    if (year && year < currentYear) return '';
    return expiry;
}

/* ------------------------------------------------------------------ */
/*  FALLBACK: FREE-TEXT PARSING                                        */
/*  Reads the visible printed fields on the passport page              */
/* ------------------------------------------------------------------ */

const MONTH_MAP = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
};

/**
 * Normalizes OCR-noisy month tokens to a 3-letter key.
 * @param {string} token
 * @returns {string}
 */
function normaliseMonthToken(token = '') {
    const fixed = String(token)
        .toUpperCase()
        .replace(/0/g, 'O')
        .replace(/1/g, 'I')
        .replace(/5/g, 'S')
        .replace(/8/g, 'B')
        .replace(/[^A-Z]/g, '');

    if (fixed.startsWith('JAN')) return 'JAN';
    if (fixed.startsWith('FEB') || fixed.startsWith('FEE') || fixed.startsWith('FES')) return 'FEB';
    if (fixed.startsWith('MAR')) return 'MAR';
    if (fixed.startsWith('APR')) return 'APR';
    if (fixed.startsWith('MAY')) return 'MAY';
    if (fixed.startsWith('JUN')) return 'JUN';
    if (fixed.startsWith('JUL')) return 'JUL';
    if (fixed.startsWith('AUG')) return 'AUG';
    if (fixed.startsWith('SEP') || fixed.startsWith('SEF')) return 'SEP';
    if (fixed.startsWith('OCT')) return 'OCT';
    if (fixed.startsWith('NOV') || fixed.startsWith('NOU')) return 'NOV';
    if (fixed.startsWith('DEC')) return 'DEC';
    return fixed.substring(0, 3);
}

function normalizeYear(yearStr, isBirth = false) {
    const raw = String(yearStr || '').trim();
    if (raw.length === 4) return raw;
    if (raw.length !== 2) return '';

    const yy = parseInt(raw, 10);
    if (Number.isNaN(yy)) return '';

    const currentYear = new Date().getFullYear() % 100;
    if (isBirth) return String(yy > currentYear ? 1900 + yy : 2000 + yy);
    return String(2000 + yy);
}

/**
 * Converts passport date strings into MM/DD/YYYY.
 * Supports "DD MMM YYYY", "DD MMM YY", "DD/MM/YYYY", "DD-MM-YY", and "YYYY-MM-DD".
 * @param {string} dateStr
 * @param {boolean} [isBirth=false]
 * @returns {string}
 */
function normaliseDateToMMDDYYYY(dateStr, isBirth = false) {
    const raw = String(dateStr || '').trim();

    // DD MMM YYYY / DD MMM YY / compact DDMMMYYYY.
    const namedMonth = raw.match(/(\d{1,2})\s+([A-Z0-9]{3,9})\.?\s+(\d{2,4})/i)
        || raw.match(/(\d{1,2})([A-Z0-9]{3})(\d{2,4})/i);
    if (namedMonth) {
        const dd = namedMonth[1].padStart(2, '0');
        const mm = MONTH_MAP[normaliseMonthToken(namedMonth[2])];
        const yyyy = normalizeYear(namedMonth[3], isBirth);
        if (!mm || !yyyy) return '';
        return `${mm}/${dd}/${yyyy}`;
    }

    // YYYY/MM/DD or YYYY-MM-DD
    const isoLike = raw.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (isoLike) {
        return `${isoLike[2].padStart(2, '0')}/${isoLike[3].padStart(2, '0')}/${isoLike[1]}`;
    }

    // DD/MM/YYYY, DD-MM-YY, MM/DD/YYYY. In passport context, prefer DD/MM when ambiguous.
    const numeric = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (numeric) {
        const first = parseInt(numeric[1], 10);
        const second = parseInt(numeric[2], 10);
        const yyyy = normalizeYear(numeric[3], isBirth);
        if (!yyyy) return '';

        const dd = first > 12 ? numeric[1] : numeric[1];
        const mm = first > 12 ? numeric[2] : (second > 12 ? numeric[1] : numeric[2]);
        const day = first > 12 ? dd : (second > 12 ? numeric[2] : dd);
        return `${String(mm).padStart(2, '0')}/${String(day).padStart(2, '0')}/${yyyy}`;
    }

    return '';
}

function displayYear(displayDate) {
    const m = String(displayDate || '').match(/\d{1,2}\/\d{1,2}\/(\d{4})/);
    return m ? parseInt(m[1], 10) : 0;
}

function extractDateCandidates(text, isBirth = false) {
    const dates = [];

    const namedRegex = /(\d{1,2})\s+([A-Z0-9]{3,9})\.?\s+(\d{2,4})/gi;
    let m;
    while ((m = namedRegex.exec(text)) !== null) {
        const display = normaliseDateToMMDDYYYY(m[0], isBirth);
        if (display) {
            dates.push({
                display,
                year: displayYear(display),
                raw: m[0],
                index: m.index
            });
        }
    }

    const compactNamedRegex = /(\d{1,2})([A-Z0-9]{3})(\d{2,4})/gi;
    while ((m = compactNamedRegex.exec(text)) !== null) {
        const display = normaliseDateToMMDDYYYY(m[0], isBirth);
        if (display) {
            dates.push({
                display,
                year: displayYear(display),
                raw: m[0],
                index: m.index
            });
        }
    }

    const numericRegex = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/g;
    while ((m = numericRegex.exec(text)) !== null) {
        const display = normaliseDateToMMDDYYYY(m[0], isBirth);
        if (display) {
            dates.push({
                display,
                year: displayYear(display),
                raw: m[0],
                index: m.index
            });
        }
    }

    return dates;
}

function findLabeledDate(text, labelPattern, { isBirth = false, preferLatest = false } = {}) {
    const match = labelPattern.exec(text);
    if (!match) return '';

    // Search 200 chars after the label to handle large gaps / multi-line layouts
    const slice = text.slice(match.index, match.index + 200);
    const candidates = extractDateCandidates(slice, isBirth);
    if (!candidates.length) return '';

    candidates.sort((a, b) => a.year - b.year || a.index - b.index);
    return preferLatest ? candidates[candidates.length - 1].display : candidates[0].display;
}

/**
 * Attempts to extract passport fields from unstructured OCR text.
 * Reads the visible printed fields on the passport bio page.
 */
function parseFreeText(text) {
    const upper = text.toUpperCase();
    const result = {
        name: '',
        surname: '',
        givenNames: '',
        passportNo: '',
        dob: '',
        issue: '',
        expiry: '',
        gender: '',
        nationality: ''
    };

    // ---- Passport number ----
    // Myanmar: MA, MB, MC, MD, ME, MF, MG + 6 digits
    // General: 1-2 letters + 6-8 digits
    const ppPatterns = [
        /\b(M[A-Z]\d{6})\b/,                           // Myanmar passport (MG336792)
        /(?:PASSPORT\s*(?:NO|NUMBER|#)[.:\s]*)([A-Z]{1,2}\d{6,8})\b/i,  // Near "Passport No" label
        /\b([A-Z]{1,2}\d{6,8})\b/                       // General passport pattern
    ];

    for (const pat of ppPatterns) {
        const m = upper.match(pat);
        if (m) {
            result.passportNo = m[1];
            break;
        }
    }

    // ---- Name ----
    // Burmese passports often have Myanmar-script labels that OCR reads as
    // garbage Latin chars (e.g. "GE", "QE", "CE") immediately before the name.
    // Strategy: anchor strictly to the "Name" label, then clean any leading noise.

    /**
     * Strip leading OCR-noise tokens from a name.
     * A "noise token" is a leading word that is:
     *   - 1–2 characters long (likely Burmese-script OCR artifact)
     *   - OR matches a known OCR noise pattern near the Name label
     * Keeps stripping as long as at least 2 valid words remain.
     */
    function cleanOcrName(raw) {
        if (!raw) return '';
        let words = raw.trim().split(/\s+/).filter(Boolean);
        // Strip leading short tokens that look like noise, not name parts
        // Known artifacts: GE, QE, CE, AG, LA, GS, GA, etc. (all ≤2 chars from Burmese OCR)
        // Also strip single non-alpha chars
        while (words.length > 1) {
            const first = words[0];
            const isNoise = first.length <= 2 && !/^(AL|AK|EL|ED|LI|LU|MO|BO|ZA|SI|SU|TI|TU|PO|PU|KO|MA|BA|NU|AI)$/i.test(first);
            if (isNoise) {
                words.shift();
            } else {
                break;
            }
        }
        // Also strip trailing single chars (OCR noise at end)
        while (words.length > 1 && words[words.length - 1].length <= 1) {
            words.pop();
        }
        return words.join(' ');
    }

    // Pattern 1: "Name\n<value>" — strict newline anchor (best for Myanmar passports)
    // Pattern 2: "Name <value>" — inline (some passports)
    // Pattern 3: SURNAME/FAMILY NAME label
    // Pattern 4: GIVEN NAME label
    const namePatterns = [
        /(?:^|\n)\s*Name\s*\n\s*([A-Z][A-Z\s]{2,50}?)(?:\n|$)/im,
        /\bName\s{1,5}([A-Z][A-Z\s]{3,50}?)(?:\n|Nationality|Date|Sex|Place|$)/im,
        /(?:SURNAME|FAMILY\s*NAME|NOM)[:\s/]*\n?\s*([A-Z][A-Z\s]{2,25})/im,
        /(?:GIVEN\s*NAME|FIRST\s*NAME|PRENOM)[:\s/]*\n?\s*([A-Z][A-Z\s]{2,30})/im,
    ];

    // Try strict newline-anchored pattern first
    const nameMatch = text.match(namePatterns[0]) || text.match(namePatterns[1]);
    if (nameMatch) {
        const rawName = nameMatch[1].trim().replace(/\s{2,}/g, ' ');
        // Filter out things that look like labels, not names
        if (!/PASSPORT|REPUBLIC|MYANMAR|NATIONALITY|DATE|TYPE|CODE|COUNTRY|AUTHORITY/i.test(rawName)) {
            const cleaned = cleanOcrName(rawName.toUpperCase());
            if (cleaned.length >= 3) result.name = cleaned;
        }
    }

    // Try surname + given name separately if full name wasn't found
    if (!result.name) {
        const surnameMatch = text.match(namePatterns[2]);
        const givenMatch = text.match(namePatterns[3]);
        if (surnameMatch) result.surname = cleanOcrName(surnameMatch[1].trim().toUpperCase());
        if (givenMatch) result.givenNames = cleanOcrName(givenMatch[1].trim().toUpperCase());
        if (result.surname || result.givenNames) {
            result.name = [result.surname, result.givenNames].filter(Boolean).join(' ');
        }
    }



    // ---- Dates: smart extraction ----
    // Step 1: Find ALL dates in the text with tolerant OCR month/date parsing.
    const allDates = extractDateCandidates(text);

    console.log('[Passport OCR] All dates found:', allDates);

    // Step 2: Try label-based matching first (very flexible spacing)
    // DOB
    result.dob = findLabeledDate(
        text,
        /(?:Date\s*of\s*birth|DOB|BORN|D\.?O\.?B)/i,
        { isBirth: true, preferLatest: false }
    );

    // Issue date. Used only to prevent issue-date values from being stored as expiry.
    result.issue = findLabeledDate(
        text,
        /(?:Date\s*[oO0]f\s*[iI1l][sS5]{1,2}[uU][eE]|ISSUED?|ISSUE\s*DATE)/i,
        { isBirth: false, preferLatest: true }
    );

    // Expiry — many OCR variations: "Date of expiry", "Date of Expiry", "Expiry", "Exp date",
    // "date of exp", OCR artefacts like "expiR", "expiry.", "EXPIR" etc.
    result.expiry = findLabeledDate(
        text,
        /(?:Date\s*[oO0]f\s*[eEcC][xX][pP]\w*|[eEcC][xX][pP][iI]\w{0,3}[yY]|[eEcC][xX][pP]\s*[dD][aA][tT]|VALID\s*(?:UNTIL|THRU))/i,
        { isBirth: false, preferLatest: true }
    );

    if (result.issue && result.expiry === result.issue) {
        result.expiry = '';
    }

    console.log('[Passport OCR] Label-matched DOB:', result.dob, '| Issue:', result.issue, '| Expiry:', result.expiry);

    // Step 3: Positional / year-heuristic assignment for missing fields.
    // Sort all dates ascending by text position (order they appear on page).
    const now = new Date().getFullYear();
    const sortedByPos = [...allDates].sort((a, b) => a.index - b.index);
    const sortedByYear = [...allDates].sort((a, b) => a.year - b.year);

    // DOB: earliest year (person was born before 2015)
    if (!result.dob) {
        const dobCandidate = sortedByYear.find(d => d.year < 2015);
        if (dobCandidate) result.dob = dobCandidate.display;
    }

    // Expiry: prefer the next date after issue, or otherwise latest future date.
    if (!result.expiry) {
        const issueCandidate = result.issue
            ? sortedByPos.find(d => d.display === result.issue)
            : null;
        const afterIssue = issueCandidate
            ? sortedByPos.find(d =>
                d.index > issueCandidate.index &&
                d.display !== result.dob &&
                d.display !== result.issue &&
                d.year >= issueCandidate.year
            )
            : null;

        if (afterIssue) {
            result.expiry = afterIssue.display;
        }
    }

    if (!result.expiry) {
        const futureDates = sortedByYear.filter(d =>
            d.year >= now &&
            d.display !== result.dob &&
            d.display !== result.issue
        );
        if (futureDates.length) {
            result.expiry = futureDates[futureDates.length - 1].display;
        }
    }

    if (result.issue && result.expiry === result.issue) {
        result.expiry = '';
    }

    console.log('[Passport OCR] Final DOB:', result.dob, '| Issue:', result.issue, '| Expiry:', result.expiry);

    // ---- Gender ----
    // Allow up to 20 chars between 'Sex' label and M/F value (Myanmar passports
    // often have Burmese-script label that OCR reads as noise between label and value).
    const sexMatch = text.match(/(?:Sex|Gender)[\s\S]{0,20}?([MF])(?:\s|\n|$|P)/i)
        || text.match(/\bSex\b[^\n]{0,15}([MF])/i);
    if (sexMatch) {
        result.gender = sexMatch[1].toUpperCase() === 'F' ? 'MS' : 'MR';
        console.log('[Passport OCR] Gender extracted:', result.gender);
    }

    // ---- Nationality ----
    const natMatch = text.match(/(?:Nationality)\s*\n?\s*([A-Z]{3,15})/i);
    if (natMatch) {
        const nat = natMatch[1].toUpperCase();
        // Map full country name → ISO code
        if (nat === 'MYANMAR') result.nationality = 'MMR';
        else if (nat.length <= 3) result.nationality = nat;
    }

    return result;
}
