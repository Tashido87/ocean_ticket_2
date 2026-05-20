/**
 * @fileoverview Manages all logic related to booking requests, including loading,
 * displaying, searching, and creating new bookings.
 */

import {
    state
} from './state.js';
import {
    getBookings,
    updateBooking,
    addBookings
} from './db.js';
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

const BOOKING_STATUS_LABELS = {
    active: 'Active',
    issued: 'Issued',
    cancelled: 'Cancelled',
    expired: 'Expired'
};

const PRIORITY_WEIGHT = {
    VIP: 0,
    Urgent: 1,
    Watch: 2,
    Normal: 3
};

/**
 * Loads booking data from Firestore.
 */
export async function loadBookingData() {
    try {
        const bookings = await getBookings();
        state.allBookings = bookings;
        await handleExpiredBookings();
        populateBookingSearchOptions();
        bindBookingFilters();
        displayBookings();
    } catch (error) {
        renderEmptyState('bookingTableContainer', 'fa-calendar-xmark', 'Failed to load bookings', 'Could not retrieve booking data. Please check permissions and try again.');
    }
}

function normalizeText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeBookingStatus(booking) {
    const status = normalizeText(booking.status);
    if (status) return status;

    const remark = normalizeText(booking.remark);
    if (remark === 'complete' || remark === 'issued' || remark === 'get ticket') return 'issued';
    if (remark === 'cancel' || remark === 'cancelled' || remark === 'canceled') return 'cancelled';
    if (remark === 'end' || remark === 'expired') return 'expired';
    return 'active';
}

function isActiveBooking(booking) {
    return normalizeBookingStatus(booking) === 'active';
}

function getBookingDeadline(booking) {
    if (booking.deadlineAt) {
        const parsed = new Date(booking.deadlineAt);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return parseDeadline(booking.enddate, booking.endtime);
}

function getDeadlineMeta(booking) {
    const deadline = getBookingDeadline(booking);
    if (!deadline) return { deadline: null, state: 'none', label: 'No deadline' };

    const diff = deadline.getTime() - Date.now();
    if (diff < 0) return { deadline, state: 'expired', label: 'Expired' };

    const minutes = Math.ceil(diff / 60000);
    if (minutes <= 24 * 60) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return {
            deadline,
            state: minutes <= 6 * 60 ? 'due-soon' : 'due-today',
            label: `${hours}h ${mins}m left`
        };
    }

    const days = Math.ceil(minutes / (24 * 60));
    return { deadline, state: 'future', label: `${days}d left` };
}

function getGroupKey(booking) {
    return booking.groupId || [
        booking.pnr,
        booking.departure,
        booking.destination,
        booking.departing_on,
        booking.phone,
        booking.account_name
    ].map(value => normalizeText(value)).join('|') || booking.id;
}

function groupBookings(bookings) {
    const grouped = bookings.reduce((acc, booking) => {
        const key = getGroupKey(booking);
        if (!acc[key]) {
            acc[key] = {
                ...booking,
                groupId: key,
                passengers: [],
                docIds: []
            };
        }
        acc[key].passengers.push({
            name: booking.name,
            id_no: booking.id_no,
            docId: booking.id
        });
        acc[key].docIds.push(booking.id);
        return acc;
    }, {});

    return Object.values(grouped).map(group => ({
        ...group,
        status: normalizeBookingStatus(group),
        priority: group.priority || 'Normal',
        deadlineMeta: getDeadlineMeta(group)
    }));
}

function routeKey(booking) {
    return `${booking.departure || ''}→${booking.destination || ''}`;
}

function compactPlace(value) {
    return String(value || '').replace(/\s*\([^)]*\)/g, '').trim();
}

function routeLabel(group) {
    return `${compactPlace(group.departure) || 'N/A'} → ${compactPlace(group.destination) || 'N/A'}`;
}

function statusBadge(status) {
    const label = BOOKING_STATUS_LABELS[status] || BOOKING_STATUS_LABELS.active;
    return `<span class="booking-status-badge ${status}">${label}</span>`;
}

function priorityBadge(priority) {
    const safePriority = priority || 'Normal';
    return `<span class="booking-priority-badge ${safePriority.toLowerCase()}">${safePriority}</span>`;
}

function deadlineBadge(group) {
    const meta = group.deadlineMeta || getDeadlineMeta(group);
    const detail = meta.deadline ? `${formatDateToDMMMY(group.enddate)} ${group.endtime || ''}`.trim() : '';
    return `
        <span class="booking-deadline-badge ${meta.state}">
            <i class="fa-solid fa-clock"></i>
            <span>${meta.label}</span>
        </span>
        ${detail ? `<div class="booking-meta-sub">${detail}</div>` : ''}
    `;
}

function getAllBookingGroups() {
    return groupBookings(state.allBookings || []);
}

function renderBookingDashboard(groups = getAllBookingGroups()) {
    const container = document.getElementById('bookingKpiGrid');
    if (!container) return;

    const active = groups.filter(g => g.status === 'active');
    const dueToday = active.filter(g => ['due-today', 'due-soon'].includes(g.deadlineMeta.state));
    const dueSoon = active.filter(g => g.deadlineMeta.state === 'due-soon');
    const expired = groups.filter(g => g.status === 'expired');
    const issued = groups.filter(g => g.status === 'issued');
    const noDeadline = active.filter(g => g.deadlineMeta.state === 'none');

    const cards = [
        { icon: 'fa-calendar-check', label: 'Active Bookings', value: active.length, tone: 'teal', hint: 'Open trips before issue' },
        { icon: 'fa-bell', label: 'Due Today', value: dueToday.length, tone: dueToday.length ? 'coral' : 'teal', hint: 'Deadline within 24 hours' },
        { icon: 'fa-hourglass-half', label: 'Due Soon', value: dueSoon.length, tone: dueSoon.length ? 'amber' : 'teal', hint: 'Less than 6 hours left' },
        { icon: 'fa-triangle-exclamation', label: 'Expired', value: expired.length, tone: expired.length ? 'coral' : 'navy', hint: 'Needs action or clean-up' },
        { icon: 'fa-ticket', label: 'Issued', value: issued.length, tone: 'navy', hint: 'Converted to ticket' },
        { icon: 'fa-calendar-minus', label: 'No Deadline', value: noDeadline.length, tone: noDeadline.length ? 'amber' : 'navy', hint: 'Missing follow-up time' }
    ];

    container.innerHTML = cards.map(card => `
        <div class="booking-kpi-card ${card.tone}">
            <span class="booking-kpi-icon"><i class="fa-solid ${card.icon}"></i></span>
            <div>
                <div class="booking-kpi-label">${card.label}</div>
                <div class="booking-kpi-value">${card.value}</div>
                <div class="booking-kpi-hint">${card.hint}</div>
            </div>
        </div>
    `).join('');
}

function groupMatchesFilters(group) {
    const textQuery = normalizeText(document.getElementById('bookingSearchText')?.value);
    const routeFilter = document.getElementById('bookingSearchRoute')?.value || '';
    const statusFilter = document.getElementById('bookingStatusFilter')?.value || 'active';
    const priorityFilter = document.getElementById('bookingPriorityFilter')?.value || '';

    if (routeFilter && routeKey(group) !== routeFilter) return false;
    if (priorityFilter && group.priority !== priorityFilter) return false;

    if (statusFilter === 'active' && group.status !== 'active') return false;
    if (statusFilter === 'issued' && group.status !== 'issued') return false;
    if (statusFilter === 'cancelled' && group.status !== 'cancelled') return false;
    if (statusFilter === 'expired' && group.status !== 'expired') return false;
    if (statusFilter === 'dueToday' && (group.status !== 'active' || !['due-today', 'due-soon'].includes(group.deadlineMeta.state))) return false;
    if (statusFilter === 'dueSoon' && (group.status !== 'active' || group.deadlineMeta.state !== 'due-soon')) return false;
    if (statusFilter === 'noDeadline' && (group.status !== 'active' || group.deadlineMeta.state !== 'none')) return false;

    if (textQuery) {
        const haystack = normalizeText([
            group.pnr,
            group.phone,
            group.account_name,
            group.account_type,
            group.departure,
            group.destination,
            group.notes,
            ...group.passengers.map(p => `${p.name} ${p.id_no || ''}`)
        ].join(' '));
        const terms = textQuery.split(' ').filter(Boolean);
        if (!terms.every(term => haystack.includes(term))) return false;
    }

    return true;
}

function sortBookingGroups(a, b) {
    const deadlineRank = { 'due-soon': 0, expired: 1, 'due-today': 2, none: 3, future: 4 };
    const aRank = deadlineRank[a.deadlineMeta.state] ?? 5;
    const bRank = deadlineRank[b.deadlineMeta.state] ?? 5;
    if (aRank !== bRank) return aRank - bRank;

    const aPriority = PRIORITY_WEIGHT[a.priority] ?? PRIORITY_WEIGHT.Normal;
    const bPriority = PRIORITY_WEIGHT[b.priority] ?? PRIORITY_WEIGHT.Normal;
    if (aPriority !== bPriority) return aPriority - bPriority;

    const aDeadline = a.deadlineMeta.deadline ? a.deadlineMeta.deadline.getTime() : Number.MAX_SAFE_INTEGER;
    const bDeadline = b.deadlineMeta.deadline ? b.deadlineMeta.deadline.getTime() : Number.MAX_SAFE_INTEGER;
    if (aDeadline !== bDeadline) return aDeadline - bDeadline;

    return parseSheetDate(a.departing_on) - parseSheetDate(b.departing_on);
}

function bindBookingFilters() {
    const ids = ['bookingSearchText', 'bookingSearchRoute', 'bookingStatusFilter', 'bookingPriorityFilter'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.dataset.bookingFilterBound === 'true') return;
        el.dataset.bookingFilterBound = 'true';
        el.addEventListener(id === 'bookingSearchText' ? 'input' : 'change', () => displayBookings());
    });
}

/**
 * Finds expired active bookings and marks them as expired while keeping them
 * visible through the Expired/All filters. The legacy remark field is preserved
 * for old reports, but the booking page now reads the explicit status field.
 */
async function handleExpiredBookings() {
    const now = new Date();
    const expiredBookings = [];

    state.allBookings.forEach(booking => {
        const deadline = getBookingDeadline(booking);

        if (isActiveBooking(booking) && deadline && deadline < now) {
            expiredBookings.push(booking);
        }
    });

    if (expiredBookings.length > 0) {
        console.log(`Found ${expiredBookings.length} expired bookings to update.`);
        try {
            for (const booking of expiredBookings) {
                await updateBooking(booking.id, {
                    status: 'expired',
                    remark: 'end',
                    expiredAt: new Date().toISOString()
                });
            }
            console.log('Successfully updated expired bookings.');
            const expiredIds = new Set(expiredBookings.map(b => b.id));
            state.allBookings = state.allBookings.map(b => expiredIds.has(b.id) ? {
                ...b,
                status: 'expired',
                remark: 'end',
                expiredAt: new Date().toISOString()
            } : b);
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

    const source = bookingsToDisplay || state.allBookings || [];
    const allGroups = groupBookings(source);
    renderBookingDashboard(getAllBookingGroups());

    const displayableGroups = bookingsToDisplay ? allGroups : allGroups.filter(groupMatchesFilters);
    displayableGroups.sort(sortBookingGroups);
    state.filteredBookings = displayableGroups;

    if (state.filteredBookings.length === 0) {
        renderEmptyState('bookingTableContainer', 'fa-calendar-check', 'No Bookings Found', 'No booking requests match the selected filters.');
        setupBookingPagination([]);
        return;
    }

    const table = document.createElement('table');
    table.className = 'booking-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Deadline</th>
                <th>Travel Date</th>
                <th>Client</th>
                <th>Route</th>
                <th>PNR</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Actions</th>
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
        const docIdsStr = group.docIds.join(',');
        const firstPassengerName = group.passengers[0] ? group.passengers[0].name : 'N/A';
        const passengerCount = group.passengers.length;
        const isUrgent = ['due-soon', 'expired'].includes(group.deadlineMeta.state);
        const isActive = group.status === 'active';

        const row = tbody.insertRow();
        if (isUrgent) {
            row.classList.add('deadline-warning');
        }

        row.innerHTML = `
            <td>${deadlineBadge(group)}</td>
            <td>${formatDateToDMMMY(group.departing_on) || ''}</td>
            <td>
                <div class="booking-client-cell">${firstPassengerName}${passengerCount > 1 ? ` (+${passengerCount - 1})` : ''}</div>
                <div class="booking-meta-sub">${group.phone || group.account_type || ''}</div>
            </td>
            <td>${routeLabel(group)}</td>
            <td>${group.pnr ? `<a href="#" class="clickable-pnr" data-pnr="${escapeHtml(group.pnr)}">${escapeHtml(group.pnr)}</a>` : 'N/A'}</td>
            <td>${statusBadge(group.status)}</td>
            <td>${priorityBadge(group.priority)}</td>
            <td>
                <div class="booking-action-row">
                    <button class="booking-action-btn primary" title="Issue / Sell Ticket" ${isActive ? '' : 'disabled'}><i class="fa-solid fa-ticket"></i> Sell</button>
                    <button class="booking-action-btn" title="Extend Deadline" ${isActive ? '' : 'disabled'}><i class="fa-solid fa-clock-rotate-left"></i></button>
                    <button class="booking-action-btn danger" title="Cancel Booking" ${isActive ? '' : 'disabled'}><i class="fa-solid fa-ban"></i></button>
                    <button class="booking-action-btn" title="View Details"><i class="fa-solid fa-eye"></i></button>
                </div>
            </td>
        `;
        row.querySelector('[title="Issue / Sell Ticket"]').addEventListener('click', () => sellTicketFromBooking(docIdsStr));
        row.querySelector('[title="Extend Deadline"]').addEventListener('click', () => openExtendDeadlineModal(docIdsStr));
        row.querySelector('[title="Cancel Booking"]').addEventListener('click', () => handleCancelBooking(docIdsStr));
        row.querySelector('[title="View Details"]').addEventListener('click', () => showBookingDetails(docIdsStr));
    });

    setupBookingPagination(state.filteredBookings);
}

/**
 * Handles the "Get Ticket" action for a booking.
 * @param {string} docIdsStr A comma-separated string of Firestore document IDs.
 */
function handleGetTicket(docIdsStr) {
    const docIds = docIdsStr.split(',');
    const bookingGroup = state.filteredBookings.find(g => g.docIds.includes(docIds[0]));
    const clientName = bookingGroup ? bookingGroup.passengers[0].name : 'this booking';
    const passengerCount = bookingGroup ? bookingGroup.passengers.length : 1;
    const message = `Are you sure you want to mark the booking for <strong>${clientName} ${passengerCount > 1 ? `and ${passengerCount - 1} other(s)` : ''}</strong> as issued?`;
    showConfirmModal(message, async () => {
        closeModal();
        await updateBookingStatus(docIds, 'complete');
    });
}

/**
 * Handles the "Cancel" action for a booking.
 * @param {string} docIdsStr A comma-separated string of Firestore document IDs.
 */
function handleCancelBooking(docIdsStr) {
    const docIds = docIdsStr.split(',');
    const bookingGroup = state.filteredBookings.find(g => g.docIds.includes(docIds[0]));
    const clientName = bookingGroup ? bookingGroup.passengers[0].name : 'this booking';
    const passengerCount = bookingGroup ? bookingGroup.passengers.length : 1;
    const message = `Are you sure you want to <strong>CANCEL</strong> the booking for <strong>${clientName} ${passengerCount > 1 ? `and ${passengerCount - 1} other(s)` : ''}</strong>?`;
    showConfirmModal(message, async () => {
        closeModal();
        await updateBookingStatus(docIds, 'cancel');
    });
}

/**
 * Updates the status of one or more booking documents in Firestore.
 * @param {string[]} docIds An array of Firestore document IDs to update.
 * @param {string} remarks The new remark to set (e.g., 'complete', 'cancel').
 */
export async function updateBookingStatus(docIds, remarks) {
    if (state.isSubmitting) return;
    state.isSubmitting = true;
    showToast('Updating booking status...', 'info');

    const statusMap = {
        complete: 'issued',
        issued: 'issued',
        cancel: 'cancelled',
        cancelled: 'cancelled',
        end: 'expired',
        expired: 'expired'
    };
    const nextStatus = statusMap[remarks] || remarks || 'active';
    const timestampField = nextStatus === 'issued' ? 'issuedAt' : nextStatus === 'cancelled' ? 'cancelledAt' : nextStatus === 'expired' ? 'expiredAt' : 'updatedAt';
    const bookingsToUpdate = docIds.map(id => state.allBookings.find(b => b.id === id)).filter(Boolean);
    const originalAllBookings = [...state.allBookings];
    const nowIso = new Date().toISOString();
    state.allBookings = state.allBookings.map(b => docIds.includes(b.id) ? {
        ...b,
        status: nextStatus,
        remark: remarks,
        [timestampField]: nowIso
    } : b);
    displayBookings();
    updateNotifications();

    try {
        for (const booking of bookingsToUpdate) {
            await updateBooking(booking.id, {
                status: nextStatus,
                remark: remarks,
                [timestampField]: nowIso
            });
        }
        showToast('Booking updated successfully!', 'success');
    } catch (error) {
        state.allBookings = originalAllBookings;
        displayBookings();
        updateNotifications();
    } finally {
        state.isSubmitting = false;
    }
}

function toTimeParts(timeString) {
    const match = String(timeString || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
    return {
        hour: match ? String(parseInt(match[1], 10)).padStart(2, '0') : '09',
        minute: match ? String(parseInt(match[2], 10)).padStart(2, '0') : '00',
        ampm: match ? match[3].toUpperCase() : 'AM'
    };
}

function openExtendDeadlineModal(docIdsStr) {
    const docIds = docIdsStr.split(',');
    const bookingGroup = state.filteredBookings.find(g => g.docIds.includes(docIds[0]));
    if (!bookingGroup) return;

    const timeParts = toTimeParts(bookingGroup.endtime);
    const hourOptions = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
        .map(hour => `<option value="${hour}" ${hour === timeParts.hour ? 'selected' : ''}>${hour}</option>`).join('');
    const minuteOptions = ['00', '15', '30', '45']
        .map(minute => `<option value="${minute}" ${minute === timeParts.minute ? 'selected' : ''}>${minute}</option>`).join('');

    openModal(`
        <h3><i class="fa-solid fa-clock-rotate-left"></i> Extend Booking Deadline</h3>
        <p class="modal-subtitle">Update the hold deadline for ${bookingGroup.passengers[0]?.name || 'this booking'}.</p>
        <div class="form-grid">
            <div class="form-group">
                <label for="extendBookingDate">New Deadline Date</label>
                <input type="text" id="extendBookingDate" value="${bookingGroup.enddate || ''}" placeholder="DD/MM/YYYY">
            </div>
            <div class="form-group">
                <label>New Deadline Time</label>
                <div class="time-picker-group">
                    <select id="extendBookingHour">${hourOptions}</select>
                    <select id="extendBookingMinute">${minuteOptions}</select>
                    <select id="extendBookingAmpm">
                        <option ${timeParts.ampm === 'AM' ? 'selected' : ''}>AM</option>
                        <option ${timeParts.ampm === 'PM' ? 'selected' : ''}>PM</option>
                    </select>
                </div>
            </div>
            <div class="form-group form-group-wide">
                <label for="extendBookingNotes">Reason / Notes</label>
                <textarea id="extendBookingNotes" rows="3" placeholder="Why the deadline changed">${bookingGroup.notes || ''}</textarea>
            </div>
        </div>
        <div class="form-actions" style="margin-top: 1.5rem;">
            <button class="btn btn-secondary" id="cancelExtendBookingBtn">Cancel</button>
            <button class="btn btn-primary" id="saveExtendBookingBtn"><i class="fa-solid fa-check"></i> Save Deadline</button>
        </div>
    `);

    document.getElementById('cancelExtendBookingBtn').addEventListener('click', closeModal);
    document.getElementById('saveExtendBookingBtn').addEventListener('click', async () => {
        const enddate = document.getElementById('extendBookingDate').value;
        const endtime = `${document.getElementById('extendBookingHour').value}:${document.getElementById('extendBookingMinute').value} ${document.getElementById('extendBookingAmpm').value}`;
        const deadline = parseDeadline(enddate, endtime);
        if (!deadline) {
            showToast('Please enter a valid deadline date and time.', 'error');
            return;
        }

        const notes = document.getElementById('extendBookingNotes').value;
        closeModal();
        try {
            await Promise.all(docIds.map(id => updateBooking(id, {
                enddate,
                endtime,
                deadlineAt: deadline.toISOString(),
                notes,
                status: 'active',
                remark: ''
            })));
            showToast('Booking deadline updated.', 'success');
            // Data and UI will update automatically via real-time listeners
        } catch (error) {
            console.error('Failed to extend booking deadline:', error);
            showToast('Could not update booking deadline.', 'error');
        }
    });
}

/**
 * Shows a detailed modal view for a booking group.
 * @param {string} docIdsStr A comma-separated string of Firestore document IDs.
 */
function showBookingDetails(docIdsStr) {
    const docIds = docIdsStr.split(',');
    const bookingGroup = state.filteredBookings.find(g => g.docIds.includes(docIds[0]));

    if (bookingGroup) {
        const passengerListHtml = bookingGroup.passengers.map(p => `<li><strong>${p.name}</strong> (ID: ${p.id_no || 'N/A'})</li>`).join('');
        const content = `
            <h3>Booking Request Details</h3>
            ${bookingGroup.pnr ? `<p><strong>PNR Code:</strong> ${bookingGroup.pnr}</p>` : ''}
            <p><strong>Status:</strong> ${BOOKING_STATUS_LABELS[bookingGroup.status] || 'Active'}</p>
            <p><strong>Priority:</strong> ${bookingGroup.priority || 'Normal'}</p>
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
            <p><strong>Deadline Status:</strong> ${bookingGroup.deadlineMeta?.label || 'N/A'}</p>
            <p><strong>Notes:</strong> ${bookingGroup.notes || 'N/A'}</p>
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
        endtime: hour && minute && ampm ? `${hour}:${String(minute).padStart(2, '0')} ${ampm}` : '',
        priority: document.getElementById('booking_priority').value || 'Normal',
        notes: document.getElementById('booking_notes').value.trim()
    };

    const passengerForms = document.querySelectorAll('#booking-passenger-forms-container .passenger-form');
    const passengerData = Array.from(passengerForms).map(form => ({
        gender: form.querySelector('.booking-passenger-gender').value,
        name: form.querySelector('.booking-passenger-name').value.toUpperCase(),
        nrc_no: form.querySelector('.booking-passenger-nrc').value.toUpperCase(),
        passport_no: form.querySelector('.booking-passenger-passport').value.toUpperCase()
    })).filter(p => p.name);

    if (passengerData.length === 0) {
        showToast('At least one passenger with a Name is required.', 'error');
        return;
    }
    if (!sharedData.departing_on || !sharedData.departure || !sharedData.destination) {
        showToast('Departure, Destination, and Travel Date are required.', 'error');
        return;
    }

    const deadline = sharedData.enddate && sharedData.endtime ? parseDeadline(sharedData.enddate, sharedData.endtime) : null;
    if (sharedData.enddate && sharedData.endtime && !deadline) {
        showToast('Please enter a valid booking deadline date and time.', 'error');
        return;
    }
    if (deadline && deadline.getTime() < Date.now()) {
        showToast('Booking deadline cannot be in the past.', 'error');
        return;
    }

    const activeBookings = (state.allBookings || []).filter(isActiveBooking);
    const duplicateByPnr = sharedData.pnr && activeBookings.some(b => normalizeText(b.pnr) === normalizeText(sharedData.pnr));
    const duplicateByTrip = activeBookings.some(b => {
        const sameRoute = normalizeText(b.departure) === normalizeText(sharedData.departure) && normalizeText(b.destination) === normalizeText(sharedData.destination);
        const sameDate = normalizeText(b.departing_on) === normalizeText(sharedData.departing_on);
        const passengerNames = passengerData.map(p => normalizeText(p.name));
        return sameRoute && sameDate && passengerNames.includes(normalizeText(String(b.name || '').replace(/^(MR|MS)\s+/i, '')));
    });

    if ((duplicateByPnr || duplicateByTrip) && !window.confirm('A similar active booking already exists. Continue saving this booking?')) {
        return;
    }

    const confirmationMessage = `
        <h3>Confirm New Booking</h3>
        <p>Please review the details before submitting:</p>
        <ul style="list-style: none; padding-left: 0; margin: 1rem 0; text-align: left;">
            <li><strong>Client:</strong> ${passengerData.map(p => p.name).join(', ')}</li>
            <li><strong>Route:</strong> ${sharedData.departure.split('(')[0]} -> ${sharedData.destination.split('(')[0]}</li>
            <li><strong>Travel Date:</strong> ${sharedData.departing_on}</li>
            <li><strong>Deadline:</strong> ${sharedData.enddate && sharedData.endtime ? `${sharedData.enddate} ${sharedData.endtime}` : 'No deadline'}</li>
            <li><strong>Priority:</strong> ${sharedData.priority}</li>
            <li><strong>Total Passengers:</strong> ${passengerData.length}</li>
        </ul>
    `;

    showConfirmModal(confirmationMessage, async () => {
        state.isSubmitting = true;
        if (submitButton) submitButton.disabled = true;
        closeModal();

        try {
            const groupId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `booking-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const bookingObjects = passengerData.map(passenger => ({
                groupId,
                name: `${passenger.gender} ${passenger.name}`,
                id_no: passenger.id_no,
                phone: sharedData.phone,
                account_name: sharedData.account_name,
                account_type: sharedData.account_type,
                account_link: sharedData.account_link,
                departure: sharedData.departure,
                destination: sharedData.destination,
                departing_on: sharedData.departing_on,
                pnr: sharedData.pnr,
                status: 'active',
                remark: '',
                enddate: sharedData.enddate,
                endtime: sharedData.endtime,
                deadlineAt: deadline ? deadline.toISOString() : '',
                priority: sharedData.priority,
                notes: sharedData.notes
            }));

            await addBookings(bookingObjects);
            showToast(`Booking for ${passengerData.length} passenger(s) saved!`, 'success');
            hideNewBookingForm();
            // Data and UI will update automatically via real-time listeners
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
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = '<option value="">All routes</option>';

    const activeBookings = state.allBookings.filter(isActiveBooking);
    const routes = [...new Set(activeBookings.map(routeKey).filter(route => route !== '→'))];

    routes.sort().forEach(route => {
        const option = document.createElement('option');
        option.value = route;
        option.textContent = route.replace(/ \([^)]*\)/g, '');
        select.appendChild(option);
    });
    if (previousValue && routes.includes(previousValue)) select.value = previousValue;
}

/**
 * Applies booking search and filter controls.
 */
export function performBookingSearch() {
    displayBookings();
}

/**
 * Clears the booking search filters and displays all active bookings.
 */
export function clearBookingSearch() {
    const text = document.getElementById('bookingSearchText');
    const route = document.getElementById('bookingSearchRoute');
    const status = document.getElementById('bookingStatusFilter');
    const priority = document.getElementById('bookingPriorityFilter');
    if (text) text.value = '';
    if (route) route.value = '';
    if (status) status.value = 'active';
    if (priority) priority.value = '';
    displayBookings();
}

/**
 * Pre-fills the "Sell Ticket" form with data from a booking.
 * @param {string} docIdsStr A comma-separated string of Firestore document IDs from the booking.
 */
export function sellTicketFromBooking(docIdsStr) {
    const docIds = docIdsStr.split(',');
    const bookingGroup = state.filteredBookings.find(g => g.docIds.includes(docIds[0]));

    if (!bookingGroup) {
        showToast('Could not find booking details.', 'error');
        return;
    }
    if (bookingGroup.status !== 'active') {
        showToast('Only active bookings can be converted to a ticket.', 'error');
        return;
    }

    state.bookingToUpdate = docIds;
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
