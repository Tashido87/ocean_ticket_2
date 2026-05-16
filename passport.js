/**
 * @fileoverview Passport photo upload utilities using Firebase Storage.
 * - Client-side image compression via canvas (no external dependency).
 * - Upload with progress reporting.
 * - Delete by storage path.
 */

import { storage } from './firebase-config.js';
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

    const { passportNo = 'unknown', onProgress } = opts;

    // Compress first (handles HEIC/large originals down to ~200-500 KB)
    let blob;
    try {
        blob = await compressImage(file);
    } catch (err) {
        // Fallback: upload original if compression fails (browser limitation)
        blob = file;
    }

    const safePassport = String(passportNo || 'unknown')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '') || 'unknown';
    const stamp = Date.now();
    const path = `passports/${safePassport}/${stamp}.jpg`;
    const ref = storageRef(storage, path);

    const task = uploadBytesResumable(ref, blob, { contentType: 'image/jpeg' });

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
 * Opens a fullscreen lightbox displaying the given image URL.
 * Creates a one-off DOM overlay; safe to call repeatedly.
 *
 * @param {string} url
 */
export function openPhotoLightbox(url) {
    if (!url) return;
    let lb = document.getElementById('photo-lightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'photo-lightbox';
        lb.className = 'photo-lightbox';
        lb.innerHTML = `
            <button class="pl-close" type="button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            <img alt="Passport photo">
        `;
        document.body.appendChild(lb);
        lb.addEventListener('click', (e) => {
            if (e.target === lb || e.target.closest('.pl-close')) {
                lb.classList.remove('is-open');
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') lb.classList.remove('is-open');
        });
    }
    lb.querySelector('img').src = url;
    lb.classList.add('is-open');
}
