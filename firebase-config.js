/**
 * @fileoverview Firebase configuration and initialization.
 * Replaces the old Google Sheets config.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyCne_lEm_tMAUn70gljCl0-hL1xv9Icxk0",
    authDomain: "ocean-ticket-bf235.firebaseapp.com",
    projectId: "ocean-ticket-bf235",
    storageBucket: "ocean-ticket-bf235.firebasestorage.app",
    messagingSenderId: "657934425604",
    appId: "1:657934425604:web:7069450cdd7bb2f23e9f51",
    measurementId: "G-4HTEXFM4WR"
};

const app = initializeApp(firebaseConfig);

let firestoreInstance;
try {
    firestoreInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
} catch (e) {
    console.warn("Persistent cache not supported or restricted, falling back to memory cache:", e);
    try {
        firestoreInstance = initializeFirestore(app, {
            localCache: memoryLocalCache()
        });
    } catch (e2) {
        firestoreInstance = initializeFirestore(app, {});
    }
}
export const db = firestoreInstance;
export const auth = getAuth(app);
export const storage = getStorage(app);
// Cloud Functions live in us-central1 — keep this in sync with functions/index.js.
export const functions = getFunctions(app, 'us-central1');
export const googleProvider = new GoogleAuthProvider();
