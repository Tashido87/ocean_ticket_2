/**
 * @fileoverview Passport OCR — extract passport data from photos.
 * Strategy: MRZ-first with Tesseract.js
 */

const OCR_MRZ_PARAMS = {
    tessedit_pageseg_mode: '6', // uniform block of text
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300'
};

const OCR_FULL_PARAMS = {
    tessedit_pageseg_mode: '3',
    tessedit_char_whitelist: '',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300'
};

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function cropImage(img, crop, scale = 4, threshold = false) {
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
            val = lum < threshold ? 0 : 255;
        } else {
            val = Math.max(0, Math.min(255, ((lum - 128) * 1.5) + 128));
        }
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
    }
    ctx.putImageData(imageData, 0, 0);

    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

function calculateCheckDigit(str) {
    if (!str || str.length === 0) return null;
    const weights = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        let val = 0;
        if (char >= '0' && char <= '9') val = char.charCodeAt(0) - 48;
        else if (char >= 'A' && char <= 'Z') val = char.charCodeAt(0) - 55;
        else if (char === '<') val = 0;
        else return null;
        sum += val * weights[i % 3];
    }
    return String(sum % 10);
}

const NUMERIC_CORRECTIONS = { 'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8' };
const LETTER_CORRECTIONS = { '0': 'O', '1': 'I', '5': 'S', '8': 'B' };

function correctNumeric(str) {
    if (!str) return str;
    return str.replace(/[OQDILZSB]/g, m => NUMERIC_CORRECTIONS[m]);
}

function correctLetter(str) {
    if (!str) return str;
    return str.replace(/[0158]/g, m => LETTER_CORRECTIONS[m]);
}

function parseMRZLine(line) {
    if (!line) return '';
    let normalized = line.toUpperCase()
        .replace(/\s+/g, '')
        .replace(/«/g, '<')
        .replace(/[^A-Z0-9<]/g, '<');
    return normalized.padEnd(44, '<').substring(0, 44);
}

function formatMrzDate(yymmdd, isBirth) {
    if (!yymmdd || yymmdd.length !== 6) return '';
    const digits = correctNumeric(yymmdd);
    if (!/^\d{6}$/.test(digits)) return '';
    
    const yy = parseInt(digits.substring(0, 2), 10);
    const mm = digits.substring(2, 4);
    const dd = digits.substring(4, 6);
    
    const currentYY = new Date().getFullYear() % 100;
    let yyyy;
    if (isBirth) {
        yyyy = yy > currentYY ? 1900 + yy : 2000 + yy;
    } else {
        yyyy = 2000 + yy;
    }
    return `${mm}/${dd}/${yyyy}`;
}

function formatVisualDate(str) {
    const MONTH_MAP = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    const match = str.toUpperCase().match(/(\d{1,2})\s*([A-Z]{3})\s*(\d{4})/);
    if (!match) return '';
    const dd = match[1].padStart(2, '0');
    const mm = MONTH_MAP[match[2]];
    const yyyy = match[3];
    if (mm) return `${mm}/${dd}/${yyyy}`;
    return '';
}

function calculateAge(dobStr) {
    if (!dobStr) return null;
    const parts = dobStr.split('/');
    if (parts.length !== 3) return null;
    const dob = new Date(parseInt(parts[2], 10), parseInt(parts[0], 10) - 1, parseInt(parts[1], 10));
    if (isNaN(dob.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    return age;
}

function inferTitle(sex, age) {
    if (!sex) return '';
    if (sex === 'M') return (age !== null && age < 12) ? 'MSTR' : 'MR';
    if (sex === 'F') return (age !== null && age < 12) ? 'MISS' : 'MS';
    return '';
}

function solvePassportNumber(rawPassport, expectedCheckDigit) {
    let candidates = [rawPassport];
    const mappings = [
        { from: 'L', to: '4' },
        { from: 'O', to: '0' },
        { from: 'I', to: '1' },
        { from: 'Z', to: '2' },
        { from: 'S', to: '5' },
        { from: 'B', to: '8' }
    ];
    
    if (calculateCheckDigit(rawPassport) === expectedCheckDigit) return rawPassport;
    
    for (let i = 0; i < rawPassport.length; i++) {
        const char = rawPassport[i];
        for (const map of mappings) {
            if (char === map.from) {
                const candidate = rawPassport.substring(0, i) + map.to + rawPassport.substring(i + 1);
                if (calculateCheckDigit(candidate) === expectedCheckDigit) return candidate;
                candidates.push(candidate);
            }
        }
    }
    return rawPassport; 
}

function parseMRZ(text) {
    const rawLines = String(text || '').split(/\n/).map(l => l.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '<'));
    
    let line1 = null;
    let line2 = null;

    for (let i = 0; i < rawLines.length; i++) {
        const l = rawLines[i];
        if (!line1 && l.startsWith('P') && l.length >= 30) {
            line1 = parseMRZLine(l);
            for (let j = i + 1; j < rawLines.length; j++) {
                const l2 = rawLines[j];
                if (/[A-Z0-9<]{30,}/.test(l2)) {
                    line2 = parseMRZLine(l2);
                    break;
                }
            }
            break;
        }
    }
    
    if (!line2) {
        for (const l of rawLines) {
            if (l.startsWith('P')) continue;
            if (/^[A-Z0-9<]{9}[\d<][A-Z<]{3}[\dOIZSBGT<]{6}[\d<][MFX<][\dOIZSBGT<]{6}/.test(l)) {
                line2 = parseMRZLine(l);
                break;
            }
        }
    }

    console.log('[Passport OCR] MRZ Line 1:', line1, line1 ? line1.length : 0);
    console.log('[Passport OCR] MRZ Line 2:', line2, line2 ? line2.length : 0);

    const result = {
        fullName: '',
        passportNo: '',
        nationality: '',
        dob: '',
        expiry: '',
        sex: '',
        title: '',
        source: {
            fullName: 'empty',
            passportNo: 'empty',
            dob: 'empty',
            expiry: 'empty',
            sex: 'empty'
        },
        validations: {
            passportValid: false,
            dobValid: false,
            expiryValid: false
        },
        warnings: []
    };

    if (line1 && line1.length === 44) {
        let nameRaw = line1.substring(5, 44);
        nameRaw = nameRaw.replace(/<+$/, ''); 
        const fullName = nameRaw.replace(/<+/g, ' ').trim();
        if (fullName) {
            result.fullName = fullName;
            result.source.fullName = 'mrz';
        }
    }

    if (line2 && line2.length === 44) {
        const pNoRaw = line2.substring(0, 9);
        const pCheck = correctNumeric(line2.substring(9, 10));
        const nat = correctLetter(line2.substring(10, 13).replace(/<+/g, ''));
        const dobRaw = line2.substring(13, 19);
        const dobCheck = correctNumeric(line2.substring(19, 20));
        const sexRaw = line2.substring(20, 21);
        const expRaw = line2.substring(21, 27);
        const expCheck = correctNumeric(line2.substring(27, 28));

        const solvedPassport = solvePassportNumber(pNoRaw, pCheck);
        result.passportNo = solvedPassport.replace(/<+$/, '');
        if (result.passportNo) {
            result.source.passportNo = 'mrz';
            result.validations.passportValid = calculateCheckDigit(solvedPassport) === pCheck;
            if (!result.validations.passportValid) result.warnings.push('MRZ Passport check digit failed');
        }

        if (nat) {
            result.nationality = nat;
        }

        const solvedDob = correctNumeric(dobRaw);
        if (calculateCheckDigit(solvedDob) === dobCheck) {
            result.dob = formatMrzDate(solvedDob, true);
            result.source.dob = 'mrz';
            result.validations.dobValid = true;
        } else {
            const formatted = formatMrzDate(solvedDob, true);
            if (formatted) {
                result.dob = formatted;
                result.source.dob = 'mrz';
            }
            result.warnings.push('MRZ DOB check digit failed');
        }

        const solvedExp = correctNumeric(expRaw);
        if (calculateCheckDigit(solvedExp) === expCheck) {
            result.expiry = formatMrzDate(solvedExp, false);
            result.source.expiry = 'mrz';
            result.validations.expiryValid = true;
        } else {
            const formatted = formatMrzDate(solvedExp, false);
            if (formatted) {
                result.expiry = formatted;
                result.source.expiry = 'mrz';
            }
            result.warnings.push('MRZ Expiry check digit failed');
        }

        if (sexRaw === 'M' || sexRaw === 'F') {
            result.sex = sexRaw;
            result.source.sex = 'mrz';
        }
    }

    return result;
}

function parseVisual(text, currentResult) {
    const upper = String(text || '').toUpperCase();
    
    if (currentResult.source.fullName === 'empty') {
        const nameMatch = upper.match(/\bNAME\s*\n\s*([A-Z][A-Z\s]{2,50}?)(?:\n|$)/m)
            || upper.match(/\bNAME\s{1,5}([A-Z][A-Z\s]{3,50}?)(?:\n|NATIONALITY|DATE|SEX|$)/m);
        if (nameMatch) {
            const rawName = nameMatch[1].trim().split(/\s{3,}/)[0].replace(/\s{2,}/g, ' ');
            if (!/PASSPORT|REPUBLIC|MYANMAR|NATIONALITY/i.test(rawName)) {
                currentResult.fullName = rawName;
                currentResult.source.fullName = 'visual';
            }
        }
    }

    if (currentResult.source.sex === 'empty') {
        const sexMatch = upper.match(/\bSEX\s*\n\s*([MF])\b/i) || upper.match(/\bSEX\s+([MF])\b/i);
        if (sexMatch) {
            currentResult.sex = sexMatch[1];
            currentResult.source.sex = 'visual';
        }
    }

    if (currentResult.source.dob === 'empty') {
        const dobLabel = upper.match(/DATE\s*OF\s*BIRTH/i);
        if (dobLabel) {
            const after = upper.slice(dobLabel.index, dobLabel.index + 100);
            const dobMatch = after.match(/(\d{1,2})\s+([A-Z]{3,9})\.?\s*(\d{2,4})/i);
            if (dobMatch) {
                const formatted = formatVisualDate(dobMatch[0]);
                if (formatted) {
                    currentResult.dob = formatted;
                    currentResult.source.dob = 'visual';
                }
            }
        }
    }

    if (currentResult.source.expiry === 'empty') {
        const expLabel = upper.match(/DATE\s*OF\s*EXPIR/i);
        if (expLabel) {
            const after = upper.slice(expLabel.index, expLabel.index + 100);
            const expMatch = after.match(/(\d{1,2})\s+([A-Z]{3,9})\.?\s*(\d{2,4})/i);
            if (expMatch) {
                const formatted = formatVisualDate(expMatch[0]);
                if (formatted) {
                    currentResult.expiry = formatted;
                    currentResult.source.expiry = 'visual';
                }
            }
        }
    }

    if (currentResult.source.passportNo === 'empty') {
        const ppMatch = upper.match(/\b(M[A-Z]\d{6})\b/)
            || upper.match(/(?:PASSPORT\s*(?:NO|NUMBER|#)[.:\s]*)([A-Z]{1,2}\d{6,8})\b/i);
        if (ppMatch) {
            currentResult.passportNo = ppMatch[1];
            currentResult.source.passportNo = 'visual';
        }
    }

    return currentResult;
}

export async function ocrPassport(imageSource, onStatus) {
    onStatus?.('Initialising OCR…');
    if (!window.Tesseract) {
        onStatus?.('OCR unavailable');
        return null;
    }
    try {
        let src = imageSource;
        if (imageSource instanceof Blob) src = URL.createObjectURL(imageSource);
        
        const img = await loadImage(src);
        console.log(`[Passport OCR] Original image size: ${img.naturalWidth}x${img.naturalHeight}`);
        
        const mrzRegion = { left: 0.0, top: 0.65, width: 1.0, height: 0.35 };
        const worker = await Tesseract.createWorker('eng', 1, {
            logger: (info) => {
                if (info.status === 'recognizing text') {
                    const pct = Math.round((info.progress || 0) * 100);
                    onStatus?.(`Scanning MRZ… ${pct}%`);
                }
            }
        });

        const thresholds = [160, 130, 100];
        let mrzResult = null;
        
        for (const thresh of thresholds) {
            onStatus?.(`Scanning passport MRZ (Threshold ${thresh})…`);
            const crop = cropImage(img, mrzRegion, 4, thresh);
            console.log(`[Passport OCR] MRZ crop size (Threshold ${thresh}): ${crop.width}x${crop.height}`);
            
            await worker.setParameters(OCR_MRZ_PARAMS);
            const { data } = await worker.recognize(crop.dataUrl);
            console.log(`[Passport OCR] MRZ raw text (Threshold ${thresh}):\n${data.text}`);
            
            mrzResult = parseMRZ(data.text);
            if (mrzResult.source.passportNo === 'mrz' && mrzResult.source.fullName === 'mrz') {
                break;
            }
        }

        if (mrzResult.source.fullName === 'empty' || mrzResult.source.dob === 'empty' || mrzResult.source.passportNo === 'empty' || mrzResult.source.expiry === 'empty' || mrzResult.source.sex === 'empty') {
            onStatus?.('Scanning full passport for missing fields…');
            await worker.setParameters(OCR_FULL_PARAMS);
            const fullCrop = cropImage(img, { left: 0, top: 0, width: 1, height: 0.7 }, 2, false);
            const { data: fullData } = await worker.recognize(fullCrop.dataUrl);
            console.log('[Passport OCR] Visual OCR raw text:\n', fullData.text);
            mrzResult = parseVisual(fullData.text, mrzResult);
        }

        const age = calculateAge(mrzResult.dob);
        mrzResult.title = inferTitle(mrzResult.sex, age);

        await worker.terminate();
        if (imageSource instanceof Blob) URL.revokeObjectURL(src);

        console.log('[Passport OCR] Final merged result:', JSON.stringify(mrzResult, null, 2));
        
        if (mrzResult.fullName || mrzResult.passportNo) {
            onStatus?.('Passport data extracted ✓');
            return {
                ...mrzResult,
                name: mrzResult.fullName
            };
        }

        onStatus?.('Could not parse passport data');
        return null;
    } catch (err) {
        console.error('[Passport OCR] Failed:', err);
        onStatus?.('OCR failed');
        return null;
    }
}
