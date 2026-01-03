/**
 * @fileoverview Manages ticket modification and cancellation logic.
 * UPDATED: Forces Notification Panel to refresh immediately after updates.
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
    // Sort by Row Index DESCENDING so the newest fees appear at the top
    found.sort((a, b) => b.rowIndex - a.rowIndex);
    
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
 * Helper to identify if a row is a Fee Entry.
 * @param {Object} t Ticket object
 */
function isFeeRow(t) {
    const name = String(t.name || '').toLowerCase();
    const remarks = String(t.remarks || '').toLowerCase();
    // Check for "(Fees)" suffix or specific remark
    return name.includes('(fees)') || remarks.includes('fee entry');
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

    let html = `<div class="table-container"><table><thead><tr><th>Type / Name</th><th>Detail / Amount</th><th>Date Info</th><th>Status / Action</th></tr></thead><tbody>`;

    const remarkCheck = (r) => {
        if (!r) return false;
        const lowerRemark = r.toLowerCase();
        return lowerRemark.includes('refund') || lowerRemark.includes('cancel');
    };

    tickets.forEach(t => {
        let actionButton = '';
        let typeLabel = '';
        let detailLabel = '';
        let dateLabel = '';
        let rowClass = '';

        const isFee = isFeeRow(t);
        
        // Calculate the specific amount for this row
        const rowValue = (t.net_amount || 0) + (t.extra_fare || 0) + (t.date_change || 0);

        if (remarkCheck(t.remarks)) {
            actionButton = `<button class="btn btn-secondary" disabled>Refunded</button>`;
            rowClass = 'style="opacity: 0.6;"';
        } else {
            const btnText = isFee ? 'Update Fee' : 'Manage';
            const btnClass = isFee ? 'btn-secondary' : 'btn-primary';
            actionButton = `<button class="btn ${btnClass} manage-btn" data-row-index="${t.rowIndex}">${btnText}</button>`;
        }

        // --- TYPE & NAME COLUMN ---
        if (isFee) {
            typeLabel = `<span style="color: var(--warning-accent); font-weight: bold;"><i class="fa-solid fa-receipt"></i> Fee Entry</span><br><span style="font-size: 0.85em; opacity: 0.8;">${t.name}</span>`;
            detailLabel = `<span style="font-weight: bold;">${rowValue.toLocaleString()} MMK</span>`;
            
            // For FEES: Show "Added On" date primarily
            dateLabel = `<span style="font-weight:bold; color:var(--text-secondary);"><i class="fa-solid fa-calendar-plus"></i> Added: ${t.issued_date}</span><br><span style="font-size:0.8em; opacity:0.6;">Travel: ${t.departing_on}</span>`;
        } else {
            typeLabel = `<span style="font-weight: bold; color: var(--primary-accent);"><i class="fa-solid fa-ticket"></i> Original Ticket</span><br><span style="font-size: 0.85em;">${t.name}</span>`;
            const route = `${t.departure.split(' ')[0]}→${t.destination.split(' ')[0]}`;
            detailLabel = `${route}`;
            
            // For ORIGINAL: Show Travel Date primarily
            dateLabel = `<span style="font-weight: bold;">${t.departing_on}</span>`;
        }
        
        // --- PAYMENT BADGE ---
        const paymentBadge = t.paid 
            ? `<span style="color: var(--success-accent); font-size: 0.8em; display: inline-block; margin-top: 4px;"><i class="fa-solid fa-check"></i> Paid</span>`
            : `<span style="color: var(--danger-accent); font-size: 0.8em; display: inline-block; margin-top: 4px;"><i class="fa-solid fa-xmark"></i> Unpaid</span>`;

        html += `<tr ${rowClass}>
            <td>${typeLabel}</td>
            <td>${detailLabel}</td>
            <td>${dateLabel}<br>${paymentBadge}</td>
            <td>${actionButton}</td>
        </tr>`;
    });
    container.innerHTML = html + '</tbody></table></div>';

    // Add event listeners after rendering
    container.querySelectorAll('.manage-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const rowIndex = parseInt(e.currentTarget.dataset.rowIndex);
            const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);
            
            if (isFeeRow(ticket)) {
                openFeeManageModal(rowIndex);
            } else {
                openManageModal(rowIndex);
            }
        });
    });
}

/**
 * Opens a SIMPLIFIED modal specifically for managing a Fee Row.
 */
function openFeeManageModal(rowIndex) {
    const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);
    if (!ticket) return;

    const feeAmount = (ticket.net_amount || 0) + (ticket.extra_fare || 0) + (ticket.date_change || 0);
    const { method: pmBase, bank: pmBank } = parsePaymentMethod(ticket.payment_method);
    
    // Parse Paid Date
    let paidDateForInput = '';
    if (ticket.paid_date) {
        const pd = parseSheetDate(ticket.paid_date);
        if (!isNaN(pd.getTime()) && pd.getTime() !== 0) {
            paidDateForInput = `${String(pd.getMonth() + 1).padStart(2, '0')}/${String(pd.getDate()).padStart(2, '0')}/${pd.getFullYear()}`;
        } else {
            paidDateForInput = ticket.paid_date;
        }
    }
    
    // Parse Issued Date
    let issuedDateForInput = ticket.issued_date || '';
    const id = parseSheetDate(ticket.issued_date);
    if (!isNaN(id.getTime()) && id.getTime() !== 0) {
        issuedDateForInput = `${String(id.getMonth() + 1).padStart(2, '0')}/${String(id.getDate()).padStart(2, '0')}/${id.getFullYear()}`;
    }

    const content = `
        <h2>Manage Fee Entry</h2>
        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <p style="margin: 0; font-size: 0.9rem; color: rgba(255,255,255,0.7);">Fee Amount</p>
            <div style="font-size: 1.5rem; font-weight: bold; color: var(--warning-accent);">${feeAmount.toLocaleString()} MMK</div>
            <p style="margin: 5px 0 0; font-size: 0.85rem;">${ticket.name}</p>
        </div>

        <form id="updateFeeForm" data-row-index="${rowIndex}">
            <div class="form-grid">
                <div class="form-group">
                    <label for="fee_issued_date">Date Added (Issued Date)</label>
                    <input type="text" id="fee_issued_date" value="${issuedDateForInput}" placeholder="MM/DD/YYYY">
                    <small style="color: rgba(255,255,255,0.5); font-size: 0.75rem;">Modify this to distinguish from other fees.</small>
                </div>
            </div>

            <h4 style="margin-top: 1.5rem;">Payment Status</h4>
            <div class="form-grid" style="margin-top: 1rem;">
                <div class="form-group checkbox-group" style="padding-top: 1.5rem;">
                    <label for="fee_paid">Paid</label>
                    <input type="checkbox" id="fee_paid" ${ticket.paid ? 'checked' : ''} style="width: 20px; height: 20px;">
                </div>
                <div class="form-group">
                    <label for="fee_payment_method">Payment Method</label>
                    <select id="fee_payment_method">
                        <option value="">Select</option>
                        <option value="KBZ Pay" ${pmBase === 'KBZ Pay' ? 'selected' : ''}>KBZ Pay</option>
                        <option value="Mobile Banking" ${pmBase === 'Mobile Banking' ? 'selected' : ''}>Mobile Banking</option>
                        <option value="Aya Pay" ${pmBase === 'Aya Pay' ? 'selected' : ''}>Aya Pay</option>
                        <option value="Cash" ${pmBase === 'Cash' ? 'selected' : ''}>Cash</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="fee_paid_date">Paid Date</label>
                    <input type="text" id="fee_paid_date" placeholder="MM/DD/YYYY" value="${paidDateForInput}">
                </div>
            </div>
            
            <div class="form-actions" style="margin-top: 2rem; justify-content: space-between;">
                 <button type="button" class="btn btn-secondary" id="feeDeleteBtn" style="background-color: rgba(248, 81, 73, 0.2); color: #F85149;">Void Fee...</button>
                 <div>
                    <button type="button" class="btn btn-secondary" onclick="import('./ui.js').then(m=>m.closeModal())">Cancel</button>
                    <button type="submit" class="btn btn-primary">Update Fee</button>
                </div>
            </div>
        </form>
    `;

    openModal(content, 'small-modal');
    
    // Init Datepickers
    new Datepicker(document.getElementById('fee_paid_date'), { format: 'mm/dd/yyyy', autohide: true, todayHighlight: true });
    new Datepicker(document.getElementById('fee_issued_date'), { format: 'mm/dd/yyyy', autohide: true, todayHighlight: true });

    const paidChk = document.getElementById('fee_paid');
    const methodSel = document.getElementById('fee_payment_method');
    const bankSel = methodSel ? enhanceMobileBankingSelect(methodSel, { defaultBank: pmBank }) : null;
    const paidDateIn = document.getElementById('fee_paid_date');

    const syncPaymentFields = () => {
        const enabled = !!paidChk?.checked;
        if (methodSel) methodSel.disabled = !enabled;
        if (bankSel) bankSel.disabled = !enabled;
        if (paidDateIn) paidDateIn.disabled = !enabled;
        
        if (enabled && !paidDateIn.value) {
            const today = new Date();
            paidDateIn.value = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
        }
    };
    paidChk.addEventListener('change', syncPaymentFields);
    syncPaymentFields();

    document.getElementById('updateFeeForm').addEventListener('submit', handleUpdateFeeRow);
    
    document.getElementById('feeDeleteBtn').addEventListener('click', () => {
         showConfirmModal('Are you sure you want to <strong>VOID</strong> this fee entry? This sets the amount to 0.', async () => {
             const voidRow = [...Object.values(ticket).slice(0, 22)];
             voidRow[11] = 0; // Base Fare
             voidRow[13] = 0; // Net Amount
             voidRow[17] = 0; // Commission
             voidRow[18] = "VOIDED FEE"; // Remarks
             voidRow[19] = 0; // Extra Fare
             voidRow[20] = 0; // Date Change
             
             await updateSheet(`${CONFIG.SHEET_NAME}!A${rowIndex}:V${rowIndex}`, [voidRow]);
             
             showToast('Fee entry voided.', 'success');
             closeModal();
             const { loadTicketData } = await import('./tickets.js');
             const { updateDashboardData } = await import('./main.js');
             const { updateNotifications } = await import('./ui.js');
             
             await loadTicketData();
             updateDashboardData();
             updateNotifications(); // FORCE UI UPDATE
             findTicketForManage(ticket.booking_reference);
         });
    });
}

/**
 * Handles updating a Fee Row.
 */
async function handleUpdateFeeRow(e) {
    e.preventDefault();
    const form = e.target;
    const rowIndex = parseInt(form.dataset.rowIndex);
    const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);

    const newIssuedDate = document.getElementById('fee_issued_date').value || ticket.issued_date;
    const newPaid = document.getElementById('fee_paid').checked;
    const newMethod = formatPaymentMethod(
        document.getElementById('fee_payment_method').value,
        document.getElementById('fee_payment_method_bank')?.value || ''
    );
    const newDateVal = document.getElementById('fee_paid_date').value;
    const newDate = newPaid ? (newDateVal ? formatDateForSheet(newDateVal) : formatDateForSheet(new Date())) : '';
    const finalMethod = newPaid ? newMethod : '';

    try {
        showToast('Updating fee status...', 'info');
        
        const updatedRow = [
                formatDateForSheet(newIssuedDate), 
                ticket.name,
                ticket.id_no,
                ticket.phone,
                ticket.account_name,
                ticket.account_type,
                ticket.account_link,
                ticket.departure,
                ticket.destination,
                ticket.departing_on, 
                ticket.airline,
                ticket.base_fare,
                ticket.booking_reference,
                ticket.net_amount,
                newPaid,           
                finalMethod,       
                newDate,           
                ticket.commission,
                ticket.remarks,
                ticket.extra_fare, 
                ticket.date_change,
                ticket.gender
        ];

        await updateSheet(`${CONFIG.SHEET_NAME}!A${rowIndex}:V${rowIndex}`, [updatedRow]);
        
        showToast('Fee payment updated!', 'success');
        closeModal();

        const { loadTicketData } = await import('./tickets.js');
        const { updateDashboardData } = await import('./main.js');
        const { updateNotifications } = await import('./ui.js');

        await loadTicketData();
        updateDashboardData();
        updateNotifications(); // FORCE UI UPDATE
        findTicketForManage(ticket.booking_reference);

    } catch (error) {
        console.error(error);
        showToast('Failed to update fee.', 'error');
    }
}


/**
 * Opens the modal for managing a specific ticket (Original Ticket Logic).
 */
function openManageModal(rowIndex) {
    const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);
    if (!ticket) {
        showToast('Ticket not found.', 'error');
        return;
    }

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
                <div class="form-group"><label>ADD Date Change Fees</label><input type="number" id="date_change_fees" placeholder="Creates new fee row"></div>
                <div class="form-group"><label>ADD Extra Fare</label><input type="number" id="update_extra_fare" placeholder="Creates new fee row"></div>
            </div>
            <hr style="border-color: rgba(255,255,255,0.2); margin: 1.5rem 0;">
            <h4>Payment (Main Ticket)</h4>
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
                <strong>Note:</strong> If you add fees above, the "Paid" status selected here will apply to the <strong>NEW FEE</strong> entry. The original ticket status will remain unchanged.
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
 */
async function handleUpdateTicket(e) {
    e.preventDefault();
    const form = e.target;
    const pnr = form.dataset.pnr;
    let historyDetails = [];

    const ticketsToUpdate = state.allTickets.filter(t => t.booking_reference === pnr);
    const originalTicket = ticketsToUpdate[0];

    const newTravelDateVal = document.getElementById('update_departing_on').value;
    const newBaseFare = parseFloat(document.getElementById('update_base_fare').value);
    const newNetAmount = parseFloat(document.getElementById('update_net_amount').value);
    const newCommission = parseFloat(document.getElementById('update_commission').value);

    const dateChangeFees = parseFloat(document.getElementById('date_change_fees').value) || 0;
    const extraFare = parseFloat(document.getElementById('update_extra_fare').value) || 0;

    const newPaidStatus = !!document.getElementById('update_paid')?.checked;
    const newPaymentMethod = formatPaymentMethod(
        (document.getElementById('update_payment_method')?.value || '').trim(),
        (document.getElementById('update_payment_method_bank')?.value || '').trim()
    );
    const newPaidDate = (document.getElementById('update_paid_date')?.value || '').trim();

    const originalPaid = !!originalTicket.paid;
    const originalMethod = String(originalTicket.payment_method || '').trim();
    const originalPaidDate = originalPaid ? formatDateForSheet(originalTicket.paid_date || '') : '';

    const finalPaid = newPaidStatus;
    const finalPaymentMethod = finalPaid ? (newPaymentMethod || originalMethod) : '';
    const finalPaidDate = finalPaid
        ? (newPaidDate ? formatDateForSheet(newPaidDate) : (originalPaidDate || formatDateForSheet(new Date())))
        : '';

    const hasNewFees = dateChangeFees > 0 || extraFare > 0;

    if (newTravelDateVal && parseSheetDate(newTravelDateVal).getTime() !== parseSheetDate(originalTicket.departing_on).getTime()) historyDetails.push(`Travel Date: ${originalTicket.departing_on} to ${newTravelDateVal}`);
    if (!isNaN(newBaseFare) && newBaseFare !== originalTicket.base_fare) historyDetails.push(`Base Fare: ${originalTicket.base_fare} to ${newBaseFare}`);
    if (!isNaN(newNetAmount) && newNetAmount !== originalTicket.net_amount) historyDetails.push(`Net Amount: ${originalTicket.net_amount} to ${newNetAmount}`);
    if (!isNaN(newCommission) && newCommission !== originalTicket.commission) historyDetails.push(`Commission: ${originalTicket.commission} to ${newCommission}`);

    if (dateChangeFees > 0) historyDetails.push(`Date Change Fees Added: ${dateChangeFees}`);
    if (extraFare > 0) historyDetails.push(`Extra Fare Added: ${extraFare}`);

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
                !isNaN(newBaseFare) && !isFeeRow(ticket) ? newBaseFare : ticket.base_fare,
                ticket.booking_reference,
                !isNaN(newNetAmount) && !isFeeRow(ticket) ? newNetAmount : ticket.net_amount,
                rowPaid,           
                rowMethod,         
                rowPaidDate,       
                !isNaN(newCommission) && !isFeeRow(ticket) ? newCommission : ticket.commission,
                ticket.remarks,
                ticket.extra_fare, 
                ticket.date_change,
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

        state.cache['ticketData'] = null;
        state.cache['historyData'] = null;
        showToast('Tickets updated and fees recorded successfully!', 'success');
        closeModal();
        
        const { loadTicketData } = await import('./tickets.js');
        const { updateDashboardData } = await import('./main.js');
        const { loadHistory } = await import('./history.js');
        const { updateNotifications } = await import('./ui.js');

        await Promise.all([loadTicketData(), loadHistory()]);
        updateDashboardData();
        updateNotifications(); // FORCE UI UPDATE
        findTicketForManage(pnr);

    } catch (error) {
        console.error(error);
        showToast("Error updating ticket: " + (error.message || error), "error");
    }
}

/**
 * Opens a sub-modal for cancellation and refund options.
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
 */
async function handleCancelTicket(rowIndex, type, details = {}) {
    const ticket = state.allTickets.find(t => t.rowIndex === rowIndex);
    if (!ticket) return;

    const message = type === 'refund' ? `Process a <strong>Full Refund</strong> for ${ticket.name}?` : `Process <strong>Partial Cancellation</strong> for ${ticket.name}?`;

    showConfirmModal(message, async () => {
        let updatedValues, historyDetails;
        const dateStr = formatDateForSheet(new Date());

        if (type === 'refund') {
            updatedValues = [...Object.values(ticket).slice(0, 22)]; 
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

            const { loadTicketData } = await import('./tickets.js');
            const { updateDashboardData } = await import('./main.js');
            const { loadHistory } = await import('./history.js');
            const { updateNotifications } = await import('./ui.js');

            await Promise.all([loadTicketData(), loadHistory()]);
            updateDashboardData();
            updateNotifications(); // FORCE UI UPDATE
        } catch (error) {
            // Error handled by api.js
        }
    });
}
