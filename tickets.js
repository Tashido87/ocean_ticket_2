
/**
 * @fileoverview Manages all logic related to tickets, including loading, parsing,
 * displaying, searching, and handling the ticket selling form.
 */

import { state } from './state.js';
import { getTickets, addTickets, updateTicket, batchUpdateTickets, deleteDocument, updateHotelReservation } from './db.js';
import { showToast, parseSheetDate, renderEmptyState, formatDateForSheet, calculateAgentCut, makeClickable, formatDateToDMMMY, formatPaymentMethod, isTicketPaid, renderAirlineName } from './utils.js';
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

    const isChild = ['MSTR', 'MISS'].includes(passenger.gender);
    
    // Check if NRC is partially filled
    const nrc = passenger.nrc || {};
    const filledNrcParts = [nrc.region, nrc.township, nrc.type, nrc.serial].filter(Boolean).length;
    if (filledNrcParts > 0 && filledNrcParts < 4) {
        return `${label}: Please complete all NRC parts.`;
    }

    if (!isChild && !isInternational && !passenger.nrc_no) return `${label}: complete NRC number is required.`;
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
 * Helper to map hotel reservation to ticket-like object
 */
function mapHotelToTicket(h) {
    let guestCount = 0;
    if (h.other_names) {
        const parsed = parseInt(h.other_names, 10);
        if (!isNaN(parsed)) {
            guestCount = Math.max(0, parsed - 1);
        } else {
            const parts = h.other_names.split(/,|\band\b|;/i).map(s => s.trim()).filter(Boolean);
            guestCount = Math.max(1, parts.length);
        }
    }
    const nameStr = h.client_name + (guestCount > 0 ? ` (+${guestCount})` : '');

    return {
        ...h,
        _isHotel: true,
        issued_date: h.checkin,
        name: nameStr,
        booking_reference: h.booking_ref,
        departure: h.city,
        destination: `${h.hotel_name} (${h.country})`,
        airline: 'Hotel',
        net_amount: Number(h.net_amount || 0),
        commission: Number(h.commission || 0),
        extra_fare: 0,
        date_change: 0
    };
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
    const mappedHotels = (state.allHotels || []).map(mapHotelToTicket);
    const sorted = [...state.allTickets, ...mappedHotels].sort((a, b) => {
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
                <th class="route-cell">Route</th>
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

    paginated.forEach((item, index) => {
        const isGroup = isGrouped && item._grouped;
        const row = tbody.insertRow();
        if (isGroup) row.classList.add('grouped-row');
        if (!isGroup && !item._isHotel && item.remarks) {
            const lowerRemarks = item.remarks.toLowerCase();
            if (lowerRemarks.includes('refund') || lowerRemarks.includes('cancel')) {
                row.classList.add('canceled-row');
            }
        }

        const ticket = isGroup ? item : item;
        const nameCell = isGroup
            ? `<strong>${escapeHtml(ticket.tickets[0]?.name || 'Unknown')}</strong> <span class="group-badge">${ticket.count} clients</span>`
            : escapeHtml(ticket.name || '');

        const routeText = isGroup 
            ? (ticket.tickets[0]?._isHotel 
                ? escapeHtml(`${ticket.tickets[0]?.hotel_name} (${ticket.tickets[0]?.city}, ${ticket.tickets[0]?.country})`) 
                : escapeHtml(routeShort(ticket.tickets[0])))
            : (ticket._isHotel 
                ? escapeHtml(`${ticket.hotel_name} (${ticket.city}, ${ticket.country})`) 
                : escapeHtml(routeShort(ticket)));

        const airlineText = isGroup 
            ? (ticket.tickets[0]?._isHotel 
                ? `<span style="font-weight:600; color:#0d9488;"><i class="fa-solid fa-hotel"></i> Hotel</span>` 
                : renderAirlineName(ticket.tickets[0]?.airline || ''))
            : (ticket._isHotel 
                ? `<span style="font-weight:600; color:#0d9488;"><i class="fa-solid fa-hotel"></i> Hotel</span>` 
                : renderAirlineName(ticket.airline || ''));

        let netAmountHtml;
        let commissionHtml;
        let extraFareHtml;
        let dateChangeHtml;

        if (state.recordsEditMode) {
            const isHotel = isGroup ? Boolean(ticket.tickets[0]?._isHotel) : Boolean(ticket._isHotel);
            const inputId = isGroup ? `group-${ticket.accountName.replace(/[^a-zA-Z0-9]/g, '_')}-${index}` : ticket.id;
            const dataId = isGroup ? ticket.tickets.map(t => t.id).join(',') : ticket.id;

            netAmountHtml = `<input type="number" 
                class="net-amount-inline-input inline-excel-input" 
                id="net-amount-input-${inputId}" 
                data-id="${dataId}" 
                data-field="net_amount"
                data-is-hotel="${isHotel}"
                data-is-grouped="${isGroup}"
                value="${ticket.net_amount || 0}" 
            />`;
            commissionHtml = `<input type="number" 
                class="commission-inline-input inline-excel-input" 
                id="commission-input-${inputId}" 
                data-id="${dataId}" 
                data-field="commission"
                data-is-hotel="${isHotel}"
                data-is-grouped="${isGroup}"
                value="${ticket.commission || 0}" 
            />`;
            extraFareHtml = `<input type="number" 
                class="extra-fare-inline-input inline-excel-input" 
                id="extra-fare-input-${inputId}" 
                data-id="${dataId}" 
                data-field="extra_fare"
                data-is-hotel="${isHotel}"
                data-is-grouped="${isGroup}"
                value="${ticket.extra_fare || 0}" 
                ${isHotel ? 'disabled style="background:transparent; border:none; color:var(--text-secondary); cursor:not-allowed;"' : ''}
            />`;
            dateChangeHtml = `<input type="number" 
                class="date-change-inline-input inline-excel-input" 
                id="date-change-input-${inputId}" 
                data-id="${dataId}" 
                data-field="date_change"
                data-is-hotel="${isHotel}"
                data-is-grouped="${isGroup}"
                value="${ticket.date_change || 0}" 
                ${isHotel ? 'disabled style="background:transparent; border:none; color:var(--text-secondary); cursor:not-allowed;"' : ''}
            />`;
        } else {
            netAmountHtml = (ticket.net_amount || 0).toLocaleString();
            commissionHtml = (ticket.commission || 0).toLocaleString();
            extraFareHtml = (ticket.extra_fare || 0).toLocaleString();
            dateChangeHtml = (ticket.date_change || 0).toLocaleString();
        }

        row.innerHTML = `
            <td>${formatDateToDMMMY(ticket.issued_date || ticket.dateRange || '')}</td>
            <td>${nameCell}</td>
            <td>${isGroup ? '—' : escapeHtml(ticket.booking_reference || '')}</td>
            <td class="route-cell">${routeText}</td>
            <td>${airlineText}</td>
            <td class="num-cell">${netAmountHtml}</td>
            <td class="num-cell commission-td">${commissionHtml}</td>
            <td class="num-cell">${extraFareHtml}</td>
            <td class="num-cell">${dateChangeHtml}</td>
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
                    } else if (ticket._isHotel) {
                        showHotelDetails(ticket);
                    } else {
                        showDetails(ticket.id);
                    }
                } else if (action === 'edit') {
                    if (isGroup) {
                        openEditGroupModal(ticket);
                    } else if (ticket._isHotel) {
                        showView('hotel');
                        window.editHotelReservation(ticket.id);
                    } else {
                        openEditTicketModal(ticket);
                    }
                } else if (action === 'delete' && !isGroup) {
                    if (ticket._isHotel) {
                        window.deleteHotelReservationAction(ticket.id);
                    } else {
                        deleteTicketWithConfirm(ticket.id);
                    }
                }
            });
        });
    });

    setupPagination(tickets);

    // Setup event listeners for inline excel inputs
    if (state.recordsEditMode) {
        const inputFields = ['net_amount', 'commission', 'extra_fare', 'date_change'];
        inputFields.forEach(field => {
            const inputs = Array.from(tbody.querySelectorAll(`.${field.replace('_', '-')}-inline-input`));
            inputs.forEach((input, index) => {
                input.addEventListener('focus', function() {
                    window.activeFocusedInputId = this.id;
                });

                input.addEventListener('blur', function() {
                    if (window.activeFocusedInputId === this.id) {
                        window.activeFocusedInputId = null;
                    }
                    const ticketId = this.dataset.id;
                    const isHotel = this.dataset.isHotel === 'true';
                    const isGrouped = this.dataset.isGrouped === 'true';
                    
                    let oldValue;
                    if (isGrouped) {
                        const ids = ticketId.split(',');
                        oldValue = ids.reduce((sum, id) => {
                            const t = isHotel 
                                ? state.allHotels.find(h => h.id === id)
                                : state.allTickets.find(x => x.id === id);
                            return sum + (t ? (Number(t[field]) || 0) : 0);
                        }, 0);
                    } else {
                        oldValue = isHotel 
                            ? (state.allHotels.find(h => h.id === ticketId)?.[field] || 0)
                            : (state.allTickets.find(t => t.id === ticketId)?.[field] || 0);
                    }
                    
                    const newValue = Number(this.value) || 0;
                    if (newValue !== oldValue) {
                        saveFieldUpdate(ticketId, isHotel, field, newValue, isGrouped);
                    }
                });

                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        
                        const ticketId = this.dataset.id;
                        const isHotel = this.dataset.isHotel === 'true';
                        const isGrouped = this.dataset.isGrouped === 'true';
                        const newValue = Number(this.value) || 0;
                        
                        // Save asynchronously
                        saveFieldUpdate(ticketId, isHotel, field, newValue, isGrouped);
                        
                        // Navigate to next row in same column
                        const colInputs = inputs.filter(inp => !inp.disabled);
                        const colIndex = colInputs.indexOf(this);
                        const nextIndex = e.shiftKey ? colIndex - 1 : colIndex + 1;
                        if (nextIndex >= 0 && nextIndex < colInputs.length) {
                            const nextInput = colInputs[nextIndex];
                            window.activeFocusedInputId = nextInput.id;
                            window.activeFocusedInputSelectAll = true;
                            nextInput.focus();
                            nextInput.select();
                        } else {
                            this.blur();
                        }
                    }
                });
            });
        });
    }

    // Restore focus if needed
    if (window.activeFocusedInputId) {
        const activeEl = document.getElementById(window.activeFocusedInputId);
        if (activeEl) {
            activeEl.focus();
            if (window.activeFocusedInputSelectAll) {
                activeEl.select();
                window.activeFocusedInputSelectAll = false;
            }
        }
    }
}

/**
 * Helper to update a ticket or hotel's field value inline.
 * Updates the local state for fast UI feedback, then pushes to Firestore.
 */
async function saveFieldUpdate(id, isHotel, field, value, isGrouped = false) {
    const numericVal = Number(value) || 0;
    
    if (isGrouped) {
        const ids = id.split(',');
        const perTicketValue = Math.round(numericVal / ids.length);
        
        let firstTicket = null;
        // Update local state immediately for snappy response
        ids.forEach(singleId => {
            if (isHotel) {
                const hotel = state.allHotels.find(h => h.id === singleId);
                if (hotel) {
                    hotel[field] = perTicketValue;
                    if (!firstTicket) firstTicket = hotel;
                }
            } else {
                const ticket = state.allTickets.find(t => t.id === singleId);
                if (ticket) {
                    ticket[field] = perTicketValue;
                    if (!firstTicket) firstTicket = ticket;
                }
            }
        });

        try {
            const updates = ids.map(singleId => ({
                id: singleId,
                data: { [field]: perTicketValue }
            }));
            await batchUpdateTickets(updates);
            
            await saveHistory(
                firstTicket || { name: 'Group Update', booking_reference: '—' },
                `Inline group ${field.replace('_', ' ')} update to total ${numericVal.toLocaleString()} MMK (${perTicketValue.toLocaleString()} MMK per client)`
            );
        } catch (err) {
            showToast(`Failed to update group ${field.replace('_', ' ')}: ` + err.message, 'error');
        }
    } else {
        // Individual update
        let itemObj = null;
        if (isHotel) {
            const hotel = state.allHotels.find(h => h.id === id);
            if (hotel) {
                hotel[field] = numericVal;
                itemObj = hotel;
            }
        } else {
            const ticket = state.allTickets.find(t => t.id === id);
            if (ticket) {
                ticket[field] = numericVal;
                itemObj = ticket;
            }
        }
        
        try {
            const updateData = { [field]: numericVal };
            if (isHotel) {
                await updateHotelReservation(id, updateData);
            } else {
                await updateTicket(id, updateData);
            }
            
            await saveHistory(
                itemObj || { name: 'Unknown', booking_reference: '—' },
                `Inline ${field.replace('_', ' ')} update for ${isHotel ? 'Hotel' : 'Ticket'} to ${numericVal.toLocaleString()} MMK`
            );
        } catch (err) {
            showToast(`Failed to update ${field.replace('_', ' ')}: ` + err.message, 'error');
        }
    }
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
    const baseTicketName = String(ticket.name || '').replace(/\s*\(fees\)\s*$/i, '').trim();
    if (baseTicketName) {
        const c = state.allClients.find(c =>
            String(c.name || '').toLowerCase() === baseTicketName.toLowerCase() &&
            !String(c.name || '').includes('(Fees)')
        );
        if (c) clientKey = c.client_key;
    }

    const content = `
        <div class="details-header">
            <div>
                <div class="client-name ${clientKey ? 'clickable-client-link' : ''}" data-client-key="${clientKey || ''}" ${clientKey ? 'style="cursor:pointer; color:var(--teal-dark); text-decoration:underline;" title="View Client"' : ''}>${escapeHtml(baseTicketName || ticket.name || 'N/A')}${/\(fees\)\s*$/i.test(ticket.name || '') ? ' <span style="color:var(--muted);font-weight:600">(Fees)</span>' : ''}</div>
                <div class="pnr-code">PNR: ${escapeHtml(ticket.booking_reference || 'N/A')}</div>
            </div>
            <div class="details-status-badge ${statusClass}">${statusText}</div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Client Information</div>
            <div class="details-grid">
                <div class="details-item"><i class="fa-solid fa-id-card"></i><div class="details-item-content"><div class="label">ID No.</div><div class="value">${escapeHtml(ticket.id_no || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-phone"></i><div class="details-item-content"><div class="label">Phone</div><div class="value">${makeClickable(ticket.phone) || 'N/A'}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-hashtag"></i><div class="details-item-content"><div class="label">Social Media</div><div class="value">${escapeHtml(ticket.account_name || 'N/A')} (${escapeHtml(ticket.account_type || 'N/A')})</div></div></div>
                <div class="details-item"><i class="fa-solid fa-link"></i><div class="details-item-content"><div class="label">Account Link</div><div class="value">${makeClickable(ticket.account_link) || 'N/A'}</div></div></div>
            </div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Flight Details</div>
            <div class="details-grid">
                <div class="details-item"><i class="fa-solid fa-plane-departure"></i><div class="details-item-content"><div class="label">From</div><div class="value">${escapeHtml(ticket.departure || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-plane-arrival"></i><div class="details-item-content"><div class="label">To</div><div class="value">${escapeHtml(ticket.destination || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-calendar-days"></i><div class="details-item-content"><div class="label">Travel Date</div><div class="value">${escapeHtml(ticket.departing_on || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-plane"></i><div class="details-item-content"><div class="label">Airline</div><div class="value">${renderAirlineName(ticket.airline || 'N/A', { size: 'md' })}</div></div></div>
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
            e.preventDefault();
            e.stopPropagation();
            const key = e.currentTarget.dataset.clientKey;
            if (key) {
                closeModal();
                const { navigateToClient } = await import('./search.js');
                navigateToClient(key);
            }
        });
    }
}

/**
 * Shows a detailed modal view for a specific hotel reservation.
 * @param {Object} hotel The hotel reservation object.
 */
export function showHotelDetails(hotel) {
    let statusClass = hotel.paid === 'paid' ? 'confirmed' : 'pending';
    let statusText = hotel.paid === 'paid' 
        ? `Paid on ${formatDateToDMMMY(hotel.payment_date) || 'N/A'} via ${hotel.payment_method || 'N/A'}`
        : 'Unpaid';

    let clientKey = '';
    const baseClientName = String(hotel.client_name || '').trim();
    if (baseClientName) {
        const c = state.allClients.find(c =>
            String(c.name || '').toLowerCase() === baseClientName.toLowerCase()
        );
        if (c) clientKey = c.client_key;
    }

    const content = `
        <div class="details-header">
            <div>
                <div class="client-name ${clientKey ? 'clickable-client-link' : ''}" data-client-key="${clientKey || ''}" ${clientKey ? 'style="cursor:pointer; color:var(--teal-dark); text-decoration:underline;" title="View Client"' : ''}>${escapeHtml(hotel.client_name || 'N/A')}</div>
                ${hotel.other_names ? `
                    <div style="font-size:0.9rem; color:var(--muted);">
                        ${!isNaN(parseInt(hotel.other_names, 10)) ? `Total Guests (incl. Lead): ${escapeHtml(hotel.other_names)}` : `Other Guests: ${escapeHtml(hotel.other_names)}`}
                    </div>` : ''}
                <div class="pnr-code">Confirmation Ref: ${escapeHtml(hotel.booking_ref || 'N/A')}</div>
            </div>
            <div class="details-status-badge ${statusClass}">${statusText}</div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Hotel Information</div>
            <div class="details-grid">
                <div class="details-item"><i class="fa-solid fa-hotel"></i><div class="details-item-content"><div class="label">Hotel Name</div><div class="value">${escapeHtml(hotel.hotel_name || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-location-dot"></i><div class="details-item-content"><div class="label">Location</div><div class="value">${escapeHtml(hotel.city || 'N/A')}, ${escapeHtml(hotel.country || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-calendar-check"></i><div class="details-item-content"><div class="label">Check In</div><div class="value">${escapeHtml(hotel.checkin || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-calendar-xmark"></i><div class="details-item-content"><div class="label">Check Out</div><div class="value">${escapeHtml(hotel.checkout || 'N/A')}</div></div></div>
            </div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Supplier & Notes</div>
            <div class="details-grid">
                <div class="details-item"><i class="fa-solid fa-calendar-days"></i><div class="details-item-content"><div class="label">Booking Date</div><div class="value">${escapeHtml(hotel.booking_date || hotel.checkin || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-handshake"></i><div class="details-item-content"><div class="label">Supplier</div><div class="value">${escapeHtml(hotel.supplier || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-note-sticky"></i><div class="details-item-content"><div class="label">Notes</div><div class="value">${escapeHtml(hotel.notes || '—')}</div></div></div>
            </div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Financials</div>
            <div class="details-grid">
                 <div class="details-item"><i class="fa-solid fa-dollar-sign"></i><div class="details-item-content"><div class="label">Base Fare (Customer Price)</div><div class="value">${(hotel.base_fare || 0).toLocaleString()} MMK</div></div></div>
                 <div class="details-item"><i class="fa-solid fa-receipt"></i><div class="details-item-content"><div class="label">Net Amount (Supplier Cost)</div><div class="value">${(hotel.net_amount || 0).toLocaleString()} MMK</div></div></div>
                 <div class="details-item"><i class="fa-solid fa-hand-holding-dollar"></i><div class="details-item-content"><div class="label">Commission (Profit)</div><div class="value">${(hotel.commission || 0).toLocaleString()} MMK</div></div></div>
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
            e.preventDefault();
            e.stopPropagation();
            const key = e.currentTarget.dataset.clientKey;
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
            for (const docId of state.bookingToUpdate) {
                await deleteDocument('bookings', docId);
            }
        }

        showToast('Ticket(s) saved successfully!', 'success');
        form.reset();
        resetPassengerForms();
        populateFlightLocations();
        updateToggleLabels();

        // Data and UI will update automatically via real-time listeners
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
        paid_date: form.querySelector('#paid_date').value,
        source: form.querySelector('input[name="ticket_source"]:checked')?.value || 'owner'
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
            cost_price: readMoneyInput(pForm, '.passenger-cost-price'),
            supplier: readPassengerInput(pForm, '.passenger-supplier'),
            base_fare: readMoneyInput(pForm, '.passenger-base-fare'),
            net_amount: readMoneyInput(pForm, '.passenger-net-amount'),
            extra_fare: readMoneyInput(pForm, '.passenger-extra-fare'),
            commission: readMoneyInput(pForm, '.passenger-commission'),
            remarks: readPassengerInput(pForm, '.passenger-remarks'),
            // Return-leg pricing (zero when one-way)
            return_cost_price: isRound ? readMoneyInput(pForm, '.passenger-return-cost-price') : 0,
            return_supplier: isRound ? readPassengerInput(pForm, '.passenger-return-supplier') : '',
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
        const agentCommission = sharedData.source === 'self' ? (Number(pricing.commission) || 0) : calculateAgentCut(pricing.commission);
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
            source: sharedData.source || 'owner',
            cost_price: pricing.cost_price || 0,
            supplier: pricing.supplier || '',
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
            cost_price: p.cost_price,
            supplier: p.supplier,
            base_fare: p.base_fare,
            net_amount: p.net_amount,
            extra_fare: p.extra_fare,
            commission: p.commission,
            remarks: p.remarks
        }));

        // Return leg (only when round-trip)
        if (isRound) {
            ticketObjects.push(buildRow(p, returnSharedData, 'return', {
                cost_price: p.return_cost_price,
                supplier: p.return_supplier,
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
    const searchSource = document.getElementById('searchSource')?.value || 'all';

    let searchStartDate = startDateVal ? parseSheetDate(startDateVal) : null;
    let searchEndDate = endDateVal ? parseSheetDate(endDateVal) : null;

    if (searchStartDate) searchStartDate.setHours(0, 0, 0, 0);
    if (searchEndDate) searchEndDate.setHours(23, 59, 59, 999);

    let searchTravelDate = travelDateVal ? parseSheetDate(travelDateVal) : null;

    let ticketResults = state.allTickets.filter(t => {
        const issuedDate = parseSheetDate(t.issued_date);
        const travelDate = parseSheetDate(t.departing_on);
        const tName = (t.name || '').toUpperCase();

        const nameMatch = nameTokens.length === 0 || nameTokens.every(token => tName.includes(token));
        const bookRefMatch = !bookRef || (t.booking_reference || '').toUpperCase().includes(bookRef);
        const issuedDateMatch = (!searchStartDate || issuedDate >= searchStartDate) && (!searchEndDate || issuedDate <= searchEndDate);
        const travelDateMatch = !searchTravelDate || (travelDate && travelDate.getTime() === searchTravelDate.getTime());
        const departureMatch = !departure || (t.departure && t.departure.toUpperCase() === departure);
        const destinationMatch = !destination || (t.destination && t.destination.toUpperCase() === destination);
        const sourceMatch = searchSource === 'all' || (searchSource === 'self' ? t.source === 'self' : t.source !== 'self');

        return nameMatch && bookRefMatch && issuedDateMatch && travelDateMatch && departureMatch && destinationMatch && sourceMatch;
    });

    let hotelResults = (state.allHotels || []).filter(h => {
        const checkinDate = parseSheetDate(h.checkin);
        const guestName = ((h.client_name || '') + ' ' + (h.other_names || '')).toUpperCase();

        const nameMatch = nameTokens.length === 0 || nameTokens.every(token => guestName.includes(token));
        const bookRefMatch = !bookRef || (h.booking_ref || '').toUpperCase().includes(bookRef);
        const checkinMatch = (!searchStartDate || checkinDate >= searchStartDate) && (!searchEndDate || checkinDate <= searchEndDate);
        const travelDateMatch = !searchTravelDate || (checkinDate && checkinDate.getTime() === searchTravelDate.getTime());
        const sourceMatch = searchSource === 'all' || (searchSource === 'self' ? h.source === 'self' : h.source !== 'self');

        const departureMatch = !departure || 
            (h.city && h.city.toUpperCase().includes(departure)) || 
            (h.country && h.country.toUpperCase().includes(departure));

        const destinationMatch = !destination || 
            (h.hotel_name && h.hotel_name.toUpperCase().includes(destination)) ||
            (h.city && h.city.toUpperCase().includes(destination)) ||
            (h.country && h.country.toUpperCase().includes(destination));

        return nameMatch && bookRefMatch && checkinMatch && travelDateMatch && departureMatch && destinationMatch && sourceMatch;
    }).map(mapHotelToTicket);

    let results = [...ticketResults, ...hotelResults].sort((a, b) => {
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
        const accName = (t.account_name || '—').trim().toUpperCase();
        
        // Get route
        const dep = (t.departure || '').trim().toUpperCase();
        const dest = (t.destination || '').trim().toUpperCase();
        const routeKey = `${dep}→${dest}`;
        
        // Get travel date
        const travelDate = t._isHotel ? (t.checkin || t.issued_date || '') : (t.departing_on || '');
        const dateKey = String(travelDate).trim().toUpperCase();
        
        // Compound key: Account + Route + Travel Date
        const key = `${accName}|${routeKey}|${dateKey}`;
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(t);
    });

    const grouped = [];
    map.forEach((group, key) => {
        const sumField = (field) => group.reduce((sum, t) => sum + (Number(t[field]) || 0), 0);
        const first = group[0];
        
        const accountName = (first.account_name || '—').trim();
        const travelDate = first._isHotel ? (first.checkin || first.issued_date || '') : (first.departing_on || '');

        grouped.push({
            _grouped: true,
            accountName: accountName === '—' ? 'No Account' : accountName,
            count: group.length,
            tickets: group,
            issued_date: first.issued_date || '',
            dateRange: travelDate || first.issued_date || '',
            net_amount: sumField('net_amount'),
            commission: sumField('commission'),
            extra_fare: sumField('extra_fare'),
            date_change: sumField('date_change')
        });
    });

    return grouped.sort((a, b) => {
        const dateA = parseSheetDate(a.issued_date);
        const dateB = parseSheetDate(b.issued_date);
        if (dateB - dateA !== 0) return dateB - dateA;
        return b.net_amount - a.net_amount;
    });
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
    const uniqueAirlines = [...new Set(state.allTickets.map(t => String(t.airline || '').toUpperCase()).filter(Boolean))];
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
        // Data and UI will update automatically via real-time listeners
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
        // Data and UI will update automatically via real-time listeners
    });
}

export function deleteTicketWithConfirm(ticketId) {
    showConfirmModal(
        '<h3>Delete Ticket?</h3><p>This action cannot be undone.</p>',
        async () => {
            await deleteDocument('tickets', ticketId);
            showToast('Ticket deleted', 'success');
            // Data and UI will update automatically via real-time listeners
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
