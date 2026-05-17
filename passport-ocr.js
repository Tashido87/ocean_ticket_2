/**
 * @fileoverview Passport OCR - extract Myanmar passport data from original uploads.
 * Strategy: strict MRZ-first parsing with visual OCR only as a validated fallback.
 */

import { mergePassportOcr } from './passport-parser.mjs';

const OCR_MRZ_PARAMS = {
    tessedit_pageseg_mode: '7',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    preserve_interword_spaces: '0',
    user_defined_dpi: '300'
};

const OCR_VISUAL_PARAMS = {
    tessedit_pageseg_mode: '6',
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

function createProcessedCrop(img, crop, scale = 4, threshold = false) {
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
        let value;
        if (typeof threshold === 'number') {
            value = lum < threshold ? 0 : 255;
        } else {
            value = Math.max(0, Math.min(255, ((lum - 128) * 1.35) + 128));
        }
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
    }
    ctx.putImageData(imageData, 0, 0);

    return {
        canvas,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height
    };
}

function cropCanvasRows(sourceCanvas, top, height) {
    const y = Math.max(0, Math.floor(top));
    const h = Math.max(1, Math.min(sourceCanvas.height - y, Math.floor(height)));
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = h;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceCanvas, 0, y, sourceCanvas.width, h, 0, 0, canvas.width, h);

    return {
        canvas,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height
    };
}

function detectMrzLineCrops(mrzCrop) {
    const canvas = mrzCrop.canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const densities = [];
    let maxDensity = 0;

    for (let y = 0; y < canvas.height; y++) {
        let dark = 0;
        for (let x = 0; x < canvas.width; x++) {
            const idx = (y * canvas.width + x) * 4;
            if (imageData.data[idx] < 150) dark++;
        }
        densities[y] = dark;
        if (dark > maxDensity) maxDensity = dark;
    }

    const threshold = Math.max(3, Math.floor(maxDensity * 0.22));
    const runs = [];
    let start = -1;

    for (let y = 0; y < densities.length; y++) {
        if (densities[y] >= threshold && start < 0) start = y;
        if ((densities[y] < threshold || y === densities.length - 1) && start >= 0) {
            const end = densities[y] < threshold ? y - 1 : y;
            if (end - start >= Math.max(4, Math.floor(canvas.height * 0.01))) {
                runs.push({ top: start, bottom: end });
            }
            start = -1;
        }
    }

    const merged = [];
    const mergeGap = Math.max(6, Math.floor(canvas.height * 0.018));
    for (const run of runs) {
        const last = merged[merged.length - 1];
        if (last && run.top - last.bottom <= mergeGap) {
            last.bottom = run.bottom;
        } else {
            merged.push({ ...run });
        }
    }

    const viable = merged
        .filter(run => run.bottom - run.top >= Math.max(8, Math.floor(canvas.height * 0.025)))
        .sort((a, b) => a.top - b.top);

    const selected = viable.length >= 2
        ? viable.slice(-2)
        : [
            { top: Math.floor(canvas.height * 0.58), bottom: Math.floor(canvas.height * 0.74) },
            { top: Math.floor(canvas.height * 0.75), bottom: Math.floor(canvas.height * 0.92) }
        ];

    const pad = Math.max(10, Math.floor(canvas.height * 0.025));
    return selected.map(run => {
        const top = Math.max(0, run.top - pad);
        const bottom = Math.min(canvas.height, run.bottom + pad);
        return cropCanvasRows(canvas, top, bottom - top);
    });
}

async function recognize(worker, crop) {
    const { data } = await worker.recognize(crop.dataUrl);
    return data.text || '';
}

function isMissingAnyRequiredField(result) {
    return !result.fullName
        || !result.passportNo
        || !result.dob
        || !result.expiry
        || !result.sex;
}

export async function ocrPassport(imageSource, onStatus) {
    onStatus?.('Initialising OCR...');
    if (!window.Tesseract) {
        onStatus?.('OCR unavailable');
        return null;
    }

    let src = imageSource;
    let ownsObjectUrl = false;
    let worker = null;

    try {
        if (imageSource instanceof Blob) {
            src = URL.createObjectURL(imageSource);
            ownsObjectUrl = true;
        }

        const img = await loadImage(src);
        const warnings = [];
        console.log(`[Passport OCR] Original image size: ${img.naturalWidth}x${img.naturalHeight}`);

        if (img.naturalWidth < 900) {
            const warning = 'Image too small for reliable OCR.';
            warnings.push(warning);
            console.warn(`[Passport OCR] ${warning}`);
            onStatus?.(warning);
        }

        worker = await Tesseract.createWorker('eng', 1, {
            logger: (info) => {
                if (info.status === 'recognizing text') {
                    const pct = Math.round((info.progress || 0) * 100);
                    onStatus?.(`Scanning passport... ${pct}%`);
                }
            }
        });

        const mrzTexts = [];
        const thresholds = [150, 115];
        await worker.setParameters(OCR_MRZ_PARAMS);

        for (const threshold of thresholds) {
            onStatus?.(`Scanning passport MRZ (threshold ${threshold})...`);
            const mrzCrop = createProcessedCrop(img, { left: 0, top: 0.65, width: 1, height: 0.35 }, 4, threshold);
            console.log(`[Passport OCR] MRZ crop size (threshold ${threshold}): ${mrzCrop.width}x${mrzCrop.height}`);

            const lineCrops = detectMrzLineCrops(mrzCrop);
            const lineTexts = [];

            for (let i = 0; i < lineCrops.length; i++) {
                const lineCrop = lineCrops[i];
                console.log(`[Passport OCR] MRZ line ${i + 1} crop size (threshold ${threshold}): ${lineCrop.width}x${lineCrop.height}`);
                const text = await recognize(worker, lineCrop);
                console.log(`[Passport OCR] MRZ line ${i + 1} raw text (threshold ${threshold}):\n${text}`);
                lineTexts.push(text);
            }

            mrzTexts.push(lineTexts.join('\n'));
            const partial = mergePassportOcr({ mrzText: mrzTexts.join('\n'), warnings });
            if (
                partial.validations.mrzStructureValid
                && partial.source.passportNo === 'mrz'
                && partial.source.dob === 'mrz'
                && partial.source.expiry === 'mrz'
            ) {
                break;
            }
        }

        let visualText = '';
        let result = mergePassportOcr({ mrzText: mrzTexts.join('\n'), warnings });

        if (isMissingAnyRequiredField(result)) {
            onStatus?.('Scanning visible passport fields...');
            await worker.setParameters(OCR_VISUAL_PARAMS);
            const visualCrop = createProcessedCrop(img, { left: 0, top: 0, width: 1, height: 0.72 }, 2.5, false);
            console.log(`[Passport OCR] Visual crop size: ${visualCrop.width}x${visualCrop.height}`);
            visualText = await recognize(worker, visualCrop);
            console.log('[Passport OCR] Visual OCR raw text:\n', visualText);
            result = mergePassportOcr({ mrzText: mrzTexts.join('\n'), visualText, warnings });
        }

        console.log('[Passport OCR] Final merged result:', JSON.stringify(result, null, 2));

        if (result.fullName || result.passportNo || result.dob || result.expiry) {
            onStatus?.('Passport data extracted');
            return result;
        }

        onStatus?.('Could not parse passport data');
        return null;
    } catch (err) {
        console.error('[Passport OCR] Failed:', err);
        onStatus?.('OCR failed');
        return null;
    } finally {
        if (worker) await worker.terminate();
        if (ownsObjectUrl) URL.revokeObjectURL(src);
    }
}
