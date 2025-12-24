/**
 * @fileoverview Manages all logic related to tickets, including loading, parsing,
 * displaying, searching, and handling the ticket selling form.
 */

import { CONFIG } from './config.js';
import { state } from './state.js';
import { fetchFromSheet, appendToSheet } from './api.js';
import { showToast, parseSheetDate, renderEmptyState, formatDateForSheet, calculateAgentCut, makeClickable, formatDateToDMMMY, formatPaymentMethod } from './utils.js';
import { showView, openModal, closeModal, showConfirmModal, resetPassengerForms, populateFlightLocations, updateToggleLabels, updateNotifications, setupPagination, addPassengerForm, removePassengerForm } from './ui.js';
import { updateBookingStatus } from './booking.js';
import { updateDashboardData } from './main.js';
import { buildClientList } from './clients.js';
import { saveHistory } from './history.js';
import { togglePrivateReportButton } from './reports.js';
// The import from 'manage.js' is now handled dynamically below.

/**
 * Checks if any search filters are currently active on the dashboard.
 * @returns {boolean} True if any search filter has a value.
 */
function isSearchActive() {
    const name = document.getElementById('searchName')?.value;
    const bookRef = document.getElementById('searchBooking')?.value;
    const startDateVal = document.getElementById('searchStartDate')?.value;
    const endDateVal = document.getElementById('searchEndDate')?.value;
    const travelDateVal = document.getElementById('searchTravelDate')?.value;
    const departure = document.getElementById('searchDeparture')?.value;
    const destination = document.getElementById('searchDestination')?.value;
    const airline = document.getElementById('searchAirline')?.value;
    const notPaidOnly = document.getElementById('searchNotPaidToggle')?.checked;

    return !!(name || bookRef || startDateVal || endDateVal || travelDateVal || departure || destination || airline || notPaidOnly);
}

/**
 * Refreshes the ticket view. If search filters are active, it reapplies them.
 * Otherwise, it displays the initial list of recent tickets.
 */
function refreshTicketView() {
    if (isSearchActive()) {
        performSearch();
    } else {
        displayInitialTickets();
    }
}


/**
 * Loads ticket data from the Google Sheet.
 */
export async function loadTicketData() {
    const loading = document.getElementById('loading');
    const dashboardContent = document.getElementById('dashboard-content');
    try {
        loading.style.display = 'block';
        dashboardContent.style.display = 'none';
        const response = await fetchFromSheet(`${CONFIG.SHEET_NAME}!A:V`, 'ticketData');

        if (response.values && response.values.length > 1) {
            state.allTickets = parseTicketData(response.values);
            populateSearchAirlines();
            updateUnpaidCount();
            refreshTicketView(); // Use the new refresh logic
        } else {
            renderEmptyState('resultsBodyContainer', 'fa-ticket', 'No Tickets Found', 'There are no tickets in the system yet. Start by selling a new ticket.');
        }
        loading.style.display = 'none';
        dashboardContent.style.display = 'flex';
    } catch (error) {
        showToast(`Error loading ticket data: ${error.result?.error?.message || error}`, 'error');
        loading.style.display = 'none';
    }
}

/**
 * Parses raw sheet data into an array of ticket objects.
 * @param {Array<Array<string>>} values The raw values from the sheet.
 * @returns {Array<Object>} An array of ticket objects.
 */
function parseTicketData(values) {
    const headers = values[0].map(h => h.toLowerCase().replace(/\s+/g, '_').replace('nrc', 'id'));
    return values.slice(1).map((row, i) => {
        const ticket = {};
        headers.forEach((h, j) => {
            const value = row[j] || '';
            ticket[h] = typeof value === 'string' ? value.trim() : value;
        });
        const safeParse = (val) => parseFloat(String(val).replace(/,/g, '')) || 0;
        ['base_fare', 'net_amount', 'commission', 'extra_fare', 'date_change'].forEach(key => ticket[key] = safeParse(ticket[key]));
        ticket.paid = ticket.paid === 'TRUE';
        ticket.rowIndex = i + 2;
        return ticket;
    });
}

/**
 * Displays the initial list of tickets.
 * MODIFICATION: Removed the .slice(0, 50) limit to allow navigating through all tickets.
 */
export function displayInitialTickets() {
    const sorted = [...state.allTickets].sort((a, b) => parseSheetDate(b.issued_date) - parseSheetDate(a.issued_date) || b.rowIndex - a.rowIndex);
    // Removed slice to show all tickets via pagination
    state.filteredTickets = sorted;
    displayTickets(sorted, 1);
}

/**
 * Displays a paginated list of tickets in the results table.
 * @param {Array<Object>} tickets The array of tickets to display.
 * @param {number} [page=1] The page number to display.
 */
export function displayTickets(tickets, page = 1) {
    const container = document.getElementById('resultsBodyContainer');
    container.innerHTML = '';

    if (tickets.length === 0) {
        renderEmptyState('resultsBodyContainer', 'fa-magnifying-glass', 'No Results Found', 'Your search did not match any tickets. Try adjusting your filters.');
        setupPagination([]);
        return;
    }

    const table = document.createElement('table');
    table.id = 'resultsTable';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Issued Date</th><th>Name</th><th>Booking Ref</th><th>Route</th><th>Airline</th><th>Actions</th>
            </tr>
        </thead>
        <tbody id="resultsBody"></tbody>
    `;
    container.appendChild(table);
    const tbody = document.getElementById('resultsBody');

    state.currentPage = page;
    const paginated = tickets.slice((page - 1) * state.rowsPerPage, page * state.rowsPerPage);

    paginated.forEach((ticket) => {
        const row = tbody.insertRow();
        if (ticket.remarks) {
            const lowerRemarks = ticket.remarks.toLowerCase();
            if (lowerRemarks.includes('refund') || lowerRemarks.includes('cancel')) {
                row.classList.add('canceled-row');
            }
        }
        row.innerHTML = `
            <td>${ticket.issued_date||''}</td>
            <td>${ticket.name||''}</td>
            <td>${ticket.booking_reference||''}</td>
            <td>${(ticket.departure||'').split(' ')[0]}→${(ticket.destination||'').split(' ')[0]}</td>
            <td>${ticket.airline||''}</td>
            <td class="actions-cell">
                <button class="icon-btn icon-btn-table" title="View Details"><i class="fa-solid fa-eye"></i></button>
                <button class="icon-btn icon-btn-table" title="Manage Ticket"><i class="fa-solid fa-pen-to-square"></i></button>
            </td>
        `;
        row.querySelector('[title="View Details"]').addEventListener('click', () => showDetails(ticket.rowIndex));
        
        // Manage Ticket logic
        row.querySelector('[title="Manage Ticket"]').addEventListener('click', async () => {
            const { showView } = await import('./ui.js');
            showView('manage');
            const manageModule = await import('./manage.js');
            manageModule.findTicketForManage(ticket.booking_reference);
        });
    });
    setupPagination(tickets);
}

/**
 * Shows a detailed modal view for a specific ticket.
 * @param {number} rowIndex The row index of the ticket in the sheet.
 */
export function showDetails(rowIndex) {
    const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);
    if (!ticket) return;

    let statusClass = 'confirmed';
    let statusText = `Issued on ${formatDateToDMMMY(ticket.issued_date) || 'N/A'}`;

    if (ticket.remarks) {
        const lowerRemarks = ticket.remarks.toLowerCase();
        const dateRegex = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/;
        const match = lowerRemarks.match(dateRegex);
        const actionDate = match ? formatDateToDMMMY(match[1]) : 'an unknown date';
        if (lowerRemarks.includes('full refund')) {
            statusClass = 'canceled';
            statusText = `Full Refund on ${actionDate}`;
        } else if (lowerRemarks.includes('cancel')) {
            statusClass = 'canceled';
            statusText = `Canceled on ${actionDate}`;
        }
    }

    const content = `
        <div class="details-header">
            <div>
                <div class="client-name">${ticket.name || 'N/A'}</div>
                <div class="pnr-code">PNR: ${ticket.booking_reference || 'N/A'}</div>
            </div>
            <div class="details-status-badge ${statusClass}">${statusText}</div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Client Information</div>
            <div class="details-grid">
                <div class="details-item"><i class="fa-solid fa-id-card"></i><div class="details-item-content"><div class="label">ID No.</div><div class="value">${ticket.id_no || 'N/A'}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-phone"></i><div class="details-item-content"><div class="label">Phone</div><div class="value">${makeClickable(ticket.phone) || 'N/A'}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-hashtag"></i><div class="details-item-content"><div class="label">Social Media</div><div class="value">${ticket.account_name || 'N/A'} (${ticket.account_type || 'N/A'})</div></div></div>
                <div class="details-item"><i class="fa-solid fa-link"></i><div class="details-item-content"><div class="label">Account Link</div><div class="value">${makeClickable(ticket.account_link) || 'N/A'}</div></div></div>
            </div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Flight Details</div>
            <div class="details-grid">
                <div class="details-item"><i class="fa-solid fa-plane-departure"></i><div class="details-item-content"><div class="label">From</div><div class="value">${ticket.departure || 'N/A'}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-plane-arrival"></i><div class="details-item-content"><div class="label">To</div><div class="value">${ticket.destination || 'N/A'}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-calendar-days"></i><div class="details-item-content"><div class="label">Travel Date</div><div class="value">${ticket.departing_on || 'N/A'}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-plane"></i><div class="details-item-content"><div class="label">Airline</div><div class="value">${ticket.airline || 'N/A'}</div></div></div>
            </div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Financials</div>
            <div class="details-grid">
                 <div class="details-item"><i class="fa-solid fa-receipt"></i><div class="details-item-content"><div class="label">Net Amount</div><div class="value">${(ticket.net_amount || 0).toLocaleString()} MMK</div></div></div>
                 <div class="details-item"><i class="fa-solid fa-hand-holding-dollar"></i><div class="details-item-content"><div class="label">Commission</div><div class="value">${(ticket.commission || 0).toLocaleString()} MMK</div></div></div>
                <div class="details-item"><i class="fa-solid fa-money-bill-transfer"></i><div class="details-item-content"><div class="label">Date Change / Extra</div><div class="value">${((ticket.date_change || 0) + (ticket.extra_fare || 0)).toLocaleString()} MMK</div></div></div>
                <div class="details-item"><i class="fa-solid fa-credit-card"></i><div class="details-item-content"><div class="label">Payment Status</div><div class="value">${ticket.paid ? `Paid via ${ticket.payment_method || 'N/A'}` : 'Not Paid'}</div></div></div>
            </div>
        </div>
        <div class="form-actions" style="margin-top: 1rem;">
            <button class="btn btn-secondary" id="modalCloseBtn">Close</button>
        </div>
    `;
    openModal(content);
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
}

/**
 * Handles the submission of the "Sell Ticket" form.
 */
export async function handleSellTicket(e) {
    e.preventDefault();
    if (state.isSubmitting) return;

    const form = e.target;
    const {
        sharedData,
        passengerData
    } = collectFormData(form);

    if (passengerData.length === 0) {
        showToast('At least one passenger is required.', 'error');
        return;
    }
    if (!sharedData.booking_reference) {
        showToast('PNR Code is required.', 'error');
        return;
    }

    const isDuplicate = passengerData.some(p =>
        state.allTickets.some(t =>
            t.name === p.name &&
            t.booking_reference === sharedData.booking_reference &&
            t.departure === sharedData.departure &&
            t.destination === sharedData.destination
        )
    );

    if (isDuplicate) {
        showToast('A ticket with the same Name, PNR, and Route already exists.', 'error');
        return;
    }

    const totalNetAmount = passengerData.reduce((sum, p) => sum + p.net_amount, 0);
    const confirmationMessage = `
        <h3>Confirm Submission</h3>
        <p>Please review the details before submitting:</p>
        <ul style="list-style: none; padding-left: 0; margin: 1rem 0;">
            <li><strong>PNR Code:</strong> ${sharedData.booking_reference}</li>
            <li><strong>Total Passengers:</strong> ${passengerData.length}</li>
            <li><strong>Total Net Amount:</strong> ${totalNetAmount.toLocaleString()} MMK</li>
            <li><strong>Payment Status:</strong> ${sharedData.paid ? `Paid via ${sharedData.payment_method}` : 'Not Paid'}</li>
        </ul>
    `;

    showConfirmModal(confirmationMessage, () => {
        confirmAndSaveTicket(form, sharedData, passengerData);
    });
}

/**
 * Confirms and saves the ticket data to the Google Sheet.
 * @param {HTMLFormElement} form The form element.
 * @param {Object} sharedData The shared data for all tickets.
 * @param {Array<Object>} passengerData The data for each passenger.
 */
async function confirmAndSaveTicket(form, sharedData, passengerData) {
    state.isSubmitting = true;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    closeModal();

    try {
        await saveTicket(sharedData, passengerData);

        if (state.bookingToUpdate) {
            await updateBookingStatus(state.bookingToUpdate, 'complete');
        }

        showToast('Ticket(s) saved successfully!', 'success');
        form.reset();
        resetPassengerForms();
        populateFlightLocations();
        updateToggleLabels();

        state.cache['ticketData'] = null;

        await loadTicketData();
        updateDashboardData();
        buildClientList();
        updateNotifications();
        showView('home');

    } catch (error) {
        // Error is already shown by the API module
    } finally {
        state.isSubmitting = false;
        if (submitButton) submitButton.disabled = false;
        state.bookingToUpdate = null;
    }
}

/**
 * Collects and structures data from the "Sell Ticket" form.
 * @param {HTMLFormElement} form The form element.
 * @returns {{sharedData: Object, passengerData: Array<Object>}} The collected data.
 */
function collectFormData(form) {
    // Payment Method (supports Mobile Banking sub-method stored as: "Mobile Banking (KBZ Special)")
    const basePaymentMethod = (form.querySelector('#payment_method')?.value || '').trim();
    const bankPaymentMethod = (document.getElementById('payment_method_bank')?.value || '').trim();
    const finalPaymentMethod = formatPaymentMethod(basePaymentMethod, bankPaymentMethod);

    const sharedData = {
        issued_date: form.querySelector('#issued_date').value,
        phone: form.querySelector('#phone').value,
        account_name: form.querySelector('#account_name').value,
        account_type: form.querySelector('#account_type').value,
        account_link: form.querySelector('#account_link').value,
        departure: form.querySelector('#departure').value,
        destination: form.querySelector('#destination').value,
        departing_on: form.querySelector('#departing_on').value,
        airline: form.querySelector('#airline').value === 'CUSTOM' ? form.querySelector('#custom_airline').value : form.querySelector('#airline').value,
        booking_reference: form.querySelector('#booking_reference').value.toUpperCase(),
        paid: form.querySelector('#paid').checked,
        payment_method: finalPaymentMethod,
        paid_date: form.querySelector('#paid_date').value
    };

    const passengerData = [];
    const passengerForms = form.querySelectorAll('.passenger-form');
    passengerForms.forEach(pForm => {
        const passenger = {
            gender: pForm.querySelector('.passenger-gender').value,
            name: pForm.querySelector('.passenger-name').value.toUpperCase(),
            id_no: pForm.querySelector('.passenger-id').value.toUpperCase(),
            base_fare: parseFloat(pForm.querySelector('.passenger-base-fare').value) || 0,
            net_amount: parseFloat(pForm.querySelector('.passenger-net-amount').value) || 0,
            extra_fare: parseFloat(pForm.querySelector('.passenger-extra-fare').value) || 0,
            commission: parseFloat(pForm.querySelector('.passenger-commission').value) || 0,
            remarks: pForm.querySelector('.passenger-remarks').value
        };
        if (passenger.name) {
            passengerData.push(passenger);
        }
    });

    return {
        sharedData,
        passengerData
    };
}

/**
 * Saves ticket data to the Google Sheet by appending new rows.
 * @param {Object} sharedData The shared data for all tickets.
 * @param {Array<Object>} passengerData The data for each passenger.
 */
async function saveTicket(sharedData, passengerData) {
    const values = passengerData.map(p => {
        const agentCommission = calculateAgentCut(p.commission);
        return [
            formatDateForSheet(sharedData.issued_date),
            p.name,
            p.id_no,
            sharedData.phone,
            sharedData.account_name,
            sharedData.account_type,
            sharedData.account_link,
            sharedData.departure,
            sharedData.destination,
            formatDateForSheet(sharedData.departing_on),
            sharedData.airline,
            p.base_fare,
            sharedData.booking_reference,
            p.net_amount,
            sharedData.paid,
            sharedData.payment_method,
            formatDateForSheet(sharedData.paid_date),
            agentCommission,
            p.remarks,
            p.extra_fare,
            0,
            p.gender
        ];
    });

    await appendToSheet(`${CONFIG.SHEET_NAME}!A:V`, values);
}


/**
 * Filters and displays tickets based on search criteria.
 */
export function performSearch() {
    const name = (document.getElementById('searchName')?.value || '').toUpperCase();
    const bookRef = (document.getElementById('searchBooking')?.value || '').toUpperCase();
    let startDateVal = document.getElementById('searchStartDate')?.value;
    let endDateVal = document.getElementById('searchEndDate')?.value;
    const travelDateVal = document.getElementById('searchTravelDate')?.value || '';
    const departure = document.getElementById('searchDeparture')?.value.toUpperCase();
    const destination = document.getElementById('searchDestination')?.value.toUpperCase();
    const airline = document.getElementById('searchAirline')?.value.toUpperCase();
    const notPaidOnly = document.getElementById('searchNotPaidToggle')?.checked;

    let searchStartDate = startDateVal ? parseSheetDate(startDateVal) : null;
    let searchEndDate = endDateVal ? parseSheetDate(endDateVal) : null;

    if (searchStartDate) searchStartDate.setHours(0, 0, 0, 0);
    if (searchEndDate) searchEndDate.setHours(23, 59, 59, 999);

    let searchTravelDate = travelDateVal ? parseSheetDate(travelDateVal) : null;

    const results = state.allTickets.filter(t => {
        const issuedDate = parseSheetDate(t.issued_date);
        const travelDate = parseSheetDate(t.departing_on);

        const nameMatch = !name || t.name.toUpperCase().includes(name);
        const bookRefMatch = !bookRef || t.booking_reference.toUpperCase().includes(bookRef);
        const issuedDateMatch = (!searchStartDate || issuedDate >= searchStartDate) && (!searchEndDate || issuedDate <= searchEndDate);
        const travelDateMatch = !searchTravelDate || (travelDate && travelDate.getTime() === searchTravelDate.getTime());
        const departureMatch = !departure || (t.departure && t.departure.toUpperCase() === departure);
        const destinationMatch = !destination || (t.destination && t.destination.toUpperCase() === destination);
        const airlineMatch = !airline || (t.airline && t.airline.toUpperCase() === airline);
        const paidMatch = !notPaidOnly || !t.paid;

        return nameMatch && bookRefMatch && issuedDateMatch && travelDateMatch && departureMatch && destinationMatch && airlineMatch && paidMatch;
    }).sort((a, b) => parseSheetDate(b.issued_date) - parseSheetDate(a.issued_date) || b.rowIndex - a.rowIndex);

    state.filteredTickets = results;
    displayTickets(state.filteredTickets, 1);
}

/**
 * Clears all search filters and resets the search form.
 */
export function clearSearch() {
    document.getElementById('searchForm').reset();
    document.querySelectorAll('#searchForm select').forEach(sel => {
        for (const opt of sel.options) {
            opt.disabled = false;
        }
    });
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    performSearch();
    togglePrivateReportButton();
}


/**
 * Sets the date range for the search based on a preset.
 * @param {string} range The preset range ('7', '30', 'month').
 */
export function setDateRangePreset(range) {
    const startDateInput = document.getElementById('searchStartDate');
    const endDateInput = document.getElementById('searchEndDate');
    const today = new Date();
    let startDate = new Date();

    if (range === '7') {
        startDate.setDate(today.getDate() - 7);
    } else if (range === '30') {
        startDate.setDate(today.getDate() - 30);
    } else if (range === 'month') {
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    startDateInput.value = formatDateForSheet(startDate);
    endDateInput.value = formatDateForSheet(today);
    performSearch();
    togglePrivateReportButton();
}

/**
 * Handles visibility of the custom airline input field.
 */
export function handleAirlineChange() {
    const airlineSelect = document.getElementById('airline');
    const customAirlineGroup = document.getElementById('custom_airline_group');
    if (airlineSelect.value === 'CUSTOM') {
        customAirlineGroup.style.display = 'block';
    } else {
        customAirlineGroup.style.display = 'none';
    }
}

/**
 * Populates the airline search dropdown with unique airlines from the data.
 */
export function populateSearchAirlines() {
    const airlineSelect = document.getElementById('searchAirline');
    const uniqueAirlines = [...new Set(state.allTickets.map(t => t.airline.toUpperCase()).filter(Boolean))];
    uniqueAirlines.sort();
    
    while (airlineSelect.options.length > 1) {
        airlineSelect.remove(1);
    }
    
    uniqueAirlines.forEach(airline => {
        airlineSelect.add(new Option(airline, airline));
    });
}

/**
 * Updates the unpaid ticket count badge in the search form.
 */
export function updateUnpaidCount() {
    const unpaidTickets = state.allTickets.filter(t => !t.paid);
    const count = unpaidTickets.length;
    const label = document.getElementById('unpaid-only-label');
    
    let countSpan = label.querySelector('.notification-count');

    if (count > 0) {
        if (!countSpan) {
            countSpan = document.createElement('span');
            countSpan.className = 'notification-count';
            label.appendChild(document.createTextNode('\u00A0')); 
            label.appendChild(countSpan);
        }
        countSpan.textContent = count;
    } else {
        if (countSpan) {
            if (countSpan.previousSibling && countSpan.previousSibling.nodeType === Node.TEXT_NODE) {
                countSpan.previousSibling.remove();
            }
            countSpan.remove();
        }
    }
}