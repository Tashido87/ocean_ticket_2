/**
 * @fileoverview Global Search module — replaces the standalone Clients page.
 * Provides a unified search across clients, tickets, PNR, and accounts.
 */

import { state } from './state.js';
import { showToast, parseSheetDate, formatDateForSheet, formatDateToDMMMY, debounce } from './utils.js';
import { showView, closeModal } from './ui.js';
import { viewClientHistory, sellTicketForClient } from './clients.js';

// --- Constants ---
const RESULTS_PER_PAGE = 20;
const SOCIAL_TYPES = ['All', 'Viber', 'Messenger', 'Facebook', 'Telegram'];
const RESULT_TYPES = ['All', 'Clients', 'Tickets', 'PNR', 'Unpaid'];

// --- State ---
let searchState = {
    query: '',
    filters: {
        clientName: '',
        bookingRef: '',
        startDate: '',
        endDate: '',
        travelDate: '',
        departure: '',
        destination: '',
        airline: '',
        unpaidOnly: false,
        resultType: 'All',
        socialType: 'All'
    },
    page: 1,
    isSearching: false
};

// --- URL Sync ---
function updateSearchUrl() {
    const params = new URLSearchParams();
    if (searchState.query) params.set('q', searchState.query);
    if (searchState.filters.resultType !== 'All') params.set('type', searchState.filters.resultType.toLowerCase());
    if (searchState.filters.unpaidOnly) params.set('unpaid', 'true');
    if (searchState.filters.socialType !== 'All') params.set('social', searchState.filters.socialType.toLowerCase());
    if (searchState.filters.departure) params.set('departure', searchState.filters.departure);
    if (searchState.filters.destination) params.set('destination', searchState.filters.destination);
    if (searchState.filters.airline) params.set('airline', searchState.filters.airline);

    const hash = params.toString() ? `?${params.toString()}` : '';
    if (window.location.hash !== `#/search${hash}`) {
        history.replaceState(null, '', `#/search${hash}`);
    }
}

function readSearchUrl() {
    const hash = window.location.hash;
    if (!hash.startsWith('#/search')) return;
    const queryIndex = hash.indexOf('?');
    if (queryIndex === -1) return;
    const params = new URLSearchParams(hash.slice(queryIndex + 1));
    if (params.has('q')) searchState.query = params.get('q');
    if (params.has('type')) searchState.filters.resultType = params.get('type').replace(/^./, c => c.toUpperCase());
    if (params.has('unpaid')) searchState.filters.unpaidOnly = params.get('unpaid') === 'true';
    if (params.has('social')) searchState.filters.socialType = params.get('social').replace(/^./, c => c.toUpperCase());
    if (params.has('departure')) searchState.filters.departure = params.get('departure');
    if (params.has('destination')) searchState.filters.destination = params.get('destination');
    if (params.has('airline')) searchState.filters.airline = params.get('airline');
}

// --- Core Search Logic ---

function rankMatch(query, item) {
    const q = query.toUpperCase().trim();
    if (!q) return 1;

    const qParts = q.split(/\s+/);
    let score = 0;

    // Exact PNR / booking reference match — highest priority
    const bookingRef = String(item.booking_reference || '').toUpperCase();
    if (bookingRef === q) score += 1000;
    else if (bookingRef.includes(q)) score += 500;

    // Exact name match
    const name = String(item.name || '').toUpperCase();
    if (name === q) score += 800;
    else if (name.includes(q)) score += 400;

    // Phone match
    const phone = String(item.phone || '').toUpperCase();
    if (phone === q) score += 700;
    else if (phone.includes(q)) score += 350;

    // Account / social media match
    const account = String(item.account_name || '').toUpperCase();
    if (account === q) score += 600;
    else if (account.includes(q)) score += 300;

    const accountType = String(item.account_type || '').toUpperCase();
    if (accountType === q) score += 550;
    else if (accountType.includes(q)) score += 250;

    // Route / location match
    const departure = String(item.departure || '').toUpperCase();
    const destination = String(item.destination || '').toUpperCase();
    const route = `${departure}-${destination}`;
    if (route.includes(q) || departure === q || destination === q) score += 300;
    else if (departure.includes(q) || destination.includes(q)) score += 150;

    // Airline match
    const airline = String(item.airline || '').toUpperCase();
    if (airline === q) score += 400;
    else if (airline.includes(q)) score += 200;

    // Multi-word partial matches
    for (const part of qParts) {
        if (part.length < 2) continue;
        if (name.includes(part)) score += 50;
        if (account.includes(part)) score += 40;
        if (phone.includes(part)) score += 45;
        if (bookingRef.includes(part)) score += 60;
    }

    return score;
}

function performGlobalSearch() {
    const q = searchState.query.toUpperCase().trim();
    const f = searchState.filters;

    let searchStartDate = f.startDate ? parseSheetDate(f.startDate) : null;
    let searchEndDate = f.endDate ? parseSheetDate(f.endDate) : null;
    if (searchStartDate) searchStartDate.setHours(0, 0, 0, 0);
    if (searchEndDate) searchEndDate.setHours(23, 59, 59, 999);
    let searchTravelDate = f.travelDate ? parseSheetDate(f.travelDate) : null;

    // --- 1. Search Tickets ---
    let ticketResults = [];
    if (f.resultType === 'All' || f.resultType === 'Tickets' || f.resultType === 'PNR' || f.resultType === 'Unpaid') {
        ticketResults = state.allTickets.map(t => ({ ...t, _score: rankMatch(q, t) }))
            .filter(t => {
                if (t._score === 0 && q) return false;
                const issuedDate = parseSheetDate(t.issued_date);
                const travelDate = parseSheetDate(t.departing_on);

                const clientNameMatch = !f.clientName || String(t.name || '').toUpperCase().includes(f.clientName.toUpperCase());
                const bookRefMatch = !f.bookingRef || String(t.booking_reference || '').toUpperCase().includes(f.bookingRef.toUpperCase());
                const issuedDateMatch = (!searchStartDate || issuedDate >= searchStartDate) && (!searchEndDate || issuedDate <= searchEndDate);
                const travelDateMatch = !searchTravelDate || (travelDate && travelDate.getTime() === searchTravelDate.getTime());
                const departureMatch = !f.departure || (t.departure && t.departure.toUpperCase() === f.departure.toUpperCase());
                const destinationMatch = !f.destination || (t.destination && t.destination.toUpperCase() === f.destination.toUpperCase());
                const airlineMatch = !f.airline || (t.airline && t.airline.toUpperCase() === f.airline.toUpperCase());
                const paidMatch = !f.unpaidOnly || !t.paid;
                const socialMatch = f.socialType === 'All' || (t.account_type && t.account_type.toLowerCase() === f.socialType.toLowerCase());

                return clientNameMatch && bookRefMatch && issuedDateMatch && travelDateMatch && departureMatch && destinationMatch && airlineMatch && paidMatch && socialMatch;
            })
            .sort((a, b) => b._score - a._score || parseSheetDate(b.issued_date) - parseSheetDate(a.issued_date));
    }

    // --- 2. Search Clients ---
    let clientResults = [];
    if (f.resultType === 'All' || f.resultType === 'Clients') {
        clientResults = state.allClients.map(c => ({ ...c, _score: rankMatch(q, c) }))
            .filter(c => {
                if (c._score === 0 && q) return false;
                const nameMatch = !f.clientName || String(c.name || '').toUpperCase().includes(f.clientName.toUpperCase());
                const socialMatch = f.socialType === 'All' || (c.account_type && c.account_type.toLowerCase() === f.socialType.toLowerCase());
                return nameMatch && socialMatch;
            })
            .sort((a, b) => b._score - a._score || (b.ticket_count || 0) - (a.ticket_count || 0));
    }

    // --- 3. Filter PNR results (tickets with future travel date) ---
    let pnrResults = [];
    if (f.resultType === 'All' || f.resultType === 'PNR') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        pnrResults = ticketResults.filter(t => {
            const travelDate = parseSheetDate(t.departing_on);
            return travelDate >= today;
        });
    }

    // --- 4. Filter Unpaid results ---
    let unpaidResults = [];
    if (f.resultType === 'All' || f.resultType === 'Unpaid') {
        unpaidResults = ticketResults.filter(t => !t.paid);
    }

    return {
        clients: clientResults,
        tickets: ticketResults,
        pnr: pnrResults,
        unpaid: unpaidResults
    };
}

// --- Highlight helper ---
function highlightText(text, query) {
    if (!query || !text) return String(text || '');
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${q})`, 'gi');
    return String(text).replace(regex, '<mark class="search-highlight">$1</mark>');
}

// --- Render Results ---

function renderClientCard(client, query) {
    const isFeatured = state.featuredClients.includes(client.client_key) || state.featuredClients.includes(client.name);
    return `
        <div class="search-result-card search-client-card" data-client-key="${client.client_key}">
            <div class="result-card-header">
                <div class="result-avatar">
                    <i class="fa-solid fa-user"></i>
                </div>
                <div class="result-title-group">
                    <h4 class="result-title">${highlightText(client.name, query)}</h4>
                    <span class="result-meta">${client.ticket_count || 0} ticket${client.ticket_count !== 1 ? 's' : ''}</span>
                </div>
                <button class="icon-btn star-btn ${isFeatured ? 'featured' : ''}" title="Toggle Featured">
                    <i class="fa-${isFeatured ? 'solid' : 'regular'} fa-star"></i>
                </button>
            </div>
            <div class="result-card-body">
                <div class="result-detail-row">
                    <span class="detail-label">Phone</span>
                    <span class="detail-value">${highlightText(client.phone, query) || '—'}</span>
                </div>
                <div class="result-detail-row">
                    <span class="detail-label">Account</span>
                    <span class="detail-value">${highlightText(client.account_name, query) || '—'}</span>
                </div>
                ${client.account_type ? `
                <div class="result-detail-row">
                    <span class="detail-label">Type</span>
                    <span class="detail-value">${client.account_type}</span>
                </div>` : ''}
            </div>
            <div class="result-card-footer">
                <button class="btn btn-sm btn-secondary action-view-profile" data-key="${client.client_key}"><i class="fa-solid fa-eye"></i> View</button>
                <button class="btn btn-sm btn-primary action-sell-ticket" data-key="${client.client_key}"><i class="fa-solid fa-ticket"></i> Sell</button>
                <button class="btn btn-sm btn-secondary action-booking-history" data-key="${client.client_key}"><i class="fa-solid fa-clock-rotate-left"></i> History</button>
            </div>
        </div>
    `;
}

function renderTicketRow(ticket, query) {
    const route = `${ticket.departure || ''} → ${ticket.destination || ''}`;
    const travelDate = ticket.departing_on ? formatDateToDMMMY(ticket.departing_on) : '—';
    const issuedDate = ticket.issued_date ? formatDateToDMMMY(ticket.issued_date) : '—';
    const statusClass = ticket.paid ? 'status-paid' : 'status-unpaid';
    const statusText = ticket.paid ? 'Paid' : 'Unpaid';

    return `
        <div class="search-result-card search-ticket-card" data-ticket-id="${ticket.id || ''}">
            <div class="result-card-header">
                <div class="result-avatar result-avatar-ticket">
                    <i class="fa-solid fa-ticket"></i>
                </div>
                <div class="result-title-group">
                    <h4 class="result-title">${highlightText(ticket.booking_reference, query) || 'No Ref'}</h4>
                    <span class="result-meta">${route}</span>
                </div>
                <span class="result-status ${statusClass}">${statusText}</span>
            </div>
            <div class="result-card-body">
                <div class="result-detail-row">
                    <span class="detail-label">Client</span>
                    <span class="detail-value">${highlightText(ticket.name, query) || '—'}</span>
                </div>
                <div class="result-detail-row">
                    <span class="detail-label">Travel</span>
                    <span class="detail-value">${travelDate}</span>
                </div>
                <div class="result-detail-row">
                    <span class="detail-label">Issued</span>
                    <span class="detail-value">${issuedDate}</span>
                </div>
                <div class="result-detail-row">
                    <span class="detail-label">Airline</span>
                    <span class="detail-value">${ticket.airline || '—'}</span>
                </div>
            </div>
            <div class="result-card-footer">
                <button class="btn btn-sm btn-secondary action-view-ticket" data-id="${ticket.id || ''}"><i class="fa-solid fa-eye"></i> View</button>
                <button class="btn btn-sm btn-secondary action-edit-ticket" data-id="${ticket.id || ''}"><i class="fa-solid fa-pen"></i> Edit</button>
                <button class="btn btn-sm btn-primary action-settle-ticket" data-id="${ticket.id || ''}"><i class="fa-solid fa-handshake"></i> Settle</button>
            </div>
        </div>
    `;
}

function renderSearchResults(results, query) {
    const container = document.getElementById('searchResultsContainer');
    if (!container) return;

    const hasAnyResults = results.clients.length > 0 || results.tickets.length > 0 || results.pnr.length > 0 || results.unpaid.length > 0;

    if (!hasAnyResults) {
        container.innerHTML = `
            <div class="search-empty-state">
                <i class="fa-solid fa-magnifying-glass"></i>
                <h3>No results found</h3>
                <p>Your search for "<strong>${escapeHtml(query)}</strong>" did not match anything.</p>
                <ul class="search-suggestions">
                    <li><i class="fa-solid fa-check"></i> Check spelling</li>
                    <li><i class="fa-solid fa-check"></i> Try phone number</li>
                    <li><i class="fa-solid fa-check"></i> Try PNR or booking reference</li>
                    <li><i class="fa-solid fa-check"></i> Clear filters</li>
                </ul>
                <button class="btn btn-primary" id="searchClearAllBtn"><i class="fa-solid fa-eraser"></i> Clear All Filters</button>
            </div>
        `;
        document.getElementById('searchClearAllBtn')?.addEventListener('click', clearAllSearchFilters);
        return;
    }

    let html = '';

    if (results.clients.length > 0) {
        html += `
            <div class="search-group">
                <h3 class="search-group-title"><i class="fa-solid fa-users"></i> Clients <span class="search-count">${results.clients.length}</span></h3>
                <div class="search-results-grid">${results.clients.slice(0, RESULTS_PER_PAGE).map(c => renderClientCard(c, query)).join('')}</div>
            </div>`;
    }

    if (results.tickets.length > 0 && searchState.filters.resultType !== 'Clients') {
        html += `
            <div class="search-group">
                <h3 class="search-group-title"><i class="fa-solid fa-ticket"></i> Tickets <span class="search-count">${results.tickets.length}</span></h3>
                <div class="search-results-grid">${results.tickets.slice(0, RESULTS_PER_PAGE).map(t => renderTicketRow(t, query)).join('')}</div>
            </div>`;
    }

    if (results.pnr.length > 0 && (searchState.filters.resultType === 'All' || searchState.filters.resultType === 'PNR')) {
        html += `
            <div class="search-group">
                <h3 class="search-group-title"><i class="fa-solid fa-plane-up"></i> Upcoming PNR <span class="search-count">${results.pnr.length}</span></h3>
                <div class="search-results-grid">${results.pnr.slice(0, RESULTS_PER_PAGE).map(t => renderTicketRow(t, query)).join('')}</div>
            </div>`;
    }

    if (results.unpaid.length > 0 && (searchState.filters.resultType === 'All' || searchState.filters.resultType === 'Unpaid')) {
        html += `
            <div class="search-group">
                <h3 class="search-group-title"><i class="fa-solid fa-circle-exclamation"></i> Unpaid <span class="search-count">${results.unpaid.length}</span></h3>
                <div class="search-results-grid">${results.unpaid.slice(0, RESULTS_PER_PAGE).map(t => renderTicketRow(t, query)).join('')}</div>
            </div>`;
    }

    container.innerHTML = html;

    // Wire up action buttons
    container.querySelectorAll('.action-view-profile').forEach(btn => {
        btn.addEventListener('click', () => viewClientHistory(btn.dataset.key));
    });
    container.querySelectorAll('.action-sell-ticket').forEach(btn => {
        btn.addEventListener('click', () => sellTicketForClient(btn.dataset.key));
    });
    container.querySelectorAll('.action-booking-history').forEach(btn => {
        btn.addEventListener('click', () => viewClientHistory(btn.dataset.key));
    });
    container.querySelectorAll('.star-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const card = btn.closest('.search-client-card');
            const key = card.dataset.clientKey;
            toggleFeaturedClientSearch(e, key);
        });
    });

    // Ticket actions
    container.querySelectorAll('.action-view-ticket').forEach(btn => {
        btn.addEventListener('click', () => {
            showToast('View ticket — feature coming soon', 'info');
        });
    });
    container.querySelectorAll('.action-edit-ticket').forEach(btn => {
        btn.addEventListener('click', () => {
            showToast('Edit ticket — feature coming soon', 'info');
        });
    });
    container.querySelectorAll('.action-settle-ticket').forEach(btn => {
        btn.addEventListener('click', () => {
            showView('settle');
        });
    });
}

function toggleFeaturedClientSearch(e, clientKey) {
    const idx = state.featuredClients.indexOf(clientKey);
    if (idx > -1) {
        state.featuredClients.splice(idx, 1);
    } else {
        state.featuredClients.push(clientKey);
    }
    // Save to localStorage
    try {
        localStorage.setItem('featuredClients', JSON.stringify(state.featuredClients));
    } catch {}
    const btn = e.currentTarget;
    const isFeatured = state.featuredClients.includes(clientKey);
    btn.classList.toggle('featured', isFeatured);
    btn.querySelector('i').className = `fa-${isFeatured ? 'solid' : 'regular'} fa-star`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Filter Panel ---

function buildFilterPanel() {
    const panel = document.getElementById('searchFilterPanel');
    if (!panel || panel.dataset.built) return;
    panel.dataset.built = 'true';

    panel.innerHTML = `
        <div class="search-filter-inner">
            <h4 class="filter-panel-title"><i class="fa-solid fa-filter"></i> Filters</h4>

            <div class="filter-group">
                <label>Result Type</label>
                <select id="searchFilterResultType" class="filter-select">
                    ${RESULT_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
            </div>

            <div class="filter-group">
                <label>Client Name</label>
                <input type="text" id="searchFilterClientName" placeholder="Any name..." class="filter-input">
            </div>

            <div class="filter-group">
                <label>Booking / PNR</label>
                <input type="text" id="searchFilterBookingRef" placeholder="Reference..." class="filter-input">
            </div>

            <div class="filter-group">
                <label>Date Range</label>
                <input type="text" id="searchFilterStartDate" placeholder="Start Date" class="filter-input" autocomplete="off">
                <input type="text" id="searchFilterEndDate" placeholder="End Date" class="filter-input" autocomplete="off">
                <div class="date-shortcuts">
                    <button type="button" class="date-chip" data-range="7">Last 7 Days</button>
                    <button type="button" class="date-chip" data-range="30">Last 30 Days</button>
                    <button type="button" class="date-chip" data-range="month">This Month</button>
                </div>
            </div>

            <div class="filter-group">
                <label>Travel Date</label>
                <input type="text" id="searchFilterTravelDate" placeholder="MM/DD/YYYY" class="filter-input" autocomplete="off">
            </div>

            <div class="filter-group">
                <label>Route</label>
                <select id="searchFilterDeparture" class="filter-select">
                    <option value="">Any Departure</option>
                </select>
                <select id="searchFilterDestination" class="filter-select">
                    <option value="">Any Destination</option>
                </select>
            </div>

            <div class="filter-group">
                <label>Airline</label>
                <select id="searchFilterAirline" class="filter-select">
                    <option value="">Any Airline</option>
                </select>
            </div>

            <div class="filter-group">
                <label>Social Media</label>
                <select id="searchFilterSocialType" class="filter-select">
                    ${SOCIAL_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
            </div>

            <div class="filter-group filter-toggle">
                <label class="toggle-label">
                    <span>Unpaid Only</span>
                    <label class="switch">
                        <input type="checkbox" id="searchFilterUnpaid">
                        <span class="slider round"></span>
                    </label>
                </label>
            </div>

            <div class="filter-actions">
                <button id="searchApplyFiltersBtn" class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Apply</button>
                <button id="searchResetFiltersBtn" class="btn btn-secondary btn-sm"><i class="fa-solid fa-rotate-left"></i> Reset</button>
            </div>
        </div>
    `;

    // Populate dropdowns
    populateSearchFilterAirlines();
    populateSearchFilterLocations();

    // Event listeners
    const debouncedRefresh = debounce(() => {
        syncFiltersFromDom();
        refreshSearchView();
    }, 250);

    ['searchFilterClientName', 'searchFilterBookingRef'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', debouncedRefresh);
    });
    ['searchFilterResultType', 'searchFilterDeparture', 'searchFilterDestination', 'searchFilterAirline', 'searchFilterSocialType'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', debouncedRefresh);
    });
    ['searchFilterStartDate', 'searchFilterEndDate', 'searchFilterTravelDate'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', debouncedRefresh);
    });
    document.getElementById('searchFilterUnpaid')?.addEventListener('change', debouncedRefresh);

    // Date shortcuts
    panel.querySelectorAll('.date-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            setSearchDateRangePreset(btn.dataset.range);
        });
    });

    document.getElementById('searchApplyFiltersBtn')?.addEventListener('click', () => {
        syncFiltersFromDom();
        refreshSearchView();
    });
    document.getElementById('searchResetFiltersBtn')?.addEventListener('click', clearAllSearchFilters);
}

function populateSearchFilterAirlines() {
    const select = document.getElementById('searchFilterAirline');
    if (!select || select.options.length > 1) return;
    const airlines = [...new Set(state.allTickets.map(t => t.airline).filter(Boolean))].sort();
    airlines.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        select.appendChild(opt);
    });
}

function populateSearchFilterLocations() {
    const depSelect = document.getElementById('searchFilterDeparture');
    const destSelect = document.getElementById('searchFilterDestination');
    if (!depSelect || !destSelect) return;

    const locations = [...new Set([
        ...state.allTickets.map(t => t.departure),
        ...state.allTickets.map(t => t.destination)
    ].filter(Boolean))].sort();

    locations.forEach(loc => {
        if (![...depSelect.options].some(o => o.value === loc)) {
            depSelect.appendChild(new Option(loc, loc));
        }
        if (![...destSelect.options].some(o => o.value === loc)) {
            destSelect.appendChild(new Option(loc, loc));
        }
    });
}

function syncFiltersFromDom() {
    searchState.filters.clientName = document.getElementById('searchFilterClientName')?.value || '';
    searchState.filters.bookingRef = document.getElementById('searchFilterBookingRef')?.value || '';
    searchState.filters.startDate = document.getElementById('searchFilterStartDate')?.value || '';
    searchState.filters.endDate = document.getElementById('searchFilterEndDate')?.value || '';
    searchState.filters.travelDate = document.getElementById('searchFilterTravelDate')?.value || '';
    searchState.filters.departure = document.getElementById('searchFilterDeparture')?.value || '';
    searchState.filters.destination = document.getElementById('searchFilterDestination')?.value || '';
    searchState.filters.airline = document.getElementById('searchFilterAirline')?.value || '';
    searchState.filters.resultType = document.getElementById('searchFilterResultType')?.value || 'All';
    searchState.filters.socialType = document.getElementById('searchFilterSocialType')?.value || 'All';
    searchState.filters.unpaidOnly = document.getElementById('searchFilterUnpaid')?.checked || false;
}

function syncFiltersToDom() {
    const f = searchState.filters;
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    setVal('searchFilterClientName', f.clientName);
    setVal('searchFilterBookingRef', f.bookingRef);
    setVal('searchFilterStartDate', f.startDate);
    setVal('searchFilterEndDate', f.endDate);
    setVal('searchFilterTravelDate', f.travelDate);
    setVal('searchFilterDeparture', f.departure);
    setVal('searchFilterDestination', f.destination);
    setVal('searchFilterAirline', f.airline);
    setVal('searchFilterResultType', f.resultType);
    setVal('searchFilterSocialType', f.socialType);
    const unpaidEl = document.getElementById('searchFilterUnpaid');
    if (unpaidEl) unpaidEl.checked = f.unpaidOnly;
}

function setSearchDateRangePreset(range) {
    const startInput = document.getElementById('searchFilterStartDate');
    const endInput = document.getElementById('searchFilterEndDate');
    if (!startInput || !endInput) return;
    const today = new Date();
    let startDate = new Date();
    if (range === '7') startDate.setDate(today.getDate() - 7);
    else if (range === '30') startDate.setDate(today.getDate() - 30);
    else if (range === 'month') startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    startInput.value = formatDateForSheet(startDate);
    endInput.value = formatDateForSheet(today);
    syncFiltersFromDom();
    refreshSearchView();
}

function clearAllSearchFilters() {
    searchState.filters = {
        clientName: '', bookingRef: '', startDate: '', endDate: '', travelDate: '',
        departure: '', destination: '', airline: '', unpaidOnly: false,
        resultType: 'All', socialType: 'All'
    };
    searchState.query = '';
    syncFiltersToDom();
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) searchInput.value = '';
    const pageSearchInput = document.getElementById('searchPageInput');
    if (pageSearchInput) pageSearchInput.value = '';
    refreshSearchView();
}

// --- Main View Controller ---

export function initSearchView() {
    buildFilterPanel();
    syncFiltersToDom();
    readSearchUrl();

    // Set inputs from URL
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput && searchState.query) searchInput.value = searchState.query;
    const pageSearchInput = document.getElementById('searchPageInput');
    if (pageSearchInput && searchState.query) pageSearchInput.value = searchState.query;

    refreshSearchView();
}

export function refreshSearchView() {
    const container = document.getElementById('searchResultsContainer');
    if (!container) return;

    const subtitle = document.getElementById('searchSubtitle');
    if (subtitle) {
        if (searchState.query) {
            subtitle.innerHTML = `Showing results for "<strong>${escapeHtml(searchState.query)}</strong>"`;
        } else {
            subtitle.textContent = 'Search clients, tickets, PNR, or accounts';
        }
    }

    // Show loading
    container.innerHTML = `
        <div class="search-loading">
            <div class="spinner"></div>
            <p>Searching…</p>
        </div>
    `;

    // Debounced actual search
    if (searchState.searchTimeout) clearTimeout(searchState.searchTimeout);
    searchState.searchTimeout = setTimeout(() => {
        const results = performGlobalSearch();
        renderSearchResults(results, searchState.query);
        updateSearchUrl();
    }, 150);
}

export function handleGlobalSearch(query) {
    searchState.query = query;
    showView('search');
    refreshSearchView();
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
