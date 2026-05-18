/**
 * @fileoverview Main entry point for the Ocean Air Ticket Management application.
 * Initializes the application, sets up event listeners, and coordinates modules.
 * UPDATED: Restored 'addExistingPassengerBtn' listener.
 */

// Core Modules
import { initAuth, handleAuthClick } from './auth.js';
import { state, setCurrentUser } from './state.js';
import { onTicketsChange, onBookingsChange, onHistoryChange, onSettlementsChange } from './db.js';
import { showToast, parseSheetDate, debounce, setButtonLoading, showServiceToast, hideServiceToast, addRecentActivity, renderRecentActivity } from './utils.js';

// Feature Modules
import { loadTicketData, performSearch, clearSearch, setDateRangePreset, handleSellTicket, handleAirlineChange, populateSearchAirlines, displayInitialTickets, updateUnpaidCount } from './tickets.js';
import { loadBookingData, handleNewBookingSubmit, performBookingSearch, clearBookingSearch, displayBookings } from './booking.js';
import { loadHistory } from './history.js';
import { loadSettlementData, showNewSettlementForm, hideNewSettlementForm, handleNewSettlementSubmit, updateSettlementDashboard, displaySettlements } from './settlement.js';
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
                updateSettlementDashboard();
            })
        );

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
    document.getElementById('settings-btn').addEventListener('click', () => document.getElementById('settings-panel').classList.toggle('show'));
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', () => document.getElementById('settings-panel').classList.remove('show'));

    initGlobalSearch();

    // Dashboard Search
    const debouncedSearch = debounce(performSearch, 300);
    document.getElementById('searchName').addEventListener('input', debouncedSearch);
    document.getElementById('searchBooking').addEventListener('input', debouncedSearch);
    ['searchTravelDate', 'searchStartDate', 'searchEndDate', 'searchDeparture', 'searchDestination', 'searchAirline', 'searchNotPaidToggle'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', performSearch);
    });
    document.getElementById('searchBtn').addEventListener('click', performSearch);
    document.getElementById('clearBtn').addEventListener('click', clearSearch);
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setDateRangePreset(e.target.dataset.range);
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        });
    });

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

    // Settlement
    document.getElementById('newSettlementBtn').addEventListener('click', showNewSettlementForm);
    document.getElementById('cancelNewSettlementBtn').addEventListener('click', hideNewSettlementForm);
    document.getElementById('newSettlementForm').addEventListener('submit', handleNewSettlementSubmit);

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
        const settingsPanel = document.getElementById('settings-panel');
        if (!settingsPanel.contains(event.target) && event.target !== document.getElementById('settings-btn') && !document.getElementById('settings-btn').contains(event.target) ) {
            settingsPanel.classList.remove('show');
        }
    });

    // Theme change listener for chart redraw
    document.body.addEventListener('themeChanged', updateComparisonChart);
}

/**
 * Initializes dashboard-specific UI elements like date selectors.
 */
function initializeDashboardSelectors() {
    updateDashboardData();
}

/**
 * Updates the main dashboard cards with the latest data.
 */
export function updateDashboardData() {
    // Month/year selector removed: use current month & year
    const now = new Date();
    const selectedMonth = now.getMonth();
    const selectedYear = now.getFullYear();
    const isFeeEntryRow = (t) => /\(fees\)\s*$/i.test(String(t?.name || '')) || String(t?.remarks || '').toLowerCase().includes('fee entry');

    const ticketsInPeriod = state.allTickets.filter(t => {
        const ticketDate = parseSheetDate(t.issued_date);
        const lowerRemarks = t.remarks?.toLowerCase() || '';
        return ticketDate.getMonth() === selectedMonth && ticketDate.getFullYear() === selectedYear && !lowerRemarks.includes('cancel') && !lowerRemarks.includes('refund');
    });

    // Total Tickets should represent real passenger tickets (exclude internal fee-entry rows).
    const passengerTicketsInPeriod = ticketsInPeriod.filter(t => !isFeeEntryRow(t));
    document.getElementById('total-tickets-value').textContent = passengerTicketsInPeriod.length;
    const revenueTickets = ticketsInPeriod; // Already filtered
    const totalRevenue = revenueTickets.reduce((sum, t) => sum + (t.net_amount || 0) + (t.date_change || 0), 0);
    const revenueBox = document.getElementById('monthly-revenue-box');
    revenueBox.querySelector('.main-value').textContent = totalRevenue.toLocaleString();

    const totalCommission = revenueTickets.reduce((sum, t) => sum + (t.commission || 0), 0);
    const commissionBox = document.getElementById('monthly-commission-box');
    commissionBox.querySelector('.main-value').textContent = totalCommission.toLocaleString();

    const totalExtraFare = revenueTickets.reduce((sum, t) => sum + (t.extra_fare || 0), 0);
    const extraFareBox = document.getElementById('monthly-extra-fare-box');
    extraFareBox.querySelector('.main-value').textContent = totalExtraFare.toLocaleString();

    updateNotifications();
    updateUpcomingPnrs();
    updateSettlementDashboard();
    updateComparisonChart();
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
