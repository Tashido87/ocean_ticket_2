/**
 * @fileoverview Utility functions for the Ocean Air Ticket Management application.
 * This includes functions for date formatting, DOM manipulation, and other helpers.
 */

import {
    state
} from './state.js';

/**
 * Converts a string into a clickable link if it's a URL, email, or phone number.
 * @param {string} text The text to convert.
 * @returns {string} The HTML string with a clickable link if applicable.
 */
export function makeClickable(text) {
    if (!text) return 'N/A';
    if (text.toLowerCase().startsWith('http')) return `<a href="${text}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    if (/^[\d\s\-+()]+$/.test(text)) return `<a href="tel:${text.replace(/[^\d+]/g, '')}">${text}</a>`;
    if (text.startsWith('@')) return `<a href="https://t.me/${text.substring(1)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    return text;
}

/**
 * Displays a toast message at the bottom of the screen.
 * @param {string} message The message to display.
 * @param {string} [type='info'] The type of toast (info, success, error).
 */
export function showToast(message, type = 'info') {
    document.getElementById('toastMessage').textContent = message;
    const toastEl = document.getElementById('toast');
    toastEl.className = `show ${type}`;
    setTimeout(() => toastEl.className = toastEl.className.replace('show', ''), 4000);
}

/**
 * Formats a date string into MM/DD/YYYY format for Google Sheets.
 * @param {string} dateString The date string to format.
 * @returns {string} The formatted date string.
 */
export function formatDateForSheet(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? dateString : `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

/**
 * Formats a date string into DD-Mon-YYYY format.
 * @param {string} dateString The date string to format.
 * @returns {string} The formatted date string.
 */
export function formatDateToDDMMMYYYY(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
}

/**
 * Formats a date string into D-Mon-YYYY format.
 * @param {string} dateString The date string to format.
 * @returns {string} The formatted date string.
 */
export function formatDateToDMMMY(dateString) {
    if (!dateString) return '';
    const date = parseSheetDate(dateString);
    if (isNaN(date.getTime()) || date.getTime() === 0) {
        return dateString;
    }
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[date.getMonth()];
    return `${day}-${month}-${year}`;
}

/**
 * Parses a date string from Google Sheets into a Date object.
 * Handles MM/DD/YYYY and DD-Mon-YYYY formats.
 * @param {string} dateString The date string to parse.
 * @returns {Date} The parsed Date object.
 */
export function parseSheetDate(dateString) {
    if (!dateString) return new Date(0);
    const safeDateString = String(dateString).trim();
    const monthMap = {
        'JAN': 0,
        'FEB': 1,
        'MAR': 2,
        'APR': 3,
        'MAY': 4,
        'JUN': 5,
        'JUL': 6,
        'AUG': 7,
        'SEP': 8,
        'OCT': 9,
        'NOV': 10,
        'DEC': 11
    };
    const parts = safeDateString.split(/[-\/]/);
    if (parts.length === 3) {
        let day, month, year;
        if (isNaN(parseInt(parts[1], 10))) {
            day = parseInt(parts[0], 10);
            month = monthMap[parts[1].toUpperCase()];
            year = parseInt(parts[2], 10);
        } else {
            month = parseInt(parts[0], 10) - 1;
            day = parseInt(parts[1], 10);
            year = parseInt(parts[2], 10);
        }
        if (!isNaN(day) && month !== undefined && !isNaN(year) && year > 1900 && day > 0 && day <= 31 && month >= 0 && month < 12) {
            const d = new Date(year, month, day);
            if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
                return d;
            }
        }
    }
    const fallbackDate = new Date(safeDateString);
    if (!isNaN(fallbackDate.getTime())) {
        return fallbackDate;
    }
    return new Date(0);
}

/**
 * Parses a date and time string into a Date object representing a deadline.
 * @param {string} dateStr The date string (e.g., 'MM/DD/YYYY').
 * @param {string} timeStr The time string (e.g., 'hh:mm AM/PM').
 * @returns {Date|null} The parsed Date object or null if invalid.
 */
export function parseDeadline(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const date = parseSheetDate(dateStr);
    if (isNaN(date.getTime()) || date.getTime() === 0) {
        console.error("Invalid date string provided to parseDeadline:", dateStr);
        return null;
    }

    const timeParts = timeStr.match(/(\d+):(\d+)(:(\d+))?\s*(AM|PM)/i);

    if (!timeParts) {
        console.error("Invalid time string provided to parseDeadline:", timeStr);
        return null;
    }

    let hours = parseInt(timeParts[1], 10);
    const minutes = parseInt(timeParts[2], 10);
    const ampm = timeParts[5].toUpperCase();

    if (ampm === 'PM' && hours < 12) {
        hours += 12;
    }
    if (ampm === 'AM' && hours === 12) { // 12 AM is 00 hours
        hours = 0;
    }

    date.setHours(hours, minutes, 0, 0);
    return date;
}

/**
 * Calculates the agent's commission based on the total commission and the agent's cut rate.
 * @param {number} totalCommission The total commission amount.
 * @returns {number} The calculated agent's commission.
 */
export function calculateAgentCut(totalCommission) {
    return Math.round(totalCommission * state.commissionRates.cut);
}

/**
 * Renders an empty state message in a specified container.
 * @param {string} containerId The ID of the container element.
 * @param {string} iconClass The Font Awesome icon class.
 * @param {string} title The title of the message.
 * @param {string} message The body of the message.
 * @param {string} [buttonText=''] Optional text for a button.
 * @param {Function} [buttonAction=null] Optional function to execute when the button is clicked.
 */
export function renderEmptyState(containerId, iconClass, title, message, buttonText = '', buttonAction = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let buttonHtml = '';
    if (buttonText && buttonAction) {
        buttonHtml = `<button class="btn btn-primary">${buttonText}</button>`;
    }
    container.innerHTML = `
        <div class="empty-state">
            <i class="fa-solid ${iconClass}"></i>
            <h4>${title}</h4>
            <p>${message}</p>
            ${buttonHtml}
        </div>
    `;
    if (buttonAction) {
        container.querySelector('button').addEventListener('click', buttonAction);
    }
}

/**
 * Debounces a function to limit the rate at which it gets called.
 * @param {Function} func The function to debounce.
 * @param {number} [delay=300] The debounce delay in milliseconds.
 * @returns {Function} The debounced function.
 */
export function debounce(func, delay = 300) {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => {
        func.apply(this, arguments);
    }, delay);
}

/**
 * Parses a payment method string that may include a Mobile Banking sub-method.
 * Example: "Mobile Banking (KBZ Special)" -> { method: "Mobile Banking", bank: "KBZ Special" }
 * @param {string} paymentMethod
 * @returns {{method: string, bank: string}}
 */
export function parsePaymentMethod(paymentMethod = '') {
    const raw = String(paymentMethod || '').trim();
    if (!raw) return { method: '', bank: '' };

    const match = raw.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (match) {
        return {
            method: (match[1] || '').trim(),
            bank: (match[2] || '').trim()
        };
    }
    return { method: raw, bank: '' };
}

/**
 * Formats a payment method for storage.
 * If method is "Mobile Banking" and bank is provided, returns "Mobile Banking (BANK)".
 * @param {string} method
 * @param {string} bank
 * @returns {string}
 */
export function formatPaymentMethod(method = '', bank = '') {
    const m = String(method || '').trim();
    const b = String(bank || '').trim();
    if (!m) return '';
    if (m === 'Mobile Banking' && b) return `Mobile Banking (${b})`;
    return m;
}