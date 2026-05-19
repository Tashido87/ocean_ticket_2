/**
 * @fileoverview Manages ticket modification and cancellation logic.
 * UPDATED: Added smart "Group Partial Payment" (Knock-off logic) for multi-row PNRs.
 */

import {
    state
} from './state.js';
import {
    updateTicket,
    addTickets
} from './db.js';
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

function getTimestampMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (ts.seconds) return ts.seconds * 1000;
    return 0;
}

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
    // Sort by createdAt DESCENDING so the newest fees/splits appear at the top
    found.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
    
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
    return name.includes('(fees)') || remarks.includes('fee entry') || remarks.includes('balance');
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
            actionButton = `<button class="btn ${btnClass} manage-btn" data-id="${t.id}">${btnText}</button>`;
        }

        // --- TYPE & NAME COLUMN ---
        if (isFee) {
            typeLabel = `<span style="color: var(--warning-accent); font-weight: bold;"><i class="fa-solid fa-receipt"></i> Fee / Balance</span><br><span style="font-size: 0.85em; opacity: 0.8;">${t.name}</span>`;
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
            const docId = e.currentTarget.dataset.id;
            const ticket = state.allTickets.find(t => t.id === docId);
            
            if (isFeeRow(ticket)) {
                openFeeManageModal(docId);
            } else {
                openManageModal(docId);
            }
        });
    });
}

/**
 * Opens a SIMPLIFIED modal specifically for managing a Fee/Balance Row.
 */
function openFeeManageModal(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
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
        <h2>Manage Balance / Fee</h2>
        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <p style="margin: 0; font-size: 0.9rem; color: rgba(255,255,255,0.7);">Amount Due / Fee</p>
            <div style="font-size: 1.5rem; font-weight: bold; color: var(--warning-accent);">${feeAmount.toLocaleString()} MMK</div>
            <p style="margin: 5px 0 0; font-size: 0.85rem;">${ticket.name}</p>
        </div>

        <form id="updateFeeForm" data-id="${docId}">
            <div class="form-grid">
                <div class="form-group">
                    <label for="fee_issued_date">Date Added (Issued Date)</label>
                    <input type="text" id="fee_issued_date" value="${issuedDateForInput}" placeholder="DD/MM/YYYY">
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
                    <input type="text" id="fee_paid_date" placeholder="DD/MM/YYYY" value="${paidDateForInput}">
                </div>
            </div>
            
            <div class="form-actions" style="margin-top: 2rem; justify-content: space-between;">
                 <button type="button" class="btn btn-secondary" id="feeDeleteBtn" style="background-color: rgba(248, 81, 73, 0.2); color: #F85149;">Void Entry...</button>
                 <div>
                    <button type="button" class="btn btn-secondary" onclick="import('./ui.js').then(m=>m.closeModal())">Cancel</button>
                    <button type="submit" class="btn btn-primary">Update</button>
                </div>
            </div>
        </form>
    `;

    openModal(content, 'small-modal');
    
    // Init Datepickers
    new Datepicker(document.getElementById('fee_paid_date'), { format: 'dd/mm/yyyy', autohide: true, todayHighlight: true });
    new Datepicker(document.getElementById('fee_issued_date'), { format: 'dd/mm/yyyy', autohide: true, todayHighlight: true });

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
         showConfirmModal('Are you sure you want to <strong>VOID</strong> this entry? This sets the amount to 0.', async () => {
             await updateTicket(docId, {
                 base_fare: 0,
                 net_amount: 0,
                 commission: 0,
                 remarks: 'VOIDED ENTRY',
                 extra_fare: 0,
                 date_change: 0
             });
             
             showToast('Entry voided.', 'success');
             closeModal();
             
             // Refresh data
             state.cache = {};
             const { loadTicketData } = await import('./tickets.js');
             const { updateDashboardData } = await import('./main.js');
             const { updateNotifications } = await import('./ui.js');
             
             await loadTicketData();
             updateDashboardData();
             updateNotifications();
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
    const docId = form.dataset.id;
    const ticket = state.allTickets.find(t => t.id === docId);

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
        showToast('Updating status...', 'info');
        
        await updateTicket(docId, {
            issued_date: formatDateForSheet(newIssuedDate),
            paid: newPaid,
            payment_method: finalMethod,
            paid_date: newDate
        });
        
        showToast('Updated successfully!', 'success');
        closeModal();

        state.cache = {};
        const { loadTicketData } = await import('./tickets.js');
        const { updateDashboardData } = await import('./main.js');
        const { updateNotifications } = await import('./ui.js');

        await loadTicketData();
        updateDashboardData();
        updateNotifications();
        findTicketForManage(ticket.booking_reference);

    } catch (error) {
        console.error(error);
        showToast('Failed to update.', 'error');
    }
}


/**
 * Opens the modal for managing a specific ticket (Original Ticket Logic).
 */
function openManageModal(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
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
        <form id="updateForm" data-pnr="${ticket.booking_reference}" data-master-id="${docId}">
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <h4>Modify Details</h4>
                <div class="toggle-switch-container" style="font-size: 0.85rem;">
                    <label for="update_pnr_sync" style="margin-right: 8px;">Apply to entire PNR?</label>
                    <label class="switch" style="transform: scale(0.8);">
                        <input type="checkbox" id="update_pnr_sync">
                        <span class="slider round"></span>
                    </label>
                </div>
            </div>

            <div class="form-grid" style="margin-top: 1rem;">
                <div class="form-group"><label>New Travel Date</label><input type="text" id="update_departing_on" placeholder="DD/MM/YYYY" value="${travelDateForInput}"></div>
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
                    <input type="text" id="update_paid_date" name="update_paid_date" placeholder="DD/MM/YYYY" value="${paidDateForInput}">
                </div>
            </div>
            <p style="margin: 0.75rem 0 0; color: rgba(255,255,255,0.75); font-size: 0.9rem;">
                <strong>Note:</strong> If "Apply to entire PNR" is unchecked, changes will <strong>only</strong> affect this specific row.
            </p>
            <div class="form-actions" style="margin-top: 2rem; justify-content: space-between;">
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn btn-secondary" id="cancelRefundBtn" style="background-color: rgba(248, 81, 73, 0.2); color: #F85149;">Cancel/Refund...</button>
                    <button type="button" class="btn btn-secondary" id="partialPayBtn" style="background-color: var(--primary-accent); color: white; opacity: 0.8;">Partial Pay...</button>
                </div>
                <div><button type="button" class="btn btn-secondary" id="modalBackBtn">Back</button><button type="submit" class="btn btn-primary">Update</button></div>
            </div>
        </form>`;

    openModal(content, 'large-modal');
    new Datepicker(document.getElementById('update_departing_on'), {
        format: 'dd/mm/yyyy',
        autohide: true,
        todayHighlight: true
    });
    new Datepicker(document.getElementById('update_paid_date'), {
        format: 'dd/mm/yyyy',
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
    document.getElementById('cancelRefundBtn').addEventListener('click', () => openCancelSubModal(docId));
    document.getElementById('partialPayBtn').addEventListener('click', () => openPartialPaymentModal(docId));
    document.getElementById('modalBackBtn').addEventListener('click', closeModal);
}

/**
 * Opens a sub-modal to handle Partial Payment.
 * - If "Apply to entire PNR" is ON: Calculates TOTAL debt for all rows and distributes payment (Knock-off).
 * - If OFF: Handles just the single selected row.
 */
function openPartialPaymentModal(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
    if (!ticket) return;

    // Check the toggle state from the parent modal
    const applyToAll = document.getElementById('update_pnr_sync')?.checked;
    
    // Determine scope
    let ticketsToPay = [];
    if (applyToAll) {
        // Find ALL unpaid non-cancelled tickets for this PNR
        ticketsToPay = state.allTickets.filter(t =>
            t.booking_reference === ticket.booking_reference &&
            !t.paid &&
            !String(t.remarks||'').toLowerCase().includes('cancel') &&
            !String(t.remarks||'').toLowerCase().includes('refund')
        );
        // Sort by createdAt to pay oldest first
        ticketsToPay.sort((a,b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt));
    } else {
        ticketsToPay = [ticket];
    }

    // Calculate total debt for the scope
    const currentTotal = ticketsToPay.reduce((sum, t) => sum + (t.net_amount || 0) + (t.extra_fare || 0) + (t.date_change || 0), 0);
    
    const contextTitle = applyToAll ? `Total PNR Debt (${ticketsToPay.length} tickets)` : 'Single Ticket Debt';

    const content = `
        <h2>Partial Payment</h2>
        <p>Scope: <strong>${contextTitle}</strong></p>
        
        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; margin: 1rem 0;">
            <div style="display:flex; justify-content:space-between; margin-bottom: 5px;">
                <span>Total Amount Due:</span>
                <strong>${currentTotal.toLocaleString()} MMK</strong>
            </div>
        </div>

        <form id="partialPaymentForm">
            <div class="form-grid">
                <div class="form-group">
                    <label for="partial_amount">Amount Paying Now</label>
                    <input type="number" id="partial_amount" placeholder="e.g. 1500000" max="${currentTotal}" required>
                </div>
                <div class="form-group">
                    <label for="partial_payment_method">Payment Method</label>
                    <select id="partial_payment_method" required>
                        <option value="">Select</option>
                        <option value="KBZ Pay">KBZ Pay</option>
                        <option value="Mobile Banking">Mobile Banking</option>
                        <option value="Aya Pay">Aya Pay</option>
                        <option value="Cash">Cash</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="partial_paid_date">Paid Date</label>
                    <input type="text" id="partial_paid_date" placeholder="DD/MM/YYYY">
                </div>
            </div>

            <div id="partial_summary" style="margin-top: 1rem; padding: 1rem; border: 1px dashed rgba(255,255,255,0.3); border-radius: 6px; display: none;">
                <div style="font-size: 0.9rem; margin-bottom: 5px;"><strong>Preview:</strong></div>
                <div style="display:flex; justify-content:space-between; color: var(--success-accent);">
                    <span>Paying Now (Paid):</span>
                    <span id="preview_pay">0</span>
                </div>
                <div style="display:flex; justify-content:space-between; color: var(--danger-accent);">
                    <span>Remaining (Unpaid):</span>
                    <span id="preview_remain">0</span>
                </div>
            </div>

            <div class="form-actions" style="margin-top: 2rem;">
                <button type="button" class="btn btn-secondary" onclick="import('./ui.js').then(m=>m.closeModal())">Cancel</button>
                <button type="submit" class="btn btn-primary">Confirm Payment</button>
            </div>
        </form>
    `;

    openModal(content);
    
    // Init Datepicker
    new Datepicker(document.getElementById('partial_paid_date'), { format: 'dd/mm/yyyy', autohide: true, todayHighlight: true });
    
    // Auto-set date to today
    const today = new Date();
    document.getElementById('partial_paid_date').value = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    // Enhance Select
    enhanceMobileBankingSelect(document.getElementById('partial_payment_method'));

    // Live Calculation
    const amtInput = document.getElementById('partial_amount');
    const summary = document.getElementById('partial_summary');
    const previewPay = document.getElementById('preview_pay');
    const previewRemain = document.getElementById('preview_remain');

    amtInput.addEventListener('input', () => {
        const val = parseFloat(amtInput.value) || 0;
        if (val > 0) {
            summary.style.display = 'block';
            previewPay.textContent = val.toLocaleString() + ' MMK';
            const rem = currentTotal - val;
            previewRemain.textContent = rem.toLocaleString() + ' MMK';
        } else {
            summary.style.display = 'none';
        }
    });

    document.getElementById('partialPaymentForm').addEventListener('submit', (e) => handlePartialPayment(e, ticketsToPay, currentTotal));
}

/**
 * Executes the partial payment logic.
 * Supports "Knock-off" logic for multiple tickets.
 */
async function handlePartialPayment(e, ticketsToPay, totalDebt) {
    e.preventDefault();
    let payAmount = parseFloat(document.getElementById('partial_amount').value);
    
    if (payAmount <= 0 || payAmount >= totalDebt) {
        showToast('Partial amount must be greater than 0 and less than total.', 'error');
        return;
    }

    const payMethod = formatPaymentMethod(
        document.getElementById('partial_payment_method').value,
        document.getElementById('partial_payment_method_bank')?.value || ''
    );
    const payDate = formatDateForSheet(document.getElementById('partial_paid_date').value);

    try {
        showToast('Processing payment distribution...', 'info');

        const updates = [];
        const newRows = [];
        
        // --- KNOCK-OFF LOGIC ---
        for (const ticket of ticketsToPay) {
            if (payAmount <= 0) break;

            const ticketTotal = (ticket.net_amount || 0) + (ticket.extra_fare || 0) + (ticket.date_change || 0);
            
            if (payAmount >= ticketTotal) {
                updates.push(updateTicket(ticket.id, {
                    paid: true,
                    payment_method: payMethod,
                    paid_date: payDate
                }));
                payAmount -= ticketTotal;
            } else {
                const remainder = ticketTotal - payAmount;
                const ratio = payAmount / ticketTotal;
                const part1_Base = Math.floor((ticket.base_fare || 0) * ratio);
                const part1_Comm = Math.floor((ticket.commission || 0) * ratio);
                const part2_Base = (ticket.base_fare || 0) - part1_Base;
                const part2_Comm = (ticket.commission || 0) - part1_Comm;

                updates.push(updateTicket(ticket.id, {
                    base_fare: part1_Base,
                    net_amount: payAmount,
                    commission: part1_Comm,
                    paid: true,
                    payment_method: payMethod,
                    paid_date: payDate,
                    remarks: `Partial Pmt (${payAmount.toLocaleString()}) - ${ticket.remarks}`,
                    extra_fare: 0,
                    date_change: 0
                }));

                newRows.push({
                    issued_date: ticket.issued_date,
                    name: `${ticket.name} (Balance)`,
                    id_no: ticket.id_no,
                    phone: ticket.phone,
                    account_name: ticket.account_name,
                    account_type: ticket.account_type,
                    account_link: ticket.account_link,
                    departure: ticket.departure,
                    destination: ticket.destination,
                    departing_on: ticket.departing_on,
                    airline: ticket.airline,
                    base_fare: part2_Base,
                    booking_reference: ticket.booking_reference,
                    net_amount: remainder,
                    paid: false,
                    payment_method: '',
                    paid_date: '',
                    commission: part2_Comm,
                    remarks: `Balance Due (${remainder.toLocaleString()})`,
                    extra_fare: 0,
                    date_change: 0,
                    gender: ticket.gender
                });

                payAmount = 0;
            }
        }

        await Promise.all(updates);
        if (newRows.length > 0) {
            await addTickets(newRows);
        }

        const { loadTicketData } = await import('./tickets.js');
        const { updateDashboardData } = await import('./main.js');
        const { updateNotifications } = await import('./ui.js');

        showToast('Payment distributed across PNR successfully.', 'success');
        closeModal();

        await loadTicketData();
        updateDashboardData();
        updateNotifications();
        findTicketForManage(ticketsToPay[0].booking_reference);

    } catch (error) {
        console.error(error);
        showToast('Error processing split: ' + error.message, 'error');
    }
}


/**
 * Handles the ticket update form submission.
 */
async function handleUpdateTicket(e) {
    e.preventDefault();
    const form = e.target;
    const pnr = form.dataset.pnr;
    const masterId = form.dataset.masterId;
    const applyToAll = document.getElementById('update_pnr_sync')?.checked;

    let historyDetails = [];
    
    // Determine which tickets we are updating
    let ticketsToUpdate = [];
    if (applyToAll) {
        ticketsToUpdate = state.allTickets.filter(t => t.booking_reference === pnr);
    } else {
        // Only the specific row we opened the modal for
        const single = state.allTickets.find(t => t.id === masterId);
        if (single) ticketsToUpdate = [single];
    }
    
    if (ticketsToUpdate.length === 0) return;

    // Use the specific row as the "master" for comparison logic
    const masterTicket = state.allTickets.find(t => t.id === masterId) || ticketsToUpdate[0];

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

    const originalPaid = !!masterTicket.paid;
    const originalMethod = String(masterTicket.payment_method || '').trim();
    const originalPaidDate = originalPaid ? formatDateForSheet(masterTicket.paid_date || '') : '';

    const finalPaid = newPaidStatus;
    const finalPaymentMethod = finalPaid ? (newPaymentMethod || originalMethod) : '';
    const finalPaidDate = finalPaid
        ? (newPaidDate ? formatDateForSheet(newPaidDate) : (originalPaidDate || formatDateForSheet(new Date())))
        : '';

    const hasNewFees = dateChangeFees > 0 || extraFare > 0;

    // Detect exactly what the user changed relative to the opened ticket
    const dateChanged = newTravelDateVal && parseSheetDate(newTravelDateVal).getTime() !== parseSheetDate(masterTicket.departing_on).getTime();
    const baseFareChanged = !isNaN(newBaseFare) && newBaseFare !== masterTicket.base_fare;
    const netAmountChanged = !isNaN(newNetAmount) && newNetAmount !== masterTicket.net_amount;
    const commissionChanged = !isNaN(newCommission) && newCommission !== masterTicket.commission;
    const paidChanged = finalPaid !== originalPaid;
    const methodChanged = finalPaymentMethod !== originalMethod;
    const paidDateChanged = finalPaidDate !== originalPaidDate;

    if (dateChanged) historyDetails.push(`Travel Date: ${masterTicket.departing_on} to ${newTravelDateVal}`);
    if (baseFareChanged) historyDetails.push(`Base Fare: ${masterTicket.base_fare} to ${newBaseFare}`);
    if (netAmountChanged) historyDetails.push(`Net Amount: ${masterTicket.net_amount} to ${newNetAmount}`);
    if (commissionChanged) historyDetails.push(`Commission: ${masterTicket.commission} to ${newCommission}`);

    if (dateChangeFees > 0) historyDetails.push(`Date Change Fees Added: ${dateChangeFees}`);
    if (extraFare > 0) historyDetails.push(`Extra Fare Added: ${extraFare}`);

    if (!hasNewFees) {
        if (paidChanged) historyDetails.push(`Payment: ${originalPaid ? 'Paid' : 'Unpaid'} to ${finalPaid ? 'Paid' : 'Unpaid'}`);
        if (methodChanged) {
            historyDetails.push(`Payment Method: ${originalMethod || '—'} to ${finalPaymentMethod || '—'}`);
        }
        if (paidDateChanged) {
            historyDetails.push(`Paid Date: ${originalPaidDate || '—'} to ${finalPaidDate || '—'}`);
        }
    }

    if (historyDetails.length === 0) {
        showToast('No changes were made.', 'info');
        return;
    }

    try {
        showToast('Updating tickets...', 'info');

        // 1. UPDATE SELECTED TICKET(S)
        for (const ticket of ticketsToUpdate) {
            const rowPaid = hasNewFees ? ticket.paid : (paidChanged ? finalPaid : ticket.paid);
            const rowMethod = hasNewFees ? ticket.payment_method : (methodChanged ? finalPaymentMethod : ticket.payment_method);
            const rowPaidDate = hasNewFees ? ticket.paid_date : (paidDateChanged ? finalPaidDate : ticket.paid_date);
            
            const updateData = {};
            if (dateChanged) updateData.departing_on = formatDateForSheet(newTravelDateVal);
            if (baseFareChanged && !isFeeRow(ticket)) updateData.base_fare = newBaseFare;
            if (netAmountChanged && !isFeeRow(ticket)) updateData.net_amount = newNetAmount;
            if (commissionChanged && !isFeeRow(ticket)) updateData.commission = newCommission;
            if (paidChanged || hasNewFees) updateData.paid = rowPaid;
            if (methodChanged || hasNewFees) updateData.payment_method = rowMethod;
            if (paidDateChanged || hasNewFees) updateData.paid_date = rowPaidDate;

            if (Object.keys(updateData).length > 0) {
                await updateTicket(ticket.id, updateData);
            }
        }

        // 2. CREATE NEW ROW FOR FEES (If any)
        if (hasNewFees) {
            const today = formatDateForSheet(new Date());
            const feePaidDate = finalPaid ? (newPaidDate ? formatDateForSheet(newPaidDate) : today) : '';
            
            await addTickets([{
                issued_date: today,
                name: `${masterTicket.name} (Fees)`,
                id_no: masterTicket.id_no,
                phone: masterTicket.phone,
                account_name: masterTicket.account_name,
                account_type: masterTicket.account_type,
                account_link: masterTicket.account_link,
                departure: masterTicket.departure,
                destination: masterTicket.destination,
                departing_on: newTravelDateVal ? formatDateForSheet(newTravelDateVal) : masterTicket.departing_on,
                airline: masterTicket.airline,
                base_fare: 0,
                booking_reference: masterTicket.booking_reference,
                net_amount: extraFare + dateChangeFees,
                paid: finalPaid,
                payment_method: finalPaymentMethod,
                paid_date: feePaidDate,
                commission: extraFare,
                remarks: 'Fee Entry',
                extra_fare: 0,
                date_change: 0,
                gender: masterTicket.gender
            }]);
        }

        await saveHistory(masterTicket, `MODIFIED: ${historyDetails.join('; ')}`);

        showToast('Updated successfully!', 'success');
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
function openCancelSubModal(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
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
    document.getElementById('fullRefundBtn').addEventListener('click', () => handleCancelTicket(docId, 'refund'));
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
        handleCancelTicket(docId, 'cancel', details);
    });
    document.getElementById('backToModifyBtn').addEventListener('click', () => openManageModal(docId));
}

/**
 * Processes the cancellation or refund of a ticket.
 */
async function handleCancelTicket(docId, type, details = {}) {
    const ticket = state.allTickets.find(t => t.id === docId);
    if (!ticket) return;

    const message = type === 'refund' ? `Process a <strong>Full Refund</strong> for ${ticket.name}?` : `Process <strong>Partial Cancellation</strong> for ${ticket.name}?`;

    showConfirmModal(message, async () => {
        const dateStr = formatDateForSheet(new Date());
        let historyDetails;

        try {
            showToast('Processing cancellation...', 'info');
            
            if (type === 'refund') {
                await updateTicket(docId, {
                    base_fare: 0,
                    net_amount: 0,
                    commission: 0,
                    remarks: `Full Refund on ${dateStr}`
                });
                historyDetails = "CANCELED: Full Refund processed.";
            } else {
                await updateTicket(docId, {
                    net_amount: details.cancellationFee,
                    remarks: `Canceled on ${dateStr} with ${details.refundAmount.toLocaleString()} refund`
                });
                historyDetails = `CANCELED: Partial. Refunded: ${details.refundAmount.toLocaleString()} MMK.`;
            }
            
            await saveHistory(ticket, historyDetails);
            
            showToast('Ticket canceled successfully!', 'success');
            closeModal();
            clearManageResults();

            const { loadTicketData } = await import('./tickets.js');
            const { updateDashboardData } = await import('./main.js');
            const { loadHistory } = await import('./history.js');
            const { updateNotifications } = await import('./ui.js');

            await Promise.all([loadTicketData(), loadHistory()]);
            updateDashboardData();
            updateNotifications();
        } catch (error) {
            console.error('Cancel error:', error);
            showToast('Error canceling ticket: ' + error.message, 'error');
        }
    });
}
