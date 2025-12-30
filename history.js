/**
 * @fileoverview Manages loading, saving, and displaying the modification history log.
 */

import {
    CONFIG
} from './config.js';
import {
    state
} from './state.js';
import {
    fetchFromSheet,
    appendToSheet
} from './api.js';
import {
    showToast
} from './utils.js';
import {
    setupGenericPagination
} from './ui.js';

/**
 * Loads the modification history from the Google Sheet.
 */
export async function loadHistory() {
    try {
        const response = await fetchFromSheet(`${CONFIG.HISTORY_SHEET}!A:D`, 'historyData');
        if (response.values) {
            state.history = response.values.slice(1).map(row => ({
                date: row[0],
                name: row[1],
                pnr: row[2],
                details: row[3]
            })).reverse(); // Show most recent first
        }
    } catch (error) {
        console.error("Error loading history:", error);
    }
}

/**
 * Saves a new entry to the modification history log.
 * @param {Object} ticket The ticket object related to the history entry.
 * @param {string} details A description of the change that was made.
 */
export async function saveHistory(ticket, details) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[now.getMonth()];
    const year = now.getFullYear();
    const timestamp = `${day}-${month}-${year}`;

    const values = [
        [timestamp, ticket.name, ticket.booking_reference, details]
    ];

    try {
        await appendToSheet(`${CONFIG.HISTORY_SHEET}!A:D`, values);
    } catch (error) {
        console.error("Could not save history:", error);
        showToast('Failed to log action to history.', 'error');
    }
}

/**
 * Displays the modification history with pagination.
 * @param {number} page The page number to display.
 * @param {Array<Object>} [historyToShow=state.history] The history records to display.
 */
export function displayHistory(page, historyToShow = state.history) {
    const container = document.getElementById('modificationHistoryBody');
    const historySection = document.getElementById('modificationHistoryContainer');

    if (!container || !historySection) return;

    container.innerHTML = '';
    state.historyPage = page;

    if (historyToShow.length === 0) {
        historySection.style.display = 'none';
        return;
    }
    historySection.style.display = 'block';

    const paginated = historyToShow.slice((page - 1) * state.rowsPerPage, page * state.rowsPerPage);
    paginated.forEach(entry => {
        const row = container.insertRow();
        row.innerHTML = `<td>${entry.date}</td><td>${entry.name}</td><td>${entry.pnr}</td><td>${entry.details}</td>`;
    });

    setupGenericPagination(historyToShow, 'modificationHistoryPagination', (p) => displayHistory(p, historyToShow), page);
}