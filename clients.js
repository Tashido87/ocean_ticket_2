/**
 * @fileoverview Manages all logic related to clients, including building the client list,
 * rendering the clients view, viewing history, and managing featured clients.
 */

import {
    state
} from './state.js';
import {
    showToast,
    parseSheetDate,
    formatDateToDMMMY
} from './utils.js';
import {
    openModal,
    closeModal,
    showView,
    resetPassengerForms,
    populatePassengerCardFromClient,
    resetBookingPassengerForms,
    addBookingPassengerForm,
    showNewBookingForm
} from './ui.js';
import { openPhotoLightbox } from './passport.js';

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

/**
 * Builds a comprehensive list of unique clients from the ticket data.
 */
export function buildClientList() {
    const clients = {};
    state.allTickets.forEach(ticket => {
        const baseName = String(ticket.name || '').replace(/\(fees\)\s*$/i, '').trim();
        const clientKey = `${baseName}|${ticket.phone}|${ticket.account_name}`;
        const lowerRemarks = ticket.remarks?.toLowerCase() || '';
        const ticketNrc = looksLikeNrc(ticket.nrc_no) ? ticket.nrc_no : (looksLikeNrc(ticket.id_no) ? ticket.id_no : '');
        const ticketPassport = ticket.passport_no
            || (looksLikePassport(ticket.nrc_no) ? ticket.nrc_no : '')
            || (looksLikePassport(ticket.id_no) ? ticket.id_no : '');
        if (!clients[clientKey]) {
            clients[clientKey] = {
                client_key: clientKey,
                name: baseName,
                phone: ticket.phone,
                account_name: ticket.account_name,
                account_type: ticket.account_type,
                account_link: ticket.account_link,
                id_no: ticket.id_no,
                nrc_no: ticketNrc || '',
                document_type: ticketPassport ? 'Passport' : 'NRC',
                passport_no: ticketPassport || '',
                passport_expiry: ticket.passport_expiry || '',
                passport_photo_url: ticket.passport_photo_url || '',
                passport_photo_path: ticket.passport_photo_path || '',
                dob: ticket.dob || '',
                nationality: ticket.nationality || 'MMR',
                gender: ticket.gender,
                ticket_count: 0,
                total_spent: 0,
                last_travel: new Date(0),
                last_issued: new Date(0)
            };
        }
        if (!clients[clientKey].nrc_no && ticketNrc) clients[clientKey].nrc_no = ticketNrc;
        if (!clients[clientKey].id_no && ticket.id_no) clients[clientKey].id_no = ticket.id_no;
        if (!clients[clientKey].passport_no && ticketPassport) clients[clientKey].passport_no = ticketPassport;
        if (!clients[clientKey].passport_expiry && ticket.passport_expiry) clients[clientKey].passport_expiry = ticket.passport_expiry;
        if (!clients[clientKey].passport_photo_url && ticket.passport_photo_url) clients[clientKey].passport_photo_url = ticket.passport_photo_url;
        if (!clients[clientKey].passport_photo_path && ticket.passport_photo_path) clients[clientKey].passport_photo_path = ticket.passport_photo_path;
        if (!clients[clientKey].dob && ticket.dob) clients[clientKey].dob = ticket.dob;
        if ((!clients[clientKey].nationality || clients[clientKey].nationality === 'MMR') && ticket.nationality) clients[clientKey].nationality = ticket.nationality;
        if (!clients[clientKey].frequent_flyer_no && ticket.member_id) clients[clientKey].frequent_flyer_no = ticket.member_id;
        if (!clients[clientKey].member_airline && ticket.member_airline) clients[clientKey].member_airline = ticket.member_airline;
        if (!clients[clientKey].frequent_flyer_ids && ticket.frequent_flyer_ids) {
            try {
                const parsed = JSON.parse(ticket.frequent_flyer_ids);
                if (Array.isArray(parsed) && parsed.length) clients[clientKey].frequent_flyer_ids = parsed;
            } catch {
                // ignore
            }
        }

        if (!lowerRemarks.includes('cancel') && !lowerRemarks.includes('refund')) {
            if (!isFeeEntry(ticket)) {
                clients[clientKey].ticket_count++;
            }
            clients[clientKey].total_spent += (ticket.net_amount || 0) + (ticket.extra_fare || 0) + (ticket.date_change || 0);
        }
        const travelDate = parseSheetDate(ticket.departing_on);
        if (travelDate > clients[clientKey].last_travel) {
            clients[clientKey].last_travel = travelDate;
        }

        const issuedDate = parseSheetDate(ticket.issued_date);
        if (issuedDate > clients[clientKey].last_issued) {
            clients[clientKey].last_issued = issuedDate;
        }
    });

    state.allClients = Object.values(clients);
    // Sort logic removed from here as it will be handled directly in renderClientsView
}

/**
 * Renders the client directory view with search and pagination.
 * @param {number} [page] The page number to render.
 */
export function renderClientsView(page) {
    const container = document.getElementById('clients-view');
    if (!container) return;

    const pageToRender = page || state.clientPage || 1;
    state.clientPage = pageToRender;
    const searchQuery = state.clientSearchQuery || '';

    // Build the view's inner HTML if it's not already there
    if (!container.querySelector('.clients-container')) {
        // MODIFICATION: Added span id="clientTotalCount" to the header
        container.innerHTML = `
            <div class="clients-container">
                <div class="clients-header">
                    <h2>
                        <i class="fa-solid fa-users"></i> Client Directory 
                        <span id="clientTotalCount" class="notification-count" style="font-size: 0.9rem; vertical-align: middle; margin-left: 0.5rem; background-color: var(--primary-accent); color: var(--bg-color);">0</span>
                    </h2>
                    <div class="client-controls">
                        <div class="client-search-box" style="display: flex; gap: 0.5rem; align-items: center;">
                            <button id="featuredFilterBtn" class="icon-btn" title="Show Featured Only"><i class="fa-regular fa-star"></i></button>
                            <input type="text" id="clientSearchInput" placeholder="Search by name, phone, or social media...">
                            <select id="clientSortSelect" style="padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--glass-bg); color: var(--text-color);">
                                <option value="alphabetical">Alphabetical</option>
                                <option value="recently_issued">Recently Issued</option>
                                <option value="most_tickets">Most Tickets</option>
                                <option value="highest_spent">Highest Spent</option>
                            </select>
                            <button id="clientClearBtn" class="btn btn-secondary"><i class="fa-solid fa-eraser"></i></button>
                        </div>
                    </div>
                </div>
                <div class="results-section glass-card">
                    <div class="table-container">
                        <table id="clientListTable">
                            <thead>
                                <tr>
                                    <th></th><th>Client Name</th><th>Phone</th><th>Social Media</th><th>Social Media Type</th><th>Total Tickets</th><th>Action Buttons</th>
                                </tr>
                            </thead>
                            <tbody id="clientListTableBody"></tbody>
                        </table>
                    </div>
                    <div id="clientListPagination" class="pagination-container"></div>
                </div>
            </div>`;
        document.getElementById('clientSearchInput').addEventListener('input', (e) => {
            state.clientSearchQuery = e.target.value;
            renderClientsView(1);
        });
        document.getElementById('clientClearBtn').addEventListener('click', () => {
            document.getElementById('clientSearchInput').value = '';
            state.clientSearchQuery = '';
            renderClientsView(1);
        });
        document.getElementById('featuredFilterBtn').addEventListener('click', () => {
            state.onlyShowFeatured = !state.onlyShowFeatured;
            renderClientsView(1);
        });
        document.getElementById('clientSortSelect').addEventListener('change', (e) => {
            localStorage.setItem('clientSortOption', e.target.value);
            renderClientsView(1);
        });
    }

    const tbody = document.getElementById('clientListTableBody');
    const paginationContainer = document.getElementById('clientListPagination');
    const featuredFilterBtn = document.getElementById('featuredFilterBtn');
    const clientSortSelect = document.getElementById('clientSortSelect');

    const savedSortOption = localStorage.getItem('clientSortOption') || 'alphabetical';
    if (clientSortSelect) {
        clientSortSelect.value = savedSortOption;
    }

    featuredFilterBtn.classList.toggle('active', state.onlyShowFeatured);
    document.getElementById('clientSearchInput').value = searchQuery;
    tbody.innerHTML = '';
    paginationContainer.innerHTML = '';

    const query = searchQuery.toLowerCase();
    let filteredClients = state.allClients;

    if (state.onlyShowFeatured) {
        filteredClients = filteredClients.filter(c => state.featuredClients.includes(c.name));
    }

    if (searchQuery) {
        const queryTokens = query.split(/\s+/).filter(Boolean);
        filteredClients = filteredClients.filter(c => {
            const n = String(c.name || '').toLowerCase();
            const p = String(c.phone || '').toLowerCase();
            const an = String(c.account_name || '').toLowerCase();
            const at = String(c.account_type || '').toLowerCase();
            return queryTokens.every(token => 
                n.includes(token) || p.includes(token) || an.includes(token) || at.includes(token)
            );
        });
    }

    // MODIFICATION: Update the total count badge
    const countBadge = document.getElementById('clientTotalCount');
    if (countBadge) {
        countBadge.textContent = filteredClients.length;
    }

    filteredClients.sort((a, b) => {
        const aIsFeatured = state.featuredClients.includes(a.client_key) || state.featuredClients.includes(a.name);
        const bIsFeatured = state.featuredClients.includes(b.client_key) || state.featuredClients.includes(b.name);
        if (aIsFeatured && !bIsFeatured) return -1;
        if (!aIsFeatured && bIsFeatured) return 1;

        if (searchQuery) {
            const aName = String(a.name || '').toLowerCase();
            const bName = String(b.name || '').toLowerCase();
            const getScore = (n) => {
                if (n.startsWith(query)) return 3;
                if (n.includes(query)) return 2;
                const tokens = query.split(/\s+/).filter(Boolean);
                if (tokens.length > 0 && n.startsWith(tokens[0])) return 1.5;
                return 1;
            };
            const aScore = getScore(aName);
            const bScore = getScore(bName);
            if (aScore !== bScore) return bScore - aScore;
        }

        if (savedSortOption === 'recently_issued') {
            return b.last_issued - a.last_issued;
        } else if (savedSortOption === 'most_tickets') {
            return b.ticket_count - a.ticket_count;
        } else if (savedSortOption === 'highest_spent') {
            return b.total_spent - a.total_spent;
        }

        return a.name.localeCompare(b.name);
    });

    if (filteredClients.length === 0) {
        const colSpan = 7;
        let message = `There are no clients in the system yet.`;
        if (state.onlyShowFeatured) {
            message = 'You have not marked any clients as featured.';
        } else if (searchQuery) {
            message = `Your search for "${searchQuery}" did not match any clients.`;
        }
        const icon = searchQuery ? `fa-user-slash` : `fa-users`;
        tbody.innerHTML = `<tr><td colspan="${colSpan}"><div class="empty-state" style="padding: 2rem 1rem;"><i class="fa-solid ${icon}"></i><h4>No Clients Found</h4><p>${message}</p></div></td></tr>`;
        return;
    }

    const paginated = filteredClients.slice((pageToRender - 1) * state.rowsPerPage, pageToRender * state.rowsPerPage);

    paginated.forEach(client => {
        const isFeatured = state.featuredClients.includes(client.client_key) || state.featuredClients.includes(client.name);
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><i class="fa-regular fa-star star-icon ${isFeatured ? 'featured' : ''}"></i></td>
            <td class="client-name-cell">${client.name || ''}</td>
            <td>${client.phone || ''}</td>
            <td>${client.account_name || ''}</td>
            <td>${client.account_type || ''}</td>
            <td>${client.ticket_count}</td>
            <td class="client-actions">
                <button class="icon-btn icon-btn-table" title="Detail"><i class="fa-solid fa-eye"></i></button>
                <button class="icon-btn icon-btn-table" title="Copy Info"><i class="fa-solid fa-copy"></i></button>
                <button class="icon-btn icon-btn-table" title="New Booking"><i class="fa-solid fa-calendar-plus"></i></button>
                <button class="icon-btn icon-btn-table" title="Sell New Ticket"><i class="fa-solid fa-ticket"></i></button>
            </td>
        `
        // Add event listeners
        row.querySelector('.star-icon').addEventListener('click', (e) => toggleFeaturedClient(e, client.client_key));
        row.querySelector('[title="Detail"]').addEventListener('click', () => viewClientHistory(client.client_key));
        row.querySelector('[title="Copy Info"]').addEventListener('click', () => copyClientInfo(client.name, client.nrc_no || client.id_no, client.phone, client.gender));
        row.querySelector('[title="New Booking"]').addEventListener('click', () => bookForClient(client.client_key));
        row.querySelector('[title="Sell New Ticket"]').addEventListener('click', () => sellTicketForClient(client.client_key));
    });

    const pageCount = Math.ceil(filteredClients.length / state.rowsPerPage);
    if (pageCount <= 1) return;
    const btn = (txt, pg, en = true) => {
        const b = document.createElement('button');
        b.className = 'pagination-btn';
        b.innerHTML = txt;
        b.disabled = !en;
        if (en) b.onclick = () => renderClientsView(pg);
        if (pg === state.clientPage) b.classList.add('active');
        return b;
    };
    
    // --- PAGINATION LOGIC ---
    const maxPagesToShow = 5;
    let startPage = Math.max(1, state.clientPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(pageCount, startPage + maxPagesToShow - 1);
    
    // Adjust start page if we are near the end
    if (endPage - startPage + 1 < maxPagesToShow) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    paginationContainer.append(btn('&laquo;', 1, state.clientPage > 1));
    
    if (startPage > 1) {
        paginationContainer.append(btn('...', startPage - 1));
    }

    for (let i = startPage; i <= endPage; i++) {
        paginationContainer.append(btn(i, i));
    }
    
    if (endPage < pageCount) {
         paginationContainer.append(btn('...', endPage + 1));
    }
    
    paginationContainer.append(btn('&raquo;', pageCount, state.clientPage < pageCount));
}

/**
 * Computes the status of a passport expiry date string (DD/MM/YYYY).
 * Returns { level: 'expired' | 'soon' | 'ok', formatted, daysAbs?, daysUntil? }
 * 'soon' = expires within 6 months from today.
 */
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

/**
 * Copies a client's information to the clipboard.
 * @param {string} name The client's name.
 * @param {string} id The client's ID number.
 * @param {string} phone The client's phone number.
 * @param {string} gender The client's gender.
 */
function copyClientInfo(name, id, phone, gender) {
    const prefix = gender ? `${gender} ` : '';
    const textToCopy = `${prefix}${name}\n${id}\n${phone}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
        showToast(`Copied info for ${name}`, 'success');
    }, (err) => {
        showToast('Failed to copy text.', 'error');
        console.error('Could not copy text: ', err);
    });
}

/**
 * Open the rich client detail view inside the Search Results page.
 * Replaces the legacy modal-based history viewer.
 * @param {string} clientKey
 */
export function viewClientHistory(clientKey) {
    if (!clientKey) return;
    // Lazy import to avoid circular dependency at module load time
    import('./search.js').then(mod => {
        if (typeof mod.navigateToClient === 'function') mod.navigateToClient(clientKey);
    });
}

/**
 * @deprecated Legacy modal-based client history. Kept for fallback only; not exported.
 */
function _legacyViewClientHistory(clientKey) {
    const activeClient = state.allClients.find(c => c.client_key === clientKey);
    const clientName = activeClient ? activeClient.name : 'Unknown';

    const clientTickets = state.allTickets.filter(t => 
        `${t.name}|${t.phone}|${t.account_name}` === clientKey
    )
        .sort((a, b) => parseSheetDate(b.issued_date) - parseSheetDate(a.issued_date));

    if (clientTickets.length === 0) {
        showToast("No ticket history found for this client.", "info");
        return;
    }

    const firstTicket = clientTickets[0];
    const activeClientTickets = clientTickets.filter(t => {
        const lowerRemarks = t.remarks?.toLowerCase() || '';
        return !lowerRemarks.includes('cancel') && !lowerRemarks.includes('refund');
    });
    const totalSpent = activeClientTickets.reduce((sum, t) => sum + (t.net_amount || 0) + (t.extra_fare || 0) + (t.date_change || 0), 0);
    const totalProfit = activeClientTickets.reduce((sum, t) => sum + (t.commission || 0) + (t.extra_fare || 0), 0);
    const primaryId = activeClient?.nrc_no || firstTicket.nrc_no || firstTicket.id_no || 'N/A';
    const passportNo = activeClient?.passport_no || firstTicket.passport_no || '';
    
    // NOTE: Need to import isPlaceholderDate at top if we want it here, but actually we can just check '1970' directly for legacy
    let passportExpiry = activeClient?.passport_expiry || firstTicket.passport_expiry || '';
    if (passportExpiry && (passportExpiry.includes('1970') || passportExpiry.includes('1900') || passportExpiry === '00/00/0000')) {
        passportExpiry = '';
    }
    
    const passportPhotoUrl = activeClient?.passport_photo_url || firstTicket.passport_photo_url || '';

    let historyHtml = '<div class="table-container"><table id="clientHistoryTable"><thead><tr><th>Issued</th><th>PNR</th><th>Route</th><th>Travel Date</th><th>Airline</th><th>Net Amount</th></tr></thead><tbody>';
    clientTickets.forEach(t => {
        const isCanceled = t.remarks?.toLowerCase().includes('cancel') || t.remarks?.toLowerCase().includes('refund');
        historyHtml += `
            <tr class="${isCanceled ? 'canceled-row' : ''}">
                <td>${formatDateToDMMMY(t.issued_date)}</td>
                <td>${t.booking_reference}</td>
                <td>${t.departure.split(' ')[0]}→${t.destination.split(' ')[0]}</td>
                <td>${formatDateToDMMMY(t.departing_on)}</td>
                <td>${t.airline}</td>
                <td>${(t.net_amount || 0).toLocaleString()}</td>
            </tr>
        `;
    });
    historyHtml += '</tbody></table></div>';
    const expiryStatus = computePassportExpiryStatus(passportExpiry);
    const expiryWarningHtml = expiryStatus.level === 'expired'
        ? `<div class="passport-expiry-warning is-expired"><i class="fa-solid fa-circle-xmark"></i> <strong>Passport EXPIRED</strong> on ${expiryStatus.formatted} (${expiryStatus.daysAbs} days ago). A new passport is required before travel.</div>`
        : expiryStatus.level === 'soon'
        ? `<div class="passport-expiry-warning is-soon"><i class="fa-solid fa-triangle-exclamation"></i> <strong>Passport expires soon</strong> on ${expiryStatus.formatted} (in ${expiryStatus.daysUntil} day${expiryStatus.daysUntil === 1 ? '' : 's'}). Many airlines require at least 6 months validity — request a new passport before booking.</div>`
        : '';

    const documentsHtml = `
        <div class="client-documents">
            <h3><i class="fa-solid fa-passport"></i> Travel Documents</h3>
            <div class="client-documents-grid">
                <div class="client-doc-card">
                    <span class="doc-label">NRC</span>
                    <strong>${primaryId}</strong>
                </div>
                <div class="client-doc-card">
                    <span class="doc-label">Passport</span>
                    <strong>${passportNo || 'N/A'}</strong>
                    <small>Expiry: ${passportExpiry || 'N/A'}</small>
                </div>
                ${passportPhotoUrl ? `
                    <button type="button" class="client-doc-photo" id="clientDocPhotoBtn">
                        <img src="${passportPhotoUrl}" alt="Passport photo">
                        <span>View passport photo</span>
                    </button>
                ` : ''}
            </div>
            ${expiryWarningHtml}
        </div>
    `;

    const content = `
        <div class="client-history-header">
            <div class="client-history-info">
                <h2>${clientName}</h2>
                <p>NRC: ${primaryId} | Phone: ${firstTicket.phone || 'N/A'} | Social: ${firstTicket.account_name || 'N/A'} (${firstTicket.account_type || 'N/A'})</p>
            </div>
            <div class="client-history-actions">
                <button class="btn btn-primary" id="sellForClientBtn"><i class="fa-solid fa-ticket"></i> Sell New Ticket</button>
                <button class="btn btn-secondary" id="modalCloseBtn">Close</button>
            </div>
        </div>
        <div class="client-history-stats">
            <div class="stat-card"><div class="label">Total Tickets</div><div class="value">${activeClientTickets.length}</div></div>
            <div class="stat-card"><div class="label">Total Spent</div><div class="value">${totalSpent.toLocaleString()} MMK</div></div>
            <div class="stat-card"><div class="label">Total Profit</div><div class="value">${totalProfit.toLocaleString()} MMK</div></div>
        </div>
        ${documentsHtml}
        <h3>Ticket History</h3>
        ${historyHtml}
    `;

    openModal(content, 'large-modal');
    document.getElementById('sellForClientBtn').addEventListener('click', () => sellTicketForClient(clientKey));
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('clientDocPhotoBtn')?.addEventListener('click', () => openPhotoLightbox(passportPhotoUrl));
}

/**
 * Loads the list of featured clients from local storage.
 */
export function loadFeaturedClients() {
    const featured = localStorage.getItem('featuredClients');
    state.featuredClients = featured ? JSON.parse(featured) : [];
}

/**
 * Saves the current list of featured clients to local storage.
 */
function saveFeaturedClients() {
    localStorage.setItem('featuredClients', JSON.stringify(state.featuredClients));
}

/**
 * Toggles a client's featured status.
 * @param {Event} event The click event.
 * @param {string} clientKey The unique key of the client to toggle.
 */
function toggleFeaturedClient(event, clientKey) {
    event.stopPropagation();
    const icon = event.target;
    
    // First, check if legacy name-only is featured and remove it
    const clientInfo = state.allClients.find(c => c.client_key === clientKey);
    if (clientInfo) {
        const legacyIndex = state.featuredClients.indexOf(clientInfo.name);
        if (legacyIndex > -1) state.featuredClients.splice(legacyIndex, 1);
    }

    const index = state.featuredClients.indexOf(clientKey);

    if (index > -1) {
        state.featuredClients.splice(index, 1);
        icon.classList.remove('featured');
        showToast(`Removed from featured.`, 'info');
    } else {
        state.featuredClients.push(clientKey);
        icon.classList.add('featured');
        showToast(`Added to featured!`, 'success');
    }

    saveFeaturedClients();
    renderClientsView(state.clientPage);
}

/**
 * Pre-fills the "Sell Ticket" form for a specific client.
 * @param {string} clientKey The unique key of the client.
 */
export function sellTicketForClient(clientKey) {
    const client = state.allClients.find(c => c.client_key === clientKey);
    if (!client) {
        showToast('Could not find client details.', 'error');
        return;
    }

    showView('sell');
    closeModal();

    document.getElementById('phone').value = client.phone || '';
    document.getElementById('account_name').value = client.account_name || '';
    document.getElementById('account_type').value = client.account_type || '';
    document.getElementById('account_link').value = client.account_link || '';

    resetPassengerForms();
    const passengerCard = document.querySelector('#passenger-forms-container .passenger-form');
    if (passengerCard) populatePassengerCardFromClient(passengerCard, client);

    showToast(`Form pre-filled for ${client.name}.`, 'info');
}

/**
 * Pre-fills the "New Booking" form for a specific client.
 * @param {string} clientKey The unique key of the client.
 */
export function bookForClient(clientKey) {
    const client = state.allClients.find(c => c.client_key === clientKey);
    if (!client) {
        showToast('Could not find client details.', 'error');
        return;
    }

    showView('booking');
    showNewBookingForm();
    closeModal();

    document.getElementById('booking_phone').value = client.phone || '';
    document.getElementById('booking_account_name').value = client.account_name || '';
    document.getElementById('booking_account_type').value = client.account_type || '';
    document.getElementById('booking_account_link').value = client.account_link || '';

    resetBookingPassengerForms();
    const passengerGenderSelect = document.querySelector('#booking-passenger-forms-container .booking-passenger-gender');
    const passengerNameInput = document.querySelector('#booking-passenger-forms-container .booking-passenger-name');
    const passengerNrcInput = document.querySelector('#booking-passenger-forms-container .booking-passenger-nrc');
    const passengerPassportInput = document.querySelector('#booking-passenger-forms-container .booking-passenger-passport');

    if (passengerGenderSelect) passengerGenderSelect.value = client.gender || 'MR';
    if (passengerNameInput) passengerNameInput.value = client.name.toUpperCase();
    if (passengerNrcInput) passengerNrcInput.value = (client.nrc_no || '').toUpperCase();
    if (passengerPassportInput) passengerPassportInput.value = (client.passport_no || '').toUpperCase();

    showToast(`Booking form pre-filled for ${client.name}.`, 'info');
}
