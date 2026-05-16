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
    // Wire up the sign-in button click
    const authorizeButton = document.getElementById('authorize_button');
    if (authorizeButton) {
        authorizeButton.addEventListener('click', handleAuthClick);
    }

    onAuthStateChanged(auth, (user) => {
        const authContainer = document.getElementById('auth-container');
        const loading = document.getElementById('loading');
        const dashboardContent = document.getElementById('dashboard-content');

        if (user) {
            console.log('User signed in:', user.displayName);
            if (authContainer) authContainer.style.display = 'none';
            if (loading) loading.style.display = 'block';
            if (onUserSignedIn) onUserSignedIn(user);
        } else {
            if (authContainer) authContainer.style.display = 'block';
            if (loading) loading.style.display = 'none';
            if (dashboardContent) dashboardContent.style.display = 'none';
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