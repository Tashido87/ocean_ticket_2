/**
 * @fileoverview Passport photo upload utilities using Firebase Storage.
 * - Client-side image compression via canvas (no external dependency).
 * - Upload with progress reporting.
 * - Delete by storage path.
 */

import { storage, auth } from './firebase-config.js';
import {
    ref as storageRef,
    uploadBytesResumable,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.85;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Compress an image File using a canvas. Returns a JPEG Blob.
 * Preserves aspect ratio, downscales to MAX_WIDTH if larger.
 *
 * @param {File} file - The image file to compress.
 * @returns {Promise<Blob>} The compressed JPEG blob.
 */
export function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            reject(new Error('Not an image file.'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read file.'));
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Could not decode image.'));
            img.onload = () => {
                const ratio = Math.min(1, MAX_WIDTH / img.width);
                const width = Math.round(img.width * ratio);
                const height = Math.round(img.height * ratio);

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('Compression failed.'));
                    },
                    'image/jpeg',
                    JPEG_QUALITY
                );
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Uploads a passport photo to Firebase Storage with progress reporting.
 *
 * @param {File} file - The original image file.
 * @param {Object} [opts]
 * @param {string} [opts.passportNo] - Used in the storage path (sanitised).
 * @param {(pct: number) => void} [opts.onProgress] - Progress 0-100.
 * @returns {Promise<{ url: string, path: string }>}
 */
export async function uploadPassportPhoto(file, opts = {}) {
    if (!file) throw new Error('No file provided.');
    if (file.size > MAX_FILE_BYTES) {
        throw new Error('File too large (max 5 MB).');
    }

    const { passportNo = 'unknown', onProgress, storagePath } = opts;

    // Compress first (handles HEIC/large originals down to ~200-500 KB)
    let blob;
    try {
        blob = await compressImage(file);
    } catch (err) {
        // Fallback: upload original if compression fails (browser limitation)
        blob = file;
    }

    const uid = auth.currentUser?.uid || 'anonymous';
    const safePassport = String(passportNo || 'unknown')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '') || 'unknown';
    const stamp = Date.now();
    const path = storagePath
        ? storagePath.replace('{uid}', uid).replace('{stamp}', String(stamp))
        : `passports/${uid}/${stamp}.jpg`;
    const ref = storageRef(storage, path);

    const task = uploadBytesResumable(ref, blob, {
        contentType: 'image/jpeg',
        contentDisposition: 'attachment'
    });

    return new Promise((resolve, reject) => {
        task.on(
            'state_changed',
            (snap) => {
                if (onProgress) {
                    const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
                    onProgress(pct);
                }
            },
            (err) => reject(err),
            async () => {
                try {
                    const url = await getDownloadURL(task.snapshot.ref);
                    resolve({ url, path });
                } catch (err) {
                    reject(err);
                }
            }
        );
    });
}

/**
 * Deletes a passport photo by its storage path. Silent on missing files.
 *
 * @param {string} path - The storage path (e.g. 'passports/.../file.jpg').
 */
export async function deletePassportPhoto(path) {
    if (!path) return;
    try {
        await deleteObject(storageRef(storage, path));
    } catch (err) {
        // Ignore "not found" errors; surface others
        if (err && err.code !== 'storage/object-not-found') {
            console.warn('Failed to delete passport photo:', err);
        }
    }
}

/**
 * Downloads an uploaded passport or document image by URL with a clean filename.
 * Uses fetch -> Blob -> object URL first; falls back to canvas or direct anchor download.
 *
 * @param {string} url - The download URL of the document/image.
 * @param {string} [suggestedFilename='document.jpg'] - Suggested filename for saving.
 */
export async function downloadPassportPhoto(url, suggestedFilename = 'document.jpg') {
    if (!url) return;
    const rawName = String(suggestedFilename || 'document')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'document';
    const filename = /\.(jpe?g|png|webp|pdf)$/i.test(rawName) ? rawName : `${rawName}.jpg`;

    const triggerBlobDownload = (blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    };

    try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) {
            const blob = await res.blob();
            triggerBlobDownload(blob);
            return;
        }
    } catch (_) {
        // Fallback to image-canvas or direct link if CORS blocks fetch
    }

    try {
        const blob = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92);
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = url;
        });
        triggerBlobDownload(blob);
        return;
    } catch (_) {
        // Final fallback: direct anchor with download attribute
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/**
 * Opens a fullscreen lightbox displaying the given image URL.
 * Creates a one-off DOM overlay; safe to call repeatedly.
 *
 * @param {string} url
 * @param {string} [caption]
 */
export function openPhotoLightbox(url, caption = '') {
    if (!url) return;
    let lb = document.getElementById('photo-lightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'photo-lightbox';
        lb.className = 'photo-lightbox';
        lb.innerHTML = `
            <div class="pl-toolbar" style="position:fixed; top:20px; right:24px; display:flex; align-items:center; gap:10px; z-index:10002;">
                <button class="pl-download" type="button" aria-label="Download" style="height:36px; padding:0 14px; border-radius:9px; border:1px solid #0C6B7A; background:#0C6B7A; color:#FFFFFF; font-size:12px; font-weight:700; display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
                    <i class="fa-solid fa-download"></i> Download
                </button>
                <button class="pl-close" type="button" aria-label="Cancel" style="position:static; height:36px; padding:0 14px; border-radius:9px; font-size:12px; font-weight:700; cursor:pointer;">Cancel</button>
            </div>
            <img alt="Document photo">
        `;
        document.body.appendChild(lb);
        lb.addEventListener('click', (e) => {
            if (e.target.closest('.pl-close')) {
                lb.classList.remove('is-open');
            } else if (e.target.closest('.pl-download')) {
                const currentUrl = lb.dataset.currentUrl || lb.querySelector('img')?.src;
                const currentCaption = lb.dataset.currentCaption || 'document';
                if (currentUrl) downloadPassportPhoto(currentUrl, currentCaption);
            }
        });
    }
    lb.dataset.currentUrl = url;
    lb.dataset.currentCaption = caption || 'document';
    const imgEl = lb.querySelector('img');
    if (imgEl) {
        imgEl.src = url;
        imgEl.alt = caption || 'Document photo';
    }
    lb.classList.add('is-open');
}
