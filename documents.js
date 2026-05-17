/**
 * @fileoverview Document Storage utilities for the Services page.
 * - Lists, uploads, and deletes documents from Firebase Storage.
 * - Provides a small set of fallback (seed) documents hosted on GitHub
 *   so the page is never empty before any uploads have happened.
 */

import { storage } from './firebase-config.js';
import {
    ref as storageRef,
    listAll,
    getDownloadURL,
    getMetadata,
    uploadBytesResumable,
    deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const FIREBASE_DOC_PATH = 'documents';
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB per file

/* =========================================
   SEED DOCUMENTS (GitHub-hosted, will be removed once Firebase has them)
   ========================================= */
const SEED_DOCS = [
    {
        source: 'github',
        title: 'Singapore Hotel Booking (Agoda)',
        type: 'Hotel',
        ext: 'pdf',
        size: 248_000,
        url: 'https://raw.githubusercontent.com/Tashido87/ocean_ticket/main/assets/singapore_hotel_booking.pdf',
        filename: 'Singapore_Hotel_Booking_Agoda.pdf',
        uploadedAt: null
    },
    {
        source: 'github',
        title: 'SSR Date Change Form',
        type: 'Airline',
        ext: 'pages',
        size: 132_000,
        url: 'https://raw.githubusercontent.com/Tashido87/ocean_ticket/main/assets/WC_EO_form.pages',
        filename: 'SSR_Date_Change_Form.pages',
        uploadedAt: null
    }
];

/* =========================================
   FORMAT HELPERS
   ========================================= */

export function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatUploadDate(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
    } catch {
        return '—';
    }
}

function getExt(name) {
    const m = String(name || '').match(/\.([^.]+)$/);
    return m ? m[1].toLowerCase() : '';
}

/* =========================================
   FIREBASE STORAGE OPERATIONS
   ========================================= */

/**
 * Lists all documents currently in Firebase Storage under the documents/ path.
 * @returns {Promise<Array>}
 */
export async function listFirebaseDocuments() {
    try {
        const dirRef = storageRef(storage, FIREBASE_DOC_PATH);
        const result = await listAll(dirRef);
        const docs = await Promise.all(result.items.map(async (itemRef) => {
            const [url, metadata] = await Promise.all([
                getDownloadURL(itemRef),
                getMetadata(itemRef)
            ]);
            const meta = metadata.customMetadata || {};
            return {
                source: 'firebase',
                path: itemRef.fullPath,
                filename: itemRef.name,
                title: meta.title || itemRef.name.replace(/^\d+_/, ''),
                type: meta.type || 'Document',
                ext: getExt(itemRef.name),
                size: metadata.size,
                url,
                uploadedAt: metadata.timeCreated
            };
        }));
        // newest first
        docs.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
        return docs;
    } catch (err) {
        console.warn('Firebase listAll failed:', err);
        return [];
    }
}

/**
 * Returns the merged list: Firebase uploads first, then seed (GitHub) docs.
 */
export async function getAllDocuments() {
    const fbDocs = await listFirebaseDocuments();
    return [...fbDocs, ...SEED_DOCS];
}

/**
 * Upload a single document file to Firebase Storage with progress.
 * @param {File} file
 * @param {{ title?: string, type?: string, onProgress?: (pct:number)=>void }} opts
 * @returns {Promise<{ url: string, path: string }>}
 */
export async function uploadDocument(file, opts = {}) {
    if (!file) throw new Error('No file provided.');
    if (file.size > MAX_DOC_BYTES) {
        throw new Error(`File too large (max ${formatFileSize(MAX_DOC_BYTES)}).`);
    }
    const { title, type = 'Document', onProgress } = opts;

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${FIREBASE_DOC_PATH}/${Date.now()}_${safeName}`;
    const ref = storageRef(storage, path);

    const task = uploadBytesResumable(ref, file, {
        contentType: file.type || 'application/octet-stream',
        customMetadata: {
            title: String(title || file.name),
            type: String(type)
        }
    });

    return new Promise((resolve, reject) => {
        task.on(
            'state_changed',
            (snap) => {
                if (onProgress) {
                    const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
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
 * Deletes a document from Firebase Storage by its full path.
 * @param {string} path
 */
export async function deleteDocument(path) {
    if (!path) return;
    try {
        await deleteObject(storageRef(storage, path));
    } catch (err) {
        if (err && err.code !== 'storage/object-not-found') {
            console.warn('Failed to delete document:', err);
            throw err;
        }
    }
}
