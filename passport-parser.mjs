const TD3_LINE_LENGTH = 44;
const MYANMAR_PASSPORT_RE = /^[A-Z]{2}[0-9]{6}$/;

const NUMERIC_CORRECTIONS = {
    O: '0',
    Q: '0',
    D: '0',
    I: '1',
    L: '1',
    Z: '2',
    S: '5',
    B: '8',
    G: '6',
    T: '7'
};

const LETTER_CORRECTIONS = {
    0: 'O',
    1: 'I',
    5: 'S',
    8: 'B'
};

const MONTHS = {
    JAN: '01',
    FEB: '02',
    MAR: '03',
    APR: '04',
    MAY: '05',
    JUN: '06',
    JUL: '07',
    AUG: '08',
    SEP: '09',
    SEPT: '09',
    OCT: '10',
    NOV: '11',
    DEC: '12'
};

const NAME_LABEL_RE = /\b(PASSPORT|REPUBLIC|UNION|MYANMAR|NATIONALITY|DATE|BIRTH|EXPIRY|EXPIRE|SEX|PLACE|AUTHORITY|HOLDER|SIGNATURE|COUNTRY|CODE|TYPE)\b/;

function emptySources() {
    return {
        fullName: 'empty',
        passportNo: 'empty',
        nationality: 'empty',
        dob: 'empty',
        expiry: 'empty',
        sex: 'empty',
        title: 'empty'
    };
}

function emptyValidations() {
    return {
        passportValid: false,
        dobValid: false,
        expiryValid: false,
        mrzStructureValid: false
    };
}

export function createEmptyPassportResult(warnings = []) {
    return {
        fullName: '',
        passportNo: '',
        nationality: '',
        dob: '',
        expiry: '',
        sex: '',
        title: '',
        source: emptySources(),
        validations: emptyValidations(),
        warnings: [...warnings]
    };
}

function uniqueWarnings(warnings) {
    return [...new Set(warnings.filter(Boolean))];
}

function correctNumeric(str) {
    return String(str || '').replace(/[OQDILZSBGT]/g, char => NUMERIC_CORRECTIONS[char] || char);
}

function correctLetter(str) {
    return String(str || '').replace(/[0158]/g, char => LETTER_CORRECTIONS[char] || char);
}

export function calculateCheckDigit(str) {
    if (!str || str.length === 0) return null;
    const weights = [7, 3, 1];
    let sum = 0;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        let val;
        if (char >= '0' && char <= '9') val = char.charCodeAt(0) - 48;
        else if (char >= 'A' && char <= 'Z') val = char.charCodeAt(0) - 55;
        else if (char === '<') val = 0;
        else return null;
        sum += val * weights[i % 3];
    }

    return String(sum % 10);
}

function compactMrzText(line) {
    return String(line || '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/[«»‹›]/g, '<')
        .replace(/[|\\/\[\]{}()~_*.,;:'"`^=+-]/g, '<')
        .replace(/[^A-Z0-9<]/g, '<');
}

export function normalizeMrzLine(line) {
    return compactMrzText(line).padEnd(TD3_LINE_LENGTH, '<').slice(0, TD3_LINE_LENGTH);
}

function hammingDistance(a, b) {
    if (a.length !== b.length) return Infinity;
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) distance++;
    }
    return distance;
}

export function normalizeNationality(candidate, allowRepair = true) {
    const raw = correctLetter(String(candidate || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).slice(0, 3);
    if (raw === 'MMR') return 'MMR';
    if (!allowRepair || raw.length !== 3) return '';
    if (raw === 'MMN') return 'MMR';
    return hammingDistance(raw, 'MMR') <= 1 ? 'MMR' : '';
}

export function validatePassportNo(passportNo) {
    return MYANMAR_PASSPORT_RE.test(String(passportNo || '').toUpperCase());
}

function repairPassportField(rawField) {
    const field = normalizeMrzLine(rawField).slice(0, 9).split('');
    field[0] = correctLetter(field[0]);
    field[1] = correctLetter(field[1]);

    for (let i = 2; i <= 7; i++) {
        field[i] = correctNumeric(field[i]);
    }

    field[8] = '<';
    return field.join('');
}

function formatDate(mm, dd, yyyy) {
    const month = Number(mm);
    const day = Number(dd);
    const year = Number(yyyy);
    if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return '';
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2099) return '';

    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
}

export function formatMrzDate(yymmdd, isBirth, referenceDate = new Date()) {
    const digits = correctNumeric(yymmdd);
    if (!/^[0-9]{6}$/.test(digits)) return '';

    const yy = Number(digits.slice(0, 2));
    const mm = digits.slice(2, 4);
    const dd = digits.slice(4, 6);
    const currentYY = referenceDate.getFullYear() % 100;
    const yyyy = isBirth && yy > currentYY ? 1900 + yy : 2000 + yy;

    return formatDate(mm, dd, yyyy);
}

export function formatVisualDate(str) {
    const text = String(str || '').toUpperCase();
    const match = text.match(/\b([0-9]{1,2})\s*([A-Z]{3,9})\.?\s*([0-9]{2,4})\b/);
    if (!match) return '';

    const day = match[1];
    const month = MONTHS[match[2]] || MONTHS[match[2].slice(0, 3)];
    if (!month) return '';

    let year = match[3];
    if (year.length === 2) year = Number(year) > 40 ? `19${year}` : `20${year}`;
    return formatDate(month, day, year);
}

function isValidMrzDate(yymmdd, isBirth, referenceDate) {
    return Boolean(formatMrzDate(yymmdd, isBirth, referenceDate));
}

export function calculateAge(dobStr, referenceDate = new Date()) {
    const parts = String(dobStr || '').split('/');
    if (parts.length !== 3) return null;

    const month = Number(parts[0]);
    const day = Number(parts[1]);
    const year = Number(parts[2]);
    const dob = new Date(year, month - 1, day);
    if (Number.isNaN(dob.getTime())) return null;

    let age = referenceDate.getFullYear() - dob.getFullYear();
    const monthDelta = referenceDate.getMonth() - dob.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && referenceDate.getDate() < dob.getDate())) age--;
    return age;
}

export function inferTitle(sex, age) {
    if (sex === 'M') return age !== null && age < 12 ? 'MSTR' : 'MR';
    if (sex === 'F') return age !== null && age < 12 ? 'MISS' : 'MS';
    return '';
}

function hasRepeatedSameChar(word) {
    return /(.)\1{4,}/.test(word);
}

function hasFillerNoise(text) {
    const compact = String(text || '').replace(/\s+/g, '');
    if (/[CLK]{5,}/.test(compact)) return true;
    if (/\b[CLK]{3,}\b/.test(text)) return true;
    if (/\b(?:C|L|K|CL|LC|CC|LL|KL|LK)(?:\s+(?:C|L|K|CL|LC|CC|LL|KL|LK))+\b/.test(text)) return true;
    return false;
}

export function cleanNameCandidate(rawName) {
    const raw = String(rawName || '').toUpperCase().replace(/<+$/g, '').replace(/</g, ' ');
    let name = raw
        .replace(/[^A-Z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(MR|MS|MISS|MSTR)\s+/, '');

    if (!name || NAME_LABEL_RE.test(name)) return '';
    if (hasFillerNoise(name)) return '';
    if (name.length > 40) return '';
    if (/[0-9]/.test(name)) return '';

    const words = name.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 5) return '';

    for (const word of words) {
        if (!/^[A-Z]{1,20}$/.test(word)) return '';
        if (hasRepeatedSameChar(word)) return '';
    }

    return words.join(' ');
}

function looksLikeLine1(candidate) {
    const line = candidate.normalized;
    return candidate.raw.length >= 30
        && line[0] === 'P'
        && (line[1] === 'V' || line[1] === '<')
        && normalizeNationality(line.slice(2, 5)) === 'MMR';
}

function looksLikeLine2(candidate) {
    const line = candidate.normalized;
    const dob = correctNumeric(line.slice(13, 19));
    const expiry = correctNumeric(line.slice(21, 27));
    return candidate.raw.length >= 30
        && normalizeNationality(line.slice(10, 13)) === 'MMR'
        && /^[0-9]{6}$/.test(dob)
        && /^[0-9]{6}$/.test(expiry)
        && /^[MF<]$/.test(line.slice(20, 21));
}

function extractMrzCandidates(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line, index) => {
            const raw = compactMrzText(line);
            return { index, raw, normalized: normalizeMrzLine(raw) };
        })
        .filter(candidate => candidate.raw.length >= 20);
}

function parseTd3Lines(line1Input, line2Input, referenceDate) {
    const result = createEmptyPassportResult();
    const line1 = normalizeMrzLine(line1Input);
    const line2 = normalizeMrzLine(line2Input);
    const issuingCountry = normalizeNationality(line1.slice(2, 5));
    const nationality = normalizeNationality(line2.slice(10, 13));
    const dobRaw = correctNumeric(line2.slice(13, 19));
    const expiryRaw = correctNumeric(line2.slice(21, 27));
    const sex = line2.slice(20, 21);

    const structureValid = line1[0] === 'P'
        && (line1[1] === 'V' || line1[1] === '<')
        && issuingCountry === 'MMR'
        && nationality === 'MMR'
        && /^[0-9]{6}$/.test(dobRaw)
        && /^[MF]$/.test(sex)
        && /^[0-9]{6}$/.test(expiryRaw)
        && isValidMrzDate(dobRaw, true, referenceDate)
        && isValidMrzDate(expiryRaw, false, referenceDate);

    if (!structureValid) {
        result.warnings.push('MRZ structure invalid');
        return result;
    }

    result.validations.mrzStructureValid = true;
    result.nationality = 'MMR';
    result.source.nationality = 'mrz';

    const name = cleanNameCandidate(line1.slice(5, TD3_LINE_LENGTH));
    if (name) {
        result.fullName = name;
        result.source.fullName = 'mrz';
    } else {
        result.warnings.push('MRZ name rejected');
    }

    const passportField = repairPassportField(line2.slice(0, 9));
    const passportNo = passportField.slice(0, 8);
    const passportCheck = correctNumeric(line2.slice(9, 10));
    const passportValid = validatePassportNo(passportNo) && calculateCheckDigit(passportField) === passportCheck;
    result.validations.passportValid = passportValid;
    if (passportValid) {
        result.passportNo = passportNo;
        result.source.passportNo = 'mrz';
    } else {
        result.warnings.push('MRZ passport number rejected');
    }

    const dobCheck = correctNumeric(line2.slice(19, 20));
    const dobValid = calculateCheckDigit(dobRaw) === dobCheck && isValidMrzDate(dobRaw, true, referenceDate);
    result.validations.dobValid = dobValid;
    if (dobValid) {
        result.dob = formatMrzDate(dobRaw, true, referenceDate);
        result.source.dob = 'mrz';
    } else {
        result.warnings.push('MRZ DOB check digit failed');
    }

    const expiryCheck = correctNumeric(line2.slice(27, 28));
    const expiryValid = calculateCheckDigit(expiryRaw) === expiryCheck && isValidMrzDate(expiryRaw, false, referenceDate);
    result.validations.expiryValid = expiryValid;
    if (expiryValid) {
        result.expiry = formatMrzDate(expiryRaw, false, referenceDate);
        result.source.expiry = 'mrz';
    } else {
        result.warnings.push('MRZ expiry check digit failed');
    }

    result.sex = sex;
    result.source.sex = 'mrz';

    return result;
}

function scoreResult(result) {
    return [
        result.validations.mrzStructureValid ? 10 : 0,
        result.fullName ? 2 : 0,
        result.passportNo ? 2 : 0,
        result.dob ? 2 : 0,
        result.expiry ? 2 : 0,
        result.sex ? 1 : 0
    ].reduce((sum, value) => sum + value, 0);
}

export function parseStrictMrz(text, options = {}) {
    const referenceDate = options.referenceDate || new Date();
    const candidates = extractMrzCandidates(text);
    const line1Candidates = candidates.filter(looksLikeLine1);
    const line2Candidates = candidates.filter(looksLikeLine2);
    let best = createEmptyPassportResult();

    for (const line1 of line1Candidates) {
        for (const line2 of line2Candidates) {
            const parsed = parseTd3Lines(line1.normalized, line2.normalized, referenceDate);
            if (!parsed.validations.mrzStructureValid) continue;

            const orderedBonus = line2.index >= line1.index ? 1 : 0;
            if (scoreResult(parsed) + orderedBonus > scoreResult(best)) {
                best = parsed;
            }
        }
    }

    best.warnings = uniqueWarnings(best.warnings);
    return best;
}

function textHasMyanmarEvidence(text) {
    return /\b(REPUBLIC\s+OF\s+THE\s+UNION\s+OF\s+MYANMAR|MYANMAR|MMR)\b/i.test(String(text || ''));
}

function segmentAfterLabel(text, labelRe, stopRe, maxLen = 140) {
    const match = text.match(labelRe);
    if (!match) return '';

    let segment = text.slice(match.index + match[0].length, match.index + match[0].length + maxLen);
    const stop = segment.search(stopRe);
    if (stop >= 0) segment = segment.slice(0, stop);
    return segment;
}

function extractVisualName(upperText) {
    const segment = segmentAfterLabel(
        upperText,
        /\bNAME\b(?!\s*OF)\s*[:\-]*/i,
        /\b(NATIONALITY|DATE\s+OF\s+BIRTH|SEX|PLACE\s+OF\s+BIRTH|PASSPORT\s+NO|COUNTRY\s+CODE|TYPE)\b/i,
        120
    );
    if (!segment) return '';

    const normalizedSegment = segment.replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const direct = cleanNameCandidate(normalizedSegment);
    if (direct) return direct;

    const lines = segment
        .split(/\r?\n/)
        .map(line => cleanNameCandidate(line))
        .filter(Boolean);

    return lines[0] || '';
}

function extractVisualDate(upperText, labelRe) {
    const segment = segmentAfterLabel(
        upperText,
        labelRe,
        /\b(DATE\s+OF\s+(?:ISSUE|EXPIRY|BIRTH)|SEX|PLACE\s+OF\s+BIRTH|AUTHORITY|HOLDER|NATIONALITY|NAME)\b/i,
        120
    );
    return formatVisualDate(segment);
}

function extractVisualSex(upperText) {
    const segment = segmentAfterLabel(
        upperText,
        /\bSEX\b\s*[:\-]*/i,
        /\b(DATE\s+OF\s+ISSUE|DATE\s+OF\s+EXPIRY|PLACE\s+OF\s+BIRTH|AUTHORITY|HOLDER)\b/i,
        60
    );
    const match = segment.match(/\b([MF])\b/);
    return match ? match[1] : '';
}

function extractVisualPassportNo(upperText) {
    const labelSegment = segmentAfterLabel(
        upperText,
        /\bPASSPORT\s*(?:NO|NUMBER|#)?\b\s*[:\-]*/i,
        /\b(NAME|NATIONALITY|DATE|SEX|PLACE|AUTHORITY)\b/i,
        80
    );

    const labeledMatch = labelSegment.match(/\b([A-Z]{2}[0-9]{6})\b/);
    if (labeledMatch && validatePassportNo(labeledMatch[1])) return labeledMatch[1];

    const genericMatch = upperText.match(/\b([A-Z]{2}[0-9]{6})\b/);
    if (genericMatch && validatePassportNo(genericMatch[1])) return genericMatch[1];

    return '';
}

export function parseVisualFallback(text, options = {}) {
    const result = createEmptyPassportResult();
    const upperText = String(text || '').toUpperCase();
    const referenceDate = options.referenceDate || new Date();

    const fullName = extractVisualName(upperText);
    if (fullName) {
        result.fullName = fullName;
        result.source.fullName = 'visual';
    }

    const passportNo = extractVisualPassportNo(upperText);
    if (passportNo) {
        result.passportNo = passportNo;
        result.source.passportNo = 'visual';
        result.validations.passportValid = true;
    }

    if (normalizeNationality(upperText.match(/\bM[A-Z0-9]{2}\b/)?.[0] || '') === 'MMR' || textHasMyanmarEvidence(upperText)) {
        result.nationality = 'MMR';
        result.source.nationality = 'visual';
    }

    const dob = extractVisualDate(upperText, /\bDATE\s+OF\s+BIRTH\b\s*[:\-]*/i);
    if (dob) {
        result.dob = dob;
        result.source.dob = 'visual';
        result.validations.dobValid = true;
    }

    const expiry = extractVisualDate(upperText, /\bDATE\s+OF\s+EXPIR(?:Y|E)?\b\s*[:\-]*/i);
    if (expiry) {
        result.expiry = expiry;
        result.source.expiry = 'visual';
        result.validations.expiryValid = true;
    }

    const sex = extractVisualSex(upperText);
    if (sex) {
        result.sex = sex;
        result.source.sex = 'visual';
    }

    if (result.sex && result.dob) {
        result.title = inferTitle(result.sex, calculateAge(result.dob, referenceDate));
        result.source.title = result.title ? 'inferred' : 'empty';
    }

    return result;
}

function fillFromPriority(result, field, primary, fallback) {
    if (primary[field]) {
        result[field] = primary[field];
        result.source[field] = primary.source[field];
        return;
    }

    if (fallback[field]) {
        result[field] = fallback[field];
        result.source[field] = fallback.source[field];
    }
}

export function mergePassportOcr({ mrzText = '', visualText = '', warnings = [], referenceDate = new Date() } = {}) {
    const mrz = parseStrictMrz(mrzText, { referenceDate });
    const visual = parseVisualFallback(visualText, { referenceDate });
    const result = createEmptyPassportResult([...warnings, ...mrz.warnings, ...visual.warnings]);

    fillFromPriority(result, 'fullName', mrz, visual);
    fillFromPriority(result, 'passportNo', mrz, visual);
    fillFromPriority(result, 'dob', mrz, visual);
    fillFromPriority(result, 'expiry', mrz, visual);
    fillFromPriority(result, 'sex', mrz, visual);

    if (mrz.nationality === 'MMR') {
        result.nationality = 'MMR';
        result.source.nationality = 'mrz';
    } else if (visual.nationality === 'MMR') {
        result.nationality = 'MMR';
        result.source.nationality = 'visual';
    } else if (result.fullName || result.passportNo || result.dob || result.expiry || result.sex || textHasMyanmarEvidence(`${mrzText}\n${visualText}`)) {
        result.nationality = 'MMR';
        result.source.nationality = 'defaultMMR';
    }

    result.validations.mrzStructureValid = mrz.validations.mrzStructureValid;
    result.validations.passportValid = result.passportNo ? validatePassportNo(result.passportNo) : false;
    result.validations.dobValid = Boolean(result.dob);
    result.validations.expiryValid = Boolean(result.expiry);

    if (result.sex && result.dob) {
        result.title = inferTitle(result.sex, calculateAge(result.dob, referenceDate));
        result.source.title = result.title ? 'inferred' : 'empty';
    }

    result.warnings = uniqueWarnings(result.warnings);
    return {
        ...result,
        name: result.fullName,
        gender: result.title
    };
}
