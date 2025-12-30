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
    addPassengerForm,
    resetBookingPassengerForms,
    addBookingPassengerForm,
    showNewBookingForm
} from './ui.js';

/**
 * Builds a comprehensive list of unique clients from the ticket data.
 */
export function buildClientList() {
    const clients = {};
    state.allTickets.forEach(ticket => {
        const clientKey = `${ticket.name}|${ticket.phone}|${ticket.account_name}`;
        const lowerRemarks = ticket.remarks?.toLowerCase() || '';
        if (!clients[clientKey]) {
            clients[clientKey] = {
                name: ticket.name,
                phone: ticket.phone,
                account_name: ticket.account_name,
                account_type: ticket.account_type,
                account_link: ticket.account_link,
                id_no: ticket.id_no,
                gender: ticket.gender,
                ticket_count: 0,
                total_spent: 0,
                last_travel: new Date(0)
            };
        }
        if (!lowerRemarks.includes('cancel') && !lowerRemarks.includes('refund')) {
            clients[clientKey].ticket_count++;
            clients[clientKey].total_spent += (ticket.net_amount || 0) + (ticket.extra_fare || 0) + (ticket.date_change || 0);
        }
        const travelDate = parseSheetDate(ticket.departing_on);
        if (travelDate > clients[clientKey].last_travel) {
            clients[clientKey].last_travel = travelDate;
        }
    });

    state.allClients = Object.values(clients).sort((a, b) => a.name.localeCompare(b.name));
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
    }

    const tbody = document.getElementById('clientListTableBody');
    const paginationContainer = document.getElementById('clientListPagination');
    const featuredFilterBtn = document.getElementById('featuredFilterBtn');

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
        filteredClients = filteredClients.filter(c =>
            c.name.toLowerCase().includes(query) ||
            c.phone.toLowerCase().includes(query) ||
            (c.account_name && c.account_name.toLowerCase().includes(query)) ||
            (c.account_type && c.account_type.toLowerCase().includes(query))
        );
    }

    // MODIFICATION: Update the total count badge
    const countBadge = document.getElementById('clientTotalCount');
    if (countBadge) {
        countBadge.textContent = filteredClients.length;
    }

    filteredClients.sort((a, b) => {
        const aIsFeatured = state.featuredClients.includes(a.name);
        const bIsFeatured = state.featuredClients.includes(b.name);
        if (aIsFeatured && !bIsFeatured) return -1;
        if (!aIsFeatured && bIsFeatured) return 1;
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
        const isFeatured = state.featuredClients.includes(client.name);
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><i class="fa-regular fa-star star-icon ${isFeatured ? 'featured' : ''}"></i></td>
            <td class="client-name-cell">${client.name}</td>
            <td>${client.phone}</td>
            <td>${client.account_name}</td>
            <td>${client.account_type}</td>
            <td>${client.ticket_count}</td>
            <td class="client-actions">
                <button class="icon-btn icon-btn-table" title="Detail"><i class="fa-solid fa-eye"></i></button>
                <button class="icon-btn icon-btn-table" title="Copy Info"><i class="fa-solid fa-copy"></i></button>
                <button class="icon-btn icon-btn-table" title="New Booking"><i class="fa-solid fa-calendar-plus"></i></button>
                <button class="icon-btn icon-btn-table" title="Sell New Ticket"><i class="fa-solid fa-ticket"></i></button>
            </td>
        `
        // Add event listeners
        row.querySelector('.star-icon').addEventListener('click', (e) => toggleFeaturedClient(e, client.name));
        row.querySelector('[title="Detail"]').addEventListener('click', () => viewClientHistory(client.name));
        row.querySelector('[title="Copy Info"]').addEventListener('click', () => copyClientInfo(client.name, client.id_no, client.phone, client.gender));
        row.querySelector('[title="New Booking"]').addEventListener('click', () => bookForClient(client.name));
        row.querySelector('[title="Sell New Ticket"]').addEventListener('click', () => sellTicketForClient(client.name));
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
 * Displays a modal with a client's complete ticket history and stats.
 * @param {string} clientName The name of the client to view.
 */
function viewClientHistory(clientName) {
    const clientTickets = state.allTickets.filter(t => t.name === clientName)
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

    const content = `
        <div class="client-history-header">
            <div class="client-history-info">
                <h2>${clientName}</h2>
                <p>ID: ${firstTicket.id_no || 'N/A'} | Phone: ${firstTicket.phone || 'N/A'} | Social: ${firstTicket.account_name || 'N/A'} (${firstTicket.account_type || 'N/A'})</p>
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
        <h3>Ticket History</h3>
        ${historyHtml}
    `;

    openModal(content, 'large-modal');
    document.getElementById('sellForClientBtn').addEventListener('click', () => sellTicketForClient(clientName));
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
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
 * @param {string} clientName The name of the client to toggle.
 */
function toggleFeaturedClient(event, clientName) {
    event.stopPropagation();
    const icon = event.target;
    const index = state.featuredClients.indexOf(clientName);

    if (index > -1) {
        state.featuredClients.splice(index, 1);
        icon.classList.remove('featured');
        showToast(`${clientName} removed from featured.`, 'info');
    } else {
        state.featuredClients.push(clientName);
        icon.classList.add('featured');
        showToast(`${clientName} added to featured!`, 'success');
    }

    saveFeaturedClients();
    renderClientsView(state.clientPage);
}

/**
 * Pre-fills the "Sell Ticket" form for a specific client.
 * @param {string} clientName The name of the client.
 */
function sellTicketForClient(clientName) {
    const client = state.allClients.find(c => c.name === clientName);
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
    const passengerGenderSelect = document.querySelector('#passenger-forms-container .passenger-gender');
    const passengerNameInput = document.querySelector('#passenger-forms-container .passenger-name');
    const passengerIdInput = document.querySelector('#passenger-forms-container .passenger-id');
    if (passengerGenderSelect) passengerGenderSelect.value = client.gender || 'MR';
    if (passengerNameInput) passengerNameInput.value = client.name.toUpperCase();
    if (passengerIdInput) passengerIdInput.value = client.id_no || '';

    showToast(`Form pre-filled for ${client.name}.`, 'info');
}

/**
 * Pre-fills the "New Booking" form for a specific client.
 * @param {string} clientName The name of the client.
 */
function bookForClient(clientName) {
    const client = state.allClients.find(c => c.name === clientName);
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
    const passengerIdInput = document.querySelector('#booking-passenger-forms-container .booking-passenger-id');

    if (passengerGenderSelect) passengerGenderSelect.value = client.gender || 'MR';
    if (passengerNameInput) passengerNameInput.value = client.name.toUpperCase();
    if (passengerIdInput) passengerIdInput.value = client.id_no || '';

    showToast(`Booking form pre-filled for ${client.name}.`, 'info');
}