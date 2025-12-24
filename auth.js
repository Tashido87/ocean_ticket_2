/**
 * @fileoverview Manages Google API client initialization and user authentication.
 */

import {
    CONFIG
} from './config.js';
import {
    getAuth,
    setTokenClient,
    setGapiInited,
    setGisInited
} from './state.js';
import {
    initializeApp
} from './main.js';
import {
    showToast
} from './utils.js';

let tokenClient;

/**
 * Initializes the GAPI client.
 * @returns {Promise<void>} A promise that resolves when the client is initialized.
 */
export function loadGapiClient() {
    return new Promise((resolve, reject) => {
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: CONFIG.API_KEY,
                    discoveryDocs: [CONFIG.DISCOVERY_DOC]
                });
                setGapiInited(true);
                tryAutoSignIn();
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Initializes the Google Identity Services (GIS) client.
 * @returns {Promise<void>} A promise that resolves when the client is initialized.
 */
export function loadGisClient() {
    return new Promise((resolve, reject) => {
        try {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CONFIG.CLIENT_ID,
                scope: CONFIG.SCOPES,
                callback: async (tokenResponse) => {
                    const authorizeButton = document.getElementById('authorize_button');
                    const loading = document.getElementById('loading');

                    if (tokenResponse.error) {
                        console.log('Token request failed:', tokenResponse.error);
                        authorizeButton.style.display = 'block';
                        loading.style.display = 'none';
                        return;
                    }
                    gapi.client.setToken(tokenResponse);
                    setTokenClient(tokenClient);
                    authorizeButton.style.display = 'none';
                    await initializeApp();
                },
            });
            setGisInited(true);
            tryAutoSignIn();
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Tries to sign in the user automatically without prompting.
 */
function tryAutoSignIn() {
    const {
        gapiInited,
        gisInited
    } = getAuth();
    if (gapiInited && gisInited) {
        tokenClient.requestAccessToken({
            prompt: ''
        });
    }
}

/**
 * Handles the click event for the manual sign-in button.
 */
export function handleAuthClick() {
    if (gapi.client.getToken() === null) {
        // Prompt the user to select a Google Account and ask for consent to share their data
        // when establishing a new session.
        tokenClient.requestAccessToken({
            prompt: 'consent'
        });
    } else {
        // Skip display of account chooser and consent dialog for an existing session.
        tokenClient.requestAccessToken({
            prompt: ''
        });
    }
}