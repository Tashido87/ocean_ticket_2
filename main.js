/**
 * @fileoverview Main entry point for the Ocean Air Ticket Management application.
 * Initializes the application, sets up event listeners, and coordinates modules.
 * UPDATED: Restored 'addExistingPassengerBtn' listener.
 */

// Core Modules
import { initAuth, handleAuthClick } from './auth.js';
import { state, setCurrentUser } from './state.js';
import { onTicketsChange, onBookingsChange, onHistoryChange, onSettlementsChange, onClosedPeriodsChange, onAdjustmentsChange, onDashboardTasksChange, addDashboardTask, updateDashboardTask, deleteDashboardTask, onHotelsChange, batchUpdateTickets, batchUpdateWithAudit } from './db.js';
import { showToast, parseSheetDate, parseDateInput, parseDeadline, debounce, setButtonLoading, showServiceToast, hideServiceToast, addRecentActivity, renderRecentActivity, isTicketPaid, isFeeEntryRow, isCanceledTicket, renderAirlineName, renderPhoneticExpansionHtml, wirePhoneticToggle, formatSafeAccountLink, getSocialPlatformMeta, formatDateForSheet } from './utils.js';

// Feature Modules
import { performSearch, clearSearch, setDateRangePreset, handleSellTicket, handleAirlineChange, populateSearchAirlines, displayInitialTickets, updateUnpaidCount, displayTickets, initRecordsColumnVisibility, applyRecordsColumnVisibility } from './tickets.js';
import { loadBookingData, handleNewBookingSubmit, performBookingSearch, clearBookingSearch, displayBookings } from './booking.js';
import {  } from './history.js';
import { loadSettlementData, showNewSettlementForm, hideNewSettlementForm, handleNewSettlementSubmit, updateSettlementDashboard, displaySettlements, initSettlementView, getSettlementSummary } from './settlement.js';
import { buildClientList, loadFeaturedClients, getExpiringPassportClients, viewClientHistory } from './clients.js';
import { initGlobalSearch, initSearchView } from './search.js';
import { findTicketForManage, clearManageResults } from './manage.js';
import { exportToPdf, exportPrivateReportToPdf, togglePrivateReportButton, exportSelectedToExcel } from './reports.js';
import { generateInvoice, generateInvoiceImage, analyzeInvoiceScenario } from './invoice.js';
import { selectPassengerTickets } from './invoice-selection.mjs';
let hotelModule;
const renderHotelReservations = () => hotelModule?.renderHotelReservations();
const hideHotelReservationForm = () => hotelModule?.hideHotelReservationForm();
import { getAllDocuments, uploadDocument, deleteDocument, renameDocument, formatFileSize, formatUploadDate } from './documents.js';
import { loadDocumentLibraries } from './document-libraries.js';
let extractTextFromPdf, parseItineraryText, renderAirAsiaTicketHtml, downloadAirAsiaPdf, downloadAirAsiaImage, shareAirAsiaTicket, formatCheckedBaggageLine, parseTripScheduleImage, parseItinerarySchedule, formatPassengerName, generateRandomSeat;
let renderAgodaHotelHtml, downloadAgodaPdf, downloadAgodaImage, shareAgodaBooking, generateRandomBookingId, generateRandomMemberId, generateRandomBookingRefNo, formatAgodaDate, calculateDefaultCancellationDate, DESTINATION_PRESETS, parseHotelConfirmationPdf;

// UI Modules
import { showView, initializeDatepickers, initializeTimePicker, initializeCityDropdowns, updateToggleLabels, updateDynamicTimes, updateNotifications, updateUpcomingPnrs, initializeUISettings, openModal, closeModal, showConfirmModal, populateFlightLocations, addPassengerForm, removePassengerForm, resetPassengerForms, addBookingPassengerForm, removeBookingPassengerForm, resetBookingPassengerForms, showNewBookingForm, hideNewBookingForm, showInvoiceOptionModal, initializePaymentMethodEnhancements, addExistingPassengerForm, applyFlightTypeToAllPaxForms, initializeSellFormEnhancements, updateSellRoutePreview, setupDepartureReturnDatepickers } from './ui.js';

function syncGroupToggleState() {
    const start = document.getElementById('searchStartDate')?.value;
    const end = document.getElementById('searchEndDate')?.value;
    const toggle = document.getElementById('groupByAccountToggle');
    if (!toggle) return;
    const hasRange = !!(start && end);
    toggle.disabled = !hasRange;
    if (!hasRange) {
        toggle.checked = false;
    }
}

// Dashboard Module (extracted from main.js)
import {
    dashboardPeriodState,
    normalizeDashboardTask,
    loadDashboardTasksFromStorage,
    saveDashboardTasksToStorage,
    upsertLocalDashboardTask,
    removeLocalDashboardTask,
    dashboardEscapeHtml,
    initializeDashboardSelectors,
    updateDashboardData,
    renderDashboardData,
    showTripPlanDetail,
    updateComparisonChart,
    updateSidebarBookingBadge
} from "./dashboard.js";
export { updateDashboardData, renderDashboardData, showTripPlanDetail, updateSidebarBookingBadge };

// Global PNR Click Handler — opens trip plan detail modal
document.addEventListener('click', (e) => {
    const pnrEl = e.target.closest('.clickable-pnr');
    if (pnrEl) {
        if (pnrEl.classList.contains('booking-pnr-link')) return;
        e.preventDefault();
        e.stopPropagation();
        const pnr = pnrEl.dataset.pnr;
        if (pnr && pnr !== 'No PNR' && pnr !== '—') {
            showTripPlanDetail(pnr);
        }
        return;
    }

    const hotelEl = e.target.closest('.clickable-hotel-ref');
    if (hotelEl) {
        e.preventDefault();
        e.stopPropagation();
        const hotelId = hotelEl.dataset.hotelId;
        const res = (state.allHotels || []).find(h => h.id === hotelId);
        if (res) {
            import('./tickets.js').then(({ showHotelDetails }) => {
                showHotelDetails(res);
            });
        }
        return;
    }

    const rowEl = e.target.closest('.travel-schedule-row');
    if (rowEl) {
        e.preventDefault();
        e.stopPropagation();
        const pnr = rowEl.dataset.dashboardPnr;
        if (pnr && pnr !== 'No PNR' && pnr !== '—') {
            showTripPlanDetail(pnr);
        }
        return;
    }

    const actionBtn = e.target.closest('.dashboard-row-action');
    if (actionBtn) {
        e.preventDefault();
        e.stopPropagation();
        const pnr = actionBtn.dataset.dashboardPnr;
        if (!pnr || pnr === 'No PNR' || pnr === '—') return;
        if (actionBtn.closest('.travel-schedule-list')) {
            showTripPlanDetail(pnr);
        } else {
            showView('manage');
            findTicketForManage(pnr);
        }
    }
});

// Auto-select today's date when a Datepicker is opened and the field is empty,
// EXCEPT for return date inputs paired with departure dates (which should view the departure month instead of today)
document.addEventListener('show', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.datepicker) {
        const targetId = e.target.id;
        const isReturnInput = targetId === 'return_date' || targetId === 'booking_returning_on' || targetId === 'hotel-departure' || targetId === 'hotel_res_checkout' || e.target.dataset.isReturnDate === 'true';
        if (isReturnInput) {
            let depInput = null;
            if (targetId === 'return_date') depInput = document.getElementById('departing_on');
            else if (targetId === 'booking_returning_on') depInput = document.getElementById('booking_departing_on');
            else if (targetId === 'hotel-departure') depInput = document.getElementById('hotel-arrival');
            else if (targetId === 'hotel_res_checkout') depInput = document.getElementById('hotel_res_checkin');
            else if (e.target.dataset.pairedDeparture) depInput = document.getElementById(e.target.dataset.pairedDeparture);

            const depVal = depInput?.value?.trim();
            const depDate = depVal ? parseDateInput(depVal) : null;
            if (depDate) {
                const depStr = `${String(depDate.getDate()).padStart(2, '0')}/${String(depDate.getMonth() + 1).padStart(2, '0')}/${depDate.getFullYear()}`;
                e.target.datepicker.setOptions({
                    minDate: depStr,
                    defaultViewDate: depStr
                });
                if (typeof e.target.datepicker.setFocusedDate === 'function') {
                    e.target.datepicker.setFocusedDate(depDate);
                }
                // Do NOT auto-set to today's date!
                return;
            }
        }

        if (!e.target.value) {
            e.target.datepicker.setDate(new Date(), { autohide: false });
        }
    }
}, true);

/**
 * Scans tickets with missing contact info and finds POTENTIAL candidate matches.
 * Does NOT auto-write to database! All matches require human verification.
 */
export function findPotentialTicketMatches(tickets = state.allTickets || []) {
    const candidateMatches = [];
    if (!Array.isArray(tickets) || !tickets.length) return candidateMatches;

    tickets.forEach(ticket => {
        const nameCleaned = String(ticket.name || '').replace(/\([^)]+\)\s*$/i, '').trim();
        if (!nameCleaned) return;

        const hasBadPhone = !ticket.phone || ticket.phone === 'undefined' || ticket.phone === '—' || ticket.phone === 'N/A';
        if (!hasBadPhone) return;

        // Search for potential candidate tickets that have contact details
        const candidate = tickets.find(t => {
            if (t.id === ticket.id) return false;
            const n = String(t.name || '').replace(/\([^)]+\)\s*$/i, '').trim();
            const phoneValid = t.phone && t.phone !== 'undefined' && t.phone !== '—' && t.phone !== 'N/A';
            return n.toLowerCase() === nameCleaned.toLowerCase() && phoneValid;
        });

        if (candidate) {
            const proposedData = {};
            if (candidate.phone && (!ticket.phone || ticket.phone === 'undefined')) {
                proposedData.phone = candidate.phone;
            }
            if (candidate.id_no && !ticket.id_no) {
                proposedData.id_no = candidate.id_no;
            }
            if (candidate.gender && !ticket.gender) {
                proposedData.gender = candidate.gender;
            }
            if (candidate.account_name && (!ticket.account_name || ticket.account_name === 'undefined')) {
                proposedData.account_name = candidate.account_name;
            }
            if (candidate.account_type && (!ticket.account_type || ticket.account_type === 'undefined')) {
                proposedData.account_type = candidate.account_type;
            }
            if (candidate.account_link && (!ticket.account_link || ticket.account_link === 'undefined')) {
                proposedData.account_link = candidate.account_link;
            }

            if (Object.keys(proposedData).length > 0) {
                candidateMatches.push({
                    targetTicket: ticket,
                    candidateTicket: candidate,
                    passengerName: nameCleaned,
                    proposedData
                });
            }
        }
    });

    return candidateMatches;
}

/**
 * Interactive review modal for human verification of potential ticket matches.
 * Never silently mutates Firestore; records before/after and user in audit history.
 */
export function reviewPotentialMatches() {
    const matches = findPotentialTicketMatches(state.allTickets || []);
    if (!matches.length) {
        showToast('No potential customer matches requiring review.', 'info');
        return;
    }

    const modalContent = `
        <div class="solid-modal-box potential-matches-dialog" style="max-width: 680px; padding: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-user-check" style="color: var(--primary, #0D6E77);"></i>
                    Review Potential Customer Matches (${matches.length})
                </h3>
                <button type="button" class="btn btn-secondary" id="closePotentialMatchesTopBtn" style="width: 36px; height: 36px; border-radius: 50%; padding: 0; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; font-size: 13px; color: #b45309; line-height: 1.5;">
                <i class="fa-solid fa-triangle-exclamation" style="margin-right: 6px;"></i>
                <strong>သတိပြုရန်:</strong> လူနှစ်ဦးသည် နာမည်တူနိုင်ပါသည်။ အလိုအလျောက် ပြင်ဆင်မပေးဘဲ လူကိုယ်တိုင် အတည်ပြုမှသာ ဖုန်းနှင့် အချက်အလက်များကို ချိတ်ဆက်ပေးပါမည်။
            </div>

            <div class="potential-matches-list" style="max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 4px;">
                ${matches.map((item, idx) => {
                    const t = item.targetTicket;
                    const c = item.candidateTicket;
                    return `
                    <div class="potential-match-card" style="background: var(--surface-2, #f8f9fa); border: 1px solid var(--border-color, #e5e7eb); border-radius: 14px; padding: 14px 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px dashed var(--border-color, #e5e7eb); padding-bottom: 8px;">
                            <strong style="font-size: 15px; color: var(--text-primary);"><i class="fa-solid fa-user"></i> ${dashboardEscapeHtml(item.passengerName)}</strong>
                            <span style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; background: rgba(59, 130, 246, 0.1); color: #2563eb;">Candidate #${idx + 1}</span>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; font-size: 12.5px;">
                            <div style="background: var(--surface, #ffffff); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color, #e5e7eb);">
                                <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #dc2626; margin-bottom: 4px;">Current Ticket (Missing Info)</span>
                                <div><strong>PNR:</strong> ${dashboardEscapeHtml(t.booking_reference || 'N/A')}</div>
                                <div><strong>Date:</strong> ${dashboardEscapeHtml(t.departing_on || t.issued_date || 'N/A')}</div>
                                <div><strong>Phone:</strong> <span style="color: #dc2626; font-style: italic;">(Missing)</span></div>
                                <div><strong>ID/NRC:</strong> ${dashboardEscapeHtml(t.id_no || 'None')}</div>
                            </div>

                            <div style="background: var(--surface, #ffffff); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color, #e5e7eb);">
                                <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #059669; margin-bottom: 4px;">Proposed Match</span>
                                <div><strong>From PNR:</strong> ${dashboardEscapeHtml(c.booking_reference || 'N/A')}</div>
                                <div><strong>Candidate Phone:</strong> <strong style="color: #059669;">${dashboardEscapeHtml(c.phone || 'N/A')}</strong></div>
                                <div><strong>Candidate ID:</strong> ${dashboardEscapeHtml(c.id_no || 'None')}</div>
                                <div><strong>Account:</strong> ${dashboardEscapeHtml(c.account_name || 'None')}</div>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 8px;">
                            <button type="button" class="btn btn-secondary btn-sm dismiss-match-btn" data-index="${idx}">
                                <i class="fa-solid fa-ban"></i> မသက်ဆိုင်ပါ (Skip)
                            </button>
                            <button type="button" class="btn btn-primary btn-sm apply-match-btn" data-index="${idx}" style="background: #059669; border-color: #059669; color: #fff;">
                                <i class="fa-solid fa-circle-check"></i> အတည်ပြုမည် (Confirm)
                            </button>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: 18px; border-top: 1px solid var(--border-color, #e5e7eb); padding-top: 12px;">
                <button type="button" class="btn btn-secondary" id="closePotentialMatchesBtn">Done</button>
            </div>
        </div>
    `;

    openModal(modalContent, 'solid-modal');
    document.getElementById('closePotentialMatchesTopBtn')?.addEventListener('click', closeModal);
    document.getElementById('closePotentialMatchesBtn')?.addEventListener('click', closeModal);

    document.querySelectorAll('.apply-match-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const idx = parseInt(e.currentTarget.dataset.index, 10);
            const matchItem = matches[idx];
            if (!matchItem) return;

            const t = matchItem.targetTicket;
            const c = matchItem.candidateTicket;
            const user = state.currentUser?.displayName || state.currentUser?.email || 'User';

            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Applying...`;

            try {
                const updateData = { ...matchItem.proposedData };
                const auditEntry = {
                    date: formatDateForSheet(new Date()),
                    name: t.name || '',
                    pnr: t.booking_reference || '',
                    details: `[Confirmed Match] Enriched contact data from PNR ${c.booking_reference || 'N/A'}: Phone '${t.phone || 'None'}' -> '${c.phone || ''}', ID '${t.id_no || 'None'}' -> '${c.id_no || 'None'}'. Verified by ${user}.`,
                    action: 'ENRICH_CUSTOMER_MATCH',
                    modifiedBy: user,
                    before: {
                        phone: t.phone || '',
                        id_no: t.id_no || '',
                        gender: t.gender || '',
                        account_name: t.account_name || ''
                    },
                    after: {
                        phone: updateData.phone || t.phone || '',
                        id_no: updateData.id_no || t.id_no || '',
                        gender: updateData.gender || t.gender || '',
                        account_name: updateData.account_name || t.account_name || ''
                    }
                };

                await batchUpdateWithAudit([{ id: t.id, data: updateData }], [auditEntry]);
                showToast(`Contact info for ${t.name} confirmed and updated with audit log!`, 'success');
                const card = e.currentTarget.closest('.potential-match-card');
                if (card) {
                    card.innerHTML = `<div style="color: #059669; font-weight: 600; padding: 10px;"><i class="fa-solid fa-circle-check"></i> Confirmed & updated by ${dashboardEscapeHtml(user)}.</div>`;
                }
            } catch (err) {
                console.error('Failed to apply match:', err);
                showToast(`Failed to update ticket: ${err.message || err}`, 'error');
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> အတည်ပြုမည် (Confirm)`;
            }
        });
    });

    document.querySelectorAll('.dismiss-match-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const card = e.currentTarget.closest('.potential-match-card');
            if (card) {
                card.remove();
                showToast('Potential match dismissed (records left untouched).', 'info');
            }
        });
    });
}

window.reviewPotentialMatches = reviewPotentialMatches;
window.findPotentialTicketMatches = findPotentialTicketMatches;

/**
 * Main application initialization function. Called after authentication.
 * @export
 */
export async function initializeApp() {
    try {
        loadFeaturedClients();
        loadDashboardTasksFromStorage();

        // Unsubscribe from any existing listeners
        state.unsubscribers.forEach(unsub => unsub && unsub());
        state.unsubscribers = [];

        // Removed redundant full fetches; real-time listeners will populate initial state automatically from local cache.

        // Build derived data
        buildClientList();
        initializeDashboardSelectors();

        // Default: show This Month
        setDateRangePreset('this-month');
        syncGroupToggleState();

        // Hash-based routing for all views + back/forward support
        window.addEventListener('hashchange', handleHashRoute);
        window.addEventListener('popstate', handlePopState);
        // Set default hash if none present
        if (!window.location.hash) {
            history.replaceState({ view: 'home' }, '', '#/home');
        }
        handleHashRoute();

        let initialDataShown = false;
        const revealDashboard = () => {
            if (initialDataShown) return;
            initialDataShown = true;
            const loading = document.getElementById('loading');
            const dashboardContent = document.getElementById('dashboard-content');
            if (loading) loading.style.display = 'none';
            if (dashboardContent) dashboardContent.style.display = 'flex';
        };

        const debouncedRefreshHeavyData = debounce(() => {
            updateUnpaidCount();
            updateNotifications();
            buildClientList();
            updateDashboardData();
            if (typeof updateInvoiceAdjustmentsSection === 'function') {
                updateInvoiceAdjustmentsSection();
            }
        }, 70);

        const isViewCurrentlyActive = (viewName) => {
            const el = document.getElementById(`${viewName}-view`);
            return !!el && el.classList.contains('active') && el.style.display !== 'none';
        };

        const syncedSubAgentTicketIds = new Set();

        // Set up real-time listeners
        state.unsubscribers.push(
            onTicketsChange((tickets) => {
                const isInitial = !initialDataShown;
                const autoSettleUpdates = [];
                (tickets || []).forEach(t => {
                    if (!t || isCanceledTicket(t)) return;
                    if (Number(t.sub_agent_fare) > 0 && isTicketPaid(t) && !t.sub_agent_settled && !t.sub_agent_manually_unsettled) {
                        const settleDate = t.paid_date || t.issued_date || '';
                        const settleMethod = t.payment_method || 'Deducted from Ticket Fare';
                        t.sub_agent_settled = true;
                        t.sub_agent_settled_date = settleDate;
                        t.sub_agent_settlement_method = settleMethod;
                        if (t.id && !syncedSubAgentTicketIds.has(t.id)) {
                            syncedSubAgentTicketIds.add(t.id);
                            autoSettleUpdates.push({
                                id: t.id,
                                data: {
                                    sub_agent_settled: true,
                                    sub_agent_settled_at: new Date().toISOString(),
                                    sub_agent_settled_date: settleDate,
                                    sub_agent_settlement_method: settleMethod,
                                    sub_agent_settlement_note: 'Auto-settled with ticket payment'
                                }
                            });
                        }
                    }
                });
                if (autoSettleUpdates.length > 0) {
                    batchUpdateTickets(autoSettleUpdates).catch(err => console.warn('Auto-settle sub-agent fares sync warning:', err));
                }

                state.allTickets = tickets;
                revealDashboard();
                populateSearchAirlines();
                if (isViewCurrentlyActive('records')) {
                    state.recordsDirty = false;
                    displayInitialTickets(state.currentPage);
                } else {
                    state.recordsDirty = true;
                }

                if (isInitial) {
                    updateUnpaidCount();
                    updateNotifications();
                    buildClientList();
                    updateDashboardData();
                    if (typeof updateInvoiceAdjustmentsSection === 'function') {
                        updateInvoiceAdjustmentsSection();
                    }
                } else {
                    debouncedRefreshHeavyData();
                }
            }, (err) => {
                revealDashboard();
                showToast(`Unable to load tickets: ${err.message || err}`, 'error');
            })
        );

        state.unsubscribers.push(
            onBookingsChange((bookings) => {
                state.allBookings = bookings;
                if (isViewCurrentlyActive('booking')) {
                    state.bookingsDirty = false;
                    displayBookings();
                } else {
                    state.bookingsDirty = true;
                }
                updateSidebarBookingBadge();
                debouncedRefreshHeavyData();
            })
        );

        state.unsubscribers.push(
            onSettlementsChange((settlements) => {
                state.allSettlements = settlements;
                if (isViewCurrentlyActive('settle')) {
                    state.settlementsDirty = false;
                    displaySettlements();
                } else {
                    state.settlementsDirty = true;
                }
                updateDashboardData();
            })
        );

        state.unsubscribers.push(
            onClosedPeriodsChange((periods) => {
                state.allClosedPeriods = periods;
                if (isViewCurrentlyActive('settle')) {
                    state.settlementsDirty = false;
                    displaySettlements();
                } else {
                    state.settlementsDirty = true;
                }
            })
        );

        state.unsubscribers.push(
            onAdjustmentsChange((adjustments) => {
                state.allAdjustments = adjustments;
                if (isViewCurrentlyActive('settle')) {
                    state.settlementsDirty = false;
                    displaySettlements();
                } else {
                    state.settlementsDirty = true;
                }
            })
        );

        state.unsubscribers.push(
            onDashboardTasksChange((tasks) => {
                const localOnlyTasks = (state.dashboardTasks || []).filter(task => task.localOnly);
                state.dashboardTasks = [
                    ...tasks.map(task => normalizeDashboardTask({ ...task, localOnly: false })),
                    ...localOnlyTasks
                ];
                saveDashboardTasksToStorage();
                updateDashboardData();
            }, (error) => {
                console.warn('Dashboard tasks will use local storage only:', error);
            })
        );

        state.unsubscribers.push(
            onHotelsChange((hotels) => {
                state.allHotels = hotels;
                if (isViewCurrentlyActive('hotel')) {
                    state.hotelsDirty = false;
                    renderHotelReservations();
                } else {
                    state.hotelsDirty = true;
                }
                if (isViewCurrentlyActive('records')) {
                    state.recordsDirty = false;
                    displayInitialTickets(state.currentPage);
                } else {
                    state.recordsDirty = true;
                }
                updateDashboardData();
            })
        );

        initSettlementView();

        // Defer history collection listener until after startup to save bandwidth and initial latency
        const attachHistoryListener = () => {
            if (state.historyListenerAttached) return;
            state.historyListenerAttached = true;
            state.unsubscribers.push(
                onHistoryChange((history) => {
                    state.history = history;
                })
            );
        };
        if ('requestIdleCallback' in window) {
            requestIdleCallback(attachHistoryListener, { timeout: 3500 });
        } else {
            setTimeout(attachHistoryListener, 2500);
        }

        // Start dynamic updates
        if (state.timeUpdateInterval) clearInterval(state.timeUpdateInterval);
        state.timeUpdateInterval = setInterval(updateDynamicTimes, 60000);
        updateDynamicTimes();
        
        // Fallback: reveal dashboard if listener takes longer than 2.5s or offline
        setTimeout(revealDashboard, 2500);

        // One-time migration: fix old self-purchased tickets with commission=0
        migrateSelfTicketCommissions();

    } catch (error) {
        console.error("Initialization failed:", error);
        showToast('A critical error occurred during data initialization. Please check the console (F12) for details.', 'error');
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
    }
}

window.fixMyDates = async function() {
    console.log("Starting date fix...");
    const selfTicketsToFix = (state.allTickets || []).filter(t => t.source === 'self');
    const updates = [];
    
    selfTicketsToFix.forEach(t => {
        // Change any June dates to May 6th
        if (t.issued_date === '05/06/2026' || t.issued_date === '01/06/2026' || t.issued_date === '06/06/2026') {
            updates.push({
                id: t.id,
                data: { issued_date: '06/05/2026' }
            });
        }
    });

    if (updates.length > 0) {
        try {
            await batchUpdateTickets(updates);
            console.log(`Successfully fixed ${updates.length} tickets!`);
            alert(`Fixed ${updates.length} tickets! They are now May 6th.`);
        } catch (err) {
            console.error('Failed:', err);
            alert('Failed to fix dates');
        }
    } else {
        console.log("No tickets needed fixing.");
        alert("No tickets found with the wrong dates.");
    }
};

/**
 * Diagnostic + migration: finds self-purchased tickets, logs them, and fixes commission if needed.
 */
async function migrateSelfTicketCommissions() {
    // Intentionally empty
}

let lastHandledHash = null;

/**
 * Handle URL hash routing for all views.
 */
function handleHashRoute() {
    const hash = window.location.hash || '#/home';
    if (hash === lastHandledHash) return;
    lastHandledHash = hash;
    const viewMatch = hash.match(/^#\/(\w+)/);
    if (viewMatch) {
        const viewName = viewMatch[1];
        // Set flag so showView doesn't pushState again
        window._skipHashUpdate = true;
        showView(viewName);
        if (viewName === 'search') initSearchView();
        if (viewName === 'hotel') {
            hideHotelReservationForm();
            renderHotelReservations();
        }
    }
}

/**
 * Handle browser back/forward buttons (popstate).
 */
function handlePopState(e) {
    const hash = window.location.hash || '#/home';
    if (hash === lastHandledHash) return;
    handleHashRoute();
}

/**
 * Sets up all event listeners for the application.
 */
function setupEventListeners() {
    // Navigation & Settings
    document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        if (e.currentTarget.dataset.view) {
            e.preventDefault();
            showView(e.currentTarget.dataset.view);
        }
    }));
    const authBtn = document.getElementById('authorize_button');
    if (authBtn) authBtn.addEventListener('click', handleAuthClick);
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            const isMobile = window.innerWidth <= 980;
            if (isMobile) document.body.classList.toggle('sidebar-open');
            else document.body.classList.toggle('sidebar-collapsed');
        });
    }

    if (sidebarCloseBtn) {
        sidebarCloseBtn.addEventListener('click', () => {
            document.body.classList.remove('sidebar-open');
        });
    }

    // Close mobile sidebar on outside click or when selecting a navigation link
    document.addEventListener('click', (e) => {
        if (window.innerWidth > 980) return;
        if (!document.body.classList.contains('sidebar-open')) return;

        // If clicked outside the sidebar and not on the hamburger toggle button
        if (!e.target.closest('.sidebar') && !e.target.closest('.sidebar-toggle')) {
            document.body.classList.remove('sidebar-open');
            return;
        }

        // If clicked on a navigation button inside the sidebar
        if (e.target.closest('.sidebar-nav .nav-btn')) {
            document.body.classList.remove('sidebar-open');
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 980) {
            document.body.classList.remove('sidebar-open');
        }
    });

    const handleAppRefresh = async () => {
        const icons = document.querySelectorAll('#sidebarRefreshBtn i, #settingsRefreshAppBtn i');
        icons.forEach(i => i.classList.add('fa-spin'));
        showToast('Refreshing application...', 'info');

        try {
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const reg of regs) {
                    await reg.update().catch(() => {});
                }
            }
        } catch (e) {
            console.warn('SW update warning:', e);
        }

        setTimeout(() => {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('_r', Date.now().toString());
            window.location.replace(currentUrl.toString());
        }, 200);
    };

    document.getElementById('sidebarRefreshBtn')?.addEventListener('click', handleAppRefresh);
    document.getElementById('settingsRefreshAppBtn')?.addEventListener('click', handleAppRefresh);

    initGlobalSearch();

    document.querySelectorAll('[data-dashboard-view]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const view = e.currentTarget.dataset.dashboardView;
            showView(view);
            if (view === 'booking') showNewBookingForm();
            if (view === 'manage') setTimeout(() => document.getElementById('managePnr')?.focus(), 80);
        });
    });

    document.querySelectorAll('.dashboard-period-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.dashboard-period-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            dashboardPeriodState.period = e.currentTarget.dataset.dashboardPeriod || 'month';
            const custom = document.getElementById('dashboardCustomRange');
            if (custom) custom.hidden = dashboardPeriodState.period !== 'custom';
            updateDashboardData();
        });
    });
    ['dashboardCustomStart', 'dashboardCustomEnd'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
            dashboardPeriodState.customStart = document.getElementById('dashboardCustomStart')?.value || '';
            dashboardPeriodState.customEnd = document.getElementById('dashboardCustomEnd')?.value || '';
            updateDashboardData();
        });
    });

    // Records Search Panel
    const debouncedSearch = debounce(performSearch, 300);
    document.getElementById('searchName').addEventListener('input', debouncedSearch);
    document.getElementById('searchBooking').addEventListener('input', debouncedSearch);
    ['searchTravelDate', 'searchStartDate', 'searchEndDate', 'searchDeparture', 'searchDestination', 'searchSource', 'groupByAccountToggle'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', performSearch);
    });
    document.getElementById('recordsSearchBtn').addEventListener('click', performSearch);
    document.getElementById('recordsClearBtn').addEventListener('click', () => {
        clearSearch();
        syncGroupToggleState();
    });
    document.querySelectorAll('.records-preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.records-preset-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            setDateRangePreset(e.target.dataset.range);
            syncGroupToggleState();
        });
    });

    // Set today's date badge beside records search buttons
    const recordsTodayEl = document.getElementById('recordsTodayDate');
    if (recordsTodayEl) {
        const today = new Date();
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        recordsTodayEl.textContent = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
    }

    // Dashboard KPI Card Navigation
    const selfPurchasedCard = document.getElementById('self-purchased-box');
    if (selfPurchasedCard) {
        selfPurchasedCard.style.cursor = 'pointer';
        selfPurchasedCard.title = 'Click to view Self-Purchased tickets and hotels in Records';
        selfPurchasedCard.addEventListener('click', () => {
            showView('records');
            const searchSource = document.getElementById('searchSource');
            if (searchSource) {
                searchSource.value = 'self';
                searchSource.dispatchEvent(new Event('change'));
            }
        });
    }

    const ownerPayableCard = document.getElementById('owner-payable-box');
    if (ownerPayableCard) {
        ownerPayableCard.style.cursor = 'pointer';
        ownerPayableCard.title = 'Click to open Owner Settlement view';
        ownerPayableCard.addEventListener('click', () => {
            showView('settle');
        });
    }

    document.getElementById('recordsFilterToggle').addEventListener('click', () => {
        const panel = document.getElementById('recordsFilters');
        if (panel) panel.hidden = !panel.hidden;
    });

    ['searchStartDate', 'searchEndDate'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', syncGroupToggleState);
            el.addEventListener('change', syncGroupToggleState);
        }
    });
    syncGroupToggleState();

    // Reports & Column Visibility
    initRecordsColumnVisibility();
    const editModeBtn = document.getElementById('editModeBtn');
    if (editModeBtn) {
        editModeBtn.addEventListener('click', () => {
            state.recordsEditMode = !state.recordsEditMode;
            editModeBtn.classList.toggle('active', state.recordsEditMode);
            applyRecordsColumnVisibility();
            displayTickets(state.filteredTickets, state.currentPage);
        });
    }

    // Records Export Dropdown
    const exportDropdown = document.getElementById('recordsExportDropdown');
    const exportDropdownBtn = document.getElementById('recordsExportDropdownBtn');
    const exportDropdownMenu = document.getElementById('recordsExportDropdownMenu');
    if (exportDropdown && exportDropdownBtn) {
        exportDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = exportDropdown.classList.toggle('is-open');
            exportDropdownBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
        document.addEventListener('click', (e) => {
            if (!exportDropdown.contains(e.target)) {
                exportDropdown.classList.remove('is-open');
                exportDropdownBtn.setAttribute('aria-expanded', 'false');
            }
        });
        exportDropdownMenu?.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                exportDropdown.classList.remove('is-open');
                exportDropdownBtn.setAttribute('aria-expanded', 'false');
            });
        });
    }

    document.getElementById('exportExcelBtn').addEventListener('click', exportSelectedToExcel);
    document.getElementById('exportPdfBtn').addEventListener('click', () => document.getElementById('exportConfirmModal').classList.add('show'));
    document.getElementById('confirmExportBtn').addEventListener('click', () => exportToPdf(false));
    document.getElementById('confirmShareBtn')?.addEventListener('click', () => exportToPdf(true));
    document.getElementById('exportPrivateReportBtn').addEventListener('click', async () => {
        await exportPrivateReportToPdf();
        updateComparisonChart();
    });
    document.getElementById('searchStartDate').addEventListener('change', togglePrivateReportButton);
    document.getElementById('searchEndDate').addEventListener('change', togglePrivateReportButton);
    document.querySelectorAll('input[name="exportType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('exportDateRange').style.display = e.target.value === 'range' ? 'block' : 'none';
        });
    });

    function isSellFormDirty() {
        const form = document.getElementById('sellForm');
        if (!form) return false;

        if (document.getElementById('booking_reference')?.value?.trim()) return true;
        if (document.getElementById('departing_on')?.value?.trim()) return true;
        if (document.getElementById('return_date')?.value?.trim()) return true;
        if (document.getElementById('custom_departure')?.value?.trim()) return true;
        if (document.getElementById('custom_destination')?.value?.trim()) return true;
        if (document.getElementById('phone')?.value?.trim()) return true;
        if (document.getElementById('account_name')?.value?.trim()) return true;
        if (document.getElementById('account_link')?.value?.trim()) return true;

        const paxForms = form.querySelectorAll('.passenger-form');
        if (paxForms.length > 1) return true;
        for (const pax of paxForms) {
            if (pax.querySelector('.passenger-name')?.value?.trim()) return true;
            if (pax.querySelector('.passenger-net-amount')?.value?.trim()) return true;
            if (pax.querySelector('.passenger-base-fare')?.value?.trim()) return true;
            if (pax.querySelector('.passenger-passport-no')?.value?.trim()) return true;
            if (pax.querySelector('.passenger-dob')?.value?.trim()) return true;
            if (pax.querySelector('.nrc-serial')?.value?.trim()) return true;
            if (pax.querySelector('.passenger-remarks')?.value?.trim()) return true;
            if (pax.querySelector('.passenger-cost-price')?.value?.trim()) return true;
            if (pax.querySelector('.passenger-commission')?.value?.trim()) return true;
        }

        return false;
    }

    function resetAndExitSellForm() {
        document.getElementById('sellForm').reset();
        resetPassengerForms();
        window.applySellStep?.('section-booking');
        showView('home');
    }

    // Sell Ticket Form
    document.getElementById('cancelSellBtn').addEventListener('click', () => {
        if (isSellFormDirty()) {
            showConfirmModal(
                `<i class="fa-solid fa-triangle-exclamation" style="color: #cf2d56; font-size: 2.2rem; margin-bottom: 0.75rem; display: block;"></i>
                 <strong style="font-size: 1.15rem;">Cancel Ticket Entry?</strong>
                 <p style="margin: 0.65rem 0 0; font-size: 0.95rem; color: var(--text-secondary, #666); line-height: 1.5;">
                     Are you sure you want to cancel? All entered ticket and passenger details will be lost.
                 </p>`,
                () => {
                    closeModal();
                    resetAndExitSellForm();
                },
                'Discard & Cancel',
                'Keep Editing',
                'btn btn-danger'
            );
        } else {
            resetAndExitSellForm();
        }
    });
    document.getElementById('sellForm').addEventListener('submit', handleSellTicket);
    document.getElementById('airline').addEventListener('change', handleAirlineChange);
    document.getElementById('flightTypeToggle').addEventListener('change', () => {
        populateFlightLocations();
        updateToggleLabels();
        applyFlightTypeToAllPaxForms();
        updateSellRoutePreview();
    });
    document.getElementById('addPassengerBtn').addEventListener('click', () => addPassengerForm());
    // MODIFIED: Restored event listener for Previous Client Name
    document.getElementById('addExistingPassengerBtn').addEventListener('click', () => addExistingPassengerForm());
    document.getElementById('removePassengerBtn').addEventListener('click', removePassengerForm);


    // Manage Ticket
    document.getElementById('findTicketBtn').addEventListener('click', () => findTicketForManage());
    document.getElementById('clearManageBtn').addEventListener('click', clearManageResults);
    document.getElementById('managePnr').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') document.getElementById('findTicketBtn').click();
    });

    // Booking
    document.getElementById('newBookingBtn').addEventListener('click', showNewBookingForm);
    document.getElementById('cancelNewBookingBtn').addEventListener('click', hideNewBookingForm);
    document.getElementById('newBookingForm').addEventListener('submit', handleNewBookingSubmit);
    document.getElementById('addBookingPassengerBtn').addEventListener('click', addBookingPassengerForm);
    document.getElementById('removeBookingPassengerBtn').addEventListener('click', removeBookingPassengerForm);
    document.getElementById('bookingSearchBtn').addEventListener('click', performBookingSearch);
    document.getElementById('bookingClearBtn').addEventListener('click', clearBookingSearch);

    // Booking Trip Type Toggle
    const bookingOnewayRadio = document.getElementById('booking_trip_type_oneway');
    const bookingRoundRadio = document.getElementById('booking_trip_type_round');
    const bookingReturningGroup = document.getElementById('booking_returning_group');
    const bookingReturningOn = document.getElementById('booking_returning_on');
    const bookingDepartingLabel = document.getElementById('booking_departing_label');

    function toggleBookingTripType() {
        if (bookingRoundRadio && bookingRoundRadio.checked) {
            if (bookingReturningGroup) bookingReturningGroup.style.display = 'block';
            if (bookingReturningOn) bookingReturningOn.required = true;
            if (bookingDepartingLabel) bookingDepartingLabel.textContent = 'Departure Date';
            setupDepartureReturnDatepickers('booking_departing_on', 'booking_returning_on');
        } else {
            if (bookingReturningGroup) bookingReturningGroup.style.display = 'none';
            if (bookingReturningOn) {
                bookingReturningOn.required = false;
                bookingReturningOn.value = '';
            }
            if (bookingDepartingLabel) bookingDepartingLabel.textContent = 'Travel Date';
        }
    }

    if (bookingOnewayRadio) bookingOnewayRadio.addEventListener('change', toggleBookingTripType);
    if (bookingRoundRadio) bookingRoundRadio.addEventListener('change', toggleBookingTripType);

    // Settlement is wired by initSettlementView() in initializeApp().

    // Hotel Service Initialization

    // Invoice Generation Logic — unified Generate button with format selector
    const invoiceGenerateBtn = document.getElementById('invoiceGenerateBtn');
    const invoiceClearBtn = document.getElementById('invoiceClearBtn');
    const invoiceForm = document.getElementById('invoiceForm');

    // Dynamic price adjustments display logic
    function createAdjustmentField(name, pnr, leg, label) {
        const fg = document.createElement('div');
        fg.style.display = 'flex';
        fg.style.flexDirection = 'column';
        fg.style.gap = '0.25rem';
        fg.style.flex = '1';
        fg.style.minWidth = '140px';
        
        const lbl = document.createElement('label');
        lbl.style.fontSize = '0.75rem';
        lbl.style.color = 'var(--text-secondary)';
        lbl.textContent = label;
        
        const input = document.createElement('input');
        input.type = 'number';
        input.placeholder = 'e.g. +5000 or -2000';
        input.className = 'invoice-adjust-input';
        input.dataset.name = name;
        input.dataset.pnr = pnr;
        input.dataset.leg = leg;
        input.style.padding = '0.35rem 0.5rem';
        input.style.fontSize = '0.8rem';
        input.style.border = '1px solid var(--border-color)';
        input.style.borderRadius = '4px';
        input.style.width = '100%';
        input.style.background = 'var(--surface)';
        input.style.color = 'var(--text-primary)';
        
        fg.appendChild(lbl);
        fg.appendChild(input);
        return fg;
    }

    function updateInvoiceAdjustmentsSection() {
        if (document.getElementById('invoice_grouping')?.value === 'passenger') {
            document.getElementById('invoice_adjustments_wrapper').style.display = 'none';
            return;
        }
        const pnrInput = document.getElementById('invoice_pnr_list').value;
        const pnrList = pnrInput.split(/[\n,]/).map(p => p.trim().toUpperCase()).filter(p => p);
        const wrapper = document.getElementById('invoice_adjustments_wrapper');
        const container = document.getElementById('invoice_adjustments_list');
        
        if (!wrapper || !container) return;
        
        if (pnrList.length === 0) {
            wrapper.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        
        // Find tickets matching PNRs
        const tickets = state.allTickets.filter(t => pnrList.includes((t.booking_reference || '').toUpperCase()));
        
        if (tickets.length === 0) {
            wrapper.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        
        wrapper.style.display = 'block';
        container.innerHTML = '';
        
        // Group tickets by passenger name + booking_reference
        const grouped = {};
        tickets.forEach(ticket => {
            const key = `${ticket.name}_${ticket.booking_reference}`;
            if (!grouped[key]) {
                grouped[key] = {
                    name: ticket.name,
                    pnr: ticket.booking_reference,
                    outbound: null,
                    return: null,
                    others: []
                };
            }
            if (ticket.leg === 'outbound') {
                grouped[key].outbound = ticket;
            } else if (ticket.leg === 'return') {
                grouped[key].return = ticket;
            } else {
                grouped[key].others.push(ticket);
            }
        });
        
        // Render inputs
        Object.values(grouped).forEach(g => {
            const itemEl = document.createElement('div');
            itemEl.className = 'invoice-adjustment-item';
            itemEl.style.display = 'flex';
            itemEl.style.flexDirection = 'column';
            itemEl.style.gap = '0.5rem';
            itemEl.style.padding = '0.5rem';
            itemEl.style.border = '1px solid var(--border-color)';
            itemEl.style.borderRadius = '6px';
            itemEl.style.boxShadow = 'var(--shadow-soft)';
            itemEl.style.background = 'var(--surface)';
            
            const headerEl = document.createElement('div');
            headerEl.style.fontWeight = 'bold';
            headerEl.style.fontSize = '0.85rem';
            headerEl.style.color = 'var(--text-primary)';
            headerEl.textContent = `${g.name} (${g.pnr})`;
            itemEl.appendChild(headerEl);
            
            const inputsEl = document.createElement('div');
            inputsEl.style.display = 'flex';
            inputsEl.style.gap = '1rem';
            inputsEl.style.flexWrap = 'wrap';
            
            if (g.outbound || g.return) {
                if (g.outbound) {
                    const route = `${(g.outbound.departure || '').split(' ')[0]}→${(g.outbound.destination || '').split(' ')[0]}`;
                    const fg = createAdjustmentField(g.name, g.pnr, 'outbound', `Outbound (${route})`);
                    inputsEl.appendChild(fg);
                }
                if (g.return) {
                    const route = `${(g.return.departure || '').split(' ')[0]}→${(g.return.destination || '').split(' ')[0]}`;
                    const fg = createAdjustmentField(g.name, g.pnr, 'return', `Return (${route})`);
                    inputsEl.appendChild(fg);
                }
            } else {
                // Outbound leg as default if leg is not tagged
                g.others.forEach((t, i) => {
                    const route = `${(t.departure || '').split(' ')[0]}→${(t.destination || '').split(' ')[0]}`;
                    const legVal = t.leg || (i === 0 ? 'outbound' : `other_${i}`);
                    const fg = createAdjustmentField(g.name, g.pnr, legVal, `${route}`);
                    inputsEl.appendChild(fg);
                });
            }
            
            itemEl.appendChild(inputsEl);
            container.appendChild(itemEl);
        });
    }

    // Attach listeners to input to dynamically load adjustment fields
    const pnrListInput = document.getElementById('invoice_pnr_list');
    if (pnrListInput) {
        pnrListInput.addEventListener('input', updateInvoiceAdjustmentsSection);
        pnrListInput.addEventListener('change', updateInvoiceAdjustmentsSection);
        // Sync on initialization
        updateInvoiceAdjustmentsSection();
    }

    // Passenger mode is an export-only selection; no booking/payment records are written.
    const passengerTools = document.createElement('div');
    passengerTools.style.cssText = 'grid-column:1/-1;min-width:0';
    passengerTools.innerHTML = `<label for="invoice_grouping">Document grouping</label>
        <select id="invoice_grouping"><option value="pnr">By PNR — existing rules</option><option value="passenger">By passenger — select flights across PNRs</option></select>
        <section id="invoice_passenger_tools" hidden>
        <p>Select each flight and fee to include. Selected rows with the same displayed passenger name form one document. Leave unrelated tickets unchecked.</p>
        <p>Receipt vouchers display “Paid”, even before payment is recorded. Generating a voucher does not mark tickets paid or change outstanding balances.</p>
        <button type="button" class="btn-service" id="invoice_load_passengers">Load / refresh passenger tickets</button>
        <div id="invoice_passenger_rows" style="display:grid;gap:12px;margin:12px 0"></div>
        <div id="invoice_passenger_preview" aria-live="polite" style="white-space:pre-line"></div>
        <label style="display:flex;gap:10px;align-items:flex-start;margin-top:12px"><input type="checkbox" id="invoice_identity_confirm" style="width:auto;flex:none">I verified that flights grouped under each name belong to the same person, and checked the dates, fees and amounts. A single selected flight is not a round trip.</label>
        </section>`;
    invoiceForm?.appendChild(passengerTools);
    const grouping = passengerTools.querySelector('#invoice_grouping');
    const rows = passengerTools.querySelector('#invoice_passenger_rows');
    const preview = passengerTools.querySelector('#invoice_passenger_preview');
    const confirmation = passengerTools.querySelector('#invoice_identity_confirm');
    const passengerSelection = () => ({
        ids: [...rows.querySelectorAll('input[data-ticket]:checked')].map(el => el.dataset.ticket),
        adjustments: Object.fromEntries([...rows.querySelectorAll('input[data-adjustment]')].map(el => [el.dataset.adjustment, el.value]))
    });
    const invoicePnrs = () => pnrListInput.value.split(/[\n,]/).map(p => p.trim()).filter(Boolean);
    function updatePassengerPreview() {
        confirmation.checked = false;
        try {
            const tickets = selectPassengerTickets(state.allTickets, invoicePnrs(), passengerSelection(), document.getElementById('document_type').value, isTicketPaid);
            const groups = new Map();
            tickets.forEach(t => {
                const name = t.name.replace(/\s*\(\s*fees\s*\)\s*$/i, '').trim();
                if (!groups.has(name)) groups.set(name, { total: 0, details: [] });
                const group = groups.get(name);
                group.total += Number(t.net_amount || 0) + Number(t.extra_fare || 0) + Number(t.sub_agent_fare || 0) + Number(t.date_change || t.date_change_fee || t.date_change_fees || 0);
                group.details.push(`${t.booking_reference}: ${t.departure} → ${t.destination} · ${t.departing_on || 'Date missing'} · ${t.airline || 'Airline missing'}${isFeeEntryRow(t) ? ' · Fee' : ''}`);
            });
            preview.textContent = [...groups].map(([name, g]) => `${name} — ${g.total.toLocaleString()} MMK\n${g.details.join('\n')}`).join('\n\n');
        } catch (error) { preview.textContent = error.message; }
    }
    function resetPassengerSelection() {
        rows.replaceChildren();
        preview.textContent = 'Load passenger tickets after entering all relevant PNRs.';
        confirmation.checked = false;
    }
    grouping.addEventListener('change', () => {
        passengerTools.querySelector('section').hidden = grouping.value !== 'passenger';
        document.getElementById('invoice_adjustments_wrapper').hidden = grouping.value === 'passenger';
        updateInvoiceAdjustmentsSection();
        resetPassengerSelection();
    });
    pnrListInput?.addEventListener('input', resetPassengerSelection);
    pnrListInput?.addEventListener('change', resetPassengerSelection);
    document.getElementById('document_type').addEventListener('change', updatePassengerPreview);
    rows.addEventListener('input', updatePassengerPreview);
    passengerTools.querySelector('#invoice_load_passengers').addEventListener('click', () => {
        resetPassengerSelection();
        const pnrs = new Set(invoicePnrs().map(p => p.toUpperCase()));
        state.allTickets.filter(t => pnrs.has(String(t.booking_reference || '').trim().toUpperCase())).forEach(t => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:12px;border:1px solid var(--border-color);border-radius:10px;overflow-wrap:anywhere';
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;gap:10px;align-items:flex-start';
            const check = document.createElement('input');
            check.type = 'checkbox'; check.dataset.ticket = String(t.id); check.disabled = !t.id || isCanceledTicket(t);
            check.style.cssText = 'width:auto;flex:none';
            const text = document.createElement('span');
            const itemAmt = Number(t.net_amount || 0) + Number(t.extra_fare || 0) + Number(t.sub_agent_fare || 0) + Number(t.date_change || t.date_change_fee || t.date_change_fees || 0);
            text.textContent = `${t.name} · ${t.booking_reference} · ${t.departure} → ${t.destination} · ${t.departing_on || 'Date missing'} · ${t.airline || 'Airline missing'} · ${itemAmt.toLocaleString()} MMK · ${isTicketPaid(t) ? 'Paid' : 'Unpaid'}${isFeeEntryRow(t) ? ' · Fee' : ''}${isCanceledTicket(t) ? ' · Cancelled (unavailable)' : ''}`;
            label.append(check, text);
            const adjustment = document.createElement('input');
            adjustment.type = 'text'; adjustment.inputMode = 'decimal'; adjustment.dataset.adjustment = String(t.id);
            adjustment.placeholder = 'Optional invoice adjustment, e.g. -2000';
            adjustment.setAttribute('aria-label', `Adjustment for ${t.name}, ${t.booking_reference}, ${t.departing_on}`);
            item.append(label, adjustment); rows.append(item);
        });
        updatePassengerPreview();
    });

    async function runInvoiceGeneration(isShare = false) {
        const pnrInput = document.getElementById('invoice_pnr_list').value;
        const pnrList = pnrInput.split(/[\n,]/).map(p => p.trim()).filter(p => p);
        const type = document.getElementById('document_type').value;
        const brand = document.getElementById('invoice_brand').value;
        const date = document.getElementById('invoice_date').value;
        const format = document.querySelector('input[name="invoice_format"]:checked')?.value || 'pdf';

        if (pnrList.length === 0) {
            showServiceToast('invoiceToast', 'Please enter at least one PNR.', 'error');
            return;
        }

        const selection = grouping.value === 'passenger' ? passengerSelection() : null;
        if (selection) {
            try {
                selectPassengerTickets(state.allTickets, pnrList, selection, type, isTicketPaid);
                if (!confirmation.checked) throw new Error('Review the passenger preview and confirm the selected flights belong to the correct people.');
            } catch (error) {
                showServiceToast('invoiceToast', error.message, 'error');
                return;
            }
        }
        const scenario = selection ? { type: 'SEPARATE', canChoose: false } : analyzeInvoiceScenario(pnrList);
        if (scenario.type === 'ERROR') {
            showServiceToast('invoiceToast', scenario.message, 'error');
            return;
        }

        const invoiceShareBtn = document.getElementById('invoiceShareBtn');
        const targetBtn = isShare ? (invoiceShareBtn || invoiceGenerateBtn) : invoiceGenerateBtn;
        setButtonLoading(targetBtn, true);

        const onDone = (ok, msg) => {
            setButtonLoading(targetBtn, false);
            showServiceToast('invoiceToast', msg, ok ? 'success' : 'error');
            if (ok) addRecentActivity('invoice', `${type} — ${pnrList.join(', ')}`, (isShare ? 'SHARE' : format).toUpperCase());
        };

        // Collect adjustments
        const adjustments = {};
        document.querySelectorAll('.invoice-adjust-input').forEach(input => {
            const val = input.value;
            if (val !== '' && !isNaN(val)) {
                const key = `${input.dataset.name}_${input.dataset.pnr}_${input.dataset.leg}`;
                adjustments[key] = Number(val);
            }
        });

        const activeFormat = isShare ? 'photo' : format;

        try {
            if (scenario.canChoose) {
                showInvoiceOptionModal(async (selectedMode) => {
                    try {
                        if (activeFormat === 'photo') {
                            await generateInvoiceImage(pnrList, type, date, selectedMode, brand, adjustments, null, isShare);
                        } else {
                            await generateInvoice(pnrList, type, date, selectedMode, brand, adjustments);
                        }
                        onDone(true, `${type} generated successfully!`);
                    } catch (err) {
                        console.error(err);
                        onDone(false, 'Failed to generate document.');
                    }
                });
            } else {
                if (activeFormat === 'photo') {
                    await generateInvoiceImage(pnrList, type, date, 'auto', brand, adjustments, selection, isShare);
                } else {
                    await generateInvoice(pnrList, type, date, 'auto', brand, adjustments, selection);
                }
                onDone(true, `${type} generated successfully!`);
            }
        } catch (err) {
            console.error(err);
            onDone(false, 'Failed to generate document.');
        }
    }

    if (invoiceGenerateBtn) invoiceGenerateBtn.addEventListener('click', () => runInvoiceGeneration(false));
    const invoiceShareBtn = document.getElementById('invoiceShareBtn');
    if (invoiceShareBtn) invoiceShareBtn.addEventListener('click', () => runInvoiceGeneration(true));
    if (invoiceForm) invoiceForm.addEventListener('submit', (e) => { e.preventDefault(); runInvoiceGeneration(false); });

    if (invoiceClearBtn) {
        invoiceClearBtn.addEventListener('click', () => {
            grouping.value = 'pnr';
            grouping.dispatchEvent(new Event('change'));
            document.getElementById('invoice_pnr_list').value = '';
            document.getElementById('invoice_date').value = '';
            document.getElementById('document_type').value = 'Invoice';
            document.getElementById('invoice_brand').value = 'ocean';
            const wrapper = document.getElementById('invoice_adjustments_wrapper');
            if (wrapper) wrapper.style.display = 'none';
            const container = document.getElementById('invoice_adjustments_list');
            if (container) container.innerHTML = '';
            hideServiceToast('invoiceToast');
        });
    }

    // ---------- Documents (Firebase Storage + seed list) ----------
    let docCache = [];
    let docView = 'card';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getDocIcon(ext) {
        const e = (ext || '').toLowerCase();
        if (e === 'pdf') return { iconClass: 'pdf', icon: 'fa-file-pdf' };
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(e)) return { iconClass: 'image', icon: 'fa-file-image' };
        if (['doc', 'docx'].includes(e)) return { iconClass: 'word', icon: 'fa-file-word' };
        if (['xls', 'xlsx', 'csv'].includes(e)) return { iconClass: 'excel', icon: 'fa-file-excel' };
        if (['zip', 'rar', '7z'].includes(e)) return { iconClass: 'archive', icon: 'fa-file-zipper' };
        return { iconClass: 'generic', icon: 'fa-file-lines' };
    }

    let docFetchState = 'idle'; // 'loading' | 'success' | 'empty' | 'error' | 'offline'
    let docErrorMessage = '';

    function renderDocuments() {
        const grid = document.getElementById('documentsGrid');
        const countEl = document.getElementById('docCount');
        if (!grid) return;

        const isDetail = docView === 'detail';
        grid.classList.toggle('is-detail', isDetail);

        if (docFetchState === 'loading') {
            if (countEl) countEl.textContent = 'Loading…';
            grid.innerHTML = '<div class="documents-loading" role="status"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading documents…</div>';
            return;
        }

        if (docFetchState === 'offline') {
            if (countEl) countEl.textContent = 'Offline';
            grid.innerHTML = `
                <div class="documents-state documents-offline" role="alert">
                    <i class="fa-solid fa-wifi-slash"></i>
                    <p><strong>Offline Mode</strong><br>You are currently offline. Check your internet connection to view or upload documents.</p>
                    <button type="button" class="btn btn-secondary btn-sm btn-retry" id="docRetryOfflineBtn">
                        <i class="fa-solid fa-rotate-right"></i> Retry
                    </button>
                </div>
            `;
            document.getElementById('docRetryOfflineBtn')?.addEventListener('click', refreshDocuments);
            return;
        }

        if (docFetchState === 'error') {
            if (countEl) countEl.textContent = 'Error';
            grid.innerHTML = `
                <div class="documents-state documents-error" role="alert">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <p><strong>Unable to load documents</strong><br>${escapeHtml(docErrorMessage || 'Failed to fetch files from storage.')}</p>
                    <button type="button" class="btn btn-secondary btn-sm btn-retry" id="docRetryBtn">
                        <i class="fa-solid fa-rotate-right"></i> Retry
                    </button>
                </div>
            `;
            document.getElementById('docRetryBtn')?.addEventListener('click', refreshDocuments);
            return;
        }

        if (countEl) {
            countEl.textContent = `${docCache.length} document${docCache.length === 1 ? '' : 's'}`;
        }

        if (docCache.length === 0) {
            grid.innerHTML = '<div class="documents-empty"><i class="fa-solid fa-folder-open"></i> No documents yet. Click <strong>Upload</strong> to add one.</div>';
            return;
        }

        const headerRow = isDetail
            ? `<div class="doc-row-head">
                    <span></span>
                    <span>Name</span>
                    <span>Type</span>
                    <span>Size</span>
                    <span>Uploaded</span>
                    <span>Actions</span>
                </div>`
            : '';

        const rows = docCache.map((doc, idx) => {
            const { iconClass, icon } = getDocIcon(doc.ext);
            const sizeStr = formatFileSize(doc.size);
            const dateStr = formatUploadDate(doc.uploadedAt);
            const tagClass = String(doc.type || 'document').toLowerCase().replace(/\s+/g, '-');
            const canDelete = doc.source === 'firebase' && doc.path;
            return `
                <div class="document-card" role="link" tabindex="0" data-doc-index="${idx}" data-title="${escapeHtml(doc.title)}" data-type="${escapeHtml(doc.type)}" data-ext="${escapeHtml(doc.ext)}">
                    <div class="doc-icon-box ${iconClass}"><i class="fa-solid ${icon}"></i></div>
                    <div class="doc-info">
                        <span class="doc-title">${escapeHtml(doc.title)}</span>
                        <span class="doc-subtitle">${escapeHtml((doc.ext || '').toUpperCase())} &middot; ${escapeHtml(sizeStr)}</span>
                        <span class="doc-meta">
                            <span class="doc-tag ${tagClass}">${escapeHtml(doc.type)}</span>
                            <span class="doc-type">${escapeHtml((doc.ext || '').toUpperCase())}</span>
                        </span>
                    </div>
                    <span class="doc-tag-cell"><span class="doc-tag ${tagClass}">${escapeHtml(doc.type)}</span></span>
                    <span class="doc-size-cell">${escapeHtml(sizeStr)}</span>
                    <span class="doc-date-cell">${escapeHtml(dateStr)}</span>
                    <div class="doc-actions">
                        <button type="button" class="doc-action doc-edit-action" data-doc-action="rename" title="${canDelete ? `Rename ${escapeHtml(doc.title)}` : 'Cannot rename'}" aria-label="Rename ${escapeHtml(doc.title)}" ${canDelete ? '' : 'disabled'}>
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button type="button" class="doc-action" data-doc-action="download" title="Download ${escapeHtml(doc.title)}" aria-label="Download ${escapeHtml(doc.title)}">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button type="button" class="doc-action doc-delete-action" data-doc-action="delete" title="${canDelete ? `Delete ${escapeHtml(doc.title)}` : 'Cannot delete'}" aria-label="Delete ${escapeHtml(doc.title)}" ${canDelete ? '' : 'disabled'}>
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        grid.innerHTML = headerRow + rows;
    }

    function downloadDocument(doc) {
        if (!doc?.url) return;
        const link = document.createElement('a');
        link.href = doc.url;
        link.download = doc.filename || doc.title || 'document';
        link.target = '_blank';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function refreshDocuments() {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            docFetchState = 'offline';
            renderDocuments();
            return;
        }

        docFetchState = 'loading';
        renderDocuments();

        try {
            docCache = await getAllDocuments();
            docFetchState = 'success';
        } catch (err) {
            console.error('Failed to load documents:', err);
            if (err?.isOffline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
                docFetchState = 'offline';
            } else {
                docFetchState = 'error';
                docErrorMessage = err.message || 'Unable to retrieve documents';
            }
        }
        renderDocuments();
    }

    // Auto-retry when connection restores
    window.addEventListener('online', () => {
        if (docFetchState === 'offline' || docFetchState === 'error') {
            refreshDocuments();
        }
    });

    // Initial load
    refreshDocuments();

    // Document view toggle
    document.querySelectorAll('input[name="doc_view"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            docView = e.target.value;
            renderDocuments();
        });
    });

    // Document search filter
    const docSearch = document.getElementById('docSearch');
    if (docSearch) {
        docSearch.addEventListener('input', debounce((e) => {
            const q = e.target.value.toLowerCase().trim();
            document.querySelectorAll('.document-card').forEach(card => {
                const title = (card.dataset.title || '').toLowerCase();
                const type = (card.dataset.type || '').toLowerCase();
                card.classList.toggle('hidden', q && !title.includes(q) && !type.includes(q));
            });
        }, 150));
    }

    const documentsGrid = document.getElementById('documentsGrid');
    if (documentsGrid) {
        documentsGrid.addEventListener('click', async (e) => {
            const card = e.target.closest('.document-card');
            if (!card) return;
            const doc = docCache[Number(card.dataset.docIndex)];
            if (!doc) return;

            const action = e.target.closest('[data-doc-action]')?.dataset.docAction;

            if (action === 'rename') {
                e.preventDefault();
                e.stopPropagation();
                if (doc.source !== 'firebase' || !doc.path) {
                    showToast('This document cannot be renamed.', 'info');
                    return;
                }
                const newName = window.prompt('Enter new document name:', doc.title);
                if (!newName || newName.trim() === '' || newName.trim() === doc.title) return;
                try {
                    await renameDocument(doc.path, newName.trim());
                    showToast(`Renamed to "${newName.trim()}"`, 'success');
                    await refreshDocuments();
                } catch (err) {
                    console.error(err);
                    showToast(err.message || 'Rename failed.', 'error');
                }
                return;
            }

            if (action === 'delete') {
                e.preventDefault();
                e.stopPropagation();
                if (doc.source !== 'firebase' || !doc.path) {
                    showToast('This document cannot be deleted.', 'info');
                    return;
                }
                const ok = window.confirm(`Delete "${doc.title}"? This cannot be undone.`);
                if (!ok) return;
                try {
                    await deleteDocument(doc.path);
                    showToast(`Deleted "${doc.title}"`, 'success');
                    await refreshDocuments();
                } catch (err) {
                    console.error(err);
                    showToast(err.message || 'Delete failed.', 'error');
                }
                return;
            }

            downloadDocument(doc);
        });

        documentsGrid.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.document-card');
            if (!card || e.target.closest('[data-doc-action]')) return;
            e.preventDefault();
            const doc = docCache[Number(card.dataset.docIndex)];
            downloadDocument(doc);
        });
    }

    // Upload feature
    const uploadBtn = document.getElementById('docUploadBtn');
    const uploadInput = document.getElementById('docUploadInput');
    const uploadProgress = document.getElementById('docUploadProgress');
    const uploadName = document.getElementById('docUploadName');
    const uploadPct = document.getElementById('docUploadPct');
    const uploadFill = document.getElementById('docUploadFill');

    if (uploadBtn && uploadInput) {
        uploadBtn.addEventListener('click', () => uploadInput.click());

        uploadInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const defaultTitle = file.name.replace(/\.[^.]+$/, '');
            const enteredTitle = window.prompt('Enter document name', defaultTitle);
            if (enteredTitle === null) {
                uploadInput.value = '';
                return;
            }
            const documentTitle = enteredTitle.trim();
            if (!documentTitle) {
                showToast('Document name is required.', 'error');
                uploadInput.value = '';
                return;
            }
            const inferType = (n) => {
                const lower = n.toLowerCase();
                if (lower.includes('hotel')) return 'Hotel';
                if (lower.includes('airline') || lower.includes('flight') || lower.includes('ssr')) return 'Airline';
                return 'Document';
            };

            uploadProgress.hidden = false;
            uploadName.textContent = documentTitle;
            uploadPct.textContent = '0%';
            uploadFill.style.width = '0%';
            setButtonLoading(uploadBtn, true);

            try {
                await uploadDocument(file, {
                    title: documentTitle,
                    type: inferType(file.name),
                    onProgress: (pct) => {
                        uploadPct.textContent = `${pct}%`;
                        uploadFill.style.width = `${pct}%`;
                    }
                });
                showToast(`Uploaded "${documentTitle}"`, 'success');
                await refreshDocuments();
            } catch (err) {
                console.error(err);
                showToast(err.message || 'Upload failed.', 'error');
            } finally {
                setButtonLoading(uploadBtn, false);
                uploadInput.value = '';
                setTimeout(() => { uploadProgress.hidden = true; }, 600);
            }
        });
    }

    // Render recent activity on init
    renderRecentActivity();

    // Global listeners
    window.addEventListener('click', (event) => {
        if (event.target == document.getElementById('modal')) closeModal();
        if (event.target == document.getElementById('exportConfirmModal')) document.getElementById('exportConfirmModal').classList.remove('show');
    });

    // Theme change listener for chart redraw
    document.body.addEventListener('themeChanged', () => {
        updateComparisonChart();
    });
}


// --- AIRASIA E-TICKET GENERATOR LOGIC ---
let airAsiaGeneratorInitialized = false;
function initializeAirAsiaGenerator() {
    if (airAsiaGeneratorInitialized) return;
    airAsiaGeneratorInitialized = true;
    loadDocumentLibraries('pdf').catch(() => {});
    const dropZone = document.getElementById('airAsiaDropZone');
    const fileInput = document.getElementById('airAsiaFileInput');
    const uploadBtn = document.getElementById('airAsiaUploadBtn');
    const manualBtn = document.getElementById('airAsiaManualBtn');
    const modal = document.getElementById('airAsiaModal');
    const closeBtn = document.getElementById('airAsiaModalCloseBtn');
    const cancelBtn = document.getElementById('airAsiaCancelBtn');
    const downloadPdfBtn = document.getElementById('airAsiaDownloadPdfBtn');
    const previewContainer = document.getElementById('airAsiaPreviewContainer');

    if (!dropZone || !modal) return;

    function renderPassengerRows(passengersList = []) {
        const container = document.getElementById('aa_passengers_list');
        if (!container) return;
        container.innerHTML = '';

        if (!passengersList || passengersList.length === 0) {
            passengersList = [{ name: '', type: 'Adult', eticket: '', passport: '', expiry: '' }];
        }

        passengersList.forEach((p, idx) => {
            const row = document.createElement('div');
            row.className = 'aa_pax_row';
            row.style.cssText = 'background:var(--apple-bg-secondary); padding:10px 12px; border-radius:8px; border:1px solid var(--apple-separator); display:flex; flex-direction:column; gap:8px;';
            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:12px; font-weight:700; color:var(--apple-text);"><i class="fa-solid fa-user" style="color:var(--apple-blue); margin-right:4px;"></i> Passenger ${idx + 1}</span>
                    <button type="button" class="btn btn-sm aa_remove_pax_btn" style="padding:1px 6px; font-size:11px; border:none; background:transparent; color:#ff3b30; cursor:pointer;" title="Remove Passenger">
                        <i class="fa-solid fa-trash-can"></i> Remove
                    </button>
                </div>
                <div class="airasia-form-row">
                    <div class="airasia-form-group" style="flex:2;">
                        <label style="font-size:10.5px;">Passenger Name</label>
                        <input type="text" class="aa_pax_name_input" value="${escapeAaHtml(p.name || '')}" placeholder="PASSENGER FULL NAME" style="font-weight:700; text-transform:uppercase;">
                    </div>
                    <div class="airasia-form-group" style="flex:1;">
                        <label style="font-size:10.5px;">Type</label>
                        <select class="aa_pax_type_input" style="font-size:12px;">
                            <option value="Adult" ${p.type === 'Adult' ? 'selected' : ''}>Adult</option>
                            <option value="Child" ${p.type === 'Child' ? 'selected' : ''}>Child</option>
                            <option value="Infant" ${p.type === 'Infant' ? 'selected' : ''}>Infant</option>
                        </select>
                    </div>
                </div>
                <div class="airasia-form-row">
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">E-Ticket No.</label>
                        <input type="text" class="aa_pax_ticket_input" value="${escapeAaHtml(p.eticket || p.eTicketNo || '')}" placeholder="e.g. 2172350542658">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Passport No.</label>
                        <input type="text" class="aa_pax_passport_input" value="${escapeAaHtml(p.passport || '')}" placeholder="e.g. MJ432310" style="text-transform:uppercase;">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Passport Expiry</label>
                        <input type="text" class="aa_pax_expiry_input" value="${escapeAaHtml(p.expiry || '')}" placeholder="e.g. 2029-09-12">
                    </div>
                </div>
            `;

            row.querySelectorAll('input, select').forEach(el => {
                el.addEventListener('input', updatePreview);
                el.addEventListener('change', updatePreview);
            });

            const paxNameInput = row.querySelector('.aa_pax_name_input');
            paxNameInput?.addEventListener('blur', () => {
                const currentAirline = document.getElementById('aa_airline_select')?.value;
                if (currentAirline === 'China Airlines' && paxNameInput.value.trim() && typeof formatPassengerName === 'function') {
                    paxNameInput.value = formatPassengerName(paxNameInput.value);
                    updatePreview();
                }
            });

            row.querySelector('.aa_remove_pax_btn').addEventListener('click', () => {
                const totalRows = container.querySelectorAll('.aa_pax_row').length;
                if (totalRows <= 1) {
                    row.querySelector('.aa_pax_name_input').value = '';
                    row.querySelector('.aa_pax_type_input').value = 'Adult';
                    row.querySelector('.aa_pax_ticket_input').value = '';
                    row.querySelector('.aa_pax_passport_input').value = '';
                    row.querySelector('.aa_pax_expiry_input').value = '';
                } else {
                    row.remove();
                }
                updatePreview();
            });

            container.appendChild(row);
        });
    }

    function collectPassengers() {
        const container = document.getElementById('aa_passengers_list');
        if (!container) return [{ name: '', type: 'Adult', eticket: '', passport: '', expiry: '' }];
        const rows = container.querySelectorAll('.aa_pax_row');
        const list = [];
        rows.forEach(r => {
            const name = (r.querySelector('.aa_pax_name_input')?.value || '').trim().toUpperCase();
            const type = r.querySelector('.aa_pax_type_input')?.value || 'Adult';
            const eticket = (r.querySelector('.aa_pax_ticket_input')?.value || '').trim();
            const passport = (r.querySelector('.aa_pax_passport_input')?.value || '').trim().toUpperCase();
            const expiry = (r.querySelector('.aa_pax_expiry_input')?.value || '').trim();
            if (name) {
                list.push({ name, type, eticket, eTicketNo: eticket, passport, expiry });
            }
        });
        return list.length > 0 ? list : [{ name: '', type: 'Adult', eticket: '', passport: '', expiry: '' }];
    }

    const addPaxBtn = document.getElementById('aa_add_pax_btn');
    addPaxBtn?.addEventListener('click', () => {
        const currentPassengers = collectPassengers();
        currentPassengers.push({ name: '', type: 'Adult' });
        renderPassengerRows(currentPassengers);
        const container = document.getElementById('aa_passengers_list');
        const lastInput = container?.querySelector('.aa_pax_row:last-child .aa_pax_name_input');
        if (lastInput) lastInput.focus();
        updatePreview();
    });

    function escapeAaHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderFlightRows(flightsList) {
        const container = document.getElementById('aa_flights_list');
        if (!container) return;
        container.innerHTML = '';

        flightsList.forEach((f, idx) => {
            const card = document.createElement('div');
            card.className = 'aa_flight_card';
            card.style.cssText = 'background:var(--apple-card-bg, #fbfbfb); border:1px solid var(--apple-separator, #e5e5e5); border-radius:10px; padding:12px; position:relative;';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:6px; border-bottom:1px dashed var(--apple-separator, #e5e5e5);">
                    <strong style="color:var(--apple-text, #1d1d1f); font-size:12px;"><i class="fa-solid fa-plane" style="color:var(--apple-blue); margin-right:4px;"></i> Sector ${idx + 1}</strong>
                    ${flightsList.length > 1 ? `<button type="button" class="btn btn-sm aa_remove_flight_btn" style="padding:1px 6px; font-size:11px; border:none; background:transparent; color:#ff3b30; cursor:pointer;"><i class="fa-solid fa-trash-can"></i> Remove</button>` : ''}
                </div>
                <div class="airasia-form-row" style="margin-bottom:8px;">
                    <div class="airasia-form-group" style="grid-column: 1 / -1;">
                        <label style="font-size:11px;">Route</label>
                        <input type="text" class="aa_flight_route" value="${escapeAaHtml(f.route || '')}" placeholder="e.g. Bangkok (BKK) - London (LHR)">
                    </div>
                </div>
                <div class="airasia-form-row" style="margin-bottom:8px;">
                    <div class="airasia-form-group">
                        <label style="font-size:11px;">Flight Number</label>
                        <input type="text" class="aa_flight_no" value="${escapeAaHtml(f.flightNo || '')}" placeholder="e.g. TG 910 / FD252 / VJ334" style="text-transform:uppercase; font-weight:700;">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:11px;">Airline / Carrier</label>
                        <input type="text" class="aa_flight_airline" value="${escapeAaHtml(f.airlineName || '')}" placeholder="e.g. Thai Airways International">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:11px;">Sector Booking Ref (PNR)</label>
                        <input type="text" class="aa_flight_pnr" value="${escapeAaHtml(f.pnr || '')}" placeholder="e.g. BINUFH" style="text-transform:uppercase; font-weight:700; color:var(--apple-blue);">
                    </div>
                </div>
                <div class="airasia-form-row" style="margin-bottom:8px;">
                    <div class="airasia-form-group">
                        <label style="font-size:11px;">Duration</label>
                        <input type="text" class="aa_flight_duration" value="${escapeAaHtml(f.duration || '12h 30min, Non-Stop')}" placeholder="e.g. 12h 30min, Non-Stop">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:11px;">Aircraft</label>
                        <input type="text" class="aa_flight_aircraft" value="${escapeAaHtml(f.aircraft || 'Boeing 777-300ER')}" placeholder="e.g. Boeing 777-300ER">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:11px;">Sector Class</label>
                        <input type="text" class="aa_flight_class" value="${escapeAaHtml(f.flightClass || 'Economy (T)')}" placeholder="e.g. Economy (T)">
                    </div>
                </div>
                
                <div style="font-size:11px; font-weight:700; color:var(--apple-blue, #0071e3); margin:6px 0 4px 0;">Departure</div>
                <div class="airasia-form-row" style="margin-bottom:6px;">
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Departure Time</label>
                        <input type="text" class="aa_flight_dep_time" value="${escapeAaHtml(f.depTime || '')}" placeholder="e.g. 00:45">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Departure Date</label>
                        <input type="text" class="aa_flight_dep_date" value="${escapeAaHtml(f.depDateFormatted || '')}" placeholder="e.g. Wednesday, 30 September 2026">
                    </div>
                </div>
                <div class="airasia-form-row" style="margin-bottom:8px;">
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Departure Airport (with code)</label>
                        <input type="text" class="aa_flight_dep_airport" value="${escapeAaHtml(f.depAirport || '')}" placeholder="e.g. Bangkok - Suvarnabhumi Intl (BKK)">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Terminal</label>
                        <input type="text" class="aa_flight_dep_terminal" value="${escapeAaHtml(f.depTerminal || '')}" placeholder="Terminal 1">
                    </div>
                </div>

                <div style="font-size:11px; font-weight:700; color:var(--apple-blue, #0071e3); margin:6px 0 4px 0;">Arrival</div>
                <div class="airasia-form-row" style="margin-bottom:6px;">
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Arrival Time</label>
                        <input type="text" class="aa_flight_arr_time" value="${escapeAaHtml(f.arrTime || '')}" placeholder="e.g. 07:15">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Arrival Date</label>
                        <input type="text" class="aa_flight_arr_date" value="${escapeAaHtml(f.arrDateFormatted || '')}" placeholder="e.g. Wednesday, 30 September 2026">
                    </div>
                </div>
                <div class="airasia-form-row">
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Arrival Airport (with code)</label>
                        <input type="text" class="aa_flight_arr_airport" value="${escapeAaHtml(f.arrAirport || '')}" placeholder="e.g. London - Heathrow (LHR), Terminal 2">
                    </div>
                    <div class="airasia-form-group">
                        <label style="font-size:10.5px;">Terminal</label>
                        <input type="text" class="aa_flight_arr_terminal" value="${escapeAaHtml(f.arrTerminal || '')}" placeholder="Terminal 2">
                    </div>
                </div>
            `;

            card.querySelectorAll('input').forEach(inp => {
                inp.addEventListener('input', updatePreview);
                inp.addEventListener('change', updatePreview);
            });

            card.querySelector('.aa_remove_flight_btn')?.addEventListener('click', () => {
                const currentFlights = collectFlights();
                currentFlights.splice(idx, 1);
                renderFlightRows(currentFlights.length > 0 ? currentFlights : [{
                    flightNo: '', airlineName: 'AirAsia Berhad', duration: '12h 30min, Non-Stop', aircraft: 'Boeing 777-300ER', flightClass: 'Economy', depTime: '', depDateFormatted: '', depAirport: '', depTerminal: '', arrTime: '', arrDateFormatted: '', arrAirport: '', arrTerminal: '', route: ''
                }]);
                updatePreview();
            });

            container.appendChild(card);
        });
    }

    function collectFlights() {
        const container = document.getElementById('aa_flights_list');
        if (!container) return [];
        const cards = container.querySelectorAll('.aa_flight_card');
        const list = [];
        cards.forEach(card => {
            list.push({
                route: (card.querySelector('.aa_flight_route')?.value || '').trim(),
                flightNo: (card.querySelector('.aa_flight_no')?.value || '').trim().toUpperCase(),
                airlineName: (card.querySelector('.aa_flight_airline')?.value || '').trim(),
                pnr: (card.querySelector('.aa_flight_pnr')?.value || '').trim().toUpperCase(),
                duration: (card.querySelector('.aa_flight_duration')?.value || '').trim(),
                aircraft: (card.querySelector('.aa_flight_aircraft')?.value || '').trim(),
                flightClass: (card.querySelector('.aa_flight_class')?.value || '').trim(),
                depTime: (card.querySelector('.aa_flight_dep_time')?.value || '').trim(),
                depDateFormatted: (card.querySelector('.aa_flight_dep_date')?.value || '').trim(),
                depAirport: (card.querySelector('.aa_flight_dep_airport')?.value || '').trim(),
                depTerminal: (card.querySelector('.aa_flight_dep_terminal')?.value || '').trim(),
                arrTime: (card.querySelector('.aa_flight_arr_time')?.value || '').trim(),
                arrDateFormatted: (card.querySelector('.aa_flight_arr_date')?.value || '').trim(),
                arrAirport: (card.querySelector('.aa_flight_arr_airport')?.value || '').trim(),
                arrTerminal: (card.querySelector('.aa_flight_arr_terminal')?.value || '').trim()
            });
        });
        return list;
    }

    const addFlightBtn = document.getElementById('aa_add_flight_btn');
    addFlightBtn?.addEventListener('click', () => {
        const currentFlights = collectFlights();
        const currentA = document.getElementById('aa_airline_select')?.value;
        const defaultA = currentA === 'Thai Airways' ? 'Thai Airways International' : (currentA === 'VietJet Air' ? 'VietJet Air' : 'Thai AirAsia');
        const defaultFN = currentA === 'Thai Airways' ? 'TG 910' : '';
        currentFlights.push({
            flightNo: defaultFN,
            airlineName: defaultA,
            pnr: '',
            duration: '12h 30min, Non-Stop',
            aircraft: 'Boeing 777-300ER',
            flightClass: 'Economy (T)',
            depTime: '',
            depDateFormatted: '',
            depAirport: '',
            depTerminal: '',
            arrTime: '',
            arrDateFormatted: '',
            arrAirport: '',
            arrTerminal: '',
            route: ''
        });
        renderFlightRows(currentFlights);
        const container = document.getElementById('aa_flights_list');
        const lastInput = container?.querySelector('.aa_flight_card:last-child .aa_flight_route');
        if (lastInput) lastInput.focus();
        updatePreview();
    });

    document.getElementById('aa_airline_select')?.addEventListener('change', (e) => {
        const selectedAirline = e.target.value;
        const bagCheckedEl = document.getElementById('aa_bag_checked');
        const currentFlights = collectFlights();
        const currentBagVal = bagCheckedEl?.value || '';
        const isStandardLayoutAirline = ['EVA Air', 'Thai Airways', 'Singapore Airlines', 'Scoot'].includes(selectedAirline);

        if (isStandardLayoutAirline && bagCheckedEl) {
            bagCheckedEl.value = formatCheckedBaggageLine(currentBagVal);
        } else if (!isStandardLayoutAirline && bagCheckedEl && currentBagVal.startsWith('Checked:')) {
            if (/(?:no\s*free|no\s*checked|(?<!\d)0\s*(?:kg|pcs?|pieces?)\b|\bnil\b|\bnone\b|\bnot\s*included\b)/i.test(currentBagVal)) {
                bagCheckedEl.value = 'No free baggage allowance\nOptional checked baggage can be purchased separately';
            } else {
                const checkedOnly = currentBagVal.replace(/\|\s*Carry-on[\s\S]*/i, '');
                const kgMatch = checkedOnly.match(/(\d+)\s*kg/i);
                const kg = kgMatch ? kgMatch[1] : (selectedAirline === 'VietJet Air' ? '20' : '30');
                bagCheckedEl.value = `${kg} kg per person\nDimensions of each piece cannot exceed 119 x 119 x 81 cm`;
            }
        }

        if (selectedAirline === 'Scoot') {
            const checkinEl = document.getElementById('aa_checkin_notice');
            if (checkinEl && !checkinEl.value) {
                checkinEl.value = '(SIN) 1 Nov 2026, 7:00 AM';
            }
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|singapore|eva|china|vietnam|cathay|hong kong|hk express/i.test(f.airlineName)) {
                    f.airlineName = 'Scoot';
                }
                if (!f.flightNo || /^(AK|VJ|TG|SQ|BR|CI|MU|VN|CX|HX|UO)/i.test(f.flightNo)) {
                    f.flightNo = 'TR 001';
                }
                if (!f.duration) f.duration = '2h 30min, Non-Stop';
                if (!f.aircraft) f.aircraft = 'Airbus A320neo';
                if (!f.flightClass || f.flightClass === 'Economy') f.flightClass = 'Economy (Fly)';
                if (!f.depAirport || f.depAirport.includes('Kuala Lumpur') || f.depAirport.includes('Taipei')) {
                    f.depAirport = 'Singapore - Changi (SIN)';
                    f.depTerminal = 'Terminal 1';
                }
                if (!f.arrAirport || f.arrAirport.includes('London')) {
                    f.arrAirport = 'Bangkok - Don Mueang (DMK)';
                    f.arrTerminal = 'Terminal 1';
                }
                if (!f.route || f.route.includes('KUL') || f.route.includes('TPE')) {
                    f.route = 'SIN - DMK';
                }
            });
            renderFlightRows(currentFlights);
        } else if (selectedAirline === 'EVA Air') {
            const checkinEl = document.getElementById('aa_checkin_notice');
            if (checkinEl && !checkinEl.value) {
                checkinEl.value = '(TPE) 1 Nov 2026, 6:25 AM';
            }
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|singapore|scoot|china|vietnam|cathay|hong kong|hk express/i.test(f.airlineName)) {
                    f.airlineName = 'EVA Air';
                }
                if (!f.flightNo || /^(AK|VJ|TG|SQ|TR|CI|MU|VN|CX|HX|UO)/i.test(f.flightNo)) {
                    f.flightNo = 'BR 001';
                }
                if (!f.duration) f.duration = '3h 40min, Non-Stop';
                if (!f.aircraft) f.aircraft = 'Boeing 787-10';
                if (!f.flightClass || f.flightClass === 'Economy') f.flightClass = 'Economy (Y)';
                if (!f.depAirport || f.depAirport.includes('Kuala Lumpur') || f.depAirport.includes('Singapore')) {
                    f.depAirport = 'Taipei - Taoyuan (TPE)';
                    f.depTerminal = 'Terminal 2';
                }
                if (!f.arrAirport || f.arrAirport.includes('London')) {
                    f.arrAirport = 'Bangkok - Suvarnabhumi (BKK)';
                    f.arrTerminal = '';
                }
                if (!f.route || f.route.includes('KUL') || f.route.includes('SIN')) {
                    f.route = 'TPE - BKK';
                }
            });
            renderFlightRows(currentFlights);
        } else if (selectedAirline === 'Singapore Airlines') {
            const checkinEl = document.getElementById('aa_checkin_notice');
            if (checkinEl && !checkinEl.value) {
                checkinEl.value = '(SIN) 1 Nov 2026, 6:00 AM';
            }
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|scoot|eva|china|vietnam|cathay|hong kong|hk express/i.test(f.airlineName)) {
                    f.airlineName = 'Singapore Airlines';
                }
                if (!f.flightNo || /^(AK|VJ|TG|TR|BR|CI|MU|VN|CX|HX|UO)/i.test(f.flightNo)) {
                    f.flightNo = 'SQ 001';
                }
                if (!f.duration) f.duration = '13h 30min, Non-Stop';
                if (!f.aircraft) f.aircraft = 'Airbus A380-800';
                if (!f.flightClass || f.flightClass === 'Economy') f.flightClass = 'Economy (S)';
                if (!f.depAirport || f.depAirport.includes('Kuala Lumpur') || f.depAirport.includes('Bangkok')) {
                    f.depAirport = 'Singapore - Changi (SIN)';
                    f.depTerminal = 'Terminal 3';
                }
                if (!f.arrAirport) {
                    f.arrAirport = 'London - Heathrow (LHR)';
                    f.arrTerminal = 'Terminal 2';
                }
                if (!f.route || f.route.includes('KUL') || f.route.includes('BKK')) {
                    f.route = 'SIN - LHR';
                }
            });
            renderFlightRows(currentFlights);
        } else if (selectedAirline === 'Thai Airways') {
            const checkinEl = document.getElementById('aa_checkin_notice');
            if (checkinEl && !checkinEl.value) {
                checkinEl.value = '(BKK) 29 Sep 2026, 9:45 PM';
            }
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|singapore|scoot|eva|china|vietnam|cathay|hong kong|hk express/i.test(f.airlineName)) {
                    f.airlineName = 'Thai Airways International';
                }
                if (!f.flightNo || /^(AK|VJ|SQ|TR|BR|CI|MU|VN|CX|HX|UO)/i.test(f.flightNo)) {
                    f.flightNo = 'TG 910';
                }
                if (!f.duration) f.duration = '12h 30min, Non-Stop';
                if (!f.aircraft) f.aircraft = 'Boeing 777-300ER';
                if (!f.flightClass || f.flightClass === 'Economy') f.flightClass = 'Economy (T)';
                if (!f.depAirport || f.depAirport.includes('Kuala Lumpur')) {
                    f.depAirport = 'Bangkok - Suvarnabhumi Intl (BKK)';
                    f.depTerminal = '';
                }
                if (!f.arrAirport) {
                    f.arrAirport = 'London - Heathrow (LHR)';
                    f.arrTerminal = 'Terminal 2';
                }
                if (!f.route || f.route.includes('KUL')) {
                    f.route = 'BKK - LHR';
                }
            });
            renderFlightRows(currentFlights);
        } else if (selectedAirline === 'VietJet Air') {
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|thai|singapore|scoot|eva|china|vietnam|cathay|hong kong|hk express/i.test(f.airlineName)) f.airlineName = 'VietJet Air';
                if (!f.flightNo || /^(AK|TG|SQ|TR|BR|CI|MU|VN|CX|HX|UO)/i.test(f.flightNo)) f.flightNo = 'VJ';
            });
            renderFlightRows(currentFlights);
        } else if (selectedAirline === 'AirAsia') {
            currentFlights.forEach(f => {
                if (!f.airlineName || /vietjet|thai|singapore|scoot|eva|china|vietnam|cathay|hong kong|hk express/i.test(f.airlineName)) f.airlineName = 'AirAsia Berhad';
                if (!f.flightNo || /^(VJ|TG|SQ|TR|BR|CI|MU|VN|CX|HX|UO)/i.test(f.flightNo)) f.flightNo = 'AK';
            });
            renderFlightRows(currentFlights);
        } else if (selectedAirline === 'China Airlines') {
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|singapore|scoot|eva|china eastern|vietnam|cathay|hong kong|hk express/i.test(f.airlineName)) {
                    f.airlineName = 'CHINA AIRLINES LTD.';
                }
                if (!f.flightNo || /^(AK|VJ|TG|SQ|TR|BR|MU|VN|CX|HX|UO)/i.test(f.flightNo)) {
                    f.flightNo = 'CI 834';
                }
            });
            renderFlightRows(currentFlights);
            const container = document.getElementById('aa_passengers_list');
            const firstPax = container?.querySelector('.aa_pax_name_input');
            if (firstPax && firstPax.value.trim() && typeof formatPassengerName === 'function') {
                firstPax.value = formatPassengerName(firstPax.value);
            }
        } else if (selectedAirline === 'China Eastern') {
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|singapore|scoot|eva|china airlines/i.test(f.airlineName)) {
                    f.airlineName = 'China Eastern Airlines';
                }
                if (!f.flightNo || /^(AK|VJ|TG|SQ|TR|BR|CI)/i.test(f.flightNo)) {
                    f.flightNo = 'MU 562';
                }
                if (!f.aircraft) f.aircraft = 'Airbus A350-900';
                if (!f.flightClass) f.flightClass = 'Economy (Y)';
            });
            renderFlightRows(currentFlights);
            const container = document.getElementById('aa_passengers_list');
            const firstPax = container?.querySelector('.aa_pax_name_input');
            if (firstPax && firstPax.value.trim() && typeof formatPassengerName === 'function') {
                firstPax.value = formatPassengerName(firstPax.value);
            }
            if (bagCheckedEl && (!bagCheckedEl.value || bagCheckedEl.value.includes('kg per person'))) {
                bagCheckedEl.value = '2PC (23KG each)';
            }
        } else if (selectedAirline === 'Vietnam Airlines') {
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|singapore|scoot|eva|china/i.test(f.airlineName)) {
                    f.airlineName = 'Vietnam Airlines';
                }
                if (!f.flightNo || /^(AK|VJ|TG|SQ|TR|BR|CI|MU)/i.test(f.flightNo)) {
                    f.flightNo = 'VN 126';
                }
                if (!f.aircraft) f.aircraft = 'Boeing 787-9';
                if (!f.flightClass) f.flightClass = 'Economy Classic (K)';
            });
            renderFlightRows(currentFlights);
            const container = document.getElementById('aa_passengers_list');
            const firstPax = container?.querySelector('.aa_pax_name_input');
            if (firstPax && firstPax.value.trim() && typeof formatPassengerName === 'function') {
                firstPax.value = formatPassengerName(firstPax.value);
            }
            if (bagCheckedEl && (!bagCheckedEl.value || bagCheckedEl.value.includes('kg per person'))) {
                bagCheckedEl.value = '1PC (23KG)';
            }
        } else if (selectedAirline === 'Cathay Pacific') {
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|singapore|scoot|eva|china|vietnam/i.test(f.airlineName)) {
                    f.airlineName = 'Cathay Pacific';
                }
                if (!f.flightNo || /^(AK|VJ|TG|SQ|TR|BR|CI|MU|VN)/i.test(f.flightNo)) {
                    f.flightNo = 'CX 714';
                }
                if (!f.aircraft) f.aircraft = 'Airbus A350-1000';
                if (!f.flightClass) f.flightClass = 'Economy (K)';
            });
            renderFlightRows(currentFlights);
            const container = document.getElementById('aa_passengers_list');
            const firstPax = container?.querySelector('.aa_pax_name_input');
            if (firstPax && firstPax.value.trim() && typeof formatPassengerName === 'function') {
                firstPax.value = formatPassengerName(firstPax.value);
            }
            if (bagCheckedEl && (!bagCheckedEl.value || bagCheckedEl.value.includes('kg per person'))) {
                bagCheckedEl.value = '2PC (23KG each)';
            }
        } else if (selectedAirline === 'Hong Kong Airlines') {
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|singapore|scoot|eva|china|vietnam|cathay/i.test(f.airlineName)) {
                    f.airlineName = 'Hong Kong Airlines';
                }
                if (!f.flightNo || /^(AK|VJ|TG|SQ|TR|BR|CI|MU|VN|CX)/i.test(f.flightNo)) {
                    f.flightNo = 'HX 264';
                }
                if (!f.aircraft) f.aircraft = 'Airbus A330-300';
                if (!f.flightClass) f.flightClass = 'Economy (E)';
            });
            renderFlightRows(currentFlights);
            const container = document.getElementById('aa_passengers_list');
            const firstPax = container?.querySelector('.aa_pax_name_input');
            if (firstPax && firstPax.value.trim() && typeof formatPassengerName === 'function') {
                firstPax.value = formatPassengerName(firstPax.value);
            }
            if (bagCheckedEl && (!bagCheckedEl.value || bagCheckedEl.value.includes('kg per person'))) {
                bagCheckedEl.value = '20KG / 1PC';
            }
        } else if (selectedAirline === 'HK Express') {
            currentFlights.forEach(f => {
                if (!f.airlineName || /airasia|vietjet|thai|singapore|scoot|eva|china|vietnam|cathay|hong kong airlines/i.test(f.airlineName)) {
                    f.airlineName = 'HK Express';
                }
                if (!f.flightNo || /^(AK|VJ|TG|SQ|TR|BR|CI|MU|VN|CX|HX)/i.test(f.flightNo)) {
                    f.flightNo = 'UO 614';
                }
                if (!f.aircraft) f.aircraft = 'Airbus A321neo';
                if (!f.flightClass) f.flightClass = 'Economy (Fun)';
            });
            renderFlightRows(currentFlights);
            const container = document.getElementById('aa_passengers_list');
            const firstPax = container?.querySelector('.aa_pax_name_input');
            if (firstPax && firstPax.value.trim() && typeof formatPassengerName === 'function') {
                firstPax.value = formatPassengerName(firstPax.value);
            }
            if (bagCheckedEl && (!bagCheckedEl.value || bagCheckedEl.value.includes('kg per person'))) {
                bagCheckedEl.value = 'Checked: 20kg';
            }
        }
        updatePreview();
    });

    function collectFormData() {
        const passengers = collectPassengers();
        const flights = collectFlights();
        const selectedA = document.getElementById('aa_airline_select')?.value || 'AirAsia';
        const primaryFlight = flights[0] || {};

        let defaultAirlineName = 'AirAsia Berhad';
        let defaultFlightNo = 'AK';
        if (selectedA === 'Scoot') {
            defaultAirlineName = 'Scoot';
            defaultFlightNo = 'TR 001';
        } else if (selectedA === 'EVA Air') {
            defaultAirlineName = 'EVA Air';
            defaultFlightNo = 'BR 001';
        } else if (selectedA === 'Singapore Airlines') {
            defaultAirlineName = 'Singapore Airlines';
            defaultFlightNo = 'SQ 001';
        } else if (selectedA === 'Thai Airways') {
            defaultAirlineName = 'Thai Airways International';
            defaultFlightNo = 'TG 910';
        } else if (selectedA === 'VietJet Air') {
            defaultAirlineName = 'VietJet Air';
            defaultFlightNo = 'VJ';
        } else if (selectedA === 'China Airlines') {
            defaultAirlineName = 'CHINA AIRLINES LTD.';
            defaultFlightNo = 'CI 834';
        } else if (selectedA === 'China Eastern') {
            defaultAirlineName = 'China Eastern Airlines';
            defaultFlightNo = 'MU 562';
        } else if (selectedA === 'Vietnam Airlines') {
            defaultAirlineName = 'Vietnam Airlines';
            defaultFlightNo = 'VN 126';
        } else if (selectedA === 'Cathay Pacific') {
            defaultAirlineName = 'Cathay Pacific';
            defaultFlightNo = 'CX 714';
        } else if (selectedA === 'Hong Kong Airlines') {
            defaultAirlineName = 'Hong Kong Airlines';
            defaultFlightNo = 'HX 264';
        } else if (selectedA === 'HK Express') {
            defaultAirlineName = 'HK Express';
            defaultFlightNo = 'UO 614';
        }

        const isMismatchedAirlineName = (an, targetAirline) => {
            if (!an) return true;
            if (targetAirline === 'AirAsia' && !/airasia/i.test(an)) return /vietjet|thai|singapore|scoot|eva|china|vietnam|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'VietJet Air' && !/vietjet/i.test(an)) return /airasia|thai|singapore|scoot|eva|china|vietnam|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'Thai Airways' && !/thai/i.test(an)) return /airasia|vietjet|singapore|scoot|eva|china|vietnam|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'Singapore Airlines' && !/singapore/i.test(an)) return /airasia|vietjet|thai|scoot|eva|china|vietnam|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'EVA Air' && !/eva/i.test(an)) return /airasia|vietjet|thai|singapore|scoot|china|vietnam|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'Scoot' && !/scoot/i.test(an)) return /airasia|vietjet|thai|singapore|eva|china|vietnam|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'China Airlines' && !/china airlines/i.test(an)) return /airasia|vietjet|thai|singapore|scoot|eva|china eastern|vietnam|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'China Eastern' && !/china eastern/i.test(an)) return /airasia|vietjet|thai|singapore|scoot|eva|china airlines|vietnam|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'Vietnam Airlines' && !/vietnam/i.test(an)) return /airasia|vietjet|thai|singapore|scoot|eva|china|cathay|hong kong|hk express/i.test(an);
            if (targetAirline === 'Cathay Pacific' && !/cathay/i.test(an)) return /airasia|vietjet|thai|singapore|scoot|eva|china|vietnam|hong kong|hk express/i.test(an);
            if (targetAirline === 'Hong Kong Airlines' && !/hong kong airlines/i.test(an)) return /airasia|vietjet|thai|singapore|scoot|eva|china|vietnam|cathay|hk express/i.test(an);
            if (targetAirline === 'HK Express' && !/hk express/i.test(an)) return /airasia|vietjet|thai|singapore|scoot|eva|china|vietnam|cathay|hong kong airlines/i.test(an);
            return false;
        };

        const isMismatchedFlightNo = (fn, targetAirline) => {
            if (!fn) return true;
            if (targetAirline === 'AirAsia' && !/^AK/i.test(fn)) return /^(VJ|TG|SQ|TR|BR|CI|MU|VN|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'VietJet Air' && !/^VJ/i.test(fn)) return /^(AK|TG|SQ|TR|BR|CI|MU|VN|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'Thai Airways' && !/^TG/i.test(fn)) return /^(AK|VJ|SQ|TR|BR|CI|MU|VN|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'Singapore Airlines' && !/^SQ/i.test(fn)) return /^(AK|VJ|TG|TR|BR|CI|MU|VN|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'EVA Air' && !/^BR/i.test(fn)) return /^(AK|VJ|TG|SQ|TR|CI|MU|VN|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'Scoot' && !/^TR/i.test(fn)) return /^(AK|VJ|TG|SQ|BR|CI|MU|VN|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'China Airlines' && !/^CI/i.test(fn)) return /^(AK|VJ|TG|SQ|TR|BR|MU|VN|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'China Eastern' && !/^MU/i.test(fn)) return /^(AK|VJ|TG|SQ|TR|BR|CI|VN|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'Vietnam Airlines' && !/^VN/i.test(fn)) return /^(AK|VJ|TG|SQ|TR|BR|CI|MU|CX|HX|UO)/i.test(fn);
            if (targetAirline === 'Cathay Pacific' && !/^CX/i.test(fn)) return /^(AK|VJ|TG|SQ|TR|BR|CI|MU|VN|HX|UO)/i.test(fn);
            if (targetAirline === 'Hong Kong Airlines' && !/^HX/i.test(fn)) return /^(AK|VJ|TG|SQ|TR|BR|CI|MU|VN|CX|UO)/i.test(fn);
            if (targetAirline === 'HK Express' && !/^UO/i.test(fn)) return /^(AK|VJ|TG|SQ|TR|BR|CI|MU|VN|CX|HX)/i.test(fn);
            return false;
        };

        const safeAirlineName = (primaryFlight.airlineName && !isMismatchedAirlineName(primaryFlight.airlineName, selectedA))
            ? primaryFlight.airlineName
            : defaultAirlineName;

        const safeFlightNo = (primaryFlight.flightNo && !isMismatchedFlightNo(primaryFlight.flightNo, selectedA))
            ? primaryFlight.flightNo
            : defaultFlightNo;

        const formPnr = (document.getElementById('aa_pnr')?.value || '').trim().toUpperCase();
        const sectorPnrs = [];
        flights.forEach(f => {
            if (f.pnr) {
                f.pnr.split(/[\/\s]+/).forEach(p => {
                    const cleanP = p.trim().toUpperCase();
                    if (cleanP && !sectorPnrs.includes(cleanP)) sectorPnrs.push(cleanP);
                });
            }
        });
        const effectivePnr = (sectorPnrs.length > 1) ? sectorPnrs.join(' / ') : formPnr;

        return {
            airline: selectedA,
            bookingNo: document.getElementById('aa_booking_no')?.value || '',
            pnr: effectivePnr,
            pnrs: sectorPnrs,
            eTicketNo: document.getElementById('aa_eticket_no')?.value || '',
            flightClass: document.getElementById('aa_class')?.value || (selectedA === 'Thai Airways' ? 'Economy (T)' : 'Economy'),
            issuedDate: document.getElementById('aa_issued_date')?.value || '',
            checkinNotice: document.getElementById('aa_checkin_notice')?.value || '',
            passengers: passengers,
            passengerName: passengers[0]?.name || '',
            passengerType: passengers[0]?.type || 'Adult',
            flights: flights,
            flightNo: safeFlightNo,
            airlineName: safeAirlineName,
            duration: primaryFlight.duration || '12h 30min, Non-Stop',
            aircraft: primaryFlight.aircraft || 'Boeing 777-300ER',
            depTime: primaryFlight.depTime || '',
            depDateFormatted: primaryFlight.depDateFormatted || '',
            depAirport: primaryFlight.depAirport || '',
            depTerminal: primaryFlight.depTerminal || '',
            arrTime: primaryFlight.arrTime || '',
            arrDateFormatted: primaryFlight.arrDateFormatted || '',
            arrAirport: primaryFlight.arrAirport || '',
            arrTerminal: primaryFlight.arrTerminal || '',
            route: primaryFlight.route || '',
            checkedBaggage: document.getElementById('aa_bag_checked')?.value || '',
            carryOnBaggage: document.getElementById('aa_bag_carry')?.value || '',
            carryOnWeight: (() => {
                const cb = (document.getElementById('aa_bag_carry')?.value || '') + ' ' + (document.getElementById('aa_bag_checked')?.value || '');
                const m = cb.match(/carry[\s-]*on[\s\S]{0,30}?(\d+)\s*kg/i)
                    || (document.getElementById('aa_bag_carry')?.value || '').match(/(?:cannot\s*exceed|up\s*to|max)\s*(\d+)\s*kg/i)
                    || (document.getElementById('aa_bag_carry')?.value || '').match(/(\d+)\s*kg/i);
                return m ? `${m[1]}kg` : undefined;
            })(),
            personalItem: document.getElementById('aa_bag_personal')?.value || ''
        };
    }

    function populateForm(data) {
        if (document.getElementById('aa_airline_select')) {
            document.getElementById('aa_airline_select').value = data.airline || 'AirAsia';
        }
        if (document.getElementById('aa_booking_no')) document.getElementById('aa_booking_no').value = data.bookingNo || '';
        if (document.getElementById('aa_pnr')) document.getElementById('aa_pnr').value = data.pnr || '';
        if (document.getElementById('aa_eticket_no')) document.getElementById('aa_eticket_no').value = data.eTicketNo || 'To be advised at check-in';
        if (document.getElementById('aa_class')) document.getElementById('aa_class').value = data.flightClass || 'Economy';
        if (document.getElementById('aa_issued_date')) document.getElementById('aa_issued_date').value = data.issuedDate || '';
        if (document.getElementById('aa_checkin_notice')) document.getElementById('aa_checkin_notice').value = data.checkinNotice || '';
        
        const paxList = (data.passengers && data.passengers.length > 0)
            ? data.passengers
            : [{ name: data.passengerName || '', type: data.passengerType || 'Adult', eticket: data.eTicketNo || '', passport: '', expiry: '' }];
        renderPassengerRows(paxList);

        const flList = (data.flights && data.flights.length > 0)
            ? data.flights
            : [{
                flightNo: data.flightNo || '',
                airlineName: data.airlineName || (data.airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad'),
                duration: data.duration || '12h 30min, Non-Stop',
                aircraft: data.aircraft || 'Boeing 777-300ER',
                flightClass: data.flightClass || 'Economy (T)',
                depTime: data.depTime || '',
                depDateFormatted: data.depDateFormatted || '',
                depAirport: data.depAirport || '',
                depTerminal: data.depTerminal || '',
                arrTime: data.arrTime || '',
                arrDateFormatted: data.arrDateFormatted || '',
                arrAirport: data.arrAirport || '',
                arrTerminal: data.arrTerminal || '',
                route: data.route || ''
            }];
        renderFlightRows(flList);

        const isStandardLayoutAirline = ['EVA Air', 'Thai Airways', 'Singapore Airlines', 'Scoot'].includes(data.airline);
        let initialCheckedBag = data.checkedBaggage;
        if (isStandardLayoutAirline) {
            initialCheckedBag = formatCheckedBaggageLine(initialCheckedBag || 'Checked: 30 kg   |   Carry-on: 7 kg');
        } else if (!initialCheckedBag) {
            initialCheckedBag = '30 kg per person\nDimensions of each piece cannot exceed 119 x 119 x 81 cm';
        }
        if (document.getElementById('aa_bag_checked')) document.getElementById('aa_bag_checked').value = initialCheckedBag;
        if (document.getElementById('aa_bag_carry')) document.getElementById('aa_bag_carry').value = data.carryOnBaggage || '1 piece per person\nMax 56 x 36 x 23 cm per piece';
        if (document.getElementById('aa_bag_personal')) document.getElementById('aa_bag_personal').value = data.personalItem || '1 piece per person\nMax 40 x 30 x 10 cm per piece, fits under the seat in front of you';

        updatePreview();
    }

    function updatePreview() {
        if (!previewContainer) return;
        try {
            const currentData = collectFormData();
            previewContainer.innerHTML = renderAirAsiaTicketHtml(currentData);
        } catch (err) {
            console.error('Preview update error:', err);
        }
    }

    const formInputs = modal.querySelectorAll('.airasia-form-scroll input, .airasia-form-scroll select, .airasia-form-scroll textarea');
    formInputs.forEach(input => {
        input.addEventListener('input', updatePreview);
        input.addEventListener('change', updatePreview);
    });

    async function handleFile(file) {
        if (!file) return;
        const isPdf = file.name.toLowerCase().endsWith('.pdf');
        const isImg = /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name) || (file.type && file.type.startsWith('image/'));

        if (!isPdf && !isImg) {
            showToast('Please select a valid PDF file or travel schedule image.', 'error');
            return;
        }

        try {
            let parsedData;
            if (isImg) {
                showToast('Analyzing travel schedule image (OCR)...', 'info');
                const parsedSchedule = await parseTripScheduleImage(file);
                const flights = (parsedSchedule.flights && parsedSchedule.flights.length > 0) ? parsedSchedule.flights.map(f => ({
                    flightNo: f.flightNo || '',
                    airlineName: f.airlineName || f.operatedBy || 'AirAsia Berhad',
                    duration: f.duration || '',
                    aircraft: f.aircraft || 'Airbus A320neo',
                    cabinClass: f.cabinClass || f.flightClass || 'Economy, Y',
                    flightClass: f.cabinClass || f.flightClass || 'Economy, Y',
                    seat: f.seat || (typeof generateRandomSeat === 'function' ? generateRandomSeat() : '12A'),
                    depTime: f.depTime || '',
                    depDateFormatted: f.depDateFormatted || f.depDate || '',
                    depAirport: f.depAirport || f.from || '',
                    depTerminal: f.depTerminal || '',
                    arrTime: f.arrTime || '',
                    arrDateFormatted: f.arrDateFormatted || f.arrDate || '',
                    arrAirport: f.arrAirport || f.to || '',
                    arrTerminal: f.arrTerminal || '',
                    route: f.route || (f.fromCode && f.toCode ? `${f.fromCode} - ${f.toCode}` : '')
                })) : [];

                parsedData = {
                    airline: parsedSchedule.detectedAirline || 'China Airlines',
                    pnr: parsedSchedule.pnr || '',
                    bookingNo: parsedSchedule.pnr || '',
                    eTicketNo: parsedSchedule.ticketNo || '',
                    passengerName: parsedSchedule.passengerName || '',
                    passengers: [{ name: parsedSchedule.passengerName || '', type: 'Adult', eticket: parsedSchedule.ticketNo || '' }],
                    flights: flights,
                    checkedBaggage: parsedSchedule.checkedBaggage,
                    carryOnBaggage: parsedSchedule.carryOnBaggage,
                    carryOnWeight: parsedSchedule.carryOnWeight,
                    personalItem: parsedSchedule.personalItem
                };
            } else {
                showToast('Extracting itinerary from PDF...', 'info');
                const rawText = await extractTextFromPdf(file);
                if (!rawText || rawText.trim().length < 30) {
                    showToast('Could not extract text from PDF (it might be a scanned image). Opening form for manual review.', 'warning');
                }
                parsedData = parseItineraryText(rawText);
                if (!parsedData.flights || parsedData.flights.length === 0 || !parsedData.flightNo) {
                    const altSchedule = parseItinerarySchedule(rawText);
                    if (altSchedule.flights && altSchedule.flights.length > 0) {
                        parsedData.airline = altSchedule.detectedAirline || parsedData.airline || 'China Airlines';
                        parsedData.flights = altSchedule.flights;
                        parsedData.pnr = parsedData.pnr || altSchedule.pnr;
                        parsedData.passengerName = altSchedule.passengerName || '';
                        parsedData.passengers = [{ name: altSchedule.passengerName || '', type: 'Adult' }];
                        if (altSchedule.checkedBaggage && !parsedData.checkedBaggage) {
                            parsedData.checkedBaggage = altSchedule.checkedBaggage;
                        }
                        if (altSchedule.carryOnWeight && !parsedData.carryOnWeight) {
                            parsedData.carryOnWeight = altSchedule.carryOnWeight;
                        }
                    }
                }
            }

            populateForm(parsedData);
            modal.classList.add('show');
            const detectedName = parsedData.airline || 'Airline';
            showToast(`${detectedName} ticket data extracted successfully!`, 'success');
        } catch (err) {
            console.error('File parsing error:', err);
            showToast(`Parsing failed: ${err.message}`, 'error');
        }
    }

    uploadBtn?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        e.target.value = '';
    });

    dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone?.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    });

    manualBtn?.addEventListener('click', () => {
        populateForm({
            airline: 'AirAsia',
            bookingNo: '',
            pnr: '',
            eTicketNo: 'To be advised at check-in',
            flightClass: 'Economy',
            passengers: [{ name: '', type: 'Adult' }],
            passengerType: 'Adult',
            flights: [{
                flightNo: 'AK',
                airlineName: 'AirAsia Berhad',
                depTime: '12:00',
                depDateFormatted: '',
                depAirport: 'Kuala Lumpur International Airport (KUL)',
                depTerminal: 'Terminal 2',
                arrTime: '13:00',
                arrDateFormatted: '',
                arrAirport: '',
                arrTerminal: '',
                route: ''
            }],
            checkedBaggage: '30 kg per person\nEach piece max 119 x 119 x 81 cm (total 319 cm)',
            carryOnBaggage: '1 piece per person\nMax 56 x 36 x 23 cm per piece',
            personalItem: '1 piece per person\nMax 40 x 30 x 10 cm per piece, fits under the seat in front of you'
        });
        modal.classList.add('show');
    });

    closeBtn?.addEventListener('click', () => modal.classList.remove('show'));
    cancelBtn?.addEventListener('click', () => modal.classList.remove('show'));

    let isAirAsiaDownloading = false;
    downloadPdfBtn?.addEventListener('click', async () => {
        if (isAirAsiaDownloading) return;
        const paxName = (document.querySelector('.aa_pax_name_input')?.value || '').trim();
        if (!paxName) {
            showToast('Please enter passenger name before downloading ticket.', 'warning');
            const input = document.querySelector('.aa_pax_name_input');
            if (input) input.focus();
            return;
        }
        isAirAsiaDownloading = true;

        try {
            downloadPdfBtn.disabled = true;
            downloadPdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
            const data = collectFormData();
            const filename = await downloadAirAsiaPdf(data);
            if (filename) {
                showToast(`E-Ticket PDF downloaded: ${filename}`, 'success');
            }
        } catch (err) {
            console.error('PDF generation error:', err);
            showToast(`Could not generate PDF: ${err.message}`, 'error');
        } finally {
            isAirAsiaDownloading = false;
            downloadPdfBtn.disabled = false;
            downloadPdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
        }
    });

    const downloadImageBtn = document.getElementById('airAsiaDownloadImageBtn');
    let isAirAsiaImageDownloading = false;
    downloadImageBtn?.addEventListener('click', async () => {
        if (isAirAsiaImageDownloading) return;
        const paxName = (document.querySelector('.aa_pax_name_input')?.value || '').trim();
        if (!paxName) {
            showToast('Please enter passenger name before exporting image.', 'warning');
            const input = document.querySelector('.aa_pax_name_input');
            if (input) input.focus();
            return;
        }
        isAirAsiaImageDownloading = true;

        try {
            downloadImageBtn.disabled = true;
            downloadImageBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Exporting Image...';
            const data = collectFormData();
            const filename = await downloadAirAsiaImage(data);
            if (filename) {
                showToast(`E-Ticket Image exported: ${filename}`, 'success');
            }
        } catch (err) {
            console.error('Image export error:', err);
            showToast(`Could not export image: ${err.message}`, 'error');
        } finally {
            isAirAsiaImageDownloading = false;
            downloadImageBtn.disabled = false;
            downloadImageBtn.innerHTML = '<i class="fa-solid fa-file-image"></i> Export Image';
        }
    });
}

// --- CHINA VISA HOTEL BOOKING (AGODA) GENERATOR LOGIC ---
let chinaHotelGeneratorInitialized = false;
function initializeChinaHotelGenerator() {
    if (chinaHotelGeneratorInitialized) return;
    chinaHotelGeneratorInitialized = true;
    loadDocumentLibraries('pdf').catch(() => {});
    const openBtn = document.getElementById('openChinaHotelBtn');
    const quickBtn = document.getElementById('quickChinaHotelBtn');
    const modal = document.getElementById('chinaHotelModal');
    const closeBtn = document.getElementById('chinaHotelModalCloseBtn');
    const cancelBtn = document.getElementById('chinaHotelCancelBtn');
    const downloadPdfBtn = document.getElementById('chinaHotelDownloadPdfBtn');
    const previewContainer = document.getElementById('agodaPreviewContainer');
    const rollBookingBtn = document.getElementById('agoda_roll_booking_id');
    const rollMemberBtn = document.getElementById('agoda_roll_member_id');
    const rollBookingRefBtn = document.getElementById('agoda_roll_booking_ref_no');
    const switchToOldBtn = document.getElementById('switchToOldHotelBtn');
    const switchToAgodaBtn = document.getElementById('switchToAgodaHotelBtn');
    const chinaHotelPanel = document.getElementById('chinaHotelPanel');
    const hotelPanel = document.getElementById('hotelPanel');

    // Agoda PDF Drop Zone & File Input
    const dropZone = document.getElementById('agodaDropZone');
    const fileInput = document.getElementById('agodaFileInput');
    const uploadBtn = document.getElementById('agodaUploadPdfBtn');
    const modalImportBtn = document.getElementById('agodaModalImportPdfBtn');

    // Toggle between Agoda style (default) and Old style voucher
    switchToOldBtn?.addEventListener('click', () => {
        if (chinaHotelPanel) chinaHotelPanel.style.display = 'none';
        if (hotelPanel) {
            hotelPanel.style.display = '';
            hotelPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    switchToAgodaBtn?.addEventListener('click', () => {
        if (hotelPanel) hotelPanel.style.display = 'none';
        if (chinaHotelPanel) {
            chinaHotelPanel.style.display = '';
            chinaHotelPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    if (!modal) return;

    // Handle uploaded Agoda / Trip.com PDF file
    async function handleHotelPdfFile(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            showToast('Please upload a valid PDF file.', 'warning');
            return;
        }

        showToast('Extracting Agoda / Trip.com hotel confirmation...', 'info');
        try {
            const parsedData = await parseHotelConfirmationPdf(file);
            populateForm(parsedData);

            // Also update the quick panel inputs on the Services tab
            if (document.getElementById('service_hotel_destination') && parsedData.destination) {
                document.getElementById('service_hotel_destination').value = parsedData.destination;
            }
            if (document.getElementById('service_hotel_client_name') && parsedData.clientName) {
                document.getElementById('service_hotel_client_name').value = parsedData.clientName;
            }
            if (document.getElementById('service_hotel_arrival') && parsedData.arrivalDate) {
                document.getElementById('service_hotel_arrival').value = parsedData.arrivalDate;
            }
            if (document.getElementById('service_hotel_departure') && parsedData.departureDate) {
                document.getElementById('service_hotel_departure').value = parsedData.departureDate;
            }
            if (document.getElementById('service_hotel_adults') && parsedData.numAdults) {
                document.getElementById('service_hotel_adults').value = parsedData.numAdults;
            }

            modal.classList.add('show');
            const hotelName = parsedData.propertyName || 'Hotel';
            showToast(`Voucher extracted successfully: ${hotelName}`, 'success');
        } catch (err) {
            console.error('Hotel PDF parsing error:', err);
            showToast(`PDF parsing failed: ${err.message}`, 'error');
        }
    }

    uploadBtn?.addEventListener('click', () => fileInput?.click());
    modalImportBtn?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handleHotelPdfFile(file);
        e.target.value = '';
    });

    dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone?.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files?.[0];
        if (file) handleHotelPdfFile(file);
    });

    function collectFormData() {
        const dest = document.getElementById('agoda_destination')?.value || 'Bangkok';
        const preset = DESTINATION_PRESETS[dest] || DESTINATION_PRESETS.Bangkok;
        return {
            destination: dest,
            bookingId: document.getElementById('agoda_booking_id')?.value || generateRandomBookingId(),
            memberId: document.getElementById('agoda_member_id')?.value || generateRandomMemberId(),
            bookingRefNo: (document.getElementById('agoda_booking_ref_no')?.value || '').trim() || generateRandomBookingRefNo(),
            clientName: (document.getElementById('agoda_client_name')?.value || '').trim().toUpperCase(),
            countryOfResidence: document.getElementById('agoda_country')?.value || 'Myanmar',
            numAdults: parseInt(document.getElementById('agoda_num_adults')?.value || '1', 10),
            numChildren: parseInt(document.getElementById('agoda_num_children')?.value || '0', 10),
            numRooms: parseInt(document.getElementById('agoda_num_rooms')?.value || '1', 10),
            numExtraBeds: parseInt(document.getElementById('agoda_num_extra_beds')?.value || '0', 10),
            roomType: document.getElementById('agoda_room_type')?.value || 'Superior Deluxe',
            promotion: document.getElementById('agoda_promotion')?.value || 'Long Stay Deal. Price includes 10% discount!',
            arrivalDate: document.getElementById('agoda_arrival_date')?.value || '',
            departureDate: document.getElementById('agoda_departure_date')?.value || '',
            propertyName: document.getElementById('agoda_property_name')?.value || preset.propertyName,
            propertyAddress: document.getElementById('agoda_property_address')?.value || preset.propertyAddress,
            propertyContact: document.getElementById('agoda_property_contact')?.value || preset.propertyContact,
            cancellationDate: document.getElementById('agoda_cancellation_date')?.value || '',
            cancellationPolicy: document.getElementById('agoda_cancellation_policy')?.value || '',
            benefits: document.getElementById('agoda_benefits')?.value || preset.benefits,
            remarksSpecial: document.getElementById('agoda_remarks_special')?.value || 'NonSmoke,LargeBed'
        };
    }

    function populateForm(data = {}) {
        const dest = data.destination || document.getElementById('agoda_destination')?.value || 'Bangkok';
        const preset = DESTINATION_PRESETS[dest] || DESTINATION_PRESETS.Bangkok;
        if (document.getElementById('agoda_destination')) {
            document.getElementById('agoda_destination').value = dest;
        }
        if (document.getElementById('agoda_booking_id')) {
            document.getElementById('agoda_booking_id').value = data.bookingId || generateRandomBookingId();
        }
        if (document.getElementById('agoda_member_id')) {
            document.getElementById('agoda_member_id').value = data.memberId || generateRandomMemberId();
        }
        if (document.getElementById('agoda_booking_ref_no')) {
            document.getElementById('agoda_booking_ref_no').value = data.bookingRefNo || generateRandomBookingRefNo();
        }
        if (document.getElementById('agoda_client_name')) {
            document.getElementById('agoda_client_name').value = data.clientName || '';
        }
        if (document.getElementById('agoda_country')) {
            document.getElementById('agoda_country').value = data.countryOfResidence || 'Myanmar';
        }
        if (document.getElementById('agoda_num_adults')) {
            document.getElementById('agoda_num_adults').value = data.numAdults !== undefined ? data.numAdults : 1;
        }
        if (document.getElementById('agoda_num_children')) {
            document.getElementById('agoda_num_children').value = data.numChildren !== undefined ? data.numChildren : 0;
        }
        if (document.getElementById('agoda_num_rooms')) {
            document.getElementById('agoda_num_rooms').value = data.numRooms !== undefined ? data.numRooms : 1;
        }
        if (document.getElementById('agoda_num_extra_beds')) {
            document.getElementById('agoda_num_extra_beds').value = data.numExtraBeds !== undefined ? data.numExtraBeds : 0;
        }
        if (document.getElementById('agoda_room_type')) {
            document.getElementById('agoda_room_type').value = data.roomType || 'Superior Deluxe';
        }
        if (document.getElementById('agoda_promotion')) {
            document.getElementById('agoda_promotion').value = data.promotion || 'Long Stay Deal. Price includes 10% discount!';
        }
        if (document.getElementById('agoda_arrival_date')) {
            document.getElementById('agoda_arrival_date').value = data.arrivalDate || '';
        }
        if (document.getElementById('agoda_departure_date')) {
            document.getElementById('agoda_departure_date').value = data.departureDate || '';
        }
        if (document.getElementById('agoda_property_name')) {
            document.getElementById('agoda_property_name').value = data.propertyName || preset.propertyName;
        }
        if (document.getElementById('agoda_property_address')) {
            document.getElementById('agoda_property_address').value = data.propertyAddress || preset.propertyAddress;
        }
        if (document.getElementById('agoda_property_contact')) {
            document.getElementById('agoda_property_contact').value = data.propertyContact !== undefined ? data.propertyContact : preset.propertyContact;
        }
        if (document.getElementById('agoda_cancellation_date')) {
            const cancelInput = document.getElementById('agoda_cancellation_date');
            cancelInput.value = data.cancellationDate || (data.arrivalDate ? calculateDefaultCancellationDate(data.arrivalDate) : '');
            cancelInput.dataset.autoFilled = data.cancellationDate ? 'false' : 'true';
        }
        if (document.getElementById('agoda_cancellation_policy')) {
            document.getElementById('agoda_cancellation_policy').value = data.cancellationPolicy || '';
        }
        if (document.getElementById('agoda_benefits')) {
            document.getElementById('agoda_benefits').value = data.benefits || preset.benefits;
        }
        if (document.getElementById('agoda_remarks_special')) {
            document.getElementById('agoda_remarks_special').value = data.remarksSpecial || 'NonSmoke,LargeBed';
        }

        updatePreview();
    }

    function updatePreview() {
        if (!previewContainer) return;
        const currentData = collectFormData();
        previewContainer.innerHTML = renderAgodaHotelHtml(currentData);
    }

    // Destination preset selector in modal
    document.getElementById('agoda_destination')?.addEventListener('change', (e) => {
        const selectedDest = e.target.value;
        const preset = DESTINATION_PRESETS[selectedDest] || DESTINATION_PRESETS.Bangkok;
        if (document.getElementById('agoda_property_name')) {
            document.getElementById('agoda_property_name').value = preset.propertyName;
        }
        if (document.getElementById('agoda_property_address')) {
            document.getElementById('agoda_property_address').value = preset.propertyAddress;
        }
        if (document.getElementById('agoda_property_contact')) {
            document.getElementById('agoda_property_contact').value = preset.propertyContact;
        }
        updatePreview();
    });

    // Form inputs live sync
    const formInputs = modal.querySelectorAll('.airasia-form-scroll input, .airasia-form-scroll select, .airasia-form-scroll textarea');
    formInputs.forEach(input => {
        input.addEventListener('input', () => {
            if (input.id === 'agoda_arrival_date') {
                const cancelInput = document.getElementById('agoda_cancellation_date');
                if (cancelInput && (!cancelInput.value || cancelInput.dataset.autoFilled === 'true')) {
                    cancelInput.value = calculateDefaultCancellationDate(input.value);
                    cancelInput.dataset.autoFilled = 'true';
                }
            }
            updatePreview();
        });
        input.addEventListener('change', () => {
            if (input.id === 'agoda_arrival_date') {
                const cancelInput = document.getElementById('agoda_cancellation_date');
                if (cancelInput && (!cancelInput.value || cancelInput.dataset.autoFilled === 'true')) {
                    cancelInput.value = calculateDefaultCancellationDate(input.value);
                    cancelInput.dataset.autoFilled = 'true';
                }
            }
            updatePreview();
        });
    });

    document.getElementById('agoda_cancellation_date')?.addEventListener('input', (e) => {
        e.target.dataset.autoFilled = 'false';
    });

    // Roll Booking ID button
    rollBookingBtn?.addEventListener('click', () => {
        const input = document.getElementById('agoda_booking_id');
        if (input) {
            input.value = generateRandomBookingId();
            updatePreview();
            showToast('New Booking ID generated!', 'info');
        }
    });

    // Roll Member ID button
    rollMemberBtn?.addEventListener('click', () => {
        const input = document.getElementById('agoda_member_id');
        if (input) {
            input.value = generateRandomMemberId();
            updatePreview();
            showToast('New Member ID generated!', 'info');
        }
    });

    // Roll Booking Reference No button
    rollBookingRefBtn?.addEventListener('click', () => {
        const input = document.getElementById('agoda_booking_ref_no');
        if (input) {
            input.value = generateRandomBookingRefNo();
            updatePreview();
            showToast('New Booking Reference No generated!', 'info');
        }
    });

    function openHotelEditorWithData() {
        const quickDest = document.getElementById('service_hotel_destination')?.value || 'Bangkok';
        const preset = DESTINATION_PRESETS[quickDest] || DESTINATION_PRESETS.Bangkok;
        const quickClient = (document.getElementById('service_hotel_client_name')?.value || '').trim();
        const quickAdults = parseInt(document.getElementById('service_hotel_adults')?.value || '1', 10) || 1;
        const quickArrival = (document.getElementById('service_hotel_arrival')?.value || '').trim();
        const quickDeparture = (document.getElementById('service_hotel_departure')?.value || '').trim();

        populateForm({
            destination: quickDest,
            bookingId: generateRandomBookingId(),
            memberId: generateRandomMemberId(),
            bookingRefNo: generateRandomBookingRefNo(),
            clientName: quickClient || '',
            arrivalDate: quickArrival ? formatAgodaDate(quickArrival) : '',
            departureDate: quickDeparture ? formatAgodaDate(quickDeparture) : '',
            propertyName: preset.propertyName,
            propertyAddress: preset.propertyAddress,
            propertyContact: preset.propertyContact,
            numRooms: 1,
            numExtraBeds: 0,
            numAdults: quickAdults,
            numChildren: 0
        });

        modal.classList.add('show');
    }

    openBtn?.addEventListener('click', openHotelEditorWithData);

    let isQuickHotelDownloading = false;
    quickBtn?.addEventListener('click', async () => {
        if (isQuickHotelDownloading) return;

        const quickDest = document.getElementById('service_hotel_destination')?.value || 'Bangkok';
        const preset = DESTINATION_PRESETS[quickDest] || DESTINATION_PRESETS.Bangkok;
        const quickClient = (document.getElementById('service_hotel_client_name')?.value || '').trim();
        const quickAdults = parseInt(document.getElementById('service_hotel_adults')?.value || '1', 10) || 1;
        const quickArrival = (document.getElementById('service_hotel_arrival')?.value || '').trim();
        const quickDeparture = (document.getElementById('service_hotel_departure')?.value || '').trim();

        if (!quickClient) {
            showToast('Please enter Client / Guest Name before downloading PDF.', 'warning');
            document.getElementById('service_hotel_client_name')?.focus();
            return;
        }
        if (!quickArrival) {
            showToast('Please enter Arrival Date before downloading PDF.', 'warning');
            document.getElementById('service_hotel_arrival')?.focus();
            return;
        }
        if (!quickDeparture) {
            showToast('Please enter Departure Date before downloading PDF.', 'warning');
            document.getElementById('service_hotel_departure')?.focus();
            return;
        }

        isQuickHotelDownloading = true;
        quickBtn.disabled = true;
        const originalQuickHtml = quickBtn.innerHTML;
        quickBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
        showToast('Generating Agoda Booking PDF...', 'info');

        const data = {
            destination: quickDest,
            bookingId: generateRandomBookingId(),
            memberId: generateRandomMemberId(),
            bookingRefNo: generateRandomBookingRefNo(),
            clientName: quickClient,
            propertyName: preset.propertyName,
            propertyAddress: preset.propertyAddress,
            propertyContact: preset.propertyContact,
            arrivalDate: formatAgodaDate(quickArrival),
            departureDate: formatAgodaDate(quickDeparture),
            numRooms: 1,
            numExtraBeds: 0,
            numAdults: quickAdults,
            numChildren: 0
        };

        try {
            const filename = await downloadAgodaPdf(data);
            if (filename) {
                showToast(`PDF downloaded: ${filename}`, 'success');
            }
        } catch (e) {
            console.error(e);
            showToast(`Error generating PDF: ${e.message}`, 'error');
        } finally {
            isQuickHotelDownloading = false;
            quickBtn.disabled = false;
            quickBtn.innerHTML = originalQuickHtml;
        }
    });

    closeBtn?.addEventListener('click', () => modal.classList.remove('show'));
    cancelBtn?.addEventListener('click', () => modal.classList.remove('show'));

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
    });

    let isChinaHotelDownloading = false;
    downloadPdfBtn?.addEventListener('click', async () => {
        if (isChinaHotelDownloading) return;

        const clientName = (document.getElementById('agoda_client_name')?.value || '').trim();
        const arrivalDate = (document.getElementById('agoda_arrival_date')?.value || '').trim();
        const departureDate = (document.getElementById('agoda_departure_date')?.value || '').trim();

        if (!clientName) {
            showToast('Please enter Client / Guest Name before downloading PDF.', 'warning');
            document.getElementById('agoda_client_name')?.focus();
            return;
        }
        if (!arrivalDate) {
            showToast('Please enter Arrival Date before downloading PDF.', 'warning');
            document.getElementById('agoda_arrival_date')?.focus();
            return;
        }
        if (!departureDate) {
            showToast('Please enter Departure Date before downloading PDF.', 'warning');
            document.getElementById('agoda_departure_date')?.focus();
            return;
        }

        isChinaHotelDownloading = true;
        downloadPdfBtn.disabled = true;
        const originalBtnHtml = downloadPdfBtn.innerHTML;
        downloadPdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
        showToast('Generating official Agoda PDF...', 'info');

        try {
            const data = collectFormData();
            const filename = await downloadAgodaPdf(data);
            if (filename) {
                showToast(`PDF downloaded: ${filename}`, 'success');
            }
        } catch (err) {
            console.error('PDF generation error:', err);
            showToast(`PDF generation failed: ${err.message}`, 'error');
        } finally {
            isChinaHotelDownloading = false;
            downloadPdfBtn.disabled = false;
            downloadPdfBtn.innerHTML = originalBtnHtml;
        }
    });
}

// --- APP START ---
let hotelPageReady = false;
let servicesPageReady = false;
const featureLoads = new Map();
async function loadPageFeatures(viewName) {
    if (!['hotel', 'services'].includes(viewName)) return;
    if ((viewName === 'hotel' && hotelPageReady) || (viewName === 'services' && servicesPageReady)) return;
    if (featureLoads.has(viewName)) return featureLoads.get(viewName);
    const view = document.getElementById(`${viewName}-view`);
    view.inert = true;
    view.setAttribute('aria-busy', 'true');
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    notice.textContent = 'Loading page tools…';
    view.before(notice);
    const task = (async () => {
        if (!hotelModule) hotelModule = await import('./hotel.js');
        if (!hotelPageReady) {
            hotelModule.initHotelService();
            hotelModule.initHotelReservationSystem();
            hotelPageReady = true;
            hotelModule.renderHotelReservations();
        }
        if (viewName === 'services' && !servicesPageReady) {
            const [air, agoda] = await Promise.all([
                import('./airasia-converter.js'),
                import('./agoda-hotel-converter.js')
            ]);
            ({ extractTextFromPdf, parseItineraryText, renderAirAsiaTicketHtml, downloadAirAsiaPdf, downloadAirAsiaImage, shareAirAsiaTicket, formatCheckedBaggageLine, parseTripScheduleImage, parseItinerarySchedule, formatPassengerName, generateRandomSeat } = air);
            ({ renderAgodaHotelHtml, downloadAgodaPdf, downloadAgodaImage, shareAgodaBooking, generateRandomBookingId, generateRandomMemberId, generateRandomBookingRefNo, formatAgodaDate, calculateDefaultCancellationDate, DESTINATION_PRESETS, parseHotelConfirmationPdf } = agoda);
            initializeAirAsiaGenerator();
            initializeChinaHotelGenerator();
            servicesPageReady = true;
        }
    })().catch(error => {
        console.error('Page tools failed to load:', error);
        showToast('Unable to load page tools. Check your connection and reopen this page to retry.', 'error');
    }).finally(() => {
        view.inert = false;
        view.removeAttribute('aria-busy');
        notice.remove();
        featureLoads.delete(viewName);
    });
    featureLoads.set(viewName, task);
    return task;
}
document.addEventListener('ocean:viewchange', event => {
    const viewName = event.detail;
    void loadPageFeatures(viewName);
    if (viewName === 'home') updateDashboardData();
    if (viewName === 'records' && state.recordsDirty) {
        state.recordsDirty = false;
        displayInitialTickets(state.currentPage);
    } else if (viewName === 'booking' && state.bookingsDirty) {
        state.bookingsDirty = false;
        displayBookings();
    } else if (viewName === 'settle' && state.settlementsDirty) {
        state.settlementsDirty = false;
        displaySettlements();
    } else if (viewName === 'hotel' && state.hotelsDirty) {
        state.hotelsDirty = false;
        if (typeof renderHotelReservations === 'function') renderHotelReservations();
    }
});
window.addEventListener('ocean:document-load-error', event => showToast(event.detail, 'error'));
window.onload = async () => {
    // Initialize UI components that don't depend on data
    initializeDatepickers();
    initializeTimePicker();
    setupEventListeners();
    initializeUISettings();
    // Show today's date in the header
    const headerDateEl = document.getElementById('headerTodayDateText');
    if (headerDateEl) {
        const now = new Date();
        headerDateEl.textContent = now.toLocaleDateString('en-GB', {
            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
        });
    }
    initializeCityDropdowns();
    updateToggleLabels();
    resetPassengerForms();
    resetBookingPassengerForms();
    initializePaymentMethodEnhancements();
    initializeSellFormEnhancements();

    // Register PWA Service Worker with updateViaCache: 'none' so deploys take effect immediately
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        let refreshing = false;
        const hadController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!hadController || refreshing) return;
            refreshing = true;
            showToast('App updated to the latest version.', 'info');
        });
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
            reg.update().catch(() => {});
            if (reg.waiting) {
                reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });
        }).catch(err => {
            console.debug('ServiceWorker registration omitted:', err);
        });
    }

    // Initialize Firebase Auth
    initAuth(
        (user) => {
            setCurrentUser(user);
            initializeApp();
        },
        () => {
            setCurrentUser(null);
            document.getElementById('loading').style.display = 'none';
        }
    );
};
