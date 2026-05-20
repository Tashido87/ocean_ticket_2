/**
 * @fileoverview Main entry point for the Ocean Air Ticket Management application.
 * Initializes the application, sets up event listeners, and coordinates modules.
 * UPDATED: Restored 'addExistingPassengerBtn' listener.
 */

// Core Modules
import { initAuth, handleAuthClick } from './auth.js';
import { state, setCurrentUser } from './state.js';
import { onTicketsChange, onBookingsChange, onHistoryChange, onSettlementsChange, onClosedPeriodsChange, onAdjustmentsChange, onDashboardTasksChange, addDashboardTask, updateDashboardTask, deleteDashboardTask } from './db.js';
import { showToast, parseSheetDate, parseDeadline, debounce, setButtonLoading, showServiceToast, hideServiceToast, addRecentActivity, renderRecentActivity, isTicketPaid, isFeeEntryRow, isCanceledTicket } from './utils.js';

// Feature Modules
import { performSearch, clearSearch, setDateRangePreset, handleSellTicket, handleAirlineChange, populateSearchAirlines, displayInitialTickets, updateUnpaidCount } from './tickets.js';
import { loadBookingData, handleNewBookingSubmit, performBookingSearch, clearBookingSearch, displayBookings } from './booking.js';
import {  } from './history.js';
import { loadSettlementData, showNewSettlementForm, hideNewSettlementForm, handleNewSettlementSubmit, updateSettlementDashboard, displaySettlements, initSettlementView, getSettlementSummary } from './settlement.js';
import { buildClientList, loadFeaturedClients } from './clients.js';
import { initGlobalSearch, initSearchView } from './search.js';
import { findTicketForManage, clearManageResults } from './manage.js';
import { exportToPdf, exportPrivateReportToPdf, togglePrivateReportButton } from './reports.js';
import { generateInvoice, generateInvoiceImage, analyzeInvoiceScenario } from './invoice.js'; 
import { initHotelService } from './hotel.js'; 
import { getAllDocuments, uploadDocument, deleteDocument, renameDocument, formatFileSize, formatUploadDate } from './documents.js';

// UI Modules
// MODIFIED: Added 'addExistingPassengerForm' to imports
import { showView, initializeDatepickers, initializeTimePicker, initializeCityDropdowns, updateToggleLabels, updateDynamicTimes, updateNotifications, updateUpcomingPnrs, initializeUISettings, openModal, closeModal, populateFlightLocations, addPassengerForm, removePassengerForm, resetPassengerForms, addBookingPassengerForm, removeBookingPassengerForm, resetBookingPassengerForms, showNewBookingForm, hideNewBookingForm, showInvoiceOptionModal, initializePaymentMethodEnhancements, addExistingPassengerForm, applyFlightTypeToAllPaxForms, initializeSellFormEnhancements, updateSellRoutePreview } from './ui.js';

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

const DASHBOARD_TASKS_STORAGE_KEY = 'oceanDashboardTasks';

function taskTimestampValue(value) {
    if (!value) return 0;
    if (typeof value === 'string') return new Date(value).getTime() || 0;
    if (typeof value === 'number') return value;
    if (typeof value.toDate === 'function') return value.toDate().getTime() || 0;
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
}

function normalizeDashboardTask(task) {
    return {
        id: task.id || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: String(task.title || '').trim(),
        notes: String(task.notes || '').trim(),
        dueDate: task.dueDate || '',
        dueTime: task.dueTime || '',
        priority: task.priority || 'normal',
        done: Boolean(task.done),
        source: task.source || 'manual',
        localOnly: Boolean(task.localOnly),
        createdAt: task.createdAt || new Date().toISOString(),
        updatedAt: task.updatedAt || new Date().toISOString()
    };
}

function loadDashboardTasksFromStorage() {
    try {
        const raw = localStorage.getItem(DASHBOARD_TASKS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        state.dashboardTasks = Array.isArray(parsed) ? parsed.map(normalizeDashboardTask) : [];
    } catch (error) {
        console.warn('Could not load local dashboard tasks:', error);
        state.dashboardTasks = [];
    }
}

function saveDashboardTasksToStorage() {
    try {
        localStorage.setItem(DASHBOARD_TASKS_STORAGE_KEY, JSON.stringify(state.dashboardTasks || []));
    } catch (error) {
        console.warn('Could not save local dashboard tasks:', error);
    }
}

function upsertLocalDashboardTask(task) {
    const normalized = normalizeDashboardTask(task);
    const tasks = state.dashboardTasks || [];
    const index = tasks.findIndex(item => item.id === normalized.id);
    if (index >= 0) tasks[index] = { ...tasks[index], ...normalized };
    else tasks.unshift(normalized);
    state.dashboardTasks = tasks;
    saveDashboardTasksToStorage();
    updateDashboardData();
    return normalized;
}

function removeLocalDashboardTask(id) {
    state.dashboardTasks = (state.dashboardTasks || []).filter(task => task.id !== id);
    saveDashboardTasksToStorage();
    updateDashboardData();
}

// Global PNR Click Handler — opens trip plan detail modal
document.addEventListener('click', (e) => {
    const pnrEl = e.target.closest('.clickable-pnr');
    if (pnrEl) {
        e.preventDefault();
        e.stopPropagation();
        const pnr = pnrEl.dataset.pnr;
        if (pnr && pnr !== 'No PNR' && pnr !== '—') {
            showTripPlanDetail(pnr);
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

        // Set up real-time listeners
        state.unsubscribers.push(
            onTicketsChange((tickets) => {
                state.allTickets = tickets;
                populateSearchAirlines();
                updateUnpaidCount();
                displayInitialTickets();
                updateNotifications();
                buildClientList();
                updateDashboardData();
            })
        );

        state.unsubscribers.push(
            onBookingsChange((bookings) => {
                state.allBookings = bookings;
                displayBookings();
                updateNotifications();
                updateDashboardData();
            })
        );

        state.unsubscribers.push(
            onSettlementsChange((settlements) => {
                state.allSettlements = settlements;
                displaySettlements();
                updateDashboardData();
            })
        );

        state.unsubscribers.push(
            onClosedPeriodsChange((periods) => {
                state.allClosedPeriods = periods;
                displaySettlements();
            })
        );

        state.unsubscribers.push(
            onAdjustmentsChange((adjustments) => {
                state.allAdjustments = adjustments;
                displaySettlements();
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

        initSettlementView();

        state.unsubscribers.push(
            onHistoryChange((history) => {
                state.history = history;
            })
        );

        // Start dynamic updates
        if (state.timeUpdateInterval) clearInterval(state.timeUpdateInterval);
        state.timeUpdateInterval = setInterval(updateDynamicTimes, 60000);
        updateDynamicTimes();
        
        const loading = document.getElementById('loading');
        const dashboardContent = document.getElementById('dashboard-content');
        if (loading) loading.style.display = 'none';
        if (dashboardContent) dashboardContent.style.display = 'flex';

    } catch (error) {
        console.error("Initialization failed:", error);
        showToast('A critical error occurred during data initialization. Please check the console (F12) for details.', 'error');
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
    }
}

/**
 * Handle URL hash routing for all views.
 */
function handleHashRoute() {
    const hash = window.location.hash;
    const viewMatch = hash.match(/^#\/(\w+)/);
    if (viewMatch) {
        const viewName = viewMatch[1];
        // Set flag so showView doesn't pushState again
        window._skipHashUpdate = true;
        showView(viewName);
        if (viewName === 'search') initSearchView();
    }
}

/**
 * Handle browser back/forward buttons (popstate).
 */
function handlePopState(e) {
    const hash = window.location.hash;
    const viewMatch = hash.match(/^#\/(\w+)/);
    if (viewMatch) {
        window._skipHashUpdate = true;
        showView(viewMatch[1]);
        if (viewMatch[1] === 'search') initSearchView();
    } else {
        window._skipHashUpdate = true;
        showView('home');
    }
}

/**
 * Sets up all event listeners for the application.
 */
function setupEventListeners() {
    // Navigation & Settings
    document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', (e) => showView(e.currentTarget.dataset.view)));
    const authBtn = document.getElementById('authorize_button');
    if (authBtn) authBtn.addEventListener('click', handleAuthClick);
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) document.body.classList.toggle('sidebar-open');
            else document.body.classList.toggle('sidebar-collapsed');
        });
    }
    // Close mobile sidebar on outside click
    document.addEventListener('click', (e) => {
        if (window.innerWidth > 768) return;
        if (!e.target.closest('.sidebar') && !e.target.closest('.sidebar-toggle')) {
            document.body.classList.remove('sidebar-open');
        }
    });

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
    ['searchTravelDate', 'searchStartDate', 'searchEndDate', 'searchDeparture', 'searchDestination', 'groupByAccountToggle'].forEach(id => {
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

    // Reports
    document.getElementById('exportPdfBtn').addEventListener('click', () => document.getElementById('exportConfirmModal').classList.add('show'));
    document.getElementById('confirmExportBtn').addEventListener('click', exportToPdf);
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

    // Sell Ticket Form
    document.getElementById('cancelSellBtn').addEventListener('click', () => {
        document.getElementById('sellForm').reset();
        resetPassengerForms();
        showView('home');
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

    // Settlement is wired by initSettlementView() in initializeApp().

    // Hotel Service Initialization
    initHotelService();

    // Invoice Generation Logic — unified Generate button with format selector
    const invoiceGenerateBtn = document.getElementById('invoiceGenerateBtn');
    const invoiceClearBtn = document.getElementById('invoiceClearBtn');
    const invoiceForm = document.getElementById('invoiceForm');

    async function runInvoiceGeneration() {
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

        const scenario = analyzeInvoiceScenario(pnrList);
        if (scenario.type === 'ERROR') {
            showServiceToast('invoiceToast', scenario.message, 'error');
            return;
        }

        setButtonLoading(invoiceGenerateBtn, true);

        const onDone = (ok, msg) => {
            setButtonLoading(invoiceGenerateBtn, false);
            showServiceToast('invoiceToast', msg, ok ? 'success' : 'error');
            if (ok) addRecentActivity('invoice', `${type} — ${pnrList.join(', ')}`, format.toUpperCase());
        };

        try {
            if (scenario.canChoose) {
                showInvoiceOptionModal(async (selectedMode) => {
                    try {
                        if (format === 'photo') {
                            await generateInvoiceImage(pnrList, type, date, selectedMode, brand);
                        } else {
                            await generateInvoice(pnrList, type, date, selectedMode, brand);
                        }
                        onDone(true, `${type} generated successfully!`);
                    } catch (err) {
                        console.error(err);
                        onDone(false, 'Failed to generate document.');
                    }
                });
            } else {
                if (format === 'photo') {
                    await generateInvoiceImage(pnrList, type, date, 'auto', brand);
                } else {
                    await generateInvoice(pnrList, type, date, 'auto', brand);
                }
                onDone(true, `${type} generated successfully!`);
            }
        } catch (err) {
            console.error(err);
            onDone(false, 'Failed to generate document.');
        }
    }

    if (invoiceGenerateBtn) invoiceGenerateBtn.addEventListener('click', runInvoiceGeneration);
    if (invoiceForm) invoiceForm.addEventListener('submit', (e) => { e.preventDefault(); runInvoiceGeneration(); });

    if (invoiceClearBtn) {
        invoiceClearBtn.addEventListener('click', () => {
            document.getElementById('invoice_pnr_list').value = '';
            document.getElementById('invoice_date').value = '';
            document.getElementById('document_type').value = 'Invoice';
            document.getElementById('invoice_brand').value = 'ocean';
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

    function renderDocuments() {
        const grid = document.getElementById('documentsGrid');
        const countEl = document.getElementById('docCount');
        if (!grid) return;

        const isDetail = docView === 'detail';
        grid.classList.toggle('is-detail', isDetail);

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
        const grid = document.getElementById('documentsGrid');
        if (grid) grid.innerHTML = '<div class="documents-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading documents…</div>';
        docCache = await getAllDocuments();
        renderDocuments();
    }

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

const dashboardPeriodState = {
    period: 'month',
    customStart: '',
    customEnd: ''
};

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function getDashboardDateRange(period = dashboardPeriodState.period) {
    const now = new Date();
    if (period === 'today') {
        return { start: startOfDay(now), end: endOfDay(now), label: 'Today' };
    }
    if (period === 'last-month') {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        return { start, end, label: 'Last Month' };
    }
    if (period === 'custom' && dashboardPeriodState.customStart && dashboardPeriodState.customEnd) {
        return {
            start: startOfDay(new Date(dashboardPeriodState.customStart)),
            end: endOfDay(new Date(dashboardPeriodState.customEnd)),
            label: 'Custom'
        };
    }
    return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
        label: 'This Month'
    };
}

function getPreviousDashboardRange(range) {
    const days = Math.max(1, Math.round((range.end - range.start) / (24 * 60 * 60 * 1000)) + 1);
    const end = new Date(range.start);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    return { start, end };
}

function inDashboardRange(date, range) {
    return date && date.getTime && date.getTime() >= range.start.getTime() && date.getTime() <= range.end.getTime();
}


function ticketSalesAmount(t) {
    return (Number(t.net_amount) || 0) + (Number(t.date_change) || 0) + (Number(t.extra_fare) || 0);
}

function ticketProfitAmount(t) {
    return (Number(t.commission) || 0) + (Number(t.extra_fare) || 0);
}

function ticketOwnerPayableAmount(t) {
    if (isCanceledTicket(t)) return 0;
    // Owner payable follows settlement assumptions: net + date change owed to owner, commission retained by us.
    return (Number(t.net_amount) || 0) + (Number(t.date_change) || 0) - (Number(t.commission) || 0);
}

function isFinancialPendingTicket(t) {
    if (isCanceledTicket(t) || isFeeEntryRow(t)) return false;
    const status = String(t.financial_status || '').toLowerCase();
    return status.includes('pending') || status.includes('review') || !(Number(t.net_amount) > 0) || !(Number(t.commission) > 0);
}

function activeTicketRowsInRange(range) {
    return (state.allTickets || []).filter(t => {
        const ticketDate = parseSheetDate(t.issued_date);
        return inDashboardRange(ticketDate, range) && !isCanceledTicket(t);
    });
}

function formatDashboardAmount(value) {
    return Math.round(Number(value) || 0).toLocaleString();
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setHtml(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
}

function getTrendBadgeHtml(current, previous, inverse = false) {
    if (!previous) return `<span class="trend-badge neutral">new period</span>`;
    const pct = (((current - previous) / previous) * 100).toFixed(1);
    const absPct = Math.abs(pct) + '%';
    const improved = inverse ? current < previous : current > previous;
    if (current === previous) return `<span class="trend-badge neutral">0%</span>`;
    return improved
        ? `<span class="trend-badge positive"><i class="fa-solid fa-arrow-up"></i> ${absPct}</span>`
        : `<span class="trend-badge negative"><i class="fa-solid fa-arrow-down"></i> ${absPct}</span>`;
}

function getActiveBookings() {
    return (state.allBookings || []).filter(b => {
        const status = String(b.status || '').toLowerCase().trim();
        if (status) return status === 'active';
        const remark = String(b.remark || '').toLowerCase().trim();
        return !['complete', 'issued', 'get ticket', 'cancel', 'cancelled', 'canceled', 'end', 'expired'].includes(remark);
    });
}

function getBookingDeadline(b) {
    if (b.deadlineAt) {
        const parsed = new Date(b.deadlineAt);
        if (!isNaN(parsed.getTime())) return parsed;
    }
    return parseDeadline(b.enddate, b.endtime);
}

function dashboardEscapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function compactPlace(value) {
    const text = String(value || '').trim();
    if (!text) return '—';
    return text.replace(/\s*\([^)]*\)\s*/g, '').trim() || text;
}

function dashboardRouteLabel(record) {
    return `${compactPlace(record.departure)} → ${compactPlace(record.destination)}`;
}

function formatDashboardDateLabel(value, fallback = '—') {
    const date = value instanceof Date ? value : parseSheetDate(value);
    if (!date || isNaN(date.getTime()) || date.getTime() === 0) return fallback;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(date.getDate()).padStart(2, '0')}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

function formatDashboardShortDate(value) {
    const date = value instanceof Date ? value : parseSheetDate(value);
    if (!date || isNaN(date.getTime()) || date.getTime() === 0) return { day: '—', month: '' };
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return { day: String(date.getDate()).padStart(2, '0'), month: months[date.getMonth()] };
}

function daysBetween(from, to) {
    const start = startOfDay(from).getTime();
    const end = startOfDay(to).getTime();
    return Math.round((end - start) / (24 * 60 * 60 * 1000));
}



function activeClientRows() {
    return (state.allClients || []).filter(client => !/\(fees\)\s*$/i.test(String(client?.name || '')));
}

function getUpcomingTripGroups(days = 14) {
    const today = startOfDay(new Date());
    const end = endOfDay(new Date(today));
    end.setDate(end.getDate() + days);
    const groups = new Map();

    (state.allTickets || []).forEach(ticket => {
        if (isFeeEntryRow(ticket) || isCanceledTicket(ticket)) return;
        const travelDate = parseSheetDate(ticket.departing_on);
        if (!travelDate || isNaN(travelDate.getTime()) || travelDate < today || travelDate > end) return;
        const pnr = String(ticket.booking_reference || '').trim() || ticket.id || 'No PNR';
        const key = `${pnr}|${ticket.departing_on || ''}|${ticket.departure || ''}|${ticket.destination || ''}`;
        if (!groups.has(key)) {
            groups.set(key, {
                pnr,
                date: travelDate,
                route: dashboardRouteLabel(ticket),
                airline: ticket.airline || 'Airline',
                lead: ticket.name || 'Passenger',
                passengers: 0,
                paidPassengers: 0,
                unpaidAmount: 0
            });
        }
        const group = groups.get(key);
        group.passengers += 1;
        if (isTicketPaid(ticket)) group.paidPassengers += 1;
        else group.unpaidAmount += ticketSalesAmount(ticket);
    });

    return [...groups.values()].sort((a, b) => a.date - b.date);
}

function groupUnpaidTickets(rows) {
    const groups = new Map();

    // Match Client Detail outstanding logic: unpaid money can live on passenger rows
    // or on "(Fees)" change rows. Fee rows are not clients, but they are still receivables.
    const activeTickets = rows.filter(ticket => !isCanceledTicket(ticket));

    // Group by PNR first
    const pnrGroups = new Map();
    activeTickets.forEach(ticket => {
        const pnr = String(ticket.booking_reference || '').trim() || ticket.id || 'No PNR';
        if (!pnrGroups.has(pnr)) pnrGroups.set(pnr, []);
        pnrGroups.get(pnr).push(ticket);
    });

    // For each PNR, compute total unpaid amount across ALL rows (passenger + fees)
    pnrGroups.forEach((tickets, pnr) => {
        const unpaidAmount = tickets
            .filter(t => !isTicketPaid(t))
            .reduce((sum, t) => sum + ticketSalesAmount(t), 0);

        if (unpaidAmount > 0) {
            // Use the passenger row (non-fee) for display name/route/dates
            const passengerTicket = tickets.find(t => !isFeeEntryRow(t)) || tickets[0];
            const displayName = String(passengerTicket.name || tickets[0]?.name || '')
                .replace(/\(fees\)\s*$/i, '')
                .trim();
            groups.set(pnr, {
                pnr,
                client: displayName || 'Passenger',
                route: dashboardRouteLabel(passengerTicket),
                dueDate: parseSheetDate(passengerTicket.departing_on),
                issuedDate: parseSheetDate(passengerTicket.issued_date),
                amount: unpaidAmount,
                tickets: tickets.filter(t => !isFeeEntryRow(t)).length,
                hasFeeRows: tickets.some(t => isFeeEntryRow(t) && !isTicketPaid(t))
            });
        }
    });

    return [...groups.values()].sort((a, b) => {
        const aDue = a.dueDate?.getTime?.() || Number.MAX_SAFE_INTEGER;
        const bDue = b.dueDate?.getTime?.() || Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return b.amount - a.amount;
    });
}

/**
 * Initializes dashboard-specific UI elements like date selectors.
 */
function initializeDashboardSelectors() {
    const todayIso = new Date().toISOString().slice(0, 10);
    const startInput = document.getElementById('dashboardCustomStart');
    const endInput = document.getElementById('dashboardCustomEnd');
    if (startInput && !startInput.value) startInput.value = todayIso;
    if (endInput && !endInput.value) endInput.value = todayIso;
    dashboardPeriodState.customStart = startInput?.value || todayIso;
    dashboardPeriodState.customEnd = endInput?.value || todayIso;
    updateDashboardData();
}

/**
 * Updates the main dashboard cards with the latest data.
 */
export function updateDashboardData() {
    const range = getDashboardDateRange();
    const prevRange = getPreviousDashboardRange(range);
    const ticketsInPeriod = activeTicketRowsInRange(range);
    const prevTicketsInPeriod = activeTicketRowsInRange(prevRange);

    // 1. Total Sales (Customer Price)
    const curSales = ticketsInPeriod.reduce((sum, t) => sum + ticketSalesAmount(t), 0);
    const prevSales = prevTicketsInPeriod.reduce((sum, t) => sum + ticketSalesAmount(t), 0);

    // 2. Total Tickets (Count of Passenger Tickets)
    const curTickets = ticketsInPeriod.filter(t => !isFeeEntryRow(t) && !isCanceledTicket(t)).length;
    const prevTickets = prevTicketsInPeriod.filter(t => !isFeeEntryRow(t) && !isCanceledTicket(t)).length;

    // 3. Total Profit
    const curProfit = ticketsInPeriod.reduce((sum, t) => sum + ticketProfitAmount(t), 0);
    const prevProfit = prevTicketsInPeriod.reduce((sum, t) => sum + ticketProfitAmount(t), 0);

    // 4. Remaining Due to Owner (from settlement module — global, not period-scoped)
    const settleSummary = getSettlementSummary();
    const curRemainingDue = settleSummary.remainingDue;

    // Also gather data for side panels
    const unpaidGroups = groupUnpaidTickets(state.allTickets || []);
    const curUnpaid = unpaidGroups.reduce((sum, group) => sum + group.amount, 0);
    const upcomingTrips = getUpcomingTripGroups(14);
    const activeBookings = getActiveBookings();
    const dueToday = activeBookings.filter(b => {
        const deadline = getBookingDeadline(b);
        if (!deadline) return false;
        const diff = deadline.getTime() - Date.now();
        return diff <= 24 * 60 * 60 * 1000;
    });

    // Populate Cards
    setText('monthly-revenue-value', formatDashboardAmount(curSales));
    setHtml('revenue-trend-wrapper', getTrendBadgeHtml(curSales, prevSales));

    setText('total-tickets-value', curTickets);
    setHtml('tickets-trend-wrapper', curTickets > prevTickets 
        ? `<span class="trend-badge positive"><i class="fa-solid fa-arrow-trend-up"></i> +${curTickets - prevTickets}</span>`
        : `<span class="trend-badge neutral">steady</span>`);

    setText('total-profit-value', formatDashboardAmount(curProfit));
    setHtml('profit-trend-wrapper', getTrendBadgeHtml(curProfit, prevProfit));

    setText('owner-payable-value', formatDashboardAmount(curRemainingDue));
    setHtml('owner-payable-trend-wrapper', curRemainingDue > 0
        ? `<span class="trend-badge negative"><i class="fa-solid fa-circle-exclamation"></i> outstanding</span>`
        : `<span class="trend-badge positive"><i class="fa-solid fa-check"></i> settled</span>`);

    setText('bookingRevenuePeriodHint', range.label || 'This Month');
    setText('dashboardUnpaidHint', `${formatDashboardAmount(curUnpaid)} MMK`);

    renderDashboardTravelSchedule(upcomingTrips);
    renderDashboardUnpaidTickets(unpaidGroups);
    renderDashboardTasksReminders({
        activeBookings,
        dueToday,
        unpaidGroups,
        financialPendingCount: ticketsInPeriod.filter(isFinancialPendingTicket).length,
        upcomingTrips
    });
    updateComparisonChart();
    updateSettlementDashboard();
}

function wireDashboardPnrButtons(container) {
    // Buttons removed in favor of global .clickable-pnr listener
}

function showTripPlanDetail(pnr) {
    const allRows = (state.allTickets || []).filter(t =>
        String(t.booking_reference || '').trim().toUpperCase() === pnr.toUpperCase() &&
        !isCanceledTicket(t)
    );
    if (!allRows.length) return;

    const passengerRows = allRows.filter(t => !isFeeEntryRow(t));
    const feeRows = allRows.filter(t => isFeeEntryRow(t));
    const lead = passengerRows[0] || allRows[0];

    const passengerList = passengerRows.map(t => {
        const paid = isTicketPaid(t);
        const amount = ticketSalesAmount(t);
        const baseName = String(t.name || '').replace(/\s*\(fees\)\s*$/i, '').trim();
        const matchedClient = state.allClients.find(c => String(c.name || '').toLowerCase() === baseName.toLowerCase() && !String(c.name || '').includes('(Fees)'));
        const ck = matchedClient?.client_key || '';
        const nameHtml = ck
            ? `<a href="#" class="clickable-client-link" data-client-key="${dashboardEscapeHtml(ck)}" style="color:var(--teal-dark);text-decoration:underline;font-weight:700">${dashboardEscapeHtml(t.name || 'Passenger')}</a>`
            : `<span style="font-weight:700;color:var(--ink)">${dashboardEscapeHtml(t.name || 'Passenger')}</span>`;
        return `
            <div class="details-item" style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid rgba(0,0,0,0.06)">
                <div>
                    <div>${nameHtml}</div>
                    <div style="font-size:0.72rem;color:var(--muted)">Ticket: ${dashboardEscapeHtml(t.ticket_number || 'N/A')}</div>
                </div>
                <div style="text-align:right">
                    <div style="font-weight:700">${formatDashboardAmount(amount)} MMK</div>
                    <span class="dashboard-status ${paid ? 'success' : 'danger'}" style="font-size:0.65rem">${paid ? 'Paid' : 'Unpaid'}</span>
                </div>
            </div>
        `;
    }).join('');

    const feeList = feeRows.length ? feeRows.map(t => {
        const paid = isTicketPaid(t);
        const amount = ticketSalesAmount(t);
        const baseName = String(t.name || '').replace(/\s*\(fees\)\s*$/i, '').trim();
        const matchedClient = state.allClients.find(c => String(c.name || '').toLowerCase() === baseName.toLowerCase() && !String(c.name || '').includes('(Fees)'));
        const ck = matchedClient?.client_key || '';
        const nameHtml = ck
            ? `<a href="#" class="clickable-client-link" data-client-key="${dashboardEscapeHtml(ck)}" style="color:var(--teal-dark);text-decoration:underline;font-weight:700">${dashboardEscapeHtml(t.name || 'Fee')}</a>`
            : `<span style="font-weight:700;color:var(--ink)">${dashboardEscapeHtml(t.name || 'Fee')}</span>`;
        return `
            <div class="details-item" style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid rgba(0,0,0,0.06)">
                <div>
                    <div>${nameHtml}</div>
                    <div style="font-size:0.72rem;color:var(--muted)">${dashboardEscapeHtml(t.remarks || 'Date/Extra Change')}</div>
                </div>
                <div style="text-align:right">
                    <div style="font-weight:700">${formatDashboardAmount(amount)} MMK</div>
                    <span class="dashboard-status ${paid ? 'success' : 'danger'}" style="font-size:0.65rem">${paid ? 'Paid' : 'Unpaid'}</span>
                </div>
            </div>
        `;
    }).join('') : '';

    const totalUnpaid = allRows.filter(t => !isTicketPaid(t)).reduce((s, t) => s + ticketSalesAmount(t), 0);
    const totalAmount = allRows.reduce((s, t) => s + ticketSalesAmount(t), 0);

    const leadBaseName = String(lead.name || '').replace(/\s*\(fees\)\s*$/i, '').trim();
    const leadClient = state.allClients.find(c => String(c.name || '').toLowerCase() === leadBaseName.toLowerCase() && !String(c.name || '').includes('(Fees)'));
    const leadClientKey = leadClient?.client_key || '';
    const leadNameHtml = leadClientKey
        ? `<a href="#" class="clickable-client-link client-name" data-client-key="${dashboardEscapeHtml(leadClientKey)}" style="cursor:pointer;color:var(--teal-dark);text-decoration:underline">${dashboardEscapeHtml(leadBaseName || 'Trip Plan')}</a>`
        : `<div class="client-name">${dashboardEscapeHtml(leadBaseName || 'Trip Plan')}</div>`;
    const content = `
        <div class="details-header">
            <div>
                ${leadNameHtml}
                <div class="pnr-code">PNR: ${dashboardEscapeHtml(pnr)}</div>
            </div>
            <div class="details-status-badge confirmed">${dashboardEscapeHtml(lead.airline || 'Airline')}</div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Trip Overview</div>
            <div class="details-grid">
                <div class="details-item"><i class="fa-solid fa-plane-departure"></i><div class="details-item-content"><div class="label">From</div><div class="value">${dashboardEscapeHtml(lead.departure || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-plane-arrival"></i><div class="details-item-content"><div class="label">To</div><div class="value">${dashboardEscapeHtml(lead.destination || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-calendar-days"></i><div class="details-item-content"><div class="label">Travel Date</div><div class="value">${dashboardEscapeHtml(lead.departing_on || 'N/A')}</div></div></div>
                <div class="details-item"><i class="fa-solid fa-ticket"></i><div class="details-item-content"><div class="label">Passengers</div><div class="value">${passengerRows.length}</div></div></div>
            </div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Passengers</div>
            ${passengerList || '<div style="color:var(--muted);padding:0.5rem 0">No passenger tickets found.</div>'}
        </div>
        ${feeList ? `<div class="details-section"><div class="details-section-title">Fees & Changes</div>${feeList}</div>` : ''}
        <div class="details-section">
            <div class="details-section-title">Financial Summary</div>
            <div class="details-grid">
                <div class="details-item"><i class="fa-solid fa-receipt"></i><div class="details-item-content"><div class="label">Total Amount</div><div class="value">${formatDashboardAmount(totalAmount)} MMK</div></div></div>
                <div class="details-item"><i class="fa-solid fa-hand-holding-dollar"></i><div class="details-item-content"><div class="label">Total Unpaid</div><div class="value ${totalUnpaid > 0 ? 'text-risk' : 'text-success'}">${formatDashboardAmount(totalUnpaid)} MMK</div></div></div>
            </div>
        </div>
        <div class="form-actions" style="margin-top:1rem">
            <button class="btn btn-secondary" id="tripPlanCloseBtn">Close</button>
        </div>
    `;
    openModal(content, 'solid-modal');
    document.getElementById('tripPlanCloseBtn').addEventListener('click', closeModal);

    document.querySelectorAll('.clickable-client-link').forEach(link => {
        link.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const key = ev.currentTarget.dataset.clientKey;
            if (!key) return;
            closeModal();
            const { navigateToClient } = await import('./search.js');
            navigateToClient(key);
        });
    });
}

function renderDashboardTravelSchedule(groups) {
    const container = document.getElementById('dashboardTravelSchedule');
    if (!container) return;

    if (!groups.length) {
        container.innerHTML = `
            <div class="dashboard-empty-panel">
                <span class="mini-travel-illustration" aria-hidden="true"></span>
                <strong>No upcoming travel</strong>
                <span>No ticket travel dates are scheduled in the next 14 days.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = groups.slice(0, 6).map(group => {
        const date = formatDashboardShortDate(group.date);
        const progress = group.passengers ? Math.round((group.paidPassengers / group.passengers) * 100) : 0;
        const hasUnpaid = group.unpaidAmount > 0;
        return `
            <div class="travel-schedule-row" data-dashboard-pnr="${dashboardEscapeHtml(group.pnr)}" style="cursor:pointer">
                <div class="travel-date-chip">
                    <strong>${dashboardEscapeHtml(date.day)}</strong>
                    <span>${dashboardEscapeHtml(date.month)}</span>
                </div>
                <div class="travel-schedule-main">
                    <strong>${dashboardEscapeHtml(group.lead)}${group.passengers > 1 ? ` +${group.passengers - 1}` : ''}</strong>
                    <span>${dashboardEscapeHtml(group.route)}</span>
                    <small><a href="#" class="clickable-pnr" data-pnr="${dashboardEscapeHtml(group.pnr)}">${dashboardEscapeHtml(group.pnr)}</a></small>
                </div>
                <div class="travel-progress">
                    <small>${dashboardEscapeHtml(group.airline)}</small>
                </div>
                <button type="button" class="dashboard-row-action" data-dashboard-pnr="${dashboardEscapeHtml(group.pnr)}">View</button>
            </div>
        `;
    }).join('');
    wireDashboardPnrButtons(container);
}

function renderDashboardUnpaidTickets(groups) {
    const container = document.getElementById('dashboardUnpaidTickets');
    if (!container) return;
    const today = startOfDay(new Date());
    const weekEnd = endOfDay(new Date(today));
    weekEnd.setDate(weekEnd.getDate() + 7);
    const totalAmount = groups.reduce((sum, group) => sum + group.amount, 0);
    const overdue = groups.filter(group => group.dueDate?.getTime?.() && group.dueDate < today);
    const dueToday = groups.filter(group => group.dueDate?.getTime?.() && daysBetween(today, group.dueDate) === 0);
    const dueThisWeek = groups.filter(group => group.dueDate?.getTime?.() && group.dueDate >= today && group.dueDate <= weekEnd);

    if (!groups.length) {
        container.innerHTML = `
            <div class="dashboard-empty-panel">
                <span class="mini-wallet-illustration" aria-hidden="true"></span>
                <strong>No unpaid tickets</strong>
                <span>All tickets are marked paid.</span>
            </div>
        `;
        return;
    }

    const rows = groups.slice(0, 6).map(group => {
        return `
            <tr>
                <td><strong><a href="#" class="clickable-pnr" data-pnr="${dashboardEscapeHtml(group.pnr)}">${dashboardEscapeHtml(group.pnr)}</a></strong></td>
                <td>${dashboardEscapeHtml(group.client)}</td>
                <td>${dashboardEscapeHtml(group.route)}</td>
                <td class="num">${formatDashboardAmount(group.amount)} MMK</td>
                <td><button type="button" class="dashboard-row-action" data-dashboard-pnr="${dashboardEscapeHtml(group.pnr)}"><i class="fa-solid fa-eye"></i></button></td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="unpaid-summary-grid">
            <div><span>Total Unpaid</span><strong>${formatDashboardAmount(totalAmount)}</strong><small>MMK</small></div>
            <div><span>Overdue</span><strong>${overdue.length}</strong><small>PNR</small></div>
            <div><span>Due Today</span><strong>${dueToday.length}</strong><small>PNR</small></div>
            <div><span>Due This Week</span><strong>${dueThisWeek.length}</strong><small>PNR</small></div>
        </div>
        <div class="dashboard-table-wrap">
            <table class="dashboard-mini-table">
                <thead>
                    <tr>
                        <th>PNR</th>
                        <th>Client</th>
                        <th>Route</th>
                        <th>Amount Due</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
    wireDashboardPnrButtons(container);
}

function getBookingDeadlineReminderRows(activeBookings) {
    const grouped = new Map();
    activeBookings.forEach(booking => {
        const deadline = getBookingDeadline(booking);
        if (!deadline) return;
        const pnr = String(booking.pnr || booking.booking_reference || '').trim() || booking.groupId || booking.id || 'No PNR';
        const key = `${pnr}|${booking.departure || ''}|${booking.destination || ''}|${booking.departing_on || ''}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                key,
                pnr,
                lead: String(booking.name || '').replace(/^(MR|MS)\s+/i, '').trim() || 'Booking',
                route: dashboardRouteLabel(booking),
                deadline,
                pax: 0
            });
        }
        const group = grouped.get(key);
        group.pax += 1;
    });

    return [...grouped.values()].map(group => {
        const minutes = Math.round((group.deadline.getTime() - Date.now()) / 60000);
        let tone = 'neutral';
        let label = 'Upcoming';
        if (minutes < 0) {
            tone = 'danger';
            label = 'Overdue';
        } else if (minutes <= 6 * 60) {
            tone = 'danger';
            label = 'Due soon';
        } else if (minutes <= 24 * 60) {
            tone = 'warning';
            label = 'Due today';
        } else if (minutes <= 72 * 60) {
            tone = 'warning';
            label = 'This week';
        }
        return { ...group, minutes, tone, label };
    }).sort((a, b) => a.deadline - b.deadline);
}

function formatTaskDueLabel(dateValue, timeValue = '') {
    if (!dateValue) return 'No due date';
    const date = new Date(`${dateValue}T${timeValue || '00:00'}`);
    if (isNaN(date.getTime())) return dateValue;
    const dayLabel = formatDashboardDateLabel(date);
    return timeValue ? `${dayLabel} ${timeValue}` : dayLabel;
}

function getManualTaskSortValue(task) {
    if (!task.dueDate) return Number.MAX_SAFE_INTEGER;
    const parsed = new Date(`${task.dueDate}T${task.dueTime || '23:59'}`);
    return isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime();
}

function manualTaskTone(task) {
    if (task.done) return 'done';
    const due = getManualTaskSortValue(task);
    if (due === Number.MAX_SAFE_INTEGER) return task.priority === 'high' ? 'warning' : 'neutral';
    const diff = due - Date.now();
    if (diff < 0) return 'danger';
    if (diff <= 24 * 60 * 60 * 1000) return 'warning';
    return task.priority === 'high' ? 'warning' : 'neutral';
}

async function saveManualDashboardTask(data) {
    const now = new Date().toISOString();
    const payload = normalizeDashboardTask({
        ...data,
        source: 'manual',
        done: false,
        createdAt: now,
        updatedAt: now
    });
    try {
        const { id, localOnly, ...firestorePayload } = payload;
        const savedId = await addDashboardTask(firestorePayload);
        upsertLocalDashboardTask({ ...payload, id: savedId, localOnly: false });
    } catch (error) {
        console.warn('Task saved locally because cloud save failed:', error);
        upsertLocalDashboardTask({ ...payload, localOnly: true });
        showToast('Task saved on this browser.', 'info');
    }
}

async function updateManualDashboardTask(id, data) {
    const existing = (state.dashboardTasks || []).find(task => task.id === id);
    if (!existing) return;
    const updated = normalizeDashboardTask({
        ...existing,
        ...data,
        updatedAt: new Date().toISOString()
    });
    upsertLocalDashboardTask(updated);
    if (updated.localOnly || String(id).startsWith('local-')) return;
    try {
        await updateDashboardTask(id, {
            ...data,
            updatedAt: updated.updatedAt
        });
    } catch (error) {
        console.warn('Task update kept locally because cloud update failed:', error);
        upsertLocalDashboardTask({ ...updated, localOnly: true });
    }
}

async function deleteManualDashboardTask(id) {
    const existing = (state.dashboardTasks || []).find(task => task.id === id);
    removeLocalDashboardTask(id);
    if (!existing || existing.localOnly || String(id).startsWith('local-')) return;
    try {
        await deleteDashboardTask(id);
    } catch (error) {
        console.warn('Task deleted locally, cloud delete failed:', error);
    }
}

function openBookingFromReminder(pnr) {
    showView('booking');
    const searchInput = document.getElementById('bookingSearchText');
    if (searchInput && pnr && pnr !== 'No PNR') searchInput.value = pnr;
    performBookingSearch();
}

function openTaskModal() {
    const content = `
        <div class="form-container" style="background:var(--bg-color);">
            <h2><i class="fa-solid fa-plus"></i> Add Task or Reminder</h2>
            <form id="dashboardTaskModalForm" class="centered-form">
                <div class="form-group">
                    <label>Task Title</label>
                    <input type="text" name="taskTitle" placeholder="e.g. Follow up on passport" required autocomplete="off">
                </div>
                <div style="display:flex; gap:1rem;">
                    <div class="form-group" style="flex:1;">
                        <label>Due Date</label>
                        <input type="date" name="taskDueDate">
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label>Due Time</label>
                        <input type="time" name="taskDueTime">
                    </div>
                </div>
                <div class="form-group">
                    <label>Priority</label>
                    <select name="taskPriority">
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="low">Low</option>
                    </select>
                </div>
                <div class="form-actions" style="margin-top:1rem;">
                    <button type="button" class="btn btn-secondary" id="cancelTaskModalBtn">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Task</button>
                </div>
            </form>
        </div>
    `;
    openModal(content, 'small-modal');
    
    document.getElementById('cancelTaskModalBtn').addEventListener('click', closeModal);
    
    document.getElementById('dashboardTaskModalForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = new FormData(e.target);
        const taskTitle = data.get('taskTitle')?.trim();
        if (!taskTitle) return;
        await saveManualDashboardTask({
            title: taskTitle,
            dueDate: data.get('taskDueDate'),
            dueTime: data.get('taskDueTime'),
            priority: data.get('taskPriority') || 'normal'
        });
        closeModal();
        updateDashboardData();
    });
}

function wireDashboardTaskInteractions(container) {
    const addBtn = container.querySelector('#openTaskModalBtn');
    if (addBtn) {
        addBtn.addEventListener('click', openTaskModal);
    }

    container.querySelectorAll('[data-task-toggle]').forEach(input => {
        input.addEventListener('change', () => {
            updateManualDashboardTask(input.dataset.taskToggle, { done: input.checked });
        });
    });

    container.querySelectorAll('[data-task-delete]').forEach(button => {
        button.addEventListener('click', () => {
            deleteManualDashboardTask(button.dataset.taskDelete);
        });
    });

    container.querySelectorAll('[data-booking-reminder]').forEach(button => {
        button.addEventListener('click', () => {
            openBookingFromReminder(button.dataset.bookingReminder);
        });
    });
}

function renderDashboardTasksReminders({ activeBookings, dueToday, unpaidGroups, financialPendingCount, upcomingTrips }) {
    const container = document.getElementById('dashboardTasksReminders');
    const hint = document.getElementById('dashboardTasksHint');
    if (!container) return;

    const bookingReminders = getBookingDeadlineReminderRows(activeBookings);
    const manualTasks = [...(state.dashboardTasks || [])]
        .map(normalizeDashboardTask)
        .filter(task => task.source === 'manual' && task.title)
        .sort((a, b) => Number(a.done) - Number(b.done) || getManualTaskSortValue(a) - getManualTaskSortValue(b) || taskTimestampValue(b.createdAt) - taskTimestampValue(a.createdAt));
    const openManualCount = manualTasks.filter(task => !task.done).length;
    const urgentBookingCount = bookingReminders.filter(item => ['danger', 'warning'].includes(item.tone)).length;
    if (hint) hint.textContent = `${openManualCount + urgentBookingCount} open`;

    const bookingHtml = bookingReminders.length
        ? bookingReminders.slice(0, 5).map(item => `
            <button type="button" class="dashboard-auto-task ${item.tone}" data-booking-reminder="${dashboardEscapeHtml(item.pnr)}">
                <span class="task-auto-icon"><i class="fa-solid fa-bell"></i></span>
                <span class="task-auto-body">
                    <strong>${dashboardEscapeHtml(item.pnr)} · ${dashboardEscapeHtml(item.lead)}${item.pax > 1 ? ` +${item.pax - 1}` : ''}</strong>
                    <small>${dashboardEscapeHtml(item.route)} · ${dashboardEscapeHtml(formatTaskDueLabel(item.deadline.toISOString().slice(0, 10), item.deadline.toTimeString().slice(0, 5)))}</small>
                </span>
                <span class="dashboard-status ${item.tone === 'danger' ? 'danger' : item.tone === 'warning' ? 'warning' : 'neutral'}">${dashboardEscapeHtml(item.label)}</span>
            </button>
        `).join('')
        : `<div class="task-empty-line">No active booking deadlines.</div>`;

    const manualHtml = manualTasks.length
        ? manualTasks.slice(0, 8).map(task => {
            const tone = manualTaskTone(task);
            const dueLabel = formatTaskDueLabel(task.dueDate, task.dueTime);
            return `
                <div class="dashboard-task-item manual ${tone} ${task.done ? 'is-done' : ''}">
                    <input type="checkbox" data-task-toggle="${dashboardEscapeHtml(task.id)}" ${task.done ? 'checked' : ''} aria-label="Mark ${dashboardEscapeHtml(task.title)} done">
                    <span class="task-manual-body">
                        <strong>${dashboardEscapeHtml(task.title)}</strong>
                        <small>${dashboardEscapeHtml(dueLabel)} · ${dashboardEscapeHtml(task.priority)}${task.localOnly ? ' · local' : ''}</small>
                    </span>
                    <button type="button" class="task-delete-btn" data-task-delete="${dashboardEscapeHtml(task.id)}" aria-label="Delete ${dashboardEscapeHtml(task.title)}"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            `;
        }).join('')
        : `<div class="task-empty-line">No manual tasks yet.</div>`;

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
            <h3 style="margin:0; font-size:1.1rem;"><i class="fa-solid fa-list-check"></i> Tasks & Reminders</h3>
            <button type="button" class="btn btn-primary btn-sm" id="openTaskModalBtn" style="border-radius:50%; width:32px; height:32px; padding:0; display:flex; align-items:center; justify-content:center;" title="Add Task">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
        <div class="task-mini-section">
            <div class="task-mini-title"><span>Booking deadlines</span><small>${bookingReminders.length}</small></div>
            <div class="task-mini-list">${bookingHtml}</div>
        </div>
        <div class="task-mini-section">
            <div class="task-mini-title"><span>My tasks</span><small>${openManualCount} open</small></div>
            <div class="task-mini-list">${manualHtml}</div>
        </div>
    `;
    wireDashboardTaskInteractions(container);
}

function renderNeedsAttentionPanel(ticketsInPeriod, activeBookings, dueBookings, unpaidAmount, financialPendingCount) {
    const container = document.getElementById('needsAttentionList');
    const hint = document.getElementById('attention-count-hint');
    if (!container) return;

    const items = [];
    if (unpaidAmount > 0) {
        items.push({
            tone: 'danger',
            icon: 'fa-wallet',
            title: 'Unpaid collection risk',
            meta: `${formatDashboardAmount(unpaidAmount)} MMK still unpaid in this period`
        });
    }
    if (dueBookings.length > 0) {
        items.push({
            tone: 'warning',
            icon: 'fa-bell',
            title: 'Booking deadlines need attention',
            meta: `${dueBookings.length} active booking${dueBookings.length === 1 ? '' : 's'} due within 24 hours or overdue`
        });
    }
    if (financialPendingCount > 0) {
        items.push({
            tone: 'warning',
            icon: 'fa-clipboard-check',
            title: 'Financial review pending',
            meta: `${financialPendingCount} ticket${financialPendingCount === 1 ? '' : 's'} missing confirmed net or commission`
        });
    }
    const missingPaidDates = ticketsInPeriod.filter(t => t.paid && !t.paid_date && !isCanceledTicket(t)).length;
    if (missingPaidDates > 0) {
        items.push({
            tone: 'warning',
            icon: 'fa-calendar-xmark',
            title: 'Payment dates missing',
            meta: `${missingPaidDates} paid ticket${missingPaidDates === 1 ? '' : 's'} without paid date`
        });
    }
    const oldBookings = activeBookings.filter(b => {
        const deadline = getBookingDeadline(b);
        return deadline && deadline.getTime() < Date.now();
    }).length;
    if (oldBookings > 0) {
        items.push({
            tone: 'danger',
            icon: 'fa-hourglass-end',
            title: 'Expired booking holds',
            meta: `${oldBookings} booking${oldBookings === 1 ? '' : 's'} may need cancellation or issue follow-up`
        });
    }

    if (hint) hint.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    if (items.length === 0) {
        container.innerHTML = `
            <div class="attention-empty app-empty-mini">
                <span class="mini-illustration mini-illustration-check" aria-hidden="true"></span>
                <strong>Everything looks calm.</strong>
                <span>No unpaid, deadline, or financial-review alerts for this period.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = items.slice(0, 6).map(item => `
        <div class="attention-item ${item.tone}">
            <span class="attention-icon"><i class="fa-solid ${item.icon}"></i></span>
            <div>
                <strong>${item.title}</strong>
                <span>${item.meta}</span>
            </div>
        </div>
    `).join('');
}

function renderOwnerSettlementSnapshot(ticketsInPeriod, range) {
    const container = document.getElementById('ownerSettlementSnapshot');
    if (!container) return;

    const ownerPayable = ticketsInPeriod.reduce((sum, t) => sum + ticketOwnerPayableAmount(t), 0);
    const paidToOwner = (state.allSettlements || []).filter(s => inDashboardRange(parseSheetDate(s.settlement_date), range))
        .reduce((sum, s) => sum + (Number(s.amount_paid) || 0), 0);
    const remaining = ownerPayable - paidToOwner;
    const lastSettlement = [...(state.allSettlements || [])]
        .map(s => ({ ...s, date: parseSheetDate(s.settlement_date) }))
        .filter(s => s.date && s.date.getTime())
        .sort((a, b) => b.date - a.date)[0];

    container.innerHTML = `
        <div class="settlement-snapshot-card ${remaining > 0 ? 'is-due' : 'is-settled'}">
            <span>Remaining Due</span>
            <strong>${formatDashboardAmount(remaining)} MMK</strong>
            <small>${remaining > 0 ? 'Owner payable still open' : 'No period balance due'}</small>
        </div>
        <div class="settlement-snapshot-grid">
            <div><span>Owner Payable</span><strong>${formatDashboardAmount(ownerPayable)} MMK</strong></div>
            <div><span>Paid to Owner</span><strong>${formatDashboardAmount(paidToOwner)} MMK</strong></div>
            <div><span>Last Settlement</span><strong>${lastSettlement ? (lastSettlement.settlement_date || '—') : '—'}</strong></div>
        </div>
    `;
}

function dashboardChartPalette() {
    const computed = getComputedStyle(document.body);
    return {
        text: (computed.getPropertyValue('--chart-text') || '').trim() || '#24242b',
        grid: (computed.getPropertyValue('--chart-grid') || '').trim() || 'rgba(36,36,43,0.10)',
        coral: (computed.getPropertyValue('--coral') || '').trim() || '#ff6f5e',
        mint: (computed.getPropertyValue('--mint-strong') || '').trim() || '#9fca6b',
        butter: (computed.getPropertyValue('--butter') || '').trim() || '#ffe4a8',
        lavender: (computed.getPropertyValue('--lavender-strong') || '').trim() || '#9b7bea',
        ink: (computed.getPropertyValue('--ink') || '').trim() || '#24242b',
        surface: (computed.getPropertyValue('--surface') || '').trim() || '#ffffff'
    };
}

export function updatePaymentStatusChart() {
    const canvas = document.getElementById('paymentStatusChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const range = getDashboardDateRange();
    const rows = activeTicketRowsInRange(range);
    const buckets = {
        Paid: 0,
        Unpaid: 0,
        Partial: 0,
        Pending: 0
    };

    rows.forEach(t => {
        const amount = ticketSalesAmount(t);
        const remarks = String(t.remarks || '').toLowerCase();
        const split = String(t.split_status || '').toLowerCase();
        if (isFinancialPendingTicket(t)) buckets.Pending += amount;
        else if (remarks.includes('partial') || remarks.includes('balance') || split.includes('partial') || split.includes('balance')) buckets.Partial += amount;
        else if (t.paid) buckets.Paid += amount;
        else buckets.Unpaid += amount;
    });

    const labels = Object.keys(buckets);
    let data = Object.values(buckets);
    const hasData = data.some(v => v > 0);
    if (!hasData) data = [1, 0, 0, 0];

    if (state.charts.paymentStatusChart) state.charts.paymentStatusChart.destroy();
    const p = dashboardChartPalette();
    state.charts.paymentStatusChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: hasData ? [p.mint, p.coral, p.butter, p.lavender] : ['#f1eee9', '#f1eee9', '#f1eee9', '#f1eee9'],
                borderColor: p.surface,
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { position: 'bottom', labels: { color: p.text, boxWidth: 10, font: { size: 11, weight: '700' } } },
                tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatDashboardAmount(hasData ? ctx.raw : 0)} MMK` } }
            }
        }
    });
}

export function updateRoutePerformanceChart() {
    const canvas = document.getElementById('routePerformanceChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const range = getDashboardDateRange();
    const groups = {};
    activeTicketRowsInRange(range).forEach(t => {
        if (isFeeEntryRow(t)) return;
        const route = t.departure && t.destination ? `${t.departure.split(' ')[0]} → ${t.destination.split(' ')[0]}` : 'Unknown route';
        if (!groups[route]) groups[route] = { profit: 0, tickets: 0 };
        groups[route].profit += ticketProfitAmount(t);
        groups[route].tickets += 1;
    });

    let rows = Object.entries(groups).sort((a, b) => b[1].profit - a[1].profit).slice(0, 5);
    if (rows.length === 0) rows = [['No route data', { profit: 0, tickets: 0 }]];

    if (state.charts.routePerformanceChart) state.charts.routePerformanceChart.destroy();
    const p = dashboardChartPalette();
    state.charts.routePerformanceChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: rows.map(r => r[0]),
            datasets: [{
                label: 'Profit',
                data: rows.map(r => r[1].profit),
                backgroundColor: p.mint,
                borderColor: p.ink,
                borderWidth: 1,
                borderRadius: 10
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${formatDashboardAmount(ctx.raw)} MMK · ${rows[ctx.dataIndex][1].tickets} tickets` } }
            },
            scales: {
                x: { ticks: { color: p.text, callback: value => Number(value).toLocaleString() }, grid: { color: p.grid } },
                y: { ticks: { color: p.text }, grid: { display: false } }
            }
        }
    });
}

export function updateOwnerPayableChart() {
    const canvas = document.getElementById('ownerPayableChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const currentYear = new Date().getFullYear();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const ownerPayable = Array(12).fill(0);
    const paidToOwner = Array(12).fill(0);

    (state.allTickets || []).forEach(t => {
        const d = parseSheetDate(t.issued_date);
        if (!d.getTime() || d.getFullYear() !== currentYear || isCanceledTicket(t)) return;
        ownerPayable[d.getMonth()] += ticketOwnerPayableAmount(t);
    });
    (state.allSettlements || []).forEach(s => {
        const d = parseSheetDate(s.settlement_date);
        if (!d.getTime() || d.getFullYear() !== currentYear) return;
        paidToOwner[d.getMonth()] += Number(s.amount_paid) || 0;
    });

    if (state.charts.ownerPayableChart) state.charts.ownerPayableChart.destroy();
    const p = dashboardChartPalette();
    state.charts.ownerPayableChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Owner Payable',
                data: ownerPayable,
                backgroundColor: p.butter,
                borderColor: '#d59f39',
                borderWidth: 1,
                borderRadius: 8
            }, {
                label: 'Paid to Owner',
                data: paidToOwner,
                type: 'line',
                borderColor: p.coral,
                backgroundColor: p.coral,
                tension: 0.35,
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: p.text } } },
            scales: {
                x: { ticks: { color: p.text }, grid: { color: p.grid } },
                y: { ticks: { color: p.text, callback: value => Number(value).toLocaleString() }, grid: { color: p.grid } }
            }
        }
    });
}

/**
 * Renders the Airline Distribution Doughnut Chart based on current month's ticket sales.
 */
export function updateAirlineChart() {
    const range = getDashboardDateRange();
    const ticketsInPeriod = activeTicketRowsInRange(range);

    const airlineCounts = {};
    ticketsInPeriod.forEach(t => {
        if (isFeeEntryRow(t)) return;
        let airline = (t.airline || 'UNKNOWN').toUpperCase().trim();
        if (!airline) airline = 'UNKNOWN';
        airlineCounts[airline] = (airlineCounts[airline] || 0) + 1;
    });

    // Sort by passenger ticket counts descending
    const sortedAirlines = Object.entries(airlineCounts)
        .sort((a, b) => b[1] - a[1]);

    const labels = sortedAirlines.map(entry => entry[0]);
    const data = sortedAirlines.map(entry => entry[1]);

    const canvas = document.getElementById('airlineChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (state.charts.airlineChart) {
        state.charts.airlineChart.destroy();
    }

    if (labels.length === 0) {
        labels.push("No Data");
        data.push(1);
    }

    const palette = dashboardChartPalette();
    const textColor = palette.text;

    const colors = [
        palette.coral,
        palette.mint,
        palette.butter,
        palette.lavender,
        '#ffd9aa',
        '#f8c9cb',
        '#9fca6b'
    ];

    state.charts.airlineChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: labels[0] === "No Data" ? ['#e2e8f0'] : colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: palette.surface
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: textColor,
                        boxWidth: 10,
                        padding: 10,
                        font: {
                            size: 11,
                            family: 'Inter',
                            weight: '600'
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.label === "No Data") return " No tickets sold this month";
                            const val = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((val / total) * 100).toFixed(1);
                            return ` ${context.label}: ${val} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '72%'
        }
    });
}


/**
 * Updates the Booking & Revenue Overview chart on the dashboard.
 */
export function updateComparisonChart() {
    const canvas = document.getElementById('comparisonChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const range = getDashboardDateRange();
    const dayCount = Math.max(1, Math.round((range.end - range.start) / (24 * 60 * 60 * 1000)) + 1);
    const useDailyBuckets = dayCount <= 45;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const buckets = [];
    const bucketKey = (date) => {
        if (useDailyBuckets) {
            return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        }
        return `${date.getFullYear()}-${date.getMonth()}`;
    };

    if (useDailyBuckets) {
        const cursor = startOfDay(range.start);
        while (cursor <= range.end) {
            buckets.push({
                key: bucketKey(cursor),
                label: `${String(cursor.getDate()).padStart(2, '0')} ${monthNames[cursor.getMonth()]}`,
                revenue: 0,
                profit: 0,
                cancellations: 0
            });
            cursor.setDate(cursor.getDate() + 1);
        }
    } else {
        const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
        const endMonth = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
        while (cursor <= endMonth) {
            buckets.push({
                key: bucketKey(cursor),
                label: `${monthNames[cursor.getMonth()]} ${cursor.getFullYear()}`,
                revenue: 0,
                profit: 0,
                cancellations: 0
            });
            cursor.setMonth(cursor.getMonth() + 1);
        }
    }

    const bucketMap = new Map(buckets.map(bucket => [bucket.key, bucket]));
    (state.allTickets || []).forEach(ticket => {
        const issuedDate = parseSheetDate(ticket.issued_date);
        if (!inDashboardRange(issuedDate, range)) return;
        const bucket = bucketMap.get(bucketKey(issuedDate));
        if (!bucket) return;
        if (isCanceledTicket(ticket)) {
            bucket.cancellations += 1;
            return;
        }
        bucket.revenue += ticketSalesAmount(ticket);
        if (!isFeeEntryRow(ticket)) bucket.profit += ticketProfitAmount(ticket);
    });

    if (state.charts.comparisonChart) {
        state.charts.comparisonChart.destroy();
    }

    const computed = getComputedStyle(document.body);
    const textColor = (computed.getPropertyValue('--chart-text') || '').trim() || '#24242b';
    const gridColor = (computed.getPropertyValue('--chart-grid') || '').trim() || 'rgba(36,36,43,0.10)';
    const revenueBase = (computed.getPropertyValue('--chart-revenue') || '').trim() || '#22b8b2';
    const profitBase = (computed.getPropertyValue('--chart-tickets') || '').trim() || '#4d8df7';
    const cancelBase = (computed.getPropertyValue('--coral') || '').trim() || '#ff6f5e';

    const withAlpha = (color, alpha) => {
        const c = String(color).trim();
        if (!c) return c;
        const rgbaMatch = c.match(/^rgba\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\)$/i);
        if (rgbaMatch) return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${alpha})`;
        const rgbMatch = c.match(/^rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)$/i);
        if (rgbMatch) return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
        const hexMatch = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hexMatch) {
            const hex = hexMatch[1].length === 3
                ? hexMatch[1].split('').map(ch => ch + ch).join('')
                : hexMatch[1];
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        return c;
    };

    const ctx = canvas.getContext('2d');
    const revenueFill = ctx.createLinearGradient(0, 0, 0, 300);
    revenueFill.addColorStop(0, withAlpha(revenueBase, 0.35));
    revenueFill.addColorStop(1, withAlpha(revenueBase, 0.01));

    const profitFill = ctx.createLinearGradient(0, 0, 0, 300);
    profitFill.addColorStop(0, withAlpha(profitBase, 0.35));
    profitFill.addColorStop(1, withAlpha(profitBase, 0.01));

    const hasCancellations = buckets.some(b => b.cancellations > 0);
    const datasets = [{
        label: 'Revenue',
        data: buckets.map(bucket => bucket.revenue),
        borderColor: revenueBase,
        backgroundColor: revenueFill,
        borderWidth: 3,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: revenueBase,
        pointHoverBorderWidth: 2,
        tension: 0.45,
        fill: true,
        yAxisID: 'y'
    }, {
        label: 'Profit',
        data: buckets.map(bucket => bucket.profit),
        type: 'line',
        borderColor: profitBase,
        backgroundColor: profitFill,
        borderWidth: 3,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: profitBase,
        pointHoverBorderWidth: 2,
        tension: 0.45,
        fill: true,
        yAxisID: 'y1'
    }];
    if (hasCancellations) {
        datasets.push({
            label: 'Cancellations',
            data: buckets.map(bucket => bucket.cancellations),
            borderColor: cancelBase,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            pointHoverRadius: 4,
            yAxisID: 'y1',
            tension: 0.3
        });
    }

    const chartConfig = {
        type: 'line',
        data: {
            labels: buckets.map(bucket => bucket.label),
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            layout: {
                padding: { left: 4, right: 12, top: 12, bottom: 4 }
            },
            scales: {
                x: {
                    ticks: {
                        color: withAlpha(textColor, 0.6),
                        autoSkip: true,
                        maxRotation: 0,
                        maxTicksLimit: 8,
                        font: { size: 12, family: "'Inter', sans-serif", weight: '500' }
                    },
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: false },
                    border: { display: false },
                    ticks: {
                        color: withAlpha(textColor, 0.6),
                        maxTicksLimit: 6,
                        callback: value => {
                            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                            if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
                            return Number(value).toLocaleString();
                        },
                        font: { size: 11, family: "'Inter', sans-serif" }
                    },
                    grid: { color: gridColor, borderDash: [4, 4] },
                    beginAtZero: true
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: false },
                    border: { display: false },
                    grid: { display: false },
                    ticks: {
                        color: withAlpha(textColor, 0.6),
                        maxTicksLimit: 5,
                        callback: value => {
                            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                            if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
                            return Number(value).toLocaleString();
                        },
                        font: { size: 11, family: "'Inter', sans-serif" }
                    },
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    align: 'end',
                    labels: {
                        color: textColor,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        boxWidth: 8,
                        padding: 20,
                        font: { size: 12, family: "'Inter', sans-serif", weight: '600' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    titleColor: '#0b1f3a',
                    bodyColor: '#334155',
                    titleFont: { size: 13, weight: '700', family: "'Inter', sans-serif" },
                    bodyFont: { size: 12, family: "'Inter', sans-serif", weight: '600' },
                    borderColor: 'rgba(0,0,0,0.06)',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 6,
                    usePointStyle: true,
                    callbacks: {
                        label: context => {
                            return `${context.dataset.label}: ${formatDashboardAmount(context.raw)} MMK`;
                        }
                    }
                }
            }
        }
    };

    state.charts.comparisonChart = new Chart(ctx, chartConfig);
}



// --- APP START ---
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
