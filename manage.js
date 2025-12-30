/**
 * @fileoverview Manages ticket modification and cancellation logic.
 */

import {
    CONFIG
} from './config.js';
import {
    state
} from './state.js';
import {
    batchUpdateSheet,
    updateSheet,
    appendToSheet
} from './api.js';
import {
    showToast,
    parseSheetDate,
    renderEmptyState,
    formatDateForSheet,
    formatDateToDMMMY,
    parsePaymentMethod,
    formatPaymentMethod
} from './utils.js';
import {
    openModal,
    closeModal,
    showConfirmModal,
    enhanceMobileBankingSelect
} from './ui.js';
import {
    saveHistory,
    displayHistory
} from './history.js';

/**
 * Finds tickets by PNR and displays them in the manage view.
 * @param {string|null} [pnrFromClick=null] Optional PNR passed from a button click.
 */
export function findTicketForManage(pnrFromClick = null) {
    const pnrInput = document.getElementById('managePnr');
    const pnr = pnrFromClick || pnrInput.value.toUpperCase();
    if (!pnr) {
        showToast('Please enter a PNR code.', 'error');
        return;
    }

    if (pnrFromClick) {
        pnrInput.value = pnr;
    }

    const found = state.allTickets.filter(t => t.booking_reference === pnr);
    displayManageResults(found);

    const pnrHistory = state.history.filter(entry => entry.pnr === pnr);
    displayHistory(1, pnrHistory);
}

/**
 * Clears the manage ticket view results and resets the input.
 */
export function clearManageResults() {
    document.getElementById('managePnr').value = '';
    document.getElementById('manageResultsContainer').innerHTML = '';
    displayHistory(1, state.history); // Reset to show all history
}

/**
 * Displays the tickets found for a specific PNR.
 * @param {Array<Object>} tickets The tickets to display.
 */
function displayManageResults(tickets) {
    const container = document.getElementById('manageResultsContainer');
    if (tickets.length === 0) {
        renderEmptyState('manageResultsContainer', 'fa-ticket-slash', 'No Tickets Found', `No tickets were found for PNR: ${document.getElementById('managePnr').value}.`);
        return;
    }
    let html = `<div class="table-container"><table><thead><tr><th>Name</th><th>Route</th><th>Travel Date</th><th>Status / Action</th></tr></thead><tbody>`;

    const remarkCheck = (r) => {
        if (!r) return false;
        const lowerRemark = r.toLowerCase();
        return lowerRemark.includes('refund') || lowerRemark.includes('cancel');
    };

    tickets.forEach(t => {
        let actionButton = '';
        if (remarkCheck(t.remarks)) {
            actionButton = `<button class="btn btn-secondary" disabled>Refunded</button>`;
        } else {
            actionButton = `<button class="btn btn-primary manage-btn" data-row-index="${t.rowIndex}">Manage</button>`;
        }
        html += `<tr><td>${t.name}</td><td>${t.departure.split(' ')[0]}→${t.destination.split(' ')[0]}</td><td>${t.departing_on}</td><td>${actionButton}</td></tr>`;
    });
    container.innerHTML = html + '</tbody></table></div>';

    // Add event listeners after rendering
    container.querySelectorAll('.manage-btn').forEach(btn => {
        btn.addEventListener('click', (e) => openManageModal(parseInt(e.currentTarget.dataset.rowIndex)));
    });
}

/**
 * Opens the modal for managing a specific ticket.
 * @param {number} rowIndex The row index of the ticket.
 */
function openManageModal(rowIndex) {
    const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);
    if (!ticket) {
        showToast('Ticket not found.', 'error');
        return;
    }

    // Support stored values like: "Mobile Banking (KBZ Special)"
    const { method: pmBase, bank: pmBank } = parsePaymentMethod(ticket.payment_method);

    let travelDateForInput = '';
    if (ticket.departing_on) {
        const d = parseSheetDate(ticket.departing_on);
        if (!isNaN(d.getTime()) && d.getTime() !== 0) {
            travelDateForInput = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
        }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const travelDate = parseSheetDate(ticket.departing_on);
    const isPast = travelDate < today;

    // Paid date (prefill)
    let paidDateForInput = '';
    if (ticket.paid_date) {
        const pd = parseSheetDate(ticket.paid_date);
        if (!isNaN(pd.getTime()) && pd.getTime() !== 0) {
            paidDateForInput = `${String(pd.getMonth() + 1).padStart(2, '0')}/${String(pd.getDate()).padStart(2, '0')}/${pd.getFullYear()}`;
        } else {
            paidDateForInput = ticket.paid_date;
        }
    }

    const content = `
        <h2>Manage Ticket: ${ticket.name}</h2>
        <form id="updateForm" data-pnr="${ticket.booking_reference}" data-master-row-index="${rowIndex}">
            <h4>Modify Details</h4>
            <div class="form-grid" style="margin-top: 1rem;">
                <div class="form-group"><label>New Travel Date (for all in PNR)</label><input type="text" id="update_departing_on" placeholder="MM/DD/YYYY" value="${travelDateForInput}" ${isPast ? 'disabled' : ''}></div>
                <div class="form-group"><label>New Base Fare</label><input type="number" id="update_base_fare" placeholder="${(ticket.base_fare||0).toLocaleString()}"></div>
                <div class="form-group"><label>New Net Amount</label><input type="number" id="update_net_amount" placeholder="${(ticket.net_amount||0).toLocaleString()}"></div>
                <div class="form-group"><label>New Commission</label><input type="number" id="update_commission" placeholder="${(ticket.commission||0).toLocaleString()}"></div>
                <div class="form-group"><label>Date Change Fees</label><input type="number" id="date_change_fees"></div>
                <div class="form-group"><label>Extra Fare (Adds to existing)</label><input type="number" id="update_extra_fare"></div>
            </div>
            <hr style="border-color: rgba(255,255,255,0.2); margin: 1.5rem 0;">
            <h4>Payment</h4>
            <div class="form-grid" style="margin-top: 1rem;">
                <div class="form-group checkbox-group" style="padding-top: 1.5rem;">
                    <label for="update_paid">Paid</label>
                    <input type="checkbox" id="update_paid" name="update_paid" ${ticket.paid ? 'checked' : ''} style="width: 20px; height: 20px; -webkit-appearance: checkbox; appearance: checkbox;">
                </div>
                <div class="form-group">
                    <label for="update_payment_method">Payment Method</label>
                    <select id="update_payment_method" name="update_payment_method">
                        <option value="">Select</option>
                        <option value="KBZ Pay" ${pmBase === 'KBZ Pay' ? 'selected' : ''}>KBZ Pay</option>
                        <option value="Mobile Banking" ${pmBase === 'Mobile Banking' ? 'selected' : ''}>Mobile Banking</option>
                        <option value="Aya Pay" ${pmBase === 'Aya Pay' ? 'selected' : ''}>Aya Pay</option>
                        <option value="Cash" ${pmBase === 'Cash' ? 'selected' : ''}>Cash</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="update_paid_date">Paid Date</label>
                    <input type="text" id="update_paid_date" name="update_paid_date" placeholder="MM/DD/YYYY" value="${paidDateForInput}">
                </div>
            </div>
            <p style="margin: 0.75rem 0 0; color: rgba(255,255,255,0.75); font-size: 0.9rem;">
                Update paid status, method, and date (same as Sell Ticket). If unpaid, method/date will be cleared.
            </p>
            <div class="form-actions" style="margin-top: 2rem; justify-content: space-between;">
                <div><button type="button" class="btn btn-secondary" id="cancelRefundBtn" style="background-color: rgba(248, 81, 73, 0.2); color: #F85149;">Cancel/Refund...</button></div>
                <div><button type="button" class="btn btn-secondary" id="modalBackBtn">Back</button><button type="submit" class="btn btn-primary">Update Ticket(s)</button></div>
            </div>
        </form>`;

    openModal(content, 'large-modal');
    new Datepicker(document.getElementById('update_departing_on'), {
        format: 'mm/dd/yyyy',
        autohide: true,
        todayHighlight: true
    });
    new Datepicker(document.getElementById('update_paid_date'), {
        format: 'mm/dd/yyyy',
        autohide: true,
        todayHighlight: true
    });

    // Disable method/date when unpaid (keeps UI consistent with Sell Ticket)
    const paidChk = document.getElementById('update_paid');
    const methodSel = document.getElementById('update_payment_method');
    const bankSel = methodSel ? enhanceMobileBankingSelect(methodSel, { defaultBank: pmBank }) : null;
    const paidDateIn = document.getElementById('update_paid_date');
    const syncPaymentFields = () => {
        const enabled = !!paidChk?.checked;
        if (methodSel) methodSel.disabled = !enabled;
        if (bankSel) bankSel.disabled = !enabled;
        if (paidDateIn) paidDateIn.disabled = !enabled;
    };
    paidChk?.addEventListener('change', syncPaymentFields);
    syncPaymentFields();
    document.getElementById('updateForm').addEventListener('submit', handleUpdateTicket);
    document.getElementById('cancelRefundBtn').addEventListener('click', () => openCancelSubModal(rowIndex));
    document.getElementById('modalBackBtn').addEventListener('click', closeModal);
}

/**
 * Handles the ticket update form submission.
 * UPDATED: When adding fees, the 'Paid' status only applies to the new fee row.
 * The original ticket's payment status is preserved.
 */
async function handleUpdateTicket(e) {
    e.preventDefault();
    const form = e.target;
    const pnr = form.dataset.pnr;
    let historyDetails = [];

    const ticketsToUpdate = state.allTickets.filter(t => t.booking_reference === pnr);
    const originalTicket = ticketsToUpdate[0];

    // Collect new values
    const newTravelDateVal = document.getElementById('update_departing_on').value;
    const newBaseFare = parseFloat(document.getElementById('update_base_fare').value);
    const newNetAmount = parseFloat(document.getElementById('update_net_amount').value);
    const newCommission = parseFloat(document.getElementById('update_commission').value);

    // Financial Add-ons
    const dateChangeFees = parseFloat(document.getElementById('date_change_fees').value) || 0;
    const extraFare = parseFloat(document.getElementById('update_extra_fare').value) || 0;

    const newPaidStatus = !!document.getElementById('update_paid')?.checked;
    const newPaymentMethod = formatPaymentMethod(
        (document.getElementById('update_payment_method')?.value || '').trim(),
        (document.getElementById('update_payment_method_bank')?.value || '').trim()
    );
    const newPaidDate = (document.getElementById('update_paid_date')?.value || '').trim();

    // Final values (for the form's target)
    const originalPaid = !!originalTicket.paid;
    const originalMethod = String(originalTicket.payment_method || '').trim();
    const originalPaidDate = originalPaid ? formatDateForSheet(originalTicket.paid_date || '') : '';

    const finalPaid = newPaidStatus;
    const finalPaymentMethod = finalPaid ? (newPaymentMethod || originalMethod) : '';
    const finalPaidDate = finalPaid
        ? (newPaidDate ? formatDateForSheet(newPaidDate) : (originalPaidDate || formatDateForSheet(new Date())))
        : '';

    // --- LOGIC CHECK: ARE WE ADDING FEES? ---
    const hasNewFees = dateChangeFees > 0 || extraFare > 0;

    // Build history log
    if (newTravelDateVal && parseSheetDate(newTravelDateVal).getTime() !== parseSheetDate(originalTicket.departing_on).getTime()) historyDetails.push(`Travel Date: ${originalTicket.departing_on} to ${newTravelDateVal}`);
    if (!isNaN(newBaseFare) && newBaseFare !== originalTicket.base_fare) historyDetails.push(`Base Fare: ${originalTicket.base_fare} to ${newBaseFare}`);
    if (!isNaN(newNetAmount) && newNetAmount !== originalTicket.net_amount) historyDetails.push(`Net Amount: ${originalTicket.net_amount} to ${newNetAmount}`);
    if (!isNaN(newCommission) && newCommission !== originalTicket.commission) historyDetails.push(`Commission: ${originalTicket.commission} to ${newCommission}`);

    // Log fees
    if (dateChangeFees > 0) historyDetails.push(`Date Change Fees Added: ${dateChangeFees}`);
    if (extraFare > 0) historyDetails.push(`Extra Fare Added: ${extraFare}`);

    // Only log payment changes if we are NOT adding fees (since we aren't changing the original ticket's payment)
    if (!hasNewFees) {
        if (finalPaid !== originalPaid) historyDetails.push(`Payment: ${originalPaid ? 'Paid' : 'Unpaid'} to ${finalPaid ? 'Paid' : 'Unpaid'}`);
        if (finalPaymentMethod !== (finalPaid ? originalMethod : '')) {
            historyDetails.push(`Payment Method: ${originalMethod || '—'} to ${finalPaymentMethod || '—'}`);
        }
        if (finalPaidDate !== (finalPaid ? originalPaidDate : '')) {
            historyDetails.push(`Paid Date: ${originalPaidDate || '—'} to ${finalPaidDate || '—'}`);
        }
    }

    if (historyDetails.length === 0) {
        showToast('No changes were made.', 'info');
        return;
    }

    try {
        showToast('Updating tickets...', 'info');

        // 1. UPDATE ORIGINAL TICKET 
        const dataForBatchUpdate = ticketsToUpdate.map(ticket => {
            // [LOGIC FIXED HERE]
            // If hasNewFees is true, we assume the form inputs (Paid/Unpaid) are for the FEE row.
            // So we KEEP the original ticket's existing payment status.
            const rowPaid = hasNewFees ? ticket.paid : finalPaid;
            const rowMethod = hasNewFees ? ticket.payment_method : finalPaymentMethod;
            const rowPaidDate = hasNewFees ? ticket.paid_date : finalPaidDate;

            const values = [
                ticket.issued_date, 
                ticket.name,
                ticket.id_no,
                ticket.phone,
                ticket.account_name,
                ticket.account_type,
                ticket.account_link,
                ticket.departure,
                ticket.destination,
                newTravelDateVal ? formatDateForSheet(newTravelDateVal) : ticket.departing_on, 
                ticket.airline,
                !isNaN(newBaseFare) ? newBaseFare : ticket.base_fare,
                ticket.booking_reference,
                !isNaN(newNetAmount) ? newNetAmount : ticket.net_amount,
                rowPaid,           // Uses the logic above
                rowMethod,         // Uses the logic above
                rowPaidDate,       // Uses the logic above
                !isNaN(newCommission) ? newCommission : ticket.commission,
                ticket.remarks,
                ticket.extra_fare, // Keep existing, new one goes to new row
                ticket.date_change, // Keep existing, new one goes to new row
                ticket.gender
            ];
            return {
                range: `${CONFIG.SHEET_NAME}!A${ticket.rowIndex}:V${ticket.rowIndex}`,
                values: [values]
            };
        });

        await batchUpdateSheet(dataForBatchUpdate);

        // 2. CREATE NEW ROW FOR FEES (If any)
        if (hasNewFees) {
            const today = formatDateForSheet(new Date());
            // The NEW row gets the form's payment status
            const feePaidDate = finalPaid ? (newPaidDate ? formatDateForSheet(newPaidDate) : today) : '';
            
            const feeRow = [
                today, // Issued Date = TODAY
                `${originalTicket.name} (Fees)`, // Name with suffix
                originalTicket.id_no,
                originalTicket.phone,
                originalTicket.account_name,
                originalTicket.account_type,
                originalTicket.account_link,
                originalTicket.departure,
                originalTicket.destination,
                newTravelDateVal ? formatDateForSheet(newTravelDateVal) : originalTicket.departing_on,
                originalTicket.airline,
                0, // Base Fare 0
                originalTicket.booking_reference,
                0, // Net Amount 0 (We use the fee columns below)
                finalPaid,          // <-- This uses the form status (Unpaid if unchecked)
                finalPaymentMethod,
                feePaidDate,
                0, // Commission 0
                "Fee Entry", // Remarks
                extraFare,      // Place Extra Fare here
                dateChangeFees, // Place Date Change Fee here
                originalTicket.gender
            ];

            await appendToSheet(`${CONFIG.SHEET_NAME}!A:V`, [feeRow]);
        }

        await saveHistory(originalTicket, `MODIFIED: ${historyDetails.join('; ')}`);

        // Refresh Data
        state.cache['ticketData'] = null;
        state.cache['historyData'] = null;
        showToast('Tickets updated and fees recorded successfully!', 'success');
        closeModal();
        clearManageResults();

        // Reload modules via dynamic import to avoid circular dependencies
        const { loadTicketData } = await import('./tickets.js');
        const { updateDashboardData } = await import('./main.js');
        const { loadHistory } = await import('./history.js');
        await Promise.all([loadTicketData(), loadHistory()]);
        updateDashboardData();

    } catch (error) {
        console.error(error);
        showToast("Error updating ticket: " + (error.message || error), "error");
    }
}

/**
 * Opens a sub-modal for cancellation and refund options.
 * @param {number} rowIndex The row index of the ticket.
 */
function openCancelSubModal(rowIndex) {
    const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);
    if (!ticket) return;

    const content = `
        <h2>Cancel or Refund Ticket</h2>
        <p>For <strong>${ticket.name}</strong> (PNR: ${ticket.booking_reference})</p>
        <div class="form-actions" style="flex-direction: column; gap: 1rem; margin-top: 1.5rem;">
            <button type="button" class="btn btn-primary" id="fullRefundBtn" style="background-color: var(--danger-accent); border-color: var(--danger-accent);">Process Full Refund</button>
        </div>
        <hr style="border-color: rgba(255,255,255,0.2); margin: 1.5rem 0;">
        <h4>Partial Cancellation</h4>
        <form id="cancelForm" style="width: 100%;">
            <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="form-group"><label for="cancellation_fee">Cancellation Fee</label><input type="number" id="cancellation_fee" required></div>
                <div class="form-group"><label for="refund_amount">Refund Amount</label><input type="number" id="refund_amount" required></div>
                <div class="form-group"><label for="refund_payment_method">Refund Method</label><select id="refund_payment_method" required><option value="" disabled selected>Select</option><option>KBZ Pay</option><option>Mobile Banking</option><option>Aya Pay</option><option>Cash</option></select></div>
                <div class="form-group"><label for="refund_transaction_id">Transaction ID</label><input type="text" id="refund_transaction_id"></div>
            </div>
            <button type="submit" class="btn btn-secondary" style="width: 100%; margin-top: 1rem;">Process Partial Cancellation</button>
        </form>
        <div class="form-actions" style="margin-top: 2rem;"><button class="btn btn-secondary" id="backToModifyBtn">Back to Modify</button></div>`;
    openModal(content);
    const refundMethodSel = document.getElementById('refund_payment_method');
    if (refundMethodSel) enhanceMobileBankingSelect(refundMethodSel);
    document.getElementById('fullRefundBtn').addEventListener('click', () => handleCancelTicket(rowIndex, 'refund'));
    document.getElementById('cancelForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const details = {
            cancellationFee: parseFloat(document.getElementById('cancellation_fee').value),
            refundAmount: parseFloat(document.getElementById('refund_amount').value),
            paymentMethod: formatPaymentMethod(
                document.getElementById('refund_payment_method').value,
                document.getElementById('refund_payment_method_bank')?.value || ''
            ),
            transactionId: document.getElementById('refund_transaction_id').value
        };
        handleCancelTicket(rowIndex, 'cancel', details);
    });
    document.getElementById('backToModifyBtn').addEventListener('click', () => openManageModal(rowIndex));
}

/**
 * Processes the cancellation or refund of a ticket.
 * @param {number} rowIndex The row index of the ticket.
 * @param {string} type The type of action ('refund' or 'cancel').
 * @param {Object} [details={}] Additional details for partial cancellation.
 */
async function handleCancelTicket(rowIndex, type, details = {}) {
    const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);
    if (!ticket) return;

    const message = type === 'refund' ? `Process a <strong>Full Refund</strong> for ${ticket.name}?` : `Process <strong>Partial Cancellation</strong> for ${ticket.name}?`;

    showConfirmModal(message, async () => {
        let updatedValues, historyDetails;
        const dateStr = formatDateForSheet(new Date());

        if (type === 'refund') {
            updatedValues = [...Object.values(ticket).slice(0, 22)]; // Create a copy
            updatedValues[11] = 0; // base_fare
            updatedValues[13] = 0; // net_amount
            updatedValues[17] = 0; // commission
            updatedValues[18] = `Full Refund on ${dateStr}`; // remarks
            historyDetails = "CANCELED: Full Refund processed.";
        } else {
            updatedValues = [...Object.values(ticket).slice(0, 22)];
            updatedValues[13] = details.cancellationFee; // net_amount
            updatedValues[18] = `Canceled on ${dateStr} with ${details.refundAmount.toLocaleString()} refund`; // remarks
            historyDetails = `CANCELED: Partial. Refunded: ${details.refundAmount.toLocaleString()} MMK.`;
        }

        try {
            showToast('Processing cancellation...', 'info');
            await updateSheet(`${CONFIG.SHEET_NAME}!A${rowIndex}:V${rowIndex}`, [updatedValues]);
            await saveHistory(ticket, historyDetails);
            state.cache['ticketData'] = null;
            state.cache['historyData'] = null;
            showToast('Ticket canceled successfully!', 'success');
            closeModal();
            clearManageResults();

            // MODIFIED: Use dynamic imports for reloading data to break circular dependency
            const { loadTicketData } = await import('./tickets.js');
            const { updateDashboardData } = await import('./main.js');
            const { loadHistory } = await import('./history.js');
            await Promise.all([loadTicketData(), loadHistory()]);
            updateDashboardData();
        } catch (error) {
            // Error handled by api.js
        }
    });
}