/**
 * @fileoverview Manages all logic related to booking requests, including loading,
 * displaying, searching, and creating new bookings.
 */

import {
    CONFIG
} from './config.js';
import {
    state
} from './state.js';
import {
    fetchFromSheet,
    batchUpdateSheet,
    appendToSheet
} from './api.js';
import {
    showToast,
    parseSheetDate,
    renderEmptyState,
    formatDateToDMMMY,
    parseDeadline,
    makeClickable,
    formatDateForSheet
} from './utils.js';
import {
    openModal,
    closeModal,
    showConfirmModal,
    setupBookingPagination,
    resetBookingPassengerForms,
    showView,
    updateNotifications,
    handleRouteValidation,
    resetPassengerForms,
    addPassengerForm,
    hideNewBookingForm
} from './ui.js';

/**
 * Loads booking data from the Google Sheet.
 */
export async function loadBookingData() {
    try {
        const response = await fetchFromSheet(`${CONFIG.BOOKING_SHEET_NAME}!A:M`, 'bookingData');

        if (response.values) {
            state.allBookings = parseBookingData(response.values);
            await handleExpiredBookings(); // Automatically update expired bookings
        } else {
            state.allBookings = [];
        }
        populateBookingSearchOptions();
        displayBookings();
    } catch (error) {
        renderEmptyState('bookingTableContainer', 'fa-calendar-xmark', 'Failed to load bookings', 'Could not retrieve booking data from the sheet. Please check permissions and try again.');
    }
}

/**
 * Parses raw sheet data into an array of booking objects.
 * @param {Array<Array<string>>} values The raw values from the sheet.
 * @returns {Array<Object>} An array of booking objects.
 */
function parseBookingData(values) {
    if (values.length < 1) return [];
    const headers = values[0].map(h => h.toLowerCase().replace(/\s+/g, '_').replace('nrc_no', 'id_no'));
    return values.slice(1).map((row, i) => {
        const booking = {};
        headers.forEach((h, j) => {
            const value = row[j] || '';
            let propertyName = h;
            if (propertyName === 'remark') {
                propertyName = 'remark';
            }
            booking[propertyName] = typeof value === 'string' ? value.trim() : value;
        });
        booking.rowIndex = i + 2;
        const groupIdBase = booking.pnr || `${booking.phone}-${booking.account_link}`;
        booking.groupId = `${groupIdBase}-${booking.departing_on}-${booking.departure}-${booking.destination}`;
        return booking;
    });
}

/**
 * Finds expired bookings and updates their status to 'end' in the sheet.
 */
async function handleExpiredBookings() {
    const now = new Date();
    const expiredBookingsToUpdate = [];

    state.allBookings.forEach(booking => {
        const deadline = parseDeadline(booking.enddate, booking.endtime);
        const hasNoAction = !booking.remark || String(booking.remark).trim() === '';

        if (hasNoAction && deadline && deadline < now) {
            const values = [
                booking.name || '', booking.id_no || '', booking.phone || '',
                booking.account_name || '', booking.account_type || '', booking.account_link || '',
                booking.departure || '', booking.destination || '', booking.departing_on || '',
                booking.pnr || '', 'end', // Set remark to 'end'
                booking.enddate || '', booking.endtime || '',
            ];
            expiredBookingsToUpdate.push({
                range: `${CONFIG.BOOKING_SHEET_NAME}!A${booking.rowIndex}:M${booking.rowIndex}`,
                values: [values]
            });
        }
    });

    if (expiredBookingsToUpdate.length > 0) {
        console.log(`Found ${expiredBookingsToUpdate.length} expired bookings to update.`);
        try {
            await batchUpdateSheet(expiredBookingsToUpdate);
            console.log('Successfully updated expired bookings.');
            state.cache['bookingData'] = null;
            const updatedRowIndices = expiredBookingsToUpdate.map(upd => parseInt(upd.range.match(/\d+$/)[0], 10));
            state.allBookings = state.allBookings.filter(b => !updatedRowIndices.includes(b.rowIndex));

        } catch (error) {
            console.error('Failed to update expired bookings:', error);
            showToast('Could not update expired bookings automatically.', 'error');
        }
    }
}

/**
 * Displays active bookings, grouped by PNR and route.
 * @param {Array<Object>} [bookingsToDisplay] Optional array of bookings to display; otherwise, filters all active bookings.
 */
export function displayBookings(bookingsToDisplay) {
    const container = document.getElementById('bookingTableContainer');
    container.innerHTML = '';

    let bookings;
    if (bookingsToDisplay) {
        bookings = bookingsToDisplay;
    } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        bookings = state.allBookings.filter(b => {
            const hasNoAction = !b.remark || String(b.remark).trim() === '';
            const travelDate = parseSheetDate(b.departing_on);
            return hasNoAction && travelDate >= today;
        });
    }

    const groupedBookings = bookings.reduce((acc, booking) => {
        if (!acc[booking.groupId]) {
            acc[booking.groupId] = { ...booking,
                passengers: [],
                rowIndices: []
            };
        }
        acc[booking.groupId].passengers.push({
            name: booking.name,
            id_no: booking.id_no,
            rowIndex: booking.rowIndex
        });
        acc[booking.groupId].rowIndices.push(booking.rowIndex);
        return acc;
    }, {});

    const displayableGroups = Object.values(groupedBookings);
    displayableGroups.sort((a, b) => parseSheetDate(a.departing_on) - parseSheetDate(b.departing_on));
    state.filteredBookings = displayableGroups;

    if (state.filteredBookings.length === 0) {
        renderEmptyState('bookingTableContainer', 'fa-calendar-check', 'No Active Bookings', 'There are no current booking requests. Add one to get started!');
        setupBookingPagination([]);
        return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Travel Date</th><th>Client Name</th><th>Route</th><th>PNR</th><th>Booking End date and time</th><th>Get Ticket</th><th>Cancel</th><th>Details</th><th>Sell</th>
            </tr>
        </thead>
        <tbody id="bookingTableBody"></tbody>
    `;
    container.appendChild(table);

    state.bookingCurrentPage = 1;
    renderBookingPage(1);
}

/**
 * Renders a specific page of the booking list.
 * @param {number} page The page number to render.
 */
export function renderBookingPage(page) {
    state.bookingCurrentPage = page;
    const tbody = document.getElementById('bookingTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const paginated = state.filteredBookings.slice((page - 1) * state.rowsPerPage, page * state.rowsPerPage);

    paginated.forEach(group => {
        const rowIndicesStr = group.rowIndices.join(',');
        const firstPassengerName = group.passengers[0] ? group.passengers[0].name : 'N/A';
        const passengerCount = group.passengers.length;
        const deadline = parseDeadline(group.enddate, group.endtime);
        const isNearDeadline = deadline && (deadline.getTime() - Date.now()) < (6 * 60 * 60 * 1000) && deadline.getTime() > Date.now();

        const row = tbody.insertRow();
        if (isNearDeadline) {
            row.classList.add('deadline-warning');
        }

        row.innerHTML = `
            <td>${formatDateToDMMMY(group.departing_on) || ''}</td>
            <td>${firstPassengerName}${passengerCount > 1 ? ` (+${passengerCount - 1})` : ''}</td>
            <td>${(group.departure || '').split(' ')[0]}→${(group.destination || '').split(' ')[0]}</td>
            <td>${group.pnr || 'N/A'}</td>
            <td>${group.enddate && group.endtime ? `${formatDateToDMMMY(group.enddate)} ${group.endtime}` : 'N/A'}</td>
            <td><input type="checkbox" class="action-checkbox"></td>
            <td><input type="checkbox" class="action-checkbox"></td>
            <td><button class="icon-btn icon-btn-table" title="View Details"><i class="fa-solid fa-eye"></i></button></td>
            <td><button class="icon-btn icon-btn-table" title="Sell Ticket"><i class="fa-solid fa-ticket"></i></button></td>
        `;
        // Add event listeners
        const checkboxes = row.querySelectorAll('.action-checkbox');
        checkboxes[0].addEventListener('click', () => handleGetTicket(rowIndicesStr));
        checkboxes[1].addEventListener('click', () => handleCancelBooking(rowIndicesStr));
        row.querySelector('[title="View Details"]').addEventListener('click', () => showBookingDetails(rowIndicesStr));
        row.querySelector('[title="Sell Ticket"]').addEventListener('click', () => sellTicketFromBooking(rowIndicesStr));
    });

    setupBookingPagination(state.filteredBookings);
}

/**
 * Handles the "Get Ticket" action for a booking.
 * @param {string} rowIndicesStr A comma-separated string of row indices.
 */
function handleGetTicket(rowIndicesStr) {
    const rowIndices = rowIndicesStr.split(',').map(Number);
    const bookingGroup = state.filteredBookings.find(g => g.rowIndices.includes(rowIndices[0]));
    const clientName = bookingGroup ? bookingGroup.passengers[0].name : 'this booking';
    const passengerCount = bookingGroup ? bookingGroup.passengers.length : 1;
    const message = `Are you sure you want to mark the booking for <strong>${clientName} ${passengerCount > 1 ? `and ${passengerCount - 1} other(s)` : ''}</strong> as "Get Ticket"? This will remove it from the list.`;
    showConfirmModal(message, async () => {
        closeModal();
        await updateBookingStatus(rowIndices, 'complete');
    });
}

/**
 * Handles the "Cancel" action for a booking.
 * @param {string} rowIndicesStr A comma-separated string of row indices.
 */
function handleCancelBooking(rowIndicesStr) {
    const rowIndices = rowIndicesStr.split(',').map(Number);
    const bookingGroup = state.filteredBookings.find(g => g.rowIndices.includes(rowIndices[0]));
    const clientName = bookingGroup ? bookingGroup.passengers[0].name : 'this booking';
    const passengerCount = bookingGroup ? bookingGroup.passengers.length : 1;
    const message = `Are you sure you want to <strong>CANCEL</strong> the booking for <strong>${clientName} ${passengerCount > 1 ? `and ${passengerCount - 1} other(s)` : ''}</strong>? This will remove it from the list.`;
    showConfirmModal(message, async () => {
        closeModal();
        await updateBookingStatus(rowIndices, 'cancel');
    });
}

/**
 * Updates the status of one or more booking rows in the sheet.
 * @param {number[]} rowIndices An array of row indices to update.
 * @param {string} remarks The new remark to set (e.g., 'complete', 'cancel').
 */
export async function updateBookingStatus(rowIndices, remarks) {
    if (state.isSubmitting) return;
    state.isSubmitting = true;
    showToast('Updating booking status...', 'info');

    const bookingsToUpdate = rowIndices.map(rowIndex => state.allBookings.find(b => b.rowIndex === rowIndex)).filter(Boolean);

    // Optimistic UI update
    const originalAllBookings = [...state.allBookings];
    state.allBookings = state.allBookings.filter(b => !rowIndices.includes(b.rowIndex));
    displayBookings();
    updateNotifications();

    try {
        const data = bookingsToUpdate.map(booking => {
            const values = [
                booking.name || '', booking.id_no || '', booking.phone || '',
                booking.account_name || '', booking.account_type || '', booking.account_link || '',
                booking.departure || '', booking.destination || '', booking.departing_on || '',
                booking.pnr || '', remarks, booking.enddate || '', booking.endtime || '',
            ];
            return {
                range: `${CONFIG.BOOKING_SHEET_NAME}!A${booking.rowIndex}:M${booking.rowIndex}`,
                values: [values]
            };
        });

        if (data.length === 0) throw new Error("Could not find booking records to update.");

        await batchUpdateSheet(data);
        state.cache['bookingData'] = null;
        showToast('Booking updated successfully!', 'success');
    } catch (error) {
        state.allBookings = originalAllBookings;
        displayBookings();
        updateNotifications();
    } finally {
        state.isSubmitting = false;
    }
}

/**
 * Shows a detailed modal view for a booking group.
 * @param {string} rowIndicesStr A comma-separated string of row indices.
 */
function showBookingDetails(rowIndicesStr) {
    const rowIndices = rowIndicesStr.split(',').map(Number);
    const bookingGroup = state.filteredBookings.find(g => g.rowIndices.includes(rowIndices[0]));

    if (bookingGroup) {
        const passengerListHtml = bookingGroup.passengers.map(p => `<li><strong>${p.name}</strong> (ID: ${p.id_no || 'N/A'})</li>`).join('');
        const content = `
            <h3>Booking Request Details</h3>
            ${bookingGroup.pnr ? `<p><strong>PNR Code:</strong> ${bookingGroup.pnr}</p>` : ''}
            <div class="details-section">
                <div class="details-section-title">Passenger(s)</div>
                <ul style="list-style: none; padding-left: 0;">${passengerListHtml}</ul>
                <p><strong>Total Passengers:</strong> ${bookingGroup.passengers.length || 'N/A'}</p>
            </div>
             <hr style="border-color: rgba(255,255,255,0.2); margin: 1rem 0;">
            <p><strong>Phone:</strong> ${makeClickable(bookingGroup.phone)}</p>
            <p><strong>Account Name:</strong> ${bookingGroup.account_name || 'N/A'}</p>
            <p><strong>Account Type:</strong> ${bookingGroup.account_type || 'N/A'}</p>
            <p><strong>Account Link:</strong> ${makeClickable(bookingGroup.account_link) || 'N/A'}</a></p>
            <hr style="border-color: rgba(255,255,255,0.2); margin: 1rem 0;">
            <p><strong>Route:</strong> ${bookingGroup.departure || 'N/A'} → ${bookingGroup.destination || 'N/A'}</p>
            <p><strong>Travel Date:</strong> ${formatDateToDMMMY(bookingGroup.departing_on) || 'N/A'}</p>
            <p><strong>Booking Deadline:</strong> ${bookingGroup.enddate && bookingGroup.endtime ? `${formatDateToDMMMY(bookingGroup.enddate)} ${bookingGroup.endtime}` : 'N/A'}</p>
            <div class="form-actions" style="margin-top: 1.5rem;">
                <button class="btn btn-secondary" id="modalCloseBtn">Close</button>
            </div>
        `;
        openModal(content);
        document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    }
}

/**
 * Handles the submission of the new booking form.
 * @param {Event} e The form submission event.
 */
export async function handleNewBookingSubmit(e) {
    e.preventDefault();
    if (state.isSubmitting) return;

    const submitButton = e.target.querySelector('button[type="submit"]');

    const hour = document.getElementById('booking_end_time_hour').value;
    const minute = document.getElementById('booking_end_time_minute').value;
    const ampm = document.getElementById('booking_end_time_ampm').value;

    const sharedData = {
        phone: document.getElementById('booking_phone').value,
        pnr: document.getElementById('booking_pnr').value.toUpperCase(),
        account_name: document.getElementById('booking_account_name').value.toUpperCase(),
        account_type: document.getElementById('booking_account_type').value,
        account_link: document.getElementById('booking_account_link').value,
        departure: document.getElementById('booking_departure').value,
        destination: document.getElementById('booking_destination').value,
        departing_on: document.getElementById('booking_departing_on').value,
        enddate: document.getElementById('booking_end_date').value,
        endtime: hour && minute && ampm ? `${hour}:${String(minute).padStart(2, '0')} ${ampm}` : ''
    };

    const passengerForms = document.querySelectorAll('#booking-passenger-forms-container .passenger-form');
    const passengerData = Array.from(passengerForms).map(form => ({
        gender: form.querySelector('.booking-passenger-gender').value,
        name: form.querySelector('.booking-passenger-name').value.toUpperCase(),
        id_no: form.querySelector('.booking-passenger-id').value.toUpperCase()
    })).filter(p => p.name);

    if (passengerData.length === 0) {
        showToast('At least one passenger with a Name is required.', 'error');
        return;
    }
    if (!sharedData.departing_on || !sharedData.departure || !sharedData.destination) {
        showToast('Departure, Destination, and Travel Date are required.', 'error');
        return;
    }

    const confirmationMessage = `
        <h3>Confirm New Booking</h3>
        <p>Please review the details before submitting:</p>
        <ul style="list-style: none; padding-left: 0; margin: 1rem 0; text-align: left;">
            <li><strong>Client:</strong> ${passengerData.map(p => p.name).join(', ')}</li>
            <li><strong>Route:</strong> ${sharedData.departure.split('(')[0]} -> ${sharedData.destination.split('(')[0]}</li>
            <li><strong>Travel Date:</strong> ${sharedData.departing_on}</li>
            <li><strong>Total Passengers:</strong> ${passengerData.length}</li>
        </ul>
    `;

    showConfirmModal(confirmationMessage, async () => {
        state.isSubmitting = true;
        if (submitButton) submitButton.disabled = true;
        closeModal();

        try {
            const values = passengerData.map(passenger => [
                `${passenger.gender} ${passenger.name}`, passenger.id_no, sharedData.phone,
                sharedData.account_name, sharedData.account_type, sharedData.account_link,
                sharedData.departure, sharedData.destination, formatDateForSheet(sharedData.departing_on),
                sharedData.pnr, '', formatDateForSheet(sharedData.enddate), sharedData.endtime
            ]);

            await appendToSheet(`${CONFIG.BOOKING_SHEET_NAME}!A:M`, values);
            state.cache['bookingData'] = null;
            showToast(`Booking for ${passengerData.length} passenger(s) saved!`, 'success');
            hideNewBookingForm();
            await loadBookingData();
            updateNotifications();
        } finally {
            state.isSubmitting = false;
            if (submitButton) submitButton.disabled = false;
        }
    });
}


/**
 * Populates the route search dropdown with unique routes from active bookings.
 */
function populateBookingSearchOptions() {
    const select = document.getElementById('bookingSearchRoute');
    select.innerHTML = '<option value="">-- SEARCH BY ROUTE --</option>';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeBookings = state.allBookings.filter(b => {
        const hasNoAction = !b.remark || String(b.remark).trim() === '';
        const travelDate = parseSheetDate(b.departing_on);
        return hasNoAction && travelDate >= today;
    });

    const routes = [...new Set(activeBookings.map(b => `${b.departure || ''}→${b.destination || ''}`))];

    routes.sort().forEach(route => {
        const option = document.createElement('option');
        option.value = route;
        option.textContent = route.replace(/ \([^)]*\)/g, '');
        select.appendChild(option);
    });
}

/**
 * Performs a search for bookings based on the selected route.
 */
export function performBookingSearch() {
    const routeQuery = document.getElementById('bookingSearchRoute').value;
    if (!routeQuery) {
        showToast('Please select a route to search.', 'info');
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const searchResults = state.allBookings.filter(b => {
        const route = `${b.departure || ''}→${b.destination || ''}`;
        const hasNoAction = !b.remark || String(b.remark).trim() === '';
        const travelDate = parseSheetDate(b.departing_on);

        return hasNoAction && travelDate >= today && route === routeQuery;
    });

    displayBookings(searchResults);
}

/**
 * Clears the booking search filters and displays all active bookings.
 */
export function clearBookingSearch() {
    document.getElementById('bookingSearchRoute').value = '';
    displayBookings();
}

/**
 * Pre-fills the "Sell Ticket" form with data from a booking.
 * @param {string} rowIndicesStr A comma-separated string of row indices from the booking.
 */
export function sellTicketFromBooking(rowIndicesStr) {
    const rowIndices = rowIndicesStr.split(',').map(Number);
    const bookingGroup = state.filteredBookings.find(g => g.rowIndices.includes(rowIndices[0]));

    if (!bookingGroup) {
        showToast('Could not find booking details.', 'error');
        return;
    }

    state.bookingToUpdate = rowIndices;
    showView('sell');

    document.getElementById('booking_reference').value = bookingGroup.pnr || '';
    document.getElementById('phone').value = bookingGroup.phone || '';
    document.getElementById('account_name').value = bookingGroup.account_name || '';
    document.getElementById('account_type').value = bookingGroup.account_type || '';
    document.getElementById('account_link').value = bookingGroup.account_link || '';
    document.getElementById('departure').value = bookingGroup.departure || '';
    document.getElementById('destination').value = bookingGroup.destination || '';
    document.getElementById('departing_on').value = bookingGroup.departing_on || '';

    handleRouteValidation({
        target: document.getElementById('departure')
    });
    handleRouteValidation({
        target: document.getElementById('destination')
    });

    resetPassengerForms(); // Clears default
    document.getElementById('passenger-forms-container').innerHTML = ''; // Ensure it's empty

    bookingGroup.passengers.forEach(passenger => {
        const nameParts = passenger.name.split(' ');
        const gender = nameParts.length > 1 && ['MR', 'MS'].includes(nameParts[0].toUpperCase()) ? nameParts.shift() : 'MR';
        const name = nameParts.join(' ');
        addPassengerForm(name, passenger.id_no, gender);
    });

    showToast(`Form pre-filled for ${bookingGroup.passengers.length} passenger(s). Complete financial details.`, 'info');
}