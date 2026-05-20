
/**
 * @fileoverview Manages all logic related to tickets, including loading, parsing,
 * displaying, searching, and handling the ticket selling form.
 */

import { state } from './state.js';
import { getTickets, addTickets, updateTicket, batchUpdateTickets, deleteDocument } from './db.js';
import { showToast, parseSheetDate, renderEmptyState, formatDateForSheet, calculateAgentCut, makeClickable, formatDateToDMMMY, formatPaymentMethod, isTicketPaid } from './utils.js';
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
    return !!(name || bookRef || startDateVal || endDateVal || travelDateVal || departure || destination);
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


function getTimestampMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (ts.seconds) return ts.seconds * 1000;
    return 0;
}

function readPassengerInput(formEl, selector) {
    return (formEl.querySelector(selector)?.value || '').trim();
}

function readMoneyInput(formEl, selector) {
    const value = parseFloat(readPassengerInput(formEl, selector));
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.round(value);
}

function collectNrcParts(formEl) {
    return {
        region: readPassengerInput(formEl, '.nrc-region').replace(/[^0-9]/g, ''),
        township: readPassengerInput(formEl, '.nrc-township').toUpperCase().replace(/[^A-Z]/g, ''),
        type: readPassengerInput(formEl, '.nrc-type').toUpperCase().replace(/[^A-Z]/g, ''),
        serial: readPassengerInput(formEl, '.nrc-serial').replace(/[^0-9]/g, '')
    };
}

function joinNrcParts(parts) {
    if (!parts.region || !parts.township || !parts.type || !parts.serial) return '';
    return `${parts.region}/${parts.township}(${parts.type})${parts.serial}`;
}

function getPassengerValidationError(passenger, index, isInternational) {
    const label = `Passenger ${index + 1}`;
    if (!passenger.name) return `${label}: passenger name is required.`;
    if (!passenger.net_amount) return `${label}: net amount is required.`;
    if (!passenger.nrc_no) return `${label}: complete NRC number is required.`;
    if (isInternational && !passenger.passport_no) return `${label}: passport number is required for international tickets.`;
    if (isInternational && passenger.passport_no.length < 5) return `${label}: passport number looks too short.`;
    return '';
}

/**
 * Loads ticket data from Firestore.
 */
export async function loadTicketData() {
    const loading = document.getElementById('loading');
    const dashboardContent = document.getElementById('dashboard-content');
    try {
        loading.style.display = 'block';
        dashboardContent.style.display = 'none';
        const tickets = await getTickets();

        if (tickets.length > 0) {
            state.allTickets = tickets;
            populateSearchAirlines();
            updateUnpaidCount();
            refreshTicketView();
        } else {
            renderEmptyState('resultsBodyContainer', 'fa-ticket', 'No Tickets Found', 'There are no tickets in the system yet. Start by selling a new ticket.');
        }
        loading.style.display = 'none';
        dashboardContent.style.display = 'flex';
    } catch (error) {
        showToast(`Error loading ticket data: ${error.message || error}`, 'error');
        loading.style.display = 'none';
    }
}

/**
 * Displays the initial list of tickets.
 * MODIFICATION: Removed the .slice(0, 50) limit to allow navigating through all tickets.
 */
export function displayInitialTickets() {
    const startDate = document.getElementById('searchStartDate')?.value;
    const endDate = document.getElementById('searchEndDate')?.value;
    if (startDate || endDate) {
        performSearch();
        return;
    }
    const sorted = [...state.allTickets].sort((a, b) => {
        const dateDiff = parseSheetDate(b.issued_date) - parseSheetDate(a.issued_date);
        if (dateDiff !== 0) return dateDiff;
        return getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt);
    });
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

    const isGrouped = document.getElementById('groupByAccountToggle')?.checked;

    const table = document.createElement('table');
    table.id = 'resultsTable';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Issued Date</th>
                <th>Name</th>
                <th>PNR</th>
                <th>Route</th>
                <th>Airline</th>
                <th class="num-header">Net Amount</th>
                <th class="num-header">Commission</th>
                <th class="num-header">Extra Fare</th>
                <th class="num-header">Date Change</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody id="resultsBody"></tbody>
    `;
    container.appendChild(table);
    const tbody = document.getElementById('resultsBody');

    state.currentPage = page;
    const paginated = tickets.slice((page - 1) * state.rowsPerPage, page * state.rowsPerPage);

    paginated.forEach((item) => {
        const isGroup = isGrouped && item._grouped;
        const row = tbody.insertRow();
        if (isGroup) row.classList.add('grouped-row');
        if (!isGroup && item.remarks) {
            const lowerRemarks = item.remarks.toLowerCase();
            if (lowerRemarks.includes('refund') || lowerRemarks.includes('cancel')) {
                row.classList.add('canceled-row');
            }
        }

        const ticket = isGroup ? item : item;
        const nameCell = isGroup
            ? `<strong>${escapeHtml(ticket.tickets[0]?.name || 'Unknown')}</strong> <span class="group-badge">${ticket.count} clients</span>`
            : escapeHtml(ticket.name || '');

        row.innerHTML = `
            <td>${ticket.issued_date || ticket.dateRange || ''}</td>
            <td>${nameCell}</td>
            <td>${isGroup ? '—' : escapeHtml(ticket.booking_reference || '')}</td>
            <td>${isGroup ? '—' : escapeHtml(routeShort(ticket))}</td>
            <td>${isGroup ? '—' : escapeHtml(ticket.airline || '')}</td>
            <td class="num-cell">${(ticket.net_amount || 0).toLocaleString()}</td>
            <td class="num-cell">${(ticket.commission || 0).toLocaleString()}</td>
            <td class="num-cell">${(ticket.extra_fare || 0).toLocaleString()}</td>
            <td class="num-cell">${(ticket.date_change || 0).toLocaleString()}</td>
            <td class="actions-cell">
                <button class="icon-btn icon-btn-table" title="View Details" data-action="view"><i class="fa-solid fa-eye"></i></button>
                <button class="icon-btn icon-btn-table" title="Edit" data-action="edit"><i class="fa-solid fa-pen-to-square"></i></button>
                ${isGroup ? '' : '<button class="icon-btn icon-btn-table" title="Delete" data-action="delete"><i class="fa-solid fa-trash-can"></i></button>'}
            </td>
        `;

        row.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'view') {
                    if (isGroup) {
                        showGroupDetails(ticket);
                    } else {
                        showDetails(ticket.id);
                    }
                } else if (action === 'edit') {
                    if (isGroup) {
                        openEditGroupModal(ticket);
                    } else {
                        openEditTicketModal(ticket);
                    }
                } else if (action === 'delete' && !isGroup) {
                    deleteTicketWithConfirm(ticket.id);
                }
            });
        });
    });
    setupPagination(tickets);
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function routeShort(ticket) {
    const dep = (ticket.departure || '').split(' ')[0];
    const dest = (ticket.destination || '').split(' ')[0];
    return dep && dest ? `${dep} → ${dest}` : (dep || dest || '—');
}

/**
 * Shows a detailed modal view for a specific ticket.
 * @param {string} docId The Firestore document ID.
 */
export function showDetails(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
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

    let clientKey = '';
    if (ticket.name) {
        const c = state.allClients.find(c =>
            String(c.name || '').toLowerCase() === String(ticket.name).toLowerCase() &&
            !String(c.name || '').includes('(Fees)')
        );
        if (c) clientKey = c.client_key;
    }

    const content = `
        <div class="details-header">
            <div>
                <div class="client-name ${clientKey ? 'clickable-client-link' : ''}" data-client-key="${clientKey || ''}" ${clientKey ? 'style="cursor:pointer; color:var(--primary-accent); text-decoration:underline;" title="View Client"' : ''}>${ticket.name || 'N/A'}</div>
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
                 <div class="details-item"><i class="fa-solid fa-money-bill-transfer"></i><div class="details-item-content"><div class="label">Date Change Fees</div><div class="value">${(ticket.date_change || 0).toLocaleString()} MMK</div></div></div>
                 <div class="details-item"><i class="fa-solid fa-circle-plus"></i><div class="details-item-content"><div class="label">Extra Fare</div><div class="value">${(ticket.extra_fare || 0).toLocaleString()} MMK</div></div></div>
            </div>
        </div>
        <div class="form-actions" style="margin-top: 1rem;">
            <button class="btn btn-secondary" id="modalCloseBtn">Close</button>
        </div>
    `;
    openModal(content, 'solid-modal');
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);

    const clientLink = document.querySelector('.clickable-client-link');
    if (clientLink) {
        clientLink.addEventListener('click', async (e) => {
            const key = e.target.dataset.clientKey;
            if (key) {
                closeModal();
                const { navigateToClient } = await import('./search.js');
                navigateToClient(key);
            }
        });
    }
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
        passengerData,
        returnSharedData
    } = collectFormData(form);

    if (passengerData.length === 0) {
        showToast('At least one passenger is required.', 'error');
        return;
    }
    if (!sharedData.booking_reference) {
        showToast('PNR Code is required.', 'error');
        return;
    }
    if (!sharedData.departure || !sharedData.destination) {
        showToast('Departure and destination are required.', 'error');
        return;
    }
    if (!sharedData.airline) {
        showToast('Airline is required.', 'error');
        return;
    }

    // Round-trip specific validations
    if (sharedData.is_round_trip) {
        if (!returnSharedData?.departing_on) {
            showToast('Return date is required for round-trip tickets.', 'error');
            return;
        }
        if (!returnSharedData?.departure || !returnSharedData?.destination) {
            showToast('Return departure and destination are required.', 'error');
            return;
        }
        if (!returnSharedData?.airline) {
            showToast('Return airline is required.', 'error');
            return;
        }
        const missingReturnPrice = passengerData.findIndex(p => !p.return_net_amount);
        if (missingReturnPrice !== -1) {
            showToast(`Return Net Amount is required for Passenger ${missingReturnPrice + 1}.`, 'error');
            return;
        }
    }

    const validationError = passengerData
        .map((p, idx) => getPassengerValidationError(p, idx, sharedData.is_international))
        .find(Boolean);
    if (validationError) {
        showToast(validationError, 'error');
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

    const outboundTotal = passengerData.reduce((sum, p) => sum + p.net_amount + p.extra_fare, 0);
    const returnTotal = sharedData.is_round_trip
        ? passengerData.reduce((sum, p) => sum + (p.return_net_amount || 0) + (p.return_extra_fare || 0), 0)
        : 0;
    const totalAmount = outboundTotal + returnTotal;
    const totalRowCount = passengerData.length * (sharedData.is_round_trip ? 2 : 1);

    const returnLine = sharedData.is_round_trip
        ? `<li><strong>Return Flight:</strong> ${returnSharedData.departure} → ${returnSharedData.destination} on ${returnSharedData.departing_on}</li>
           <li><strong>Return Subtotal:</strong> ${returnTotal.toLocaleString()} MMK</li>`
        : '';

    const confirmationMessage = `
        <h3>Confirm Submission</h3>
        <p>Please review the details before submitting:</p>
        <ul style="list-style: none; padding-left: 0; margin: 1rem 0;">
            <li><strong>Trip Type:</strong> ${sharedData.trip_type}</li>
            <li><strong>PNR Code:</strong> ${sharedData.booking_reference}</li>
            <li><strong>Flight Type:</strong> ${sharedData.flight_type}</li>
            <li><strong>Total Passengers:</strong> ${passengerData.length}${sharedData.is_round_trip ? ` (${totalRowCount} tickets)` : ''}</li>
            ${returnLine}
            <li><strong>Grand Total:</strong> ${totalAmount.toLocaleString()} MMK</li>
            <li><strong>Payment Status:</strong> ${sharedData.paid ? `Paid via ${sharedData.payment_method}` : 'Not Paid'}</li>
        </ul>
    `;

    showConfirmModal(confirmationMessage, () => {
        confirmAndSaveTicket(form, sharedData, passengerData, returnSharedData);
    });
}

/**
 * Confirms and saves the ticket data to the Google Sheet.
 * @param {HTMLFormElement} form The form element.
 * @param {Object} sharedData The shared data for all tickets.
 * @param {Array<Object>} passengerData The data for each passenger.
 */
async function confirmAndSaveTicket(form, sharedData, passengerData, returnSharedData = null) {
    state.isSubmitting = true;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    closeModal();

    try {
        await saveTicket(sharedData, passengerData, returnSharedData);

        if (state.bookingToUpdate) {
            await updateBookingStatus(state.bookingToUpdate, 'complete');
        }

        showToast('Ticket(s) saved successfully!', 'success');
        form.reset();
        resetPassengerForms();
        populateFlightLocations();
        updateToggleLabels();

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

    // Handle Custom Location Input (when "CUSTOM" is selected)
    let departureVal = form.querySelector('#departure').value;
    if (departureVal === 'CUSTOM') {
        departureVal = form.querySelector('#custom_departure').value;
    }

    let destinationVal = form.querySelector('#destination').value;
    if (destinationVal === 'CUSTOM') {
        destinationVal = form.querySelector('#custom_destination').value;
    }

    const outboundAirline = form.querySelector('#airline').value === 'CUSTOM'
        ? form.querySelector('#custom_airline').value
        : form.querySelector('#airline').value;
    const outboundPnr = form.querySelector('#booking_reference').value.toUpperCase();

    const isInternational = !!document.getElementById('flightTypeToggle')?.checked;
    const isRound = !!document.getElementById('trip_type_round')?.checked;

    const sharedData = {
        issued_date: form.querySelector('#issued_date').value,
        phone: form.querySelector('#phone').value,
        account_name: form.querySelector('#account_name').value,
        account_type: form.querySelector('#account_type').value,
        account_link: form.querySelector('#account_link').value,
        departure: departureVal,
        destination: destinationVal,
        departing_on: form.querySelector('#departing_on').value,
        airline: outboundAirline,
        booking_reference: outboundPnr,
        flight_type: isInternational ? 'International' : 'Domestic',
        is_international: isInternational,
        trip_type: isRound ? 'Round-Trip' : 'One-Way',
        is_round_trip: isRound,
        paid: form.querySelector('#paid').checked,
        payment_method: finalPaymentMethod,
        paid_date: form.querySelector('#paid_date').value
    };

    // --- Build return-leg shared data when round-trip is enabled ---
    let returnSharedData = null;
    if (isRound) {
        const customizeOn = !!document.getElementById('returnCustomizeToggle')?.checked;
        const retDateInput = form.querySelector('#return_date');
        const retDate = retDateInput ? retDateInput.value : '';

        // Default the return route = inverted outbound; allow custom override
        let retDeparture = destinationVal;
        let retDestination = departureVal;
        let retAirline = outboundAirline;
        let retPnr = outboundPnr;

        if (customizeOn) {
            const retDepSel = form.querySelector('#return_departure');
            const retDestSel = form.querySelector('#return_destination');
            const retAirlineSel = form.querySelector('#return_airline');
            const retPnrInput = form.querySelector('#return_booking_reference');

            if (retDepSel && retDepSel.value) {
                retDeparture = retDepSel.value === 'CUSTOM'
                    ? (form.querySelector('#return_custom_departure')?.value || retDeparture)
                    : retDepSel.value;
            }
            if (retDestSel && retDestSel.value) {
                retDestination = retDestSel.value === 'CUSTOM'
                    ? (form.querySelector('#return_custom_destination')?.value || retDestination)
                    : retDestSel.value;
            }
            if (retAirlineSel && retAirlineSel.value) {
                retAirline = retAirlineSel.value === 'CUSTOM'
                    ? (form.querySelector('#return_custom_airline')?.value || retAirline)
                    : retAirlineSel.value;
            }
            if (retPnrInput && retPnrInput.value.trim()) {
                retPnr = retPnrInput.value.toUpperCase().trim();
            }
        }

        returnSharedData = {
            ...sharedData,
            departure: retDeparture,
            destination: retDestination,
            departing_on: retDate,
            airline: retAirline,
            booking_reference: retPnr
        };
    }

    const passengerData = [];
    const passengerForms = form.querySelectorAll('.passenger-form');
    passengerForms.forEach(pForm => {
        const nrc = collectNrcParts(pForm);
        const nrcNo = joinNrcParts(nrc);
        const passportNo = readPassengerInput(pForm, '.passenger-passport-no').toUpperCase();
        const passenger = {
            gender: pForm.querySelector('.passenger-gender:checked')?.value || 'MR',
            name: readPassengerInput(pForm, '.passenger-name').toUpperCase(),
            dob: readPassengerInput(pForm, '.passenger-dob'),
            nationality: (readPassengerInput(pForm, '.passenger-nationality') || 'MMR').toUpperCase(),
            document_type: isInternational ? 'Passport' : 'NRC',
            id_no: nrcNo || passportNo,
            nrc,
            nrc_no: nrcNo,
            passport_no: passportNo,
            passport_expiry: readPassengerInput(pForm, '.passenger-passport-expiry'),
            passport_photo_url: readPassengerInput(pForm, '.passenger-passport-photo-url'),
            passport_photo_path: readPassengerInput(pForm, '.passenger-passport-photo-path'),
            // Collect all frequent flyer rows
            frequent_flyer_ids: (() => {
                const rows = pForm.querySelectorAll('.member-id-row');
                const entries = [];
                rows.forEach(row => {
                    const airline = (row.querySelector('.member-row-airline')?.value || '').trim();
                    const id = (row.querySelector('.member-row-id')?.value || '').trim().toUpperCase();
                    if (airline || id) entries.push({ airline, id });
                });
                return entries;
            })(),
            // Outbound pricing
            base_fare: readMoneyInput(pForm, '.passenger-base-fare'),
            net_amount: readMoneyInput(pForm, '.passenger-net-amount'),
            extra_fare: readMoneyInput(pForm, '.passenger-extra-fare'),
            commission: readMoneyInput(pForm, '.passenger-commission'),
            remarks: readPassengerInput(pForm, '.passenger-remarks'),
            // Return-leg pricing (zero when one-way)
            return_base_fare: isRound ? readMoneyInput(pForm, '.passenger-return-base-fare') : 0,
            return_net_amount: isRound ? readMoneyInput(pForm, '.passenger-return-net-amount') : 0,
            return_extra_fare: isRound ? readMoneyInput(pForm, '.passenger-return-extra-fare') : 0,
            return_commission: isRound ? readMoneyInput(pForm, '.passenger-return-commission') : 0,
            return_remarks: isRound ? readPassengerInput(pForm, '.passenger-return-remarks') : ''
        };
        if (passenger.name) {
            passengerData.push(passenger);
        }
    });

    return {
        sharedData,
        passengerData,
        returnSharedData
    };
}

/**
 * Saves ticket data to Firestore.
 * @param {Object} sharedData The shared data for all tickets.
 * @param {Array<Object>} passengerData The data for each passenger.
 */
async function saveTicket(sharedData, passengerData, returnSharedData = null) {
    const isRound = !!sharedData.is_round_trip && !!returnSharedData;

    // Helper that builds a single ticket row for a given leg.
    const buildRow = (p, legShared, leg, pricing) => {
        const agentCommission = calculateAgentCut(pricing.commission);
        const row = {
            issued_date: formatDateForSheet(sharedData.issued_date),
            name: p.name,
            id_no: p.id_no,
            nrc: p.nrc || {},
            nrc_no: p.nrc_no || '',
            document_type: p.document_type || 'NRC',
            passport_no: p.passport_no || '',
            passport_expiry: p.passport_expiry || '',
            passport_photo_url: p.passport_photo_url || '',
            passport_photo_path: p.passport_photo_path || '',
            dob: p.dob || '',
            nationality: p.nationality || '',
            phone: sharedData.phone,
            account_name: sharedData.account_name,
            account_type: sharedData.account_type,
            account_link: sharedData.account_link,
            departure: legShared.departure,
            destination: legShared.destination,
            departing_on: formatDateForSheet(legShared.departing_on),
            airline: legShared.airline,
            flight_type: sharedData.flight_type,
            is_international: sharedData.is_international,
            base_fare: pricing.base_fare || 0,
            booking_reference: legShared.booking_reference,
            net_amount: pricing.net_amount || 0,
            paid: sharedData.paid,
            payment_method: sharedData.payment_method,
            paid_date: sharedData.paid ? formatDateForSheet(sharedData.paid_date) : '',
            commission: agentCommission,
            remarks: pricing.remarks || '',
            extra_fare: pricing.extra_fare || 0,
            date_change: 0,
            gender: p.gender,
            member_airline: p.frequent_flyer_ids?.[0]?.airline || '',
            member_id:      p.frequent_flyer_ids?.[0]?.id || '',
            frequent_flyer_ids: JSON.stringify(p.frequent_flyer_ids || [])
        };

        // Tag round-trip rows so they can be linked together later
        if (isRound) {
            row.trip_type = 'Round-Trip';
            row.leg = leg; // 'outbound' or 'return'
        }

        return row;
    };

    const ticketObjects = [];
    passengerData.forEach(p => {
        // Outbound leg (always present)
        ticketObjects.push(buildRow(p, sharedData, 'outbound', {
            base_fare: p.base_fare,
            net_amount: p.net_amount,
            extra_fare: p.extra_fare,
            commission: p.commission,
            remarks: p.remarks
        }));

        // Return leg (only when round-trip)
        if (isRound) {
            ticketObjects.push(buildRow(p, returnSharedData, 'return', {
                base_fare: p.return_base_fare,
                net_amount: p.return_net_amount,
                extra_fare: p.return_extra_fare,
                commission: p.return_commission,
                remarks: p.return_remarks
            }));
        }
    });

    await addTickets(ticketObjects);
}


/**
 * Filters and displays tickets based on search criteria.
 */
export function performSearch() {
    const nameRaw = (document.getElementById('searchName')?.value || '').toUpperCase().trim();
    const nameTokens = nameRaw ? nameRaw.split(/\s+/) : [];
    const bookRef = (document.getElementById('searchBooking')?.value || '').toUpperCase();
    let startDateVal = document.getElementById('searchStartDate')?.value;
    let endDateVal = document.getElementById('searchEndDate')?.value;
    const travelDateVal = document.getElementById('searchTravelDate')?.value || '';
    const departure = document.getElementById('searchDeparture')?.value.toUpperCase();
    const destination = document.getElementById('searchDestination')?.value.toUpperCase();
    const groupByAccount = document.getElementById('groupByAccountToggle')?.checked;

    let searchStartDate = startDateVal ? parseSheetDate(startDateVal) : null;
    let searchEndDate = endDateVal ? parseSheetDate(endDateVal) : null;

    if (searchStartDate) searchStartDate.setHours(0, 0, 0, 0);
    if (searchEndDate) searchEndDate.setHours(23, 59, 59, 999);

    let searchTravelDate = travelDateVal ? parseSheetDate(travelDateVal) : null;

    let results = state.allTickets.filter(t => {
        const issuedDate = parseSheetDate(t.issued_date);
        const travelDate = parseSheetDate(t.departing_on);
        const tName = (t.name || '').toUpperCase();

        const nameMatch = nameTokens.length === 0 || nameTokens.every(token => tName.includes(token));
        const bookRefMatch = !bookRef || (t.booking_reference || '').toUpperCase().includes(bookRef);
        const issuedDateMatch = (!searchStartDate || issuedDate >= searchStartDate) && (!searchEndDate || issuedDate <= searchEndDate);
        const travelDateMatch = !searchTravelDate || (travelDate && travelDate.getTime() === searchTravelDate.getTime());
        const departureMatch = !departure || (t.departure && t.departure.toUpperCase() === departure);
        const destinationMatch = !destination || (t.destination && t.destination.toUpperCase() === destination);

        return nameMatch && bookRefMatch && issuedDateMatch && travelDateMatch && departureMatch && destinationMatch;
    }).sort((a, b) => {
        const dateDiff = parseSheetDate(b.issued_date) - parseSheetDate(a.issued_date);
        if (dateDiff !== 0) return dateDiff;
        return getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt);
    });

    if (groupByAccount) {
        results = groupTicketsByAccount(results, startDateVal, endDateVal);
    }

    state.filteredTickets = results;
    displayTickets(state.filteredTickets, 1);
}

function groupTicketsByAccount(tickets, startDateVal, endDateVal) {
    const map = new Map();
    tickets.forEach(t => {
        const key = (t.account_name || '—').toUpperCase().trim();
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(t);
    });

    const grouped = [];
    map.forEach((group, accountName) => {
        const sumField = (field) => group.reduce((sum, t) => sum + (Number(t[field]) || 0), 0);
        const first = group[0];
        const last = group[group.length - 1];
        grouped.push({
            _grouped: true,
            accountName: accountName === '—' ? 'No Account' : accountName,
            count: group.length,
            tickets: group,
            dateRange: startDateVal && endDateVal ? `${startDateVal} – ${endDateVal}` : (first.issued_date || ''),
            net_amount: sumField('net_amount'),
            commission: sumField('commission'),
            extra_fare: sumField('extra_fare'),
            date_change: sumField('date_change')
        });
    });

    return grouped.sort((a, b) => b.net_amount - a.net_amount);
}

/**
 * Clears all search filters and resets the search form.
 */
export function clearSearch() {
    const form = document.getElementById('recordsSearchForm');
    if (form) form.reset();
    document.querySelectorAll('#recordsSearchForm select').forEach(sel => {
        for (const opt of sel.options) {
            opt.disabled = false;
        }
    });
    performSearch();
    togglePrivateReportButton();
}


/**
 * Sets the date range for the search based on a preset.
 * @param {string} range The preset range ('7', '30', 'month', 'this-month', 'last-month', 'all-time').
 */
export function setDateRangePreset(range) {
    const startDateInput = document.getElementById('searchStartDate');
    const endDateInput = document.getElementById('searchEndDate');
    const today = new Date();

    if (range === 'all-time') {
        startDateInput.value = '';
        endDateInput.value = '';
        performSearch();
        togglePrivateReportButton();
        return;
    }

    let startDate = new Date();
    let endDate = new Date();

    if (range === '7') {
        startDate.setDate(today.getDate() - 7);
    } else if (range === '30') {
        startDate.setDate(today.getDate() - 30);
    } else if (range === 'month' || range === 'this-month') {
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (range === 'last-month') {
        startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        endDate = new Date(today.getFullYear(), today.getMonth(), 0);
    }

    startDateInput.value = formatDateForSheet(startDate);
    endDateInput.value = formatDateForSheet(endDate);
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
    if (!airlineSelect) return;
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
    const unpaidTickets = state.allTickets.filter(t => !isTicketPaid(t));
    const count = unpaidTickets.length;
    const label = document.getElementById('unpaid-only-label');
    if (!label) return;

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

/* ---------------- Edit / Delete / Group Detail ---------------- */

export function openEditTicketModal(ticket) {
    const content = `
        <h3>Edit Ticket</h3>
        <div class="edit-ticket-grid">
            <div class="form-group full-width">
                <label>Name</label>
                <input type="text" id="editName" value="${escapeHtml(ticket.name || '')}">
            </div>
            <div class="form-group">
                <label>PNR</label>
                <input type="text" id="editPnr" value="${escapeHtml(ticket.booking_reference || '')}">
            </div>
            <div class="form-group">
                <label>Airline</label>
                <input type="text" id="editAirline" value="${escapeHtml(ticket.airline || '')}">
            </div>
            <div class="form-group full-width">
                <label>Route</label>
                <input type="text" id="editRoute" value="${escapeHtml(routeShort(ticket))}" placeholder="e.g. RGN → BKK">
            </div>
            <div class="form-group">
                <label>Net Amount</label>
                <input type="number" id="editNetAmount" value="${ticket.net_amount || 0}">
            </div>
            <div class="form-group">
                <label>Commission</label>
                <input type="number" id="editCommission" value="${ticket.commission || 0}">
            </div>
            <div class="form-group">
                <label>Extra Fare</label>
                <input type="number" id="editExtraFare" value="${ticket.extra_fare || 0}">
            </div>
            <div class="form-group">
                <label>Date Change Fees</label>
                <input type="number" id="editDateChange" value="${ticket.date_change || 0}">
            </div>
        </div>
        <div class="form-actions" style="margin-top:1.25rem;">
            <button class="btn btn-primary" id="editSaveBtn">Save</button>
            <button class="btn btn-secondary" id="editCancelBtn">Cancel</button>
        </div>
    `;
    openModal(content);
    document.getElementById('editCancelBtn').addEventListener('click', closeModal);
    document.getElementById('editSaveBtn').addEventListener('click', async () => {
        const route = document.getElementById('editRoute').value.trim();
        const [dep, dest] = route.split(/[→\-\s]+/).map(s => s.trim()).filter(Boolean);
        await updateTicket(ticket.id, {
            name: document.getElementById('editName').value.trim().toUpperCase(),
            booking_reference: document.getElementById('editPnr').value.trim().toUpperCase(),
            airline: document.getElementById('editAirline').value.trim(),
            departure: dep || ticket.departure,
            destination: dest || ticket.destination,
            net_amount: Number(document.getElementById('editNetAmount').value) || 0,
            commission: Number(document.getElementById('editCommission').value) || 0,
            extra_fare: Number(document.getElementById('editExtraFare').value) || 0,
            date_change: Number(document.getElementById('editDateChange').value) || 0
        });
        showToast('Ticket updated successfully', 'success');
        closeModal();
        await loadTicketData();
        updateDashboardData();
        refreshTicketView();
    });
}

export function openEditGroupModal(group) {
    const content = `
        <h3>Edit Group — ${escapeHtml(group.accountName)}</h3>
        <p style="margin-bottom:0.75rem; color:var(--text-secondary); font-size:0.85rem;">${group.count} tickets under this account</p>
        <div class="edit-ticket-grid">
            <div class="form-group full-width">
                <label>Commission (total)</label>
                <input type="number" id="editGroupCommission" value="${group.commission || 0}">
            </div>
            <div class="form-group full-width">
                <label>Extra Fare (total)</label>
                <input type="number" id="editGroupExtraFare" value="${group.extra_fare || 0}">
            </div>
            <div class="form-group full-width">
                <label>Date Change Fees (total)</label>
                <input type="number" id="editGroupDateChange" value="${group.date_change || 0}">
            </div>
        </div>
        <div class="edit-modal-note">
            <i class="fa-solid fa-circle-info"></i> Commission will be divided equally among the ${group.count} tickets. Example: 100,000 ÷ ${group.count} = ${Math.round((group.commission || 0) / group.count).toLocaleString()} each.
        </div>
        <div class="form-actions" style="margin-top:1.25rem;">
            <button class="btn btn-primary" id="editGroupSaveBtn">Save</button>
            <button class="btn btn-secondary" id="editGroupCancelBtn">Cancel</button>
        </div>
    `;
    openModal(content);
    document.getElementById('editGroupCancelBtn').addEventListener('click', closeModal);
    document.getElementById('editGroupSaveBtn').addEventListener('click', async () => {
        const totalCommission = Number(document.getElementById('editGroupCommission').value) || 0;
        const totalExtraFare = Number(document.getElementById('editGroupExtraFare').value) || 0;
        const totalDateChange = Number(document.getElementById('editGroupDateChange').value) || 0;

        const perCommission = Math.round(totalCommission / group.count);
        const perExtraFare = Math.round(totalExtraFare / group.count);
        const perDateChange = Math.round(totalDateChange / group.count);

        const updates = group.tickets.map(t => ({
            id: t.id,
            data: {
                commission: perCommission,
                extra_fare: perExtraFare,
                date_change: perDateChange
            }
        }));

        await batchUpdateTickets(updates);
        showToast('Group updated successfully', 'success');
        closeModal();
        await loadTicketData();
        updateDashboardData();
        refreshTicketView();
    });
}

export function deleteTicketWithConfirm(ticketId) {
    showConfirmModal(
        '<h3>Delete Ticket?</h3><p>This action cannot be undone.</p>',
        async () => {
            await deleteDocument('tickets', ticketId);
            showToast('Ticket deleted', 'success');
            await loadTicketData();
            updateDashboardData();
            refreshTicketView();
        }
    );
}

export function showGroupDetails(group) {
    const rows = group.tickets.map(t => `
        <tr>
            <td>${escapeHtml(t.issued_date || '')}</td>
            <td>${escapeHtml(t.name || '')}</td>
            <td>${escapeHtml(t.booking_reference || '')}</td>
            <td class="num-cell">${(t.net_amount || 0).toLocaleString()}</td>
            <td class="num-cell">${(t.commission || 0).toLocaleString()}</td>
        </tr>
    `).join('');

    const content = `
        <h3>${escapeHtml(group.accountName)} <span class="group-badge">${group.count} clients</span></h3>
        <div class="table-container" style="margin-top:1rem;">
            <table>
                <thead>
                    <tr><th>Issued Date</th><th>Name</th><th>PNR</th><th class="num-header">Net</th><th class="num-header">Commission</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div class="form-actions" style="margin-top:1rem;">
            <button class="btn btn-secondary" id="groupCloseBtn">Close</button>
        </div>
    `;
    openModal(content);
    document.getElementById('groupCloseBtn').addEventListener('click', closeModal);
}
