/**
 * @fileoverview Premium global search for clients, tickets, PNRs, and accounts.
 * Refactor: strict multi-word ranking, suggestions route to Search Results,
 * inline client detail view inside Search Results page.
 */

import { state } from './state.js';
import { parseSheetDate, formatDateForSheet, formatDateToDMMMY, debounce, showToast } from './utils.js';
import { showView, openModal, closeModal, scanPassportWithGemini } from './ui.js';
import { ocrPassport } from './passport-ocr.js';
import { batchUpdateTickets } from './db.js';
import { sellTicketForClient, bookForClient } from './clients.js';
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
    return normalize(query).split(/\s+/).filter(token => token.length >= 2);
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
    return `${ticket.name}|${ticket.phone}|${ticket.account_name}`;
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
        .filter(t => !isFeeEntry(t))
        .sort((a, b) => parseSheetDate(b.issued_date) - parseSheetDate(a.issued_date));
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
    if (ticket.paid) return 'paid';
    const pnr = normalize(ticket.booking_reference);
    const samePnr = pnr ? state.allTickets.filter(t => normalize(t.booking_reference) === pnr) : [];
    if (samePnr.some(t => t.paid) && samePnr.some(t => !t.paid)) return 'partial';
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

/**
 * Strict ranking. Quality is one of: 'best' | 'related' | 'none'.
 *  - 'best'    : strong, deterministic match (exact, prefix, full phrase, all tokens in same field).
 *  - 'related' : weaker hint (cross-field token spread, partial single-token).
 *  - 'none'    : no useful match.
 *
 * For multi-word queries, NO single-token partial may produce a 'best' result.
 */
function rankRecord(record, type, query) {
    const q = normalize(query);
    if (!q) return { score: 40, quality: 'best', reasons: ['No query'] };

    const tokens = queryTokens(q);
    const isMulti = tokens.length > 1;
    const fields = type === 'client'
        ? {
            name: record.name,
            phone: record.phone,
            account: record.account_name,
            accountType: record.account_type,
            pnr: '',
            route: '',
            airline: ''
        }
        : {
            name: record.name,
            phone: record.phone,
            account: record.account_name,
            accountType: record.account_type,
            pnr: record.booking_reference,
            route: `${record.departure || ''} ${record.destination || ''}`,
            airline: record.airline
        };

    const name = normalize(fields.name);
    const account = normalize(fields.account);
    const phone = digitsOnly(fields.phone);
    const pnr = normalize(fields.pnr);
    const qDigits = digitsOnly(q);
    const haystack = Object.values(fields).map(normalize).join(' ');
    const allAcrossFields = tokens.length > 0 && tokens.every(token => haystack.includes(token));

    /* ---------- BEST ---------- */
    if (pnr && pnr === q) return { score: 1000, quality: 'best', reasons: ['Exact PNR'] };
    if (phone && qDigits && phone === qDigits) return { score: 950, quality: 'best', reasons: ['Exact phone'] };
    if (name && name === q) return { score: 900, quality: 'best', reasons: ['Exact name'] };
    if (account && account === q) return { score: 860, quality: 'best', reasons: ['Exact account'] };

    if (name.startsWith(q) && q.length >= 3) return { score: 820, quality: 'best', reasons: ['Name starts with query'] };
    if (account.startsWith(q) && q.length >= 3) return { score: 780, quality: 'best', reasons: ['Account starts with query'] };
    if (q.length >= 3 && name.includes(q)) return { score: 740, quality: 'best', reasons: ['Name contains phrase'] };
    if (q.length >= 3 && account.includes(q)) return { score: 720, quality: 'best', reasons: ['Account contains phrase'] };
    if (pnr && pnr.includes(q) && q.length >= 4) return { score: 700, quality: 'best', reasons: ['PNR contains query'] };

    if (isMulti) {
        if (hasAllTokensInField(name, tokens)) return { score: 620, quality: 'best', reasons: ['All words in name'] };
        if (hasAllTokensInField(account, tokens)) return { score: 580, quality: 'best', reasons: ['All words in account'] };
    }

    /* ---------- RELATED ---------- */
    if (isMulti && allAcrossFields) {
        return { score: 220, quality: 'related', reasons: ['All words across fields'] };
    }

    // Multi-word: must not promote single-token partial matches
    if (isMulti) return { score: 0, quality: 'none', reasons: [] };

    // Single token: weak partials → 'related'
    let partial = 0;
    if (hasAnyTokenInField(name, tokens)) partial += 70;
    if (hasAnyTokenInField(account, tokens)) partial += 45;
    if (hasAnyTokenInField(fields.accountType, tokens)) partial += 18;
    if (hasAnyTokenInField(fields.route, tokens)) partial += 25;
    if (hasAnyTokenInField(fields.airline, tokens)) partial += 25;
    if (qDigits && phone.includes(qDigits)) partial += 60;

    if (!partial) return { score: 0, quality: 'none', reasons: [] };
    return { score: partial, quality: 'related', reasons: ['Partial match'] };
}

function buildClientResult(client, query = searchState.query) {
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
    const clients = state.allClients.map(c => buildClientResult(c, query));
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

function navigateToClient(clientKey, query = '') {
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
            ${filterInput('issuedDate', 'Issued date', f.issuedDate, 'MM/DD/YYYY')}
            ${filterInput('travelDate', 'Travel date', f.travelDate, 'MM/DD/YYYY')}
            ${filterInput('ticketCount', 'Ticket count at least', f.ticketCount, '0', 'number')}
            <label>Upcoming
                <select data-more-filter="upcomingWithin">
                    <option value="">Any</option>
                    <option value="2" ${f.upcomingWithin === '2' ? 'selected' : ''}>Within 2 days</option>
                    <option value="7" ${f.upcomingWithin === '7' ? 'selected' : ''}>Within 7 days</option>
                    <option value="30" ${f.upcomingWithin === '30' ? 'selected' : ''}>Within 30 days</option>
                </select>
            </label>
            ${filterInput('startDate', 'Custom start', f.startDate, 'MM/DD/YYYY')}
            ${filterInput('endDate', 'Custom end', f.endDate, 'MM/DD/YYYY')}
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

    if (!searchState.query && !hasActiveFilters()) {
        container.innerHTML = `
            <div class="search-empty-state search-empty-shell">
                <i class="fa-solid fa-magnifying-glass"></i>
                <h3>Search clients, tickets, PNR, or accounts</h3>
                <p>Use the search box in the header to find records quickly.</p>
            </div>
        `;
        return;
    }

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
            <th>Client / PNR</th><th>Phone</th><th>Account</th>
            <th>Type</th><th>Tickets</th><th>Last Booking</th><th>Actions</th>
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
                <td class="strong-cell">
                    <div class="cell-with-avatar">
                        <span class="cell-avatar">${escapeHtml(initialsOf(c.name))}</span>
                        <span>${highlightText(c.name)}</span>
                    </div>
                </td>
                <td>${highlightText(c.phone || '—')}</td>
                <td>${highlightText(c.account_name || '—')}</td>
                <td>${escapeHtml(c.account_type || '—')}</td>
                <td>${Number(c.ticket_count || 0)}</td>
                <td>${fmtDateOrDash(c.last_issued)}</td>
                <td>${clientActions(c.client_key)}</td>
            </tr>
        `;
    }

    const t = result.data;
    const clientKey = getTicketClientKey(t);
    return `
        <tr class="search-row" data-kind="ticket" data-ticket-id="${escapeHtml(t.id || '')}" data-client-key="${escapeHtml(clientKey)}" data-pnr="${escapeHtml(t.booking_reference || '')}">
            <td class="strong-cell">
                <div class="cell-with-avatar">
                    <span class="cell-avatar ticket-avatar"><i class="fa-solid fa-ticket"></i></span>
                    <span>${highlightText(t.booking_reference || t.name || '—')}<small class="cell-sub">${escapeHtml(t.name || '')}</small></span>
                </div>
            </td>
            <td>${highlightText(t.phone || '—')}</td>
            <td>${highlightText(t.account_name || '—')}</td>
            <td>${escapeHtml(routeShort(t))}</td>
            <td>${paymentBadge(result.payment)}</td>
            <td>${fmtDateOrDash(t.issued_date)}</td>
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
    const activeTickets = tickets.filter(t => !isCanceled(t) && !isFeeEntry(t));
    const totalSpent = activeTickets.reduce((sum, t) => sum + getTicketAmount(t), 0);
    const totalProfit = activeTickets.reduce((sum, t) => sum + Number(t.commission || 0) + Number(t.extra_fare || 0), 0);
    const totalTicketCount = activeTickets.length;
    const lastIssuedTicket = tickets.find(t => parseSheetDate(t.issued_date)?.getTime?.());
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
        <div class="client-detail-card">
            <div class="client-hero">
                <div class="client-hero-avatar">${escapeHtml(initialsOf(client.name))}</div>
                <div class="client-hero-info">
                    <h2 class="client-hero-name">${escapeHtml(client.name || 'Unknown')}</h2>
                </div>
                <div class="client-hero-actions">
                    <button class="btn btn-primary" data-detail-action="sell"><i class="fa-solid fa-ticket"></i> Sell New Ticket</button>
                    <button class="btn btn-secondary" data-detail-action="booking"><i class="fa-solid fa-calendar-plus"></i> Booking</button>
                    <button class="btn btn-ghost" data-detail-action="back"><i class="fa-solid fa-arrow-left"></i> Back to results</button>
                </div>
            </div>

            <div class="client-kpi-grid">
                ${kpiCard('fa-ticket', 'teal', 'Total Tickets', totalTicketCount)}
                ${kpiCard('fa-coins', 'green', 'Total Spent', fmtMmk(totalSpent))}
                ${kpiCard('fa-chart-line', 'amber', 'Total Profit', fmtMmk(totalProfit))}
                ${kpiCard('fa-clock', 'coral', 'Last Booking', fmtDateOrDash(lastBooking))}
            </div>

            <div class="client-detail-grid">
                ${overviewCard(client)}
                ${documentsCard(client)}
                ${insightsCard(mostFrequentRoute, oneWay, roundTrip, avgNet)}
                ${paymentCard(paidCount, unpaidTickets.length, outstanding, preferredPayment)}
            </div>

            ${ticketHistorySection(client, tickets)}

            <p class="client-detail-footer">All amounts in MMK (Myanmar Kyat) · Secure · Private · Confidential</p>
        </div>
    `;

    wireDetailActions(detail, client);
}

function kpiCard(icon, color, label, value) {
    return `
        <div class="kpi-card">
            <div class="kpi-icon kpi-${color}"><i class="fa-solid ${icon}"></i></div>
            <div class="kpi-body">
                <div class="kpi-label">${escapeHtml(label)}</div>
                <div class="kpi-value">${typeof value === 'number' ? value.toLocaleString() : value}</div>
            </div>
        </div>
    `;
}

function overviewCard(c) {
    const phone = c.phone || '';
    const accountLink = c.account_link || '';
    const phoneVal = phone
        ? `<a href="tel:${escapeHtml(phone)}" class="kv-link"><i class="fa-solid fa-phone"></i> ${escapeHtml(phone)}</a>`
        : '—';
    const linkVal = accountLink
        ? `<a href="${escapeHtml(accountLink)}" target="_blank" rel="noopener" class="kv-link"><i class="fa-solid fa-link"></i> ${escapeHtml(accountLink)}</a>`
        : '—';
    return `
        <div class="detail-card">
            <div class="detail-card-head">
                <span class="detail-card-icon"><i class="fa-solid fa-id-card"></i></span>
                <h3>Client Overview</h3>
            </div>
            <dl class="detail-kv overview-kv">
                <div><dt>Account Name</dt><dd>${escapeHtml(c.account_name || '—')}</dd></div>
                <div><dt>Phone</dt><dd>${phoneVal}</dd></div>
                <div><dt>Account Type</dt><dd>${escapeHtml(c.account_type || '—')}</dd></div>
                <div><dt>Account Link</dt><dd>${linkVal}</dd></div>
                <div><dt>Frequent Flyer</dt><dd>${escapeHtml(c.frequent_flyer_no || '—')}</dd></div>
            </dl>
        </div>
    `;
}

function documentsCard(c) {
    const nrcNo = getClientNrc(c);
    const passportNo = getClientPassportNo(c);
    const photo = c.passport_photo_url || '';
    const expiry = c.passport_expiry || '';
    const dob = c.dob || '';
    const verified = !!(passportNo || nrcNo);
    const uploadedLabel = photo ? 'Uploaded' : 'Not uploaded';

    return `
        <div class="detail-card">
            <div class="detail-card-head">
                <span class="detail-card-icon"><i class="fa-solid fa-passport"></i></span>
                <h3>Travel Documents</h3>
                ${verified ? '<span class="verified-pill"><i class="fa-solid fa-circle-check"></i> Verified</span>' : ''}
                <button class="doc-edit-btn" data-doc-action="edit"><i class="fa-solid fa-pen"></i> Edit</button>
            </div>
            <div class="travel-doc-layout">
                <div class="nrc-mini-card">
                    <div class="travel-doc-title"><i class="fa-regular fa-id-card"></i> NRC</div>
                    <div class="nrc-number-block">${escapeHtml((nrcNo || '').toUpperCase())}</div>
                    ${nrcNo ? '<span class="verified-pill nrc-verified"><i class="fa-solid fa-circle-check"></i> Verified</span>' : '<span class="nrc-missing">No NRC</span>'}
                </div>
                <div class="passport-doc-block ${photo ? 'has-photo' : ''}">
                    <div class="travel-doc-title passport-title"><i class="fa-solid fa-passport"></i> Passport</div>
                    ${photo ? `<button type="button" class="doc-photo" data-doc-action="view"><img src="${escapeHtml(photo)}" alt="Passport"></button>` : `
                        <div class="doc-photo doc-photo-empty">
                            <i class="fa-regular fa-address-card"></i>
                            <strong>No passport uploaded</strong>
                            <span>Upload a clear image of the passport information page.</span>
                        </div>
                    `}
                    <dl class="passport-doc-info">
                        <div><dt>Passport No.</dt><dd>${escapeHtml(passportNo || '—')}</dd></div>
                        <div><dt>Country</dt><dd>${escapeHtml(c.nationality || '—')}</dd></div>
                        <div><dt>Expiry Date</dt><dd>${escapeHtml(expiry || '—')}</dd></div>
                        <div><dt>Date of Birth</dt><dd>${escapeHtml(dob || '—')}</dd></div>
                        <div><dt>Uploaded</dt><dd>${escapeHtml(uploadedLabel)}</dd></div>
                    </dl>
                    <div class="passport-doc-actions">
                        <button class="btn btn-ghost" data-doc-action="view" ${photo ? '' : 'disabled'}><i class="fa-regular fa-eye"></i> View</button>
                        <button class="btn btn-ghost" data-doc-action="replace"><i class="fa-solid fa-rotate"></i> Replace</button>
                        <button class="btn btn-primary" data-doc-action="upload"><i class="fa-solid fa-upload"></i> Upload Passport</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function insightsCard(mostFrequentRoute, oneWay, roundTrip, avgNet) {
    return `
        <div class="detail-card">
            <div class="detail-card-head">
                <span class="detail-card-icon"><i class="fa-solid fa-chart-pie"></i></span>
                <h3>Client Insights</h3>
            </div>
            <dl class="detail-kv insights-kv">
                <div><dt>Most frequent route</dt><dd>${escapeHtml(mostFrequentRoute)}</dd></div>
                <div><dt>One-way tickets</dt><dd>${oneWay}</dd></div>
                <div><dt>Round-trip tickets</dt><dd>${roundTrip}</dd></div>
                <div><dt>Average net</dt><dd>${fmtMmk(avgNet)}</dd></div>
            </dl>
        </div>
    `;
}

function paymentCard(paid, unpaid, outstanding, preferredPayment) {
    return `
        <div class="detail-card">
            <div class="detail-card-head">
                <span class="detail-card-icon"><i class="fa-solid fa-credit-card"></i></span>
                <h3>Payment & Booking Status</h3>
            </div>
            <dl class="detail-kv payment-kv">
                <div><dt>Paid bookings</dt><dd>${paid}</dd></div>
                <div><dt>Pending bookings</dt><dd>${unpaid}</dd></div>
                <div><dt>Outstanding balance</dt><dd>${fmtMmk(outstanding)}</dd></div>
                <div><dt>Preferred payment</dt><dd>${escapeHtml(preferredPayment || '—')}</dd></div>
            </dl>
        </div>
    `;
}

function ticketHistorySection(client, tickets) {
    const years = [...new Set(tickets.map(t => parseSheetDate(t.issued_date)?.getFullYear?.()).filter(Boolean))].sort((a, b) => b - a);

    const rows = tickets.map(t => {
        const status = getPaymentStatus(t);
        const upcoming = isUpcoming(t) ? 'upcoming' : (parseSheetDate(t.departing_on) < new Date() ? 'completed' : 'scheduled');
        const canceled = isCanceled(t);
        return `
            <tr data-pnr="${escapeHtml(t.booking_reference || '')}" data-tt="${escapeHtml(String(t.ticket_type || '').toUpperCase().includes('ROUND') ? 'round' : 'oneway')}" data-year="${escapeHtml(String(parseSheetDate(t.issued_date)?.getFullYear?.() || ''))}" class="${canceled ? 'canceled-row' : ''}">
                <td>${fmtDateOrDash(t.issued_date)}</td>
                <td><strong>${escapeHtml(t.booking_reference || '—')}</strong></td>
                <td>${escapeHtml(routeShort(t))}</td>
                <td>${fmtDateOrDash(t.departing_on)}</td>
                <td>${escapeHtml(t.airline || '—')}</td>
                <td>
                    ${canceled ? '<span class="payment-badge payment-unpaid">Canceled</span>' : `<span class="payment-badge payment-${upcoming === 'upcoming' ? 'partial' : 'paid'}">${upcoming === 'upcoming' ? 'Upcoming' : 'Completed'}</span>`}
                    ${paymentBadge(status)}
                </td>
                <td>${fmtMmk(getTicketAmount(t))}</td>
                <td>${fmtMmk(Number(t.commission || 0) + Number(t.extra_fare || 0))}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="detail-card">
            <div class="detail-card-head">
                <span class="detail-card-icon"><i class="fa-solid fa-clock-rotate-left"></i></span>
                <h3>Ticket History</h3>
                <div class="detail-card-toolbar">
                    <div class="detail-tabs" id="historyTypeTabs">
                        <button type="button" class="detail-tab active" data-history-tab="all">All</button>
                        <button type="button" class="detail-tab" data-history-tab="oneway">One-Way</button>
                        <button type="button" class="detail-tab" data-history-tab="round">Round-Trip</button>
                    </div>
                    <select class="detail-year-select" id="historyYearSelect">
                        <option value="">All years</option>
                        ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
                    </select>
                    <input type="text" class="detail-search-input" id="historySearchInput" placeholder="Search by PNR, route, airline…">
                </div>
            </div>
            <div class="detail-table-wrap">
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>Issued</th><th>PNR</th><th>Route</th><th>Travel Date</th>
                            <th>Airline</th><th>Status</th><th>Net Amount</th><th>Profit</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="8" class="empty-row">No tickets on file.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

function wireDetailActions(detail, client) {
    detail.querySelectorAll('[data-detail-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.detailAction;
            if (action === 'sell') sellTicketForClient(client.client_key);
            else if (action === 'booking') bookForClient(client.client_key);
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

    // History tabs / filters
    const tabs = detail.querySelectorAll('[data-history-tab]');
    const yearSelect = detail.querySelector('#historyYearSelect');
    const searchInput = detail.querySelector('#historySearchInput');
    const tbody = detail.querySelector('.detail-table tbody');
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
                        <label>NRC</label>
                        <input type="text" id="editDocNrc" value="${escapeHtml(nrcNo)}" placeholder="12/MAGATA(N)000000" autocomplete="off" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group">
                        <label>Passport Number</label>
                        <input type="text" id="editDocPassport" value="${escapeHtml(passportNo)}" placeholder="M1234567" autocomplete="off" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group">
                        <label>Passport Expiry</label>
                        <input type="text" id="editDocExpiry" value="${escapeHtml(client.passport_expiry || '')}" placeholder="MM/DD/YYYY" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>Nationality</label>
                        <input type="text" id="editDocNationality" value="${escapeHtml(client.nationality || 'MMR')}" placeholder="MMR" autocomplete="off" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group">
                        <label>Date of Birth</label>
                        <input type="text" id="editDocDob" value="${escapeHtml(client.dob || '')}" placeholder="MM/DD/YYYY" autocomplete="off">
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
            const passportNo = ocrResult.passportNo || ocrResult.passportNumber || '';
            const dob = ocrResult.dob || ocrResult.dateOfBirth || '';
            const expiry = ocrResult.expiry || ocrResult.expiryDate || '';
            const nationality = ocrResult.nationality || '';

            if (passportNo) {
                document.getElementById('editDocPassport').value = passportNo;
            }
            if (nationality) {
                document.getElementById('editDocNationality').value = nationality;
            }
            if (expiry) {
                document.getElementById('editDocExpiry').value = expiry;
            }
            if (dob) {
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

/* ----------------------- suggestions ----------------------------------- */

function getResultId(result) {
    if (typeof result === 'string') return result;
    if (result.kind === 'client') return 'client:' + (result.data.client_key || result.data.name);
    if (result.kind === 'ticket') return 'ticket:' + (result.data.id || result.data.booking_reference);
    return JSON.stringify(result);
}

function isPnrQuery(q) {
    return /^[A-Z0-9]{5,8}$/.test(normalize(q).replace(/\s/g, ''));
}

function buildSuggestions(query) {
    const q = query.trim();
    if (!q) {
        const recent = getRecentSearches().slice(0, 4);
        return { top: [], clients: [], tickets: [], accounts: [], recent };
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

        return { top, clients, tickets, accounts: [], recent: [] };
    }

    // Only 'best' quality may be Top Match.
    const all = buildAllRankedResults(q).filter(r => r.score > 0).slice(0, 12);
    const bestOnly = all.filter(r => r.quality === 'best');
    const top = bestOnly[0] ? [bestOnly[0]] : [];
    const topIds = new Set(top.map(getResultId));

    const clients = bestOnly
        .filter(r => r.kind === 'client' && !topIds.has(getResultId(r)))
        .slice(0, 4);
    const clientIds = new Set(clients.map(getResultId));
    const tickets = bestOnly
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
    const filteredClients = clients.filter(c => !accountNamesShown.has(normalize(c.data.account_name || '')));

    const shownIds = new Set([...topIds, ...clientIds, ...tickets.map(getResultId)]);
    const recent = getRecentSearches()
        .filter(item => item.toLowerCase().includes(q.toLowerCase()))
        .filter(item => !shownIds.has(item))
        .slice(0, 4);

    return { top, clients: filteredClients, tickets, accounts, recent };
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
            <span class="suggestion-meta">${escapeHtml(routeShort(ticket))} · ${escapeHtml(ticket.airline || 'Airline')} · ${result.payment === 'paid' ? 'Paid' : 'Unpaid'}</span>
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

    const clearRecentBtn = groups.recent.length ? `
        <div class="suggestion-clear-recent">
            <button type="button" class="suggestion-clear-btn" id="clearRecentSearches">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i> Clear recent searches
            </button>
        </div>
    ` : '';

    panel.innerHTML = (groupHtml || `
        <div class="suggestion-empty">Type a client name, phone, account, or PNR.</div>
    `) + clearRecentBtn;
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

export { searchState, navigateToClient, navigateToSearch };
