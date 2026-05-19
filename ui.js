
/**
 * @fileoverview Manages all UI interactions, DOM updates, and component rendering.
 * UPDATED: Fixed 'Unknown' name issue for Date Change fees by looking up related PNR names.
 */

import { CITIES } from './config.js';
import { state } from './state.js';
import { parseSheetDate, formatDateToDMMMY, makeClickable, parseDeadline, calculateAgentCut, isPlaceholderDate } from './utils.js';
import { clearManageResults } from './manage.js';
import { displaySettlements, hideNewSettlementForm, updateSettlementDashboard, renderSettlementPage } from './settlement.js';
import { showToast } from './utils.js';
import { displayTickets } from './tickets.js';
import { renderBookingPage } from './booking.js';
import { uploadPassportPhoto, deletePassportPhoto, openPhotoLightbox } from './passport.js';
import { ocrPassport } from './passport-ocr.js';


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
 * Adds subtle Notion-like entrance animations to key blocks within a view.
 * Uses CSS class `.animate-in` with a stagger delay variable.
 */
function runIntroAnimations(viewEl) {
    if (!viewEl) return;
    const selector = [
        '.info-grid > .glass-card',
        '.actions-grid > .glass-card',
        '.comparison-section',
        '.dashboard-panel',
        '.form-container',
        '.results-section',
        '.search-section',
        '.clients-header',
        '.table-header',
        '.results-header'
    ].join(', ');

    const items = Array.from(viewEl.querySelectorAll(selector));
    if (items.length === 0) {
        items.push(...viewEl.querySelectorAll('.glass-card'));
    }

    items.slice(0, 20).forEach((el, idx) => {
        el.classList.remove('animate-in');
        el.style.setProperty('--stagger-delay', `${Math.min(idx, 14) * 35}ms`);
        // force reflow so re-adding class re-triggers animation
        void el.offsetWidth;
        el.classList.add('animate-in');
    });

    window.setTimeout(() => {
        items.forEach(el => el.classList.remove('animate-in'));
    }, 1200);
}

/**
 * Shows a specific view and hides others.
 * @param {string} viewName The name of the view to show (e.g., 'home', 'clients').
 */
export function showView(viewName) {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    const targetView = document.getElementById(`${viewName}-view`);
    if (!targetView) return;

    navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewName));

    const currentView = document.querySelector('.view.active');

    // Animate out current view (keep it visible during the leave animation)
    if (currentView && currentView !== targetView) {
        currentView.classList.add('view-leave');
        currentView.classList.remove('active');
        currentView.addEventListener('animationend', () => {
            currentView.classList.remove('view-leave');
        }, { once: true });
    }

    // Hide other views immediately (except the leaving one)
    views.forEach(view => {
        if (view !== targetView && view !== currentView) {
            view.classList.remove('active');
        }
    });

    // Animate in target view
    targetView.classList.add('active');
    targetView.classList.add('view-enter');
    targetView.addEventListener('animationend', () => {
        targetView.classList.remove('view-enter');
    }, { once: true });

    // Stagger entrance animations for key blocks
    runIntroAnimations(targetView);

    // Clear search hash when navigating away from search
    if (viewName !== 'search' && window.location.hash.startsWith('#/search')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    // View-specific cleanup and setup
    if (viewName === 'sell') {
        document.getElementById('sellForm')?.reset();
        setSellFormDefaultDates();
        // Default trip type to One-Way after reset
        const onewayRadio = document.getElementById('trip_type_oneway');
        if (onewayRadio) onewayRadio.checked = true;
        const customizeToggle = document.getElementById('returnCustomizeToggle');
        if (customizeToggle) customizeToggle.checked = false;
        const returnBlock = document.getElementById('returnFlightBlock');
        if (returnBlock) returnBlock.classList.remove('is-customized');

        populateFlightLocations();
        updateToggleLabels();
        resetPassengerForms();
        updateSellRoutePreview();
        applyTripTypeToUI();
        setupSellClientAutoSuggest();
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
        format: 'dd/mm/yyyy',
        autohide: true,
        todayHighlight: true
    };
    const settlementOptions = {
        format: 'dd-M-yyyy',
        autohide: true,
        todayHighlight: true
    };
    // Added 'hotel-arrival' and 'hotel-departure' to the list below
    const allDatePickers = ['searchStartDate', 'searchEndDate', 'searchTravelDate', 'booking_departing_on', 'exportStartDate', 'exportEndDate', 'issued_date', 'departing_on', 'return_date', 'paid_date', 'booking_end_date', 'update_departing_on', 'update_paid_date', 'invoice_date', 'hotel-arrival', 'hotel-departure'];
    
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

    // NEW: Add "Custom" option for International flights
    if (!isDomestic) {
        departureSelect.add(new Option("Custom (Manual)", "CUSTOM"));
        destinationSelect.add(new Option("Custom (Manual)", "CUSTOM"));
    }

    // Attach listener to handle custom input visibility
    handleCustomLocationVisibility();
}

/**
 * Handles showing/hiding custom location inputs.
 */
function handleCustomLocationVisibility() {
    const depSelect = document.getElementById('departure');
    const destSelect = document.getElementById('destination');
    const depInputGroup = document.getElementById('custom_departure_group');
    const destInputGroup = document.getElementById('custom_destination_group');

    // Remove existing listeners to avoid duplicates if called multiple times
    const newDepSelect = depSelect.cloneNode(true);
    depSelect.parentNode.replaceChild(newDepSelect, depSelect);
    
    const newDestSelect = destSelect.cloneNode(true);
    destSelect.parentNode.replaceChild(newDestSelect, destSelect);

    newDepSelect.addEventListener('change', (e) => {
        if (depInputGroup) {
            depInputGroup.style.display = e.target.value === 'CUSTOM' ? 'block' : 'none';
        }
        handleRouteValidation(e);
        updateSellRoutePreview();
    });

    newDestSelect.addEventListener('change', (e) => {
        if (destInputGroup) {
             destInputGroup.style.display = e.target.value === 'CUSTOM' ? 'block' : 'none';
        }
        handleRouteValidation(e);
        updateSellRoutePreview();
    });

    const customDep = document.getElementById('custom_departure');
    const customDest = document.getElementById('custom_destination');
    if (customDep) customDep.oninput = updateSellRoutePreview;
    if (customDest) customDest.oninput = updateSellRoutePreview;
    
    // Initial check
    if(depInputGroup) depInputGroup.style.display = newDepSelect.value === 'CUSTOM' ? 'block' : 'none';
    if(destInputGroup) destInputGroup.style.display = newDestSelect.value === 'CUSTOM' ? 'block' : 'none';
    updateSellRoutePreview();

    // Keep return-leg location dropdowns in sync with the active flight type
    try { populateReturnFlightLocations(); } catch (_) {}
    updateReturnRoutePreview();
}

/**
 * Updates the labels for the Domestic/International toggle switch.
 */
export function updateToggleLabels() {
    const flightTypeToggle = document.getElementById('flightTypeToggle');
    const domesticLabel = document.getElementById('domestic-label');
    const internationalLabel = document.getElementById('international-label');
    if (!flightTypeToggle || !domesticLabel || !internationalLabel) return;
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
    // ADDED: Select the hint element
    const notificationHint = document.getElementById('notification-unpaid-total'); 

    if (!notificationList || !notificationTitleLink) return;

    const header = notificationTitleLink.querySelector('h3');
    notificationList.innerHTML = '';

    // --- Collect Unpaid Tickets Only (Simplified) ---
    const unpaidGroups = {};
    let grandTotalUnpaid = 0; // ADDED: Variable for total

    state.allTickets.forEach(t => {
        if (t.paid) return;
        const lowerRemarks = String(t.remarks || '').toLowerCase();
        if (lowerRemarks.includes('cancel') || lowerRemarks.includes('refund')) return;

        // Use helper to check if it's a fee entry
        const isFee = isFeeEntryRow(t);

        const pnr = (t.booking_reference || 'N/A').toUpperCase();
        if (!unpaidGroups[pnr]) {
            unpaidGroups[pnr] = { pnr, passengers: [], totalDue: 0 };
        }

        const amt = (t.net_amount || 0) + (t.extra_fare || 0) + (t.date_change || 0);
        unpaidGroups[pnr].totalDue += amt;
        grandTotalUnpaid += amt; // ADDED: Sum up total

        if (!isFee && t.name) {
            unpaidGroups[pnr].passengers.push(normalizePassengerName(t.name));
        }
    });
    
    // NEW LOGIC: Fallback name resolution for Date Change entries
    Object.values(unpaidGroups).forEach(group => {
        if (group.passengers.length === 0) {
            // If no names found (e.g. only Date Change fees unpaid), look up name from ANY ticket with this PNR
            const relatedTicket = state.allTickets.find(t => 
                (t.booking_reference || '').toUpperCase() === group.pnr && 
                !isFeeEntryRow(t) && 
                t.name
            );
            if (relatedTicket) {
                group.passengers.push(normalizePassengerName(relatedTicket.name));
            }
        }
    });

    // ADDED: Update the UI with the total
    if (notificationHint) {
        notificationHint.textContent = `Total Unpaid: ${Math.round(grandTotalUnpaid).toLocaleString()} MMK`;
    }

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
        
        // NEW: Ignore fee rows for scheduling notifications to prevent date confusion
        if (isFeeEntryRow(t)) return;

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
        
        // NEW: Ignore fee rows for scheduling notifications
        if (isFeeEntryRow(t)) return;

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

        if (!isFeeEntryRow(t)) {
            acc[pnr].passengers.add(normalizePassengerName(t.name) || 'N/A');
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

    // FIX: Fallback lookup for groups with no passengers (e.g. only Date Change fee unpaid)
    groupedUnpaidTickets.forEach(group => {
        if (group.passengers.size === 0) {
            const relatedTicket = state.allTickets.find(t => 
                (t.booking_reference || '').toUpperCase() === group.pnr && 
                !isFeeEntryRow(t) && 
                t.name
            );
            if (relatedTicket) {
                group.passengers.add(normalizePassengerName(relatedTicket.name));
            }
        }
    });

    if (groupedUnpaidTickets.length > 0) {
        notificationCount += groupedUnpaidTickets.length;
        modalContent += '<h3 class="notification-group-title"><i class="fa-solid fa-file-invoice-dollar"></i>Unpaid Tickets</h3>';
        groupedUnpaidTickets.forEach(group => {
            const names = [...group.passengers];
            const passengerCount = names.length;
            const clientLabel = passengerCount
                ? `${names[0]}${passengerCount > 1 ? ` (+${passengerCount - 1})` : ''}`
                : 'N/A'; // Will show 'N/A' only if TRULY no name exists on ANY ticket for this PNR

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

// ====================================================================
// ============== SELL TICKET — PASSENGER FORM (REDESIGN) =============
// ====================================================================

let passengerFormSeq = 0;

function formatDateInput(date) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}

function setSellFormDefaultDates() {
    const issuedInput = document.getElementById('issued_date');
    const travelInput = document.getElementById('departing_on');
    const today = new Date();
    const defaultTravel = new Date(today);
    defaultTravel.setDate(today.getDate() + 7);

    if (issuedInput && !issuedInput.value) issuedInput.value = formatDateInput(today);
    if (travelInput && !travelInput.value) travelInput.value = formatDateInput(defaultTravel);
}

/**
 * Returns true when the user has toggled International (passport required).
 */
function isInternationalFlight() {
    return !!document.getElementById('flightTypeToggle')?.checked;
}

/**
 * Returns true when Round-Trip is currently selected in the Trip Type segment.
 */
function isRoundTrip() {
    return !!document.getElementById('trip_type_round')?.checked;
}

/**
 * Parses a legacy `id_no` string into structured NRC parts when possible.
 * Returns { region, township, type, serial } with empty defaults.
 * Matches "12/ABCDEF(N)123456" or "12/ABCDEF(N) 123456".
 */
function parseLegacyNrc(idNo) {
    const out = { region: '', township: '', type: '', serial: '' };
    if (!idNo) return out;
    const m = String(idNo).match(/^(\d{1,2})\s*\/\s*([A-Za-z]+)\s*\(\s*([A-Za-z]+)\s*\)\s*(\d{1,7})/);
    if (m) {
        out.region = m[1];
        out.township = m[2].toUpperCase();
        out.type = m[3].toUpperCase();
        out.serial = m[4];
    }
    return out;
}

/**
 * Joins NRC parts into the canonical "12/ABCDEF(N)123456" string.
 * Returns '' if any required part is missing.
 */
function joinNrc({ region, township, type, serial }) {
    if (!region || !township || !type || !serial) return '';
    return `${region}/${township.toUpperCase()}(${type.toUpperCase()})${serial}`;
}

/**
 * Calculates age in years from a MM/DD/YYYY date string.
 */
function ageFromDob(dobStr) {
    if (!dobStr) return null;
    const d = parseSheetDate(dobStr);
    if (!d || isNaN(d)) return null;
    const today = new Date();
    let age = today.getFullYear() - d.getFullYear();
    const m = today.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
    return age >= 0 && age < 130 ? age : null;
}

function ageBucket(age) {
    if (age === null) return '';
    if (age < 2) return 'Infant';
    if (age < 12) return 'Child';
    return 'Adult';
}

function normalizePassportDateForInput(value, { isBirth = false } = {}) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (isPlaceholderDate(raw)) return '';

    const namedMonths = {
        JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
        JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
    };

    const mrzDate = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (mrzDate) {
        const yy = parseInt(mrzDate[1], 10);
        const currentYear = new Date().getFullYear() % 100;
        const yyyy = isBirth && yy > currentYear ? 1900 + yy : 2000 + yy;
        return `${mrzDate[3]}/${mrzDate[2]}/${yyyy}`;
    }

    const named = raw.match(/(\d{1,2})\s+([A-Z]{3})[A-Z]*\.?\s+(\d{2,4})/i);
    if (named) {
        const dd = named[1].padStart(2, '0');
        const mm = namedMonths[named[2].toUpperCase()];
        let yyyy = named[3];
        if (yyyy.length === 2) {
            const yy = parseInt(yyyy, 10);
            const currentYear = new Date().getFullYear() % 100;
            yyyy = String(isBirth && yy > currentYear ? 1900 + yy : 2000 + yy);
        }
        return mm ? `${dd}/${mm}/${yyyy}` : raw;
    }

    const iso = raw.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (iso) return `${iso[3].padStart(2, '0')}/${iso[2].padStart(2, '0')}/${iso[1]}`;

    const numeric = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (numeric) {
        const first = parseInt(numeric[1], 10);
        const second = parseInt(numeric[2], 10);
        let yyyy = numeric[3];
        if (yyyy.length === 2) {
            const yy = parseInt(yyyy, 10);
            const currentYear = new Date().getFullYear() % 100;
            yyyy = String(isBirth && yy > currentYear ? 1900 + yy : 2000 + yy);
        }

        let dd, mm;
        if (first > 12) {
            dd = first; mm = second;
        } else if (second > 12) {
            dd = second; mm = first;
        } else {
            dd = first; mm = second;
        }
        return `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yyyy}`;
    }

    return raw;
}

function setDateInputFromOcr(input, rawValue, { isBirth = false } = {}) {
    if (!input || !rawValue) return false;
    const value = normalizePassportDateForInput(rawValue, { isBirth });
    if (!value) return false;

    // CRITICAL: The Vanilla Datepicker intercepts 'change' events on the input
    // and re-parses the value using its own year-range logic, which clamps
    // historical years (e.g. 1997 → 2017). To prevent this:
    // 1. Destroy the datepicker instance
    // 2. Set the value directly
    // 3. Recreate the datepicker
    try {
        if (input.datepicker) {
            input.datepicker.destroy();
        }
    } catch (_) {}

    input.value = value;

    // Only dispatch 'input' event — our own updateAgeBadge listens to this.
    // Do NOT dispatch 'change' — datepicker would intercept and clamp the year.
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Recreate the datepicker so the calendar UI still works for manual edits
    try {
        if (window.Datepicker) {
            const opts = { format: 'dd/mm/yyyy', autohide: true };
            if (isBirth) {
                opts.minDate = new Date(1900, 0, 1);
                opts.maxDate = new Date();
            }
            new window.Datepicker(input, opts);
        }
    } catch (_) {}

    return true;
}



function getSelectedOrCustomValue(selectId, customId) {
    const select = document.getElementById(selectId);
    const custom = document.getElementById(customId);
    if (!select) return '';
    if (select.value === 'CUSTOM') return (custom?.value || '').trim();
    return select.value || '';
}

export function updateSellRoutePreview() {
    const preview = document.getElementById('route-preview');
    const text = document.getElementById('route-preview-text');
    if (!preview || !text) return;

    const departure = getSelectedOrCustomValue('departure', 'custom_departure');
    const destination = getSelectedOrCustomValue('destination', 'custom_destination');
    if (departure && destination) {
        text.textContent = `${departure.split(' ')[0]} → ${destination.split(' ')[0]}`;
        preview.style.display = 'inline-flex';
    } else {
        preview.style.display = 'none';
    }
}

function renderClientSuggestions(input, box, matches, onSelect) {
    if (!box) return;
    if (!matches.length) {
        box.style.display = 'none';
        return;
    }

    box.innerHTML = '';
    matches.slice(0, 8).forEach(client => {
        const item = document.createElement('div');
        item.className = 'autosuggest-item';
        item.innerHTML = `
            <div style="font-weight:600;">${client.name || 'Unknown'}</div>
            <div style="font-size:0.78em; opacity:0.72;">
                ${client.phone ? `<i class="fa-solid fa-phone"></i> ${client.phone}` : ''}
                ${client.account_name ? ` · ${client.account_name}` : ''}
            </div>
        `;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            onSelect(client);
            box.style.display = 'none';
            input.blur();
        });
        box.appendChild(item);
    });
    box.style.display = 'block';
}

function fillSellClientFields(client) {
    if (!client) return;
    const phoneInput = document.getElementById('phone');
    const accountNameInput = document.getElementById('account_name');
    const accountTypeInput = document.getElementById('account_type');
    const accountLinkInput = document.getElementById('account_link');
    if (phoneInput) phoneInput.value = client.phone || '';
    if (accountNameInput) accountNameInput.value = client.account_name || '';
    if (accountTypeInput) accountTypeInput.value = client.account_type || '';
    if (accountLinkInput) accountLinkInput.value = client.account_link || '';
    showClientMatchChip(client);
}

function showClientMatchChip(client) {
    const chip = document.getElementById('phone_match_chip');
    if (!chip) return;
    if (!client) {
        chip.style.display = 'none';
        return;
    }
    chip.querySelector('span').textContent = `Matched: ${client.name}`;
    chip.style.display = 'inline-flex';
}

export function setupSellClientAutoSuggest() {
    const phoneInput = document.getElementById('phone');
    const phoneBox = document.getElementById('phone_autosuggest');
    const accountInput = document.getElementById('account_name');
    const accountBox = document.getElementById('account_name_autosuggest');

    if (phoneInput && phoneInput.dataset.clientSuggestBound !== 'true') {
        phoneInput.addEventListener('input', () => {
            const query = phoneInput.value.trim().toLowerCase();
            showClientMatchChip(null);
            if (!query) {
                if (phoneBox) phoneBox.style.display = 'none';
                return;
            }
            const matches = state.allClients.filter(c => String(c.phone || '').toLowerCase().includes(query));
            const exact = matches.find(c => String(c.phone || '').trim() === phoneInput.value.trim());
            if (exact) showClientMatchChip(exact);
            renderClientSuggestions(phoneInput, phoneBox, matches, fillSellClientFields);
        });
        phoneInput.addEventListener('blur', () => setTimeout(() => { if (phoneBox) phoneBox.style.display = 'none'; }, 120));
        phoneInput.dataset.clientSuggestBound = 'true';
    }

    if (accountInput && accountInput.dataset.clientSuggestBound !== 'true') {
        accountInput.addEventListener('input', () => {
            const query = accountInput.value.trim().toLowerCase();
            if (!query) {
                if (accountBox) accountBox.style.display = 'none';
                return;
            }
            const matches = state.allClients.filter(c =>
                String(c.account_name || '').toLowerCase().includes(query) ||
                String(c.name || '').toLowerCase().includes(query)
            );
            renderClientSuggestions(accountInput, accountBox, matches, fillSellClientFields);
        });
        accountInput.addEventListener('blur', () => setTimeout(() => { if (accountBox) accountBox.style.display = 'none'; }, 120));
        accountInput.dataset.clientSuggestBound = 'true';
    }
}

function togglePassengerCardCollapse(card, button = null) {
    const body = card?.querySelector('.pax-card-body');
    if (!card || !body) return;

    const isCollapsed = card.classList.contains('is-collapsed');
    body.style.setProperty('--pax-body-max-height', `${body.scrollHeight}px`);
    body.offsetHeight;

    card.classList.toggle('is-collapsed', !isCollapsed);
    button?.setAttribute('aria-expanded', String(isCollapsed));
}

export function initializeSellFormEnhancements() {
    setupSellClientAutoSuggest();

    // --- Bulletproof: delegated handler for passenger card collapse/expand ---
    // Survives any re-render and works for cards added later.
    const paxContainer = document.getElementById('passenger-forms-container');
    if (paxContainer && paxContainer.dataset.collapseDelegateBound !== 'true') {
        paxContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-role="collapse-btn"]');
            if (!btn) return;
            const card = btn.closest('.passenger-form');
            if (!card) return;
            e.stopPropagation();
            togglePassengerCardCollapse(card, btn);
            console.log('[collapse] toggled', card.classList.contains('is-collapsed') ? 'collapsed' : 'expanded');
        });
        paxContainer.dataset.collapseDelegateBound = 'true';
    }

    [
        'booking_reference', 'custom_airline', 'custom_departure', 'custom_destination',
        'return_booking_reference', 'return_custom_airline', 'return_custom_departure', 'return_custom_destination'
    ].forEach(id => {
        const input = document.getElementById(id);
        if (!input || input.dataset.uppercaseBound === 'true') return;
        input.addEventListener('input', () => {
            const pos = input.selectionStart;
            input.value = input.value.toUpperCase();
            input.setSelectionRange(pos, pos);
            if (id.startsWith('custom_')) updateSellRoutePreview();
            if (id.startsWith('return_')) updateReturnRoutePreview();
        });
        input.dataset.uppercaseBound = 'true';
    });

    // --- Trip Type segmented control ---
    ['trip_type_oneway', 'trip_type_round'].forEach(id => {
        const radio = document.getElementById(id);
        if (!radio || radio.dataset.tripTypeBound === 'true') return;
        radio.addEventListener('change', () => applyTripTypeToUI());
        radio.dataset.tripTypeBound = 'true';
    });

    // --- Domestic / International labels: clickable segmented control ---
    // The legacy slider is hidden by CSS; clicks on the labels toggle the
    // underlying flightTypeToggle checkbox and re-fire its change handler.
    ['domestic-label', 'international-label'].forEach(id => {
        const span = document.getElementById(id);
        if (!span || span.dataset.flightLabelBound === 'true') return;
        span.addEventListener('click', () => {
            const toggle = document.getElementById('flightTypeToggle');
            if (!toggle) return;
            const wantInternational = id === 'international-label';
            if (toggle.checked !== wantInternational) {
                toggle.checked = wantInternational;
                toggle.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        span.dataset.flightLabelBound = 'true';
    });

    // --- Return-flight "Customize" toggle ---
    const customizeToggle = document.getElementById('returnCustomizeToggle');
    const returnBlock = document.getElementById('returnFlightBlock');
    if (customizeToggle && returnBlock && customizeToggle.dataset.bound !== 'true') {
        customizeToggle.addEventListener('change', () => {
            returnBlock.classList.toggle('is-customized', customizeToggle.checked);
            // Reveal custom airline/route inputs only when select is CUSTOM
            applyReturnCustomVisibility();
        });
        customizeToggle.dataset.bound = 'true';
    }

    // --- Return airline custom handling ---
    const returnAirline = document.getElementById('return_airline');
    if (returnAirline && returnAirline.dataset.bound !== 'true') {
        returnAirline.addEventListener('change', applyReturnCustomVisibility);
        returnAirline.dataset.bound = 'true';
    }
    const returnDep = document.getElementById('return_departure');
    const returnDest = document.getElementById('return_destination');
    if (returnDep && returnDep.dataset.bound !== 'true') {
        returnDep.addEventListener('change', () => { applyReturnCustomVisibility(); updateReturnRoutePreview(); });
        returnDep.dataset.bound = 'true';
    }
    if (returnDest && returnDest.dataset.bound !== 'true') {
        returnDest.addEventListener('change', () => { applyReturnCustomVisibility(); updateReturnRoutePreview(); });
        returnDest.dataset.bound = 'true';
    }
    const returnCustomDep = document.getElementById('return_custom_departure');
    const returnCustomDest = document.getElementById('return_custom_destination');
    if (returnCustomDep) returnCustomDep.addEventListener('input', updateReturnRoutePreview);
    if (returnCustomDest) returnCustomDest.addEventListener('input', updateReturnRoutePreview);

    // Populate the return departure/destination dropdowns from current city list
    populateReturnFlightLocations();
}

/**
 * Shows/hides the "Custom Return Airline / Departure / Destination" inputs
 * based on whether the corresponding select is set to CUSTOM.
 */
function applyReturnCustomVisibility() {
    const customizeOn = !!document.getElementById('returnCustomizeToggle')?.checked;
    const airlineSel = document.getElementById('return_airline');
    const depSel = document.getElementById('return_departure');
    const destSel = document.getElementById('return_destination');
    const customAirlineGroup = document.getElementById('return_custom_airline_group');
    const customDepGroup = document.getElementById('return_custom_departure_group');
    const customDestGroup = document.getElementById('return_custom_destination_group');

    if (customAirlineGroup) customAirlineGroup.hidden = !(customizeOn && airlineSel?.value === 'CUSTOM');
    if (customDepGroup) customDepGroup.hidden = !(customizeOn && depSel?.value === 'CUSTOM');
    if (customDestGroup) customDestGroup.hidden = !(customizeOn && destSel?.value === 'CUSTOM');
}

/**
 * Populates the Return Departure / Return Destination dropdowns from the
 * current CITIES list (mirrors the outbound location selects).
 */
export function populateReturnFlightLocations() {
    const flightTypeToggle = document.getElementById('flightTypeToggle');
    const isDomestic = !flightTypeToggle?.checked;
    const locations = isDomestic ? CITIES.DOMESTIC : CITIES.INTERNATIONAL;

    const returnDep = document.getElementById('return_departure');
    const returnDest = document.getElementById('return_destination');
    if (!returnDep || !returnDest) return;

    const buildOptions = (placeholder) => {
        return [`<option value="">${placeholder}</option>`]
            .concat(locations.map(loc => {
                const m = loc.match(/(.+) \((.+)\)/);
                const text = m ? `${m[2]} - ${m[1]}` : loc;
                return `<option value="${loc}">${text}</option>`;
            }))
            .concat(['<option value="CUSTOM">CUSTOM</option>'])
            .join('');
    };

    const depVal = returnDep.value;
    const destVal = returnDest.value;
    returnDep.innerHTML = buildOptions('Same as outbound destination');
    returnDest.innerHTML = buildOptions('Same as outbound departure');
    // Preserve user-selected values
    if (depVal) returnDep.value = depVal;
    if (destVal) returnDest.value = destVal;
}

/**
 * Builds the inner HTML for a single passenger card with three panels.
 */
function _buildPassengerCardHtml(idx, opts) {
    const { name = '', gender = '', nrc, passport, uid = idx } = opts;
    const intl = isInternationalFlight();
    const initials = (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase() || '?';
    const genderGroup = `pax-gender-${uid}`;

    const genderOpts = ['MR', 'MS', 'MSTR', 'MISS'].map(g => `
        <input type="radio" name="${genderGroup}" id="${genderGroup}-${g}" value="${g}" class="passenger-gender" ${g === gender ? 'checked' : ''}>
        <label for="${genderGroup}-${g}">${g}</label>
    `).join('');

    return `
        <div class="pax-card-header" data-role="header">
            <div class="pax-avatar" data-role="avatar">${initials}</div>
            <div class="pax-title">
                <div class="pax-number">Passenger ${idx}</div>
                <div class="pax-summary" data-role="summary">New passenger</div>
            </div>
            <span class="pax-status status-incomplete" data-role="status">
                <i class="fa-solid fa-circle-exclamation"></i> <span data-role="status-text">Incomplete</span>
            </span>
            <div class="pax-actions" onclick="event.stopPropagation()">
                <button type="button" class="icon-btn" title="Duplicate" data-action="duplicate"><i class="fa-solid fa-clone"></i></button>
                <button type="button" class="icon-btn" title="Remove" data-action="remove"><i class="fa-solid fa-trash"></i></button>
            </div>
            <button type="button" class="pax-collapse-btn" data-role="collapse-btn" title="Collapse / expand" aria-label="Collapse or expand passenger card" aria-expanded="true">
                <i class="fa-solid fa-chevron-down pax-collapse-chevron"></i>
            </button>
        </div>
        <div class="pax-card-body">

            <!-- ===== PANEL 1: IDENTITY ===== -->
            <div class="pax-panel">
                <h5 class="pax-panel-title"><i class="fa-solid fa-id-badge"></i> Identity</h5>
                <div class="form-grid">
                    <div class="form-group" style="grid-column: span 1;">
                        <label>Title</label>
                        <div class="gender-segment">${genderOpts}</div>
                    </div>
                    <div class="form-group" style="grid-column: span 2; position: relative;">
                        <label>Full Name <span class="req">*</span></label>
                        <input type="text" class="passenger-name" placeholder="PASSENGER FULL NAME" value="${(name || '').toUpperCase()}" required autocomplete="off">
                        <div class="autosuggest-box" style="display:none;"></div>
                    </div>
                    <div class="form-group">
                        <label>Date of Birth <span class="age-badge" data-role="age-badge" style="display:none;"></span></label>
                        <input type="text" class="passenger-dob" placeholder="DD/MM/YYYY" autocomplete="off">
                    </div>
                    <div class="form-group intl-only" style="${intl ? '' : 'display:none;'}">
                        <label>Nationality</label>
                        <input type="text" class="passenger-nationality" value="MMR" maxlength="3" style="text-transform:uppercase;">
                    </div>
                </div>
            </div>

            <!-- ===== PANEL 2: DOCUMENTS ===== -->
            <div class="pax-panel">
                <h5 class="pax-panel-title"><i class="fa-solid fa-passport"></i> Travel Documents</h5>
                <div class="doc-tabs" role="tablist">
                    <button type="button" class="doc-tab is-required ${!intl ? 'is-active' : ''}" data-tab="nrc" role="tab">
                        <i class="fa-solid fa-id-card"></i> NRC <span class="required-dot"></span>
                    </button>
                    <button type="button" class="doc-tab ${intl ? 'is-active is-required' : ''}" data-tab="passport" role="tab" ${!intl ? '' : ''}>
                        <i class="fa-solid fa-passport"></i> Passport <span class="required-dot"></span>
                    </button>
                </div>

                <!-- NRC panel -->
                <div class="doc-panel ${!intl ? 'is-active' : ''}" data-panel="nrc">
                    <div class="form-group" style="margin-bottom:0;">
                        <label>NRC Number</label>
                        <div class="nrc-input" data-role="nrc">
                            <input type="text" class="nrc-region" maxlength="2" inputmode="numeric" placeholder="12" value="${nrc?.region || ''}">
                            <span class="nrc-sep">/</span>
                            <input type="text" class="nrc-township" maxlength="10" placeholder="ABCDEF" value="${nrc?.township || ''}">
                            <span class="nrc-sep">(</span>
                            <input type="text" class="nrc-type" maxlength="5" placeholder="N" value="${nrc?.type || ''}">
                            <span class="nrc-sep">)</span>
                            <input type="text" class="nrc-serial" maxlength="7" inputmode="numeric" placeholder="123456" value="${nrc?.serial || ''}">
                        </div>
                        <div class="nrc-helper" data-role="nrc-helper">Format: 12/ABCDEF(N)123456</div>
                    </div>
                </div>

                <!-- Passport panel -->
                <div class="doc-panel ${intl ? 'is-active' : ''}" data-panel="passport">
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Passport Number <span class="req intl-only" style="${intl ? '' : 'display:none;'}">*</span></label>
                            <input type="text" class="passenger-passport-no" placeholder="M1234567" value="${passport?.no || ''}" style="text-transform:uppercase;">
                        </div>
                        <div class="form-group">
                            <label>Expiry Date</label>
                            <input type="text" class="passenger-passport-expiry" placeholder="DD/MM/YYYY" value="${passport?.expiry || ''}" autocomplete="off">
                        </div>
                    </div>
                    <div class="passport-expiry-warning" data-role="expiry-warning" hidden></div>
                    <div class="form-group" style="margin-top:1rem;">
                        <label>Passport Photo <span style="color:var(--text-secondary); font-weight:400; text-transform:none; letter-spacing:0;">(optional)</span></label>
                        <div class="passport-photo-zone" data-role="photo-zone">
                            <div class="pz-content">
                                <i class="fa-solid fa-cloud-arrow-up pz-icon"></i>
                                <div class="pz-text">Drop photo or <strong>click to upload</strong></div>
                                <div class="pz-hint">JPG, PNG up to 5 MB · auto-OCR + compressed</div>
                            </div>
                            <div class="pz-progress"><div class="pz-progress-bar" data-role="progress"></div></div>
                            <div class="pz-ocr-status" data-role="ocr-status"></div>
                            <input type="file" accept="image/*" class="passenger-passport-file">
                        </div>
                        <div class="passport-photo-preview ${passport?.photoUrl ? 'is-visible' : ''}" data-role="photo-preview">
                            <img src="${passport?.photoUrl || ''}" alt="Passport photo" data-role="photo-img">
                            <div class="pz-meta">
                                <span data-role="photo-name">Uploaded</span>
                                <div class="pz-meta-actions">
                                    <button type="button" data-action="photo-view">View</button>
                                    <button type="button" class="pz-remove" data-action="photo-remove">Remove</button>
                                </div>
                            </div>
                        </div>
                        <input type="hidden" class="passenger-passport-photo-url" value="${passport?.photoUrl || ''}">
                        <input type="hidden" class="passenger-passport-photo-path" value="${passport?.photoPath || ''}">
                    </div>
                </div>
            </div>

            <!-- ===== PANEL 2.5: MEMBER ID (optional) ===== -->
            <div class="pax-panel pax-panel-member">
                <div class="member-id-header" data-role="member-id-toggle">
                    <h5 class="pax-panel-title" style="margin:0;">
                        <i class="fa-solid fa-star"></i> Frequent Flyer / Member ID
                        <span class="member-id-optional">(optional)</span>
                    </h5>
                    <button type="button" class="member-id-toggle-btn" data-role="member-id-btn" aria-expanded="false">
                        <i class="fa-solid fa-plus"></i> Add
                    </button>
                </div>
                <div class="member-id-body" data-role="member-id-body" style="display:none;">
                    <!-- Rows injected by JS -->
                    <div class="member-id-list" data-role="member-id-list"></div>
                    <button type="button" class="member-id-add-more" data-role="member-id-add-more">
                        <i class="fa-solid fa-circle-plus"></i> Add another airline
                    </button>
                </div>
            </div>


            <div class="pax-panel">
                <h5 class="pax-panel-title"><i class="fa-solid fa-coins"></i> Pricing</h5>

                <!-- Leg tabs (visible only when round-trip is active) -->
                <div class="leg-tabs" role="tablist">
                    <button type="button" class="leg-tab is-active" data-leg="outbound" role="tab">
                        <i class="fa-solid fa-plane-departure"></i> Outbound
                        <span class="leg-total" data-role="outbound-leg-total">0</span>
                    </button>
                    <button type="button" class="leg-tab" data-leg="return" role="tab">
                        <i class="fa-solid fa-plane-arrival"></i> Return
                        <span class="leg-total" data-role="return-leg-total">0</span>
                    </button>
                </div>

                <!-- OUTBOUND leg -->
                <div class="leg-panel is-active" data-leg="outbound">
                    <div class="pricing-grid">
                        <div class="form-group">
                            <label>Base Fare</label>
                            <input type="number" class="passenger-base-fare" placeholder="0" min="0" step="1" inputmode="numeric">
                        </div>
                        <div class="form-group">
                            <label>Net Amount <span class="req">*</span></label>
                            <input type="number" class="passenger-net-amount" placeholder="0" min="0" step="1" inputmode="numeric" required>
                        </div>
                        <div class="form-group">
                            <label>Extra Fare</label>
                            <input type="number" class="passenger-extra-fare" placeholder="0" min="0" step="1" inputmode="numeric">
                        </div>
                        <div class="form-group">
                            <label>Commission</label>
                            <input type="number" class="passenger-commission" placeholder="0" min="0" step="1" inputmode="numeric">
                        </div>
                    </div>
                    <div class="form-group" style="margin-top:1rem;">
                        <label>Remarks</label>
                        <input type="text" class="passenger-remarks" placeholder="Optional notes">
                    </div>
                    <div class="pricing-totals">
                        <span class="label">Outbound subtotal (net + extra)</span>
                        <span class="value" data-role="outbound-subtotal">0 MMK</span>
                    </div>
                </div>

                <!-- RETURN leg (data submitted only when round-trip) -->
                <div class="leg-panel" data-leg="return">
                    <div class="pricing-grid">
                        <div class="form-group">
                            <label>Base Fare</label>
                            <input type="number" class="passenger-return-base-fare" placeholder="0" min="0" step="1" inputmode="numeric">
                        </div>
                        <div class="form-group">
                            <label>Net Amount <span class="req return-req">*</span></label>
                            <input type="number" class="passenger-return-net-amount" placeholder="0" min="0" step="1" inputmode="numeric">
                        </div>
                        <div class="form-group">
                            <label>Extra Fare</label>
                            <input type="number" class="passenger-return-extra-fare" placeholder="0" min="0" step="1" inputmode="numeric">
                        </div>
                        <div class="form-group">
                            <label>Commission</label>
                            <input type="number" class="passenger-return-commission" placeholder="0" min="0" step="1" inputmode="numeric">
                        </div>
                    </div>
                    <div class="form-group" style="margin-top:1rem;">
                        <label>Remarks</label>
                        <input type="text" class="passenger-return-remarks" placeholder="Optional notes">
                    </div>
                    <div class="pricing-totals">
                        <span class="label">Return subtotal (net + extra)</span>
                        <span class="value" data-role="return-subtotal">0 MMK</span>
                    </div>
                </div>

                <!-- Combined total (always visible) -->
                <div class="pricing-totals is-grand">
                    <span class="label">Passenger total</span>
                    <span class="value" data-role="pax-total">0 MMK</span>
                </div>
            </div>
        </div>
    `;
}

export function populatePassengerCardFromClient(formEl, client) {
    if (!formEl || !client) return;

    const nameInput = formEl.querySelector('.passenger-name');
    if (nameInput) nameInput.value = (client.name || '').toUpperCase();

    const parsed = parseLegacyNrc(client.nrc_no || client.id_no);
    if (parsed.region) {
        formEl.querySelector('.nrc-region').value = parsed.region;
        formEl.querySelector('.nrc-township').value = parsed.township;
        formEl.querySelector('.nrc-type').value = parsed.type;
        formEl.querySelector('.nrc-serial').value = parsed.serial;
        validateNrc(formEl);
    }

    const passportNo = client.passport_no || (!parsed.region ? client.id_no : '');
    if (passportNo) formEl.querySelector('.passenger-passport-no').value = String(passportNo).toUpperCase();
    if (client.passport_expiry && !isPlaceholderDate(client.passport_expiry)) {
        formEl.querySelector('.passenger-passport-expiry').value = client.passport_expiry;
        checkPassportExpiryWarning(formEl);
    }
    if (client.dob && !isPlaceholderDate(client.dob)) formEl.querySelector('.passenger-dob').value = client.dob;
    if (client.nationality) formEl.querySelector('.passenger-nationality').value = String(client.nationality).toUpperCase();

    if (client.passport_photo_url) {
        formEl.querySelector('.passenger-passport-photo-url').value = client.passport_photo_url;
        formEl.querySelector('.passenger-passport-photo-path').value = client.passport_photo_path || '';
        const preview = formEl.querySelector('[data-role="photo-preview"]');
        preview.querySelector('[data-role="photo-img"]').src = client.passport_photo_url;
        preview.querySelector('[data-role="photo-name"]').textContent = 'Saved document';
        preview.classList.add('is-visible');
    }

    if (client.gender) {
        const g = formEl.querySelector(`.passenger-gender[value="${client.gender}"]`);
        if (g) g.checked = true;
    }

    updateAgeBadge(formEl);
    updatePaxAvatar(formEl);
    updatePaxSummary(formEl);
    updatePaxStatus(formEl);
}

/**
 * Attaches all interactive behaviour to a freshly built passenger form.
 */
function _attachPaxBehaviour(formEl, opts = {}) {
    // ----- Collapse / expand -----
    const header = formEl.querySelector('[data-role="header"]');
    const collapseBtn = formEl.querySelector('[data-role="collapse-btn"]');
    const body = formEl.querySelector('.pax-card-body');
    const toggleCollapse = () => togglePassengerCardCollapse(formEl, collapseBtn);
    body?.addEventListener('transitionend', (e) => {
        if (e.propertyName !== 'max-height' || formEl.classList.contains('is-collapsed')) return;
        body.style.setProperty('--pax-body-max-height', 'none');
    });
    header.addEventListener('click', (e) => {
        // Ignore clicks on the action buttons cluster or the collapse button itself
        if (e.target.closest('.pax-actions')) return;
        if (e.target.closest('[data-role="collapse-btn"]')) return;
        toggleCollapse();
    });
    if (collapseBtn) {
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCollapse();
        });
    }

    // ----- Duplicate button -----
    formEl.querySelector('[data-action="duplicate"]').addEventListener('click', (e) => {
        e.stopPropagation();
        duplicatePassengerForm(formEl);
    });

    // ----- Remove button -----
    formEl.querySelector('[data-action="remove"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const container = document.getElementById('passenger-forms-container');
        if (container && container.children.length > 1) {
            formEl.remove();
            renumberPassengerForms();
            updateSummaryBar();
        } else {
            showToast('At least one passenger is required.', 'info');
        }
    });

    // ----- Auto-uppercase name -----
    const nameInput = formEl.querySelector('.passenger-name');
    nameInput.addEventListener('input', () => {
        const pos = nameInput.selectionStart;
        nameInput.value = nameInput.value.toUpperCase();
        nameInput.setSelectionRange(pos, pos);
        updatePaxAvatar(formEl);
        updatePaxSummary(formEl);
        updatePaxStatus(formEl);
    });

    formEl.querySelectorAll('.passenger-gender').forEach(input => {
        input.addEventListener('change', () => {
            updatePaxSummary(formEl);
            updatePaxStatus(formEl);
        });
    });

    const nationalityInput = formEl.querySelector('.passenger-nationality');
    if (nationalityInput) {
        nationalityInput.addEventListener('input', () => {
            const pos = nationalityInput.selectionStart;
            nationalityInput.value = nationalityInput.value.toUpperCase().replace(/[^A-Z]/g, '');
            nationalityInput.setSelectionRange(pos, pos);
            updatePaxStatus(formEl);
        });
    }

    // ----- DOB -> age badge -----
    const dobInput = formEl.querySelector('.passenger-dob');
    if (dobInput) {
        // Date picker (vanillajs-datepicker is loaded globally)
        try {
            if (window.Datepicker) {
                new window.Datepicker(dobInput, {
                    format: 'dd/mm/yyyy',
                    autohide: true,
                    minDate: new Date(1900, 0, 1),   // Allow DOB as far back as 1900
                    maxDate: new Date(),               // Can't be born in the future
                });
            }
        } catch (_) {}
        dobInput.addEventListener('change', () => updateAgeBadge(formEl));
        dobInput.addEventListener('input', () => updateAgeBadge(formEl));
    }


    // ----- NRC structured input: auto-advance & uppercase -----
    const nrcInputs = formEl.querySelectorAll('.nrc-input input');
    nrcInputs.forEach((input, i) => {
        input.addEventListener('input', () => {
            if (input.classList.contains('nrc-township') || input.classList.contains('nrc-type')) {
                const pos = input.selectionStart;
                input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
                input.setSelectionRange(pos, pos);
            } else {
                input.value = input.value.replace(/[^0-9]/g, '');
            }
            // Auto-advance when full
            if (input.value.length >= input.maxLength && i < nrcInputs.length - 1) {
                nrcInputs[i + 1].focus();
            }
            validateNrc(formEl);
            updatePaxStatus(formEl);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && i > 0) {
                nrcInputs[i - 1].focus();
            }
        });
    });

    // ----- Passport number uppercase -----
    const passportNoInput = formEl.querySelector('.passenger-passport-no');
    passportNoInput.addEventListener('input', () => {
        const pos = passportNoInput.selectionStart;
        passportNoInput.value = passportNoInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        passportNoInput.setSelectionRange(pos, pos);
        updatePaxSummary(formEl);
        updatePaxStatus(formEl);
    });

    // ----- Passport expiry date picker -----
    const expiryInput = formEl.querySelector('.passenger-passport-expiry');
    if (expiryInput) {
        try {
            if (window.Datepicker) {
                new window.Datepicker(expiryInput, { format: 'dd/mm/yyyy', autohide: true });
            }
        } catch (_) {}
        expiryInput.addEventListener('change', () => {
            updatePaxStatus(formEl);
            checkPassportExpiryWarning(formEl);
        });
        expiryInput.addEventListener('input', () => checkPassportExpiryWarning(formEl));
        // Initial check (in case the form is pre-populated)
        checkPassportExpiryWarning(formEl);
    }

    // ----- Document tab switching -----
    formEl.querySelectorAll('.doc-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            formEl.querySelectorAll('.doc-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === target));
            formEl.querySelectorAll('.doc-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === target));
        });
    });

    // ----- Passport photo upload -----
    _attachPhotoUpload(formEl);

    // ----- Member ID multi-row -----
    const memberBtn  = formEl.querySelector('[data-role="member-id-btn"]');
    const memberBody = formEl.querySelector('[data-role="member-id-body"]');
    const memberList = formEl.querySelector('[data-role="member-id-list"]');
    const memberAddMore = formEl.querySelector('[data-role="member-id-add-more"]');

    /** Creates one airline + member-ID row and appends it to memberList */
    function createMemberRow(airline = '', id = '') {
        const row = document.createElement('div');
        row.className = 'member-id-row';
        row.innerHTML = `
            <div class="form-group">
                <label>Airline / Programme</label>
                <input type="text" class="member-row-airline" placeholder="e.g. Myanmar Airways, KLM" value="${airline}" autocomplete="off">
            </div>
            <div class="form-group">
                <label>Member ID</label>
                <input type="text" class="member-row-id" placeholder="e.g. KL1234567" value="${id}" autocomplete="off">
            </div>
            <button type="button" class="member-row-remove" title="Remove this entry" aria-label="Remove">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        // Uppercase on input
        const idInput = row.querySelector('.member-row-id');
        idInput.addEventListener('input', () => {
            const p = idInput.selectionStart;
            idInput.value = idInput.value.toUpperCase();
            idInput.setSelectionRange(p, p);
        });
        // Remove row button
        row.querySelector('.member-row-remove').addEventListener('click', () => {
            row.remove();
            // If no rows left, collapse the panel
            if (!memberList.children.length) {
                memberBody.style.display = 'none';
                memberBtn.setAttribute('aria-expanded', 'false');
                memberBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
            }
        });
        memberList.appendChild(row);
        return row;
    }

    if (memberBtn && memberBody && memberList) {
        // Auto-expand if pre-filled (from saved data)
        const preAirline = opts.memberAirline || '';
        const preId = opts.memberId || '';
        if (preId || preAirline) {
            createMemberRow(preAirline, preId);
            memberBody.style.display = '';
            memberBtn.setAttribute('aria-expanded', 'true');
            memberBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Remove all';
        }

        // Toggle panel open/close
        memberBtn.addEventListener('click', () => {
            const isOpen = memberBody.style.display !== 'none';
            if (isOpen) {
                // Collapse & clear all rows
                memberList.innerHTML = '';
                memberBody.style.display = 'none';
                memberBtn.setAttribute('aria-expanded', 'false');
                memberBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
            } else {
                memberBody.style.display = '';
                memberBtn.setAttribute('aria-expanded', 'true');
                memberBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Remove all';
                // Start with one empty row
                if (!memberList.children.length) createMemberRow();
            }
        });

        // Add another row
        if (memberAddMore) {
            memberAddMore.addEventListener('click', () => {
                const newRow = createMemberRow();
                newRow.querySelector('.member-row-airline').focus();
            });
        }
    }


    [
        'passenger-base-fare', 'passenger-net-amount', 'passenger-extra-fare', 'passenger-commission',
        'passenger-return-base-fare', 'passenger-return-net-amount', 'passenger-return-extra-fare', 'passenger-return-commission'
    ].forEach(cls => {
        const el = formEl.querySelector('.' + cls);
        if (!el) return;
        el.addEventListener('input', () => {
            updatePaxTotal(formEl);
            updatePaxStatus(formEl);
            updateSummaryBar();
        });
    });

    // ----- Leg tab switching (Outbound / Return) -----
    formEl.querySelectorAll('.leg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.leg;
            formEl.querySelectorAll('.leg-tab').forEach(t => t.classList.toggle('is-active', t.dataset.leg === target));
            formEl.querySelectorAll('.leg-panel').forEach(p => p.classList.toggle('is-active', p.dataset.leg === target));
        });
    });

    // ----- Existing-client autosuggest is available on every passenger name -----
    const suggestBox = formEl.querySelector('.passenger-name + .autosuggest-box');
    if (suggestBox) {
        setupPassengerAutoSuggest(nameInput, suggestBox, (client) => {
            // Do not overwrite OCR data with client record while passport is being processed
            if (formEl._ocrFilling) return;
            populatePassengerCardFromClient(formEl, client);
            suggestBox.style.display = 'none';
        });

    }

    // Initial state
    updatePaxAvatar(formEl);
    updatePaxSummary(formEl);
    updatePaxStatus(formEl);
    updatePaxTotal(formEl);
    applyFlightTypeToCard(formEl);
    applyTripTypeToCard(formEl);
}

/**
 * Resizes an image File to a Base64 JPEG data-URI.
 * Downscales to maxWidth while preserving aspect ratio.
 *
 * @param {File} file
 * @param {number} [maxWidth=1600]
 * @param {number} [quality=0.9]
 * @returns {Promise<string>} data:image/jpeg;base64,...
 */
async function resizeImageToBase64(file, maxWidth = 800, quality = 0.75) {
    const imageBitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / imageBitmap.width);

    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(imageBitmap.width * scale);
    canvas.height = Math.round(imageBitmap.height * scale);

    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    console.log(`[resize] ${imageBitmap.width}x${imageBitmap.height} -> ${canvas.width}x${canvas.height} | base64 size: ${(dataUrl.length / 1024).toFixed(0)} KB`);
    return dataUrl;
}

/**
 * Calls the Gemini Passport OCR Netlify Function.
 *
 * @param {File} file - The passport image file.
 * @param {number} [passengerIndex=0] - Index of the passenger (for logging).
 * @returns {Promise<Object>} Parsed OCR result.
 * @throws {Error} If Gemini OCR fails.
 */
export async function scanPassportWithGemini(file, passengerIndex = 0) {
    console.log('[Passport upload] file:', file.name, file.size);

    const imageBase64 = await resizeImageToBase64(file);

    console.log('[Gemini request] sending to /.netlify/functions/gemini-passport-ocr');

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 60000); // Increased timeout to 60s

    const response = await fetch('/.netlify/functions/gemini-passport-ocr', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
            imageBase64,
            mimeType: 'image/jpeg',
        }),
    });
    clearTimeout(abortTimer);

    const data = await response.json();

    console.log('[Gemini passport OCR]', data);

    if (!data.ok) {
        throw new Error(data.error || 'Gemini passport OCR failed');
    }

    const finalFields = {
        fullName: data.fullName || '',
        passportNumber: data.passportNo || '',
        dateOfBirth: data.dob || '',
        expiryDate: data.expiry || '',
        nationality: data.nationality || '',
        sex: data.sex || '',
        title: data.title || '',
    };

    console.log('[Final applied passenger fields]', finalFields);

    return finalFields;
}

/**
 * Wires up the passport photo upload, preview, and remove flow for a card.
 */
function _attachPhotoUpload(formEl) {
    const zone = formEl.querySelector('[data-role="photo-zone"]');
    const fileInput = formEl.querySelector('.passenger-passport-file');
    const preview = formEl.querySelector('[data-role="photo-preview"]');
    const previewImg = preview.querySelector('[data-role="photo-img"]');
    const previewName = preview.querySelector('[data-role="photo-name"]');
    const urlHidden = formEl.querySelector('.passenger-passport-photo-url');
    const pathHidden = formEl.querySelector('.passenger-passport-photo-path');
    const progressBar = zone.querySelector('[data-role="progress"]');
    const ocrStatusEl = zone.querySelector('[data-role="ocr-status"]');
    const passportNoInput = formEl.querySelector('.passenger-passport-no');

    /**
     * Applies OCR results to the passenger form fields.
     * Always overwrites fields with passport data (re-upload = re-fill).
     */
    function applyOcrResults(ocr) {
        if (!ocr) return;
        console.log('[applyOcrResults] OCR data:', JSON.stringify(ocr));

        // Passport number (support both old and new field names)
        const passportNo = ocr.passportNo || ocr.passportNumber || '';
        if (passportNo) {
            passportNoInput.value = passportNo;
            passportNoInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Suppress autosuggest during OCR fill so a client record match
        // cannot overwrite the passport-accurate DOB/expiry with stale saved data.
        formEl._ocrFilling = true;

        // Full name (support both old and new field names)
        const fullName = ocr.name || ocr.fullName || '';
        const nameInput = formEl.querySelector('.passenger-name');
        if (fullName && nameInput) {
            nameInput.value = fullName.toUpperCase();
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Date of birth (support both old and new field names)
        const dob = ocr.dob || ocr.dateOfBirth || '';
        const dobInput = formEl.querySelector('.passenger-dob');
        console.log('[applyOcrResults] DOB from OCR:', dob, '| dobInput exists:', !!dobInput);
        if (dob && dobInput) {
            const dobResult = setDateInputFromOcr(dobInput, dob, { isBirth: true });
            console.log('[applyOcrResults] DOB set result:', dobResult, '| input.value:', dobInput.value);
        }

        // Expiry date (support both old and new field names)
        const ocrExpiry = ocr.expiry || ocr.expiryDate || ocr.expirationDate || ocr.dateOfExpiry || ocr.date_of_expiry || '';
        const expiryInput = formEl.querySelector('.passenger-passport-expiry');
        console.log('[applyOcrResults] Expiry from OCR:', ocrExpiry, '| expiryInput exists:', !!expiryInput);
        if (ocrExpiry && expiryInput) {
            const expResult = setDateInputFromOcr(expiryInput, ocrExpiry, { isBirth: false });
            console.log('[applyOcrResults] Expiry set result:', expResult, '| input.value:', expiryInput.value);
            checkPassportExpiryWarning(formEl);
        }

        // Title / Sex (support both old and new field names)
        const title = ocr.title || (ocr.sex === 'F' ? 'MS' : ocr.sex === 'M' ? 'MR' : '');
        console.log('[applyOcrResults] Title from OCR:', title);
        if (title) {
            const genderRadio = formEl.querySelector(`.passenger-gender[value="${title}"]`);
            console.log('[applyOcrResults] genderRadio found:', !!genderRadio);
            if (genderRadio) {
                genderRadio.checked = true;
                genderRadio.dispatchEvent(new Event('change', { bubbles: true }));
                genderRadio.dispatchEvent(new Event('click', { bubbles: true }));
            }
        }

        // Nationality
        const natInput = formEl.querySelector('.passenger-nationality');
        if (natInput) {
            natInput.value = (ocr.nationality || 'MMR').toUpperCase();
        }

        // Refresh all UI helpers (including age badge)
        updateAgeBadge(formEl);
        updatePaxAvatar(formEl);
        updatePaxSummary(formEl);
        updatePaxStatus(formEl);

        // Re-enable autosuggest now that OCR fill is complete
        formEl._ocrFilling = false;

        // Final debug log with all applied fields
        const finalFields = {
            name: formEl.querySelector('.passenger-name')?.value || '',
            passportNo: passportNoInput?.value || '',
            dob: formEl.querySelector('.passenger-dob')?.value || '',
            expiry: formEl.querySelector('.passenger-passport-expiry')?.value || '',
            nationality: formEl.querySelector('.passenger-nationality')?.value || '',
            title: formEl.querySelector('.passenger-gender:checked')?.value || '',
        };
        console.log('[Final applied passenger fields]', finalFields);
    }

    const handleFile = async (file) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('Please choose an image file.', 'error');
            return;
        }
        zone.classList.add('is-uploading');
        progressBar.style.width = '0%';

        // Show OCR status
        ocrStatusEl.textContent = '';
        ocrStatusEl.className = 'pz-ocr-status';

        // Run upload and OCR in parallel (upload always; OCR = Gemini first, Tesseract fallback)
        const uploadPromise = uploadPassportPhoto(file, {
            passportNo: passportNoInput.value || 'unknown',
            onProgress: (pct) => { progressBar.style.width = `${pct}%`; }
        });

        let ocrResult = null;

        // 1) Try Gemini first
        try {
            ocrStatusEl.textContent = 'Scanning with Gemini...';
            ocrStatusEl.className = 'pz-ocr-status is-scanning';
            ocrResult = await scanPassportWithGemini(file, 0);
        } catch (error) {
            console.warn('[Gemini failed, using fallback OCR]', error);
            ocrStatusEl.textContent = 'Gemini failed, falling back...';
            // 2) Fallback to Tesseract.js client-side OCR
            try {
                ocrResult = await ocrPassport(file, (msg) => {
                    ocrStatusEl.textContent = msg;
                    ocrStatusEl.className = 'pz-ocr-status is-scanning';
                });
            } catch (fallbackErr) {
                console.error('[Fallback OCR] Failed:', fallbackErr);
            }
        }

        try {
            const uploadResult = await uploadPromise;

            // Handle upload result
            urlHidden.value = uploadResult.url;
            pathHidden.value = uploadResult.path;
            previewImg.src = uploadResult.url;
            previewName.textContent = file.name;
            preview.classList.add('is-visible');

            // Handle OCR result
            if (ocrResult) {
                applyOcrResults(ocrResult);
                ocrStatusEl.textContent = '✓ Passport data extracted';
                ocrStatusEl.className = 'pz-ocr-status is-success';
                showToast('Passport uploaded & data extracted!', 'success');
            } else {
                ocrStatusEl.textContent = 'Could not read passport data';
                ocrStatusEl.className = 'pz-ocr-status is-warn';
                showToast('Passport uploaded. OCR could not extract data.', 'info');
            }
        } catch (err) {
            console.error(err);
            showToast(err.message || 'Upload failed.', 'error');
            ocrStatusEl.textContent = '';
            ocrStatusEl.className = 'pz-ocr-status';
        } finally {
            zone.classList.remove('is-uploading');
            fileInput.value = '';
            // Fade out OCR status after a few seconds
            setTimeout(() => {
                ocrStatusEl.classList.add('is-fading');
                setTimeout(() => {
                    ocrStatusEl.textContent = '';
                    ocrStatusEl.className = 'pz-ocr-status';
                }, 600);
            }, 4000);
        }
    };

    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    // Drag & drop
    ['dragenter', 'dragover'].forEach(evt => {
        zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('is-dragover'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('is-dragover'); });
    });
    zone.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFile(file);
    });

    // View / Remove buttons in preview
    preview.querySelector('[data-action="photo-view"]').addEventListener('click', () => {
        if (urlHidden.value) openPhotoLightbox(urlHidden.value);
    });
    preview.querySelector('[data-action="photo-remove"]').addEventListener('click', async () => {
        const path = pathHidden.value;
        urlHidden.value = '';
        pathHidden.value = '';
        previewImg.src = '';
        preview.classList.remove('is-visible');
        if (path) {
            try { await deletePassportPhoto(path); } catch (_) {}
        }

        // Clear all OCR-filled fields when passport is removed
        const nameInput   = formEl.querySelector('.passenger-name');
        const dobInput    = formEl.querySelector('.passenger-dob');
        const expiryInput = formEl.querySelector('.passenger-passport-expiry');
        const natInput    = formEl.querySelector('.passenger-nationality');

        if (nameInput)   { nameInput.value = '';   nameInput.dispatchEvent(new Event('input', { bubbles: true })); }
        if (passportNoInput) { passportNoInput.value = ''; passportNoInput.dispatchEvent(new Event('input', { bubbles: true })); }
        if (dobInput) {
            if (dobInput.datepicker) dobInput.datepicker.setDate({ clear: true });
            dobInput.value = '';
            dobInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (expiryInput) {
            if (expiryInput.datepicker) expiryInput.datepicker.setDate({ clear: true });
            expiryInput.value = '';
            expiryInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (natInput)    { natInput.value = 'MMR'; }

        // Refresh UI
        updateAgeBadge(formEl);
        updatePaxAvatar(formEl);
        updatePaxSummary(formEl);
        updatePaxStatus(formEl);

        showToast('Passport photo removed. Fields cleared.', 'info');
    });

    previewImg.addEventListener('click', () => {
        if (urlHidden.value) openPhotoLightbox(urlHidden.value);
    });
}

/**
 * Validates the NRC sub-inputs and toggles error styling.
 * Returns true when all four parts are filled (or all empty).
 */
function validateNrc(formEl) {
    const wrap = formEl.querySelector('[data-role="nrc"]');
    const helper = formEl.querySelector('[data-role="nrc-helper"]');
    const region = formEl.querySelector('.nrc-region').value.trim();
    const township = formEl.querySelector('.nrc-township').value.trim();
    const type = formEl.querySelector('.nrc-type').value.trim();
    const serial = formEl.querySelector('.nrc-serial').value.trim();
    const filled = [region, township, type, serial].filter(Boolean).length;
    if (filled === 0 || filled === 4) {
        wrap.classList.remove('is-invalid');
        helper.classList.remove('is-error');
        helper.textContent = 'Format: 12/ABCDEF(N)123456';
        return filled === 4;
    }
    wrap.classList.add('is-invalid');
    helper.classList.add('is-error');
    helper.textContent = 'Please complete all NRC parts.';
    return false;
}

function updatePaxAvatar(formEl) {
    const avatar = formEl.querySelector('[data-role="avatar"]');
    const name = formEl.querySelector('.passenger-name').value.trim();
    avatar.textContent = name ? name.split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase() : '?';
}

function updatePaxSummary(formEl) {
    const summary = formEl.querySelector('[data-role="summary"]');
    const name = formEl.querySelector('.passenger-name').value.trim();
    const gender = formEl.querySelector('.passenger-gender:checked')?.value || '';
    const age = ageFromDob(formEl.querySelector('.passenger-dob').value);
    const bucket = ageBucket(age);
    let id = '';
    const intl = isInternationalFlight();
    if (intl) {
        id = formEl.querySelector('.passenger-passport-no').value.trim();
    } else {
        id = joinNrc({
            region: formEl.querySelector('.nrc-region').value,
            township: formEl.querySelector('.nrc-township').value,
            type: formEl.querySelector('.nrc-type').value,
            serial: formEl.querySelector('.nrc-serial').value
        });
    }
    const parts = [];
    if (name) parts.push(`${gender ? gender + ' ' : ''}${name}`);
    if (bucket) parts.push(bucket);
    if (id) parts.push(id);
    summary.textContent = parts.length ? parts.join(' · ') : 'New passenger';
}

function updateAgeBadge(formEl) {
    const badge = formEl.querySelector('[data-role="age-badge"]');
    if (!badge) return;
    const age = ageFromDob(formEl.querySelector('.passenger-dob').value);
    if (age === null) {
        badge.style.display = 'none';
    } else {
        badge.style.display = 'inline-block';
        badge.textContent = `${age} y · ${ageBucket(age)}`;
    }
    updatePaxSummary(formEl);
}

function updatePaxStatus(formEl) {
    const ok = isPassengerComplete(formEl);
    const statusEl = formEl.querySelector('[data-role="status"]');
    const statusText = formEl.querySelector('[data-role="status-text"]');
    if (ok) {
        statusEl.classList.remove('status-incomplete');
        statusEl.classList.add('status-complete');
        statusEl.querySelector('i').className = 'fa-solid fa-circle-check';
        statusText.textContent = 'Complete';
        formEl.classList.add('is-complete');
        formEl.classList.remove('is-incomplete');
    } else {
        statusEl.classList.add('status-incomplete');
        statusEl.classList.remove('status-complete');
        statusEl.querySelector('i').className = 'fa-solid fa-circle-exclamation';
        statusText.textContent = 'Incomplete';
        formEl.classList.add('is-incomplete');
        formEl.classList.remove('is-complete');
    }
    updatePaxSummary(formEl);
}

/**
 * Checks the passenger's passport expiry date and shows a warning banner
 * if it is expired or within 6 months of expiry.
 */
function checkPassportExpiryWarning(formEl) {
    if (!formEl) return;
    const banner = formEl.querySelector('[data-role="expiry-warning"]');
    const expiryInput = formEl.querySelector('.passenger-passport-expiry');
    if (!banner || !expiryInput) return;

    const raw = (expiryInput.value || '').trim();
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) {
        banner.hidden = true;
        banner.textContent = '';
        banner.className = 'passport-expiry-warning';
        return;
    }

    const mm = Number(match[1]);
    const dd = Number(match[2]);
    const yyyy = Number(match[3]);
    const expiry = new Date(yyyy, mm - 1, dd);
    if (isNaN(expiry.getTime())) {
        banner.hidden = true;
        return;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sixMonthsFromNow = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
    const daysUntilExpiry = Math.round((expiry - today) / (1000 * 60 * 60 * 24));

    const formatted = expiry.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    if (expiry < today) {
        // Expired
        banner.hidden = false;
        banner.className = 'passport-expiry-warning is-expired';
        banner.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> <strong>Passport EXPIRED</strong> on ${formatted} (${Math.abs(daysUntilExpiry)} days ago). A new passport is required before travel.`;
    } else if (expiry < sixMonthsFromNow) {
        // Expiring within 6 months
        banner.hidden = false;
        banner.className = 'passport-expiry-warning is-soon';
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Passport expires soon</strong> on ${formatted} (in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}). Many airlines require at least 6 months validity \u2014 request a new passport before booking.`;
    } else {
        // Plenty of validity left
        banner.hidden = true;
        banner.textContent = '';
        banner.className = 'passport-expiry-warning';
    }
}

function isPassengerComplete(formEl) {
    const name = formEl.querySelector('.passenger-name').value.trim();
    const net = parseFloat(formEl.querySelector('.passenger-net-amount').value) || 0;
    if (!name || !net) return false;

    // Round-trip: return leg must also have net amount
    if (isRoundTrip()) {
        const retNet = parseFloat(formEl.querySelector('.passenger-return-net-amount')?.value) || 0;
        if (!retNet) return false;
    }

    const intl = isInternationalFlight();
    if (intl) {
        // International requires NRC (full) AND passport number
        const nrcOk = validateNrc(formEl);
        const passport = formEl.querySelector('.passenger-passport-no').value.trim();
        return nrcOk && passport.length >= 5;
    } else {
        // Domestic requires NRC only
        return validateNrc(formEl);
    }
}

function updatePaxTotal(formEl) {
    const obNet = parseFloat(formEl.querySelector('.passenger-net-amount').value) || 0;
    const obExtra = parseFloat(formEl.querySelector('.passenger-extra-fare').value) || 0;
    const obSubtotal = obNet + obExtra;

    let retSubtotal = 0;
    if (isRoundTrip()) {
        const retNet = parseFloat(formEl.querySelector('.passenger-return-net-amount')?.value) || 0;
        const retExtra = parseFloat(formEl.querySelector('.passenger-return-extra-fare')?.value) || 0;
        retSubtotal = retNet + retExtra;
    }

    const obSubEl = formEl.querySelector('[data-role="outbound-subtotal"]');
    const retSubEl = formEl.querySelector('[data-role="return-subtotal"]');
    const obLegEl = formEl.querySelector('[data-role="outbound-leg-total"]');
    const retLegEl = formEl.querySelector('[data-role="return-leg-total"]');
    const totalEl = formEl.querySelector('[data-role="pax-total"]');

    if (obSubEl) obSubEl.textContent = `${obSubtotal.toLocaleString()} MMK`;
    if (retSubEl) retSubEl.textContent = `${retSubtotal.toLocaleString()} MMK`;
    if (obLegEl) obLegEl.textContent = obSubtotal.toLocaleString();
    if (retLegEl) retLegEl.textContent = retSubtotal.toLocaleString();
    if (totalEl) totalEl.textContent = `${(obSubtotal + retSubtotal).toLocaleString()} MMK`;
}

/**
 * Applies the current Domestic/International flight type to the card:
 * shows/hides the passport tab, swaps default active tab, toggles required dots.
 */
export function applyFlightTypeToCard(formEl) {
    const intl = isInternationalFlight();
    formEl.classList.toggle('is-international', intl);
    formEl.classList.toggle('is-domestic', !intl);

    const nrcTab = formEl.querySelector('.doc-tab[data-tab="nrc"]');
    const passportTab = formEl.querySelector('.doc-tab[data-tab="passport"]');
    const nrcPanel = formEl.querySelector('.doc-panel[data-panel="nrc"]');
    const passportPanel = formEl.querySelector('.doc-panel[data-panel="passport"]');

    nrcTab.classList.add('is-required');
    passportTab.classList.toggle('is-required', intl);
    passportTab.hidden = !intl;
    passportPanel.hidden = !intl;

    // Show intl-only elements
    formEl.querySelectorAll('.intl-only').forEach(el => {
        el.style.display = intl ? '' : 'none';
    });

    // Default tab: domestic → NRC, international → Passport
    if (intl) {
        nrcTab.classList.remove('is-active');
        passportTab.classList.add('is-active');
        nrcPanel.classList.remove('is-active');
        passportPanel.classList.add('is-active');
    } else {
        nrcTab.classList.add('is-active');
        passportTab.classList.remove('is-active');
        nrcPanel.classList.add('is-active');
        passportPanel.classList.remove('is-active');
    }
    updatePaxStatus(formEl);
}

/**
 * Re-applies flight type to every passenger card. Called when toggle changes.
 */
export function applyFlightTypeToAllPaxForms() {
    document.querySelectorAll('#passenger-forms-container .passenger-form').forEach(applyFlightTypeToCard);
    updateSummaryBar();
}

/**
 * Applies the current Trip Type (one-way / round-trip) to a single passenger card.
 * Adds/removes the `is-roundtrip` class which CSS uses to show/hide leg tabs &
 * the return leg panel. Also recalculates totals.
 */
export function applyTripTypeToCard(formEl) {
    const round = isRoundTrip();
    formEl.classList.toggle('is-roundtrip', round);

    // Ensure outbound tab is active when toggling
    const outboundTab = formEl.querySelector('.leg-tab[data-leg="outbound"]');
    const returnTab = formEl.querySelector('.leg-tab[data-leg="return"]');
    const outboundPanel = formEl.querySelector('.leg-panel[data-leg="outbound"]');
    const returnPanel = formEl.querySelector('.leg-panel[data-leg="return"]');
    if (outboundTab && returnTab && outboundPanel && returnPanel) {
        if (!round) {
            outboundTab.classList.add('is-active');
            returnTab.classList.remove('is-active');
            outboundPanel.classList.add('is-active');
            returnPanel.classList.remove('is-active');
        }
    }

    updatePaxTotal(formEl);
    updatePaxStatus(formEl);
}

/**
 * Re-applies trip type to every passenger card AND syncs the Booking Context
 * Return Flight section visibility. Called when the Trip Type segment changes.
 */
export function applyTripTypeToUI() {
    const round = isRoundTrip();
    const returnBlock = document.getElementById('returnFlightBlock');
    if (returnBlock) returnBlock.hidden = !round;

    document.querySelectorAll('#passenger-forms-container .passenger-form').forEach(applyTripTypeToCard);
    updateSummaryBar();
    updateReturnRoutePreview();
}

/**
 * Updates the small subtitle inside the Return Flight block to show the
 * inverted route (or the custom override when set).
 */
export function updateReturnRoutePreview() {
    const preview = document.getElementById('returnRoutePreview');
    if (!preview) return;
    const out = {
        from: getSelectedOrCustomValue('departure', 'custom_departure'),
        to: getSelectedOrCustomValue('destination', 'custom_destination')
    };
    const ret = {
        from: getSelectedOrCustomValue('return_departure', 'return_custom_departure') || out.to,
        to: getSelectedOrCustomValue('return_destination', 'return_custom_destination') || out.from
    };
    if (ret.from && ret.to) {
        preview.textContent = `${ret.from.split(' ')[0]} → ${ret.to.split(' ')[0]}`;
    } else {
        preview.textContent = 'Defaults to reverse of the outbound route';
    }
}

/**
 * Re-numbers passenger cards (so "Passenger 1, 2, 3..." stays correct after remove).
 */
function renumberPassengerForms() {
    const container = document.getElementById('passenger-forms-container');
    if (!container) return;
    [...container.children].forEach((form, i) => {
        const numEl = form.querySelector('.pax-number');
        if (numEl) numEl.textContent = `Passenger ${i + 1}`;
    });
    const removeBtn = document.getElementById('removePassengerBtn');
    if (removeBtn) removeBtn.style.display = container.children.length > 1 ? 'inline-flex' : 'none';
    const badge = document.getElementById('passengerCountBadge');
    if (badge) badge.textContent = container.children.length;
}

/**
 * Updates the sticky bottom summary bar with totals.
 */
export function updateSummaryBar() {
    const cards = document.querySelectorAll('#passenger-forms-container .passenger-form');
    const round = isRoundTrip();
    let totalNet = 0;
    let totalCommission = 0;
    cards.forEach(card => {
        const net = parseFloat(card.querySelector('.passenger-net-amount').value) || 0;
        const extra = parseFloat(card.querySelector('.passenger-extra-fare').value) || 0;
        const commission = parseFloat(card.querySelector('.passenger-commission').value) || 0;
        totalNet += net + extra;
        totalCommission += calculateAgentCut(commission);
        if (round) {
            const retNet = parseFloat(card.querySelector('.passenger-return-net-amount')?.value) || 0;
            const retExtra = parseFloat(card.querySelector('.passenger-return-extra-fare')?.value) || 0;
            const retCommission = parseFloat(card.querySelector('.passenger-return-commission')?.value) || 0;
            totalNet += retNet + retExtra;
            totalCommission += calculateAgentCut(retCommission);
        }
    });
    const paxCountEl = document.getElementById('summaryPaxCount');
    const totalEl = document.getElementById('summaryTotal');
    const commissionEl = document.getElementById('summaryCommission');
    const bar = document.getElementById('stickySummaryBar');
    if (paxCountEl) paxCountEl.textContent = `${cards.length}${round ? ` × 2` : ''}`;
    if (totalEl) totalEl.textContent = `${totalNet.toLocaleString()} MMK`;
    if (commissionEl) commissionEl.textContent = `${totalCommission.toLocaleString()} MMK`;
    if (bar) bar.classList.toggle('is-visible', cards.length > 0);
}

/**
 * Duplicates a passenger card (keeps fare/commission, clears identity & docs).
 */
function duplicatePassengerForm(srcEl) {
    const gender = srcEl.querySelector('.passenger-gender:checked')?.value || '';
    const fields = [
        'passenger-base-fare', 'passenger-net-amount', 'passenger-extra-fare', 'passenger-commission',
        'passenger-return-base-fare', 'passenger-return-net-amount', 'passenger-return-extra-fare', 'passenger-return-commission'
    ];
    const values = Object.fromEntries(fields.map(c => [c, srcEl.querySelector('.' + c)?.value || '']));

    addPassengerForm('', '', gender);
    const lastCard = document.getElementById('passenger-forms-container').lastElementChild;
    if (lastCard) {
        fields.forEach(c => {
            const el = lastCard.querySelector('.' + c);
            if (el) el.value = values[c];
        });
        updatePaxTotal(lastCard);
        updatePaxStatus(lastCard);
        updateSummaryBar();
    }
}

/**
 * Resets the passenger forms in the 'Sell Ticket' view to a single default form.
 */
export function resetPassengerForms() {
    const container = document.getElementById('passenger-forms-container');
    if (!container) return;
    container.innerHTML = '';
    passengerFormSeq = 0;
    addPassengerForm();
    const removeBtn = document.getElementById('removePassengerBtn');
    if (removeBtn) removeBtn.style.display = 'none';
    updateSummaryBar();
}

export function addPassengerForm(name = '', idNo = '', gender = '') {
    const container = document.getElementById('passenger-forms-container');
    if (!container) return;

    const idx = container.children.length + 1;
    const nrc = parseLegacyNrc(idNo);
    const passport = (!nrc.region && idNo) ? { no: String(idNo).toUpperCase() } : undefined;

    const newForm = document.createElement('div');
    newForm.className = 'passenger-form';
    newForm.innerHTML = _buildPassengerCardHtml(idx, { name, gender, nrc, passport, uid: ++passengerFormSeq });
    container.appendChild(newForm);

    _attachPaxBehaviour(newForm);
    renumberPassengerForms();
    updateSummaryBar();
    return newForm;
}

/**
 * Adds a passenger form that lets the user auto-fill from existing clients.
 */
export function addExistingPassengerForm() {
    const container = document.getElementById('passenger-forms-container');
    if (!container) return;
    const idx = container.children.length + 1;

    const newForm = document.createElement('div');
    newForm.className = 'passenger-form';
    newForm.innerHTML = _buildPassengerCardHtml(idx, { name: '', gender: '', uid: ++passengerFormSeq });
    container.appendChild(newForm);

    _attachPaxBehaviour(newForm, { withAutoSuggest: true });
    renumberPassengerForms();
    updateSummaryBar();

    // Focus the name field to immediately start typing
    const nameInput = newForm.querySelector('.passenger-name');
    if (nameInput) {
        nameInput.placeholder = 'Type to search existing clients…';
        setTimeout(() => nameInput.focus(), 0);
    }
    return newForm;
}

/**
 * Sets up the auto-suggest logic for passenger name inputs.
 * @param {HTMLInputElement} input The input element to attach listener to.
 * @param {HTMLElement} box The suggestion box container.
 * @param {Function} onSelect Callback when a client is selected.
 */
function setupPassengerAutoSuggest(input, box, onSelect) {
    input.addEventListener('input', () => {
        // Do not show autosuggest while OCR is filling fields
        const formEl = input.closest('.pax-card');
        if (formEl?._ocrFilling) {
            box.style.display = 'none';
            return;
        }

        const val = input.value.trim().toLowerCase();

        if (!val) {
            box.style.display = 'none';
            return;
        }

        const currentAccount = (document.getElementById('account_name')?.value || '').toLowerCase();

        // Filter clients - excluding (Fees) entries
        const matches = state.allClients.filter(c => {
            const nameLower = c.name.toLowerCase();
            return nameLower.includes(val) && !nameLower.includes('(fees)');
        });
        
        // Sort: Prioritize same social account name, then alphabetical
        matches.sort((a, b) => {
            const aAcc = (a.account_name || '').toLowerCase();
            const bAcc = (b.account_name || '').toLowerCase();
            const aMatch = aAcc === currentAccount && currentAccount !== '';
            const bMatch = bAcc === currentAccount && currentAccount !== '';

            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
            return a.name.localeCompare(b.name);
        });

        const topMatches = matches.slice(0, 8); // Limit to 8 suggestions

        if (topMatches.length === 0) {
            box.style.display = 'none';
            return;
        }

        box.innerHTML = '';
        topMatches.forEach(c => {
            const div = document.createElement('div');
            div.className = 'autosuggest-item';
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
            
            // Highlight text if it matches current account
            const isPrioritized = (c.account_name || '').toLowerCase() === currentAccount && currentAccount !== '';
            const star = isPrioritized ? '<i class="fa-solid fa-star" style="color:var(--primary-accent); margin-right:5px; font-size:0.8em;"></i>' : '';
            
            div.innerHTML = `
                <div style="font-weight:500;">${star}${c.name}</div>
                <div style="font-size:0.8em; opacity:0.7;">
                    ${c.phone ? `<i class="fa-solid fa-phone"></i> ${c.phone}` : ''} 
                    ${c.account_name ? `| ${c.account_name}` : ''}
                </div>
            `;
            
            // Hover effect
            div.onmouseover = () => { div.style.backgroundColor = 'rgba(255,255,255,0.1)'; };
            div.onmouseout = () => { div.style.backgroundColor = 'transparent'; };

            div.addEventListener('click', () => onSelect(c));
            box.appendChild(div);
        });
        box.style.display = 'block';
    });

    // Hide on click outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !box.contains(e.target)) {
            box.style.display = 'none';
        }
    });
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
    renumberPassengerForms();
    updateSummaryBar();
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
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const resetSettingsBtn = document.getElementById('reset-settings-btn');
    
    // Commission slider
    const agentCutSlider = document.getElementById('agent-cut-slider');
    const agentCutValue = document.getElementById('agent-cut-value');

    // Font Selector (Custom)
    const fontSelectContainer = document.getElementById('font-custom-select');
    const fontSelectTrigger = fontSelectContainer?.querySelector('.custom-select-trigger');
    const fontCurrentName = fontSelectContainer?.querySelector('.current-font-name');
    const fontOptions = fontSelectContainer?.querySelectorAll('.custom-option');

    // --- Define default settings ---
    const defaultSettings = {
        agentCut: 60,
        font: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    };

    let currentSettings = { ...defaultSettings };

    // --- Core Functions ---
    const saveSettings = () => {
        localStorage.setItem('uiCustomSettings', JSON.stringify(currentSettings));
    };

    const applySettings = (settings) => {
        // Update agent cut in global state for calculations
        state.commissionRates.cut = settings.agentCut / 100;

        // Update UI controls
        if (agentCutSlider) agentCutSlider.value = settings.agentCut;
        if (agentCutValue) agentCutValue.textContent = `${settings.agentCut}%`;

        // Apply Font
        if (settings.font) {
            document.documentElement.style.setProperty('--font-main', settings.font);
        }

        // Update UI text if container exists
        if (settings.font && fontSelectContainer) {
            const selectedOpt = Array.from(fontOptions).find(opt => opt.getAttribute('data-value') === settings.font);
            if (selectedOpt) {
                fontCurrentName.textContent = selectedOpt.textContent;
                fontOptions.forEach(opt => opt.classList.remove('selected'));
                selectedOpt.classList.add('selected');
            }
        }
    };

    const loadSettings = () => {
        const saved = JSON.parse(localStorage.getItem('uiCustomSettings')) || {};
        currentSettings = { ...defaultSettings, ...saved };
        applySettings(currentSettings);
    };

    // --- Event Listeners ---
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', (e) => {
            const isDark = e.target.checked;
            document.body.classList.toggle('dark-theme', isDark);
            localStorage.setItem('darkMode', isDark);
            document.body.dispatchEvent(new CustomEvent('themeChanged')); // Fire event
        });
    }

    if (agentCutSlider) {
        agentCutSlider.addEventListener('input', (e) => {
            currentSettings.agentCut = e.target.value;
            applySettings(currentSettings);
            saveSettings();
        });
    }

    // Custom Font Dropdown Logic
    if (fontSelectContainer) {
        fontSelectTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            fontSelectContainer.classList.toggle('open');
        });

        fontOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const value = option.getAttribute('data-value');
                const text = option.textContent;

                currentSettings.font = value;
                
                fontCurrentName.textContent = text;
                fontOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                
                fontSelectContainer.classList.remove('open');

                applySettings(currentSettings);
                saveSettings();
            });
        });

        document.addEventListener('click', (e) => {
            if (!fontSelectContainer.contains(e.target)) {
                fontSelectContainer.classList.remove('open');
            }
        });
    }

    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', () => {
            currentSettings = { ...defaultSettings };
            localStorage.removeItem('uiCustomSettings');
            applySettings(currentSettings);
        });
    }

    // --- Initial Load & Render ---
    // Enforce Material (Cursor) theme permanently
    document.body.classList.add('material-theme');

    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode === 'true' && darkModeToggle) {
        darkModeToggle.checked = true;
        document.body.classList.add('dark-theme');
    }

    loadSettings();
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
    'CB Banking',
    'UAB Pay',
    'UAB Special Account'
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
