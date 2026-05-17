/**
 * @fileoverview Passport OCR — extract passport data from photos.
 *
 * Strategy: MRZ-first with Tesseract.js
 *   1. Crop the MRZ zone (bottom ~28% of image) with strong binarization
 *   2. Run a single Tesseract pass with MRZ-optimized settings
 *   3. Parse the two 44-char MRZ lines → name, DOB, sex, passport#, nationality, expiry
 *   4. If MRZ parsing fails, run one full-page fallback pass
 *
 * MRZ (Machine Readable Zone) is the ONLY reliable data source on passports.
 * It uses a standardised OCR-B font with a restricted character set (A-Z, 0-9, <)
 * and contains ALL fields we need in fixed positions.
 */


/* ------------------------------------------------------------------ */
/*  Tesseract OCR Settings                                             */
/* ------------------------------------------------------------------ */

const OCR_MRZ_PARAMS = {
    tessedit_pageseg_mode: '6',      // Single uniform block of text
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300'
};

const OCR_FULL_PARAMS = {
    tessedit_pageseg_mode: '3',      // Fully automatic page segmentation
    tessedit_char_whitelist: '',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300'
};

/* ------------------------------------------------------------------ */
/*  Image Processing                                                   */
/* ------------------------------------------------------------------ */

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

/**
 * Crop a region of an image and apply contrast enhancement.
 * @param {HTMLImageElement} img
 * @param {{ left: number, top: number, width: number, height: number }} crop - Fractions 0–1
 * @param {number} scale - Upscale factor for better OCR
 * @param {number|false} threshold - Binarization threshold (0-255). false = contrast boost only.
 */
function cropImage(img, crop, scale = 2.5, threshold = false) {
    const sx = Math.max(0, Math.floor(img.naturalWidth * crop.left));
    const sy = Math.max(0, Math.floor(img.naturalHeight * crop.top));
    const sw = Math.min(img.naturalWidth - sx, Math.floor(img.naturalWidth * crop.width));
    const sh = Math.min(img.naturalHeight - sy, Math.floor(img.naturalHeight * crop.height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(sw * scale));
    canvas.height = Math.max(1, Math.floor(sh * scale));

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
        let val;
        if (typeof threshold === 'number') {
            // Hard binarization — dark text becomes black, light background becomes white
            val = lum < threshold ? 0 : 255;
        } else {
            // Moderate contrast boost
            val = Math.max(0, Math.min(255, ((lum - 128) * 1.5) + 128));
        }
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
}

/* ------------------------------------------------------------------ */
/*  OCR Execution                                                      */
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
 *   sex: 'M'|'F'|'',
 *   gender: string,
 *   nationality: string,
 *   raw: string
 * } | null>}
 */
export async function ocrPassport(imageSource, onStatus) {
    onStatus?.('Initialising OCR…');

    if (!window.Tesseract) {
        console.warn('[Passport OCR] Tesseract.js is not loaded.');
        onStatus?.('OCR unavailable');
        return null;
    }

    try {
        let src = imageSource;
        if (imageSource instanceof Blob) {
            src = URL.createObjectURL(imageSource);
        }

        const img = await loadImage(src);
        const mrzRegion = { left: 0.0, top: 0.72, width: 1.0, height: 0.28 };

        const worker = await Tesseract.createWorker('eng', 1, {
            logger: (info) => {
                if (info.status === 'recognizing text') {
                    const pct = Math.round((info.progress || 0) * 100);
                    onStatus?.(`Scanning MRZ… ${pct}%`);
                }
            }
        });
        await worker.setParameters(OCR_MRZ_PARAMS);

        // Try multiple binarization thresholds — different passports have
        // different print darkness. Stop as soon as we get a valid MRZ parse.
        const thresholds = [160, 130, 100, false]; // false = contrast-only
        let result = null;

        for (const thresh of thresholds) {
            onStatus?.('Scanning passport MRZ…');
            const crop = cropImage(img, mrzRegion, 2.5, thresh);
            const { data } = await worker.recognize(crop);
            const text = data.text || '';
            console.log(`[Passport OCR] MRZ raw text (threshold=${thresh}):\n`, text);

            result = parseMRZ(text);
            if (result && result.passportNo && result.name) {
                console.log('[Passport OCR] MRZ parsed successfully at threshold:', thresh);
                break;
            }
            result = null; // reset for next attempt
        }

        // === PASS 2: Full page fallback (only if MRZ failed) ===
        if (!result || !result.passportNo) {
            console.log('[Passport OCR] MRZ parse failed, trying full page…');
            onStatus?.('Scanning full passport…');
            await worker.setParameters(OCR_FULL_PARAMS);
            const { data: fullData } = await worker.recognize(src);
            const fullText = fullData.text || '';
            console.log('[Passport OCR] Full page raw text:\n', fullText);

            // Try MRZ parsing on full text
            const fullResult = parseMRZ(fullText);
            if (fullResult && fullResult.passportNo) {
                result = fullResult;
            }

            // If still no result, try free-text parsing as last resort
            if (!result || !result.passportNo) {
                result = parseFreeText(fullText);
            }

            // Merge: if MRZ got partial data but free-text got the rest
            if (result && fullResult) {
                result = {
                    ...result,
                    name: result.name || fullResult.name || '',
                    passportNo: result.passportNo || fullResult.passportNo || '',
                    dob: result.dob || fullResult.dob || '',
                    expiry: result.expiry || fullResult.expiry || '',
                    sex: result.sex || fullResult.sex || '',
                    gender: result.gender || fullResult.gender || '',
                    nationality: result.nationality || fullResult.nationality || '',
                };
            }
        }

        await worker.terminate();

        if (imageSource instanceof Blob) {
            URL.revokeObjectURL(src);
        }

        if (result) {
            console.log('[Passport OCR] Final result:', result);
            onStatus?.('Passport data extracted ✓');
            return { ...result, _source: 'tesseract' };
        }

        onStatus?.('Could not parse passport data');
        return null;
    } catch (err) {
        console.error('[Passport OCR] Failed:', err);
        onStatus?.('OCR failed');
        return null;
    }
}

/* ------------------------------------------------------------------ */
/*  MRZ PARSING (ICAO 9303 TD3 — two lines of 44 characters)          */
/* ------------------------------------------------------------------ */

/**
 * Sanitise a line to contain only valid MRZ characters.
 * Fixes common OCR substitutions in OCR-B font.
 */
function sanitiseMrzLine(line) {
    return line
        .replace(/\s/g, '')
        .toUpperCase()
        .replace(/«/g, '<')
        .replace(/\u00AB/g, '<')
        .replace(/\u00BB/g, '<')
        .replace(/\u2039/g, '<')
        .replace(/\u203A/g, '<')
        .replace(/\|/g, '<')
        .replace(/\\/g, '<')
        .replace(/\{/g, '<')
        .replace(/\[/g, '<')
        .replace(/~/g, '<')
        .replace(/[^A-Z0-9<]/g, '');
}

/**
 * Fix common OCR letter→digit misreads for positions that should be digits.
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
        .replace(/[^0-9]/g, '');
}

/**
 * Reverse of fixOcrDigits: fix digit→letter misreads for positions that should be letters.
 * In MRZ line 1, the name section (positions 5–43) should ONLY contain A-Z and <.
 * Any digits there are OCR misreads.
 */
function fixOcrLetters(str) {
    return str
        .replace(/0/g, 'O')
        .replace(/1/g, 'I')
        .replace(/2/g, 'Z')
        .replace(/5/g, 'S')
        .replace(/8/g, 'B')
        .replace(/6/g, 'G')
        .replace(/7/g, 'T')
        .replace(/4/g, 'A')
        .replace(/3/g, 'E')
        .replace(/9/g, 'P');
}

/**
 * Pad or trim a line to exactly `len` characters.
 */
function padOrTrim(line, len) {
    if (line.length > len) return line.substring(0, len);
    return line.padEnd(len, '<');
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
 * Convert MRZ date (YYMMDD) to display format (MM/DD/YYYY).
 * @param {string} yymmdd - 6-char date string from MRZ
 * @param {boolean} isBirth - If true, dates in the future are assumed to be in the 1900s.
 */
function mrzDateToDisplay(yymmdd, isBirth) {
    if (!yymmdd || yymmdd.length < 6) return '';

    const digits = fixOcrDigits(yymmdd);
    if (digits.length < 6 || !/^\d{6}$/.test(digits)) return '';

    const yy = parseInt(digits.substring(0, 2), 10);
    const mm = digits.substring(2, 4);
    const dd = digits.substring(4, 6);

    const monthNum = parseInt(mm, 10);
    const dayNum = parseInt(dd, 10);
    if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return '';

    const currentYear = new Date().getFullYear() % 100;
    let yyyy;
    if (isBirth) {
        yyyy = yy > currentYear ? 1900 + yy : 2000 + yy;
    } else {
        yyyy = 2000 + yy;
    }

    return `${mm}/${dd}/${yyyy}`;
}

/**
 * Normalise passport number: first 2 chars are letters, rest are digits.
 */
function normalizePassportNumber(value = '') {
    const raw = String(value || '').replace(/</g, '').toUpperCase();
    if (raw.length <= 2) return raw;

    // First 2 chars: fix digit→letter misreads
    const prefix = raw.slice(0, 2)
        .replace(/0/g, 'O')
        .replace(/1/g, 'I')
        .replace(/5/g, 'S')
        .replace(/8/g, 'B');
    // Rest: fix letter→digit misreads
    const suffix = fixOcrDigits(raw.slice(2));
    return `${prefix}${suffix}`.replace(/[^A-Z0-9]/g, '');
}

/**
 * Normalise nationality to 3-letter ISO code.
 */
function normalizeNationality(value = '') {
    const raw = String(value || '').trim().toUpperCase().replace(/</g, '');
    if (!raw || raw === 'MM' || raw === 'NNR') return 'MMR';
    if (raw === 'MYANMAR' || raw === 'MMR') return 'MMR';
    // Fix common OCR misreads of MMR
    if (/^[MN][MN][RPN]$/.test(raw)) return 'MMR';
    // Fix check-digit bleeding into nationality (e.g., '4MM' or '0MM')
    if (/^\d[MN]{2}$/.test(raw) || /^[MN]{2}\d$/.test(raw)) return 'MMR';
    return raw.length <= 3 ? raw : 'MMR';
}

/**
 * Normalize MRZ filler characters in the name section.
 * Tesseract frequently misreads '<' (the MRZ filler/separator) as L, K, I, C.
 * This function propagates: if a L/K/I/C is adjacent to a '<', it's likely a misread '<'.
 * Runs multiple passes to propagate through chains of misread chars.
 */
function normalizeMrzFiller(namePart) {
    let result = namePart;
    const fillerLike = /[LKIC]/;

    // Replace trailing run of filler-like chars with <
    result = result.replace(/[LKIC<]+$/, m => '<'.repeat(m.length));

    // Propagate: any L/K/I/C adjacent to < on either side → <
    for (let pass = 0; pass < 8; pass++) {
        const prev = result;
        // L/K/I/C preceded by <
        result = result.replace(/<([LKIC])/g, '<<');
        // L/K/I/C followed by <
        result = result.replace(/([LKIC])</g, '<<');
        if (result === prev) break;
    }

    return result;
}

/**
 * Clean remaining filler noise from an extracted MRZ name string.
 * Strips trailing words composed entirely of filler-like characters (L,K,I,C),
 * and trims trailing filler chars from the last real word.
 */
function cleanMrzFillerFromName(name) {
    if (!name) return '';
    const words = name.trim().split(/\s+/).filter(Boolean);
    const fillerWord = /^[LKIC]+$/;
    const vowels = /[AEIOU]/;

    // Strip trailing words that are pure filler noise
    while (words.length > 1 && fillerWord.test(words[words.length - 1])) {
        words.pop();
    }

    // If last word ends with filler-like chars, trim them
    // but only if the word still has 2+ chars with a vowel after trimming
    if (words.length > 0) {
        const last = words[words.length - 1];
        const trimmed = last.replace(/[LKIC]+$/, '');
        if (trimmed.length >= 2 && vowels.test(trimmed)) {
            words[words.length - 1] = trimmed;
        }
    }

    return words.join(' ');
}

/**
 * Main MRZ parser. Finds two MRZ lines and extracts all fields.
 *
 * Line 1 format: P<ISONAME<<GIVENNAMES<<<<<<<<<<<<<<<<<<<<
 * Line 2 format: PASSPORTNO<CHECKISO DOBCHECK SEX EXPIRYCHECK OPTIONAL<<CHECKCHECK
 *
 * Myanmar format uses PV instead of P<.
 */
function parseMRZ(text) {
    const rawLines = String(text || '').split(/\n/);
    const lines = rawLines.map(l => sanitiseMrzLine(l));

    // Find candidate MRZ lines (38–50 chars, mostly MRZ characters)
    const candidates = lines.filter(l => l.length >= 38 && l.length <= 50);

    if (candidates.length < 2) {
        // Try combining adjacent short lines (OCR sometimes splits MRZ)
        for (let i = 0; i < lines.length - 1; i++) {
            if (lines[i].length >= 20 && lines[i + 1].length >= 15) {
                const combined = lines[i] + lines[i + 1];
                if (combined.length >= 38 && combined.length <= 50) {
                    candidates.push(combined);
                }
            }
        }
    }

    let line1 = null;
    let line2 = null;

    for (let i = 0; i < candidates.length; i++) {
        const l = candidates[i];
        // Line 1: starts with P, has < characters
        if (!line1 && l.charAt(0) === 'P' && countChar(l, '<') >= 3) {
            line1 = padOrTrim(l, 44);
            // Line 2: next candidate with digits (passport number + dates)
            for (let j = i + 1; j < candidates.length; j++) {
                const l2 = candidates[j];
                if (/[A-Z]/.test(l2.charAt(0)) && /\d{4,}/.test(l2)) {
                    line2 = padOrTrim(l2, 44);
                    break;
                }
            }
            break;
        }
    }

    // Also try to find line2 independently with regex (more resilient)
    if (!line2) {
        for (const l of candidates) {
            if (l.charAt(0) === 'P') continue; // skip line1 candidates
            // Line 2 pattern: starts with passport# (letter+digits), has nationality and dates
            if (/^[A-Z][A-Z0-9<]{7,8}[0-9A-Z<][A-Z<]{3}\d/.test(l)) {
                line2 = padOrTrim(l, 44);
                break;
            }
        }
    }

    console.log('[Passport OCR] MRZ Line 1:', line1);
    console.log('[Passport OCR] MRZ Line 2:', line2);

    // We can parse line2 independently even without line1
    let passportNo = '', nationality = '', dob = '', expiry = '', sex = '', gender = '';
    let surname = '', givenNames = '', fullName = '';

    // --- Parse Line 2 (numbers & dates — resilient to OCR shifts) ---
    if (line2) {
        // Tesseract sometimes inserts or misses a character (e.g. MH64L9431 instead of MH649431)
        // This shifts the fixed positions. Using a regex makes it resilient.
        // Pattern: [PassportNo (6-12)] + [Check (1)] + [Nationality (3)] + [DOB (6)] + [Check (1)] + [Sex (1)] + [Expiry (6)]
        const line2Pattern = /^([A-Z0-9<]{6,12})[\d<]([A-Z<]{3})([\dOIZSBGT]{6})[\d<]([MFX<])([\dOIZSBGT]{6})/;
        const match = line2.match(line2Pattern);

        if (match) {
            passportNo = normalizePassportNumber(match[1]);
            nationality = normalizeNationality(match[2]);
            dob = mrzDateToDisplay(fixOcrDigits(match[3]), true);
            const genderChar = match[4];
            sex = (genderChar === 'F' || genderChar === 'M') ? genderChar : '';
            gender = sex === 'F' ? 'MS' : (sex === 'M' ? 'MR' : '');
            expiry = mrzDateToDisplay(fixOcrDigits(match[5]), false);
        } else {
            // Fallback to strict positions if regex fails for some reason
            passportNo = normalizePassportNumber(line2.substring(0, 9));
            nationality = normalizeNationality(line2.substring(10, 13));
            dob = mrzDateToDisplay(fixOcrDigits(line2.substring(13, 19)), true);
            const genderChar = line2.charAt(20);
            sex = (genderChar === 'F' || genderChar === 'M') ? genderChar : '';
            gender = sex === 'F' ? 'MS' : (sex === 'M' ? 'MR' : '');
            expiry = mrzDateToDisplay(fixOcrDigits(line2.substring(21, 27)), false);
        }
    }

    // --- Parse Line 1 (name) ---
    if (line1) {
        const nameStart = 5; // After P + type + 3-char country code
        let namePart = line1.substring(nameStart);

        // Fix digits → letters in name section (name should ONLY have A-Z and <)
        namePart = namePart.replace(/[^<]/g, ch => /\d/.test(ch) ? fixOcrLetters(ch) : ch);

        // CRITICAL: Tesseract often misreads MRZ filler '<' as L, K, I, C.
        // Before parsing, normalize these back to '<' when they appear in filler zones.
        namePart = normalizeMrzFiller(namePart);

        const doubleChevronIdx = namePart.indexOf('<<');
        if (doubleChevronIdx > 0) {
            // Standard: SURNAME<<GIVENNAMES<<<
            surname = namePart.substring(0, doubleChevronIdx).replace(/</g, ' ').trim();
            const givenPart = namePart.substring(doubleChevronIdx + 2);
            givenNames = givenPart.replace(/<<+/g, ' ').replace(/</g, ' ').trim();
        } else {
            // Myanmar PV format: parts separated by single <, trailing <<<
            const trimmed = namePart.replace(/<{2,}$/g, '');
            const parts = trimmed.split('<').filter(Boolean);
            if (parts.length >= 2) {
                surname = parts[0];
                givenNames = parts.slice(1).join(' ');
            } else if (parts.length === 1) {
                surname = parts[0];
            }
        }

        // Clean any remaining filler noise from name words
        surname = cleanMrzFillerFromName(surname);
        givenNames = cleanMrzFillerFromName(givenNames);
        fullName = [surname, givenNames].filter(Boolean).join(' ');
    }

    // Validate we got something useful
    if (!fullName && !passportNo && !dob) return null;

    const result = {
        name: fullName,
        surname: surname || '',
        givenNames: givenNames || '',
        passportNo,
        dob,
        expiry,
        sex,
        gender,
        nationality,
        raw: text
    };

    console.log('[Passport OCR] MRZ parsed result:', JSON.stringify(result));
    return result;
}

/* ------------------------------------------------------------------ */
/*  FREE-TEXT FALLBACK (last resort if MRZ completely fails)           */
/* ------------------------------------------------------------------ */

const MONTH_MAP = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
};

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
    return '';
}

function parseFreeText(text) {
    const upper = String(text || '').toUpperCase();
    const result = {
        name: '',
        surname: '',
        givenNames: '',
        passportNo: '',
        dob: '',
        expiry: '',
        sex: '',
        gender: '',
        nationality: '',
        raw: text
    };

    // --- Passport number ---
    const ppMatch = upper.match(/\b(M[A-Z]\d{6})\b/)
        || upper.match(/(?:PASSPORT\s*(?:NO|NUMBER|#)[.:\s]*)([A-Z]{1,2}\d{6,8})\b/i);
    if (ppMatch) result.passportNo = ppMatch[1];

    // --- Name ---
    const nameMatch = upper.match(/(?:^|\n)\s*Name\s*\n\s*([A-Z][A-Z\s]{2,50}?)(?:\n|$)/m)
        || upper.match(/\bName\s{1,5}([A-Z][A-Z\s]{3,50}?)(?:\n|Nationality|Date|Sex|$)/m);
    if (nameMatch) {
        const rawName = nameMatch[1].trim().split(/\s{3,}/)[0].replace(/\s{2,}/g, ' ');
        if (!/PASSPORT|REPUBLIC|MYANMAR|NATIONALITY|DATE|TYPE|CODE|COUNTRY|AUTHORITY/i.test(rawName)) {
            result.name = rawName;
            const parts = rawName.split(/\s+/);
            if (parts.length >= 2) {
                result.surname = parts[0];
                result.givenNames = parts.slice(1).join(' ');
            }
        }
    }

    // --- Dates ---
    const dateRegex = /(\d{1,2})\s+([A-Z]{3,9})\.?\s*(\d{2,4})/gi;
    const dates = [];
    let m;
    while ((m = dateRegex.exec(upper)) !== null) {
        const dd = m[1].padStart(2, '0');
        const mm = MONTH_MAP[normaliseMonthToken(m[2])];
        if (!mm) continue;
        let yyyy = m[3];
        if (yyyy.length === 2) {
            const yy = parseInt(yyyy, 10);
            const cur = new Date().getFullYear() % 100;
            yyyy = String(yy > cur ? 1900 + yy : 2000 + yy);
        }
        dates.push({ display: `${mm}/${dd}/${yyyy}`, year: parseInt(yyyy), raw: m[0], index: m.index });
    }

    // DOB: labeled or earliest date
    const dobLabel = upper.match(/Date\s*of\s*birth/i);
    if (dobLabel) {
        const after = upper.slice(dobLabel.index, dobLabel.index + 200);
        const dobMatch = after.match(/(\d{1,2})\s+([A-Z]{3,9})\.?\s*(\d{2,4})/i);
        if (dobMatch) {
            const dd = dobMatch[1].padStart(2, '0');
            const mm = MONTH_MAP[normaliseMonthToken(dobMatch[2])];
            let yyyy = dobMatch[3];
            if (yyyy.length === 2) {
                const yy = parseInt(yyyy, 10);
                const cur = new Date().getFullYear() % 100;
                yyyy = String(yy > cur ? 1900 + yy : 2000 + yy);
            }
            if (mm) result.dob = `${mm}/${dd}/${yyyy}`;
        }
    }
    if (!result.dob && dates.length) {
        const sorted = [...dates].sort((a, b) => a.year - b.year);
        result.dob = sorted[0].display;
    }

    // Expiry: labeled or latest future date
    const expLabel = upper.match(/Date\s*of\s*expir/i);
    if (expLabel) {
        const after = upper.slice(expLabel.index, expLabel.index + 200);
        const expMatch = after.match(/(\d{1,2})\s+([A-Z]{3,9})\.?\s*(\d{2,4})/i);
        if (expMatch) {
            const dd = expMatch[1].padStart(2, '0');
            const mm = MONTH_MAP[normaliseMonthToken(expMatch[2])];
            let yyyy = expMatch[3];
            if (yyyy.length === 2) yyyy = '20' + yyyy;
            if (mm) result.expiry = `${mm}/${dd}/${yyyy}`;
        }
    }
    if (!result.expiry && dates.length) {
        const now = new Date().getFullYear();
        const future = dates.filter(d => d.year >= now && d.display !== result.dob);
        if (future.length) result.expiry = future[future.length - 1].display;
    }

    // --- Sex ---
    const sexMatch = upper.match(/\bSex\s*\n\s*([MF])\b/i)
        || upper.match(/\bSex\s+([MF])\b/i);
    if (sexMatch) {
        result.sex = sexMatch[1].toUpperCase();
        result.gender = result.sex === 'F' ? 'MS' : 'MR';
    }

    // --- Nationality ---
    const natMatch = upper.match(/Nationality\s*\n?\s*([A-Z]{3,15})/i);
    if (natMatch) {
        const nat = natMatch[1].toUpperCase();
        result.nationality = nat === 'MYANMAR' ? 'MMR' : (nat.length <= 3 ? nat : 'MMR');
    }

    return (result.name || result.passportNo) ? result : null;
}
