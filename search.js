/**
 * @fileoverview Premium global search for clients, tickets, PNRs, and accounts.
 */

import { state } from './state.js';
import { parseSheetDate, formatDateForSheet, formatDateToDMMMY, debounce } from './utils.js';
import { showView } from './ui.js';
import { viewClientHistory, sellTicketForClient, bookForClient } from './clients.js';
import { showDetails } from './tickets.js';
import { findTicketForManage } from './manage.js';

const RECENT_SEARCH_KEY = 'oceanRecentSearches';
const BEST_THRESHOLD = 60;
const RELATED_THRESHOLD = 8;
const RESULT_LIMIT = 120;
const TYPES = ['all', 'clients', 'tickets', 'pnr', 'unpaid', 'upcoming'];
const PAYMENT_OPTIONS = ['all', 'paid', 'unpaid', 'partial'];
const SOCIAL_OPTIONS = ['all', 'viber', 'messenger', 'facebook', 'telegram'];
const DATE_OPTIONS = ['all', 'today', '7d', '30d', 'month', 'custom'];

let searchState = {
    query: '',
    activeType: 'all',
    filters: {
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
    },
    moreOpen: false,
    lastResults: null,
    searchTimeout: null,
    previousView: 'home'
};

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

function clientKeyFromTicket(ticket) {
    return `${ticket.name}|${ticket.phone}|${ticket.account_name}`;
}

function getClientForTicket(ticket) {
    const key = clientKeyFromTicket(ticket);
    return state.allClients.find(client => client.client_key === key)
        || state.allClients.find(client =>
            normalize(client.name) === normalize(ticket.name)
            && digitsOnly(client.phone) === digitsOnly(ticket.phone)
        );
}

function routeShort(ticket) {
    const dep = String(ticket.departure || '').split(' ')[0];
    const dest = String(ticket.destination || '').split(' ')[0];
    if (!dep && !dest) return '—';
    return `${dep || '—'} → ${dest || '—'}`;
}

function fullRoute(ticket) {
    return `${ticket.departure || ''} → ${ticket.destination || ''}`.trim();
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
            route: ''
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

    if (pnr && pnr === q) return { score: 1000, quality: 'best', reasons: ['Exact PNR'] };
    if (phone && qDigits && phone === qDigits) return { score: 950, quality: 'best', reasons: ['Exact phone'] };
    if (name && name === q) return { score: 900, quality: 'best', reasons: ['Exact client name'] };
    if (account && account === q) return { score: 860, quality: 'best', reasons: ['Exact account'] };
    if (name.startsWith(q)) return { score: 780, quality: 'best', reasons: ['Name starts with query'] };
    if (account.startsWith(q)) return { score: 740, quality: 'best', reasons: ['Account starts with query'] };
    if (name.includes(q)) return { score: 700, quality: 'best', reasons: ['Name contains phrase'] };
    if (account.includes(q)) return { score: 680, quality: 'best', reasons: ['Account contains phrase'] };
    if (pnr && pnr.includes(q)) return { score: 650, quality: 'best', reasons: ['PNR contains query'] };
    if (hasAllTokensInField(name, tokens)) return { score: 560, quality: 'best', reasons: ['All words in name'] };
    if (hasAllTokensInField(account, tokens)) return { score: 530, quality: 'best', reasons: ['All words in account'] };
    if (allAcrossFields) return { score: 460, quality: 'best', reasons: ['All words across fields'] };

    if (isMulti) {
        if (hasAnyTokenInField(name, tokens) || hasAnyTokenInField(account, tokens) || hasAnyTokenInField(pnr, tokens)) {
            return { score: 20, quality: 'related', reasons: ['Partial word match'] };
        }
        return { score: 0, quality: 'none', reasons: [] };
    }

    let partialScore = 0;
    if (hasAnyTokenInField(name, tokens)) partialScore += 45;
    if (hasAnyTokenInField(account, tokens)) partialScore += 35;
    if (hasAnyTokenInField(fields.accountType, tokens)) partialScore += 20;
    if (hasAnyTokenInField(fields.route, tokens)) partialScore += 20;
    if (hasAnyTokenInField(fields.airline, tokens)) partialScore += 25;
    if (qDigits && phone.includes(qDigits)) partialScore += 40;

    return {
        score: partialScore,
        quality: partialScore >= BEST_THRESHOLD ? 'best' : partialScore >= RELATED_THRESHOLD ? 'related' : 'none',
        reasons: partialScore ? ['Partial match'] : []
    };
}

function buildClientResult(client) {
    const rank = rankRecord(client, 'client', searchState.query);
    return {
        kind: 'client',
        id: client.client_key,
        data: client,
        score: rank.score,
        quality: rank.quality,
        label: client.name || 'Unknown client',
        searchableText: `${client.name || ''} ${client.phone || ''} ${client.account_name || ''} ${client.account_type || ''}`
    };
}

function buildTicketResult(ticket) {
    const rank = rankRecord(ticket, 'ticket', searchState.query);
    const payment = getPaymentStatus(ticket);
    return {
        kind: 'ticket',
        id: ticket.id || `${ticket.booking_reference}|${ticket.name}`,
        data: ticket,
        score: rank.score,
        quality: rank.quality,
        payment,
        label: ticket.booking_reference || ticket.name || 'Ticket',
        searchableText: `${ticket.name || ''} ${ticket.phone || ''} ${ticket.account_name || ''} ${ticket.account_type || ''} ${ticket.booking_reference || ''} ${ticket.departure || ''} ${ticket.destination || ''} ${ticket.airline || ''}`
    };
}

function buildAllRankedResults() {
    const clients = state.allClients.map(buildClientResult);
    const tickets = state.allTickets.map(buildTicketResult);
    return [...clients, ...tickets]
        .filter(result => {
            if (!searchState.query) return true;
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
    const best = filtered.filter(result => result.quality === 'best');
    const related = filtered.filter(result => result.quality === 'related');
    const allForCounts = applyFilters(ranked.map(result => ({ ...result })), { ignoreActiveType: true });
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

function readSearchUrl() {
    const hash = window.location.hash;
    const queryIndex = hash.indexOf('?');
    const params = queryIndex >= 0 ? new URLSearchParams(hash.slice(queryIndex + 1)) : new URLSearchParams();
    searchState.query = params.get('q') || '';
    searchState.activeType = TYPES.includes(params.get('type')) ? params.get('type') : 'all';

    searchState.filters = {
        ...searchState.filters,
        dateRange: params.get('date') || 'all',
        startDate: params.get('start') || '',
        endDate: params.get('end') || '',
        airline: params.get('airline') || '',
        route: params.get('route') || '',
        payment: PAYMENT_OPTIONS.includes(params.get('payment')) ? params.get('payment') : 'all',
        social: SOCIAL_OPTIONS.includes(params.get('social')) ? params.get('social') : 'all',
        clientName: params.get('client') || '',
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
    if (f.dateRange !== 'all') params.set('date', f.dateRange);
    if (f.startDate) params.set('start', f.startDate);
    if (f.endDate) params.set('end', f.endDate);
    if (f.airline) params.set('airline', f.airline);
    if (f.route) params.set('route', f.route);
    if (f.payment !== 'all') params.set('payment', f.payment);
    if (f.social !== 'all') params.set('social', f.social);
    if (f.clientName) params.set('client', f.clientName);
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

function navigateToSearch(query, push = true) {
    const q = query.trim();
    if (!q) return;
    saveRecentSearch(q);
    searchState.query = q;
    const activeView = document.querySelector('.view.active')?.id?.replace(/-view$/, '');
    if (activeView && activeView !== 'search') searchState.previousView = activeView;
    updateSearchUrl(push);
    showView('search');
    initSearchView();
}

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

function paymentBadge(result) {
    if (result.kind !== 'ticket') return '';
    const status = result.payment;
    const label = status === 'paid' ? 'Paid' : status === 'partial' ? 'Partial' : 'Unpaid';
    return `<span class="payment-badge payment-${status}">${label}</span>`;
}

function getTicketClientKey(ticket) {
    return getClientForTicket(ticket)?.client_key || '';
}

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
                ${airlines.map(airline => `<option value="${escapeHtml(airline)}">${escapeHtml(airline)}</option>`).join('')}
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
                ${SOCIAL_OPTIONS.map(type => `<option value="${type}">${type === 'all' ? 'All' : type[0].toUpperCase() + type.slice(1)}</option>`).join('')}
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
    const el = (sel) => document.querySelector(sel);
    const set = (sel, val) => { const e = el(sel); if (e) e.value = val; };
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

    if (!searchState.query) {
        subtitle.textContent = 'Use the search box in the header to find records quickly.';
        summary.textContent = '';
        return;
    }

    subtitle.innerHTML = `Showing results for <strong>“${escapeHtml(searchState.query)}”</strong>`;
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

    const colSpan = searchState.activeType === 'clients' ? 7 : 8;
    const rows = [
        ...sectionRows('Best Matches', results.best, colSpan),
        ...sectionRows('Related Matches', results.related, colSpan)
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
    const clientOnly = searchState.activeType === 'clients';
    if (clientOnly) {
        return `
            <thead><tr>
                <th>Client Name</th><th>Phone</th><th>Account</th><th>Type</th><th>Tickets</th><th>Last Booking</th><th>Actions</th>
            </tr></thead>
        `;
    }
    return `
        <thead><tr>
            <th>Issued Date</th><th>Client Name</th><th>Booking Ref / PNR</th><th>Route</th><th>Airline</th><th>Travel Date</th><th>Payment</th><th>Actions</th>
        </tr></thead>
    `;
}

function sectionRows(title, rows, colSpan) {
    if (!rows.length) return [];
    return [
        `<tr class="search-section-row"><td colspan="${colSpan}">${title} <span>${rows.length}</span></td></tr>`,
        ...rows.map(result => searchState.activeType === 'clients' ? renderClientRow(result) : renderMixedRow(result))
    ];
}

function renderClientRow(result) {
    const client = result.data;
    return `
        <tr class="search-row" data-kind="client" data-client-key="${escapeHtml(client.client_key)}">
            <td class="strong-cell">${highlightText(client.name)}</td>
            <td>${highlightText(client.phone)}</td>
            <td>${highlightText(client.account_name)}</td>
            <td>${escapeHtml(client.account_type || '—')}</td>
            <td>${Number(client.ticket_count || 0)}</td>
            <td>${client.last_issued instanceof Date && client.last_issued.getTime() ? formatDateToDMMMY(formatDateForSheet(client.last_issued)) : '—'}</td>
            <td>${clientActions(client.client_key)}</td>
        </tr>
    `;
}

function renderMixedRow(result) {
    if (result.kind === 'client') {
        const client = result.data;
        return `
            <tr class="search-row" data-kind="client" data-client-key="${escapeHtml(client.client_key)}">
                <td>—</td>
                <td class="strong-cell">${highlightText(client.name)}</td>
                <td><span class="result-kind-pill">Client</span></td>
                <td>${highlightText(client.account_name)}</td>
                <td>${escapeHtml(client.account_type || '—')}</td>
                <td>${client.last_issued instanceof Date && client.last_issued.getTime() ? formatDateToDMMMY(formatDateForSheet(client.last_issued)) : '—'}</td>
                <td>—</td>
                <td>${clientActions(client.client_key)}</td>
            </tr>
        `;
    }

    const ticket = result.data;
    const clientKey = getTicketClientKey(ticket);
    const canSettle = result.payment !== 'paid';
    return `
        <tr class="search-row" data-kind="ticket" data-ticket-id="${escapeHtml(ticket.id || '')}" data-client-key="${escapeHtml(clientKey)}" data-pnr="${escapeHtml(ticket.booking_reference || '')}">
            <td>${ticket.issued_date ? formatDateToDMMMY(ticket.issued_date) : '—'}</td>
            <td class="strong-cell">${highlightText(ticket.name)}</td>
            <td>${highlightText(ticket.booking_reference || '—')}</td>
            <td>${escapeHtml(routeShort(ticket))}</td>
            <td>${highlightText(ticket.airline || '—')}</td>
            <td>${ticket.departing_on ? formatDateToDMMMY(ticket.departing_on) : '—'}</td>
            <td>${paymentBadge(result)}</td>
            <td>${ticketActions(Boolean(clientKey), canSettle)}</td>
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
            if (row.dataset.kind === 'client') viewClientHistory(row.dataset.clientKey);
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

            if (action === 'view-client' && clientKey) viewClientHistory(clientKey);
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
    searchState.filters = {
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
    };
    searchState.moreOpen = false;
    refreshSearchView();
}

function showSkeleton() {
    const container = document.getElementById('searchResultsContainer');
    if (!container) return;
    const colSpan = searchState.activeType === 'clients' ? 7 : 8;
    container.innerHTML = `
        <div class="search-table-shell">
            <table class="search-results-table">
                ${renderTableHead()}
                <tbody>
                    ${Array.from({ length: 8 }).map(() => `
                        <tr class="search-skeleton-row"><td colspan="${colSpan}"><span></span></td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function refreshSearchView(useDelay = true) {
    clearTimeout(searchState.searchTimeout);
    if (useDelay) showSkeleton();
    searchState.searchTimeout = setTimeout(() => {
        const results = getSearchResults();
        renderHeader(results);
        renderTabs(results.counts);
        renderFilterBar();
        renderMoreFilters();
        renderResults(results);
        updateSearchUrl(false);
    }, useDelay ? 80 : 0);
}

function closeSearchPage() {
    const fallbackView = searchState.previousView || 'home';
    if (window.history.length > 1) {
        window.history.back();
        setTimeout(() => {
            if (document.getElementById('search-view')?.classList.contains('active')) showView(fallbackView);
        }, 120);
        return;
    }
    window.location.hash = '';
    showView(fallbackView);
}

function buildSuggestions(query) {
    const q = query.trim();
    const all = q ? buildAllRankedResults().filter(r => r.score > 0).slice(0, 8) : [];
    const top = all[0] ? [all[0]] : [];
    const clients = all.filter(r => r.kind === 'client').slice(0, 4);
    const tickets = all.filter(r => r.kind === 'ticket').slice(0, 4);
    const recent = getRecentSearches().filter(item => item.toLowerCase().includes(q.toLowerCase()) || !q).slice(0, 4);
    return { top, clients, tickets, recent };
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
        const client = result.data;
        return `
            <button type="button" class="suggestion-item" data-suggestion-kind="client" data-client-key="${escapeHtml(client.client_key)}">
                <span class="suggestion-main">${escapeHtml(client.name || 'Unknown client')}</span>
                <span class="suggestion-meta">Phone: ${escapeHtml(client.phone || '—')} · ${escapeHtml(client.account_type || 'Account')} · ${Number(client.ticket_count || 0)} tickets</span>
                <span class="suggestion-badge">Client</span>
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
        ['Clients', groups.clients],
        ['Tickets / PNR', groups.tickets],
        ['Recent Searches', groups.recent]
    ].filter(([, items]) => items.length).map(([label, items]) => `
        <div class="suggestion-group">
            <div class="suggestion-group-title">${label}</div>
            ${items.map(suggestionItem).join('')}
        </div>
    `).join('');

    panel.innerHTML = groupHtml || `
        <div class="suggestion-empty">Type a client name, phone, account, or PNR.</div>
    `;
    panel.hidden = false;
    input.closest('.global-search-box')?.classList.add('is-open');
}

function closeSuggestions(input, panel) {
    panel.hidden = true;
    input.closest('.global-search-box')?.classList.remove('is-open');
}

export function initGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const submit = document.getElementById('globalSearchSubmit');
    const clear = document.getElementById('globalSearchClear');
    const panel = document.getElementById('globalSearchSuggestions');
    if (!input || !submit || !clear || !panel || input.dataset.globalSearchReady === 'true') return;

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
        if (item.dataset.suggestionQuery) {
            input.value = item.dataset.suggestionQuery;
            navigateToSearch(input.value);
        } else if (item.dataset.suggestionKind === 'client') {
            viewClientHistory(item.dataset.clientKey);
        } else if (item.dataset.suggestionKind === 'ticket' && item.dataset.ticketId) {
            showDetails(item.dataset.ticketId);
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

    input.dataset.globalSearchReady = 'true';
    updateClear();
}

export function initSearchView() {
    readSearchUrl();
    const input = document.getElementById('globalSearchInput');
    if (input) input.value = searchState.query;
    const clear = document.getElementById('globalSearchClear');
    if (clear) clear.hidden = !searchState.query;
    const closeBtn = document.getElementById('searchCloseBtn');
    if (closeBtn) closeBtn.onclick = closeSearchPage;
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

export { searchState };
