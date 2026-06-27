/**
 * @fileoverview Premium global search for clients, tickets, PNRs, and accounts.
 * Refactor: strict multi-word ranking, suggestions route to Search Results,
 * inline client detail view inside Search Results page.
 */

import { state } from './state.js';
import { parseSheetDate, formatDateForSheet, formatDateToDDMMYYYY, formatDateToDMMMY, attachDateAutoFormat, isPlaceholderDate, debounce, showToast, isTicketPaid, renderAirlineName } from './utils.js';
import { showView, openModal, closeModal, scanPassportWithGemini } from './ui.js';
import { ocrPassport } from './passport-ocr.js';
import { batchUpdateTickets } from './db.js';
import { sellTicketForClient, bookForClient, reserveHotelForClient } from './clients.js';
import { showDetails } from './tickets.js';
import { findTicketForManage } from './manage.js';
import { openPhotoLightbox } from './passport.js';

const RECENT_SEARCH_KEY = 'oceanRecentSearches';
const RESULT_LIMIT = 120;
const TYPES = ['all', 'clients', 'tickets', 'pnr', 'unpaid', 'upcoming'];
const PAYMENT_OPTIONS = ['all', 'paid', 'unpaid', 'partial'];
const SOCIAL_OPTIONS = ['all', 'viber', 'messenger', 'facebook', 'telegram'];
const DATE_OPTIONS = ['all', 'today', '7d', '30d', 'month', 'custom'];

const defaultFilters = () => ({
    dateRange: 'all',
    startDate: '',
    endDate: '',
    airline: '',
    route: '',
    payment: 'all',
    social: 'all',
    clientName: '',
    phone: '',
    accountName: '',
    bookingRef: '',
    pnr: '',
    departure: '',
    destination: '',
    issuedDate: '',
    travelDate: '',
    ticketCount: '',
    upcomingWithin: '',
    unpaidOnly: false
});

let searchState = {
    query: '',
    activeType: 'all',
    filters: defaultFilters(),
    moreOpen: false,
    lastResults: null,
    searchTimeout: null,
    previousView: 'home',
    selectedClientKey: '',
    selectedTicketId: ''
};

/* ------------------------------ utilities ------------------------------ */

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function normalize(value) {
    return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function queryTokens(query) {
    return normalize(query).split(/\s+/).filter(token => token.length >= 1);
}

function isFeeEntry(ticket) {
    const name = String(ticket?.name || '');
    const remarks = String(ticket?.remarks || '').toLowerCase();
    return /\(fees\)\s*$/i.test(name) || remarks.includes('fee entry');
}

function looksLikeNrc(value) {
    return /^\s*\d{1,2}\/[A-Z]+(?:\([A-Z]\))?\d{5,6}\s*$/i.test(String(value || ''));
}

function looksLikePassport(value) {
    const v = String(value || '').trim().toUpperCase();
    return /^[A-Z]{1,3}\d{5,9}$/.test(v) && !looksLikeNrc(v);
}

function getClientNrc(c) {
    return (looksLikeNrc(c.nrc_no) ? c.nrc_no : '') || (looksLikeNrc(c.id_no) ? c.id_no : '');
}

function getClientPassportNo(c) {
    return c.passport_no
        || (looksLikePassport(c.nrc_no) ? c.nrc_no : '')
        || (looksLikePassport(c.id_no) ? c.id_no : '');
}

function splitNrcDisplay(value) {
    const raw = String(value || '').trim();
    if (!raw) return { prefix: '—', serial: '' };
    const match = raw.match(/^(.+\([A-Z]\))(\d{5,6})$/i);
    if (match) return { prefix: match[1].toUpperCase(), serial: match[2] };
    const tail = raw.match(/^(.+?)(\d{5,6})$/);
    if (tail) return { prefix: tail[1].toUpperCase(), serial: tail[2] };
    return { prefix: raw, serial: '' };
}

function clientKeyFromTicket(ticket) {
    const baseName = String(ticket.name || '').replace(/\(fees\)\s*$/i, '').trim();
    const phone = ticket.phone && ticket.phone !== 'undefined' ? ticket.phone : '';
    const accountName = ticket.account_name && ticket.account_name !== 'undefined' ? ticket.account_name : '';
    return `${baseName}|${phone}|${accountName}`;
}

function getClientForTicket(ticket) {
    const key = clientKeyFromTicket(ticket);
    return state.allClients.find(c => c.client_key === key)
        || state.allClients.find(c =>
            normalize(c.name) === normalize(ticket.name)
            && digitsOnly(c.phone) === digitsOnly(ticket.phone)
        );
}

function ticketsForClient(clientKey) {
    return state.allTickets
        .filter(t => clientKeyFromTicket(t) === clientKey)
        .sort((a, b) => {
            const dateA = parseSheetDate(a.issued_date);
            const dateB = parseSheetDate(b.issued_date);
            
            const timeA = dateA && !isNaN(dateA.getTime()) ? dateA.getTime() : 0;
            const timeB = dateB && !isNaN(dateB.getTime()) ? dateB.getTime() : 0;
            
            if (timeA !== timeB) {
                return timeB - timeA;
            }
            
            const depA = parseSheetDate(a.departing_on);
            const depB = parseSheetDate(b.departing_on);
            const depTimeA = depA && !isNaN(depA.getTime()) ? depA.getTime() : 0;
            const depTimeB = depB && !isNaN(depB.getTime()) ? depB.getTime() : 0;
            
            return depTimeB - depTimeA;
        });
}

function isCanceled(ticket) {
    const r = String(ticket?.remarks || '').toLowerCase();
    return r.includes('cancel') || r.includes('refund');
}

function routeShort(ticket) {
    const dep = String(ticket.departure || '').split(' ')[0];
    const dest = String(ticket.destination || '').split(' ')[0];
    if (!dep && !dest) return '—';
    return `${dep || '—'} → ${dest || '—'}`;
}

function getTicketAmount(ticket) {
    return Number(ticket.net_amount || 0) + Number(ticket.extra_fare || 0) + Number(ticket.date_change || 0);
}

function getPaymentStatus(ticket) {
    if (isTicketPaid(ticket)) return 'paid';
    const pnr = normalize(ticket.booking_reference);
    const samePnr = pnr ? state.allTickets.filter(t => normalize(t.booking_reference) === pnr) : [];
    if (samePnr.some(t => isTicketPaid(t)) && samePnr.some(t => !isTicketPaid(t))) return 'partial';
    return 'unpaid';
}

function isUpcoming(ticket, days = 30) {
    const travel = parseSheetDate(ticket.departing_on);
    if (!travel || Number.isNaN(travel.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(today.getDate() + days);
    return travel >= today && travel <= end;
}

function getDateRange(range) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    const start = new Date(today);

    if (range === 'today') return { start, end };
    if (range === '7d') start.setDate(today.getDate() - 6);
    else if (range === '30d') start.setDate(today.getDate() - 29);
    else if (range === 'month') start.setDate(1);
    else return { start: null, end: null };

    return { start, end };
}

function dateWithin(value, start, end) {
    if (!start && !end) return true;
    const date = parseSheetDate(value);
    if (!date || Number.isNaN(date.getTime())) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
}

function hasAllTokensInField(field, tokens) {
    const text = normalize(field);
    return tokens.length > 0 && tokens.every(token => text.includes(token));
}

function hasAnyTokenInField(field, tokens) {
    const text = normalize(field);
    return tokens.some(token => text.includes(token));
}

function initialsOf(name) {
    return String(name || '?')
        .trim()
        .split(/\s+/)
        .map(p => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase() || '?';
}

function fmtMmk(amount) {
    const n = Math.round(Number(amount || 0));
    return `MMK ${n.toLocaleString('en-US')}`;
}

function fmtDateOrDash(value) {
    if (!value) return '—';
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime()) || value.getTime() === 0) return '—';
        return formatDateToDMMMY(formatDateForSheet(value));
    }
    return formatDateToDMMMY(value) || '—';
}

/* --------------------------- ranking ----------------------------------- */

function scoreTextField(value, query, tokens) {
    const text = normalize(value);
    if (!text || !query) return 0;
    if (text === query) return 1000;
    if (text.startsWith(query)) return 900;
    if (text.includes(query)) return 820;
    if (tokens.length && tokens.every(token => text.includes(token))) return 720;

    const matched = tokens.filter(token => text.includes(token)).length;
    if (!matched) return 0;
    if (tokens.length > 1) return Math.round((matched / tokens.length) * 260);
    return 220;
}

function qualityFromScore(score) {
    if (score >= 500) return 'best';
    if (score > 0) return 'related';
    return 'none';
}

/**
 * Common search scoring used by suggestions and the Search Results page.
 * Supports exact, prefix, phrase, all-token, and partial-token matches.
 */
function rankRecord(record, type, query) {
    const q = normalize(query);
    if (!q) return { score: 40, quality: 'best', reasons: ['No query'] };

    const tokens = queryTokens(q);
    const phone = digitsOnly(record.phone);
    const qDigits = digitsOnly(q);

    let score = 0;
    const reasons = [];

    if (type === 'ticket') {
        const pnr = normalize(record.booking_reference);
        if (pnr && pnr === q) return { score: 1400, quality: 'best', reasons: ['Exact PNR'] };
        if (pnr && pnr.startsWith(q)) {
            score = Math.max(score, 1250);
            reasons.push('PNR starts with query');
        } else if (pnr && pnr.includes(q)) {
            score = Math.max(score, 1100);
            reasons.push('PNR contains query');
        }
    }

    if (phone && qDigits) {
        if (phone === qDigits) {
            score = Math.max(score, 1200);
            reasons.push('Exact phone');
        } else if (phone.includes(qDigits)) {
            score = Math.max(score, 650);
            reasons.push('Phone contains query');
        }
    }

    const weightedFields = type === 'client'
        ? [
            ['Name', record.name, 1.0],
            ['Account', record.account_name, 0.82],
            ['Account type', record.account_type, 0.35]
        ]
        : [
            ['Passenger', record.name, 0.82],
            ['Account', record.account_name, 0.55],
            ['Route', `${record.departure || ''} ${record.destination || ''}`, 0.45],
            ['Airline', record.airline, 0.42]
        ];

    weightedFields.forEach(([label, value, weight]) => {
        const fieldScore = Math.round(scoreTextField(value, q, tokens) * weight);
        if (fieldScore > score) {
            score = fieldScore;
            reasons.length = 0;
            reasons.push(`${label} match`);
        }
    });

    const haystack = weightedFields.map(([, value]) => normalize(value)).join(' ');
    if (tokens.length > 1 && tokens.every(token => haystack.includes(token))) {
        score = Math.max(score, type === 'client' ? 690 : 520);
        reasons.push('All words across fields');
    }

    return { score, quality: qualityFromScore(score), reasons };
}

function buildClientResult(client, query = searchState.query) {
    if (String(client.name || '').includes('(Fees)')) return null;
    const rank = rankRecord(client, 'client', query);
    return {
        kind: 'client',
        id: client.client_key,
        data: client,
        score: rank.score,
        quality: rank.quality,
        label: client.name || 'Unknown client'
    };
}

function buildTicketResult(ticket, query = searchState.query) {
    if (isFeeEntry(ticket)) return null;
    const rank = rankRecord(ticket, 'ticket', query);
    const payment = getPaymentStatus(ticket);
    return {
        kind: 'ticket',
        id: ticket.id || `${ticket.booking_reference}|${ticket.name}`,
        data: ticket,
        score: rank.score,
        quality: rank.quality,
        payment,
        label: ticket.booking_reference || ticket.name || 'Ticket'
    };
}

function buildAllRankedResults(query = searchState.query) {
    const clients = state.allClients.map(c => buildClientResult(c, query)).filter(Boolean);
    const tickets = state.allTickets.map(t => buildTicketResult(t, query)).filter(Boolean);
    return [...clients, ...tickets]
        .filter(result => {
            if (!query) return true;
            return result.quality !== 'none' && result.score > 0;
        })
        .sort((a, b) => b.score - a.score || getSortDate(b) - getSortDate(a));
}

function getSortDate(result) {
    const raw = result.kind === 'client' ? result.data.last_issued : result.data.issued_date;
    const date = raw instanceof Date ? raw : parseSheetDate(raw);
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function applyFilters(results, options = {}) {
    const { ignoreActiveType = false } = options;
    const f = searchState.filters;
    let { start, end } = getDateRange(f.dateRange);
    if (f.dateRange === 'custom') {
        start = f.startDate ? parseSheetDate(f.startDate) : null;
        end = f.endDate ? parseSheetDate(f.endDate) : null;
        if (start) start.setHours(0, 0, 0, 0);
        if (end) end.setHours(23, 59, 59, 999);
    }

    return results.filter(result => {
        const data = result.data;
        if (!ignoreActiveType) {
            if (searchState.activeType === 'clients' && result.kind !== 'client') return false;
            if (searchState.activeType === 'tickets' && result.kind !== 'ticket') return false;
            if (searchState.activeType === 'pnr' && !(result.kind === 'ticket' && data.booking_reference)) return false;
            if (searchState.activeType === 'unpaid' && !(result.kind === 'ticket' && result.payment !== 'paid')) return false;
            if (searchState.activeType === 'upcoming' && !(result.kind === 'ticket' && isUpcoming(data))) return false;
        }

        if (f.payment !== 'all' && result.kind === 'ticket' && result.payment !== f.payment) return false;
        if (f.payment !== 'all' && result.kind === 'client') return false;
        if (f.unpaidOnly && !(result.kind === 'ticket' && result.payment !== 'paid')) return false;

        if (f.social !== 'all' && normalize(data.account_type) !== normalize(f.social)) return false;
        if (f.airline && result.kind === 'ticket' && normalize(data.airline) !== normalize(f.airline)) return false;
        if (f.airline && result.kind === 'client') return false;

        if (f.route && result.kind === 'ticket') {
            const [dep, dest] = f.route.split('|');
            if (dep && normalize(data.departure) !== normalize(dep)) return false;
            if (dest && normalize(data.destination) !== normalize(dest)) return false;
        }
        if (f.route && result.kind === 'client') return false;

        if (f.clientName && !normalize(data.name).includes(normalize(f.clientName))) return false;
        if (f.phone && !digitsOnly(data.phone).includes(digitsOnly(f.phone))) return false;
        if (f.accountName && !normalize(data.account_name).includes(normalize(f.accountName))) return false;
        if (f.bookingRef && !normalize(data.booking_reference).includes(normalize(f.bookingRef))) return false;
        if (f.pnr && !normalize(data.booking_reference).includes(normalize(f.pnr))) return false;
        if (f.departure && normalize(data.departure) !== normalize(f.departure)) return false;
        if (f.destination && normalize(data.destination) !== normalize(f.destination)) return false;
        if (f.issuedDate && !(result.kind === 'ticket' && formatDateForSheet(parseSheetDate(data.issued_date)) === f.issuedDate)) return false;
        if (f.travelDate && !(result.kind === 'ticket' && formatDateForSheet(parseSheetDate(data.departing_on)) === f.travelDate)) return false;
        if (f.ticketCount && result.kind === 'client' && Number(data.ticket_count || 0) < Number(f.ticketCount)) return false;
        if (f.upcomingWithin && !(result.kind === 'ticket' && isUpcoming(data, Number(f.upcomingWithin)))) return false;
        if (result.kind === 'ticket' && !dateWithin(data.issued_date, start, end)) return false;

        return true;
    });
}

function getSearchResults() {
    const ranked = buildAllRankedResults();
    const filtered = applyFilters(ranked).slice(0, RESULT_LIMIT);
    const best = filtered.filter(r => r.quality === 'best');
    const related = filtered.filter(r => r.quality === 'related');
    const allForCounts = applyFilters(ranked.map(r => ({ ...r })), { ignoreActiveType: true });
    const counts = countByType(allForCounts);
    searchState.lastResults = { all: filtered, best, related, counts };
    return searchState.lastResults;
}

function countByType(results) {
    return {
        all: results.length,
        clients: results.filter(r => r.kind === 'client').length,
        tickets: results.filter(r => r.kind === 'ticket').length,
        pnr: results.filter(r => r.kind === 'ticket' && r.data.booking_reference).length,
        unpaid: results.filter(r => r.kind === 'ticket' && r.payment !== 'paid').length,
        upcoming: results.filter(r => r.kind === 'ticket' && isUpcoming(r.data)).length
    };
}

/* ----------------------- URL state ------------------------------------- */

function readSearchUrl() {
    const hash = window.location.hash;
    const queryIndex = hash.indexOf('?');
    const params = queryIndex >= 0 ? new URLSearchParams(hash.slice(queryIndex + 1)) : new URLSearchParams();
    searchState.query = params.get('q') || '';
    searchState.activeType = TYPES.includes(params.get('type')) ? params.get('type') : 'all';
    searchState.selectedClientKey = params.get('client') || '';
    searchState.selectedTicketId = params.get('ticket') || '';

    searchState.filters = {
        ...defaultFilters(),
        dateRange: params.get('date') || 'all',
        startDate: params.get('start') || '',
        endDate: params.get('end') || '',
        airline: params.get('airline') || '',
        route: params.get('route') || '',
        payment: PAYMENT_OPTIONS.includes(params.get('payment')) ? params.get('payment') : 'all',
        social: SOCIAL_OPTIONS.includes(params.get('social')) ? params.get('social') : 'all',
        clientName: params.get('clientName') || '',
        phone: params.get('phone') || '',
        accountName: params.get('account') || '',
        bookingRef: params.get('booking') || '',
        pnr: params.get('pnr') || '',
        departure: params.get('departure') || '',
        destination: params.get('destination') || '',
        issuedDate: params.get('issued') || '',
        travelDate: params.get('travel') || '',
        ticketCount: params.get('ticketCount') || '',
        upcomingWithin: params.get('upcoming') || '',
        unpaidOnly: params.get('unpaid') === 'true'
    };
}

function updateSearchUrl(push = false) {
    const params = new URLSearchParams();
    const f = searchState.filters;
    if (searchState.query) params.set('q', searchState.query);
    if (searchState.activeType !== 'all') params.set('type', searchState.activeType);
    if (searchState.selectedClientKey) params.set('client', searchState.selectedClientKey);
    if (searchState.selectedTicketId) params.set('ticket', searchState.selectedTicketId);
    if (f.dateRange !== 'all') params.set('date', f.dateRange);
    if (f.startDate) params.set('start', f.startDate);
    if (f.endDate) params.set('end', f.endDate);
    if (f.airline) params.set('airline', f.airline);
    if (f.route) params.set('route', f.route);
    if (f.payment !== 'all') params.set('payment', f.payment);
    if (f.social !== 'all') params.set('social', f.social);
    if (f.clientName) params.set('clientName', f.clientName);
    if (f.phone) params.set('phone', f.phone);
    if (f.accountName) params.set('account', f.accountName);
    if (f.bookingRef) params.set('booking', f.bookingRef);
    if (f.pnr) params.set('pnr', f.pnr);
    if (f.departure) params.set('departure', f.departure);
    if (f.destination) params.set('destination', f.destination);
    if (f.issuedDate) params.set('issued', f.issuedDate);
    if (f.travelDate) params.set('travel', f.travelDate);
    if (f.ticketCount) params.set('ticketCount', f.ticketCount);
    if (f.upcomingWithin) params.set('upcoming', f.upcomingWithin);
    if (f.unpaidOnly) params.set('unpaid', 'true');

    const next = `#/search${params.toString() ? `?${params}` : ''}`;
    if (window.location.hash !== next) {
        if (push) history.pushState(null, '', next);
        else history.replaceState(null, '', next);
    }
}

/* -------------------- recent searches ---------------------------------- */

function saveRecentSearch(query) {
    const q = query.trim();
    if (!q) return;
    const existing = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]');
    const next = [q, ...existing.filter(item => item.toLowerCase() !== q.toLowerCase())].slice(0, 6);
    localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
}

function getRecentSearches() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]').filter(Boolean).slice(0, 5);
    } catch {
        return [];
    }
}

/* -------------------- navigation helpers ------------------------------- */

function captureReturnView() {
    const activeView = document.querySelector('.view.active')?.id?.replace(/-view$/, '');
    if (activeView && activeView !== 'search') searchState.previousView = activeView;
}

function navigateToSearch(query, push = true) {
    const q = (query || '').trim();
    if (q) saveRecentSearch(q);
    searchState.query = q;
    searchState.selectedClientKey = '';
    searchState.selectedTicketId = '';
    captureReturnView();
    updateSearchUrl(push);
    showView('search');
    initSearchView();
}

function navigateToAccount(accountName) {
    if (!accountName) return;
    searchState.query = '';
    searchState.activeType = 'clients';
    searchState.filters = { ...defaultFilters(), accountName };
    searchState.selectedClientKey = '';
    searchState.selectedTicketId = '';
    captureReturnView();
    updateSearchUrl(true);
    showView('search');
    initSearchView();
}

export function navigateToClient(clientKey, query = '') {
    if (!clientKey) return;
    if (query) {
        searchState.query = query.trim();
        saveRecentSearch(searchState.query);
    }
    searchState.selectedClientKey = clientKey;
    searchState.selectedTicketId = '';
    captureReturnView();
    updateSearchUrl(true);
    showView('search');
    initSearchView();
}

function navigateToTicket(ticketId, query = '') {
    if (!ticketId) return;
    if (query) {
        searchState.query = query.trim();
        saveRecentSearch(searchState.query);
    }
    searchState.selectedTicketId = ticketId;
    searchState.selectedClientKey = '';
    captureReturnView();
    updateSearchUrl(true);
    showView('search');
    initSearchView();
}

function closeSearchView() {
    searchState.selectedClientKey = '';
    searchState.selectedTicketId = '';
    const target = searchState.previousView || 'home';
    history.pushState(null, '', '#/');
    showView(target);
}

/* -------------------- highlighting ------------------------------------- */

function highlightText(value, query = searchState.query) {
    const text = escapeHtml(value || '—');
    const tokens = queryTokens(query).sort((a, b) => b.length - a.length);
    if (!tokens.length) return text;
    let highlighted = text;
    tokens.forEach(token => {
        const safe = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        highlighted = highlighted.replace(new RegExp(`(${safe})`, 'gi'), '<mark class="search-highlight">$1</mark>');
    });
    return highlighted;
}

function paymentBadge(payment) {
    const status = payment;
    const label = status === 'paid' ? 'Paid' : status === 'partial' ? 'Partial' : 'Unpaid';
    return `<span class="payment-badge payment-${status}">${label}</span>`;
}

function getTicketClientKey(ticket) {
    return getClientForTicket(ticket)?.client_key || '';
}

/* -------------------- list view rendering ------------------------------ */

function renderTabs(counts) {
    const labels = {
        all: 'All',
        clients: 'Clients',
        tickets: 'Tickets',
        pnr: 'PNR',
        unpaid: 'Unpaid',
        upcoming: 'Upcoming'
    };
    const tabs = document.getElementById('searchTypeTabs');
    if (!tabs) return;
    tabs.innerHTML = TYPES.map(type => `
        <button type="button" class="search-type-tab ${searchState.activeType === type ? 'active' : ''}" data-search-type="${type}">
            ${labels[type]} <span>${counts[type] || 0}</span>
        </button>
    `).join('');

    tabs.querySelectorAll('[data-search-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            searchState.activeType = btn.dataset.searchType;
            refreshSearchView();
        });
    });
}

function renderFilterBar() {
    const bar = document.getElementById('searchFilterBar');
    if (!bar) return;

    const airlines = [...new Set(state.allTickets.map(t => t.airline).filter(Boolean))].sort();
    const routes = [...new Map(state.allTickets
        .filter(t => t.departure || t.destination)
        .map(t => [`${t.departure || ''}|${t.destination || ''}`, `${routeShort(t)}`])
    ).entries()];

    bar.innerHTML = `
        <label>Result Type
            <select data-filter="activeType">
                ${TYPES.map(type => `<option value="${type}" ${searchState.activeType === type ? 'selected' : ''}>${type === 'pnr' ? 'PNR' : type[0].toUpperCase() + type.slice(1)}</option>`).join('')}
            </select>
        </label>
        <label>Date Range
            <select data-filter="dateRange">
                <option value="all">All dates</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="month">This Month</option>
                <option value="custom">Custom</option>
            </select>
        </label>
        <label>Airline
            <select data-filter="airline">
                <option value="">All airlines</option>
                ${airlines.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('')}
            </select>
        </label>
        <label>Route
            <select data-filter="route">
                <option value="">All routes</option>
                ${routes.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}
            </select>
        </label>
        <label>Payment
            <select data-filter="payment">
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partially Paid</option>
            </select>
        </label>
        <label>Social Type
            <select data-filter="social">
                ${SOCIAL_OPTIONS.map(t => `<option value="${t}">${t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}</option>`).join('')}
            </select>
        </label>
        <button type="button" class="search-more-btn" id="searchMoreBtn">
            <i class="fa-solid fa-sliders"></i> More Filters
        </button>
    `;

    setFilterBarValues();
    bar.querySelectorAll('select').forEach(select => select.addEventListener('change', () => {
        const key = select.dataset.filter;
        if (key === 'activeType') searchState.activeType = select.value;
        else searchState.filters[key] = select.value;
        refreshSearchView();
    }));
    document.getElementById('searchMoreBtn')?.addEventListener('click', () => {
        searchState.moreOpen = !searchState.moreOpen;
        renderMoreFilters();
    });
}

function setFilterBarValues() {
    const set = (sel, val) => { const e = document.querySelector(sel); if (e) e.value = val; };
    set('[data-filter="dateRange"]', searchState.filters.dateRange);
    set('[data-filter="airline"]', searchState.filters.airline);
    set('[data-filter="route"]', searchState.filters.route);
    set('[data-filter="payment"]', searchState.filters.payment);
    set('[data-filter="social"]', searchState.filters.social);
}

function renderMoreFilters() {
    const panel = document.getElementById('searchMoreFilters');
    if (!panel) return;
    panel.hidden = !searchState.moreOpen;
    document.body.classList.toggle('search-filters-open', searchState.moreOpen);
    if (!searchState.moreOpen) return;

    const locations = [...new Set([
        ...state.allTickets.map(t => t.departure),
        ...state.allTickets.map(t => t.destination)
    ].filter(Boolean))].sort();
    const airlines = [...new Set(state.allTickets.map(t => t.airline).filter(Boolean))].sort();
    const f = searchState.filters;

    panel.innerHTML = `
        <div class="search-more-head">
            <div>
                <h3>More Filters</h3>
                <p>Refine by client, PNR, route, dates, and payment state.</p>
            </div>
            <button type="button" class="search-drawer-close" id="searchDrawerClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="search-more-grid">
            ${filterInput('clientName', 'Client name', f.clientName)}
            ${filterInput('phone', 'Phone', f.phone)}
            ${filterInput('accountName', 'Account name', f.accountName)}
            ${filterInput('bookingRef', 'Booking reference', f.bookingRef)}
            ${filterInput('pnr', 'PNR', f.pnr)}
            ${filterSelect('departure', 'Departure', f.departure, locations)}
            ${filterSelect('destination', 'Destination', f.destination, locations)}
            ${filterSelect('airline', 'Airline', f.airline, airlines)}
            ${filterInput('issuedDate', 'Issued date', f.issuedDate, 'DD/MM/YYYY')}
            ${filterInput('travelDate', 'Travel date', f.travelDate, 'DD/MM/YYYY')}
            ${filterInput('ticketCount', 'Ticket count at least', f.ticketCount, '0', 'number')}
            <label>Upcoming
                <select data-more-filter="upcomingWithin">
                    <option value="">Any</option>
                    <option value="2" ${f.upcomingWithin === '2' ? 'selected' : ''}>Within 2 days</option>
                    <option value="7" ${f.upcomingWithin === '7' ? 'selected' : ''}>Within 7 days</option>
                    <option value="30" ${f.upcomingWithin === '30' ? 'selected' : ''}>Within 30 days</option>
                </select>
            </label>
            ${filterInput('startDate', 'Custom start', f.startDate, 'DD/MM/YYYY')}
            ${filterInput('endDate', 'Custom end', f.endDate, 'DD/MM/YYYY')}
            <label class="search-toggle-filter">
                <input type="checkbox" data-more-filter="unpaidOnly" ${f.unpaidOnly ? 'checked' : ''}>
                <span>Unpaid only</span>
            </label>
        </div>
        <div class="search-more-actions">
            <button type="button" class="btn btn-secondary" id="searchClearFiltersBtn"><i class="fa-solid fa-rotate-left"></i> Clear filters</button>
            <button type="button" class="btn btn-primary" id="searchApplyMoreBtn"><i class="fa-solid fa-check"></i> Apply filters</button>
        </div>
    `;

    panel.querySelectorAll('[data-more-filter]').forEach(input => {
        if (input.matches('select, input[type="checkbox"]')) {
            input.addEventListener('change', () => syncMoreFiltersFromDom(true));
            return;
        }
        input.addEventListener('input', debounce(() => syncMoreFiltersFromDom(false), 180));
    });
    document.getElementById('searchDrawerClose')?.addEventListener('click', () => {
        searchState.moreOpen = false;
        renderMoreFilters();
    });
    document.getElementById('searchClearFiltersBtn')?.addEventListener('click', clearFiltersOnly);
    document.getElementById('searchApplyMoreBtn')?.addEventListener('click', () => {
        syncMoreFiltersFromDom();
        searchState.moreOpen = false;
        refreshSearchView();
    });
}

function filterInput(key, label, value, placeholder = '', type = 'text') {
    return `<label>${label}<input type="${type}" data-more-filter="${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off"></label>`;
}

function filterSelect(key, label, value, options) {
    return `<label>${label}<select data-more-filter="${key}"><option value="">Any</option>${options.map(option => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
}

function syncMoreFiltersFromDom(shouldRefresh = true) {
    document.querySelectorAll('[data-more-filter]').forEach(input => {
        const key = input.dataset.moreFilter;
        if (input.type === 'checkbox') searchState.filters[key] = input.checked;
        else searchState.filters[key] = input.value;
    });
    if (shouldRefresh) refreshSearchView(false);
    else updateSearchUrl(false);
}

function renderHeader(results) {
    const subtitle = document.getElementById('searchSubtitle');
    const summary = document.getElementById('searchCountSummary');
    if (!subtitle || !summary) return;

    if (!searchState.query && !hasActiveFilters()) {
        subtitle.textContent = 'Use the search box in the header to find records quickly.';
        summary.textContent = '';
        return;
    }

    subtitle.innerHTML = searchState.query
        ? `Showing results for <strong>“${escapeHtml(searchState.query)}”</strong>`
        : 'Filtered results';
    summary.textContent = `${results.best.length} best matches · ${results.related.length} related matches`;
}

function renderResults(results) {
    const container = document.getElementById('searchResultsContainer');
    if (!container) return;

    // Removed empty state when no query is present. It now defaults to showing recent records.

    if (results.all.length === 0) {
        container.innerHTML = `
            <div class="search-empty-state search-empty-shell">
                <i class="fa-solid fa-circle-question"></i>
                <h3>No results found for “${escapeHtml(searchState.query)}”</h3>
                <p>Try a more exact phone number, PNR, booking reference, or clear filters.</p>
                <ul class="search-suggestions">
                    <li><i class="fa-solid fa-check"></i> Check spelling</li>
                    <li><i class="fa-solid fa-check"></i> Try phone number</li>
                    <li><i class="fa-solid fa-check"></i> Try PNR or booking reference</li>
                    <li><i class="fa-solid fa-check"></i> Clear filters</li>
                </ul>
                <button class="btn btn-primary" id="searchClearAllBtn"><i class="fa-solid fa-rotate-left"></i> Clear filters</button>
            </div>
        `;
        document.getElementById('searchClearAllBtn')?.addEventListener('click', clearFiltersOnly);
        return;
    }

    const rows = [
        ...sectionRows('Best Matches', results.best),
        ...sectionRows('Related Matches', results.related)
    ].join('');

    container.innerHTML = `
        <div class="search-table-shell">
            <table class="search-results-table">
                ${renderTableHead()}
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
    wireResultActions(container);
}

function renderTableHead() {
    return `
        <thead><tr>
            <th>Issue Date</th><th>Client Name</th><th>Account</th><th>Booking Ref/PNR</th><th>Route/Type</th><th>Status/Tickets</th><th>Actions</th>
        </tr></thead>
    `;
}

function sectionRows(title, rows) {
    if (!rows.length) return [];
    return [
        `<tr class="search-section-row"><td colspan="7">${title} <span>${rows.length}</span></td></tr>`,
        ...rows.map(renderRow)
    ];
}

function renderRow(result) {
    if (result.kind === 'client') {
        const c = result.data;
        return `
            <tr class="search-row" data-kind="client" data-client-key="${escapeHtml(c.client_key)}">
                <td>${fmtDateOrDash(c.last_issued)}</td>
                <td class="strong-cell">
                    <div class="cell-with-avatar">
                        <span class="cell-avatar">${escapeHtml(initialsOf(c.name))}</span>
                        <span>${highlightText(c.name)}</span>
                    </div>
                </td>
                <td>${highlightText(c.account_name || '—')}</td>
                <td>—</td>
                <td>Client (${escapeHtml(c.account_type || '—')})</td>
                <td>${Number(c.ticket_count || 0)} tickets</td>
                <td>${clientActions(c.client_key)}</td>
            </tr>
        `;
    }

    const t = result.data;
    const clientKey = getTicketClientKey(t);
    return `
        <tr class="search-row" data-kind="ticket" data-ticket-id="${escapeHtml(t.id || '')}" data-client-key="${escapeHtml(clientKey)}" data-pnr="${escapeHtml(t.booking_reference || '')}">
            <td>${fmtDateOrDash(t.issued_date)}</td>
            <td class="strong-cell">
                <div class="cell-with-avatar">
                    <span class="cell-avatar ticket-avatar"><i class="fa-solid fa-ticket"></i></span>
                    <span class="${clientKey ? 'clickable-client-link' : ''}" data-client-key="${escapeHtml(clientKey)}" ${clientKey ? 'style="cursor:pointer; color:var(--primary-accent);"' : ''} title="${clientKey ? 'View Client' : ''}">${highlightText(String(t.name || '—').replace(/\\(fees\\)\\s*$/i, '').trim())}</span>
                </div>
            </td>
            <td>${highlightText(t.account_name || '—')}</td>
            <td><strong>${t.booking_reference ? `<a href="#" class="clickable-pnr" data-pnr="${escapeHtml(t.booking_reference)}">${highlightText(t.booking_reference)}</a>` : '—'}</strong></td>
            <td>${escapeHtml(routeShort(t))}</td>
            <td>${paymentBadge(result.payment)}</td>
            <td>${ticketActions(Boolean(clientKey), result.payment !== 'paid')}</td>
        </tr>
    `;
}

function clientActions(clientKey) {
    return `
        <div class="search-row-actions">
            <button type="button" class="search-action-btn" data-action="view-client" data-client-key="${escapeHtml(clientKey)}">View</button>
            <button type="button" class="search-action-btn" data-action="booking-client" data-client-key="${escapeHtml(clientKey)}">Booking</button>
            <button type="button" class="search-action-btn primary" data-action="sell-client" data-client-key="${escapeHtml(clientKey)}">Sell</button>
        </div>
    `;
}

function ticketActions(canSell, canSettle) {
    return `
        <div class="search-row-actions">
            <button type="button" class="search-action-btn" data-action="view-ticket">View</button>
            <button type="button" class="search-action-btn" data-action="booking-ticket">Booking</button>
            ${canSell ? '<button type="button" class="search-action-btn primary" data-action="sell-ticket">Sell</button>' : ''}
            ${canSettle ? '<button type="button" class="search-action-btn coral" data-action="settle-ticket">Settle</button>' : ''}
        </div>
    `;
}

function wireResultActions(container) {
    container.querySelectorAll('.search-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;

            const clientLink = e.target.closest('.clickable-client-link');
            if (clientLink && clientLink.dataset.clientKey) {
                navigateToClient(clientLink.dataset.clientKey);
                return;
            }

            if (row.dataset.kind === 'client') navigateToClient(row.dataset.clientKey);
            else if (row.dataset.ticketId) showDetails(row.dataset.ticketId);
        });
    });

    container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const row = btn.closest('.search-row');
            const action = btn.dataset.action;
            const clientKey = btn.dataset.clientKey || row?.dataset.clientKey;
            const ticketId = row?.dataset.ticketId;
            const pnr = row?.dataset.pnr;

            if (action === 'view-client' && clientKey) navigateToClient(clientKey);
            if (action === 'booking-client' && clientKey) bookForClient(clientKey);
            if (action === 'sell-client' && clientKey) sellTicketForClient(clientKey);
            if (action === 'view-ticket' && ticketId) showDetails(ticketId);
            if (action === 'booking-ticket' && pnr) {
                showView('manage');
                findTicketForManage(pnr);
            }
            if (action === 'sell-ticket' && clientKey) sellTicketForClient(clientKey);
            if (action === 'settle-ticket') showView('settle');
        });
    });
}

function hasActiveFilters() {
    const f = searchState.filters;
    return searchState.activeType !== 'all'
        || Object.entries(f).some(([key, value]) => key === 'unpaidOnly' ? value : value && value !== 'all');
}

function clearFiltersOnly() {
    searchState.activeType = 'all';
    searchState.filters = defaultFilters();
    searchState.moreOpen = false;
    refreshSearchView();
}

function showSkeleton() {
    const container = document.getElementById('searchResultsContainer');
    if (!container) return;
    container.innerHTML = `
        <div class="search-table-shell">
            <table class="search-results-table">
                ${renderTableHead()}
                <tbody>
                    ${Array.from({ length: 6 }).map(() => `
                        <tr class="search-skeleton-row"><td colspan="7"><span></span></td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function refreshSearchView(useDelay = true) {
    clearTimeout(searchState.searchTimeout);
    if (searchState.selectedClientKey) {
        searchState.searchTimeout = setTimeout(() => {
            renderClientDetailView();
            updateSearchUrl(false);
        }, 0);
        return;
    }
    if (useDelay) showSkeleton();
    searchState.searchTimeout = setTimeout(() => {
        showListView();
        const results = getSearchResults();
        renderHeader(results);
        renderTabs(results.counts);
        renderFilterBar();
        renderMoreFilters();
        renderResults(results);
        updateSearchUrl(false);
    }, useDelay ? 80 : 0);
}

function showListView() {
    document.getElementById('searchListContainer')?.removeAttribute('hidden');
    document.getElementById('searchClientDetail')?.setAttribute('hidden', '');
}

function showDetailView() {
    document.getElementById('searchListContainer')?.setAttribute('hidden', '');
    document.getElementById('searchClientDetail')?.removeAttribute('hidden');
}

/* ----------------------- client detail view ----------------------------- */

function renderClientDetailView() {
    const detail = document.getElementById('searchClientDetail');
    const headerEl = document.getElementById('searchViewHeader');
    if (!detail) return;

    const client = state.allClients.find(c => c.client_key === searchState.selectedClientKey);
    if (!client) {
        searchState.selectedClientKey = '';
        showListView();
        refreshSearchView(false);
        return;
    }

    showDetailView();
    if (headerEl) headerEl.classList.add('is-detail');

    const tickets = ticketsForClient(client.client_key);
    const activeTickets = tickets.filter(t => !isCanceled(t));
    const totalSpent = activeTickets.reduce((sum, t) => sum + getTicketAmount(t), 0);
    const totalProfit = activeTickets.reduce((sum, t) => sum + Number(t.commission || 0) + Number(t.extra_fare || 0), 0);
    const totalTicketCount = activeTickets.length;
    const lastIssuedTicket = [...tickets]
        .sort((a, b) => parseSheetDate(b.issued_date) - parseSheetDate(a.issued_date))
        .find(t => parseSheetDate(t.issued_date)?.getTime?.());
    const lastBooking = lastIssuedTicket ? lastIssuedTicket.issued_date : null;

    // route insights
    const routeCounts = {};
    let oneWay = 0;
    let roundTrip = 0;
    activeTickets.forEach(t => {
        const r = `${(t.departure || '—').split(' ')[0]} → ${(t.destination || '—').split(' ')[0]}`;
        routeCounts[r] = (routeCounts[r] || 0) + 1;
        const tt = String(t.ticket_type || '').toUpperCase();
        if (tt.includes('ROUND')) roundTrip++;
        else oneWay++;
    });
    const mostFrequentRoute = Object.entries(routeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const avgNet = totalTicketCount ? Math.round(totalSpent / totalTicketCount) : 0;

    // payment
    const paidCount = activeTickets.filter(t => getPaymentStatus(t) === 'paid').length;
    const unpaidTickets = activeTickets.filter(t => getPaymentStatus(t) !== 'paid');
    const outstanding = unpaidTickets.reduce((sum, t) => sum + getTicketAmount(t), 0);
    const paymentMethods = {};
    activeTickets.forEach(t => {
        const m = (t.payment_method || '').trim();
        if (!m) return;
        paymentMethods[m] = (paymentMethods[m] || 0) + 1;
    });
    const preferredPayment = Object.entries(paymentMethods).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    detail.innerHTML = `
        <div class="client-detail-new">
            <!-- Breadcrumb -->
            <div class="breadcrumb-nav animate-in delay-1">
                <a href="#" data-detail-action="back">Records</a>
                <span class="breadcrumb-chevron"><i class="fa-solid fa-chevron-right"></i></span>
                <a href="#" data-detail-action="back">Clients</a>
                <span class="breadcrumb-chevron"><i class="fa-solid fa-chevron-right"></i></span>
                <span class="breadcrumb-current">${escapeHtml(client.name || 'Unknown')}</span>
            </div>

            <!-- Client Header -->
            <div class="client-header animate-in delay-1">
                <div class="client-profile-info">
                    <!-- Avatar with ring -->
                    <div class="avatar-ring">
                        <div class="avatar-inner">
                            <span class="avatar-text">${escapeHtml(initialsOf(client.name))}</span>
                        </div>
                    </div>
                    <div>
                        <div class="client-name-badge-row">
                            <h2 class="client-title">${escapeHtml(client.name || 'Unknown')}</h2>
                            <span class="tag-active">
                                <span class="tag-active-dot"></span>
                                Active
                            </span>
                            ${passportExpiryBadge(client)}
                        </div>
                        <p class="client-subtitle">Client since January 2025 · ${totalTicketCount} transaction${totalTicketCount === 1 ? '' : 's'}</p>
                    </div>
                </div>
                <div class="action-buttons">
                    <button class="btn-action-edit" data-overview-action="edit">
                        <i class="fa-solid fa-pen"></i>
                        Edit Client
                    </button>
                    <button class="btn-action-secondary" data-detail-action="booking">
                        <i class="fa-solid fa-calendar-plus"></i>
                        Booking
                    </button>
                    <button class="btn-action-secondary" data-detail-action="hotel">
                        <i class="fa-solid fa-hotel"></i>
                        Hotel
                    </button>
                    <button class="btn-action-primary" data-detail-action="sell">
                        <i class="fa-solid fa-plus"></i>
                        New Ticket
                    </button>
                </div>
            </div>

            <!-- Stats Cards -->
            <div class="stats-container animate-in delay-2">
                <!-- Total Tickets -->
                <div class="stat-card">
                    <div class="stat-bg-circle bg-brand-circle"></div>
                    <div class="stat-header">
                        <div class="stat-icon-box icon-brand">
                            <i class="fa-solid fa-ticket"></i>
                        </div>
                        <span class="stat-badge badge-green-accent">+${activeTickets.filter(t => {
                            const date = parseSheetDate(t.issued_date);
                            const now = new Date();
                            return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
                        }).length} this month</span>
                    </div>
                    <div class="stat-body">
                        <p class="stat-number">${totalTicketCount}</p>
                        <p class="stat-card-label">Total Tickets</p>
                    </div>
                </div>

                <!-- Total Expense -->
                <div class="stat-card">
                    <div class="stat-bg-circle bg-orange-circle"></div>
                    <div class="stat-header">
                        <div class="stat-icon-box icon-orange">
                            <i class="fa-solid fa-wallet"></i>
                        </div>
                        <span class="stat-badge badge-slate-accent">MMK</span>
                    </div>
                    <div class="stat-body">
                        <p class="stat-number">${totalSpent.toLocaleString()}</p>
                        <p class="stat-card-label">Total Expense</p>
                    </div>
                </div>

                <!-- Total Profit -->
                <div class="stat-card">
                    <div class="stat-bg-circle bg-emerald-circle"></div>
                    <div class="stat-header">
                        <div class="stat-icon-box icon-emerald">
                            <i class="fa-solid fa-chart-line"></i>
                        </div>
                        <span class="stat-badge badge-emerald-accent">${totalSpent ? (totalProfit / totalSpent * 100).toFixed(1) : 0}% margin</span>
                    </div>
                    <div class="stat-body">
                        <p class="stat-number text-emerald">${totalProfit.toLocaleString()}</p>
                        <p class="stat-card-label">Total Profit (MMK)</p>
                    </div>
                </div>
                
                <!-- Last Booking -->
                <div class="stat-card">
                    <div class="stat-bg-circle bg-blue-circle"></div>
                    <div class="stat-header">
                        <div class="stat-icon-box icon-blue">
                            <i class="fa-solid fa-clock"></i>
                        </div>
                        <span class="stat-badge badge-slate-accent">Recent</span>
                    </div>
                    <div class="stat-body">
                        <p class="stat-number" style="font-size: 1.25rem; padding-top: 0.4rem; font-weight:700;">${fmtDateOrDash(lastBooking)}</p>
                        <p class="stat-card-label">Last Booking</p>
                    </div>
                </div>
            </div>

            <!-- Two Column Layout: Client Overview + Travel Documents -->
            <div class="two-col-grid animate-in delay-3">
                <!-- Left Stack: Overview + Insights + Payment -->
                <div style="display: flex; flex-direction: column; gap: 1.5rem; height: 100%;">
                    ${overviewCard(client)}
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; flex: 1;">
                        ${insightsCard(mostFrequentRoute, oneWay, roundTrip, avgNet)}
                        ${paymentCard(paidCount, unpaidTickets.length, outstanding, preferredPayment)}
                    </div>
                </div>

                <!-- Right Stack: Travel Documents -->
                <div class="docs-stack">
                    ${documentsCard(client)}
                </div>
            </div>

            <!-- Ticket History -->
            <div class="animate-in delay-4">
                ${ticketHistorySection(client, tickets)}
            </div>

            <p class="footer-notice">All amounts in MMK (Myanmar Kyat) · Secure · Private · Confidential</p>
        </div>
    `;

    wireDetailActions(detail, client, tickets);
}

function passportExpiryBadge(client) {
    const expiry = client.passport_expiry || '';
    if (!expiry) return '';
    const status = computePassportExpiryStatus(expiry);
    if (status.level === 'ok') return '';
    if (status.level === 'expired') {
        return `<span class="tag-cancelled text-xs font-semibold px-2.5 py-1 rounded-full border border-red-200" style="margin-left: 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem;"><i class="fa-solid fa-circle-xmark"></i> Expired ${status.daysAbs} days ago</span>`;
    }
    return `<span class="tag-pending text-xs font-semibold px-2.5 py-1 rounded-full border border-yellow-200" style="margin-left: 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem;"><i class="fa-solid fa-triangle-exclamation"></i> Expires in ${status.daysUntil} days</span>`;
}

function computePassportExpiryStatus(expiryStr) {
    const raw = String(expiryStr || '').trim();
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return { level: 'ok' };

    const dd = Number(match[1]);
    const mm = Number(match[2]);
    const yyyy = Number(match[3]);
    const expiry = new Date(yyyy, mm - 1, dd);
    if (isNaN(expiry.getTime())) return { level: 'ok' };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sixMonthsFromNow = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
    const daysDiff = Math.round((expiry - today) / (1000 * 60 * 60 * 24));
    const formatted = expiry.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    if (expiry < today) return { level: 'expired', formatted, daysAbs: Math.abs(daysDiff) };
    if (expiry < sixMonthsFromNow) return { level: 'soon', formatted, daysUntil: daysDiff };
    return { level: 'ok', formatted };
}

function overviewCard(c) {
    const phone = c.phone || '';
    const accountLink = c.account_link || '';
    const phoneVal = phone
        ? `<span class="kv-phone-row">
            <span>${escapeHtml(phone)}</span>
            <a href="tel:${escapeHtml(phone)}" class="btn-phone-call" title="Call Client"><i class="fa-solid fa-phone"></i></a>
           </span>`
        : '<span class="kv-value-empty">Not provided</span>';
    const linkVal = accountLink
        ? `<a href="${escapeHtml(accountLink)}" target="_blank" rel="noopener" class="link-overview-url"><i class="fa-solid fa-up-right-from-square"></i> View Link</a>`
        : '<span class="kv-value-empty">Not provided</span>';

    // Consistent pseudo client ID based on hash of client_key
    const clientId = c.client_key ? 'CLT-202501-' + String(Math.abs(c.client_key.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0))).slice(-4).padStart(4, '0') : 'CLT-202501-0000';

    return `
        <div class="details-card">
            <div class="card-top-bar">
                <div class="card-title-block">
                    <div class="card-icon-container icon-brand">
                        <i class="fa-solid fa-user"></i>
                    </div>
                    <h3 class="card-title-text">Client Overview</h3>
                </div>
                <button class="card-btn-action" data-overview-action="edit">
                    <i class="fa-solid fa-pen"></i> Edit
                </button>
            </div>
            <div class="card-content">
                <div class="grid-kv">
                    <div class="kv-item">
                        <span class="kv-label">Account Name</span>
                        <p class="kv-value">${escapeHtml(c.account_name || '—')}</p>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">Display Name</span>
                        <p class="kv-value">${escapeHtml(c.name || '—')}</p>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">Phone Number</span>
                        <p class="kv-value">${phoneVal}</p>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">Account Type</span>
                        <p class="kv-value">${escapeHtml(c.account_type || '—')}</p>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">Account Link</span>
                        <p class="kv-value">${linkVal}</p>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">Client ID</span>
                        <p class="kv-value" style="font-family: monospace; font-size: 0.85rem; color: #64748b;">${clientId}</p>
                    </div>
                    <div class="kv-item" style="grid-column: 1 / -1;">
                        <span class="kv-label">Frequent Flyer</span>
                        <p class="kv-value">${c.frequent_flyer_no ? escapeHtml(`${c.member_airline || 'Airline'}: ${c.frequent_flyer_no}`) : '<span class="kv-value-empty">None</span>'}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function documentsCard(c) {
    const nrcNo = getClientNrc(c);
    const passportNo = getClientPassportNo(c);
    const photo = c.passport_photo_url || '';
    const expiry = isPlaceholderDate(c.passport_expiry) ? '' : formatDateToDDMMYYYY(parseSheetDate(c.passport_expiry));
    const dob = isPlaceholderDate(c.dob) ? '' : formatDateToDDMMYYYY(parseSheetDate(c.dob));
    
    // Parse NRC details
    let stateRegion = '—';
    let township = '—';
    if (nrcNo && nrcNo.includes('/')) {
        const parts = nrcNo.split('/');
        stateRegion = parts[0] === '9' ? 'Mandalay' : parts[0] === '12' ? 'Yangon' : `State/Region ${parts[0]}`;
        if (parts[1].includes('(')) {
            township = parts[1].split('(')[0];
        }
    }

    const expiryStatus = computePassportExpiryStatus(c.passport_expiry);
    let passportStatusText = 'No Passport';
    let passportStatusClass = 'tag-cancelled';
    if (passportNo) {
        if (expiryStatus.level === 'expired') {
            passportStatusText = 'Expired';
            passportStatusClass = 'tag-cancelled';
        } else if (expiryStatus.level === 'soon') {
            passportStatusText = 'Expires Soon';
            passportStatusClass = 'tag-pending';
        } else {
            passportStatusText = 'Active';
            passportStatusClass = 'tag-completed';
        }
    }

    const expiryWarningHtml = expiryStatus.level === 'expired'
        ? `<div class="passport-warning-banner is-expired">
            <i class="fa-solid fa-circle-xmark" style="margin-top: 2px;"></i>
            <span><strong>Passport EXPIRED</strong> on ${expiryStatus.formatted} (${expiryStatus.daysAbs} days ago). A new passport is required before travel.</span>
           </div>`
        : expiryStatus.level === 'soon'
        ? `<div class="passport-warning-banner is-soon">
            <i class="fa-solid fa-triangle-exclamation" style="margin-top: 2px;"></i>
            <span><strong>Passport expires soon</strong> on ${expiryStatus.formatted} (in ${expiryStatus.daysUntil} days). Airlines require 6 months validity.</span>
           </div>`
        : '';

    return `
        <!-- NRC Card -->
        <div class="doc-card">
            <div class="doc-card-header">
                <div class="card-icon-container icon-blue">
                    <i class="fa-solid fa-credit-card"></i>
                </div>
                <h3 class="card-title-text" style="font-size: 0.875rem;">NRC Document</h3>
                <span class="doc-badge-status ${nrcNo ? 'tag-completed' : 'tag-cancelled'}">
                    ${nrcNo ? 'Verified' : 'Missing'}
                </span>
                <button class="doc-btn-edit" data-doc-action="edit" title="Edit NRC"><i class="fa-solid fa-pen"></i></button>
            </div>
            <div class="doc-card-body">
                <div class="kv-item">
                    <span class="kv-label">NRC Number</span>
                    <p class="kv-value" style="font-family: monospace; font-size: 0.9rem;">${escapeHtml((nrcNo || '—').toUpperCase())}</p>
                </div>
            </div>
        </div>

        <!-- Passport Card -->
        <div class="doc-card">
            <div class="doc-card-header">
                <div class="card-icon-container icon-purple">
                    <i class="fa-solid fa-passport"></i>
                </div>
                <h3 class="card-title-text" style="font-size: 0.875rem;">Passport Document</h3>
                <span class="doc-badge-status ${passportStatusClass}">
                    ${passportStatusText}
                </span>
                <button class="doc-btn-edit" data-doc-action="edit" title="Edit Passport"><i class="fa-solid fa-pen"></i></button>
            </div>
            <div class="doc-card-body">
                <div class="doc-row-subitems">
                    <div class="kv-item">
                        <span class="kv-label">Passport No.</span>
                        <p class="kv-value" style="font-family: monospace; font-size: 0.9rem;">${escapeHtml((passportNo || '—').toUpperCase())}</p>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">Expiry Date</span>
                        <p class="kv-value">${escapeHtml(expiry || '—')}</p>
                    </div>
                </div>
                <div class="doc-row-subitems">
                    <div class="kv-item">
                        <span class="kv-label">Date of Birth</span>
                        <p class="kv-value">${escapeHtml(dob || '—')}</p>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">Country</span>
                        <p class="kv-value">${escapeHtml(c.nationality || 'Myanmar')}</p>
                    </div>
                </div>

                <!-- Passport Photo Attachment -->
                <div class="passport-attachment-box">
                    ${photo ? `
                        <button type="button" class="passport-thumbnail-btn" data-doc-action="view">
                            <img src="${escapeHtml(photo)}" alt="Passport Photo" class="passport-thumbnail-img">
                            <div class="passport-thumbnail-overlay">
                                <i class="fa-regular fa-eye"></i> View passport photo
                            </div>
                        </button>
                    ` : `
                        <div class="passport-empty-block">
                            <i class="fa-regular fa-image passport-empty-icon"></i>
                            <p class="passport-empty-title">No passport uploaded</p>
                            <p class="passport-empty-desc">Upload a clear photo page of the passport.</p>
                        </div>
                    `}
                </div>

                <!-- Actions -->
                <div class="passport-actions">
                    <button class="btn-doc-inline" data-doc-action="view" ${photo ? '' : 'disabled'}><i class="fa-regular fa-eye"></i> View</button>
                    <button class="btn-doc-inline" data-doc-action="replace"><i class="fa-solid fa-rotate"></i> Replace</button>
                    <button class="btn-doc-inline-primary" data-doc-action="upload"><i class="fa-solid fa-upload"></i> Upload</button>
                </div>

                ${expiryWarningHtml}
            </div>
        </div>
    `;
}

function insightsCard(mostFrequentRoute, oneWay, roundTrip, avgNet) {
    return `
        <div class="details-card">
            <div class="card-top-bar">
                <div class="card-title-block">
                    <div class="card-icon-container icon-orange">
                        <i class="fa-solid fa-chart-pie"></i>
                    </div>
                    <h3 class="card-title-text" style="font-size: 0.85rem;">Client Insights</h3>
                </div>
            </div>
            <div class="card-content" style="padding: 1.25rem 1.5rem;">
                <div class="card-body-kv-list">
                    <div class="kv-list-item">
                        <span class="kv-list-label">Frequent Route</span>
                        <span class="kv-list-val">${escapeHtml(mostFrequentRoute)}</span>
                    </div>
                    <div class="kv-list-item">
                        <span class="kv-list-label">One-Way</span>
                        <span class="kv-list-val">${oneWay}</span>
                    </div>
                    <div class="kv-list-item">
                        <span class="kv-list-label">Round-Trip</span>
                        <span class="kv-list-val">${roundTrip}</span>
                    </div>
                    <div class="kv-list-item">
                        <span class="kv-list-label">Average Net</span>
                        <span class="kv-list-val" style="font-size:0.8rem;">${fmtMmk(avgNet)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function paymentCard(paid, unpaid, outstanding, preferredPayment) {
    return `
        <div class="details-card">
            <div class="card-top-bar">
                <div class="card-title-block">
                    <div class="card-icon-container icon-emerald">
                        <i class="fa-solid fa-credit-card"></i>
                    </div>
                    <h3 class="card-title-text" style="font-size: 0.85rem;">Payment Status</h3>
                </div>
            </div>
            <div class="card-content" style="padding: 1.25rem 1.5rem;">
                <div class="card-body-kv-list">
                    <div class="kv-list-item">
                        <span class="kv-list-label">Paid Bookings</span>
                        <span class="kv-list-val">${paid}</span>
                    </div>
                    <div class="kv-list-item">
                        <span class="kv-list-label">Pending Bookings</span>
                        <span class="kv-list-val">${unpaid}</span>
                    </div>
                    <div class="kv-list-item">
                        <span class="kv-list-label">Outstanding</span>
                        <span class="kv-list-val" style="color:#b91c1c; font-size:0.8rem;">${fmtMmk(outstanding)}</span>
                    </div>
                    <div class="kv-list-item">
                        <span class="kv-list-label">Preferred Pay</span>
                        <span class="kv-list-val">${escapeHtml(preferredPayment || '—')}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function ticketHistorySection(client, tickets) {
    const years = [...new Set(tickets.map(t => parseSheetDate(t.issued_date)?.getFullYear?.()).filter(Boolean))].sort((a, b) => b - a);

    const rows = tickets.map(t => {
        const status = getPaymentStatus(t);
        const upcoming = isUpcoming(t) ? 'upcoming' : (parseSheetDate(t.departing_on) < new Date() ? 'completed' : 'scheduled');
        const canceled = isCanceled(t);
        const outstandingVal = status !== 'paid' && !canceled ? getTicketAmount(t) : 0;
        
        // Generate pseudo invoice
        const issueYear = parseSheetDate(t.issued_date)?.getFullYear() || 2025;
        const ticketIdPart = String(t.id || '').replace(/\D/g, '').slice(-4).padStart(4, '0') || '0000';
        const invoiceNo = `INV-${issueYear}-${ticketIdPart}`;
        const issueDateFormatted = fmtDateOrDash(t.issued_date);

        // Parse route stations
        const routeStr = routeShort(t);
        let dep = '—';
        let dest = '—';
        if (routeStr.includes('→')) {
            const parts = routeStr.split('→');
            dep = parts[0].trim();
            dest = parts[1].trim();
        } else if (routeStr.includes('-')) {
            const parts = routeStr.split('-');
            dep = parts[0].trim();
            dest = parts[1].trim();
        } else {
            dep = routeStr;
        }

        // Airline badge details
        const airVal = String(t.airline || '—').trim();
        let airAbbr = airVal.substring(0, 3).toUpperCase();
        let logoClass = 'logo-slate';
        if (airVal.toLowerCase().includes('myanmar airways') || airVal.toLowerCase().includes('mai')) {
            airAbbr = 'MAI';
            logoClass = 'logo-yellow';
        } else if (airVal.toLowerCase().includes('air cb') || airVal.toLowerCase().includes('cb')) {
            airAbbr = 'CB';
            logoClass = 'logo-red';
        } else if (airVal.toLowerCase().includes('myanmar national') || airVal.toLowerCase().includes('8m')) {
            airAbbr = '8M';
            logoClass = 'logo-blue';
        } else if (airAbbr.length > 3) {
            airAbbr = airAbbr.substring(0, 2);
        }

        // Badge classes for status
        let statusText = 'Completed';
        let statusClass = 'tag-completed';
        if (canceled) {
            statusText = 'Canceled';
            statusClass = 'tag-cancelled';
        } else if (status !== 'paid') {
            statusText = 'Pending';
            statusClass = 'tag-pending';
        }

        return `
            <tr data-pnr="${escapeHtml(t.booking_reference || '')}" data-tt="${escapeHtml(String(t.ticket_type || '').toUpperCase().includes('ROUND') ? 'round' : 'oneway')}" data-year="${escapeHtml(String(parseSheetDate(t.issued_date)?.getFullYear?.() || ''))}" class="ticket-row ${canceled ? 'canceled-row' : ''}">
                <td>
                    <p class="text-bold-slate" style="margin: 0; font-size: 0.85rem;">${invoiceNo}</p>
                    <p class="text-slate-muted" style="margin: 2px 0 0; font-size: 0.72rem;">${issueDateFormatted}</p>
                </td>
                <td>
                    ${t.booking_reference ? `<a href="#" class="table-pnr-pill clickable-pnr" data-pnr="${escapeHtml(t.booking_reference)}">${escapeHtml(t.booking_reference)}</a>` : '—'}
                </td>
                <td>
                    <div class="route-arrow-flow">
                        <span class="route-station">${escapeHtml(dep)}</span>
                        <div class="route-line-box">
                            <div class="route-line"></div>
                            <i class="fa-solid fa-plane route-plane-icon"></i>
                            <div class="route-line"></div>
                        </div>
                        <span class="route-station">${escapeHtml(dest)}</span>
                    </div>
                </td>
                <td>
                    <p class="text-bold-slate" style="margin: 0; font-size: 0.85rem;">${fmtDateOrDash(t.departing_on)}</p>
                </td>
                <td>
                    ${renderAirlineName(t.airline || '—')}
                </td>
                <td class="num-right-align">
                    <p style="margin: 0; font-weight: 600; font-size: 0.85rem;">${outstandingVal ? outstandingVal.toLocaleString() : '—'}</p>
                    ${outstandingVal ? '<p class="text-slate-muted" style="margin: 2px 0 0; font-size: 0.68rem;">MMK</p>' : ''}
                </td>
                <td class="num-right-align">
                    <p style="margin: 0; font-weight: 600; font-size: 0.85rem;">${getTicketAmount(t).toLocaleString()}</p>
                    <p class="text-slate-muted" style="margin: 2px 0 0; font-size: 0.68rem;">MMK</p>
                </td>
                <td class="num-right-align">
                    <p class="profit-text-green" style="margin: 0; font-size: 0.85rem;">${(Number(t.commission || 0) + Number(t.extra_fare || 0)).toLocaleString()}</p>
                    <p class="text-slate-muted" style="margin: 2px 0 0; font-size: 0.68rem;">MMK</p>
                </td>
                <td style="text-align: center;">
                    <span class="tag ${statusClass}" style="padding: 0.25rem 0.65rem; border-radius: 0.5rem;">${statusText}</span>
                </td>
                <td style="text-align: center;">
                    <button class="btn-more-actions" title="Actions" data-pnr="${escapeHtml(t.booking_reference || '')}"><i class="fa-solid fa-ellipsis"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="details-card">
            <div class="card-top-bar" style="padding: 1rem 1.5rem;">
                <div class="history-header-layout">
                    <div class="history-title-badges">
                        <div class="card-icon-container icon-brand">
                            <i class="fa-solid fa-list"></i>
                        </div>
                        <h3 class="card-title-text">Ticket History</h3>
                        <span class="history-count-badge">${tickets.length}</span>
                    </div>
                    <div class="history-toolbar">
                        <div class="history-tabs" id="historyTypeTabs">
                            <button type="button" class="btn-history-tab active" data-history-tab="all">All</button>
                            <button type="button" class="btn-history-tab" data-history-tab="oneway">One-Way</button>
                            <button type="button" class="btn-history-tab" data-history-tab="round">Round-Trip</button>
                        </div>
                        <select class="history-select" id="historyYearSelect">
                            <option value="">All years</option>
                            ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
                        </select>
                        <div class="history-search-input-box">
                            <i class="fa-solid fa-magnifying-glass history-search-icon"></i>
                            <input type="text" class="history-search-input" id="historySearchInput" placeholder="Search tickets...">
                        </div>
                        <button class="history-action-btn" title="Filter"><i class="fa-solid fa-sliders"></i></button>
                        <button class="history-action-btn" title="Download History" id="downloadHistoryBtn"><i class="fa-solid fa-download"></i></button>
                    </div>
                </div>
            </div>
            <div class="table-container">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Invoice</th>
                            <th>PNR</th>
                            <th>Route</th>
                            <th>Date</th>
                            <th>Airline</th>
                            <th class="num-right-align">Outstanding</th>
                            <th class="num-right-align">Sale Price</th>
                            <th class="num-right-align">Profit</th>
                            <th style="text-align: center;">Status</th>
                            <th style="text-align: center;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="10" class="empty-row" style="text-align: center; color: #94a3b8; padding: 2rem;">No tickets on file.</td></tr>'}
                    </tbody>
                </table>
            </div>
            
            <!-- Table Footer / Pagination -->
            <div class="table-footer-pagination">
                <span class="pagination-text">Showing <strong class="text-bold-slate">${tickets.length}</strong> of <strong class="text-bold-slate">${tickets.length}</strong> tickets</span>
                <div class="pagination-buttons">
                    <button class="btn-page-nav" disabled>Previous</button>
                    <button class="btn-page-nav active">1</button>
                    <button class="btn-page-nav" disabled>Next</button>
                </div>
            </div>
        </div>
    `;
}

function wireDetailActions(detail, client, tickets) {
    detail.querySelectorAll('[data-detail-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.detailAction;
            if (action === 'sell') sellTicketForClient(client.client_key);
            else if (action === 'booking') bookForClient(client.client_key);
            else if (action === 'hotel') reserveHotelForClient(client.client_key);
            else if (action === 'back') {
                searchState.selectedClientKey = '';
                refreshSearchView(false);
            }
        });
    });

    detail.querySelectorAll('[data-doc-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.docAction;
            if (action === 'view' && client.passport_photo_url) openPhotoLightbox(client.passport_photo_url);
            if (['edit', 'replace', 'upload'].includes(action)) openTravelDocumentEditModal(client);
        });
    });

    detail.querySelectorAll('[data-overview-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.overviewAction;
            if (action === 'edit') openClientOverviewEditModal(client);
        });
    });

    // Row clicks to open details
    detail.querySelectorAll('.history-table tbody tr.ticket-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('a')) return;
            const pnr = row.dataset.pnr;
            const ticket = tickets.find(t => t.booking_reference === pnr);
            if (ticket && ticket.id) {
                showDetails(ticket.id);
            } else if (pnr) {
                showTripPlanDetail(pnr);
            }
        });
    });

    // Row ellipsis actions
    detail.querySelectorAll('.history-table .btn-more-actions').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pnr = btn.dataset.pnr;
            const ticket = tickets.find(t => t.booking_reference === pnr);
            if (ticket && ticket.id) {
                showDetails(ticket.id);
            } else if (pnr) {
                showTripPlanDetail(pnr);
            }
        });
    });

    // CSV Download
    detail.querySelector('#downloadHistoryBtn')?.addEventListener('click', () => {
        if (!tickets || !tickets.length) {
            showToast('No tickets to download.', 'error');
            return;
        }
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Invoice,PNR,Route,Departing Date,Airline,Net Amount,Profit,Status\n";
        tickets.forEach(t => {
            const status = getPaymentStatus(t);
            const canceled = isCanceled(t);
            const statusText = canceled ? 'Canceled' : (status === 'paid' ? 'Paid' : 'Pending');
            const row = [
                `INV-${parseSheetDate(t.issued_date)?.getFullYear() || 2025}-${String(t.id || '').replace(/\D/g, '').slice(-4).padStart(4, '0')}`,
                t.booking_reference || '',
                routeShort(t),
                t.departing_on || '',
                t.airline || '',
                getTicketAmount(t),
                Number(t.commission || 0) + Number(t.extra_fare || 0),
                statusText
            ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(",");
            csvContent += row + "\n";
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `ticket_history_${client.name.replace(/[^a-z0-9]/gi, '_')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Ticket history CSV downloaded successfully.', 'success');
    });

    // History tabs / filters
    const tabs = detail.querySelectorAll('[data-history-tab]');
    const yearSelect = detail.querySelector('#historyYearSelect');
    const searchInput = detail.querySelector('#historySearchInput');
    const tbody = detail.querySelector('.history-table tbody');
    const filterRows = () => {
        if (!tbody) return;
        const tab = detail.querySelector('[data-history-tab].active')?.dataset.historyTab || 'all';
        const year = yearSelect?.value || '';
        const term = (searchInput?.value || '').toLowerCase();
        tbody.querySelectorAll('tr').forEach(row => {
            if (row.classList.contains('empty-row')) return;
            const tt = row.dataset.tt;
            const ry = row.dataset.year;
            let visible = true;
            if (tab === 'oneway' && tt !== 'oneway') visible = false;
            if (tab === 'round' && tt !== 'round') visible = false;
            if (year && ry !== year) visible = false;
            if (term && !row.textContent.toLowerCase().includes(term)) visible = false;
            row.style.display = visible ? '' : 'none';
        });
    };
    tabs.forEach(t => t.addEventListener('click', () => {
        tabs.forEach(x => x.classList.toggle('active', x === t));
        filterRows();
    }));
    yearSelect?.addEventListener('change', filterRows);
    searchInput?.addEventListener('input', debounce(filterRows, 120));
}

function openTravelDocumentEditModal(client) {
    const nrcNo = getClientNrc(client);
    const passportNo = getClientPassportNo(client);
    openModal(`
        <div class="modal-header">
            <h3><i class="fa-solid fa-passport"></i> Edit Travel Documents</h3>
            <button class="modal-close-btn" data-close-modal>&times;</button>
        </div>
        <div class="modal-body-content">
            <form id="clientDocsForm" class="client-doc-edit-form">
                <div class="form-grid">
                    <div class="form-group full-width">
                        <label>Full Name</label>
                        <input type="text" id="editDocName" value="${escapeHtml(client.name || '')}" placeholder="e.g. JOHN DOE" autocomplete="off" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group full-width">
                        <label>NRC</label>
                        <input type="text" id="editDocNrc" value="${escapeHtml(nrcNo)}" placeholder="12/MAGATA(N)000000" autocomplete="off" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group">
                        <label>Passport Number</label>
                        <input type="text" id="editDocPassport" value="${escapeHtml(passportNo)}" placeholder="M1234567" autocomplete="off" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group">
                        <label>Passport Expiry</label>
                        <input type="text" id="editDocExpiry" value="${escapeHtml(isPlaceholderDate(client.passport_expiry) ? '' : formatDateToDDMMYYYY(parseSheetDate(client.passport_expiry)) || '')}" placeholder="DD/MM/YYYY" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>Nationality</label>
                        <input type="text" id="editDocNationality" value="${escapeHtml(client.nationality || 'MMR')}" placeholder="MMR" autocomplete="off" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group">
                        <label>Date of Birth</label>
                        <input type="text" id="editDocDob" value="${escapeHtml(isPlaceholderDate(client.dob) ? '' : formatDateToDDMMYYYY(parseSheetDate(client.dob)) || '')}" placeholder="DD/MM/YYYY" autocomplete="off">
                    </div>
                    <div class="form-group full-width">
                        <label>Passport Photo</label>
                        <input type="file" id="editDocPhotoFile" accept="image/*">
                        <div id="editDocOcrStatus" class="pz-ocr-status"></div>
                    </div>
                </div>
                <p class="settle-muted">Updates are saved to this client's non-fee ticket records so future client detail views show the corrected documents.</p>
                <div class="form-actions" style="margin-top:1rem">
                    <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Save Documents</button>
                </div>
            </form>
        </div>
    `, 'large-modal');

    document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModal));
    document.getElementById('clientDocsForm')?.addEventListener('submit', (e) => saveTravelDocuments(e, client));

    attachDateAutoFormat(document.getElementById('editDocExpiry'));
    attachDateAutoFormat(document.getElementById('editDocDob'));

    const photoInput = document.getElementById('editDocPhotoFile');
    const ocrStatus = document.getElementById('editDocOcrStatus');

    photoInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;

        ocrStatus.textContent = 'Scanning passport with Gemini...';
        ocrStatus.className = 'pz-ocr-status is-scanning';

        let ocrResult = null;
        try {
            ocrResult = await scanPassportWithGemini(file);
        } catch (err) {
            console.warn('[Gemini OCR failed]', err);
            ocrStatus.textContent = 'Falling back to Tesseract...';
            try {
                ocrResult = await ocrPassport(file, (msg) => {
                    ocrStatus.textContent = msg;
                    ocrStatus.className = 'pz-ocr-status is-scanning';
                });
            } catch (fallbackErr) {
                console.error('[Tesseract OCR failed]', fallbackErr);
            }
        }

        if (ocrResult) {
            const fullName = ocrResult.fullName || ocrResult.name || '';
            const passportNo = ocrResult.passportNo || ocrResult.passportNumber || '';
            const dob = ocrResult.dob || ocrResult.dateOfBirth || '';
            const expiry = ocrResult.expiry || ocrResult.expiryDate || '';
            const nationality = ocrResult.nationality || '';

            if (fullName) {
                const nameInput = document.getElementById('editDocName');
                if (nameInput) nameInput.value = fullName;
            }
            if (passportNo) {
                document.getElementById('editDocPassport').value = passportNo;
            }
            if (nationality) {
                document.getElementById('editDocNationality').value = nationality;
            }
            if (expiry && !isPlaceholderDate(expiry)) {
                document.getElementById('editDocExpiry').value = expiry;
            }
            if (dob && !isPlaceholderDate(dob)) {
                document.getElementById('editDocDob').value = dob;
            }

            ocrStatus.textContent = 'Passport data extracted';
            ocrStatus.className = 'pz-ocr-status is-success';
            showToast('Passport scanned and fields filled.', 'success');
        } else {
            ocrStatus.textContent = 'Could not extract passport data';
            ocrStatus.className = 'pz-ocr-status is-warn';
        }
    });
}

async function saveTravelDocuments(e, client) {
    e.preventDefault();
    const name = document.getElementById('editDocName')?.value.trim().toUpperCase() || '';
    const nrcNo = document.getElementById('editDocNrc')?.value.trim().toUpperCase() || '';
    const passportNo = document.getElementById('editDocPassport')?.value.trim().toUpperCase() || '';
    const passportExpiry = document.getElementById('editDocExpiry')?.value.trim() || '';
    const nationality = document.getElementById('editDocNationality')?.value.trim().toUpperCase() || 'MMR';
    const dob = document.getElementById('editDocDob')?.value.trim() || '';
    const fileInput = document.getElementById('editDocPhotoFile');
    const file = fileInput?.files?.[0] || null;
    let passportPhotoUrl = client.passport_photo_url || '';

    if (file) {
        if (file.size > 750 * 1024) {
            showToast('Photo is too large. Max 750 KB.', 'error');
            return;
        }
        try {
            passportPhotoUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read photo file.'));
                reader.readAsDataURL(file);
            });
        } catch (err) {
            showToast(err.message, 'error');
            return;
        }
    }

    if (nrcNo && !looksLikeNrc(nrcNo)) {
        showToast('NRC format should look like 12/MAGATA(N)000000.', 'error');
        return;
    }
    if (passportNo && !looksLikePassport(passportNo)) {
        showToast('Passport number looks invalid. Use letters/numbers like M1234567.', 'error');
        return;
    }

    const targetTickets = state.allTickets.filter(t => clientKeyFromTicket(t) === client.client_key && !isFeeEntry(t) && t.id);
    if (!targetTickets.length) {
        showToast('No editable ticket records found for this client.', 'error');
        return;
    }

    const data = {
        name: name || client.name || '',
        nrc_no: nrcNo,
        passport_no: passportNo,
        passport_expiry: passportExpiry,
        passport_photo_url: passportPhotoUrl,
        passport_photo_path: '',
        nationality,
        dob,
        id_no: nrcNo || passportNo,
        document_type: passportNo ? 'Passport' : 'NRC'
    };

    try {
        await batchUpdateTickets(targetTickets.map(t => ({ id: t.id, data })));
        targetTickets.forEach(t => Object.assign(t, data));
        const freshClient = Object.assign(client, data);
        freshClient.nrc_no = nrcNo;
        freshClient.passport_no = passportNo;
        closeModal();
        showToast('Travel documents updated.', 'success');
        renderClientDetailView();
    } catch (err) {
        console.error('Failed to update travel documents', err);
        showToast('Failed to update travel documents.', 'error');
    }
}

function openClientOverviewEditModal(client) {
    const ffIds = Array.isArray(client.frequent_flyer_ids) ? [...client.frequent_flyer_ids] : [];
    if (!ffIds.length && client.frequent_flyer_no) {
        ffIds.push({ airline: client.member_airline || '', id: client.frequent_flyer_no });
    }

    const ffRowsHtml = ffIds.map((entry, i) => `
        <div class="member-id-row" data-ff-index="${i}">
            <div class="form-group">
                <label>Airline / Programme</label>
                <input type="text" class="member-row-airline" placeholder="e.g. Myanmar Airways, KLM" value="${escapeHtml(entry.airline || '')}" autocomplete="off">
            </div>
            <div class="form-group">
                <label>Member ID</label>
                <input type="text" class="member-row-id" placeholder="e.g. KL1234567" value="${escapeHtml(entry.id || '')}" autocomplete="off">
            </div>
            <button type="button" class="member-row-remove" title="Remove" aria-label="Remove">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `).join('');

    const hasFf = ffIds.length > 0;

    openModal(`
        <div class="modal-header">
            <h3><i class="fa-solid fa-id-card"></i> Edit Client Overview</h3>
            <button class="modal-close-btn" data-close-modal>&times;</button>
        </div>
        <div class="modal-body-content">
            <form id="clientOverviewForm" class="client-doc-edit-form">
                <div class="form-grid">
                    <div class="form-group">
                        <label>Account Name</label>
                        <input type="text" id="editOverviewAccountName" value="${escapeHtml(client.account_name || '')}" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>Phone</label>
                        <input type="text" id="editOverviewPhone" value="${escapeHtml(client.phone || '')}" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>Account Type</label>
                        <input type="text" id="editOverviewAccountType" value="${escapeHtml(client.account_type || '')}" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>Account Link</label>
                        <input type="text" id="editOverviewAccountLink" value="${escapeHtml(client.account_link || '')}" autocomplete="off">
                    </div>
                    <div class="form-group full-width">
                        <div class="member-id-header" style="margin-top:0.5rem;">
                            <h5 style="margin:0; font-size:0.82rem;">
                                <i class="fa-solid fa-star"></i> Frequent Flyer / Member ID
                                <span style="font-size:0.68rem; font-weight:500; color:var(--primary-accent); margin-left:0.25rem;">(optional)</span>
                            </h5>
                            <button type="button" class="member-id-toggle-btn" id="overviewMemberToggle" aria-expanded="${hasFf ? 'true' : 'false'}">
                                <i class="fa-solid ${hasFf ? 'fa-xmark' : 'fa-plus'}"></i> ${hasFf ? 'Remove all' : 'Add'}
                            </button>
                        </div>
                        <div class="member-id-body" id="overviewMemberBody" style="display:${hasFf ? '' : 'none'};">
                            <div class="member-id-list" id="overviewMemberList">
                                ${ffRowsHtml}
                            </div>
                            <button type="button" class="member-id-add-more" id="overviewMemberAddMore">
                                <i class="fa-solid fa-circle-plus"></i> Add another airline
                            </button>
                        </div>
                    </div>
                </div>
                <p class="settle-muted">Updates are saved to this client's non-fee ticket records so future client detail views show the corrected information.</p>
                <div class="form-actions" style="margin-top:1rem">
                    <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Save Changes</button>
                </div>
            </form>
        </div>
    `, 'large-modal');

    document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModal));
    document.getElementById('clientOverviewForm')?.addEventListener('submit', (e) => saveClientOverview(e, client));

    const memberToggle = document.getElementById('overviewMemberToggle');
    const memberBody = document.getElementById('overviewMemberBody');
    const memberList = document.getElementById('overviewMemberList');
    const memberAddMore = document.getElementById('overviewMemberAddMore');

    function createMemberRow(airline = '', id = '') {
        const row = document.createElement('div');
        row.className = 'member-id-row';
        row.innerHTML = `
            <div class="form-group">
                <label>Airline / Programme</label>
                <input type="text" class="member-row-airline" placeholder="e.g. Myanmar Airways, KLM" value="${escapeHtml(airline)}" autocomplete="off">
            </div>
            <div class="form-group">
                <label>Member ID</label>
                <input type="text" class="member-row-id" placeholder="e.g. KL1234567" value="${escapeHtml(id)}" autocomplete="off">
            </div>
            <button type="button" class="member-row-remove" title="Remove" aria-label="Remove">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        const idInput = row.querySelector('.member-row-id');
        idInput.addEventListener('input', () => {
            const p = idInput.selectionStart;
            idInput.value = idInput.value.toUpperCase();
            idInput.setSelectionRange(p, p);
        });
        row.querySelector('.member-row-remove').addEventListener('click', () => {
            row.remove();
            if (!memberList.children.length) {
                memberBody.style.display = 'none';
                memberToggle.setAttribute('aria-expanded', 'false');
                memberToggle.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
            }
        });
        memberList.appendChild(row);
        return row;
    }

    if (memberToggle && memberBody && memberList) {
        memberToggle.addEventListener('click', () => {
            const isOpen = memberBody.style.display !== 'none';
            if (isOpen) {
                memberList.innerHTML = '';
                memberBody.style.display = 'none';
                memberToggle.setAttribute('aria-expanded', 'false');
                memberToggle.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
            } else {
                memberBody.style.display = '';
                memberToggle.setAttribute('aria-expanded', 'true');
                memberToggle.innerHTML = '<i class="fa-solid fa-xmark"></i> Remove all';
                if (!memberList.children.length) createMemberRow();
            }
        });

        if (memberAddMore) {
            memberAddMore.addEventListener('click', () => {
                const newRow = createMemberRow();
                newRow.querySelector('.member-row-airline').focus();
            });
        }
    }
}

async function saveClientOverview(e, client) {
    e.preventDefault();
    const accountName = document.getElementById('editOverviewAccountName')?.value.trim() || '';
    const phone = document.getElementById('editOverviewPhone')?.value.trim() || '';
    const accountType = document.getElementById('editOverviewAccountType')?.value.trim() || '';
    const accountLink = document.getElementById('editOverviewAccountLink')?.value.trim() || '';

    const ffRows = document.querySelectorAll('#overviewMemberList .member-id-row');
    const frequentFlyerIds = [];
    ffRows.forEach(row => {
        const airline = row.querySelector('.member-row-airline')?.value?.trim() || '';
        const id = row.querySelector('.member-row-id')?.value?.trim() || '';
        if (airline || id) frequentFlyerIds.push({ airline, id });
    });

    const data = {
        account_name: accountName,
        phone,
        account_type: accountType,
        account_link: accountLink,
        frequent_flyer_no: frequentFlyerIds[0]?.id || '',
        member_airline: frequentFlyerIds[0]?.airline || '',
        member_id: frequentFlyerIds[0]?.id || '',
        frequent_flyer_ids: JSON.stringify(frequentFlyerIds)
    };

    const targetTickets = state.allTickets.filter(t => clientKeyFromTicket(t) === client.client_key && !isFeeEntry(t) && t.id);
    if (!targetTickets.length) {
        showToast('No editable ticket records found for this client.', 'error');
        return;
    }

    try {
        await batchUpdateTickets(targetTickets.map(t => ({ id: t.id, data })));
        targetTickets.forEach(t => Object.assign(t, data));
        Object.assign(client, data);
        client.frequent_flyer_ids = frequentFlyerIds;
        closeModal();
        showToast('Client overview updated.', 'success');
        renderClientDetailView();
    } catch (err) {
        console.error('Failed to update client overview', err);
        showToast('Failed to update client overview.', 'error');
    }
}

/* ----------------------- suggestions ----------------------------------- */

function getResultId(result) {
    if (typeof result === 'string') return result;
    if (result.kind === 'client') return 'client:' + (result.data.client_key || result.data.name);
    if (result.kind === 'ticket') return 'ticket:' + (result.data.id || result.data.booking_reference);
    return JSON.stringify(result);
}

function isPnrQuery(q) {
    const raw = String(q || '').trim();
    if (/\s/.test(raw)) return false;
    const compact = normalize(raw);
    return /^[A-Z0-9]{5,8}$/.test(compact) && /\d/.test(compact);
}

function buildSuggestions(query) {
    const q = query.trim();
    if (!q) {
        const recent = getRecentSearches().slice(0, 4);
        return { top: [], clients: [], tickets: [], accounts: [], recent, showMore: false };
    }

    if (isPnrQuery(q)) {
        const pnr = normalize(q).replace(/\s/g, '');
        const exactTickets = state.allTickets
            .filter(t => !isFeeEntry(t) && normalize(t.booking_reference || '').replace(/\s/g, '') === pnr)
            .map(t => buildTicketResult(t, q))
            .filter(Boolean);
        const top = exactTickets.length ? [exactTickets[0]] : [];
        const tickets = exactTickets.slice(1, 4);

        const associatedClientKeys = new Set();
        exactTickets.forEach(t => {
            const c = getClientForTicket(t.data);
            if (c) associatedClientKeys.add(c.client_key);
        });
        const clients = state.allClients
            .filter(c => associatedClientKeys.has(c.client_key))
            .map(c => buildClientResult(c, q))
            .slice(0, 4);

        return { top, clients, tickets, accounts: [], recent: [], showMore: false };
    }

    const tokens = queryTokens(normalize(q));
    const all = buildAllRankedResults(q).filter(r => r.score > 0).slice(0, 40);
    const top = all[0] ? [all[0]] : [];
    const topIds = new Set(top.map(getResultId));

    let showMore = false;
    const clientsFromRank = all.filter(r => r.kind === 'client' && !topIds.has(getResultId(r)));

    const directClientMatches = state.allClients
        .filter(c => {
            if (String(c.name || '').includes('(Fees)')) return false;
            const text = [c.name, c.account_name, c.phone].map(normalize).join(' ');
            return tokens.length ? tokens.every(token => text.includes(token)) : false;
        })
        .map(c => buildClientResult(c, q))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || getSortDate(b) - getSortDate(a));

    const clientMap = new Map();
    [...directClientMatches, ...clientsFromRank].forEach(result => {
        const id = getResultId(result);
        if (!topIds.has(id) && !clientMap.has(id)) clientMap.set(id, result);
    });
    showMore = directClientMatches.length > 6;
    const clients = [...clientMap.values()]
        .sort((a, b) => b.score - a.score || getSortDate(b) - getSortDate(a))
        .slice(0, 6);

    const clientIds = new Set(clients.map(getResultId));
    const tickets = all
        .filter(r => r.kind === 'ticket' && !topIds.has(getResultId(r)) && !clientIds.has(getResultId(r)))
        .slice(0, 4);

    // Account suggestions
    const accountSet = new Set();
    state.allClients.forEach(c => {
        if (c.account_name && normalize(c.account_name).includes(normalize(q))) {
            accountSet.add(c.account_name);
        }
    });
    const accountNamesShown = new Set();
    const accounts = [...accountSet].slice(0, 3).map(name => {
        accountNamesShown.add(normalize(name));
        return { kind: 'account', label: name, data: { account_name: name } };
    });
    const filteredClients = tokens.length > 1
        ? clients
        : clients.filter(c => !accountNamesShown.has(normalize(c.data.account_name || '')));

    const shownIds = new Set([...topIds, ...clientIds, ...tickets.map(getResultId)]);
    const recent = getRecentSearches()
        .filter(item => item.toLowerCase().includes(q.toLowerCase()))
        .filter(item => !shownIds.has(item))
        .slice(0, 4);

    return { top, clients: filteredClients, tickets, accounts, recent, showMore };
}

function suggestionItem(result) {
    if (typeof result === 'string') {
        return `
            <button type="button" class="suggestion-item" data-suggestion-query="${escapeHtml(result)}">
                <span class="suggestion-main">${escapeHtml(result)}</span>
                <span class="suggestion-meta">Recent search</span>
                <span class="suggestion-badge">Recent</span>
            </button>
        `;
    }

    if (result.kind === 'client') {
        const c = result.data;
        return `
            <button type="button" class="suggestion-item" data-suggestion-kind="client" data-client-key="${escapeHtml(c.client_key)}">
                <span class="suggestion-main">${escapeHtml(c.name || 'Unknown client')}</span>
                <span class="suggestion-meta">Phone: ${escapeHtml(c.phone || '—')} · ${escapeHtml(c.account_type || 'Account')} · ${Number(c.ticket_count || 0)} tickets</span>
                <span class="suggestion-badge">Client</span>
            </button>
        `;
    }

    if (result.kind === 'account') {
        return `
            <button type="button" class="suggestion-item" data-suggestion-kind="account" data-account-name="${escapeHtml(result.data.account_name)}">
                <span class="suggestion-main">${escapeHtml(result.data.account_name)}</span>
                <span class="suggestion-meta">Account name</span>
                <span class="suggestion-badge">Account</span>
            </button>
        `;
    }

    const ticket = result.data;
    return `
        <button type="button" class="suggestion-item" data-suggestion-kind="ticket" data-ticket-id="${escapeHtml(ticket.id || '')}">
            <span class="suggestion-main">PNR ${escapeHtml(ticket.booking_reference || '—')}</span>
            <span class="suggestion-meta">${escapeHtml(routeShort(ticket))} · ${renderAirlineName(ticket.airline || 'Airline', { size: 'xs' })} · ${result.payment === 'paid' ? 'Paid' : 'Unpaid'}</span>
            <span class="suggestion-badge">Ticket</span>
        </button>
    `;
}

function renderSuggestions(input, panel) {
    const query = input.value.trim();
    const groups = buildSuggestions(query);
    const groupHtml = [
        ['Top Match', groups.top],
        ['Account Names', groups.accounts],
        ['Clients', groups.clients],
        ['Tickets / PNR', groups.tickets],
        ['Recent Searches', groups.recent]
    ].filter(([, items]) => items.length).map(([label, items]) => `
        <div class="suggestion-group">
            <div class="suggestion-group-title">${label}</div>
            ${items.map(suggestionItem).join('')}
        </div>
    `).join('');

    const showMoreHtml = groups.showMore ? `
        <div class="suggestion-group">
            <button type="button" class="suggestion-item suggestion-show-more" data-suggestion-query="${escapeHtml(query)}">
                <span class="suggestion-main">Show all names containing “${escapeHtml(query)}”</span>
                <span class="suggestion-meta">Search results</span>
                <span class="suggestion-badge"><i class="fa-solid fa-arrow-right"></i></span>
            </button>
        </div>
    ` : '';

    const clearRecentBtn = groups.recent.length ? `
        <div class="suggestion-clear-recent">
            <button type="button" class="suggestion-clear-btn" id="clearRecentSearches">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i> Clear recent searches
            </button>
        </div>
    ` : '';

    panel.innerHTML = (groupHtml || `
        <div class="suggestion-empty">Type a client name, phone, account, or PNR.</div>
    `) + showMoreHtml + clearRecentBtn;
    panel.hidden = false;
    input.closest('.global-search-box')?.classList.add('is-open');

    const clearBtn = document.getElementById('clearRecentSearches');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            localStorage.removeItem(RECENT_SEARCH_KEY);
            renderSuggestions(input, panel);
        });
    }
}

function closeSuggestions(input, panel) {
    panel.hidden = true;
    input.closest('.global-search-box')?.classList.remove('is-open');
}

/* -------------------- public API --------------------------------------- */

export function initGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const submit = document.getElementById('globalSearchSubmit');
    const clear = document.getElementById('globalSearchClear');
    const panel = document.getElementById('globalSearchSuggestions');
    if (!input || !submit || !clear || !panel || input.dataset.globalSearchReady === 'true') return;

    input.placeholder = 'Search client, phone, account, PNR…';

    const updateClear = () => { clear.hidden = !input.value.trim(); };
    const debouncedSuggest = debounce(() => renderSuggestions(input, panel), 120);

    input.addEventListener('input', () => {
        updateClear();
        debouncedSuggest();
    });
    input.addEventListener('focus', () => renderSuggestions(input, panel));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSuggestions(input, panel);
            input.blur();
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            navigateToSearch(input.value);
            closeSuggestions(input, panel);
        }
    });
    submit.addEventListener('click', () => {
        if (input.value.trim()) navigateToSearch(input.value);
        else input.focus();
    });
    clear.addEventListener('click', () => {
        input.value = '';
        updateClear();
        renderSuggestions(input, panel);
        input.focus();
    });
    panel.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
        const currentQuery = input.value.trim();
        if (item.dataset.suggestionQuery) {
            input.value = item.dataset.suggestionQuery;
            navigateToSearch(item.dataset.suggestionQuery);
        } else if (item.dataset.suggestionKind === 'account') {
            navigateToAccount(item.dataset.accountName);
        } else if (item.dataset.suggestionKind === 'client') {
            navigateToClient(item.dataset.clientKey, currentQuery);
        } else if (item.dataset.suggestionKind === 'ticket' && item.dataset.ticketId) {
            navigateToTicket(item.dataset.ticketId, currentQuery);
        }
        closeSuggestions(input, panel);
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.global-search-box')) closeSuggestions(input, panel);
    });
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            input.focus();
            renderSuggestions(input, panel);
        }
    });

    // Wire close button if present
    const closeBtn = document.getElementById('searchCloseBtn');
    closeBtn?.addEventListener('click', closeSearchView);

    input.dataset.globalSearchReady = 'true';
    updateClear();
}

export function initSearchView() {
    readSearchUrl();
    const input = document.getElementById('globalSearchInput');
    if (input) input.value = searchState.query;
    const clear = document.getElementById('globalSearchClear');
    if (clear) clear.hidden = !searchState.query;

    // ticket detail: no inline ticket detail panel — fall back to existing modal
    if (searchState.selectedTicketId && !searchState.selectedClientKey) {
        showDetails(searchState.selectedTicketId);
        searchState.selectedTicketId = '';
        updateSearchUrl(false);
    }

    refreshSearchView();
}

export function handleGlobalSearch(query) {
    navigateToSearch(query);
}

export function handleSearchInput(query) {
    searchState.query = query;
    refreshSearchView();
}

export function setSearchQuery(query) {
    searchState.query = query;
}

export function getSearchState() {
    return searchState;
}

export { searchState, navigateToSearch };
