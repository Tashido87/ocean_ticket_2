/**
 * @fileoverview Handles all interactions with the Google Sheets API.
 * This includes fetching, updating, and appending data.
 */

import {
    CONFIG
} from './config.js';
import {
    state
} from './state.js';
import {
    showToast
} from './utils.js';

/**
 * Fetches data from the Google Sheet, utilizing a cache to reduce API calls.
 * @param {string} range The range to fetch from the sheet (e.g., 'Sheet1!A1:B2').
 * @param {string} cacheKey A unique key to identify this data in the cache.
 * @returns {Promise<Object>} A promise that resolves with the fetched data.
 */
export async function fetchFromSheet(range, cacheKey) {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    if (state.cache[cacheKey] && (Date.now() - state.cache[cacheKey].timestamp < CACHE_DURATION)) {
        console.log(`Using cached data for: ${cacheKey}`);
        return Promise.resolve(state.cache[cacheKey].data);
    }

    console.log(`Fetching fresh data for: ${cacheKey}`);
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SHEET_ID,
            range: range
        });

        const data = response.result;
        state.cache[cacheKey] = {
            data: data,
            timestamp: Date.now()
        };
        return data;
    } catch (error) {
        showToast(`API Error: ${error.result?.error?.message || 'Could not fetch data.'}`, 'error');
        throw error;
    }
}

/**
 * Appends rows to a sheet.
 * @param {string} range The sheet and range to append to (e.g., 'Sheet1!A:B').
 * @param {Array<Array<any>>} values The data to append.
 * @returns {Promise<Object>} The API response.
 */
export async function appendToSheet(range, values) {
    try {
        const result = await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: CONFIG.SHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values
            },
        });
        if (result.status !== 200 || !result.result.updates || result.result.updates.updatedRows === 0) {
            throw new Error('API call succeeded but failed to append rows.');
        }
        return result;
    } catch (error) {
        console.error('Error appending to sheet:', error);
        showToast(`Error: ${error.message || 'Could not save data.'}`, 'error');
        throw error;
    }
}

/**
 * Updates a range in a sheet.
 * @param {string} range The sheet and range to update (e.g., 'Sheet1!A1:B2').
 * @param {Array<Array<any>>} values The data to update.
 * @returns {Promise<Object>} The API response.
 */
export async function updateSheet(range, values) {
    try {
        return await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: CONFIG.SHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values
            }
        });
    } catch (error) {
        console.error('Error updating sheet:', error);
        showToast(`Update Error: ${error.result?.error?.message || 'Could not update.'}`, 'error');
        throw error;
    }
}


/**
 * Performs a batch update on the sheet.
 * @param {Array<Object>} data The data for the batch update.
 * @returns {Promise<Object>} The API response.
 */
export async function batchUpdateSheet(data) {
    try {
        return await gapi.client.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SHEET_ID,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: data
            }
        });
    } catch (error) {
        console.error('Error in batch update:', error);
        showToast(`Update Error: ${error.message || error.result?.error?.message || 'Could not update.'}`, 'error');
        throw error;
    }
}