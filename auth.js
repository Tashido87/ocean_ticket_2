/**
 * @fileoverview Manages Firebase Authentication (Google Sign-In).
 * Replaces the old Google Sheets OAuth flow.
 */

import { auth, googleProvider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { showToast } from './utils.js';

let authStateCallback = null;

/**
 * Initializes auth state listener.
 * @param {Function} onUserSignedIn Called when a user signs in.
 * @param {Function} onUserSignedOut Called when a user signs out.
 */
export function initAuth(onUserSignedIn, onUserSignedOut) {
    onAuthStateChanged(auth, (user) => {
        const authorizeButton = document.getElementById('authorize_button');
        const loading = document.getElementById('loading');

        if (user) {
            console.log('User signed in:', user.displayName);
            if (authorizeButton) authorizeButton.style.display = 'none';
            if (loading) loading.style.display = 'none';
            if (onUserSignedIn) onUserSignedIn(user);
        } else {
            if (authorizeButton) authorizeButton.style.display = 'block';
            if (loading) loading.style.display = 'none';
            if (onUserSignedOut) onUserSignedOut();
        }
    });
}

/**
 * Handles the click event for the sign-in button.
 */
export async function handleAuthClick() {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        console.error('Sign-in error:', error);
        showToast(`Sign-in failed: ${error.message}`, 'error');
    }
}

/**
 * Signs out the current user.
 */
export async function handleSignOut() {
    try {
        await signOut(auth);
        showToast('Signed out.', 'info');
    } catch (error) {
        console.error('Sign-out error:', error);
    }
}

/**
 * Returns the current Firebase user or null.
 */
export function getCurrentUser() {
    return auth.currentUser;
}