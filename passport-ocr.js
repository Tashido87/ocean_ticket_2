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

        // Merge: MRZ as base, free-text fills gaps
        if (mrzResult || (freeResult && (freeResult.passportNo || freeResult.name))) {
            const merged = {
                name:        mrzResult?.name        || freeResult?.name        || '',
                surname:     mrzResult?.surname      || freeResult?.surname     || '',
                givenNames:  mrzResult?.givenNames   || freeResult?.givenNames  || '',
                passportNo:  mrzResult?.passportNo   || freeResult?.passportNo  || '',
                dob:         mrzResult?.dob          || freeResult?.dob         || '',
                expiry:      mrzResult?.expiry       || freeResult?.expiry      || '',
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
        // Line 1: starts with P, contains <, and has enough < padding at the end
        if (!line1 && l.charAt(0) === 'P' && l.includes('<') && countChar(l, '<') >= 5) {
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

/* ------------------------------------------------------------------ */
/*  FALLBACK: FREE-TEXT PARSING                                        */
/*  Reads the visible printed fields on the passport page              */
/* ------------------------------------------------------------------ */

const MONTH_MAP = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
};

/**
 * Converts "DD MMM YYYY" or "DD/MM/YYYY" or "MM/DD/YYYY" → "MM/DD/YYYY".
 * @param {string} dateStr
 * @returns {string}
 */
function normaliseDateToMMDDYYYY(dateStr) {
    // DD MMM YYYY (e.g. "11 FEB 1997")
    const namedMonth = dateStr.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/i);
    if (namedMonth) {
        const dd = namedMonth[1].padStart(2, '0');
        const mm = MONTH_MAP[namedMonth[2].toUpperCase()];
        const yyyy = namedMonth[3];
        return `${mm}/${dd}/${yyyy}`;
    }

    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const numeric = dateStr.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/);
    if (numeric) {
        // Assume DD/MM/YYYY for passport context
        return `${numeric[2]}/${numeric[1]}/${numeric[3]}`;
    }

    return '';
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
    // Look for "Name" label followed by the name value
    const namePatterns = [
        /(?:^|\n)\s*Name\s*\n\s*([A-Z][A-Z\s]{3,40})/im,
        /(?:SURNAME|FAMILY\s*NAME|NOM)[:\s/]*\n?\s*([A-Z][A-Z\s]{2,25})/im,
        /(?:GIVEN\s*NAME|FIRST\s*NAME|PRENOM)[:\s/]*\n?\s*([A-Z][A-Z\s]{2,30})/im,
        /Name\s+([A-Z][A-Z\s]{3,40})/im
    ];

    // Try the generic "Name" label first (common on Myanmar passports)
    const nameMatch = text.match(namePatterns[0]) || text.match(namePatterns[3]);
    if (nameMatch) {
        const rawName = nameMatch[1].trim().replace(/\s{2,}/g, ' ');
        // Filter out things that look like labels, not names
        if (!/PASSPORT|REPUBLIC|MYANMAR|NATIONALITY|DATE|TYPE|CODE|COUNTRY/i.test(rawName)) {
            result.name = rawName.toUpperCase();
        }
    }

    // Try surname + given name separately if full name wasn't found
    if (!result.name) {
        const surnameMatch = text.match(namePatterns[1]);
        const givenMatch = text.match(namePatterns[2]);
        if (surnameMatch) result.surname = surnameMatch[1].trim().toUpperCase();
        if (givenMatch) result.givenNames = givenMatch[1].trim().toUpperCase();
        if (result.surname || result.givenNames) {
            result.name = [result.surname, result.givenNames].filter(Boolean).join(' ');
        }
    }

    // ---- Dates: smart extraction ----
    // Step 1: Find ALL dates in the text (DD MMM YYYY or DD/MM/YYYY)
    const allDates = [];
    const dateRegex = /(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{4})/gi;
    let dateMatch;
    while ((dateMatch = dateRegex.exec(text)) !== null) {
        const dd = dateMatch[1].padStart(2, '0');
        const mmm = dateMatch[2].toUpperCase().substring(0, 3);
        const yyyy = dateMatch[3];
        const mm = MONTH_MAP[mmm];
        if (mm) {
            allDates.push({
                display: `${mm}/${dd}/${yyyy}`,
                year: parseInt(yyyy, 10),
                raw: dateMatch[0],
                index: dateMatch.index
            });
        }
    }

    // Also find DD/MM/YYYY or DD-MM-YYYY dates
    const numericDateRegex = /(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/g;
    while ((dateMatch = numericDateRegex.exec(text)) !== null) {
        // Assume DD/MM/YYYY for passport context
        allDates.push({
            display: `${dateMatch[2]}/${dateMatch[1]}/${dateMatch[3]}`,
            year: parseInt(dateMatch[3], 10),
            raw: dateMatch[0],
            index: dateMatch.index
        });
    }

    console.log('[Passport OCR] All dates found:', allDates);

    // Step 2: Try label-based matching first (very flexible spacing)
    // DOB
    const dobLabelMatch = text.match(/(?:Date\s*of\s*birth|DOB|BORN|D\.?O\.?B)[\s\S]{0,30}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4})/i);
    if (dobLabelMatch) {
        result.dob = normaliseDateToMMDDYYYY(dobLabelMatch[1]);
    }

    // Expiry
    const expiryLabelMatch = text.match(/(?:Date\s*of\s*expiry|EXPIRY|EXPIRES?|VALID\s*(?:UNTIL|THRU)|EXP[\s.]*DATE?)[\s\S]{0,30}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4})/i);
    if (expiryLabelMatch) {
        result.expiry = normaliseDateToMMDDYYYY(expiryLabelMatch[1]);
    }

    // Step 3: Smart date assignment if labels didn't work
    if (allDates.length >= 2 && (!result.dob || !result.expiry)) {
        const now = new Date().getFullYear();

        // Sort by year
        const sorted = [...allDates].sort((a, b) => a.year - b.year);

        // DOB: the earliest date (usually born before 2015)
        if (!result.dob) {
            const dobCandidate = sorted.find(d => d.year < 2015);
            if (dobCandidate) result.dob = dobCandidate.display;
        }

        // Expiry: the latest date (usually in the future)
        if (!result.expiry) {
            const expiryCandidate = sorted.filter(d => d.year >= now).pop()
                                 || sorted[sorted.length - 1];
            // Make sure it's not the same as DOB
            if (expiryCandidate && expiryCandidate.display !== result.dob) {
                result.expiry = expiryCandidate.display;
            }
        }
    }

    // ---- Gender ----
    const sexMatch = text.match(/(?:Sex|Gender)\s*\n?\s*([MF])\b/i);
    if (sexMatch) {
        result.gender = sexMatch[1].toUpperCase() === 'F' ? 'MS' : 'MR';
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
