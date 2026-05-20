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
    formatPaymentMethod,
    isCanceledTicket,
    isFeeEntryRow,
    escapeHtml
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

function normalizePnr(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function money(value) {
    return `MMK ${(Number(value) || 0).toLocaleString()}`;
}

function dateForInput(value) {
    if (!value) return '';
    const d = parseSheetDate(value);
    if (isNaN(d.getTime()) || d.getTime() === 0) return value;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function ticketTotal(ticket) {
    return (Number(ticket.net_amount) || 0) + (Number(ticket.extra_fare) || 0) + (Number(ticket.date_change) || 0);
}



function ownerPayable(ticket) {
    if (isCanceledTicket(ticket)) return 0;
    // Owner payable assumption used in settlement: net/date-change owed owner, commission retained by us.
    return (Number(ticket.net_amount) || 0) + (Number(ticket.date_change) || 0) - (Number(ticket.commission) || 0);
}

function profitAmount(ticket) {
    if (isCanceledTicket(ticket)) return 0;
    return (Number(ticket.commission) || 0) + (Number(ticket.extra_fare) || 0);
}

function getFinancialStatus(ticket) {
    if (isCanceledTicket(ticket)) return { key: 'cancelled', label: 'Cancelled' };
    if (isFeeEntryRow(ticket)) return { key: 'fee', label: 'Fee / Balance' };
    const stored = String(ticket.financial_status || '').trim();
    if (stored) return { key: stored.toLowerCase().replace(/\s+/g, '-'), label: stored };
    if (!(Number(ticket.net_amount) > 0)) return { key: 'pending', label: 'Missing Net' };
    if (!(Number(ticket.commission) > 0)) return { key: 'review', label: 'Need Commission' };
    return { key: 'confirmed', label: 'Financial Confirmed' };
}

function paymentStatus(ticket) {
    if (isCanceledTicket(ticket)) return { key: 'cancelled', label: 'Cancelled' };
    return ticket.paid ? { key: 'paid', label: `Paid${ticket.payment_method ? ` · ${ticket.payment_method}` : ''}` } : { key: 'unpaid', label: 'Unpaid' };
}

function getPnrSummary(tickets) {
    const active = tickets.filter(t => !isCanceledTicket(t));
    const originals = active.filter(t => !isFeeEntryRow(t));
    const fees = active.filter(isFeeEntryRow);
    const totalValue = active.reduce((sum, t) => sum + ticketTotal(t), 0);
    const paidValue = active.filter(t => t.paid).reduce((sum, t) => sum + ticketTotal(t), 0);
    const unpaidValue = totalValue - paidValue;
    const totalProfit = active.reduce((sum, t) => sum + profitAmount(t), 0);
    const totalOwnerPayable = active.reduce((sum, t) => sum + ownerPayable(t), 0);
    const first = originals[0] || active[0] || tickets[0] || {};
    const issues = getManageIssues(tickets);

    return {
        pnr: first.booking_reference || document.getElementById('managePnr')?.value || '',
        route: first.departure && first.destination ? `${first.departure.split(' ')[0]} → ${first.destination.split(' ')[0]}` : '—',
        airline: first.airline || '—',
        travelDate: first.departing_on || '—',
        passengers: originals.length,
        fees: fees.length,
        cancelled: tickets.filter(isCanceledTicket).length,
        totalValue,
        paidValue,
        unpaidValue,
        totalProfit,
        totalOwnerPayable,
        issues
    };
}

function getManageIssues(tickets) {
    const issues = [];
    tickets.forEach(ticket => {
        if (isCanceledTicket(ticket) || isFeeEntryRow(ticket)) return;
        const ref = `${ticket.name || 'Ticket'}${ticket.booking_reference ? ` · ${ticket.booking_reference}` : ''}`;
        if (!(Number(ticket.net_amount) > 0)) issues.push({ tone: 'danger', text: `${ref}: net amount is missing or zero.` });
        if (!(Number(ticket.commission) > 0)) issues.push({ tone: 'warning', text: `${ref}: commission still needs review.` });
        if (ticket.paid && !ticket.paid_date) issues.push({ tone: 'warning', text: `${ref}: marked paid but paid date is missing.` });
        if (ticket.paid && !ticket.payment_method) issues.push({ tone: 'warning', text: `${ref}: marked paid but payment method is missing.` });
        if (ownerPayable(ticket) < 0) issues.push({ tone: 'danger', text: `${ref}: owner payable is negative.` });
    });
    return issues;
}

async function reloadManagePnr(pnr) {
    // Real-time listeners automatically sync state. 
    // Small delay ensures the onSnapshot listener fires and state is updated before re-rendering.
    setTimeout(() => {
        findTicketForManage(pnr);
    }, 250);
}

/**
 * Finds tickets by PNR and displays them in the manage view.
 * @param {string|null} [pnrFromClick=null] Optional PNR passed from a button click.
 */
export function findTicketForManage(pnrFromClick = null) {
    const pnrInput = document.getElementById('managePnr');
    const pnr = normalizePnr(pnrFromClick || pnrInput.value);
    if (!pnr) {
        showToast('Please enter a PNR code.', 'error');
        return;
    }

    pnrInput.value = pnr;

    const found = state.allTickets.filter(t => normalizePnr(t.booking_reference) === pnr);
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
 * Displays the tickets found for a specific PNR.
 * @param {Array<Object>} tickets The tickets to display.
 */
function displayManageResults(tickets) {
    const container = document.getElementById('manageResultsContainer');
    if (tickets.length === 0) {
        renderEmptyState('manageResultsContainer', 'fa-ticket-slash', 'No Tickets Found', `No tickets were found for PNR: ${document.getElementById('managePnr').value}.`);
        return;
    }

    const summary = getPnrSummary(tickets);
    const issueHtml = summary.issues.length
        ? `<div class="manage-issue-list">${summary.issues.slice(0, 5).map(issue => `<div class="manage-issue ${issue.tone}"><i class="fa-solid fa-triangle-exclamation"></i>${issue.text}</div>`).join('')}</div>`
        : `<div class="manage-issue-list"><div class="manage-issue ok"><i class="fa-solid fa-circle-check"></i>No obvious financial review issue for this PNR.</div></div>`;

    let html = `
        <div class="manage-pnr-dashboard">
            <div class="manage-pnr-header">
                <div>
                    <div class="manage-eyebrow">PNR Control Center</div>
                    <h3>${summary.pnr}</h3>
                    <p>${summary.route} · ${summary.airline} · Travel ${formatDateToDMMMY(summary.travelDate) || summary.travelDate}</p>
                </div>
                <div class="manage-header-stats">
                    <span>${summary.passengers} passenger${summary.passengers === 1 ? '' : 's'}</span>
                    <span>${summary.fees} fee/balance row${summary.fees === 1 ? '' : 's'}</span>
                    ${summary.cancelled ? `<span class="is-danger">${summary.cancelled} cancelled</span>` : ''}
                </div>
            </div>
            <div class="manage-kpi-grid">
                <div class="manage-kpi"><span>Total Value</span><strong>${money(summary.totalValue)}</strong><small>Active ticket + fee rows</small></div>
                <div class="manage-kpi ${summary.unpaidValue > 0 ? 'warning' : 'positive'}"><span>Unpaid Balance</span><strong>${money(summary.unpaidValue)}</strong><small>${summary.unpaidValue > 0 ? 'Needs collection' : 'Fully paid'}</small></div>
                <div class="manage-kpi positive"><span>My Profit</span><strong>${money(summary.totalProfit)}</strong><small>Commission + extra fare</small></div>
                <div class="manage-kpi navy"><span>Owner Payable</span><strong>${money(summary.totalOwnerPayable)}</strong><small>Settlement impact</small></div>
            </div>
            ${issueHtml}
        </div>
        <div class="manage-ticket-toolbar">
            <div>
                <strong>Ticket Rows</strong>
                <span>Use focused actions to avoid mixing payment, financial, and refund changes.</span>
            </div>
        </div>
        <div class="table-container manage-table-wrap">
            <table class="manage-table">
                <thead>
                    <tr>
                        <th>Type / Passenger</th>
                        <th>Trip</th>
                        <th>Amount</th>
                        <th>Payment</th>
                        <th>Financial</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    tickets.forEach(t => {
        const isFee = isFeeEntryRow(t);
        const canceled = isCanceledTicket(t);
        const pay = paymentStatus(t);
        const fin = getFinancialStatus(t);
        const route = t.departure && t.destination ? `${t.departure.split(' ')[0]} → ${t.destination.split(' ')[0]}` : '—';
        const rowType = canceled ? 'Cancelled' : isFee ? 'Fee / Balance' : 'Original Ticket';
        const actions = canceled
            ? `<button class="manage-action-btn" data-action="details" data-id="${t.id}"><i class="fa-solid fa-eye"></i> View</button>`
            : isFee
                ? `<button class="manage-action-btn primary manage-btn" data-action="fee" data-id="${t.id}"><i class="fa-solid fa-receipt"></i> Update Fee</button>
                   <button class="manage-action-btn" data-action="payment" data-id="${t.id}"><i class="fa-solid fa-credit-card"></i> Payment</button>`
                : `<button class="manage-action-btn primary" data-action="financial" data-id="${t.id}"><i class="fa-solid fa-sliders"></i> Financials</button>
                   <button class="manage-action-btn" data-action="payment" data-id="${t.id}"><i class="fa-solid fa-credit-card"></i> Payment</button>
                   <button class="manage-action-btn" data-action="add-fee" data-id="${t.id}"><i class="fa-solid fa-plus"></i> Fee</button>
                   <button class="manage-action-btn danger" data-action="cancel" data-id="${t.id}"><i class="fa-solid fa-ban"></i></button>
                   <button class="manage-action-btn" data-action="advanced" data-id="${t.id}"><i class="fa-solid fa-gear"></i></button>`;

        html += `
            <tr class="${canceled ? 'canceled-row' : ''} ${isFee ? 'fee-row' : ''}">
                <td>
                    <span class="manage-row-type ${isFee ? 'fee' : ''}">${rowType}</span>
                    <strong>${escapeHtml(String(t.name || 'Passenger').replace(/\(fees\)\s*$/i, '').trim())}</strong>
                    <small>${t.id_no || ''}</small>
                </td>
            <td>
                <strong>${route}</strong>
                <small>Travel: ${formatDateToDMMMY(t.departing_on) || t.departing_on || '—'} · Issued: ${formatDateToDMMMY(t.issued_date) || t.issued_date || '—'}</small>
            </td>
            <td>
                <strong>${money(ticketTotal(t))}</strong>
                <small>Net ${money(t.net_amount)} · Profit ${money(profitAmount(t))}</small>
            </td>
            <td>
                <span class="manage-status ${pay.key}">${pay.label}</span>
                <small>${t.paid_date ? `Paid date: ${formatDateToDMMMY(t.paid_date) || t.paid_date}` : ''}</small>
            </td>
            <td>
                <span class="manage-status ${fin.key}">${fin.label}</span>
                <small>Owner payable ${money(ownerPayable(t))}</small>
            </td>
            <td><div class="manage-action-row">${actions}</div></td>
        </tr>`;
    });
    container.innerHTML = html + '</tbody></table></div>';

    // Add event listeners after rendering
    container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const docId = e.currentTarget.dataset.id;
            const action = e.currentTarget.dataset.action;

            if (action === 'fee') openFeeManageModal(docId);
            if (action === 'financial') openFinancialModal(docId);
            if (action === 'payment') openPaymentModal(docId);
            if (action === 'add-fee') openAddFeeModal(docId);
            if (action === 'cancel') openCancelSubModal(docId);
            if (action === 'details') openManageDetailsModal(docId);
            if (action === 'advanced') openManageModal(docId);
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
             reloadManagePnr(ticket.booking_reference);
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

        reloadManagePnr(ticket.booking_reference);

    } catch (error) {
        console.error(error);
        showToast('Failed to update.', 'error');
    }
}

function openManageDetailsModal(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
    if (!ticket) return;
    const pay = paymentStatus(ticket);
    const fin = getFinancialStatus(ticket);

    openModal(`
        <h2>Ticket Snapshot</h2>
        <p class="modal-subtitle">${ticket.name} · PNR ${ticket.booking_reference}</p>
        <div class="manage-preview-card">
            <div><span>Status</span><strong>${fin.label}</strong></div>
            <div><span>Payment</span><strong>${pay.label}</strong></div>
            <div><span>Ticket Value</span><strong>${money(ticketTotal(ticket))}</strong></div>
            <div><span>Owner Payable</span><strong>${money(ownerPayable(ticket))}</strong></div>
        </div>
        <div class="details-section">
            <div class="details-section-title">Record Details</div>
            <p><strong>Route:</strong> ${ticket.departure || '—'} → ${ticket.destination || '—'}</p>
            <p><strong>Issued Date:</strong> ${formatDateToDMMMY(ticket.issued_date) || ticket.issued_date || '—'}</p>
            <p><strong>Travel Date:</strong> ${formatDateToDMMMY(ticket.departing_on) || ticket.departing_on || '—'}</p>
            <p><strong>Remarks:</strong> ${ticket.remarks || '—'}</p>
            ${ticket.refund_amount ? `<p><strong>Refund:</strong> ${money(ticket.refund_amount)} via ${ticket.refund_payment_method || '—'}</p>` : ''}
            ${ticket.original_net_amount ? `<p><strong>Original Net:</strong> ${money(ticket.original_net_amount)}</p>` : ''}
        </div>
        <div class="form-actions" style="margin-top: 1.5rem;">
            <button class="btn btn-secondary" id="manageDetailsCloseBtn">Close</button>
        </div>
    `, 'large-modal');
    document.getElementById('manageDetailsCloseBtn').addEventListener('click', closeModal);
}

function openFinancialModal(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
    if (!ticket) return;

    const currentOwnerPayable = ownerPayable(ticket);
    const currentProfit = profitAmount(ticket);
    const defaultFinancialStatus = ticket.financial_status || (!(Number(ticket.net_amount) > 0) ? 'Financial Pending' : !(Number(ticket.commission) > 0) ? 'Needs Review' : 'Financial Confirmed');
    const content = `
        <h2>Update Financials</h2>
        <p class="modal-subtitle">${ticket.name} · PNR ${ticket.booking_reference}</p>
        <div class="manage-preview-card">
            <div><span>Current Profit</span><strong>${money(currentProfit)}</strong></div>
            <div><span>Current Owner Payable</span><strong>${money(currentOwnerPayable)}</strong></div>
        </div>
        <form id="financialUpdateForm" data-id="${docId}">
            <div class="form-grid">
                <div class="form-group"><label for="financial_base_fare">Base Fare</label><input type="number" id="financial_base_fare" value="${Number(ticket.base_fare) || 0}"></div>
                <div class="form-group"><label for="financial_net_amount">Net Amount</label><input type="number" id="financial_net_amount" value="${Number(ticket.net_amount) || 0}"></div>
                <div class="form-group"><label for="financial_commission">Commission</label><input type="number" id="financial_commission" value="${Number(ticket.commission) || 0}"></div>
                <div class="form-group">
                    <label for="financial_status">Financial Status</label>
                    <select id="financial_status">
                        <option value="Financial Pending" ${defaultFinancialStatus === 'Financial Pending' ? 'selected' : ''}>Financial Pending</option>
                        <option value="Needs Review" ${defaultFinancialStatus === 'Needs Review' ? 'selected' : ''}>Needs Review</option>
                        <option value="Financial Confirmed" ${defaultFinancialStatus === 'Financial Confirmed' ? 'selected' : ''}>Financial Confirmed</option>
                    </select>
                </div>
                <div class="form-group full-width">
                    <label for="financial_reason">Reason / Note <span class="req">*</span></label>
                    <textarea id="financial_reason" rows="3" placeholder="Example: commission confirmed by owner, corrected net amount, fare recalculated" required></textarea>
                </div>
            </div>
            <div id="financialImpactPreview" class="manage-impact-preview"></div>
            <div class="form-actions" style="margin-top: 1.5rem;">
                <button type="button" class="btn btn-secondary" id="financialCancelBtn">Cancel</button>
                <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Save Financials</button>
            </div>
        </form>
    `;

    openModal(content, 'large-modal');
    const preview = () => {
        const next = {
            ...ticket,
            base_fare: Number(document.getElementById('financial_base_fare').value) || 0,
            net_amount: Number(document.getElementById('financial_net_amount').value) || 0,
            commission: Number(document.getElementById('financial_commission').value) || 0
        };
        document.getElementById('financialImpactPreview').innerHTML = `
            <div><span>Profit</span><strong>${money(currentProfit)} → ${money(profitAmount(next))}</strong></div>
            <div><span>Owner Payable</span><strong>${money(currentOwnerPayable)} → ${money(ownerPayable(next))}</strong></div>
        `;
    };
    ['financial_base_fare', 'financial_net_amount', 'financial_commission'].forEach(id => {
        document.getElementById(id).addEventListener('input', preview);
    });
    preview();

    document.getElementById('financialCancelBtn').addEventListener('click', closeModal);
    document.getElementById('financialUpdateForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reason = document.getElementById('financial_reason').value.trim();
        if (!reason) {
            showToast('Please add a reason for the financial change.', 'error');
            return;
        }

        const updateData = {
            base_fare: Number(document.getElementById('financial_base_fare').value) || 0,
            net_amount: Number(document.getElementById('financial_net_amount').value) || 0,
            commission: Number(document.getElementById('financial_commission').value) || 0,
            financial_status: document.getElementById('financial_status').value,
            financial_note: reason
        };

        const changes = [];
        if (updateData.base_fare !== (Number(ticket.base_fare) || 0)) changes.push(`Base Fare: ${ticket.base_fare || 0} to ${updateData.base_fare}`);
        if (updateData.net_amount !== (Number(ticket.net_amount) || 0)) changes.push(`Net Amount: ${ticket.net_amount || 0} to ${updateData.net_amount}`);
        if (updateData.commission !== (Number(ticket.commission) || 0)) changes.push(`Commission: ${ticket.commission || 0} to ${updateData.commission}`);
        if (updateData.financial_status !== defaultFinancialStatus) changes.push(`Financial Status: ${defaultFinancialStatus} to ${updateData.financial_status}`);
        if (changes.length === 0) {
            showToast('No financial changes were made.', 'info');
            return;
        }

        try {
            showToast('Updating financials...', 'info');
            await updateTicket(ticket.id, updateData);
            await saveHistory(ticket, `FINANCIAL UPDATE: ${changes.join('; ')}. Reason: ${reason}`);
            showToast('Financials updated.', 'success');
            closeModal();
            await reloadManagePnr(ticket.booking_reference);
        } catch (error) {
            console.error(error);
            showToast('Failed to update financials.', 'error');
        }
    });
}

function openPaymentModal(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
    if (!ticket) return;
    const { method: pmBase, bank: pmBank } = parsePaymentMethod(ticket.payment_method);

    const content = `
        <h2>Record Payment</h2>
        <p class="modal-subtitle">${ticket.name} · ${money(ticketTotal(ticket))} · PNR ${ticket.booking_reference}</p>
        <form id="paymentUpdateForm" data-id="${docId}">
            <div class="form-grid">
                <div class="form-group checkbox-group" style="padding-top: 1.5rem;">
                    <label for="payment_paid">Paid</label>
                    <input type="checkbox" id="payment_paid" ${ticket.paid ? 'checked' : ''} style="width: 20px; height: 20px;">
                </div>
                <div class="form-group">
                    <label for="payment_method">Payment Method</label>
                    <select id="payment_method">
                        <option value="">Select</option>
                        <option value="KBZ Pay" ${pmBase === 'KBZ Pay' ? 'selected' : ''}>KBZ Pay</option>
                        <option value="Mobile Banking" ${pmBase === 'Mobile Banking' ? 'selected' : ''}>Mobile Banking</option>
                        <option value="Aya Pay" ${pmBase === 'Aya Pay' ? 'selected' : ''}>Aya Pay</option>
                        <option value="Cash" ${pmBase === 'Cash' ? 'selected' : ''}>Cash</option>
                    </select>
                </div>
                <div class="form-group"><label for="payment_paid_date">Paid Date</label><input type="text" id="payment_paid_date" value="${dateForInput(ticket.paid_date)}" placeholder="DD/MM/YYYY"></div>
                <div class="form-group"><label for="payment_transaction_id">Transaction ID</label><input type="text" id="payment_transaction_id" value="${ticket.payment_transaction_id || ''}"></div>
                <div class="form-group full-width"><label for="payment_note">Payment Note</label><textarea id="payment_note" rows="3">${ticket.payment_note || ''}</textarea></div>
            </div>
            <div class="form-actions" style="margin-top: 1.5rem;">
                <button type="button" class="btn btn-secondary" id="paymentCancelBtn">Cancel</button>
                <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Save Payment</button>
            </div>
        </form>
    `;

    openModal(content, 'large-modal');
    new Datepicker(document.getElementById('payment_paid_date'), { format: 'dd/mm/yyyy', autohide: true, todayHighlight: true });
    const paidChk = document.getElementById('payment_paid');
    const methodSel = document.getElementById('payment_method');
    const bankSel = enhanceMobileBankingSelect(methodSel, { defaultBank: pmBank });
    const paidDateIn = document.getElementById('payment_paid_date');
    const sync = () => {
        const enabled = paidChk.checked;
        methodSel.disabled = !enabled;
        if (bankSel) bankSel.disabled = !enabled;
        paidDateIn.disabled = !enabled;
        if (enabled && !paidDateIn.value) paidDateIn.value = dateForInput(formatDateForSheet(new Date()));
    };
    paidChk.addEventListener('change', sync);
    sync();
    document.getElementById('paymentCancelBtn').addEventListener('click', closeModal);
    document.getElementById('paymentUpdateForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const paid = paidChk.checked;
        const updateData = {
            paid,
            payment_method: paid ? formatPaymentMethod(methodSel.value, document.getElementById('payment_method_bank')?.value || '') : '',
            paid_date: paid ? formatDateForSheet(paidDateIn.value || new Date()) : '',
            payment_transaction_id: paid ? document.getElementById('payment_transaction_id').value.trim() : '',
            payment_note: document.getElementById('payment_note').value.trim()
        };

        try {
            showToast('Saving payment status...', 'info');
            await updateTicket(ticket.id, updateData);
            await saveHistory(ticket, `PAYMENT UPDATE: ${paid ? `Paid via ${updateData.payment_method || '—'} on ${updateData.paid_date}` : 'Marked unpaid'}`);
            showToast('Payment updated.', 'success');
            closeModal();
            await reloadManagePnr(ticket.booking_reference);
        } catch (error) {
            console.error(error);
            showToast('Failed to update payment.', 'error');
        }
    });
}

function openAddFeeModal(docId) {
    const ticket = state.allTickets.find(t => t.id === docId);
    if (!ticket) return;

    const content = `
        <h2>Add Fee / Extra Fare</h2>
        <p class="modal-subtitle">${ticket.name} · PNR ${ticket.booking_reference}</p>
        <form id="addFeeForm" data-id="${docId}">
            <div class="form-grid">
                <div class="form-group">
                    <label for="new_fee_type">Type</label>
                    <select id="new_fee_type">
                        <option value="Extra Fare">Extra Fare / Profit</option>
                        <option value="Date Change">Date Change Fee</option>
                        <option value="Correction">Correction</option>
                        <option value="Other">Other Fee</option>
                    </select>
                </div>
                <div class="form-group"><label for="new_fee_amount">Amount</label><input type="number" id="new_fee_amount" required></div>
                <div class="form-group checkbox-group" style="padding-top: 1.5rem;">
                    <label for="new_fee_paid">Paid</label>
                    <input type="checkbox" id="new_fee_paid" style="width: 20px; height: 20px;">
                </div>
                <div class="form-group">
                    <label for="new_fee_payment_method">Payment Method</label>
                    <select id="new_fee_payment_method">
                        <option value="">Select</option>
                        <option value="KBZ Pay">KBZ Pay</option>
                        <option value="Mobile Banking">Mobile Banking</option>
                        <option value="Aya Pay">Aya Pay</option>
                        <option value="Cash">Cash</option>
                    </select>
                </div>
                <div class="form-group"><label for="new_fee_paid_date">Paid Date</label><input type="text" id="new_fee_paid_date" placeholder="DD/MM/YYYY"></div>
                <div class="form-group full-width"><label for="new_fee_note">Reason / Note <span class="req">*</span></label><textarea id="new_fee_note" rows="3" required></textarea></div>
            </div>
            <div class="form-actions" style="margin-top: 1.5rem;">
                <button type="button" class="btn btn-secondary" id="addFeeCancelBtn">Cancel</button>
                <button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Update Ticket</button>
            </div>
        </form>
    `;

    openModal(content, 'large-modal');
    new Datepicker(document.getElementById('new_fee_paid_date'), { format: 'dd/mm/yyyy', autohide: true, todayHighlight: true });
    const methodSel = document.getElementById('new_fee_payment_method');
    const bankSel = enhanceMobileBankingSelect(methodSel);
    const paidChk = document.getElementById('new_fee_paid');
    const paidDateIn = document.getElementById('new_fee_paid_date');
    const sync = () => {
        methodSel.disabled = !paidChk.checked;
        if (bankSel) bankSel.disabled = !paidChk.checked;
        paidDateIn.disabled = !paidChk.checked;
        if (paidChk.checked && !paidDateIn.value) paidDateIn.value = dateForInput(formatDateForSheet(new Date()));
    };
    paidChk.addEventListener('change', sync);
    sync();
    document.getElementById('addFeeCancelBtn').addEventListener('click', closeModal);
    document.getElementById('addFeeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const feeType = document.getElementById('new_fee_type').value;
        const amount = Number(document.getElementById('new_fee_amount').value) || 0;
        const note = document.getElementById('new_fee_note').value.trim();
        const paid = paidChk.checked;
        if (amount <= 0) {
            showToast('Fee amount must be greater than zero.', 'error');
            return;
        }
        if (!note) {
            showToast('Please add a reason for this fee.', 'error');
            return;
        }

        const paymentMethod = paid ? formatPaymentMethod(methodSel.value, document.getElementById('new_fee_payment_method_bank')?.value || '') : '';
        const paidDate = paid ? formatDateForSheet(paidDateIn.value || new Date()) : '';
        const isExtraFare = feeType === 'Extra Fare';
        const today = formatDateForSheet(new Date());

        try {
            showToast('Updating ticket...', 'info');
            const updateData = {};
            if (feeType === 'Date Change') {
                updateData.date_change = (Number(ticket.date_change) || 0) + amount;
            } else {
                updateData.extra_fare = (Number(ticket.extra_fare) || 0) + amount;
            }
            // If the new fee is unpaid, mark the whole ticket as unpaid
            if (!paid) {
                updateData.paid = false;
                updateData.paid_date = '';
                updateData.payment_method = '';
            }
            // Append fee note to existing remarks
            const existingRemarks = ticket.remarks || '';
            const feeNote = `${feeType}: ${amount.toLocaleString()} MMK - ${note}`;
            updateData.remarks = existingRemarks ? `${existingRemarks} | ${feeNote}` : feeNote;

            await updateTicket(docId, updateData);
            await saveHistory(ticket, `FEE ADDED: ${feeType} ${amount.toLocaleString()} MMK. Reason: ${note}`);
            showToast('Ticket updated with fee.', 'success');
            closeModal();
            await reloadManagePnr(ticket.booking_reference);
        } catch (error) {
            console.error(error);
            showToast('Failed to update ticket.', 'error');
        }
    });
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
                    payment_note: `Partial payment split from ${ticketTotal(ticket).toLocaleString()} MMK`,
                    remarks: `Partial Pmt (${payAmount.toLocaleString()}) - ${ticket.remarks}`,
                    extra_fare: 0,
                    date_change: 0,
                    split_status: 'partial-paid'
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
                    split_parent_ticket_id: ticket.id,
                    split_status: 'balance-due',
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

        showToast('Payment distributed across PNR successfully.', 'success');
        closeModal();
        reloadManagePnr(ticketsToPay[0].booking_reference);

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
        ticketsToUpdate = state.allTickets.filter(t =>
            normalizePnr(t.booking_reference) === normalizePnr(pnr) &&
            !isFeeEntryRow(t) &&
            !isCanceledTicket(t)
        );
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
            if (baseFareChanged && !isFeeEntryRow(ticket)) updateData.base_fare = newBaseFare;
            if (netAmountChanged && !isFeeEntryRow(ticket)) updateData.net_amount = newNetAmount;
            if (commissionChanged && !isFeeEntryRow(ticket)) updateData.commission = newCommission;
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
        
        reloadManagePnr(pnr);

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
                    status: 'cancelled',
                    cancellation_type: 'Full Refund',
                    cancelled_at: new Date().toISOString(),
                    original_base_fare: ticket.base_fare || 0,
                    original_net_amount: ticket.net_amount || 0,
                    original_commission: ticket.commission || 0,
                    original_extra_fare: ticket.extra_fare || 0,
                    original_date_change: ticket.date_change || 0,
                    base_fare: 0,
                    net_amount: 0,
                    commission: 0,
                    extra_fare: 0,
                    date_change: 0,
                    paid: true,
                    remarks: `Full Refund on ${dateStr}`
                });
                historyDetails = "CANCELED: Full Refund processed.";
            } else {
                await updateTicket(docId, {
                    status: 'cancelled',
                    cancellation_type: 'Partial Cancellation',
                    cancelled_at: new Date().toISOString(),
                    original_base_fare: ticket.base_fare || 0,
                    original_net_amount: ticket.net_amount || 0,
                    original_commission: ticket.commission || 0,
                    original_extra_fare: ticket.extra_fare || 0,
                    original_date_change: ticket.date_change || 0,
                    net_amount: details.cancellationFee,
                    refund_amount: details.refundAmount,
                    refund_payment_method: details.paymentMethod,
                    refund_transaction_id: details.transactionId,
                    refund_date: dateStr,
                    remarks: `Canceled on ${dateStr} with ${details.refundAmount.toLocaleString()} refund`
                });
                historyDetails = `CANCELED: Partial. Refunded: ${details.refundAmount.toLocaleString()} MMK.`;
            }
            
            await saveHistory(ticket, historyDetails);
            
            showToast('Ticket canceled successfully!', 'success');
            closeModal();
            await reloadManagePnr(ticket.booking_reference);
        } catch (error) {
            console.error('Cancel error:', error);
            showToast('Error canceling ticket: ' + error.message, 'error');
        }
    });
}
