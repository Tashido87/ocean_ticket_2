/**
 * @fileoverview Main entry point for the Ocean Air Ticket Management application.
 * Initializes the application, sets up event listeners, and coordinates modules.
 * UPDATED: Restored 'addExistingPassengerBtn' listener.
 */

// Core Modules
import { loadGapiClient, loadGisClient, handleAuthClick } from './auth.js';
import { state, getAuth } from './state.js';
import { showToast, parseSheetDate, debounce } from './utils.js';

// Feature Modules
import { loadTicketData, performSearch, clearSearch, setDateRangePreset, handleSellTicket, handleAirlineChange, populateSearchAirlines } from './tickets.js';
import { loadBookingData, handleNewBookingSubmit, performBookingSearch, clearBookingSearch } from './booking.js';
import { loadHistory } from './history.js';
import { loadSettlementData, showNewSettlementForm, hideNewSettlementForm, handleNewSettlementSubmit, updateSettlementDashboard } from './settlement.js';
import { buildClientList, renderClientsView, loadFeaturedClients } from './clients.js';
import { findTicketForManage, clearManageResults } from './manage.js';
import { exportToPdf, exportPrivateReportToPdf, togglePrivateReportButton } from './reports.js';
import { generateInvoice, generateInvoiceImage, analyzeInvoiceScenario } from './invoice.js'; 
import { initHotelService } from './hotel.js'; 

// UI Modules
// MODIFIED: Added 'addExistingPassengerForm' to imports
import { showView, initializeDatepickers, initializeTimePicker, initializeCityDropdowns, updateToggleLabels, updateDynamicTimes, updateNotifications, updateUpcomingPnrs, initializeUISettings, closeModal, populateFlightLocations, addPassengerForm, removePassengerForm, resetPassengerForms, addBookingPassengerForm, removeBookingPassengerForm, resetBookingPassengerForms, showNewBookingForm, hideNewBookingForm, showInvoiceOptionModal, initializePaymentMethodEnhancements, addExistingPassengerForm } from './ui.js';

/**
 * Main application initialization function. Called after authentication.
 * @export
 */
export async function initializeApp() {
    try {
        loadFeaturedClients(); // Load this from local storage first
        // Load initial data from sheets
        await Promise.all([
            loadTicketData(),
            loadBookingData(),
            loadHistory(),
            loadSettlementData()
        ]);

        // Build derived data
        buildClientList();
        renderClientsView(); // Initial render for the clients view

        // Populate UI elements that depend on data
        initializeDashboardSelectors();


        // Start dynamic updates
        if (state.timeUpdateInterval) clearInterval(state.timeUpdateInterval);
        state.timeUpdateInterval = setInterval(updateDynamicTimes, 60000); // Update every minute
        updateDynamicTimes(); // Run once immediately

        // Set up a token refresh interval
        setInterval(() => {
            console.log("Refreshing access token automatically...");
            const { tokenClient } = getAuth();
            if (tokenClient) {
                tokenClient.requestAccessToken({ prompt: '' });
            }
        }, 2700000); // 45 minutes

    } catch (error) {
        console.error("Initialization failed:", error);
        showToast('A critical error occurred during data initialization. Please check the console (F12) for details.', 'error');
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
    document.getElementById('background-upload-btn').addEventListener('click', () => document.getElementById('background-uploader').click());


    // Dashboard Search
    document.getElementById('searchName').addEventListener('input', () => debounce(performSearch, 300));
    document.getElementById('searchBooking').addEventListener('input', () => debounce(performSearch, 300));
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

    // Invoice Generation Logic (Updated with Scenario Analysis)
    const invoiceForm = document.getElementById('invoiceForm');
    if (invoiceForm) {
        // Handle PDF Generation (Form Submit)
        invoiceForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pnrInput = document.getElementById('invoice_pnr_list').value;
            const pnrList = pnrInput.split(/[\n,]/).map(p => p.trim()).filter(p => p);
            
            const type = document.getElementById('document_type').value;
            const brand = document.getElementById('invoice_brand').value;
            const date = document.getElementById('invoice_date').value;

            if (pnrList.length === 0) {
                showToast('Please enter at least one PNR.', 'error');
                return;
            }

            // 1. Analyze the Scenario
            const scenario = analyzeInvoiceScenario(pnrList);

            if (scenario.type === 'ERROR') {
                showToast(scenario.message, 'error');
                return;
            }

            // 2. Handle Choice (Scenario 1) or Auto
            if (scenario.canChoose) {
                showInvoiceOptionModal(async (selectedMode) => {
                    try {
                        showToast(`Generating ${type} PDF (${selectedMode})...`, 'info');
                        await generateInvoice(pnrList, type, date, selectedMode, brand);
                    } catch (error) {
                        console.error(error);
                        showToast('Failed to generate document.', 'error');
                    }
                });
            } else {
                try {
                    showToast(`Generating ${type} PDF...`, 'info');
                    await generateInvoice(pnrList, type, date, 'auto', brand);
                } catch (error) {
                    console.error(error);
                    showToast('Failed to generate document.', 'error');
                }
            }
        });

        // Handle Photo Generation (Button Click)
        const photoBtn = document.getElementById('invoiceGenPhotoBtn');
        if (photoBtn) {
            photoBtn.addEventListener('click', async () => {
                const pnrInput = document.getElementById('invoice_pnr_list').value;
                const pnrList = pnrInput.split(/[\n,]/).map(p => p.trim()).filter(p => p);
                
                const type = document.getElementById('document_type').value;
                const brand = document.getElementById('invoice_brand').value;
                const date = document.getElementById('invoice_date').value;

                if (pnrList.length === 0) {
                    showToast('Please enter at least one PNR.', 'error');
                    return;
                }

                // 1. Analyze
                const scenario = analyzeInvoiceScenario(pnrList);

                if (scenario.type === 'ERROR') {
                    showToast(scenario.message, 'error');
                    return;
                }

                // 2. Handle Choice or Auto
                if (scenario.canChoose) {
                    showInvoiceOptionModal(async (selectedMode) => {
                        try {
                            showToast(`Generating ${type} Image (${selectedMode})...`, 'info');
                            await generateInvoiceImage(pnrList, type, date, selectedMode, brand);
                        } catch (error) {
                            console.error(error);
                            showToast('Failed to generate image.', 'error');
                        }
                    });
                } else {
                    try {
                        showToast(`Generating ${type} Image...`, 'info');
                        await generateInvoiceImage(pnrList, type, date, 'auto', brand);
                    } catch (error) {
                        console.error(error);
                        showToast('Failed to generate image.', 'error');
                    }
                }
            });
        }

        // Handle Clear Button
        const invoiceClearBtn = document.getElementById('invoiceClearBtn');
        if (invoiceClearBtn) {
            invoiceClearBtn.addEventListener('click', () => {
                document.getElementById('invoice_pnr_list').value = '';
                document.getElementById('invoice_date').value = '';
                document.getElementById('document_type').value = 'Invoice';
                document.getElementById('invoice_brand').value = 'ocean';
            });
        }
    }

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
        return ticketDate.getFullYear() === currentYear && !t.remarks?.toLowerCase().includes('full refund');
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


    if (typeof gapi === 'undefined' || typeof google === 'undefined') {
        showToast('Google API scripts not loaded.', 'error');
        return;
    }
    try {
        await Promise.all([loadGapiClient(), loadGisClient()]);
    } catch (error) {
        showToast('Failed to load Google APIs. Please refresh.', 'error');
        const authBtn = document.getElementById('authorize_button');
        if (authBtn) authBtn.style.display = 'block';
        document.getElementById('loading').style.display = 'none';
    }
};
