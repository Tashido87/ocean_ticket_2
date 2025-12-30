/**
 * @fileoverview Manages all UI interactions, DOM updates, and component rendering.
 */

import { CITIES, CONFIG } from './config.js';
import { state } from './state.js';
import { parseSheetDate, formatDateToDMMMY, makeClickable, parseDeadline } from './utils.js';
import { renderClientsView } from './clients.js';
import { clearManageResults } from './manage.js';
import { displaySettlements, hideNewSettlementForm, updateSettlementDashboard } from './settlement.js';
import { showToast } from './utils.js';
import { displayTickets } from './tickets.js';
import { renderBookingPage } from './booking.js';

/**
 * Normalizes passenger names for grouped dashboard widgets.
 * - Removes helper suffixes like "(Fees)" so the UI shows real client names.
 */
function normalizePassengerName(name) {
    const raw = String(name || '').trim();
    if (!raw) return 'N/A';
    return raw.replace(/\s*\(fees\)\s*$/i, '').trim();
}

/**
 * Identifies special rows that represent fee entries (not real passengers).
 */
function isFeeEntryRow(ticket) {
    const name = String(ticket?.name || '');
    const remarks = String(ticket?.remarks || '').toLowerCase();
    return /\(fees\)\s*$/i.test(name) || remarks.includes('fee entry');
}


/**
 * Shows a specific view and hides others.
 * @param {string} viewName The name of the view to show (e.g., 'home', 'clients').
 */
export function showView(viewName) {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');

    navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewName));
    views.forEach(view => view.classList.toggle('active', view.id === `${viewName}-view`));

    // View-specific cleanup and setup
    if (viewName === 'sell') {
        document.getElementById('sellForm').reset();
        resetPassengerForms();
        populateFlightLocations();
        updateToggleLabels();
    } else {
        state.bookingToUpdate = null;
    }
    if (viewName === 'booking') {
        hideNewBookingForm();
    }
    if (viewName === 'settle') {
        hideNewSettlementForm();
        displaySettlements();
        updateSettlementDashboard();
    }
    if (viewName === 'clients') {
        renderClientsView();
    }
    if (viewName === 'manage') {
        clearManageResults();
    }
    
    // Services View Setup
    if (viewName === 'services') {
        const dateInput = document.getElementById('invoice_date');
        // Requirement (8): Auto-set today's date if empty
        if (dateInput && !dateInput.value) {
            const today = new Date();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const yyyy = today.getFullYear();
            dateInput.value = `${mm}/${dd}/${yyyy}`;
        }
    }
}

/**
 * Opens the main modal with specified content.
 * @param {string} content The HTML content to display in the modal.
 * @param {string} [sizeClass=''] An optional class for sizing (e.g., 'large-modal').
 */
export function openModal(content, sizeClass = '') {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = content;
    const modalContent = modal.querySelector('.modal-content');
    modalContent.className = 'modal-content glass-card'; // Reset classes
    if (sizeClass) {
        modalContent.classList.add(sizeClass);
    }
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Closes the main modal.
 */
export function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.remove('show');
    document.getElementById('modalBody').innerHTML = '';
    document.body.classList.remove('modal-open');
}

/**
 * Shows a confirmation modal.
 * @param {string} message The message to display.
 * @param {Function} onConfirm The callback function to execute on confirmation.
 */
export function showConfirmModal(message, onConfirm) {
    const content = `
        <div style="text-align: center;">
            <div style="font-size: 1.1rem; margin-bottom: 2rem;">${message}</div>
            <div class="form-actions">
                <button id="confirmCancelBtn" class="btn btn-secondary">Cancel</button>
                <button id="confirmActionBtn" class="btn btn-primary">Confirm</button>
            </div>
        </div>
    `;
    openModal(content, 'small-modal');
    document.getElementById('confirmActionBtn').onclick = onConfirm;
    document.getElementById('confirmCancelBtn').onclick = closeModal;
}

/**
 * Shows a modal to choose between Separate or Combined invoice generation.
 * @param {Function} onConfirm Callback receiving 'separate' or 'combined'.
 */
export function showInvoiceOptionModal(onConfirm) {
    const content = `
        <div style="text-align: center;">
            <div style="font-size: 1.1rem; margin-bottom: 2rem;">
                This PNR contains multiple passengers with the same route. <br>
                How would you like to generate the document?
            </div>
            <div class="form-actions" style="justify-content: center; gap: 15px;">
                <button id="invoiceOptionSeparate" class="btn btn-secondary">
                    <i class="fa-solid fa-layer-group"></i> Separate (Individual)
                </button>
                <button id="invoiceOptionCombined" class="btn btn-primary">
                    <i class="fa-solid fa-file-invoice"></i> Single (Combined)
                </button>
            </div>
        </div>
    `;
    openModal(content, 'small-modal');

    document.getElementById('invoiceOptionSeparate').onclick = () => {
        closeModal();
        onConfirm('separate');
    };

    document.getElementById('invoiceOptionCombined').onclick = () => {
        closeModal();
        onConfirm('combined');
    };
}


/**
 * Initializes all datepicker instances on the page.
 */
export function initializeDatepickers() {
    const defaultOptions = {
        format: 'mm/dd/yyyy',
        autohide: true,
        todayHighlight: true
    };
    const settlementOptions = {
        format: 'dd-M-yyyy',
        autohide: true,
        todayHighlight: true
    };
    // Added 'hotel-arrival' and 'hotel-departure' to the list below
    const allDatePickers = ['searchStartDate', 'searchEndDate', 'searchTravelDate', 'booking_departing_on', 'exportStartDate', 'exportEndDate', 'issued_date', 'departing_on', 'paid_date', 'booking_end_date', 'update_departing_on', 'update_paid_date', 'invoice_date', 'hotel-arrival', 'hotel-departure'];
    
    allDatePickers.forEach(id => {
        const el = document.getElementById(id);
        if (el) new Datepicker(el, defaultOptions);
    });

    const settlementDatePicker = document.getElementById('settlement_date');
    if (settlementDatePicker) new Datepicker(settlementDatePicker, settlementOptions);
}

/**
 * Populates the time picker dropdowns for booking end time.
 */
export function initializeTimePicker() {
    const hourSelect = document.getElementById('booking_end_time_hour');
    const minuteSelect = document.getElementById('booking_end_time_minute');

    for (let i = 1; i <= 12; i++) {
        hourSelect.add(new Option(String(i).padStart(2, '0'), i));
    }
    for (let i = 0; i < 60; i += 5) {
        minuteSelect.add(new Option(String(i).padStart(2, '0'), i));
    }
}


/**
 * Populates a select dropdown with city options.
 * @param {HTMLSelectElement} selectElement The select element to populate.
 * @param {string[]} locations An array of location strings.
 */
function populateCitySelect(selectElement, locations) {
    const firstOption = selectElement.options[0];
    selectElement.innerHTML = '';
    if (firstOption && firstOption.disabled) {
        selectElement.appendChild(firstOption);
    }

    locations.forEach(location => {
        const match = location.match(/(.+) \((.+)\)/);
        let text, value;
        if (match) {
            text = `${match[2]} - ${match[1]}`;
            value = location;
        } else {
            text = location;
            value = location;
        }
        selectElement.add(new Option(text, value));
    });
}

/**
 * Initializes all city dropdowns with a comprehensive list of locations.
 */
export function initializeCityDropdowns() {
    const allLocations = [...new Set([...CITIES.DOMESTIC, ...CITIES.INTERNATIONAL])].sort();

    const dropdownsToPopulate = [
        document.getElementById('searchDeparture'),
        document.getElementById('searchDestination'),
        document.getElementById('booking_departure'),
        document.getElementById('booking_destination')
    ];

    dropdownsToPopulate.forEach(dropdown => {
        if (dropdown) {
            populateCitySelect(dropdown, allLocations);
        }
    });

    populateFlightLocations();
}

/**
 * Populates the flight location dropdowns based on the flight type (Domestic/International).
 */
export function populateFlightLocations() {
    const flightTypeToggle = document.getElementById('flightTypeToggle');
    const isDomestic = !flightTypeToggle.checked;
    const locations = isDomestic ? CITIES.DOMESTIC : CITIES.INTERNATIONAL;

    const departureSelect = document.getElementById('departure');
    const destinationSelect = document.getElementById('destination');

    populateCitySelect(departureSelect, locations.sort());
    populateCitySelect(destinationSelect, locations.sort());
}

/**
 * Updates the labels for the Domestic/International toggle switch.
 */
export function updateToggleLabels() {
    const flightTypeToggle = document.getElementById('flightTypeToggle');
    const domesticLabel = document.getElementById('domestic-label');
    const internationalLabel = document.getElementById('international-label');
    if (flightTypeToggle.checked) {
        internationalLabel.classList.add('active');
        domesticLabel.classList.remove('active');
    } else {
        domesticLabel.classList.add('active');
        internationalLabel.classList.remove('active');
    }
}

/**
 * Dynamically updates countdown timers in notifications.
 */
export function updateDynamicTimes() {
    // Kept for modal or other views that might still use this class,
    // though the new simplified dashboard notifications don't use the timer directly.
    const timeElements = document.querySelectorAll('.dynamic-time');
    timeElements.forEach(el => {
        const deadline = parseInt(el.dataset.deadline, 10);
        if (isNaN(deadline)) return;

        const now = Date.now();
        const timeLeftMs = deadline - now;

        if (timeLeftMs <= 0) {
            el.closest('.notification-item')?.remove();
        } else {
            const timeLeftMinutes = Math.round(timeLeftMs / 60000);
            const hours = Math.floor(timeLeftMinutes / 60);
            const minutes = timeLeftMinutes % 60;
            el.textContent = `~${hours}h ${minutes}m remaining`;
        }
    });
}

/**
 * Updates the notification panel with a simplified list of Unpaid PNRs.
 * Format: "Unpaid PNR [PNR] - [Client Name]" | Amount | Icon
 */
export function updateNotifications() {
    const notificationList = document.getElementById('notification-list');
    const notificationTitleLink = document.getElementById('notification-title-link');
    if (!notificationList || !notificationTitleLink) return;

    const header = notificationTitleLink.querySelector('h3');
    notificationList.innerHTML = '';

    // --- Collect Unpaid Tickets Only (Simplified) ---
    const unpaidGroups = {};

    state.allTickets.forEach(t => {
        if (t.paid) return;
        const lowerRemarks = String(t.remarks || '').toLowerCase();
        if (lowerRemarks.includes('cancel') || lowerRemarks.includes('refund')) return;

        const pnr = (t.booking_reference || 'N/A').toUpperCase();
        if (!unpaidGroups[pnr]) {
            unpaidGroups[pnr] = { pnr, passengers: [], totalDue: 0 };
        }

        const amt = (t.net_amount || 0) + (t.extra_fare || 0) + (t.date_change || 0);
        unpaidGroups[pnr].totalDue += amt;

        // [FIXED] Always try to add the name, even for fee rows, so we don't get "Unknown"
        // normalizePassengerName removes "(Fees)" so it looks clean.
        if (t.name) {
            const cleanName = normalizePassengerName(t.name);
            // Avoid duplicates
            if (!unpaidGroups[pnr].passengers.includes(cleanName)) {
                unpaidGroups[pnr].passengers.push(cleanName);
            }
        }
    });

    const notifications = Object.values(unpaidGroups);
    const totalCount = notifications.length;

    if (totalCount > 0) {
        // Limit to 6 items for the dashboard
        notifications.slice(0, 6).forEach(g => {
            // "Unpaid PNR [PNR] - [Client Name]"
            const clientName = g.passengers[0] || 'Unknown';
            const paxCount = g.passengers.length;
            const extraPax = paxCount > 1 ? ` (+${paxCount - 1})` : '';
            const amount = Math.round(g.totalDue).toLocaleString();

            const html = `
                <div class="simple-item-row" data-open-pnr="${g.pnr}">
                    <div class="simple-item-content">
                        <span class="simple-text-main">Unpaid PNR ${g.pnr} - ${clientName}${extraPax}</span>
                        <span class="simple-text-sub">Amount: ${amount} MMK</span>
                    </div>
                    <i class="fa-solid fa-circle-info simple-detail-icon" title="View Detail"></i>
                </div>
            `;
            notificationList.insertAdjacentHTML('beforeend', html);
        });

        // Add "View All" if there are many
        if (totalCount > 6) {
             notificationList.insertAdjacentHTML('beforeend', `
                <div class="simple-item-row" onclick="import('./ui.js').then(m=>m.showNotificationModal())" style="justify-content:center; color:var(--primary-accent);">
                    View all (${totalCount})
                </div>
            `);
        }

        // Attach click events to open manage view
        notificationList.querySelectorAll('[data-open-pnr]').forEach(el => {
            el.addEventListener('click', async () => {
                const pnr = el.dataset.openPnr;
                // Dynamically import manage logic
                const { findTicketForManage } = await import('./manage.js');
                showView('manage');
                findTicketForManage(pnr);
            });
        });

        header.innerHTML = `<i class="fa-solid fa-bell"></i> Notifications <span class="notification-count">${totalCount}</span>`;
        notificationTitleLink.classList.add('active');
        notificationTitleLink.onclick = (e) => {
            e.preventDefault();
            showNotificationModal();
        };

    } else {
        notificationList.innerHTML = '<div class="notification-item empty"><i class="fa-solid fa-check-circle"></i> No unpaid tickets.</div>';
        header.innerHTML = `<i class="fa-solid fa-bell"></i> Notifications`;
        notificationTitleLink.classList.remove('active');
        notificationTitleLink.onclick = (e) => e.preventDefault();
    }
}


/**
 * Renders the "Upcoming PNR" panel on the dashboard.
 * Strict Rule: Only show PNRs for "Tomorrow".
 */
export function updateUpcomingPnrs() {
    const list = document.getElementById('upcoming-pnr-list');
    const hint = document.querySelector('#upcoming-pnr-box .panel-hint');
    if (!list) return;

    // 1. Calculate Tomorrow and the Day After Tomorrow (normalized to midnight)
    const today = new Date();

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);
    dayAfter.setHours(0, 0, 0, 0);

    // Format text for display (e.g., "Dec 20")
    const dateOptions = { month: 'short', day: 'numeric' };
    const tomorrowStr = tomorrow.toLocaleDateString('en-US', dateOptions);
    const dayAfterStr = dayAfter.toLocaleDateString('en-US', dateOptions);

    // 2. Filter & Group Tickets (PNR) for both days
    const tomorrowGroups = {};
    const dayAfterGroups = {};

    function addToGroup(groups, t) {
        const pnr = (t.booking_reference || 'N/A').toUpperCase();
        if (!groups[pnr]) groups[pnr] = { pnr, passengers: [], route: '' };

        // Add passenger name (excluding fees)
        if (!isFeeEntryRow(t) && t.name) {
            groups[pnr].passengers.push(normalizePassengerName(t.name));
        }

        // Set route if available
        if (!groups[pnr].route && t.departure && t.destination) {
            groups[pnr].route = `${t.departure.split(' ')[0]} → ${t.destination.split(' ')[0]}`;
        }
    }

    state.allTickets.forEach(t => {
        const lowerRemarks = String(t.remarks || '').toLowerCase();
        if (lowerRemarks.includes('cancel') || lowerRemarks.includes('refund')) return;

        const travelDate = parseSheetDate(t.departing_on);
        if (!travelDate || isNaN(travelDate.getTime())) return;
        travelDate.setHours(0, 0, 0, 0);

        if (travelDate.getTime() === tomorrow.getTime()) {
            addToGroup(tomorrowGroups, t);
        } else if (travelDate.getTime() === dayAfter.getTime()) {
            addToGroup(dayAfterGroups, t);
        }
    });

    const upcomingTomorrow = Object.values(tomorrowGroups);
    const upcomingDayAfter = Object.values(dayAfterGroups);

    // Update the hint text on the dashboard card (total for two days)
    const total = upcomingTomorrow.length + upcomingDayAfter.length;
    if (hint) hint.textContent = `Next 2 Days (${total})`;

    list.innerHTML = '';

    // If both empty, keep the old "empty" style
    if (total === 0) {
        list.innerHTML = `
            <div class="notification-item empty">
                <i class="fa-solid fa-calendar-check"></i>
                <span>No flights for tomorrow or the day after tomorrow.</span>
            </div>`;
        return;
    }

    function renderDaySection(dateStr, groups) {
        if (groups.length === 0) {
            list.insertAdjacentHTML('beforeend', `
                <div class="notification-item empty">
                    <i class="fa-solid fa-calendar-check"></i>
                    <span>No flights for ${dateStr}.</span>
                </div>
            `);
            return;
        }

        groups.forEach(g => {
            const clientName = g.passengers[0] || 'Unknown';
            const paxCount = g.passengers.length;
            const extraPax = paxCount > 1 ? ` (+${paxCount - 1})` : '';
            const route = g.route || 'Route N/A';

            const html = `
                <div class="simple-item-row upcoming-row">
                    <div class="simple-item-content">
                        <span class="simple-text-main">${dateStr} • ${clientName}${extraPax}</span>
                        <span class="simple-text-sub">PNR: <strong>${g.pnr}</strong> • ${route}</span>
                    </div>
                    <i class="fa-solid fa-circle-info simple-detail-icon" data-open-pnr="${g.pnr}" title="View travel schedule" aria-label="Open details"></i>
                </div>
            `;
            list.insertAdjacentHTML('beforeend', html);
        });
    }

    // 3. Render tomorrow first
    renderDaySection(tomorrowStr, upcomingTomorrow);

    // 4. Separator + day after tomorrow
    list.insertAdjacentHTML('beforeend', `
        <hr style="margin: 10px 0; opacity: 0.3;" />
    `);

    renderDaySection(dayAfterStr, upcomingDayAfter);

    // Attach click events ONLY to the details icon
    list.querySelectorAll('.simple-detail-icon[data-open-pnr]').forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const pnr = icon.getAttribute('data-open-pnr');
            openPnrScheduleModal(pnr);
        });
    });
}
/**
 * Opens a modal showing the full list of upcoming PNRs (same definition as the dashboard widget).
 * Includes client names alongside the PNR and quick access to Manage Ticket.
 */
function showUpcomingPnrsModal() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const windowDays = 14;
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + windowDays);

    /** @type {Record<string, {pnr:string, travelDate:Date, departure:string, destination:string, pax:number, paidPax:number, unpaidPax:number, totalAmount:number, amountDue:number, passengers:Set<string>}>} */
    const groups = {};

    state.allTickets.forEach(t => {
        const lowerRemarks = String(t.remarks || '').toLowerCase();
        if (lowerRemarks.includes('cancel') || lowerRemarks.includes('refund')) return;

        const travelDate = parseSheetDate(t.departing_on);
        if (isNaN(travelDate.getTime()) || travelDate.getTime() === 0) return;
        travelDate.setHours(0, 0, 0, 0);
        if (travelDate < today || travelDate > windowEnd) return;

        const pnr = (t.booking_reference || 'N/A').toUpperCase();
        const dep = t.departure || '';
        const dest = t.destination || '';
        const key = `${pnr}|${travelDate.getTime()}|${dep}|${dest}`;

        if (!groups[key]) {
            groups[key] = {
                pnr,
                travelDate,
                departure: dep,
                destination: dest,
                pax: 0,
                paidPax: 0,
                unpaidPax: 0,
                totalAmount: 0,
                amountDue: 0,
                passengers: new Set()
            };
        }

        const amt = (t.net_amount || 0) + (t.extra_fare || 0) + (t.date_change || 0);
        groups[key].totalAmount += amt;
        if (!t.paid) groups[key].amountDue += amt;

        if (!isFeeEntryRow(t)) {
            groups[key].pax += 1;
            groups[key].passengers.add(normalizePassengerName(t.name) || 'N/A');
            if (t.paid) groups[key].paidPax += 1;
            else groups[key].unpaidPax += 1;
        }
    });

    const upcoming = Object.values(groups).sort((a, b) => a.travelDate.getTime() - b.travelDate.getTime());

    let modalContent = `
        <div class="notification-modal-header">
            <h2><i class="fa-solid fa-plane-up"></i> Upcoming PNR Center</h2>
            <div class="notification-modal-subtitle">Next ${windowDays} days • ${upcoming.length}</div>
        </div>
        <div class="notification-modal-list">
    `;

    if (!upcoming.length) {
        modalContent += `
            <div class="notification-item empty" style="margin-top: 0.75rem;">
                <i class="fa-solid fa-calendar-check" aria-hidden="true"></i>
                <span>No upcoming travel in the next ${windowDays} days.</span>
            </div>
        `;
    } else {
        upcoming.forEach(g => {
            const route = (g.departure && g.destination)
                ? `${String(g.departure).split(' ')[0]}→${String(g.destination).split(' ')[0]}`
                : 'Route N/A';

            const names = [...(g.passengers || [])];
            const clientLabel = names.length
                ? (names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : ''))
                : 'N/A';

            const dueLabel = Math.round(g.amountDue).toLocaleString();
            const dateLabel = formatDateToDMMMY(g.travelDate.toLocaleDateString('en-US'));

            modalContent += `
                <div class="notification-modal-item" tabindex="0">
                    <div class="notification-icon"><i class="fa-solid fa-plane-up" aria-hidden="true"></i></div>
                    <div class="notification-content">
                        <div class="notification-title">PNR ${g.pnr} • ${clientLabel}</div>
                        <div class="notification-details">Route: ${route} • Travel: <strong>${dateLabel}</strong></div>
                        <div class="notification-details">${g.pax} pax • Paid ${g.paidPax} / Unpaid ${g.unpaidPax}${g.amountDue > 0 ? ` • Due ${dueLabel} MMK` : ''}</div>
                    </div>
                    <div class="notification-time">
                        <i class="fa-solid fa-circle-arrow-right upcoming-open-icon" data-open-pnr="${g.pnr}" title="View travel schedule" aria-label="Open details"></i>
                    </div>
                </div>
            `;
        });
    }

    modalContent += `
        </div>
        <div class="form-actions" style="margin-top: 1.5rem; padding: 0 1.5rem 1.5rem 1.5rem; background: transparent;">
            <button class="btn btn-secondary" data-close-upcoming="true">Close</button>
        </div>
    `;
    openModal(modalContent, 'large-modal');

    const modalContentEl = document.getElementById('modal')?.querySelector('.modal-content');
    if (modalContentEl) {
        modalContentEl.classList.add('notification-modal-content');
    }
    document.querySelector('[data-close-upcoming="true"]')?.addEventListener('click', closeModal);

    // Open Manage Ticket ONLY when clicking the details icon (not on text)
    const body = document.getElementById('modalBody');
    body?.querySelectorAll('.upcoming-open-icon[data-open-pnr]')?.forEach(icon => {
        const pnr = (icon.getAttribute('data-open-pnr') || '').trim();
        const open = async () => {
            if (!pnr || pnr === 'N/A') return;
            closeModal();
            showView('manage');
            const mod = await import('./manage.js');
            mod.findTicketForManage(pnr);
        };
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            open();
        });
        // Keyboard accessibility
        icon.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    });
}

/**
 * Opens a modal with the travel schedule details for a given PNR.
 * This is used by the Upcoming PNR widget so it does NOT navigate away from the dashboard.
 */
function openPnrScheduleModal(pnr) {
    const rows = state.allTickets
        .filter(t => String(t.booking_reference || '').toUpperCase() === String(pnr || '').toUpperCase())
        .map(t => ({
            date: parseSheetDate(t.departing_on || t.issued_date),
            departing_on: t.departing_on,
            airline: t.airline || 'N/A',
            name: t.name || '',
            departure: t.departure || '',
            destination: t.destination || ''
        }))
        .filter(r => r.date instanceof Date && !isNaN(r.date))
        .sort((a, b) => a.date - b.date);

    if (rows.length === 0) {
        openModal(`
            <div class="modal-header">
                <h3><i class="fa-solid fa-plane" aria-hidden="true"></i> Travel Schedule</h3>
                <button class="modal-close-btn" id="closePnrScheduleBtn" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="notification-item empty">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>No schedule found for PNR <strong>${pnr}</strong>.</span>
                </div>
            </div>
        `, 'large-modal');

        const btn = document.getElementById('closePnrScheduleBtn');
        if (btn) btn.onclick = closeModal;
        return;
    }

    const headerDate = formatDateToDMMMY(rows[0].date);
    const route = (rows[0].departure && rows[0].destination)
        ? `${rows[0].departure.split(' ')[0]} → ${rows[0].destination.split(' ')[0]}`
        : 'Route N/A';

    const passengerNames = [...new Set(rows.map(r => r.name).filter(Boolean))].join(', ') || 'Unknown';

    const tableRows = rows.map(r => {
        const d = formatDateToDMMMY(r.date);
        const rRoute = (r.departure && r.destination)
            ? `${r.departure.split(' ')[0]} → ${r.destination.split(' ')[0]}`
            : 'Route N/A';
        return `
            <tr>
                <td>${d}</td>
                <td>${r.airline}</td>
                <td>${rRoute}</td>
                <td>${r.name || ''}</td>
            </tr>`;
    }).join('');

    openModal(`
        <div class="modal-header">
            <h3><i class="fa-solid fa-plane" aria-hidden="true"></i> Travel Schedule</h3>
            <button class="modal-close-btn" id="closePnrScheduleBtn" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
            <div class="pnr-schedule-summary">
                <div><strong>PNR:</strong> ${pnr}</div>
                <div><strong>Route:</strong> ${route}</div>
                <div><strong>Passengers:</strong> ${passengerNames}</div>
            </div>

            <div class="table-wrapper">
                <table class="simple-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Airline</th>
                            <th>Route</th>
                            <th>Client Name</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        </div>
    `, 'large-modal');

    const btn = document.getElementById('closePnrScheduleBtn');
    if (btn) btn.onclick = closeModal;
}


/**
 * Displays the full notification center in a modal.
 */
export function showNotificationModal() {
    let modalContent = `
        <div class="notification-modal-header">
            <h2><i class="fa-solid fa-bell"></i> Notification Center</h2>
        </div>
        <div class="notification-modal-list">
    `;
    let notificationCount = 0;
    const now = new Date();
    const deadlineThreshold = 6 * 60 * 60 * 1000;

    const nearDeadlineBookings = state.allBookings.filter(b => {
        const deadline = parseDeadline(b.enddate, b.endtime);
        const hasNoAction = !b.remark || String(b.remark).trim() === '';
        return deadline && hasNoAction && (deadline.getTime() - now.getTime()) < deadlineThreshold && deadline.getTime() > now.getTime();
    });

    const groupedDeadlineBookings = Object.values(nearDeadlineBookings.reduce((acc, booking) => {
        if (!acc[booking.groupId]) {
            acc[booking.groupId] = { ...booking,
                passengers: []
            };
        }
        acc[booking.groupId].passengers.push(booking.name);
        return acc;
    }, {})).sort((a, b) => parseDeadline(a.enddate, a.endtime) - parseDeadline(b.enddate, b.endtime));

    if (groupedDeadlineBookings.length > 0) {
        notificationCount += groupedDeadlineBookings.length;
        modalContent += '<h3 class="notification-group-title"><i class="fa-solid fa-clock"></i>Approaching Deadlines</h3>';
        groupedDeadlineBookings.forEach(group => {
            const deadline = parseDeadline(group.enddate, group.endtime);
            const timeLeft = Math.round((deadline.getTime() - now.getTime()) / (1000 * 60));
            const passengerCount = group.passengers.length;
            const title = `${group.passengers[0]}${passengerCount > 1 ? ` (+${passengerCount - 1})` : ''}`;

            modalContent += `
                <div class="notification-modal-item deadline">
                    <div class="notification-icon"><i class="fa-solid fa-clock"></i></div>
                    <div class="notification-content">
                        <div class="notification-title">${title}</div>
                        <div class="notification-details">
                            PNR: <strong>${group.pnr || 'N/A'}</strong> | Route: ${group.departure.split(' ')[0]} → ${group.destination.split(' ')[0]}
                        </div>
                    </div>
                    <div class="notification-time" data-deadline="${deadline.getTime()}">~${Math.floor(timeLeft/60)}h ${timeLeft%60}m remaining</div>
                </div>
            `;
        });
    }

    // Unpaid tickets (grouped by PNR)
    // - Excludes cancelled/refund
    // - Fee-entry rows count toward totals but do not inflate passenger names
    const unpaidTickets = state.allTickets.filter(t => {
        if (t.paid) return false;
        const r = String(t.remarks || '').toLowerCase();
        if (r.includes('cancel') || r.includes('refund')) return false;
        return true;
    });

    const groupedUnpaidTickets = Object.values(unpaidTickets.reduce((acc, t) => {
        const pnr = (t.booking_reference || '').toUpperCase();
        if (!pnr) return acc;

        if (!acc[pnr]) {
            acc[pnr] = {
                pnr,
                passengers: new Set(),
                routes: new Set(),
                total_due: 0,
                earliestIssued: null
            };
        }

        // [FIXED] Allow fee rows to contribute names so we don't get "Unknown"
        // normalizePassengerName removes "(Fees)" so it looks clean.
        const cleanName = normalizePassengerName(t.name);
        if (cleanName && cleanName !== 'N/A') {
            acc[pnr].passengers.add(cleanName);
        }

        const amt = (t.net_amount || 0) + (t.extra_fare || 0) + (t.date_change || 0);
        acc[pnr].total_due += amt;

        const route = (t.departure && t.destination)
            ? `${String(t.departure).split(' ')[0]} → ${String(t.destination).split(' ')[0]}`
            : '';
        if (route) acc[pnr].routes.add(route);

        const issuedDate = parseSheetDate(t.issued_date);
        if (!isNaN(issuedDate.getTime()) && issuedDate.getTime() !== 0) {
            if (!acc[pnr].earliestIssued || issuedDate < acc[pnr].earliestIssued.date) {
                acc[pnr].earliestIssued = { date: issuedDate, raw: t.issued_date };
            }
        }
        return acc;
    }, {})).sort((a, b) => (a.earliestIssued?.date.getTime() || 0) - (b.earliestIssued?.date.getTime() || 0));


    if (groupedUnpaidTickets.length > 0) {
        notificationCount += groupedUnpaidTickets.length;
        modalContent += '<h3 class="notification-group-title"><i class="fa-solid fa-file-invoice-dollar"></i>Unpaid Tickets</h3>';
        groupedUnpaidTickets.forEach(group => {
            const names = [...group.passengers];
            const passengerCount = names.length;
            const clientLabel = passengerCount
                ? `${names[0]}${passengerCount > 1 ? ` (+${passengerCount - 1})` : ''}`
                : 'N/A';

            const route = [...group.routes][0] || 'Route N/A';
            const issuedLabel = group.earliestIssued ? formatDateToDMMMY(group.earliestIssued.raw) : 'N/A';
            const dueLabel = Math.round(group.total_due || 0).toLocaleString();

            modalContent += `
                <div class="notification-modal-item unpaid" data-open-pnr="${group.pnr}" role="button" tabindex="0">
                    <div class="notification-icon"><i class="fa-solid fa-file-invoice-dollar"></i></div>
                    <div class="notification-content">
                        <div class="notification-title">PNR <strong>${group.pnr}</strong> • ${clientLabel}</div>
                        <div class="notification-details">${route}</div>
                        <div class="notification-details">Total Due: <strong>${dueLabel} MMK</strong> • Issued: ${issuedLabel}</div>
                    </div>
                    <div class="notification-time">Open</div>
                </div>
            `;
        });
    }

    if (notificationCount === 0) {
        modalContent += `
            <div class="notification-modal-item empty-modal">
                <i class="fa-solid fa-check-circle"></i>
                <span>All caught up! No new notifications.</span>
            </div>
        `;
    }

    modalContent += `
        </div>
        <div class="form-actions" style="margin-top: 1.5rem; padding: 0 1.5rem 1.5rem 1.5rem; background: transparent;">
            <button class="btn btn-secondary">Close</button>
        </div>
    `;

    openModal(modalContent, 'large-modal');
    const modalContentEl = document.getElementById('modal').querySelector('.modal-content');
    if (modalContentEl) {
        modalContentEl.classList.add('notification-modal-content');
    }
    document.querySelector('.notification-modal-list + .form-actions .btn-secondary').addEventListener('click', closeModal);

    // Quick action: open Manage Ticket from any unpaid item row
    const body = document.getElementById('modalBody');
    body?.querySelectorAll('.notification-modal-item[data-open-pnr]')?.forEach(row => {
        const pnr = (row.getAttribute('data-open-pnr') || '').trim();
        const open = async () => {
            if (!pnr || pnr === 'N/A') return;
            closeModal();
            showView('manage');
            const mod = await import('./manage.js');
            mod.findTicketForManage(pnr);
        };
        row.addEventListener('click', open);
        row.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    });
}

/**
 * Shows the form for creating a new booking request.
 */
export function showNewBookingForm() {
    document.getElementById('booking-display-container').style.display = 'none';
    document.getElementById('booking-form-container').style.display = 'block';
}

/**
 * Hides the form for creating a new booking request.
 */
export function hideNewBookingForm() {
    document.getElementById('booking-form-container').style.display = 'none';
    document.getElementById('booking-display-container').style.display = 'block';
    document.getElementById('newBookingForm').reset();
}

/**
 * Resets the passenger forms in the 'Sell Ticket' view to a single default form.
 */
export function resetPassengerForms() {
    const container = document.getElementById('passenger-forms-container');
    if (!container) return;
    container.innerHTML = ''; // Clear existing forms
    addPassengerForm(); // Add the first form
    document.getElementById('removePassengerBtn').style.display = 'none';
}

/**
 * Adds a new passenger form to the 'Sell Ticket' view.
 * @param {string} [name=''] Optional name to pre-fill.
 * @param {string} [idNo=''] Optional ID number to pre-fill.
 * @param {string} [gender='MR'] Optional gender to pre-fill.
 */
export function addPassengerForm(name = '', idNo = '', gender = 'MR') {
    const container = document.getElementById('passenger-forms-container');
    if (!container) return;

    const formCount = container.children.length;
    const newForm = document.createElement('div');
    newForm.className = 'passenger-form';
    newForm.innerHTML = `
        ${formCount > 0 ? '<hr style="border-color: rgba(255,255,255,0.2); margin: 1.5rem 0;">' : ''}
        <h4>Passenger ${formCount + 1}</h4>
        <div class="form-grid">
            <div class="passenger-name-group">
                <div class="form-group">
                    <label>Gender</label>
                    <select class="passenger-gender">
                        <option value="MR" ${gender === 'MR' ? 'selected' : ''}>MR</option>
                        <option value="MS" ${gender === 'MS' ? 'selected' : ''}>MS</option>
                        <option value="MSTR" ${gender === 'MSTR' ? 'selected' : ''}>MSTR</option>
                        <option value="MISS" ${gender === 'MISS' ? 'selected' : ''}>MISS</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Full Name</label>
                    <input type="text" class="passenger-name" placeholder="PASSENGER FULL NAME" value="${name.toUpperCase()}" required>
                </div>
            </div>
            <div class="form-group">
                <label>NRC / Passport No.</label>
                <input type="text" class="passenger-id" placeholder="ID NUMBER" value="${idNo.toUpperCase()}">
            </div>
            <div class="form-group">
                <label>Base Fare</label>
                <input type="number" class="passenger-base-fare" placeholder="0">
            </div>
            <div class="form-group">
                <label>Net Amount</label>
                <input type="number" class="passenger-net-amount" placeholder="0" required>
            </div>
            <div class="form-group">
                <label>Extra Fare</label>
                <input type="number" class="passenger-extra-fare" placeholder="0">
            </div>
            <div class="form-group">
                <label>Commission</label>
                <input type="number" class="passenger-commission" placeholder="0">
            </div>
            <div class="form-group">
                <label>Remarks</label>
                <input type="text" class="passenger-remarks" placeholder="Optional notes">
            </div>
        </div>
    `;
    container.appendChild(newForm);

    const removeBtn = document.getElementById('removePassengerBtn');
    if (container.children.length > 1) {
        removeBtn.style.display = 'inline-flex';
    } else {
        removeBtn.style.display = 'none';
    }
}

/**
 * Removes the last passenger form from the 'Sell Ticket' view.
 */
export function removePassengerForm() {
    const container = document.getElementById('passenger-forms-container');
    if (container && container.children.length > 1) {
        container.removeChild(container.lastChild);
    }

    const removeBtn = document.getElementById('removePassengerBtn');
    if (container && container.children.length <= 1) {
        removeBtn.style.display = 'none';
    }
}

/**
 * Sets up pagination controls for a given dataset using a sliding window style.
 * @param {Array<any>} data The full dataset to paginate.
 * @param {string} containerId The ID of the pagination container element.
 * @param {Function} renderPageFn The function to call to render a specific page.
 * @param {number} currentPage The currently active page.
 */
export function setupGenericPagination(data, containerId, renderPageFn, currentPage) {
    const paginationContainer = document.getElementById(containerId);
    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';
    const pageCount = Math.ceil(data.length / state.rowsPerPage);

    if (pageCount <= 1) return;

    const createBtn = (txt, pg, enabled = true) => {
        const btn = document.createElement('button');
        btn.className = 'pagination-btn';
        btn.innerHTML = txt;
        btn.disabled = !enabled;
        if (enabled) {
            btn.onclick = () => renderPageFn(pg);
        }
        if (pg === currentPage) {
            btn.classList.add('active');
        }
        return btn;
    };

    paginationContainer.append(createBtn('&laquo;', 1, currentPage > 1));

    // --- SLIDING WINDOW LOGIC (Like Client Directory) ---
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(pageCount, startPage + maxPagesToShow - 1);

    if (endPage - startPage + 1 < maxPagesToShow) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    if (startPage > 1) {
        paginationContainer.append(createBtn('...', startPage - 1));
    }

    for (let i = startPage; i <= endPage; i++) {
        paginationContainer.append(createBtn(i, i));
    }

    if (endPage < pageCount) {
        paginationContainer.append(createBtn('...', endPage + 1));
    }
    // --------------------------------

    paginationContainer.append(createBtn('&raquo;', pageCount, currentPage < pageCount));
}


/**
 * Sets up pagination for the main ticket search results.
 * @param {Array<Object>} tickets The array of tickets to paginate.
 */
export function setupPagination(tickets = state.filteredTickets) {
    setupGenericPagination(tickets, 'pagination', (page) => displayTickets(tickets, page), state.currentPage);
}

/**
 * Sets up pagination for the booking requests view.
 * @param {Array<Object>} bookings The array of bookings to paginate.
 */
export function setupBookingPagination(bookings = state.filteredBookings) {
    setupGenericPagination(bookings, 'bookingPagination', renderBookingPage, state.bookingCurrentPage);
}


/**
 * Sets up pagination for the settlement records view.
 * @param {Array<Object>} settlements The array of settlements to paginate.
 */
export function setupSettlementPagination(settlements) {
    const { renderSettlementPage } =
    import ('./settlement.js');
    setupGenericPagination(settlements, 'settlementPagination', (page) => renderSettlementPage(page, settlements), state.settlementPage);
}

/**
 * Resets the passenger forms in the 'New Booking' view.
 */
export function resetBookingPassengerForms() {
    const container = document.getElementById('booking-passenger-forms-container');
    if (!container) return;
    container.innerHTML = '';
    addBookingPassengerForm();
    document.getElementById('removeBookingPassengerBtn').style.display = 'none';
}

/**
 * Adds a new passenger form to the 'New Booking' view.
 */
export function addBookingPassengerForm() {
    const container = document.getElementById('booking-passenger-forms-container');
    if (!container) return;
    const formCount = container.children.length;
    const newForm = document.createElement('div');
    newForm.className = 'passenger-form';
    newForm.innerHTML = `
        ${formCount > 0 ? '<hr style="border-color: rgba(255,255,255,0.2); margin: 1.5rem 0;">' : ''}
        <h4>Passenger ${formCount + 1}</h4>
        <div class="booking-passenger-grid">
            <div class="form-group">
                <label>Gender</label>
                <select class="booking-passenger-gender">
                    <option value="MR" selected>MR</option>
                    <option value="MS">MS</option>
                    <option value="MSTR">MSTR</option>
                    <option value="MISS">MISS</option>
                </select>
            </div>
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" class="booking-passenger-name" placeholder="PASSENGER FULL NAME" required>
            </div>
            <div class="form-group">
                <label>NRC / Passport No.</label>
                <input type="text" class="booking-passenger-id" placeholder="ID NUMBER">
            </div>
        </div>
    `;
    container.appendChild(newForm);
    const removeBtn = document.getElementById('removeBookingPassengerBtn');
    if (container.children.length > 1) {
        removeBtn.style.display = 'inline-flex';
    } else {
        removeBtn.style.display = 'none';
    }
}

/**
 * Removes the last passenger form from the 'New Booking' view.
 */
export function removeBookingPassengerForm() {
    const container = document.getElementById('booking-passenger-forms-container');
    if (container.children.length > 1) {
        container.removeChild(container.lastChild);
    }
    const removeBtn = document.getElementById('removeBookingPassengerBtn');
    if (container.children.length <= 1) {
        removeBtn.style.display = 'none';
    }
}

/**
 * Initializes UI settings from local storage and sets up event listeners.
 */
export function initializeUISettings() {
    // --- Get all UI elements ---
    const themeToggle = document.getElementById('theme-toggle');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const backgroundUploader = document.getElementById('background-uploader');
    const glassSettings = document.getElementById('glass-settings-container');
    const backgroundSection = document.getElementById('background-settings-section');
    const backgroundResetBtn = document.getElementById('background-reset-btn');
    const resetSettingsBtn = document.getElementById('reset-settings-btn');

    // Glass effect sliders
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    const blurSlider = document.getElementById('blur-slider');
    const blurValue = document.getElementById('blur-value');
    const overlaySlider = document.getElementById('overlay-slider');
    const overlayValue = document.getElementById('overlay-value');
    const glassSlider = document.getElementById('glass-slider');
    const glassValue = document.getElementById('glass-value');
    const glassTextToggle = document.getElementById('glass-text-toggle');

    // Commission slider
    const agentCutSlider = document.getElementById('agent-cut-slider');
    const agentCutValue = document.getElementById('agent-cut-value');

    // --- Define default settings ---
    const defaultSettings = {
        opacity: 0.05,
        blur: 20,
        overlay: 0.5,
        glassBorder: 0.15,
        darkText: false,
        agentCut: 60
    };

    let currentSettings = { ...defaultSettings };

    // --- Core Functions ---
    const saveSettings = () => {
        localStorage.setItem('uiCustomSettings', JSON.stringify(currentSettings));
    };

    const applySettings = (settings) => {
        // Apply glass effect styles via CSS variables
        const opacity = Number(settings.opacity);
        const blur = Number(settings.blur);
        const hoverOpacity = Math.min(opacity + 0.03, 0.35);
        const hoverBlur = Math.min(blur + 10, 70);

        document.documentElement.style.setProperty('--glass-bg', `rgba(255, 255, 255, ${opacity})`);
        document.documentElement.style.setProperty('--glass-bg-hover', `rgba(255, 255, 255, ${hoverOpacity})`);
        document.documentElement.style.setProperty('--glass-opacity', `${opacity}`);
        document.documentElement.style.setProperty('--blur-amount', `${blur}px`);
        document.documentElement.style.setProperty('--blur-amount-hover', `${hoverBlur}px`);
        document.documentElement.style.setProperty('--overlay-opacity', settings.overlay);
        document.documentElement.style.setProperty('--liquid-border', `1px solid rgba(255, 255, 255, ${settings.glassBorder})`);

        // Apply dark text class for glass mode
        document.body.classList.toggle('dark-text-theme', settings.darkText);

        // Update agent cut in global state for calculations
        state.commissionRates.cut = settings.agentCut / 100;

        // Update UI controls to reflect the new values
        opacitySlider.value = settings.opacity;
        opacityValue.textContent = Number(settings.opacity).toFixed(2);
        blurSlider.value = settings.blur;
        blurValue.textContent = settings.blur;
        overlaySlider.value = settings.overlay;
        overlayValue.textContent = Number(settings.overlay).toFixed(2);
        glassSlider.value = settings.glassBorder;
        glassValue.textContent = Number(settings.glassBorder).toFixed(2);
        glassTextToggle.checked = settings.darkText;
        agentCutSlider.value = settings.agentCut;
        agentCutValue.textContent = `${settings.agentCut}%`;
    };

    const loadSettings = () => {
        const saved = JSON.parse(localStorage.getItem('uiCustomSettings'));
        currentSettings = { ...defaultSettings, ...saved };
        applySettings(currentSettings);
    };

    const renderBackground = () => {
        const isMaterial = document.body.classList.contains('material-theme');
        const savedBackground = localStorage.getItem('backgroundImage');

        if (isMaterial) {
            document.body.style.backgroundImage = 'none';
        } else {
            if (savedBackground) {
                document.body.style.backgroundImage = `url(${savedBackground})`;
            } else {
                document.body.style.removeProperty('background-image');
            }
        }
    };

    const updateUIState = (isMaterial) => {
        if (glassSettings) {
            glassSettings.style.display = isMaterial ? 'none' : 'block';
        }
        if (backgroundSection) {
            backgroundSection.style.display = isMaterial ? 'none' : 'block';
        }
    };

    const applyTheme = (isMaterial) => {
        document.body.classList.add('theme-transitioning');
        document.body.classList.toggle('material-theme', isMaterial);
        updateUIState(isMaterial);
        renderBackground();
        setTimeout(() => {
            document.body.classList.remove('theme-transitioning');
            document.body.dispatchEvent(new CustomEvent('themeChanged')); // Fire event
        }, 100);
    };

    // --- Event Listeners ---
    themeToggle.addEventListener('change', (e) => {
        const isMaterial = e.target.checked;
        applyTheme(isMaterial);
        localStorage.setItem('theme', isMaterial ? 'material' : 'glass');
    });

    darkModeToggle.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        document.body.classList.toggle('dark-theme', isDark);
        localStorage.setItem('darkMode', isDark);
        document.body.dispatchEvent(new CustomEvent('themeChanged')); // Fire event
    });

    backgroundUploader.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // Increase the size limit to 4.5MB, which is safer for a 5MB quota
            if (file.size > 4.5 * 1024 * 1024) {
                showToast('Image is too large. Please choose a file smaller than 4.5MB.', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                const bgData = event.target.result;
                try {
                    // Clear the old item first to make space.
                    localStorage.removeItem('backgroundImage');
                    localStorage.setItem('backgroundImage', bgData);
                    renderBackground();
                } catch (error) {
                    if (error.name === 'QuotaExceededError') {
                        showToast('Browser storage is full. This image is too large even after clearing the old one.', 'error');
                    } else {
                        showToast('An error occurred while saving the background.', 'error');
                    }
                }
            };
            reader.readAsDataURL(file);
        }
    });


    backgroundResetBtn.addEventListener('click', () => {
        localStorage.removeItem('backgroundImage');
        renderBackground();
    });

    opacitySlider.addEventListener('input', (e) => { currentSettings.opacity = e.target.value; applySettings(currentSettings); saveSettings(); });
    blurSlider.addEventListener('input', (e) => { currentSettings.blur = e.target.value; applySettings(currentSettings); saveSettings(); });
    overlaySlider.addEventListener('input', (e) => { currentSettings.overlay = e.target.value; applySettings(currentSettings); saveSettings(); });
    glassSlider.addEventListener('input', (e) => { currentSettings.glassBorder = e.target.value; applySettings(currentSettings); saveSettings(); });
    glassTextToggle.addEventListener('change', (e) => { currentSettings.darkText = e.target.checked; applySettings(currentSettings); saveSettings(); });
    agentCutSlider.addEventListener('input', (e) => { currentSettings.agentCut = e.target.value; applySettings(currentSettings); saveSettings(); });

    resetSettingsBtn.addEventListener('click', () => {
        currentSettings = { ...defaultSettings };
        localStorage.removeItem('uiCustomSettings');
        applySettings(currentSettings);
    });

    // --- Initial Load & Render ---
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'material') {
        themeToggle.checked = true;
    }
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode === 'true') {
        darkModeToggle.checked = true;
        document.body.classList.add('dark-theme');
    }

    loadSettings();
    applyTheme(themeToggle.checked);
}


/**
 * Handles validation for departure/destination selects to prevent them from being the same.
 * @param {Event} e The change event from a select element.
 */
export function handleRouteValidation(e) {
    const dep = document.getElementById('departure');
    const dest = document.getElementById('destination');
    const changed = e.target;
    const other = changed === dep ? dest : dep;

    if (dep.value && dep.value === dest.value) {
        other.value = '';
    }
}

// --- Payment Method Enhancements (Mobile Banking sub-method) ---
const MOBILE_BANKING_SUB_OPTIONS = [
    'KBZ Special',
    'KBZ Normal',
    'AYA Banking',
    'CB Banking'
];

/**
 * Enhances a Payment Method <select> so that when "Mobile Banking" is chosen,
 * a secondary dropdown appears beside it for bank selection.
 *
 * This function is idempotent (safe to call multiple times).
 *
 * @param {HTMLSelectElement} paymentSelect
 * @param {{ defaultBank?: string }} [opts]
 * @returns {HTMLSelectElement|null} The created bank <select>, or null if input invalid.
 */
export function enhanceMobileBankingSelect(paymentSelect, opts = {}) {
    if (!paymentSelect || !(paymentSelect instanceof HTMLSelectElement)) return null;
    if (paymentSelect.dataset.mobileBankingEnhanced === 'true') {
        return document.getElementById(`${paymentSelect.id}_bank`) || null;
    }

    const defaultBank = String(opts.defaultBank || '').trim();

    // Create row container and move the existing select into it.
    const row = document.createElement('div');
    row.className = 'payment-method-row';

    const parent = paymentSelect.parentElement;
    if (!parent) return null;

    parent.insertBefore(row, paymentSelect);
    row.appendChild(paymentSelect);

    // Create the bank select
    const bankSelect = document.createElement('select');
    bankSelect.id = `${paymentSelect.id}_bank`;
    bankSelect.name = `${paymentSelect.name || paymentSelect.id}_bank`;
    bankSelect.className = 'bank-select';
    bankSelect.innerHTML = [
        '<option value="" selected>Select bank</option>',
        ...MOBILE_BANKING_SUB_OPTIONS.map(v => `<option value="${v}">${v}</option>`)
    ].join('');

    if (defaultBank) bankSelect.value = defaultBank;

    row.appendChild(bankSelect);

    const toggleBankSelect = () => {
        const isMobile = paymentSelect.value === 'Mobile Banking';
        bankSelect.classList.toggle('show', isMobile);
        bankSelect.required = isMobile;

        // If switching away, keep selection but make it inert
        if (!isMobile) {
            bankSelect.blur();
        } else {
            // Gentle nudge for better UX
            if (!bankSelect.value) {
                setTimeout(() => bankSelect.focus(), 0);
            }
        }
    };

    paymentSelect.addEventListener('change', toggleBankSelect);
    toggleBankSelect();

    paymentSelect.dataset.mobileBankingEnhanced = 'true';
    return bankSelect;
}

/**
 * Enhances all known payment method selects currently in the DOM.
 * Safe to call repeatedly.
 */
export function initializePaymentMethodEnhancements() {
    // Main Sell Ticket & Settlement forms
    ['payment_method', 'settlement_payment_method'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) enhanceMobileBankingSelect(sel);
    });
}