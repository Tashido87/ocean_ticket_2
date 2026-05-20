/**
 * @fileoverview Main entry point for the Ocean Air Ticket Management application.
 * Initializes the application, sets up event listeners, and coordinates modules.
 * UPDATED: Restored 'addExistingPassengerBtn' listener.
 */

// Core Modules
import { initAuth, handleAuthClick } from './auth.js';
import { state, setCurrentUser } from './state.js';
import { onTicketsChange, onBookingsChange, onHistoryChange, onSettlementsChange, onClosedPeriodsChange, onAdjustmentsChange } from './db.js';
import { showToast, parseSheetDate, parseDeadline, debounce, setButtonLoading, showServiceToast, hideServiceToast, addRecentActivity, renderRecentActivity } from './utils.js';

// Feature Modules
import { loadTicketData, performSearch, clearSearch, setDateRangePreset, handleSellTicket, handleAirlineChange, populateSearchAirlines, displayInitialTickets, updateUnpaidCount } from './tickets.js';
import { loadBookingData, handleNewBookingSubmit, performBookingSearch, clearBookingSearch, displayBookings } from './booking.js';
import { loadHistory } from './history.js';
import { loadSettlementData, showNewSettlementForm, hideNewSettlementForm, handleNewSettlementSubmit, updateSettlementDashboard, displaySettlements, initSettlementView } from './settlement.js';
import { buildClientList, loadFeaturedClients } from './clients.js';
import { initGlobalSearch, initSearchView } from './search.js';
import { findTicketForManage, clearManageResults } from './manage.js';
import { exportToPdf, exportPrivateReportToPdf, togglePrivateReportButton } from './reports.js';
import { generateInvoice, generateInvoiceImage, analyzeInvoiceScenario } from './invoice.js'; 
import { initHotelService } from './hotel.js'; 
import { getAllDocuments, uploadDocument, deleteDocument, renameDocument, formatFileSize, formatUploadDate } from './documents.js';

// UI Modules
// MODIFIED: Added 'addExistingPassengerForm' to imports
import { showView, initializeDatepickers, initializeTimePicker, initializeCityDropdowns, updateToggleLabels, updateDynamicTimes, updateNotifications, updateUpcomingPnrs, initializeUISettings, closeModal, populateFlightLocations, addPassengerForm, removePassengerForm, resetPassengerForms, addBookingPassengerForm, removeBookingPassengerForm, resetBookingPassengerForms, showNewBookingForm, hideNewBookingForm, showInvoiceOptionModal, initializePaymentMethodEnhancements, addExistingPassengerForm, applyFlightTypeToAllPaxForms, initializeSellFormEnhancements, updateSellRoutePreview } from './ui.js';

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

/**
 * Main application initialization function. Called after authentication.
 * @export
 */
export async function initializeApp() {
    try {
        loadFeaturedClients();

        // Unsubscribe from any existing listeners
        state.unsubscribers.forEach(unsub => unsub && unsub());
        state.unsubscribers = [];

        // Load initial data
        await Promise.all([
            loadTicketData(),
            loadBookingData(),
            loadHistory(),
            loadSettlementData()
        ]);

        // Build derived data
        buildClientList();
        initializeDashboardSelectors();

        // Default: show This Month
        setDateRangePreset('this-month');
        syncGroupToggleState();

        // Hash-based routing (for search page)
        window.addEventListener('hashchange', handleHashRoute);
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
            })
        );

        state.unsubscribers.push(
            onBookingsChange((bookings) => {
                state.allBookings = bookings;
                displayBookings();
                updateNotifications();
            })
        );

        state.unsubscribers.push(
            onSettlementsChange((settlements) => {
                state.allSettlements = settlements;
                displaySettlements();
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

    } catch (error) {
        console.error("Initialization failed:", error);
        showToast('A critical error occurred during data initialization. Please check the console (F12) for details.', 'error');
    }
}

/**
 * Handle URL hash routing for the search page.
 */
function handleHashRoute() {
    const hash = window.location.hash;
    if (hash.startsWith('#/search')) {
        showView('search');
        initSearchView();
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
        updateAirlineChart();
        updatePaymentStatusChart();
        updateRoutePerformanceChart();
        updateOwnerPayableChart();
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

function isFeeEntryRow(t) {
    return /\(fees\)\s*$/i.test(String(t?.name || '')) || String(t?.remarks || '').toLowerCase().includes('fee entry') || String(t?.remarks || '').toLowerCase().includes('balance');
}

function isCanceledTicket(t) {
    const remarks = String(t?.remarks || '').toLowerCase();
    const status = String(t?.status || '').toLowerCase();
    return status.includes('cancel') || remarks.includes('cancel') || remarks.includes('refund');
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

    const passengerTicketsInPeriod = ticketsInPeriod.filter(t => !isFeeEntryRow(t));
    const curPassengerTickets = passengerTicketsInPeriod.length;

    const curRevenue = ticketsInPeriod.reduce((sum, t) => sum + ticketSalesAmount(t), 0);
    const totalCommission = ticketsInPeriod.reduce((sum, t) => sum + (Number(t.commission) || 0), 0);
    const totalExtraFare = ticketsInPeriod.reduce((sum, t) => sum + (Number(t.extra_fare) || 0), 0);
    const curProfit = totalCommission + totalExtraFare;
    const curOwnerPayable = ticketsInPeriod.reduce((sum, t) => sum + ticketOwnerPayableAmount(t), 0);
    const curUnpaid = ticketsInPeriod.filter(t => !t.paid).reduce((sum, t) => sum + ticketSalesAmount(t), 0);
    const curFinancialPending = ticketsInPeriod.filter(isFinancialPendingTicket).length;

    const prevPassengerTickets = prevTicketsInPeriod.filter(t => !isFeeEntryRow(t)).length;
    const prevRevenue = prevTicketsInPeriod.reduce((sum, t) => sum + ticketSalesAmount(t), 0);
    const prevProfit = prevTicketsInPeriod.reduce((sum, t) => sum + ticketProfitAmount(t), 0);
    const prevOwnerPayable = prevTicketsInPeriod.reduce((sum, t) => sum + ticketOwnerPayableAmount(t), 0);
    const prevUnpaid = prevTicketsInPeriod.filter(t => !t.paid).reduce((sum, t) => sum + ticketSalesAmount(t), 0);

    setText('total-tickets-value', curPassengerTickets);
    setHtml('tickets-trend-wrapper', getTrendBadgeHtml(curPassengerTickets, prevPassengerTickets));

    setText('monthly-revenue-value', formatDashboardAmount(curRevenue));
    setHtml('revenue-trend-wrapper', getTrendBadgeHtml(curRevenue, prevRevenue));

    setText('monthly-profit-value', formatDashboardAmount(curProfit));
    setHtml('profit-trend-wrapper', getTrendBadgeHtml(curProfit, prevProfit));
    setText('profit-breakdown-label', `Comm: ${formatDashboardAmount(totalCommission)} | Extra: ${formatDashboardAmount(totalExtraFare)}`);

    setText('owner-payable-value', formatDashboardAmount(curOwnerPayable));
    setHtml('owner-payable-trend-wrapper', getTrendBadgeHtml(curOwnerPayable, prevOwnerPayable));

    setText('unpaid-amount-value', formatDashboardAmount(curUnpaid));
    setHtml('unpaid-trend-wrapper', getTrendBadgeHtml(curUnpaid, prevUnpaid, true));

    const activeBookings = getActiveBookings();
    const dueToday = activeBookings.filter(b => {
        const deadline = getBookingDeadline(b);
        if (!deadline) return false;
        const diff = deadline.getTime() - Date.now();
        return diff <= 24 * 60 * 60 * 1000;
    });

    setText('active-bookings-value', activeBookings.length);
    setHtml('bookings-due-wrapper', dueToday.length > 0
        ? `<span class="trend-badge negative"><i class="fa-solid fa-triangle-exclamation"></i> ${dueToday.length} due</span>`
        : `<span class="trend-badge positive"><i class="fa-solid fa-check"></i> On Track</span>`);

    setText('booking-deadlines-value', dueToday.length);
    setHtml('deadline-health-wrapper', dueToday.length > 0
        ? `<span class="trend-badge negative"><i class="fa-solid fa-bell"></i> review</span>`
        : `<span class="trend-badge positive"><i class="fa-solid fa-check"></i> clear</span>`);

    setText('financial-pending-value', curFinancialPending);
    setHtml('financial-pending-wrapper', curFinancialPending > 0
        ? `<span class="trend-badge negative"><i class="fa-solid fa-clipboard-list"></i> action</span>`
        : `<span class="trend-badge positive"><i class="fa-solid fa-check"></i> confirmed</span>`);

    renderNeedsAttentionPanel(ticketsInPeriod, activeBookings, dueToday, curUnpaid, curFinancialPending);
    renderOwnerSettlementSnapshot(ticketsInPeriod, range);
    updateNotifications();
    updateUpcomingPnrs();
    updateSettlementDashboard();
    updateComparisonChart();
    updateAirlineChart();
    updatePaymentStatusChart();
    updateRoutePerformanceChart();
    updateOwnerPayableChart();
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
 * Updates the yearly comparison chart on the dashboard.
 */
export function updateComparisonChart() {
    const currentYear = new Date().getFullYear();
    const isFeeEntryRow = (t) => /\(fees\)\s*$/i.test(String(t?.name || '')) || String(t?.remarks || '').toLowerCase().includes('fee entry');
    const ticketsThisYear = state.allTickets.filter(t => {
        const ticketDate = parseSheetDate(t.issued_date);
        return ticketDate.getFullYear() === currentYear;
    });

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyData = Array(12).fill(null).map(() => ({
        revenue: 0,
        profit: 0,
        tickets: 0
    }));

    ticketsThisYear.forEach(t => {
        const month = parseSheetDate(t.issued_date).getMonth();
        monthlyData[month].revenue += (t.net_amount || 0) + (t.date_change || 0);
        monthlyData[month].profit += (t.commission || 0) + (t.extra_fare || 0);
        if (!isFeeEntryRow(t)) {
            monthlyData[month].tickets++;
        }
    });

    const ctx = document.getElementById('comparisonChart').getContext('2d');

    if (state.charts.comparisonChart) {
        state.charts.comparisonChart.destroy();
    }

    // Theme-aware chart styling (reads from CSS variables)
    const isMaterialLight = document.body.classList.contains('material-theme') && !document.body.classList.contains('dark-theme');
    const computed = getComputedStyle(document.body);

    const textColor = (computed.getPropertyValue('--chart-text') || '').trim() || (isMaterialLight ? '#4A4A4A' : '#FFFFFF');
    const gridColor = (computed.getPropertyValue('--chart-grid') || '').trim() || (isMaterialLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)');

    const revenueBase = (computed.getPropertyValue('--chart-revenue') || '').trim() || '#fb923c';
    const profitBase = (computed.getPropertyValue('--chart-profit') || '').trim() || '#2ecc71';
    const ticketsBase = (computed.getPropertyValue('--chart-tickets') || '').trim() || '#3498db';

    const withAlpha = (color, alpha) => {
        const c = String(color).trim();
        if (!c) return c;

        // rgba(...) -> swap alpha
        const rgbaMatch = c.match(/^rgba\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\)$/i);
        if (rgbaMatch) return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${alpha})`;

        // rgb(...) -> add alpha
        const rgbMatch = c.match(/^rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)$/i);
        if (rgbMatch) return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;

        // #RRGGBB / #RGB -> rgba
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

        // fallback
        return c;
    };

    const revenueFill = withAlpha(revenueBase, 0.55);
    const profitFill = withAlpha(profitBase, 0.55);
    const ticketsFill = withAlpha(ticketsBase, 0.30);

    const chartConfig = {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Total Revenue',
                data: monthlyData.map(d => d.revenue),
                backgroundColor: revenueFill,
                borderColor: revenueBase,
                borderWidth: 1,
                yAxisID: 'y'
            }, {
                label: 'Total Profit',
                data: monthlyData.map(d => d.profit),
                backgroundColor: profitFill,
                borderColor: profitBase,
                borderWidth: 1,
                yAxisID: 'y'
            }, {
                label: 'Total Tickets',
                data: monthlyData.map(d => d.tickets),
                backgroundColor: ticketsFill,
                borderColor: ticketsBase,
                borderWidth: 1,
                type: 'line',
                yAxisID: 'y1',
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    ticks: { color: textColor },
                    grid: { color: gridColor }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Amount (MMK)',
                        color: textColor
                    },
                    ticks: {
                        color: textColor
                    },
                    grid: { color: gridColor }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Number of Tickets',
                        color: textColor
                    },
                    grid: {
                        color: gridColor,
                        drawOnChartArea: false,
                    },
                    ticks: {
                        color: textColor
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: textColor
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
