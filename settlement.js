/**
 * @fileoverview Manages all logic related to financial settlements, including loading,
 * displaying, creating, and calculating settlement dashboard figures.
 */

import {
    CONFIG
} from './config.js';
import {
    state
} from './state.js';
import {
    fetchFromSheet,
    appendToSheet
} from './api.js';
import {
    showToast,
    parseSheetDate,
    renderEmptyState,
    formatDateToDDMMMYYYY,
    formatPaymentMethod
} from './utils.js';
import {
    setupSettlementPagination
} from './ui.js';

/**
 * Loads settlement data from the Google Sheet.
 */
export async function loadSettlementData() {
    try {
        const response = await fetchFromSheet(`${CONFIG.SETTLE_SHEET_NAME}!A:G`, 'settlementData');
        if (response.values) {
            state.allSettlements = parseSettlementData(response.values);
        } else {
            state.allSettlements = [];
        }
        displaySettlements();
    } catch (error) {
        renderEmptyState('settlementTableContainer', 'fa-handshake-slash', 'Failed to load settlements', 'Could not retrieve settlement data from the sheet.');
    }
}

/**
 * Parses raw sheet data into an array of settlement objects.
 * @param {Array<Array<string>>} values The raw values from the sheet.
 * @returns {Array<Object>} An array of settlement objects.
 */
function parseSettlementData(values) {
    if (values.length < 1) return [];
    const headers = values[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
    return values.slice(1).map((row, i) => {
        const settlement = {};
        headers.forEach((h, j) => {
            const value = row[j] || '';
            settlement[h] = typeof value === 'string' ? value.trim() : value;
        });
        settlement.amount_paid = parseFloat(String(settlement.amount_paid).replace(/,/g, '')) || 0;
        settlement.rowIndex = i + 2;
        return settlement;
    });
}

/**
 * Displays the list of settlements with pagination.
 */
export function displaySettlements() {
    const container = document.getElementById('settlementTableContainer');
    container.innerHTML = '';

    const sortedSettlements = [...state.allSettlements].sort((a, b) => parseSheetDate(b.settlement_date) - parseSheetDate(a.settlement_date));

    if (sortedSettlements.length === 0) {
        renderEmptyState('settlementTableContainer', 'fa-handshake', 'No Settlements Yet', 'Start by adding a new settlement record.');
        setupSettlementPagination([]);
        return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Settlement Date</th><th>Amount Paid</th><th>Payment Method</th><th>Transaction ID</th><th>Status</th><th>Notes</th>
            </tr>
        </thead>
        <tbody id="settlementTableBody"></tbody>
    `;
    container.appendChild(table);

    state.settlementPage = 1;
    renderSettlementPage(1, sortedSettlements);
}

/**
 * Renders a specific page of the settlement list.
 * @param {number} page The page number to render.
 * @param {Array<Object>} settlements The array of settlements to display.
 */
function renderSettlementPage(page, settlements) {
    state.settlementPage = page;
    const tbody = document.getElementById('settlementTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const paginated = settlements.slice((page - 1) * state.rowsPerPage, page * state.rowsPerPage);

    paginated.forEach(settlement => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${settlement.settlement_date || ''}</td>
            <td>${(settlement.amount_paid || 0).toLocaleString()}</td>
            <td>${settlement.payment_method || ''}</td>
            <td>${settlement.transaction_id || 'N/A'}</td>
            <td>${settlement.status || ''}</td>
            <td>${settlement.notes || ''}</td>
        `;
    });

    setupSettlementPagination(settlements);
}

/**
 * Shows the form for creating a new settlement.
 */
export function showNewSettlementForm() {
    document.getElementById('settle-display-container').style.display = 'none';
    document.getElementById('settle-form-container').style.display = 'block';
}

/**
 * Hides the form for creating a new settlement.
 */
export function hideNewSettlementForm() {
    document.getElementById('settle-form-container').style.display = 'none';
    document.getElementById('settle-display-container').style.display = 'block';
    document.getElementById('newSettlementForm').reset();
}

/**
 * Handles the submission of the new settlement form.
 * @param {Event} e The form submission event.
 */
export async function handleNewSettlementSubmit(e) {
    e.preventDefault();
    if (state.isSubmitting) return;
    state.isSubmitting = true;
    const submitButton = e.target.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
        const settlementData = {
            settlement_date: document.getElementById('settlement_date').value,
            amount_paid: document.getElementById('settlement_amount_paid').value,
            payment_method: formatPaymentMethod(
                document.getElementById('settlement_payment_method').value,
                document.getElementById('settlement_payment_method_bank')?.value || ''
            ),
            transaction_id: document.getElementById('settlement_transaction_id').value.toUpperCase(),
            notes: document.getElementById('settlement_notes').value
        };

        if (!settlementData.settlement_date || !settlementData.amount_paid) {
            throw new Error('Settlement Date and Amount Paid are required.');
        }

        const values = [[
            formatDateToDDMMMYYYY(settlementData.settlement_date),
            '', // Empty value for 'net_amount' column
            settlementData.amount_paid,
            settlementData.payment_method,
            settlementData.transaction_id,
            "Paid",
            settlementData.notes
        ]];

        await appendToSheet(`${CONFIG.SETTLE_SHEET_NAME}!A:G`, values);

        state.cache['settlementData'] = null;
        showToast('Settlement saved successfully!', 'success');
        hideNewSettlementForm();
        await loadSettlementData();
        updateSettlementDashboard();
    } catch (error) {
        // Error is shown by api.js
    } finally {
        state.isSubmitting = false;
        if (submitButton) submitButton.disabled = false;
    }
}

/**
 * Calculates and updates the figures on the settlement dashboard.
 */
export function updateSettlementDashboard() {
    const now = new Date(); // e.g., Nov 12, 2025
    const currentMonth = now.getMonth(); // 10 (for November)
    const currentYear = now.getFullYear(); // 2025
    
    // We use UTC to prevent timezone issues in comparison.
    const firstDayOfCurrentMonth = new Date(Date.UTC(currentYear, currentMonth, 1)); // Nov 1, 2025

    // --- Previous Balance Calculation (Corrected Logic with Reset Date) ---
    // User requested a hard reset. As of Nov 1, 2025, the balance is 0.
    const RESET_DATE = new Date(Date.UTC(2025, 10, 1)); // 10 is for November in JS

    let previousEndOfMonthDue = 0;

    if (firstDayOfCurrentMonth < RESET_DATE) {
        // --- OLD FLAWED LOGIC (for months before the reset, e.g., Oct 2025) ---
        const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
        const lastDayOfPreviousMonth = new Date(firstDayOfMonth.getTime() - 1);
        const previousMonth = lastDayOfPreviousMonth.getMonth();
        const previousYear = lastDayOfPreviousMonth.getFullYear();

        const ticketsLastMonth = state.allTickets.filter(t => {
            const ticketDate = parseSheetDate(t.issued_date);
            const lowerRemarks = t.remarks?.toLowerCase() || '';
            return ticketDate.getMonth() === previousMonth && ticketDate.getFullYear() === previousYear && !lowerRemarks.includes('full refund');
        });

        const revenueLastMonth = ticketsLastMonth.reduce((sum, t) => sum + (t.net_amount || 0) + (t.date_change || 0), 0);
        const commissionLastMonth = ticketsLastMonth.reduce((sum, t) => sum + (t.commission || 0), 0);

        const settlementsLastMonth = state.allSettlements.filter(s => {
            const settlementDate = parseSheetDate(s.settlement_date);
            return settlementDate.getMonth() === previousMonth && settlementDate.getFullYear() === previousYear;
        });
        const totalSettlementsLastMonth = settlementsLastMonth.reduce((sum, s) => sum + (s.amount_paid || 0), 0);
        previousEndOfMonthDue = revenueLastMonth - (commissionLastMonth + totalSettlementsLastMonth);
        // --- END OF OLD FLAWED LOGIC ---

    } else {
        // --- NEW CORRECT LOGIC (For Nov 1, 2025 and after) ---
        // This calculates the true running balance *since the last reset*.
        
        // We calculate all transactions from the RESET_DATE up to the start of the current month.
        // e.g., If current month is Dec, this finds balance from Nov 1 to Nov 30.
        const filterStartDate = RESET_DATE;
        
        const ticketsBefore = state.allTickets.filter(t => {
            const ticketDate = parseSheetDate(t.issued_date);
            const lowerRemarks = t.remarks?.toLowerCase() || '';
            return ticketDate >= filterStartDate && ticketDate < firstDayOfCurrentMonth && !lowerRemarks.includes('full refund');
        });
        const revenueBefore = ticketsBefore.reduce((sum, t) => sum + (t.net_amount || 0) + (t.date_change || 0), 0);
        const commissionBefore = ticketsBefore.reduce((sum, t) => sum + (t.commission || 0), 0);

        const settlementsBefore = state.allSettlements.filter(s => {
            const settlementDate = parseSheetDate(s.settlement_date);
            return settlementDate >= filterStartDate && settlementDate < firstDayOfCurrentMonth;
        });
        const totalSettlementsBefore = settlementsBefore.reduce((sum, s) => sum + (s.amount_paid || 0), 0);
        
        // This is the true balance carried over since the last reset.
        // For November, ticketsBefore/settlementsBefore will be empty, so this will be 0.
        previousEndOfMonthDue = revenueBefore - (commissionBefore + totalSettlementsBefore);
    }

    // --- Current Month's Figures ---
    const ticketsThisMonth = state.allTickets.filter(t => {
        const ticketDate = parseSheetDate(t.issued_date);
        const lowerRemarks = t.remarks?.toLowerCase() || '';
        return ticketDate.getMonth() === currentMonth && ticketDate.getFullYear() === currentYear && !lowerRemarks.includes('full refund');
    });

    const revenueThisMonth = ticketsThisMonth.reduce((sum, t) => sum + (t.net_amount || 0) + (t.date_change || 0), 0);
    const commissionThisMonth = ticketsThisMonth.reduce((sum, t) => sum + (t.commission || 0), 0);
    const extraFareThisMonth = ticketsThisMonth.reduce((sum, t) => sum + (t.extra_fare || 0), 0);

    const settlementsThisMonth = state.allSettlements.filter(s => {
        const settlementDate = parseSheetDate(s.settlement_date);
        return settlementDate.getMonth() === currentMonth && settlementDate.getFullYear() === currentYear;
    });
    const totalSettlementsThisMonth = settlementsThisMonth.reduce((sum, s) => sum + (s.amount_paid || 0), 0);

    // --- Update Dashboard Cards ---
    // This is the total amount currently owed (Balance from before + This month's revenue - This month's settlements)
    const totalOutstandingRevenue = (revenueThisMonth + previousEndOfMonthDue) - totalSettlementsThisMonth;
    const netAmountBox = document.getElementById('settlement-net-amount-box');
    netAmountBox.innerHTML = `<div class="info-card-content"><h3>Total Outstanding Revenue</h3><div class="main-value">${totalOutstandingRevenue.toLocaleString()}</div><span class="sub-value">MMK</span><i class="icon fa-solid fa-file-invoice-dollar"></i></div>`;

    // This is what would be due if the month ended today (Total Outstanding - This month's commission)
    const endOfMonthSettlement = totalOutstandingRevenue - commissionThisMonth;
    const monthlyDueBox = document.getElementById('settlement-monthly-due-box');
    monthlyDueBox.innerHTML = `<div class="info-card-content"><h3>End-of-Month Settlement Due</h3><div class="main-value">${endOfMonthSettlement.toLocaleString()}</div><span class="sub-value">MMK</span><i class="icon fa-solid fa-cash-register"></i></div>`;

    const totalProfitThisMonth = commissionThisMonth + extraFareThisMonth;
    const commissionBox = document.getElementById('settlement-commission-box');
    commissionBox.innerHTML = `<div class="info-card-content"><h3>Current Month's Total Profit</h3><div class="main-value">${totalProfitThisMonth.toLocaleString()}</div><span class="sub-value">MMK</span><i class="icon fa-solid fa-hand-holding-dollar"></i></div>`;
}