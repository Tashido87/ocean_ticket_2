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
 * Formats a date string into DD/MM/YYYY format for Google Sheets.
 * @param {string} dateString The date string to format.
 * @returns {string} The formatted date string.
 */
export function formatDateForSheet(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? dateString : `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/**
 * Formats a Date object into DD/MM/YYYY format.
 * @param {Date} date The Date object to format.
 * @returns {string} The formatted date string.
 */
export function formatDateToDDMMYYYY(date) {
    if (!date || isNaN(date.getTime())) return '';
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/**
 * Detects placeholder / default dates (e.g. 01/01/1970 epoch, 01/01/1900).
 * @param {string} dateStr The date string to check.
 * @returns {boolean} True if it looks like a placeholder.
 */
export function isPlaceholderDate(dateStr) {
    const s = String(dateStr || '');
    const str = s.replace(/[^\d]/g, '');
    return str === '01011970' || str === '111970' || str === '01011900' || str === '111900' || str === '00000000' || str === '' || s.includes('1970') || s.includes('1900');
}

/**
 * Attaches auto-formatting to a date input so typing 11021987 produces 11/02/1987.
 * @param {HTMLInputElement} input The input element to attach to.
 */
export function attachDateAutoFormat(input) {
    if (!input) return;
    input.addEventListener('input', (e) => {
        let val = input.value.replace(/\D/g, '').slice(0, 8);
        if (val.length >= 2) val = val.slice(0, 2) + '/' + val.slice(2);
        if (val.length >= 5) val = val.slice(0, 5) + '/' + val.slice(5);
        input.value = val;
    });
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
 * Handles DD/MM/YYYY, old MM/DD/YYYY, and DD-Mon-YYYY formats.
 * @param {string} dateString The date string to parse.
 * @returns {Date} The parsed Date object.
 */
export function parseSheetDate(dateString) {
    if (!dateString) return new Date(0);
    const safeDateString = String(dateString).trim();
    const monthMap = {
        'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
        'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };
    const parts = safeDateString.split(/[-\/]/);
    if (parts.length === 3) {
        let day, month, year;
        if (isNaN(parseInt(parts[1], 10))) {
            // DD-Mon-YYYY
            day = parseInt(parts[0], 10);
            month = monthMap[parts[1].toUpperCase()];
            year = parseInt(parts[2], 10);
        } else {
            const p0 = parseInt(parts[0], 10);
            const p1 = parseInt(parts[1], 10);
            year = parseInt(parts[2], 10);
            if (p0 > 12) {
                // First part > 12 => must be day => DD/MM/YYYY
                day = p0;
                month = p1 - 1;
            } else if (p1 > 12) {
                // Second part > 12 => old MM/DD/YYYY
                month = p0 - 1;
                day = p1;
            } else {
                // Both <= 12: ambiguous, default to DD/MM/YYYY as requested
                day = p0;
                month = p1 - 1;
            }
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
 * Returns a new function that, when called, delays invocation of `func`
 * until `delay` ms have elapsed since the last call.
 * @param {Function} func The function to debounce.
 * @param {number} [delay=300] The debounce delay in milliseconds.
 * @returns {Function} The debounced function.
 */
export function debounce(func, delay = 300) {
    let timeoutId;
    return function debounced(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
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

/* =========================================
   SERVICES PAGE HELPERS
   ========================================= */

const ACTIVITY_KEY = 'ocean_services_activity';
const MAX_ACTIVITY = 10;

export function setButtonLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle('is-loading', loading);
    const text = btn.querySelector('.btn-text');
    if (text) text.style.opacity = loading ? '0.85' : '';
}

export function showServiceToast(id, message, type = 'info') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = `service-toast ${type} is-visible`;
    setTimeout(() => hideServiceToast(id), 5000);
}

export function hideServiceToast(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('is-visible');
}

export function addRecentActivity(kind, title, format) {
    try {
        const raw = localStorage.getItem(ACTIVITY_KEY);
        const list = raw ? JSON.parse(raw) : [];
        list.unshift({
            kind,
            title,
            format,
            time: Date.now()
        });
        while (list.length > MAX_ACTIVITY) list.pop();
        localStorage.setItem(ACTIVITY_KEY, JSON.stringify(list));
        renderRecentActivity();
    } catch (e) {
        console.warn('Recent activity save failed', e);
    }
}

export function renderRecentActivity() {
    const container = document.getElementById('recentActivityList');
    if (!container) return;
    try {
        const raw = localStorage.getItem(ACTIVITY_KEY);
        const list = raw ? JSON.parse(raw) : [];
        if (list.length === 0) {
            container.innerHTML = '<div class="activity-empty">No recent activity yet</div>';
            return;
        }
        container.innerHTML = list.map(item => {
            const date = new Date(item.time);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const iconClass = item.kind === 'hotel' ? 'hotel' : 'invoice';
            const icon = item.kind === 'hotel' ? 'fa-hotel' : 'fa-file-invoice-dollar';
            return `
                <div class="activity-item">
                    <span class="activity-icon ${iconClass}"><i class="fa-solid ${icon}"></i></span>
                    <div class="activity-body">
                        <span class="activity-title">${escapeHtml(item.title)}</span>
                        <span class="activity-meta">${escapeHtml(item.format)} &middot; ${timeStr}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        container.innerHTML = '<div class="activity-empty">No recent activity yet</div>';
    }
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const AIRLINE_LOGO_ALIASES = {
    '8M': '8M',
    'MAI': '8M',
    'MMA': '8M',
    'MYANMAR AIRWAYS': '8M',
    'MYANMAR AIRWAYS INTERNATIONAL': '8M',
    'MYANMAR AIRWAYS INTL': '8M',
    'MAIAIR': '8M',
    'UB': 'UB',
    'MNA': 'UB',
    'UBA': 'UB',
    'MYANMAR NATIONAL': 'UB',
    'MYANMAR NATIONAL AIRLINES': 'UB',
    '7Y': '7Y',
    'MYP': '7Y',
    'MANN YADANARPON': '7Y',
    'MANN YADANARPON AIRLINES': '7Y',
    'MAN YADANARPON': '7Y',
    'MANYADANARPON': '7Y',
    'AIR MYP': '7Y',
    'ST': 'ST',
    'RTL': 'ST',
    'AIR THANLWIN': 'ST',
    'AIR THAN LWIN': 'ST',
    'AIRTHANLWIN': 'ST',
    'YANGON AIRWAYS': 'ST',
    'K7': 'K7',
    'AIR KBZ': 'K7',
    'AIR KBZ LIMITED': 'K7',
    'TG': 'TG',
    'THAI': 'TG',
    'THAI AIRWAYS': 'TG',
    'THAI AIRWAYS INTERNATIONAL': 'TG',
    'PG': 'PG',
    'BANGKOK AIRWAYS': 'PG',
    'FD': 'FD',
    'THAI AIRASIA': 'FD',
    'THAI AIR ASIA': 'FD',
    'AK': 'AK',
    'AIRASIA': 'AK',
    'AIR ASIA': 'AK',
    'SQ': 'SQ',
    'SINGAPORE AIRLINES': 'SQ',
    'VJ': 'VJ',
    'VIETJET': 'VJ',
    'VIETJET AIR': 'VJ',
    'MH': 'MH',
    'MALAYSIA AIRLINES': 'MH',
    'MH MALAYSIA': 'MH',
    'DD': 'DD',
    'NOK AIR': 'DD',
    'SL': 'SL',
    'THAI LION AIR': 'SL'
};

function normalizeAirlineKey(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function getAirlineInitials(value) {
    const cleaned = normalizeAirlineKey(value).replace(/[^A-Z0-9 ]/g, '');
    if (!cleaned) return 'AIR';
    const words = cleaned.split(' ').filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 3);
    return words.slice(0, 3).map(word => word[0]).join('');
}

export function getAirlineLogoCode(airline) {
    const key = normalizeAirlineKey(airline);
    if (!key || key === '—' || key === 'N/A' || key === 'AIRLINE') return '';
    if (AIRLINE_LOGO_ALIASES[key]) return AIRLINE_LOGO_ALIASES[key];
    const compact = key.replace(/[^A-Z0-9]/g, '');
    if (AIRLINE_LOGO_ALIASES[compact]) return AIRLINE_LOGO_ALIASES[compact];
    return /^[A-Z0-9]{2}$/.test(compact) ? compact : '';
}

export function getAirlineLogoUrl(airline) {
    const code = getAirlineLogoCode(airline);
    return code ? `https://images.kiwi.com/airlines/64/${encodeURIComponent(code)}.png` : '';
}

export function renderAirlineName(airline, options = {}) {
    const label = String(airline || '').trim() || '—';
    const logoUrl = getAirlineLogoUrl(label);
    const initials = getAirlineInitials(label);
    const size = options.size === 'md' ? 'md' : options.size === 'xs' ? 'xs' : 'sm';
    const classes = ['airline-name', `airline-name-${size}`, logoUrl ? 'has-airline-logo' : 'has-airline-fallback'];
    const logo = logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('is-fallback'); this.remove();">`
        : '';

    return `
        <span class="${classes.join(' ')}">
            <span class="airline-logo-mark ${logoUrl ? '' : 'is-fallback'}" data-initials="${escapeHtml(initials)}">${logo}</span>
            <span class="airline-name-text">${escapeHtml(label)}</span>
        </span>
    `;
}

/**
 * Checks if a ticket is paid, handling various field types (boolean, number, string like "false", "no", etc.).
 * @param {Object} ticket The ticket object.
 * @returns {boolean} True if the ticket is paid, false otherwise.
 */
export function isTicketPaid(ticket) {
    const rawPaid = ticket?.paid;

    // Boolean or number — use directly
    if (typeof rawPaid === 'boolean') return rawPaid;
    if (typeof rawPaid === 'number') return rawPaid === 1;

    // String variants from sheets/databases
    const paidStr = String(rawPaid ?? '').trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'paid', 'settled', 'complete', 'completed'].includes(paidStr)) return true;
    if (['false', 'no', 'n', '0', 'unpaid', 'pending', 'partial', 'not paid'].includes(paidStr)) return false;

    // If paid field is a non-empty string but not a recognized status keyword
    // (e.g. "500000", "300000", a date string, etc.), do NOT treat it as paid.
    // Only explicitly marked statuses count as paid.
    return false;
}

/**
 * Identifies special rows that represent fee entries (not real passengers).
 * @param {Object} ticket The ticket object.
 * @returns {boolean} True if it's a fee entry row, false otherwise.
 */
export function isFeeEntryRow(ticket) {
    const name = String(ticket?.name || '');
    const remarks = String(ticket?.remarks || '').toLowerCase();
    return /\(fees\)\s*$/i.test(name) || remarks.includes('fee entry');
}

/**
 * Checks if a ticket is canceled or refunded.
 * @param {Object} ticket The ticket object.
 * @returns {boolean} True if canceled/refunded, false otherwise.
 */
export function isCanceledTicket(ticket) {
    const remarks = String(ticket?.remarks || '').toLowerCase();
    const status = String(ticket?.status || '').toLowerCase();
    return status.includes('cancel') || remarks.includes('cancel') || remarks.includes('refund');
}
