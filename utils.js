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
    const escaped = escapeHtml(text);
    if (text.toLowerCase().startsWith('http')) return `<a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
    if (/^[\d\s\-+()]{7,}$/.test(text)) {
        const rawDigits = text.replace(/[^\d+]/g, '');
        let intl = rawDigits.replace(/^\+/, '');
        if (intl.startsWith('09')) intl = '959' + intl.slice(2);
        else if (intl.startsWith('9') && !intl.startsWith('95')) intl = '95' + intl;

        return `<span style="display:inline-flex; align-items:center; gap:6px;">
            <a href="tel:${rawDigits}">${escaped}</a>
            <a href="viber://chat?number=%2B${intl}" class="btn-viber-chat" title="Viber" target="_blank" rel="noopener"><i class="fa-brands fa-viber"></i></a>
            <a href="https://wa.me/${intl}" class="btn-whatsapp-chat" title="WhatsApp" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i></a>
        </span>`;
    }
    if (text.startsWith('@')) return `<a href="https://t.me/${escaped.substring(1)}" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
    if (text.includes('.') && !text.includes(' ') && text.length > 4) {
        return `<a href="https://${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
    }
    return escaped;
}

/**
 * Normalizes raw account links into safe absolute URLs or action links (tel, viber, whatsapp, facebook, telegram).
 * Prevents relative URL navigation errors (e.g. domain.com/09440006400).
 * @param {string} rawLink The raw account link or username or phone.
 * @param {string} [accountType=''] The account type (Facebook, Viber, Telegram, WhatsApp, etc.).
 * @returns {string} The safe link for href.
 */
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'viber:', 'weixin:']);

export function isSafeProtocol(url) {
    if (!url) return false;
    const trimmed = String(url).trim();
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/i);
    if (match) {
        return ALLOWED_URL_PROTOCOLS.has(match[1].toLowerCase() + ':');
    }
    return true;
}

export function sanitizeUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (!isSafeProtocol(trimmed)) return '';
    return trimmed;
}

export function formatSafeAccountLink(rawLink, accountType = '') {
    if (!rawLink) return '';
    let link = String(rawLink).trim();
    if (!link) return '';

    // Reject dangerous URI schemes (javascript:, data:, vbscript:, etc.)
    const schemeMatch = link.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/i);
    if (schemeMatch) {
        const scheme = schemeMatch[1].toLowerCase() + ':';
        if (!ALLOWED_URL_PROTOCOLS.has(scheme)) {
            return '';
        }
        return link;
    }

    const type = String(accountType || '').toLowerCase();
    const digitsOnly = link.replace(/[^\d+]/g, '');

    if (/^(\+?959|09|\d{7,12})$/.test(digitsOnly)) {
        let intl = digitsOnly.replace(/^\+/, '');
        if (intl.startsWith('09')) intl = '959' + intl.slice(2);
        else if (intl.startsWith('9') && !intl.startsWith('95')) intl = '95' + intl;

        if (type.includes('viber')) {
            return `viber://chat?number=%2B${intl}`;
        }
        if (type.includes('whatsapp')) {
            return `https://wa.me/${intl}`;
        }
        if (type.includes('facebook') || type.includes('fb')) {
            return `https://www.facebook.com/search/top/?q=${encodeURIComponent(digitsOnly)}`;
        }
        return `tel:${digitsOnly}`;
    }

    if (link.startsWith('@')) {
        return `https://t.me/${link.slice(1)}`;
    }

    if (/^(facebook\.com|fb\.com|fb\.me|m\.me|t\.me|instagram\.com|tiktok\.com|linkedin\.com|wa\.me|weixin\.qq\.com)/i.test(link)) {
        return `https://${link}`;
    }

    if (type.includes('messenger')) {
        return `https://m.me/${link.replace(/^https?:\/\/m\.me\//i, '').replace(/^\//, '')}`;
    }
    if (type.includes('facebook') || type.includes('fb')) {
        return `https://www.facebook.com/${link.replace(/^\//, '')}`;
    }
    if (type.includes('telegram') || type.includes('tg')) {
        return `https://t.me/${link.replace(/^@/, '')}`;
    }
    if (type.includes('viber')) {
        return `viber://chat?number=%2B${link.replace(/[^\d]/g, '')}`;
    }
    if (type.includes('wechat') || type.includes('weixin')) {
        if (/^https?:\/\//i.test(link)) return link;
        return `weixin://dl/chat?${encodeURIComponent(link)}`;
    }

    if (link.includes('.')) {
        return `https://${link}`;
    }

    return `https://www.facebook.com/${encodeURIComponent(link)}`;
}

/**
 * Returns icon, brand color, and platform display label for social media types.
 * @param {string} accountType Social media account type (e.g. Messenger, Viber, WeChat, Telegram, Facebook Page, Phone).
 * @param {string} [rawLink=''] Raw account link or username.
 * @returns {{ icon: string, label: string, color: string, badgeBg: string }} Platform metadata.
 */
export function getSocialPlatformMeta(accountType = '', rawLink = '') {
    const t = String(accountType || '').toLowerCase();
    const l = String(rawLink || '').toLowerCase();

    if (t.includes('messenger') || l.includes('m.me')) {
        return {
            icon: 'fa-brands fa-facebook-messenger',
            label: 'Messenger',
            color: '#0084FF',
            badgeBg: 'rgba(0, 132, 255, 0.12)'
        };
    }
    if (t.includes('viber') || l.includes('viber:')) {
        return {
            icon: 'fa-brands fa-viber',
            label: 'Viber',
            color: '#7360F2',
            badgeBg: 'rgba(115, 96, 242, 0.12)'
        };
    }
    if (t.includes('telegram') || t.includes('tg') || l.includes('t.me')) {
        return {
            icon: 'fa-brands fa-telegram',
            label: 'Telegram',
            color: '#229ED9',
            badgeBg: 'rgba(34, 158, 217, 0.12)'
        };
    }
    if (t.includes('wechat') || t.includes('weixin') || l.includes('weixin')) {
        return {
            icon: 'fa-brands fa-weixin',
            label: 'WeChat',
            color: '#07C160',
            badgeBg: 'rgba(7, 193, 96, 0.12)'
        };
    }
    if (t.includes('whatsapp') || l.includes('wa.me')) {
        return {
            icon: 'fa-brands fa-whatsapp',
            label: 'WhatsApp',
            color: '#25D366',
            badgeBg: 'rgba(37, 211, 102, 0.12)'
        };
    }
    if (t.includes('facebook') || t.includes('fb') || l.includes('facebook.com') || l.includes('fb.com')) {
        return {
            icon: 'fa-brands fa-facebook',
            label: 'Facebook',
            color: '#1877F2',
            badgeBg: 'rgba(24, 119, 242, 0.12)'
        };
    }
    if (t.includes('phone') || t.includes('call') || /^[\d\s\-+()]{7,}$/.test(l)) {
        return {
            icon: 'fa-solid fa-phone',
            label: 'Phone',
            color: '#10B981',
            badgeBg: 'rgba(16, 185, 129, 0.12)'
        };
    }
    // Default fallback icon
    return {
        icon: 'fa-solid fa-arrow-up-right-from-square',
        label: accountType || 'Social Link',
        color: 'var(--primary, #0D6E77)',
        badgeBg: 'rgba(13, 110, 119, 0.12)'
    };
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
    // If already in DD/MM/YYYY format, return as-is
    const ddmmyyyy = String(dateString).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
        return `${ddmmyyyy[1].padStart(2, '0')}/${ddmmyyyy[2].padStart(2, '0')}/${ddmmyyyy[3]}`;
    }
    // For Date objects or other formats, parse and convert
    const date = (dateString instanceof Date) ? dateString : new Date(dateString);
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
    if (dateString instanceof Date) {
        return isNaN(dateString.getTime()) ? new Date(0) : dateString;
    }
    const safeDateString = String(dateString).trim();
    const monthMap = {
        'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
        'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };
    const parts = safeDateString.split(/[-\/]/);
    if (parts.length === 3) {
        let day, month, year;
        if (parts[0].length === 4) {
            // ISO format: YYYY-MM-DD or YYYY/MM/DD
            year = parseInt(parts[0], 10);
            month = parseInt(parts[1], 10) - 1;
            day = parseInt(parts[2], 10);
        } else if (isNaN(parseInt(parts[1], 10))) {
            // DD-Mon-YYYY
            day = parseInt(parts[0], 10);
            month = monthMap[parts[1].toUpperCase().substring(0, 3)];
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
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

const AIRLINE_LOCAL_LOGOS = {
    UB: './assets/airlines/mna.png'
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
    if (!code) return '';
    return AIRLINE_LOCAL_LOGOS[code] || `https://images.kiwi.com/airlines/64/${encodeURIComponent(code)}.png`;
}

export function renderAirlineName(airline, options = {}) {
    const label = String(airline || '').trim() || '—';
    const code = getAirlineLogoCode(label);
    const logoUrl = getAirlineLogoUrl(label);
    const initials = getAirlineInitials(label);
    const size = options.size === 'md' ? 'md' : options.size === 'xs' ? 'xs' : 'sm';
    const classes = ['airline-name', `airline-name-${size}`, code ? `airline-code-${code.toLowerCase()}` : '', logoUrl ? 'has-airline-logo' : 'has-airline-fallback'].filter(Boolean);
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

/**
 * Aviation Phonetic Alphabet Map
 * Custom modifications per user specifications:
 * - F: Foreign (modified from Foxtrot)
 * - Q: Queen (modified from Quebec)
 * - S: Singapore (modified from Sierra)
 */
export const PHONETIC_ALPHABET = {
    A: 'Alfa',
    B: 'Bravo',
    C: 'Charlie',
    D: 'Delta',
    E: 'Echo',
    F: 'Foreign',
    G: 'Golf',
    H: 'Hotel',
    I: 'India',
    J: 'Juliett',
    K: 'Kilo',
    L: 'Lima',
    M: 'Mike',
    N: 'November',
    O: 'Oscar',
    P: 'Papa',
    Q: 'Queen',
    R: 'Romeo',
    S: 'Singapore',
    T: 'Tango',
    U: 'Uniform',
    V: 'Victor',
    W: 'Whiskey',
    X: 'X-Ray',
    Y: 'Yankee',
    Z: 'Zulu'
};

/**
 * Converts a PNR into its phonetic spelling string (e.g. 1LP897 -> 1 Lima Papa 8 9 7).
 * @param {string} pnr
 * @returns {string}
 */
export function getPhoneticPnr(pnr) {
    if (!pnr) return '';
    return String(pnr)
        .trim()
        .split('')
        .map(char => {
            const upper = char.toUpperCase();
            return PHONETIC_ALPHABET[upper] || char;
        })
        .join(' ');
}

/**
 * Renders the aesthetic phonetic PNR expansion panel HTML.
 * @param {string} pnr
 * @param {string} containerId
 * @returns {string}
 */
export function renderPhoneticExpansionHtml(pnr, containerId = 'pnrPhoneticPanel') {
    if (!pnr) return '';
    const cleanPnr = String(pnr).trim();
    if (!cleanPnr || cleanPnr.toUpperCase() === 'N/A') return '';
    
    const chars = cleanPnr.split('');
    const fullText = getPhoneticPnr(cleanPnr);

    const chipsHtml = chars.map(char => {
        const upper = char.toUpperCase();
        const word = PHONETIC_ALPHABET[upper];
        if (word) {
            return `
                <span class="pnr-phonetic-chip is-alpha">
                    <span class="chip-char">${escapeHtml(upper)}</span>
                    <span class="chip-word">${escapeHtml(word)}</span>
                </span>
            `;
        }
        return `
            <span class="pnr-phonetic-chip is-digit">
                <span class="chip-char">${escapeHtml(char)}</span>
            </span>
        `;
    }).join('');

    return `
        <div class="pnr-phonetic-panel" id="${containerId}" style="display: none;" data-pnr="${escapeHtml(cleanPnr)}">
            <div class="pnr-phonetic-chips">
                ${chipsHtml}
            </div>
        </div>
    `;
}

/**
 * Attaches toggle and copy behavior to the phonetic PNR expansion button and panel.
 * @param {string} toggleBtnId
 * @param {string} panelId
 */
export function wirePhoneticToggle(toggleBtnId, panelId) {
    const toggleBtn = document.getElementById(toggleBtnId);
    const panel = document.getElementById(panelId);
    if (!toggleBtn || !panel) return;

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isHidden = panel.style.display === 'none' || !panel.style.display;
        if (isHidden) {
            panel.style.display = 'flex';
            toggleBtn.classList.add('is-active');
            toggleBtn.setAttribute('aria-expanded', 'true');
            toggleBtn.setAttribute('title', 'Hide phonetic spelling');
        } else {
            panel.style.display = 'none';
            toggleBtn.classList.remove('is-active');
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.setAttribute('title', 'Spell PNR phonetically');
        }
    });

    const copyBtn = panel.querySelector('.pnr-phonetic-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const textToCopy = copyBtn.dataset.copyText;
            if (textToCopy) {
                navigator.clipboard.writeText(textToCopy).then(() => {
                    showToast('Copied: ' + textToCopy, 'success');
                    const icon = copyBtn.querySelector('i');
                    if (icon) {
                        icon.className = 'fa-solid fa-check';
                        setTimeout(() => { icon.className = 'fa-regular fa-copy'; }, 1500);
                    }
                }).catch(() => {
                    showToast(textToCopy, 'info');
                });
            }
        });
    }
}

/**
 * Parses user input date string into a local Date object at midnight.
 * Supports DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD.
 * @param {string|Date} value
 * @returns {Date|null}
 */
export function parseDateInput(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
    }
    const safeStr = String(value).trim();
    if (!safeStr) return null;

    const parts = safeStr.split(/[-\/]/);
    if (parts.length === 3) {
        let day, month, year;
        if (parts[0].length === 4) {
            // YYYY-MM-DD
            year = parseInt(parts[0], 10);
            month = parseInt(parts[1], 10) - 1;
            day = parseInt(parts[2], 10);
        } else {
            // DD/MM/YYYY
            day = parseInt(parts[0], 10);
            month = parseInt(parts[1], 10) - 1;
            year = parseInt(parts[2], 10);
        }
        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && year > 1900 && month >= 0 && month < 12 && day >= 1 && day <= 31) {
            return new Date(year, month, day, 0, 0, 0, 0);
        }
    }
    const d = parseSheetDate(safeStr);
    if (d && !isNaN(d.getTime()) && d.getTime() > 0) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    }
    return null;
}

const MYANMAR_DOMESTIC_AIRPORT_CODES = new Set([
    'BMO', 'VBP', 'TVY', 'HEH', 'HOX', 'KMV', 'KAW', 'KET', 'KHM', 'KYP',
    'LSH', 'LIW', 'MDL', 'MNU', 'NYW', 'MGZ', 'MYT', 'NYT', 'NYU', 'PBU',
    'AKY', 'THL', 'SNW', 'RGN', 'VBA', 'VBK', 'BSX', 'VCC', 'MGU', 'MOG', 'SRU'
]);

const MYANMAR_DOMESTIC_CITY_NAMES = [
    'bhamo', 'bokpyin', 'dawei', 'heho', 'hommalinn', 'kalemyo', 'kawthaung',
    'kengtung', 'khamti', 'kyaukpyu', 'lashio', 'loikaw', 'mandalay', 'mawlamyaing',
    'monywa', 'myeik', 'myitkyina', 'nay pyi taw', 'naypyitaw', 'nyaung u', 'bagan',
    'putao', 'sittwe', 'tachilek', 'thandwe', 'yangon', 'ann', 'anni sakhan',
    'bassein', 'pathein', 'coco islands', 'manaung', 'monghsat', 'surbung'
];

function isMyanmarDomesticPlace(place) {
    if (!place) return false;
    const raw = String(place).trim();
    if (!raw) return false;
    const codeMatch = raw.match(/\(([A-Z]{3})\)/i) || raw.match(/^([A-Z]{3})$/i);
    if (codeMatch && MYANMAR_DOMESTIC_AIRPORT_CODES.has(codeMatch[1].toUpperCase())) {
        return true;
    }
    const lower = raw.toLowerCase();
    return MYANMAR_DOMESTIC_CITY_NAMES.some(city => lower.includes(city));
}

/**
 * Extracts clean place name by removing parenthetical codes or details (e.g. "Yangon (RGN)" -> "Yangon").
 * @param {string} value
 * @returns {string}
 */
export function compactPlace(value) {
    const text = String(value || '').trim();
    if (!text) return '—';
    return text.replace(/\s*\([^)]*\)\s*/g, '').trim() || text;
}

/**
 * Normalizes city names and repairs truncated fragments (e.g. "New" -> "New Delhi", "Chiang" -> "Chiang Mai").
 * @param {string} place
 * @param {Array<Object>} [contextRows=[]]
 * @returns {string}
 */
export function cleanPlaceName(place, contextRows = []) {
    if (!place) return '';
    let clean = compactPlace(place);
    if (!clean || clean === '—') return clean;

    // 1. Check if another row in the same context/PNR has the full version of this place name
    if (Array.isArray(contextRows) && contextRows.length > 0) {
        for (const row of contextRows) {
            for (const cand of [row.departure, row.destination, row.return_departure, row.return_destination]) {
                const cleanCand = compactPlace(cand);
                if (cleanCand && cleanCand.length > clean.length) {
                    if (cleanCand.toLowerCase().startsWith(clean.toLowerCase() + ' ') ||
                        cleanCand.toLowerCase().startsWith(clean.toLowerCase() + '-')) {
                        return cleanCand;
                    }
                }
            }
        }
    }

    // 2. Known international/domestic cities with multi-word names that might have been truncated with split(' ')[0]
    const KNOWN_MULTIWORD_CITIES = [
        'New Delhi', 'Chiang Mai', 'Chiang Rai', 'Kuala Lumpur',
        'Ho Chi Minh City', 'Hong Kong', 'Nay Pyi Taw', 'Da Nang',
        'Koh Samui', 'Phnom Penh', 'Siem Reap', 'Don Mueang',
        'Abu Dhabi', 'Kolkata', 'Banda Aceh', 'Phu Quoc', 'Kota Kinabalu'
    ];

    for (const kmc of KNOWN_MULTIWORD_CITIES) {
        if (clean.toLowerCase() === kmc.split(' ')[0].toLowerCase()) {
            return kmc;
        }
    }

    return clean;
}

/**
 * Extracts unique ordered sectors (legs) for a set of tickets under a PNR.
 * Handles:
 * 1. Multiple rows representing separate legs (outbound, return, multi-sector).
 * 2. Chronological sorting (outbound before return, or sorted by departing date).
 * 3. Single-row round-trips where trip_type === 'Round-Trip' or return_date is present.
 * 4. Deduplication of sectors across multiple passengers in the same booking.
 *
 * @param {Array<Object>|Object} tickets
 * @returns {Array<{ departure: string, destination: string, departing_on: string, leg: string, airline: string }>}
 */
export function getPnrSectors(tickets) {
    const rawList = Array.isArray(tickets) ? tickets : (tickets ? [tickets] : []);
    if (rawList.length === 0) return [];

    // Filter out canceled tickets and fee-only rows when possible
    const nonCanceled = rawList.filter(t => !isCanceledTicket(t));
    const activeRows = nonCanceled.length > 0 ? nonCanceled : rawList;
    const nonFee = activeRows.filter(t => !isFeeEntryRow(t) && t.departure && t.destination);
    const candidateRows = nonFee.length > 0 ? nonFee : activeRows.filter(t => t.departure && t.destination);

    if (candidateRows.length === 0) {
        const anyWithRoute = activeRows.find(t => t.departure || t.destination);
        if (anyWithRoute) {
            const dep = cleanPlaceName(anyWithRoute.departure, activeRows);
            const dest = cleanPlaceName(anyWithRoute.destination, activeRows);
            return [{
                departure: dep,
                destination: dest,
                departing_on: String(anyWithRoute.departing_on || '').trim(),
                leg: String(anyWithRoute.leg || '').toLowerCase(),
                airline: String(anyWithRoute.airline || '').trim()
            }];
        }
        return [];
    }

    const normKey = (place) => cleanPlaceName(place, candidateRows).toLowerCase().replace(/[^a-z0-9]/g, '');
    const sectorsMap = new Map();

    const sortedRows = [...candidateRows].sort((a, b) => {
        const da = parseSheetDate(a.departing_on);
        const db = parseSheetDate(b.departing_on);
        const ta = da && !isNaN(da.getTime()) ? da.getTime() : 0;
        const tb = db && !isNaN(db.getTime()) ? db.getTime() : 0;
        if (ta !== tb && ta !== 0 && tb !== 0) return ta - tb;

        const la = String(a.leg || '').toLowerCase();
        const lb = String(b.leg || '').toLowerCase();
        if (la === 'outbound' && lb === 'return') return -1;
        if (la === 'return' && lb === 'outbound') return 1;
        return 0;
    });

    sortedRows.forEach(t => {
        if (!t.departure && !t.destination) return;
        const dep = cleanPlaceName(t.departure, candidateRows);
        const dest = cleanPlaceName(t.destination, candidateRows);
        const key = `${normKey(dep)}->${normKey(dest)}`;

        if (!sectorsMap.has(key)) {
            sectorsMap.set(key, {
                departure: dep,
                destination: dest,
                departing_on: String(t.departing_on || '').trim(),
                leg: String(t.leg || '').toLowerCase(),
                airline: String(t.airline || '').trim()
            });
        } else {
            const existing = sectorsMap.get(key);
            if (!existing.departing_on && t.departing_on) {
                existing.departing_on = String(t.departing_on).trim();
            }
            if (!existing.airline && t.airline) {
                existing.airline = String(t.airline).trim();
            }
            if (!existing.leg && t.leg) {
                existing.leg = String(t.leg).toLowerCase();
            }
        }

        const isRound = String(t.trip_type || '').toLowerCase().includes('round') ||
                        t.is_round_trip === true ||
                        !!(t.return_date || t.returning_on);
        const hasReturnDate = String(t.return_date || t.returning_on || '').trim();

        if (isRound && dep && dest) {
            const returnKey = `${normKey(dest)}->${normKey(dep)}`;
            const hasActualReturnRow = candidateRows.some(row => {
                const rDep = cleanPlaceName(row.departure, candidateRows);
                const rDest = cleanPlaceName(row.destination, candidateRows);
                return normKey(rDep) === normKey(dest) && normKey(rDest) === normKey(dep);
            });

            if (!hasActualReturnRow && !sectorsMap.has(returnKey)) {
                const retDep = cleanPlaceName(t.return_departure || dest, candidateRows);
                const retDest = cleanPlaceName(t.return_destination || dep, candidateRows);
                const retDate = hasReturnDate || '';
                const retAirline = String(t.return_airline || t.airline || '').trim();
                const synthKey = `${normKey(retDep)}->${normKey(retDest)}`;
                if (!sectorsMap.has(synthKey)) {
                    sectorsMap.set(synthKey, {
                        departure: retDep,
                        destination: retDest,
                        departing_on: retDate,
                        leg: 'return',
                        airline: retAirline
                    });
                }
            }
        }
    });

    const sectors = [...sectorsMap.values()];

    return sectors.sort((a, b) => {
        const da = parseSheetDate(a.departing_on);
        const db = parseSheetDate(b.departing_on);
        const ta = da && !isNaN(da.getTime()) ? da.getTime() : 0;
        const tb = db && !isNaN(db.getTime()) ? db.getTime() : 0;
        if (ta !== tb && ta !== 0 && tb !== 0) return ta - tb;
        if (a.leg === 'outbound' && b.leg === 'return') return -1;
        if (a.leg === 'return' && b.leg === 'outbound') return 1;
        return 0;
    });
}

/**
 * Returns formatted multi-sector or single-sector route string (e.g. "Yangon → New Delhi / New Delhi → Yangon").
 * @param {Array<Object>|Object} tickets
 * @returns {string}
 */
export function getPnrRouteDisplay(tickets) {
    const sectors = getPnrSectors(tickets);
    if (!sectors.length) {
        const fallback = Array.isArray(tickets) ? tickets[0] : tickets;
        if (fallback?.departure && fallback?.destination) {
            return `${compactPlace(fallback.departure)} → ${compactPlace(fallback.destination)}`;
        }
        return '—';
    }
    return sectors
        .map(sec => `${compactPlace(sec.departure)} → ${compactPlace(sec.destination)}`)
        .join(' / ');
}

/**
 * Returns formatted travel date string across sectors (e.g. "22-Oct-2026 / 29-Oct-2026").
 * @param {Array<Object>|Object} tickets
 * @returns {string}
 */
export function getPnrTravelDateDisplay(tickets) {
    const sectors = getPnrSectors(tickets);
    if (!sectors.length) {
        const fallback = Array.isArray(tickets) ? tickets[0] : tickets;
        return fallback?.departing_on ? String(fallback.departing_on).trim() : '—';
    }

    const formattedDates = sectors
        .map(s => {
            const raw = String(s.departing_on || '').trim();
            if (!raw) return '';
            return formatMessageDateReadable(raw) || raw;
        })
        .filter(d => d && d !== 'N/A' && d !== '—');

    const uniqueDates = [...new Set(formattedDates)];
    if (uniqueDates.length === 0) return '—';
    return uniqueDates.join(' / ');
}

/**
 * Determines whether a flight route is International (3 hours check-in) or Domestic (2 hours check-in).
 * @param {string} departure
 * @param {string} destination
 * @param {Array<{departure?: string, destination?: string}>} [legs]
 * @returns {boolean} true if International, false if Domestic
 */
export function isInternationalFlightRoute(departure, destination, legs = []) {
    if (Array.isArray(legs) && legs.length > 0) {
        return legs.some(leg => !isMyanmarDomesticPlace(leg.departure) || !isMyanmarDomesticPlace(leg.destination));
    }
    if (!departure && !destination) return false;
    return !isMyanmarDomesticPlace(departure) || !isMyanmarDomesticPlace(destination);
}

/**
 * Formats a date string into DD-MMM-YYYY (e.g., 17-Oct-2026) for customer messages.
 * @param {string|Date} value
 * @returns {string}
 */
export function formatMessageDateReadable(value) {
    if (!value) return 'N/A';
    const d = parseDateInput(value);
    if (!d || isNaN(d.getTime())) return String(value).trim() || 'N/A';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Builds a ready-to-send Customer Message in Burmese ('mm') or English ('en')
 * for either a Booking Hold ('booking') or an Issued Ticket ('ticket').
 */
export function buildCustomerMessage({
    mode = 'ticket',
    lang = 'mm',
    pnr = '',
    airline = '',
    departure = '',
    destination = '',
    routeText = '',
    legs = [],
    travelDate = '',
    deadlineText = '',
    passengers = []
} = {}) {
    const cleanPnr = String(pnr || '').trim() || 'N/A';
    const depClean = String(departure || '').trim();
    const destClean = String(destination || '').trim();
    const computedRoute = routeText
        ? String(routeText).trim()
        : (depClean || destClean ? `${depClean || 'N/A'} → ${destClean || 'N/A'}` : 'N/A');
    const readableTravelDate = travelDate
        ? (travelDate.includes('/') && !travelDate.includes(' ') ? formatMessageDateReadable(travelDate) : String(travelDate).trim())
        : 'N/A';
    const isIntl = isInternationalFlightRoute(depClean, destClean, legs);
    const paxLines = Array.isArray(passengers) && passengers.length > 0
        ? passengers.map((p) => {
            const name = typeof p === 'string' ? p : String(p?.name || 'Passenger').trim();
            const extra = typeof p === 'object' && p?.extra ? ` (${p.extra})` : '';
            return `  • ${name}${extra}`;
        }).join('\n')
        : '  • -';

    if (mode === 'booking') {
        const dl = String(deadlineText || '').trim() || 'N/A';
        if (lang === 'en') {
            return [
                `PNR: ${cleanPnr} (${computedRoute}, ${readableTravelDate}) booking has been placed on hold.`,
                ``,
                airline ? `• Airline : ${airline}` : null,
                `• Route : ${computedRoute}`,
                `• Travel Date : ${readableTravelDate}`,
                `• Passenger(s) :\n${paxLines}`,
                `• Booking Deadline: ${dl}`,
                ``,
                `⏰ Kindly Note — The booking deadline is ${dl}. Please confirm and complete ticket issuance before the deadline to avoid automatic cancellation.`,
                ``,
                `Thank you for choosing Ocean Air Ticket! 💙`
            ].filter(line => line !== null).join('\n');
        }

        return [
            `PNR: ${cleanPnr} (${computedRoute}, ${readableTravelDate}) အတွက် booking တင်ပြီးပါပြီခင်ဗျာ။`,
            ``,
            airline ? `• လေကြောင်းလိုင်း : ${airline}` : null,
            `• ခရီးစဉ် : ${computedRoute}`,
            `• ခရီးသွားမည့်ရက် : ${readableTravelDate}`,
            `• ခရီးသည် :\n${paxLines}`,
            `• Booking Deadline: ${dl}`,
            ``,
            `⏰ သတိပြုရန် — Booking deadline မှာ ${dl} ဖြစ်ပါသဖြင့် သတ်မှတ်ချိန်မတိုင်မီ လက်မှတ်အပြီးသတ်ဖြတ်ရန် အတည်ပြုပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်ခင်ဗျာ။ (သတ်မှတ်ချိန်ကျော်လွန်ပါက Booking အလိုအလျောက် ပျက်ပြယ်သွားပါမည်။)`,
            ``,
            `Ocean Air Ticket ကို ရွေးချယ်အားပေးမှုအတွက် အထူးကျေးဇူးတင်ရှိပါသည်ခင်ဗျာ။ 💙`
        ].filter(line => line !== null).join('\n');
    }

    // mode === 'ticket' (Issued Ticket)
    if (lang === 'en') {
        const checkinLineEn = isIntl
            ? `• International Flight: Please arrive at the airport check-in counter at least 3 hours before departure (3 hours before departure on international).`
            : `• Domestic Flight: Please arrive at the airport check-in counter at least 2 hours before departure (2 hours before departure on domestic).`;
        const docLineEn = isIntl
            ? `• Please bring your original NRC and valid Passport (at least 6 months validity) for airport check-in.`
            : `• Please bring your original NRC (National Registration Card) for airport check-in.`;

        return [
            `PNR: ${cleanPnr} (${computedRoute}, ${readableTravelDate}) flight ticket has been successfully issued.`,
            ``,
            airline ? `• Airline : ${airline}` : null,
            `• Route : ${computedRoute}`,
            `• Travel Date : ${readableTravelDate}`,
            `• Passenger(s) :\n${paxLines}`,
            ``,
            `🕒 Airport Check-in Reminder`,
            checkinLineEn,
            docLineEn,
            ``,
            `Wishing you a pleasant and safe journey! Thank you for choosing Ocean Air Ticket. 💙`
        ].filter(line => line !== null).join('\n');
    }

    const checkinLineMm = isIntl
        ? `• ပြည်ပခရီးစဉ် (International Flight) ဖြစ်ပါသဖြင့် ကွင်းချိန်းမှာ လေယာဉ်မထွက်ခွာမီ အနည်းဆုံး (၃) နာရီကြိုတင်၍ (3 hours before departure on international) လေဆိပ်သို့ အရောက်သွားပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။`
        : `• ပြည်တွင်းခရီးစဉ် (Domestic Flight) ဖြစ်ပါသဖြင့် ကွင်းချိန်းမှာ လေယာဉ်မထွက်ခွာမီ အနည်းဆုံး (၂) နာရီကြိုတင်၍ (2 hours before departure on domestic) လေဆိပ်သို့ အရောက်သွားပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။`;
    const docLineMm = isIntl
        ? `• လေဆိပ်သို့သွားရာတွင် မှတ်ပုံတင် (NRC မူရင်း) နှင့် Passport မူရင်း (သက်တမ်း ၆ လအထက်) တစ်ပါတည်း ယူဆောင်သွားပေးပါခင်ဗျာ။`
        : `• လေဆိပ်သို့သွားရာတွင် မှတ်ပုံတင် (NRC မူရင်း) တစ်ပါတည်း ယူဆောင်သွားပေးပါခင်ဗျာ။`;

    return [
        `PNR: ${cleanPnr} (${computedRoute}, ${readableTravelDate}) အတွက် လေယာဉ်လက်မှတ် ဖြတ်ပြီးပါပြီခင်ဗျာ။`,
        ``,
        airline ? `• လေကြောင်းလိုင်း : ${airline}` : null,
        `• ခရီးစဉ် : ${computedRoute}`,
        `• ခရီးသွားမည့်ရက် : ${readableTravelDate}`,
        `• ခရီးသည် :\n${paxLines}`,
        ``,
        `🕒 လေဆိပ်ကွင်းချိန်း သတိပေးချက် (Airport Check-in)`,
        checkinLineMm,
        docLineMm,
        ``,
        `သာယာဖြောင့်ဖြူးသော ခရီးစဉ်ဖြစ်ပါစေကြောင်း Ocean Air Ticket မှ ဆုမွန်ကောင်းတောင်းအပ်ပါသည်ခင်ဗျာ။ 💙`
    ].filter(line => line !== null).join('\n');
}

/**
 * Copies text to clipboard with fallback and returns a boolean indicating success.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyCustomerMessageToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) {
        // Fall through to textarea fallback
    }
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
        return true;
    } catch (_) {
        return false;
    }
}


