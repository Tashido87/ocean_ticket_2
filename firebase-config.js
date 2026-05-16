/**
 * @fileoverview Firebase configuration and initialization.
 * Replaces the old Google Sheets config.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCne_lEm_tMAUn70gljCI0-hL1xv9Icxk0",
    authDomain: "ocean-ticket-bf235.firebaseapp.com",
    projectId: "ocean-ticket-bf235",
    storageBucket: "ocean-ticket-bf235.firebasestorage.app",
    messagingSenderId: "657934425604",
    appId: "1:657934425604:web:7069450cdd7bb2f23e9f51",
    measurementId: "G-4HTEXFM4WR"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
