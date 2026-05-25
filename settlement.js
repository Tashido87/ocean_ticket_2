/**
 * @fileoverview Owner Settlement Dashboard.
 *
 * Financial formula assumptions (preserved from existing app logic):
 *   - `net_amount`     : ticket net price (excluding the agent commission cut)
 *   - `commission`     : agent's commission (already calculated as agent-cut via calculateAgentCut)
 *   - `extra_fare`     : extra mark-up agent keeps (agent profit, not owner's)
 *   - `date_change`    : date-change fee charged to customer (belongs to owner)
 *   - `paid` (bool)    : retained on ticket records but not used as a client receivable metric here
 *
 * Helpers (single source of truth — do NOT scatter formulas):
 *   - getTicketGrossAmount(t)    = net_amount + date_change + extra_fare   (ticket sale value)
 *   - getTicketOwnerPayable(t)   = (net_amount + date_change) - commission (owner's share)
 *   - getMyCommission(t)         = commission                              (agent commission)
 *   - getExtraProfit(t)          = extra_fare                              (assumed agent profit)
 *   - getTicketAgentProfit(t)    = commission + extra_fare                 (agent's share)
 *
 * Refund/cancel tickets (remarks contain "cancel" or "refund") are treated as Excluded.
 * Fee-entry rows (name endsWith "(Fees)" or remarks contains "fee entry") are excluded.
 *
 * Settlement closing balance:
 *   closing = opening + ownerPayable(period) + adjustmentsNet(period) - paidToOwner(period)
 *
 * Owner payable is based on tickets sold/issued from the owner, not client receivables.
 */

import { state } from './state.js';
import {
    getSettlements,
    addSettlement,
    updateSettlement,
    deleteSettlement,
    getClosedPeriods,
    addClosedPeriod,
    deleteClosedPeriod,
    getAdjustments,
    addAdjustment,
    deleteAdjustment
} from './db.js';
import {
    showToast,
    parseSheetDate,
    formatDateToDDMMMYYYY,
    formatDateToDMMMY,
    formatPaymentMethod,
    parsePaymentMethod,
    formatDateForSheet,
    renderAirlineName
} from './utils.js';
import { openModal, closeModal, setupGenericPagination } from './ui.js';

/* ============================================================
   MODULE STATE
   ============================================================ */

const ui = {
    basis: 'issued',        // legacy UI preference; owner payable is calculated on issued/sold tickets
    period: 'month',        // 'today' | 'month' | 'lastMonth' | 'custom'
    customStart: null,
    customEnd: null,
    ledgerSearch: '',
    ticketStatusFilter: 'all',
    recordsPage: 1,
    rowsPerRecordsPage: 10
};

const HEALTHY_DUE_DAYS = 21; // due is "old" if last settlement is older than this
const STORAGE_KEY = 'oceanSettlementUI';

function persistUiState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ basis: ui.basis, period: ui.period })); } catch {}
}
function loadUiState() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (raw.basis === 'issued' || raw.basis === 'cash') ui.basis = 'issued';
        if (['today', 'month', 'lastMonth', 'custom'].includes(raw.period)) ui.period = raw.period;
    } catch {}
}

/* ============================================================
   GENERIC HELPERS
   ============================================================ */

export function formatMMK(amount) {
    const n = Math.round(Number(amount || 0));
    const sign = n < 0 ? '-' : '';
    return `${sign}MMK ${Math.abs(n).toLocaleString('en-US')}`;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function isFeeEntry(t) {
    const name = String(t?.name || '');
    const remarks = String(t?.remarks || '').toLowerCase();
    return /\(fees\)\s*$/i.test(name) || remarks.includes('fee entry');
}

function isCanceled(t) {
    const r = String(t?.remarks || '').toLowerCase();
    return r.includes('cancel') || r.includes('refund');
}

function isExcluded(t) {
    return isFeeEntry(t) || isCanceled(t);
}

function n(v) { return Number(v || 0); }

/* ============================================================
   TICKET FINANCIAL HELPERS
   ============================================================ */

export function getTicketGrossAmount(t) {
    return n(t.net_amount) + n(t.date_change) + n(t.extra_fare);
}

export const getTicketCustomerCharge = getTicketGrossAmount;

export function getMyCommission(t) {
    return n(t.commission);
}

export function getExtraProfit(t) {
    return n(t.extra_fare);
}

export function getTicketOwnerPayable(t) {
    // Assumption: extra_fare is retained as agent profit; date_change belongs to owner.
    return (n(t.net_amount) + n(t.date_change)) - getMyCommission(t);
}

export function getTicketAgentProfit(t) {
    return getMyCommission(t) + getExtraProfit(t);
}

export function getTicketCollectedAmount(t) {
    return getTicketGrossAmount(t);
}

/* ============================================================
   PERIOD RANGE
   ============================================================ */

export function getSettlementPeriodRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (ui.period === 'today') {
        return { start, end };
    }
    if (ui.period === 'month') {
        return {
            start: new Date(now.getFullYear(), now.getMonth(), 1),
            end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        };
    }
    if (ui.period === 'lastMonth') {
        return {
            start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
            end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
        };
    }
    if (ui.period === 'custom' && ui.customStart && ui.customEnd) {
        const s = new Date(ui.customStart);
        const e = new Date(ui.customEnd);
        e.setHours(23, 59, 59, 999);
        return { start: s, end: e };
    }
    // Default fallback: this month
    return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    };
}

function inRange(date, start, end) {
    if (!date) return false;
    const t = date instanceof Date ? date.getTime() : parseSheetDate(date).getTime();
    if (!t || Number.isNaN(t)) return false;
    return t >= start.getTime() && t <= end.getTime();
}

/* ============================================================
   AGGREGATIONS
   ============================================================ */

/**
 * Returns the cumulative opening balance up to (but not including) the start date,
 * across all tickets/settlements/adjustments, using the selected basis.
 */
export function getOpeningBalance(start) {
    const tickets = state.allTickets.filter(t => !isExcluded(t));
    let ownerPayable = 0;
    tickets.forEach(t => {
        const d = parseSheetDate(t.issued_date);
        if (!d.getTime() || d.getTime() >= start.getTime()) return;
        ownerPayable += getTicketOwnerPayable(t);
    });

    (state.allHotels || []).forEach(h => {
        const d = parseSheetDate(h.checkin);
        if (!d.getTime() || d.getTime() >= start.getTime()) return;
        ownerPayable += n(h.net_amount);
    });

    let paidToOwner = 0;
    state.allSettlements.forEach(s => {
        const d = parseSheetDate(s.settlement_date);
        if (!d.getTime() || d.getTime() >= start.getTime()) return;
        paidToOwner += n(s.amount_paid);
    });

    let adjustments = 0;
    state.allAdjustments.forEach(a => {
        const d = parseSheetDate(a.adjustment_date);
        if (!d.getTime() || d.getTime() >= start.getTime()) return;
        adjustments += adjustmentSignedAmount(a);
    });

    return ownerPayable + adjustments - paidToOwner;
}

function adjustmentSignedAmount(a) {
    const amt = n(a.amount);
    if (a.type === 'Owner Debit' || a.type === 'Refund') return amt;     // adds to payable
    if (a.type === 'Owner Credit' || a.type === 'Correction') return -amt; // reduces payable
    return amt; // 'Other' defaults to positive
}

/**
 * Comprehensive settlement summary for the active range/basis.
 */
export function getSettlementSummary() {
    const { start, end } = getSettlementPeriodRange();
    const tickets = state.allTickets.filter(t => !isExcluded(t));

    let ticketSalesTotal = 0;
    let ownerPayable = 0;
    let myCommission = 0;
    let extraProfit = 0;
    const periodTickets = [];

    tickets.forEach(t => {
        const issued = parseSheetDate(t.issued_date);
        if (!issued.getTime()) return;
        const inP = inRange(issued, start, end);
        if (!inP) return;

        periodTickets.push(t);

        ticketSalesTotal += getTicketGrossAmount(t);
        ownerPayable += getTicketOwnerPayable(t);
        myCommission += getMyCommission(t);
        extraProfit += getExtraProfit(t);
    });

    (state.allHotels || []).forEach(h => {
        const checkin = parseSheetDate(h.checkin);
        if (!checkin.getTime()) return;
        const inP = inRange(checkin, start, end);
        if (!inP) return;

        ticketSalesTotal += n(h.base_fare);
        ownerPayable += n(h.net_amount);
        myCommission += n(h.commission);
    });

    const periodSettlements = state.allSettlements.filter(s => inRange(parseSheetDate(s.settlement_date), start, end));
    const paidToOwner = periodSettlements.reduce((sum, s) => sum + n(s.amount_paid), 0);

    const periodAdjustments = state.allAdjustments.filter(a => inRange(parseSheetDate(a.adjustment_date), start, end));
    const adjustmentsTotal = periodAdjustments.reduce((sum, a) => sum + adjustmentSignedAmount(a), 0);

    const opening = getOpeningBalance(start);
    const closing = opening + ownerPayable + adjustmentsTotal - paidToOwner;

    const pendingSettlements = state.allSettlements.filter(s => (s.status || 'Paid') !== 'Verified');

    return {
        start, end,
        basis: ui.basis,
        opening,
        ticketSalesTotal,
        ownerPayable,
        paidToOwner,
        remainingDue: opening + ownerPayable + adjustmentsTotal - paidToOwner,
        myCommission,
        extraProfit,
        myProfit: myCommission + extraProfit,
        adjustmentsTotal,
        closing,
        periodTickets,
        periodSettlements,
        periodAdjustments,
        pendingSettlements
    };
}

/* ============================================================
   LEDGER ROWS
   ============================================================ */

export function getOwnerLedgerRows() {
    const { start, end } = getSettlementPeriodRange();
    const rows = [];

    state.allTickets.forEach(t => {
        if (isExcluded(t)) return;
        const issued = parseSheetDate(t.issued_date);
        if (!issued.getTime() || !inRange(issued, start, end)) return;

        const ownerPayable = getTicketOwnerPayable(t);

        if (n(t.net_amount) > 0) {
            rows.push({
                date: issued,
                type: 'Ticket Sale',
                ref: t.booking_reference || '—',
                client: t.name || '—',
                description: `${(t.departure || '').split(' ')[0]} → ${(t.destination || '').split(' ')[0]} · ${t.airline || ''}`,
                ticketAmount: n(t.net_amount),
                ownerPayable,
                paidToOwner: 0,
                agentProfit: getTicketAgentProfit(t),
                meta: { kind: 'ticket', ticketId: t.id, pnr: t.booking_reference }
            });
        }
        if (n(t.date_change) > 0 && !canceled) {
            rows.push({
                date: issued,
                type: 'Date Change Fee',
                ref: t.booking_reference || '—',
                client: t.name || '—',
                description: 'Date change fee',
                ticketAmount: n(t.date_change),
                ownerPayable: n(t.date_change),
                paidToOwner: 0,
                agentProfit: 0,
                meta: { kind: 'date_change', ticketId: t.id }
            });
        }
        if (n(t.extra_fare) > 0 && !canceled) {
            rows.push({
                date: issued,
                type: 'Extra Fare',
                ref: t.booking_reference || '—',
                client: t.name || '—',
                description: 'Agent extra fare (profit)',
                ticketAmount: n(t.extra_fare),
                ownerPayable: 0,
                paidToOwner: 0,
                agentProfit: n(t.extra_fare),
                meta: { kind: 'extra_fare', ticketId: t.id }
            });
        }
    });

    (state.allHotels || []).forEach(h => {
        const checkin = parseSheetDate(h.checkin);
        if (!checkin.getTime() || !inRange(checkin, start, end)) return;

        rows.push({
            date: checkin,
            type: 'Hotel Booking',
            ref: h.booking_ref || '—',
            client: h.client_name || '—',
            description: `${h.hotel_name} (${h.city}, ${h.country})`,
            ticketAmount: n(h.base_fare),
            ownerPayable: n(h.net_amount),
            paidToOwner: 0,
            agentProfit: n(h.commission),
            meta: { kind: 'hotel', hotelId: h.id, pnr: h.booking_ref }
        });
    });

    state.allSettlements.forEach(s => {
        const d = parseSheetDate(s.settlement_date);
        if (!d.getTime() || !inRange(d, start, end)) return;
        rows.push({
            date: d,
            type: 'Settlement Payment',
            ref: s.transaction_id || s.id?.slice(0, 6) || '—',
            client: '— (Owner)',
            description: `Paid via ${s.payment_method || '—'}`,
            ticketAmount: 0,
            ownerPayable: 0,
            paidToOwner: n(s.amount_paid),
            agentProfit: 0,
            meta: { kind: 'settlement', id: s.id }
        });
    });

    state.allAdjustments.forEach(a => {
        const d = parseSheetDate(a.adjustment_date);
        if (!d.getTime() || !inRange(d, start, end)) return;
        const signed = adjustmentSignedAmount(a);
        rows.push({
            date: d,
            type: `Adjustment · ${a.type || 'Other'}`,
            ref: a.id?.slice(0, 6) || '—',
            client: a.reason || '—',
            description: a.notes || '',
            ticketAmount: 0,
            ownerPayable: signed,
            paidToOwner: 0,
            agentProfit: 0,
            meta: { kind: 'adjustment', id: a.id }
        });
    });

    rows.sort((a, b) => a.date - b.date);

    // Running balance
    const opening = getOpeningBalance(start);
    let balance = opening;
    rows.forEach(r => {
        balance += n(r.ownerPayable) - n(r.paidToOwner);
        r.balance = balance;
    });

    return { rows, opening };
}

/* ============================================================
   AGING
   ============================================================ */

export function getSettlementAging() {
    const buckets = {
        '0-2': { label: '0 – 2 days', amount: 0, count: 0 },
        '3-7': { label: '3 – 7 days', amount: 0, count: 0 },
        '8-14': { label: '8 – 14 days', amount: 0, count: 0 },
        '15+': { label: '15+ days', amount: 0, count: 0 }
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const paidToOwnerTotal = state.allSettlements.reduce((s, x) => s + n(x.amount_paid), 0);

    // Sort unsettled tickets oldest first; allocate paidToOwnerTotal against them in FIFO.
    const eligible = state.allTickets
        .filter(t => !isExcluded(t))
        .map(t => ({ t, d: parseSheetDate(t.issued_date) }))
        .filter(x => x.d.getTime())
        .sort((a, b) => a.d - b.d);

    let remaining = paidToOwnerTotal;
    eligible.forEach(({ t, d }) => {
        let payable = getTicketOwnerPayable(t);
        if (payable <= 0) return;
        if (remaining > 0) {
            const consumed = Math.min(remaining, payable);
            remaining -= consumed;
            payable -= consumed;
        }
        if (payable <= 0) return;

        const ageDays = Math.floor((today - d) / 86400000);
        const key = ageDays <= 2 ? '0-2' : ageDays <= 7 ? '3-7' : ageDays <= 14 ? '8-14' : '15+';
        buckets[key].amount += payable;
        buckets[key].count += 1;
    });

    return buckets;
}

/* ============================================================
   DISCREPANCIES
   ============================================================ */

export function getSettlementDiscrepancies() {
    const issues = [];
    const tickets = state.allTickets.filter(t => !isFeeEntry(t));

    tickets.forEach(t => {
        if (n(t.net_amount) > 0 && n(t.commission) === 0 && !isCanceled(t)) {
            issues.push({
                severity: 'warning',
                title: 'Missing commission',
                description: `Ticket ${t.booking_reference || ''} has no commission recorded.`,
                client: t.name, pnr: t.booking_reference, ticketId: t.id
            });
        }
        if (n(t.net_amount) === 0 && !isCanceled(t) && !isFeeEntry(t)) {
            issues.push({
                severity: 'info',
                title: 'Ticket amount is zero',
                description: `Ticket ${t.booking_reference || ''} has zero net amount.`,
                client: t.name, pnr: t.booking_reference, ticketId: t.id
            });
        }
        if (getTicketOwnerPayable(t) < 0 && !isCanceled(t)) {
            issues.push({
                severity: 'critical',
                title: 'Negative owner payable',
                description: `Ticket ${t.booking_reference || ''} has owner payable below zero.`,
                client: t.name, pnr: t.booking_reference, ticketId: t.id
            });
        }
        if (isCanceled(t) && !String(t.settlement_ref || t.refund_ref || '').trim()) {
            issues.push({
                severity: 'warning',
                title: 'Refund/cancel needs settlement review',
                description: `Ticket ${t.booking_reference || ''} is marked refund/cancel but has no settlement reference.`,
                client: t.name, pnr: t.booking_reference, ticketId: t.id
            });
        }
    });

    // Duplicate PNR rows that may be legitimate multi-passenger PNRs, but should be checked when amounts repeat.
    const byPnr = {};
    tickets.forEach(t => {
        const pnr = t.booking_reference;
        if (!pnr) return;
        if (!byPnr[pnr]) byPnr[pnr] = [];
        byPnr[pnr].push(t);
    });
    Object.entries(byPnr).forEach(([pnr, list]) => {
        const amountSignatures = new Map();
        list.forEach(t => {
            const key = [t.name, t.net_amount, t.commission, t.extra_fare, t.date_change].join('|');
            amountSignatures.set(key, (amountSignatures.get(key) || 0) + 1);
        });
        if (list.length > 1 && [...amountSignatures.values()].some(count => count > 1)) {
            issues.push({
                severity: 'warning',
                title: 'Suspicious duplicate PNR rows',
                description: `PNR ${pnr} has repeated passenger/amount patterns. Confirm it is not duplicated.`,
                pnr, client: list[0].name
            });
        }
    });

    // Duplicate transaction IDs
    const txMap = {};
    state.allSettlements.forEach(s => {
        if (!s.transaction_id) return;
        if (!txMap[s.transaction_id]) txMap[s.transaction_id] = [];
        txMap[s.transaction_id].push(s);
    });
    Object.entries(txMap).forEach(([tx, list]) => {
        if (list.length > 1) {
            issues.push({
                severity: 'critical',
                title: 'Duplicate transaction ID',
                description: `Txn ID ${tx} appears in ${list.length} settlement records.`,
                pnr: null, client: null
            });
        }
    });

    // Settlements without proof
    state.allSettlements.forEach(s => {
        if (n(s.amount_paid) >= 100000 && !s.proofUrl) {
            issues.push({
                severity: 'info',
                title: 'Settlement without proof',
                description: `Settlement on ${s.settlement_date || ''} (${formatMMK(s.amount_paid)}) has no proof attached.`,
                client: null, pnr: null, settlementId: s.id
            });
        }
    });

    // Overpayment check: total paid > total owner payable to date
    const totalOwnerPayable = tickets.reduce((sum, t) => {
        if (isExcluded(t)) return sum;
        return sum + getTicketOwnerPayable(t);
    }, 0);
    const totalPaid = state.allSettlements.reduce((sum, s) => sum + n(s.amount_paid), 0);
    if (totalPaid > totalOwnerPayable + 1) {
        issues.push({
            severity: 'critical',
            title: 'Settlement overpayment',
            description: `Total paid to owner (${formatMMK(totalPaid)}) exceeds total owner payable (${formatMMK(totalOwnerPayable)}).`,
            client: null, pnr: null
        });
    }

    // Negative balance
    const summary = getSettlementSummary();
    if (summary.closing < 0) {
        issues.push({
            severity: 'critical',
            title: 'Negative closing balance',
            description: `Current period closing balance is ${formatMMK(summary.closing)}. Possible overpayment or missing income.`
        });
    }

    const aging = getSettlementAging();
    if (aging['15+'].amount > 0) {
        issues.push({
            severity: 'warning',
            title: 'Old unsettled owner payable',
            description: `${formatMMK(aging['15+'].amount)} remains unsettled for 15+ days.`
        });
    }

    state.allAdjustments.forEach(a => {
        if (!String(a.notes || '').trim()) {
            issues.push({
                severity: 'info',
                title: 'Adjustment missing notes',
                description: `Manual adjustment ${a.reason || a.id?.slice(0, 6) || ''} has no notes.`
            });
        }
    });

    return issues;
}

/* ============================================================
   PER-TICKET SETTLEMENT STATUS
   ============================================================ */

function getTicketSettlementStatus(t, summary) {
    if (isFeeEntry(t)) return { key: 'excluded', label: 'Excluded' };
    if (isCanceled(t)) return { key: 'excluded', label: 'Refunded / Canceled' };
    if (n(t.net_amount) === 0) return { key: 'review', label: 'Review' };

    // Determine if a settlement covers this ticket via allocations OR FIFO best-effort
    const allocated = state.allSettlements.some(s => Array.isArray(s.allocations) && s.allocations.some(a => a.ticketId === t.id));
    if (allocated) return { key: 'paid_owner', label: 'Settled' };

    // FIFO fallback: tickets up to cumulative paid amount are considered paid
    if (!summary._fifoMap) {
        const eligibleTickets = state.allTickets
            .filter(x => !isExcluded(x))
            .map(x => ({ id: x.id, payable: getTicketOwnerPayable(x), d: parseSheetDate(x.issued_date) }))
            .filter(x => x.d.getTime() && x.payable > 0)
            .sort((a, b) => a.d - b.d);
        const totalPaid = state.allSettlements.reduce((sum, s) => sum + n(s.amount_paid), 0);
        const map = new Map();
        let remaining = totalPaid;
        eligibleTickets.forEach(et => {
            if (remaining >= et.payable) { map.set(et.id, 'full'); remaining -= et.payable; }
            else if (remaining > 0)      { map.set(et.id, 'partial'); remaining = 0; }
            else                          { map.set(et.id, 'none'); }
        });
        summary._fifoMap = map;
    }
    const fifo = summary._fifoMap.get(t.id);
    if (fifo === 'full') return { key: 'paid_owner', label: 'Settled' };
    if (fifo === 'partial') return { key: 'partial', label: 'Partially Settled' };
    return { key: 'unsettled', label: 'Unsettled' };
}

/* ============================================================
   PUBLIC RENDER ENTRY POINT
   ============================================================ */

export async function loadSettlementData() {
    loadUiState();
    try {
        const [settlements, closed, adjustments] = await Promise.all([
            getSettlements(),
            getClosedPeriods().catch(() => []),
            getAdjustments().catch(() => [])
        ]);
        state.allSettlements = settlements;
        state.allClosedPeriods = closed;
        state.allAdjustments = adjustments;
        displaySettlements();
    } catch (error) {
        console.error('Failed to load settlement data', error);
        showToast('Could not load settlement data.', 'error');
    }
}

export function displaySettlements() {
    if (!document.getElementById('settle-view')) return;
    renderToolbarState();
    renderPeriodLabel();
    renderHeroSummary();
    renderKpis();
    renderReconciliation();
    renderHealthCard();
    renderRecords();
    renderClosedPeriods();
}

export function updateSettlementDashboard() { displaySettlements(); }

// Back-compat (no-ops since the legacy inline form was removed)
export function showNewSettlementForm() { openNewSettlementModal(); }
export function hideNewSettlementForm() { closeModal(); }
export function renderSettlementPage(page) {
    ui.recordsPage = page;
    renderRecords();
}

/* ============================================================
   TOOLBAR / PERIOD / BASIS
   ============================================================ */

function renderToolbarState() {
    document.querySelectorAll('#settlePeriodTabs .period-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === ui.period);
    });
    document.querySelectorAll('#settleBasisToggle .basis-option').forEach(btn => {
        const active = btn.dataset.basis === ui.basis;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });
    const custom = document.getElementById('settleCustomRange');
    if (custom) custom.hidden = ui.period !== 'custom';
}

function renderPeriodLabel() {
    const label = document.getElementById('settlePeriodLabel');
    if (!label) return;
    const { start, end } = getSettlementPeriodRange();
    label.innerHTML = `
        <i class="fa-regular fa-calendar"></i>
        <span>${formatDateToDMMMY(formatDateForSheet(start))} – ${formatDateToDMMMY(formatDateForSheet(end))}</span>
        <span class="settle-basis-pill">Owner Settlement</span>
    `;
}

function renderHeroSummary() {
    const due = document.getElementById('settleHeroDue');
    const status = document.getElementById('settleHeroStatus');
    if (!due || !status) return;
    const s = getSettlementSummary();
    due.textContent = formatMMK(s.remainingDue);
    due.classList.toggle('is-overpaid', s.remainingDue < 0);
    if (Math.abs(s.remainingDue) < 1) {
        status.textContent = 'Settled for selected period';
    } else if (s.remainingDue > 0) {
        status.textContent = 'Amount still payable to owner';
    } else {
        status.textContent = 'Overpaid against owner ledger';
    }
}

function renderReconciliation() {
    const card = document.getElementById('settleReconcileCard');
    if (!card) return;
    const s = getSettlementSummary();
    const dueClass = s.remainingDue > 0 ? 'is-due' : s.remainingDue < 0 ? 'is-overpaid' : 'is-settled';
    card.innerHTML = `
        <div class="settle-reconcile-title">
            <span><i class="fa-solid fa-calculator"></i> Owner Payable Reconciliation</span>
            <small>${escapeHtml(formatDateToDMMMY(formatDateForSheet(s.start)))} – ${escapeHtml(formatDateToDMMMY(formatDateForSheet(s.end)))}</small>
        </div>
        <div class="settle-reconcile-equation">
            ${reconcileTerm('Opening balance', s.opening, 'navy')}
            <span class="settle-equation-op">+</span>
            ${reconcileTerm('Owner payable', s.ownerPayable, 'teal')}
            <span class="settle-equation-op">+</span>
            ${reconcileTerm('Adjustments', s.adjustmentsTotal, 'amber')}
            <span class="settle-equation-op">−</span>
            ${reconcileTerm('Paid to owner', s.paidToOwner, 'teal')}
            <span class="settle-equation-op">=</span>
            ${reconcileTerm('Remaining due', s.remainingDue, dueClass)}
        </div>
    `;
}

function reconcileTerm(label, amount, tone) {
    return `
        <div class="settle-reconcile-term term-${tone}">
            <span>${escapeHtml(label)}</span>
            <strong>${formatMMK(amount)}</strong>
        </div>
    `;
}

/* ============================================================
   KPI CARDS
   ============================================================ */

function renderKpis() {
    const grid = document.getElementById('settleKpiGrid');
    if (!grid) return;
    const s = getSettlementSummary();

    const cards = [
        kpi('fa-money-bill-wave', 'navy', 'Opening Balance', formatMMK(s.opening), 'Carried from prior period'),
        kpi('fa-ticket', 'navy', 'Ticket Sales Total', formatMMK(s.ticketSalesTotal), 'Gross ticket value in period'),
        kpi('fa-file-invoice-dollar', 'navy', 'Owner Payable', formatMMK(s.ownerPayable), 'Ticket value owed to owner'),
        kpi('fa-handshake', 'teal', 'Paid to Owner', formatMMK(s.paidToOwner), `${s.periodSettlements.length} settlements`),
        kpi('fa-scale-balanced', s.remainingDue > 0 ? 'coral' : 'teal', 'Remaining Due to Owner', formatMMK(s.remainingDue), s.remainingDue > 0 ? 'Outstanding owner payable' : 'No owner balance due'),
        kpi('fa-percent', 'teal', 'My Commission', formatMMK(s.myCommission), 'Commission retained'),
        kpi('fa-arrow-trend-up', 'amber', 'Extra Profit', formatMMK(s.extraProfit), 'Extra fare retained'),
        kpi('fa-chart-line', 'teal', 'Total My Profit', formatMMK(s.myProfit), 'Commission + extra fare')
    ];

    grid.innerHTML = cards.join('');
}

function kpi(icon, color, label, value, support) {
    return `
        <div class="settle-kpi-card glass-card kpi-${color}">
            <div class="settle-kpi-icon"><i class="fa-solid ${icon}"></i></div>
            <div class="settle-kpi-body">
                <div class="settle-kpi-label">${escapeHtml(label)}</div>
                <div class="settle-kpi-value">${value}</div>
                ${support ? `<div class="settle-kpi-support">${escapeHtml(support)}</div>` : ''}
            </div>
        </div>
    `;
}

/* ============================================================
   HEALTH PANEL
   ============================================================ */

function renderHealthCard() {
    const card = document.getElementById('settleHealthCard');
    if (!card) return;
    const s = getSettlementSummary();

    const lastSettlement = [...state.allSettlements]
        .map(x => ({ x, d: parseSheetDate(x.settlement_date) }))
        .filter(x => x.d.getTime())
        .sort((a, b) => b.d - a.d)[0];

    const lastDate = lastSettlement ? formatDateToDMMMY(formatDateForSheet(lastSettlement.d)) : '—';
    const daysSince = lastSettlement ? Math.floor((Date.now() - lastSettlement.d.getTime()) / 86400000) : null;

    let statusKey, statusLabel, statusIcon;
    if (Math.abs(s.remainingDue) < 1) {
        statusKey = 'balanced'; statusLabel = 'Settled'; statusIcon = 'fa-circle-check';
    } else if (s.remainingDue > 0) {
        statusKey = 'due'; statusLabel = 'Due'; statusIcon = 'fa-triangle-exclamation';
    } else {
        statusKey = 'overpaid'; statusLabel = 'Overpaid'; statusIcon = 'fa-circle-info';
    }
    if (s.pendingSettlements.length) {
        statusKey = 'review'; statusLabel = 'Review Required'; statusIcon = 'fa-clipboard-question';
    }

    const suggestedAmount = Math.max(0, s.remainingDue);
    const suggestedDeadline = new Date();
    suggestedDeadline.setDate(suggestedDeadline.getDate() + 7);

    const oldDueWarning = daysSince !== null && daysSince > HEALTHY_DUE_DAYS && s.remainingDue > 0
        ? `<div class="settle-health-warning"><i class="fa-solid fa-triangle-exclamation"></i> It has been ${daysSince} days since the last settlement.</div>`
        : '';

    card.innerHTML = `
        <div class="settle-health-status status-${statusKey}">
            <i class="fa-solid ${statusIcon}"></i>
            <span>${statusLabel}</span>
        </div>
        <div class="settle-health-grid">
            <div>
                <div class="settle-health-label">Remaining Due</div>
                <div class="settle-health-value ${s.remainingDue > 0 ? 'is-due' : ''}">${formatMMK(s.remainingDue)}</div>
            </div>
            <div>
                <div class="settle-health-label">Last Settlement</div>
                <div class="settle-health-value">${escapeHtml(lastDate)}</div>
                <div class="settle-health-sub">${lastSettlement ? formatMMK(lastSettlement.x.amount_paid) : '—'}</div>
            </div>
            <div>
                <div class="settle-health-label">Suggested Next Payment</div>
                <div class="settle-health-value">${formatMMK(suggestedAmount)}</div>
                <div class="settle-health-sub">by ${formatDateToDMMMY(formatDateForSheet(suggestedDeadline))}</div>
            </div>
            <div>
                <div class="settle-health-label">Period Closing Balance</div>
                <div class="settle-health-value ${s.closing > 0 ? 'is-due' : ''}">${formatMMK(s.closing)}</div>
            </div>
        </div>
        ${oldDueWarning}
    `;
}

/* ============================================================
   LEDGER
   ============================================================ */

function renderLedger() {
    const body = document.getElementById('settleLedgerBody');
    if (!body) return;
    const { rows, opening } = getOwnerLedgerRows();
    const term = ui.ledgerSearch.toLowerCase();
    const filtered = !term ? rows : rows.filter(r =>
        [r.type, r.ref, r.client, r.description].join(' ').toLowerCase().includes(term)
    );

    const openingRow = `
        <tr class="ledger-opening"><td colspan="9"><strong>Opening Balance</strong></td>
        <td class="num"><strong>${formatMMK(opening)}</strong></td></tr>
    `;

    if (!filtered.length) {
        body.innerHTML = `${openingRow}<tr><td colspan="10" class="settle-empty">No transactions in this period.</td></tr>`;
        return;
    }

    body.innerHTML = openingRow + filtered.map(r => `
        <tr>
            <td>${escapeHtml(formatDateToDMMMY(formatDateForSheet(r.date)))}</td>
            <td><span class="ledger-type ledger-type-${typeClass(r.type)}">${escapeHtml(r.type)}</span></td>
            <td>${escapeHtml(r.ref)}</td>
            <td>${escapeHtml(r.client)}</td>
            <td>${escapeHtml(r.description)}</td>
            <td class="num">${r.ticketAmount ? formatMMK(r.ticketAmount) : '—'}</td>
            <td class="num">${r.agentProfit ? formatMMK(r.agentProfit) : '—'}</td>
            <td class="num">${r.ownerPayable ? formatMMK(r.ownerPayable) : '—'}</td>
            <td class="num">${r.paidToOwner ? formatMMK(r.paidToOwner) : '—'}</td>
            <td class="num"><strong>${formatMMK(r.balance)}</strong></td>
        </tr>
    `).join('');
}

function typeClass(type) {
    const t = type.toLowerCase();
    if (t.includes('settlement')) return 'paid';
    if (t.includes('adjust')) return 'adjust';
    if (t.includes('refund') || t.includes('cancel')) return 'refund';
    if (t.includes('date change')) return 'fee';
    if (t.includes('extra')) return 'extra';
    return 'ticket';
}

/* ============================================================
   TICKETS
   ============================================================ */

function renderTickets() {
    const body = document.getElementById('settleTicketsBody');
    if (!body) return;
    const summary = getSettlementSummary();
    const filter = ui.ticketStatusFilter;

    const rows = summary.periodTickets.map(t => {
        const status = getTicketSettlementStatus(t, summary);
        return { t, status };
    }).filter(r => filter === 'all' ? true : r.status.key === filter);

    if (!rows.length) {
        body.innerHTML = `<tr><td colspan="11" class="settle-empty">No tickets match the current filter.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map(({ t, status }) => `
        <tr>
            <td>${escapeHtml(formatDateToDMMMY(t.issued_date))}</td>
            <td><strong>${escapeHtml(t.booking_reference || '—')}</strong></td>
            <td>${escapeHtml(t.name || '—')}</td>
            <td>${escapeHtml(`${(t.departure || '').split(' ')[0]} → ${(t.destination || '').split(' ')[0]}`)}</td>
            <td>${renderAirlineName(t.airline || '—')}</td>
            <td>${escapeHtml(formatDateToDMMMY(t.departing_on) || '—')}</td>
            <td class="num">${formatMMK(getTicketGrossAmount(t))}</td>
            <td class="num">${formatMMK(n(t.commission))}</td>
            <td class="num">${formatMMK(n(t.extra_fare))}</td>
            <td class="num"><strong>${formatMMK(getTicketOwnerPayable(t))}</strong></td>
            <td><span class="status-pill settle-${status.key}">${escapeHtml(status.label)}</span></td>
        </tr>
    `).join('');
}

/* ============================================================
   SETTLEMENT RECORDS
   ============================================================ */

function renderRecords() {
    const body = document.getElementById('settleRecordsBody');
    if (!body) return;
    const sorted = [...state.allSettlements].sort((a, b) => parseSheetDate(b.settlement_date) - parseSheetDate(a.settlement_date));

    if (!sorted.length) {
        body.innerHTML = `<tr><td colspan="7" class="settle-empty"><i class="fa-solid fa-handshake"></i> No settlements yet — record your first payment to the owner.</td></tr>`;
        document.getElementById('settlementPagination').innerHTML = '';
        return;
    }

    const page = ui.recordsPage || 1;
    const size = ui.rowsPerRecordsPage;
    const paged = sorted.slice((page - 1) * size, page * size);

    body.innerHTML = paged.map(s => {
        const statusKey = (s.status || 'Paid').toLowerCase();
        return `
            <tr data-settlement-id="${escapeHtml(s.id)}">
                <td>${escapeHtml(s.settlement_date || '—')}</td>
                <td class="num"><strong>${formatMMK(n(s.amount_paid))}</strong></td>
                <td>${escapeHtml(s.payment_method || '—')}</td>
                <td>${escapeHtml(s.transaction_id || '—')}</td>
                <td><span class="status-pill settle-status-${statusKey}">${escapeHtml(s.status || 'Paid')}</span></td>
                <td>${escapeHtml(s.notes || '—')}</td>
                <td>
                    <div class="settle-row-actions">
                        <button class="settle-row-btn" data-settle-action="edit"><i class="fa-solid fa-pen"></i></button>
                        <button class="settle-row-btn settle-danger" data-settle-action="delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    setupGenericPagination(sorted, 'settlementPagination', (p) => { ui.recordsPage = p; renderRecords(); }, page);

    body.querySelectorAll('tr[data-settlement-id]').forEach(row => {
        const id = row.dataset.settlementId;
        row.querySelectorAll('[data-settle-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleRecordAction(btn.dataset.settleAction, id);
            });
        });
    });
}

function renderStatementPreview() {
    const wrap = document.getElementById('settleStatementPreview');
    if (!wrap) return;
    const s = getSettlementSummary();
    wrap.innerHTML = `
        <div class="settle-preview-brand">
            <strong>Ocean Travel</strong>
            <span>Owner Settlement Statement</span>
        </div>
        <div class="settle-preview-grid">
            <div><span>Opening</span><strong>${formatMMK(s.opening)}</strong></div>
            <div><span>Ticket Sales</span><strong>${formatMMK(s.ticketSalesTotal)}</strong></div>
            <div><span>Owner Payable</span><strong>${formatMMK(s.ownerPayable)}</strong></div>
            <div><span>My Profit</span><strong>${formatMMK(s.myProfit)}</strong></div>
            <div><span>Paid to Owner</span><strong>${formatMMK(s.paidToOwner)}</strong></div>
            <div><span>Closing Balance</span><strong>${formatMMK(s.closing)}</strong></div>
        </div>
        <div class="settle-preview-footer">All amounts in MMK · Owner Settlement · Private · Confidential</div>
    `;
}

function handleRecordAction(action, id) {
    const settlement = state.allSettlements.find(s => s.id === id);
    if (!settlement) return;
    if (action === 'view') openSettlementDetailModal(settlement);
    if (action === 'edit') openNewSettlementModal(settlement);
    if (action === 'verify') verifySettlement(settlement);
    if (action === 'delete') confirmDeleteSettlement(settlement);
}

async function verifySettlement(s) {
    try {
        await updateSettlement(s.id, { status: 'Verified', verifiedAt: new Date().toISOString() });
        showToast('Settlement marked as verified.', 'success');
        await loadSettlementData();
    } catch (err) {
        showToast('Failed to verify settlement.', 'error');
    }
}

function confirmDeleteSettlement(s) {
    const ok = window.confirm(`Delete settlement of ${formatMMK(s.amount_paid)} on ${s.settlement_date || ''}?\n\nThis cannot be undone.`);
    if (!ok) return;
    deleteSettlement(s.id).then(async () => {
        showToast('Settlement deleted.', 'success');
        await loadSettlementData();
    }).catch(() => showToast('Failed to delete settlement.', 'error'));
}

function openSettlementDetailModal(s) {
    const allocations = Array.isArray(s.allocations) ? s.allocations : [];
    const allocHtml = allocations.length ? `
        <table class="settle-table"><thead><tr><th>PNR</th><th>Client</th><th class="num">Amount</th></tr></thead><tbody>
            ${allocations.map(a => `<tr><td>${escapeHtml(a.pnr || '—')}</td><td>${escapeHtml(a.clientName || '—')}</td><td class="num">${formatMMK(a.amount)}</td></tr>`).join('')}
        </tbody></table>
    ` : `<p class="settle-muted">${escapeHtml(s.allocationMode === 'unallocated' ? 'Unallocated' : 'Auto (oldest first)')}</p>`;

    openModal(`
        <div class="modal-header">
            <h3><i class="fa-solid fa-handshake"></i> Settlement Detail</h3>
            <button class="modal-close-btn" data-close-modal>&times;</button>
        </div>
        <div class="modal-body-content">
            <div class="settle-detail-grid">
                <div><span>Date</span><strong>${escapeHtml(s.settlement_date || '—')}</strong></div>
                <div><span>Amount</span><strong>${formatMMK(s.amount_paid)}</strong></div>
                <div><span>Method</span><strong>${escapeHtml(s.payment_method || '—')}</strong></div>
                <div><span>Txn ID</span><strong>${escapeHtml(s.transaction_id || '—')}</strong></div>
                <div><span>Status</span><strong>${escapeHtml(s.status || 'Paid')}</strong></div>
                <div><span>Paid By</span><strong>${escapeHtml(s.paid_by || '—')}</strong></div>
                <div><span>Verified By</span><strong>${escapeHtml(s.verifiedBy || '—')}</strong></div>
                <div><span>Proof</span><strong>${s.proofUrl ? `<a href="${escapeHtml(s.proofUrl)}" target="_blank" class="settle-link">${escapeHtml(s.proofName || 'Open')}</a>` : '—'}</strong></div>
            </div>
            <div style="margin-top:1rem"><strong>Notes</strong><p>${escapeHtml(s.notes || '—')}</p></div>
            <div style="margin-top:1rem"><strong>Allocations</strong>${allocHtml}</div>
            <div class="form-actions" style="margin-top:1.25rem">
                <button class="btn btn-secondary" data-close-modal>Close</button>
            </div>
        </div>
    `, 'large-modal');
    document.querySelectorAll('[data-close-modal]').forEach(b => b.onclick = closeModal);
}

/* ============================================================
   AGING
   ============================================================ */

function renderAging() {
    const grid = document.getElementById('settleAgingGrid');
    if (!grid) return;
    const buckets = getSettlementAging();
    const colors = { '0-2': 'teal', '3-7': 'amber', '8-14': 'coral', '15+': 'coral' };
    grid.innerHTML = Object.entries(buckets).map(([key, b]) => `
        <div class="settle-aging-card aging-${colors[key]}">
            <div class="settle-aging-head">${escapeHtml(b.label)}</div>
            <div class="settle-aging-amount">${formatMMK(b.amount)}</div>
            <div class="settle-aging-count">${b.count} ticket${b.count === 1 ? '' : 's'}</div>
        </div>
    `).join('');
}

/* ============================================================
   DISCREPANCIES
   ============================================================ */

function renderDiscrepancies() {
    const wrap = document.getElementById('settleDiscrepancyList');
    if (!wrap) return;
    const issues = getSettlementDiscrepancies();
    if (!issues.length) {
        wrap.innerHTML = `<div class="settle-discrepancy-empty"><i class="fa-solid fa-circle-check"></i> No discrepancies detected.</div>`;
        return;
    }
    wrap.innerHTML = issues.map(issue => `
        <div class="settle-issue settle-issue-${issue.severity}">
            <div class="settle-issue-icon">
                <i class="fa-solid ${issue.severity === 'critical' ? 'fa-circle-exclamation' : issue.severity === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i>
            </div>
            <div class="settle-issue-body">
                <div class="settle-issue-title">${escapeHtml(issue.title)}</div>
                <div class="settle-issue-desc">${escapeHtml(issue.description)}</div>
                ${(issue.pnr || issue.client) ? `<div class="settle-issue-meta">${[issue.pnr ? `PNR ${issue.pnr}` : '', issue.client ? `· ${issue.client}` : ''].join(' ')}</div>` : ''}
            </div>
            <span class="settle-issue-severity">${issue.severity}</span>
        </div>
    `).join('');
}

/* ============================================================
   CLOSED PERIODS
   ============================================================ */

function renderClosedPeriods() {
    const list = document.getElementById('settleClosedPeriods');
    if (!list) return;
    const closed = [...state.allClosedPeriods].sort((a, b) => (b.periodKey || '').localeCompare(a.periodKey || ''));
    if (!closed.length) {
        list.innerHTML = `<div class="settle-discrepancy-empty"><i class="fa-solid fa-lock-open"></i> No closed periods yet.</div>`;
        return;
    }
    list.innerHTML = closed.map(p => `
        <div class="settle-closed-card">
            <div class="settle-closed-head">
                <span class="status-pill settle-status-locked"><i class="fa-solid fa-lock"></i> Locked</span>
                <strong>${escapeHtml(p.periodKey || '—')}</strong>
                <span class="settle-muted">Owner Settlement</span>
            </div>
            <div class="settle-closed-grid">
                <div><span>Opening</span><strong>${formatMMK(p.openingBalance)}</strong></div>
                <div><span>Ticket Sales</span><strong>${formatMMK(p.ticketSalesTotal)}</strong></div>
                <div><span>Owner Payable</span><strong>${formatMMK(p.ownerPayable)}</strong></div>
                <div><span>My Profit</span><strong>${formatMMK(n(p.myCommission) + n(p.extraProfit))}</strong></div>
                <div><span>Paid</span><strong>${formatMMK(p.paidToOwner)}</strong></div>
                <div><span>Adjustments</span><strong>${formatMMK(p.adjustments)}</strong></div>
                <div><span>Closing</span><strong>${formatMMK(p.closingBalance)}</strong></div>
            </div>
            <div class="settle-closed-actions">
                <button class="settle-row-btn settle-danger" data-unlock-period="${escapeHtml(p.id)}"><i class="fa-solid fa-lock-open"></i> Unlock</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('[data-unlock-period]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.unlockPeriod;
            if (!window.confirm('Unlock this closed period? Totals can change after unlocking.')) return;
            deleteClosedPeriod(id).then(async () => {
                showToast('Period unlocked.', 'success');
                await loadSettlementData();
            }).catch(() => showToast('Failed to unlock.', 'error'));
        });
    });
}

/* ============================================================
   NEW / EDIT SETTLEMENT MODAL
   ============================================================ */

export function openNewSettlementModal(existing = null) {
    const isEdit = !!existing;
    const { method, bank } = parsePaymentMethod(existing?.payment_method);
    const existingAllocations = Array.isArray(existing?.allocations) ? existing.allocations : [];
    const checkedSet = new Set(existingAllocations.map(a => a.ticketId));
    const allocatedElsewhere = new Set();
    state.allSettlements.forEach(s => {
        if (existing?.id && s.id === existing.id) return;
        (Array.isArray(s.allocations) ? s.allocations : []).forEach(a => {
            if (a.ticketId) allocatedElsewhere.add(a.ticketId);
        });
    });

    const unpaidTickets = state.allTickets
        .filter(t => !isExcluded(t))
        .filter(t => !allocatedElsewhere.has(t.id))
        .filter(t => getTicketOwnerPayable(t) > 0)
        .sort((a, b) => parseSheetDate(a.issued_date) - parseSheetDate(b.issued_date));

    openModal(`
        <div class="modal-header">
            <h3><i class="fa-solid fa-handshake"></i> ${isEdit ? 'Edit' : 'New'} Settlement</h3>
            <button class="modal-close-btn" data-close-modal>&times;</button>
        </div>
        <div class="modal-body-content">
            <form id="settlementForm" class="settle-form">
                <div class="form-grid">
                    <div class="form-group"><label>Settlement Date</label>
                        <input type="date" id="set_date" required value="${toIsoDate(existing?.settlement_date) || todayIso()}">
                    </div>
                    <div class="form-group"><label>Amount Paid (MMK)</label>
                        <input type="number" id="set_amount" required value="${existing?.amount_paid || ''}">
                    </div>
                    <div class="form-group"><label>Payment Method</label>
                        <select id="set_method" required>
                            <option value="" disabled ${!method ? 'selected' : ''}>Select payment method</option>
                            <option ${method === 'KBZ Pay' ? 'selected' : ''}>KBZ Pay</option>
                            <option ${method === 'Mobile Banking' ? 'selected' : ''}>Mobile Banking</option>
                            <option ${method === 'Aya Pay' ? 'selected' : ''}>Aya Pay</option>
                            <option ${method === 'UAB Pay' ? 'selected' : ''}>UAB Pay</option>
                            <option ${method === 'Cash' ? 'selected' : ''}>Cash</option>
                        </select>
                    </div>
                    <div class="form-group" id="set_bank_group" ${method === 'Mobile Banking' ? '' : 'hidden'}>
                        <label>Bank</label>
                        <input type="text" id="set_bank" placeholder="e.g. KBZ" value="${escapeHtml(bank || '')}">
                    </div>
                    <div class="form-group"><label>Transaction ID</label>
                        <input type="text" id="set_txn" value="${escapeHtml(existing?.transaction_id || '')}" autocomplete="off">
                    </div>
                    <div class="form-group"><label>Paid By</label>
                        <input type="text" id="set_paid_by" placeholder="e.g. Tashi" value="${escapeHtml(existing?.paid_by || '')}">
                    </div>
                    <div class="form-group"><label>Confirmed By (Owner)</label>
                        <input type="text" id="set_verified_by" placeholder="Owner name" value="${escapeHtml(existing?.verifiedBy || '')}">
                    </div>
                    <div class="form-group"><label>Status</label>
                        <select id="set_status">
                            <option ${(existing?.status || 'Paid') === 'Paid' ? 'selected' : ''}>Paid</option>
                            <option ${existing?.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option ${existing?.status === 'Verified' ? 'selected' : ''}>Verified</option>
                        </select>
                    </div>
                    <div class="form-group full-width"><label>Proof upload screenshot/photo/PDF</label>
                        <input type="file" id="set_proof_file" accept="image/*,.pdf">
                        ${existing?.proofUrl ? `<div class="settle-proof-existing"><a href="${escapeHtml(existing.proofUrl)}" target="_blank" class="settle-link"><i class="fa-solid fa-paperclip"></i> View current proof</a><label><input type="checkbox" id="set_remove_proof"> Remove proof</label></div>` : '<div class="settle-muted">No proof attached.</div>'}
                    </div>
                    <div class="form-group full-width"><label>Proof URL (optional link)</label>
                        <input type="url" id="set_proof_url" placeholder="https://..." value="${escapeHtml(existing?.proofUrl?.startsWith('data:') ? '' : existing?.proofUrl || '')}">
                    </div>
                    <div class="form-group"><label>Proof Name</label>
                        <input type="text" id="set_proof_name" placeholder="e.g. KBZ Receipt 12 Nov" value="${escapeHtml(existing?.proofName || '')}">
                    </div>
                    <div class="form-group"><label>Proof Type</label>
                        <select id="set_proof_type">
                            <option value="">—</option>
                            <option ${existing?.proofType === 'image' ? 'selected' : ''} value="image">Image</option>
                            <option ${existing?.proofType === 'pdf' ? 'selected' : ''} value="pdf">PDF</option>
                            <option ${existing?.proofType === 'other' ? 'selected' : ''} value="other">Other</option>
                        </select>
                    </div>
                    <div class="form-group full-width"><label>Notes</label>
                        <textarea id="set_notes" rows="2">${escapeHtml(existing?.notes || '')}</textarea>
                    </div>
                </div>

                <fieldset class="settle-allocation">
                    <legend>Allocation</legend>
                    <div class="settle-alloc-modes">
                        <label><input type="radio" name="allocMode" value="auto" ${(existing?.allocationMode || 'auto') === 'auto' ? 'checked' : ''}> Auto (oldest first)</label>
                        <label><input type="radio" name="allocMode" value="manual" ${existing?.allocationMode === 'manual' ? 'checked' : ''}> Manual</label>
                        <label><input type="radio" name="allocMode" value="unallocated" ${existing?.allocationMode === 'unallocated' ? 'checked' : ''}> Unallocated</label>
                    </div>
                    <div id="manualAllocPanel" class="settle-alloc-panel" ${existing?.allocationMode === 'manual' ? '' : 'hidden'}>
                        <div class="settle-alloc-summary">
                            <span>Selected total: <strong id="allocSelected">MMK 0</strong></span>
                            <span>Payment: <strong id="allocAmount">MMK 0</strong></span>
                            <span>Remaining: <strong id="allocRemaining">MMK 0</strong></span>
                        </div>
                        <div class="settle-alloc-list">
                            ${unpaidTickets.map(t => `
                                <label class="settle-alloc-item">
                                    <input type="checkbox" data-alloc-ticket="${escapeHtml(t.id)}" data-alloc-payable="${getTicketOwnerPayable(t)}" data-alloc-pnr="${escapeHtml(t.booking_reference || '')}" data-alloc-name="${escapeHtml(t.name || '')}" ${checkedSet.has(t.id) ? 'checked' : ''}>
                                    <span class="alloc-pnr">${escapeHtml(t.booking_reference || '—')}</span>
                                    <span class="alloc-name">${escapeHtml(t.name || '—')}</span>
                                    <span class="alloc-date">${escapeHtml(formatDateToDMMMY(t.issued_date))}</span>
                                    <span class="num">${formatMMK(getTicketOwnerPayable(t))}</span>
                                </label>
                            `).join('') || '<p class="settle-muted">No unsettled tickets available.</p>'}
                        </div>
                        <label class="settle-alloc-override">
                            <input type="checkbox" id="set_allow_over"> Allow allocation greater than payment amount
                        </label>
                    </div>
                </fieldset>

                <div class="form-actions" style="margin-top:1.25rem">
                    <button type="button" class="btn btn-secondary" data-close-modal><i class="fa-solid fa-xmark"></i> Cancel</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> ${isEdit ? 'Update' : 'Save'} Settlement</button>
                </div>
            </form>
        </div>
    `, 'solid-modal large-modal');

    document.querySelectorAll('[data-close-modal]').forEach(b => b.onclick = closeModal);
    document.getElementById('set_method')?.addEventListener('change', (e) => {
        document.getElementById('set_bank_group').hidden = e.target.value !== 'Mobile Banking';
    });
    document.querySelectorAll('input[name="allocMode"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('manualAllocPanel').hidden = r.value !== 'manual' || !r.checked;
            updateAllocationSummary();
        });
    });
    document.getElementById('set_amount')?.addEventListener('input', updateAllocationSummary);
    document.querySelectorAll('[data-alloc-ticket]').forEach(cb => cb.addEventListener('change', updateAllocationSummary));
    updateAllocationSummary();

    document.getElementById('settlementForm').addEventListener('submit', (e) => handleSettlementSubmit(e, existing));
}

function updateAllocationSummary() {
    const amount = Number(document.getElementById('set_amount')?.value || 0);
    let selected = 0;
    document.querySelectorAll('[data-alloc-ticket]:checked').forEach(cb => {
        selected += Number(cb.dataset.allocPayable || 0);
    });
    const remaining = amount - selected;
    const el = (id) => document.getElementById(id);
    if (el('allocSelected')) el('allocSelected').textContent = formatMMK(selected);
    if (el('allocAmount')) el('allocAmount').textContent = formatMMK(amount);
    if (el('allocRemaining')) el('allocRemaining').textContent = formatMMK(remaining);
}

function toIsoDate(displayDate) {
    if (!displayDate) return '';
    const d = parseSheetDate(displayDate);
    if (!d.getTime()) return '';
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getPeriodKeyFromDate(dateLike) {
    const d = dateLike instanceof Date ? dateLike : parseSheetDate(dateLike);
    if (!d.getTime()) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isDateInLockedPeriod(dateLike) {
    const key = getPeriodKeyFromDate(dateLike);
    return !!key && state.allClosedPeriods.some(p => p.periodKey === key);
}

function readProofFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve(null);
        if (file.size > 750 * 1024) {
            return reject(new Error('Proof file is too large for inline storage. Use a proof URL for files over 750 KB.'));
        }
        const reader = new FileReader();
        reader.onload = () => resolve({
            proofUrl: reader.result,
            proofName: file.name,
            proofType: file.type?.includes('pdf') ? 'pdf' : file.type?.startsWith('image/') ? 'image' : 'other',
            proofUploadedAt: new Date().toISOString()
        });
        reader.onerror = () => reject(new Error('Could not read proof file.'));
        reader.readAsDataURL(file);
    });
}

function buildAutoAllocations(amount, existingId = null) {
    let remaining = Number(amount || 0);
    const alreadyAllocated = new Set();
    state.allSettlements.forEach(s => {
        if (existingId && s.id === existingId) return;
        (Array.isArray(s.allocations) ? s.allocations : []).forEach(a => {
            if (a.ticketId) alreadyAllocated.add(a.ticketId);
        });
    });

    return state.allTickets
        .filter(t => !isExcluded(t) && !alreadyAllocated.has(t.id) && getTicketOwnerPayable(t) > 0)
        .sort((a, b) => parseSheetDate(a.issued_date) - parseSheetDate(b.issued_date))
        .reduce((allocations, t) => {
            if (remaining <= 0) return allocations;
            const payable = getTicketOwnerPayable(t);
            const amountForTicket = Math.min(remaining, payable);
            remaining -= amountForTicket;
            allocations.push({
                ticketId: t.id,
                pnr: t.booking_reference || '',
                clientName: t.name || '',
                passengerName: t.name || '',
                amount: amountForTicket
            });
            return allocations;
        }, []);
}

async function handleSettlementSubmit(e, existing) {
    e.preventDefault();
    if (state.isSubmitting) return;
    state.isSubmitting = true;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const dateIso = document.getElementById('set_date').value;
        const amount = parseFloat(document.getElementById('set_amount').value) || 0;
        const method = document.getElementById('set_method').value;
        const bank = document.getElementById('set_bank')?.value || '';
        const allocMode = document.querySelector('input[name="allocMode"]:checked')?.value || 'auto';

        if (!dateIso || amount === 0 || !method) {
            throw new Error('Date, amount, and payment method are required.');
        }
        if (isDateInLockedPeriod(dateIso)) {
            throw new Error('This settlement date is in a locked month. Unlock the period before changing it.');
        }

        let allocations = [];
        if (allocMode === 'auto') {
            allocations = buildAutoAllocations(amount, existing?.id);
        }

        if (allocMode === 'manual') {
            document.querySelectorAll('[data-alloc-ticket]:checked').forEach(cb => {
                allocations.push({
                    ticketId: cb.dataset.allocTicket,
                    pnr: cb.dataset.allocPnr,
                    clientName: cb.dataset.allocName,
                    passengerName: cb.dataset.allocName,
                    amount: Number(cb.dataset.allocPayable || 0)
                });
            });
            const total = allocations.reduce((s, a) => s + a.amount, 0);
            const allowOver = document.getElementById('set_allow_over')?.checked;
            if (total > amount && !allowOver) {
                throw new Error(`Allocation (${formatMMK(total)}) exceeds payment (${formatMMK(amount)}). Enable override to save anyway.`);
            }
        }

        const proofFile = document.getElementById('set_proof_file')?.files?.[0] || null;
        const uploadedProof = await readProofFile(proofFile);
        const removeProof = document.getElementById('set_remove_proof')?.checked;
        const proofUrlInput = document.getElementById('set_proof_url').value || '';
        const proofNameInput = document.getElementById('set_proof_name').value || '';
        const proofTypeInput = document.getElementById('set_proof_type').value || '';
        const proofPayload = uploadedProof || (removeProof ? {
            proofUrl: '',
            proofName: '',
            proofType: '',
            proofUploadedAt: ''
        } : {
            proofUrl: proofUrlInput || existing?.proofUrl || '',
            proofName: proofNameInput || existing?.proofName || '',
            proofType: proofTypeInput || existing?.proofType || '',
            proofUploadedAt: (proofUrlInput && proofUrlInput !== existing?.proofUrl) ? new Date().toISOString() : (existing?.proofUploadedAt || '')
        });

        const payload = {
            settlement_date: formatDateToDDMMMYYYY(dateIso),
            net_amount: '',
            amount_paid: amount,
            payment_method: formatPaymentMethod(method, bank),
            transaction_id: (document.getElementById('set_txn').value || '').toUpperCase(),
            status: document.getElementById('set_status').value || 'Paid',
            paid_by: document.getElementById('set_paid_by').value || '',
            verifiedBy: document.getElementById('set_verified_by').value || '',
            verifiedAt: document.getElementById('set_status').value === 'Verified' ? new Date().toISOString() : (existing?.verifiedAt || ''),
            notes: document.getElementById('set_notes').value || '',
            ...proofPayload,
            allocationMode: allocMode,
            allocations
        };

        if (existing) {
            await updateSettlement(existing.id, payload);
            showToast('Settlement updated.', 'success');
        } else {
            await addSettlement(payload);
            showToast('Settlement saved successfully!', 'success');
        }
        closeModal();
        await loadSettlementData();
    } catch (err) {
        showToast(err.message || 'Failed to save settlement.', 'error');
    } finally {
        state.isSubmitting = false;
        if (submitBtn) submitBtn.disabled = false;
    }
}

/* Back-compat for old inline form handler if main.js still wires it. */
export async function handleNewSettlementSubmit(e) {
    if (e?.preventDefault) e.preventDefault();
    openNewSettlementModal();
}

/* ============================================================
   ADJUSTMENT MODAL
   ============================================================ */

export function openAdjustmentModal() {
    openModal(`
        <div class="modal-header">
            <h3><i class="fa-solid fa-pen-to-square"></i> New Adjustment</h3>
            <button class="modal-close-btn" data-close-modal>&times;</button>
        </div>
        <div class="modal-body-content">
            <form id="adjustmentForm" class="settle-form">
                <div class="form-grid">
                    <div class="form-group"><label>Date</label><input type="date" id="adj_date" required value="${todayIso()}"></div>
                    <div class="form-group"><label>Type</label>
                        <select id="adj_type" required>
                            <option value="Owner Credit">Owner Credit (reduces payable)</option>
                            <option value="Owner Debit">Owner Debit (adds to payable)</option>
                            <option value="Correction">Correction</option>
                            <option value="Refund">Refund</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Amount (MMK)</label><input type="number" id="adj_amount" min="0" required></div>
                    <div class="form-group"><label>Reason</label><input type="text" id="adj_reason" required placeholder="Short reason"></div>
                    <div class="form-group full-width"><label>Notes</label><textarea id="adj_notes" rows="2"></textarea></div>
                    <div class="form-group full-width"><label>Proof URL (optional)</label><input type="url" id="adj_proof" placeholder="https://…"></div>
                </div>
                <div class="form-actions" style="margin-top:1rem">
                    <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Adjustment</button>
                </div>
            </form>
        </div>
    `, 'large-modal');
    document.querySelectorAll('[data-close-modal]').forEach(b => b.onclick = closeModal);

    document.getElementById('adjustmentForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const dateIso = document.getElementById('adj_date').value;
            if (isDateInLockedPeriod(dateIso)) {
                throw new Error('This adjustment date is in a locked month. Unlock the period before changing it.');
            }
            const data = {
                adjustment_date: formatDateToDDMMMYYYY(dateIso),
                type: document.getElementById('adj_type').value,
                amount: parseFloat(document.getElementById('adj_amount').value) || 0,
                reason: document.getElementById('adj_reason').value || '',
                notes: document.getElementById('adj_notes').value || '',
                proofUrl: document.getElementById('adj_proof').value || ''
            };
            if (!data.amount) throw new Error('Amount is required.');
            await addAdjustment(data);
            showToast('Adjustment saved.', 'success');
            closeModal();
            await loadSettlementData();
        } catch (err) {
            showToast(err.message || 'Failed to save adjustment.', 'error');
        }
    });
}

/* ============================================================
   CLOSE MONTH MODAL
   ============================================================ */

export function openCloseMonthModal() {
    const today = new Date();
    const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    openModal(`
        <div class="modal-header">
            <h3><i class="fa-solid fa-lock"></i> Close Month</h3>
            <button class="modal-close-btn" data-close-modal>&times;</button>
        </div>
        <div class="modal-body-content">
            <div class="form-grid">
                <div class="form-group"><label>Period (YYYY-MM)</label><input type="month" id="close_period" required value="${defaultPeriod}"></div>
            </div>
            <div id="close_preview" class="settle-close-preview"></div>
            <div class="form-actions" style="margin-top:1rem">
                <button class="btn btn-secondary" data-close-modal>Cancel</button>
                <button class="btn btn-primary" id="closeMonthConfirm"><i class="fa-solid fa-lock"></i> Confirm & Lock</button>
            </div>
        </div>
    `, 'large-modal');

    document.querySelectorAll('[data-close-modal]').forEach(b => b.onclick = closeModal);
    const refreshPreview = () => renderClosePreview(document.getElementById('close_period').value);
    document.getElementById('close_period').addEventListener('change', refreshPreview);
    refreshPreview();

    document.getElementById('closeMonthConfirm').addEventListener('click', async () => {
        const periodKey = document.getElementById('close_period').value;
        if (!periodKey) return showToast('Select a period.', 'error');
        if (state.allClosedPeriods.some(p => p.periodKey === periodKey)) {
            return showToast('Period already locked.', 'error');
        }
        const snapshot = buildCloseSnapshot(periodKey);
        if (!snapshot) return;
        try {
            await addClosedPeriod({ ...snapshot, status: 'Locked', lockedAt: new Date().toISOString() });
            showToast(`Locked ${periodKey}.`, 'success');
            closeModal();
            await loadSettlementData();
        } catch {
            showToast('Failed to lock period.', 'error');
        }
    });
}

function buildCloseSnapshot(periodKey) {
    const [y, m] = periodKey.split('-').map(Number);
    if (!y || !m) return null;
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59, 999);

    const prevUi = { ...ui };
    ui.period = 'custom';
    ui.customStart = start;
    ui.customEnd = end;
    const s = getSettlementSummary();
    Object.assign(ui, prevUi);

    return {
        periodKey,
        startDate: formatDateToDDMMMYYYY(start.toISOString().slice(0, 10)),
        endDate: formatDateToDDMMMYYYY(end.toISOString().slice(0, 10)),
        basis: ui.basis,
        openingBalance: Math.round(s.opening),
        ticketSalesTotal: Math.round(s.ticketSalesTotal),
        ownerPayable: Math.round(s.ownerPayable),
        myCommission: Math.round(s.myCommission),
        extraProfit: Math.round(s.extraProfit),
        paidToOwner: Math.round(s.paidToOwner),
        adjustments: Math.round(s.adjustmentsTotal),
        closingBalance: Math.round(s.closing)
    };
}

function renderClosePreview(periodKey) {
    const wrap = document.getElementById('close_preview');
    if (!wrap || !periodKey) return;
    const snap = buildCloseSnapshot(periodKey);
    if (!snap) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `
        <h4>Month Close Summary · ${escapeHtml(periodKey)}</h4>
        <div class="settle-close-grid">
            <div><span>Opening</span><strong>${formatMMK(snap.openingBalance)}</strong></div>
            <div><span>Ticket Sales</span><strong>${formatMMK(snap.ticketSalesTotal)}</strong></div>
            <div><span>Owner Payable</span><strong>${formatMMK(snap.ownerPayable)}</strong></div>
            <div><span>Paid to Owner</span><strong>${formatMMK(snap.paidToOwner)}</strong></div>
            <div><span>Adjustments</span><strong>${formatMMK(snap.adjustments)}</strong></div>
            <div><span>Closing</span><strong>${formatMMK(snap.closingBalance)}</strong></div>
        </div>
        <p class="settle-muted">Locking will preserve these totals. You can unlock the period later if needed.</p>
    `;
}

/* ============================================================
   STATEMENT VIEW
   ============================================================ */

export function openStatementModal() {
    const s = getSettlementSummary();
    const lineItems = s.periodTickets.map(t => `
        <tr>
            <td>${escapeHtml(formatDateToDMMMY(t.issued_date))}</td>
            <td>${escapeHtml(t.booking_reference || '—')}</td>
            <td>${escapeHtml(t.name || '—')}</td>
            <td class="num">${formatMMK(getTicketGrossAmount(t))}</td>
            <td class="num">${formatMMK(n(t.commission))}</td>
            <td class="num">${formatMMK(n(t.extra_fare))}</td>
            <td class="num"><strong>${formatMMK(getTicketOwnerPayable(t))}</strong></td>
        </tr>
    `).join('') || '<tr><td colspan="7" class="settle-empty">No tickets in this period.</td></tr>';

    const settlementRows = s.periodSettlements.map(x => `
        <tr>
            <td>${escapeHtml(x.settlement_date || '—')}</td>
            <td>${escapeHtml(x.payment_method || '—')}</td>
            <td>${escapeHtml(x.transaction_id || '—')}</td>
            <td class="num">${formatMMK(n(x.amount_paid))}</td>
        </tr>
    `).join('') || '<tr><td colspan="4" class="settle-empty">No settlements in this period.</td></tr>';

    const adjRows = s.periodAdjustments.map(a => `
        <tr>
            <td>${escapeHtml(a.adjustment_date || '—')}</td>
            <td>${escapeHtml(a.type || '—')}</td>
            <td>${escapeHtml(a.reason || '—')}</td>
            <td class="num">${formatMMK(adjustmentSignedAmount(a))}</td>
        </tr>
    `).join('') || '<tr><td colspan="4" class="settle-empty">No adjustments.</td></tr>';

    openModal(`
        <div class="modal-header">
            <h3><i class="fa-solid fa-file-lines"></i> Owner Settlement Statement</h3>
            <button class="modal-close-btn" data-close-modal>&times;</button>
        </div>
        <div class="modal-body-content statement-view" id="statementBody">
            <header class="statement-header">
                <h2>Ocean Travel</h2>
                <p>Owner Settlement Statement</p>
                <p class="settle-muted">${escapeHtml(formatDateToDMMMY(formatDateForSheet(s.start)))} – ${escapeHtml(formatDateToDMMMY(formatDateForSheet(s.end)))} · Owner Settlement</p>
            </header>
            <section class="statement-summary">
                <div><span>Opening Balance</span><strong>${formatMMK(s.opening)}</strong></div>
                <div><span>Ticket Sales Total</span><strong>${formatMMK(s.ticketSalesTotal)}</strong></div>
                <div><span>Owner Payable (Tickets)</span><strong>${formatMMK(s.ownerPayable)}</strong></div>
                <div><span>My Commission</span><strong>${formatMMK(s.myCommission)}</strong></div>
                <div><span>Extra Profit</span><strong>${formatMMK(s.extraProfit)}</strong></div>
                <div><span>Total My Profit</span><strong>${formatMMK(s.myProfit)}</strong></div>
                <div><span>Adjustments</span><strong>${formatMMK(s.adjustmentsTotal)}</strong></div>
                <div><span>Settlements Paid</span><strong>${formatMMK(s.paidToOwner)}</strong></div>
                <div class="statement-closing"><span>Closing Balance</span><strong>${formatMMK(s.closing)}</strong></div>
            </section>
            <h4>Ticket Line Items</h4>
            <table class="settle-table"><thead><tr><th>Date</th><th>PNR</th><th>Client</th><th class="num">Ticket Amount</th><th class="num">Comm.</th><th class="num">Extra</th><th class="num">Owner Payable</th></tr></thead><tbody>${lineItems}</tbody></table>
            <h4>Settlement Payments</h4>
            <table class="settle-table"><thead><tr><th>Date</th><th>Method</th><th>Txn</th><th class="num">Amount</th></tr></thead><tbody>${settlementRows}</tbody></table>
            <h4>Adjustments</h4>
            <table class="settle-table"><thead><tr><th>Date</th><th>Type</th><th>Reason</th><th class="num">Amount</th></tr></thead><tbody>${adjRows}</tbody></table>
            <section class="statement-signatures">
                <div><span>Prepared By</span></div>
                <div><span>Owner Confirmation</span></div>
            </section>
            <footer class="statement-footer">All amounts in MMK · Owner Settlement · Private · Confidential</footer>
        </div>
        <div class="form-actions" style="padding: 0.5rem 1.5rem 1.25rem">
            <button class="btn btn-secondary" id="statementPrintBtn"><i class="fa-solid fa-print"></i> Print</button>
            <button class="btn btn-primary" id="statementPdfBtn"><i class="fa-solid fa-file-pdf"></i> Export PDF</button>
            <button class="btn btn-secondary" data-close-modal>Close</button>
        </div>
    `, 'xlarge-modal');

    document.querySelectorAll('[data-close-modal]').forEach(b => b.onclick = closeModal);
    document.getElementById('statementPrintBtn').addEventListener('click', () => printStatementHtml());
    document.getElementById('statementPdfBtn').addEventListener('click', () => exportStatementPdf());
}

function printStatementHtml() {
    const body = document.getElementById('statementBody')?.innerHTML;
    if (!body) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>Owner Settlement Statement</title>
        <style>
            body { font-family: -apple-system, system-ui, sans-serif; padding: 32px; color: #26251e; }
            h2 { margin: 0 0 .25rem; }
            table { width: 100%; border-collapse: collapse; margin: .5rem 0 1rem; font-size: 12px; }
            th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; }
            th { background: #f7f7f4; }
            .num { text-align: right; }
            .statement-summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: .75rem; margin: 1rem 0; }
            .statement-summary div { padding: .5rem .75rem; border: 1px solid #ddd; border-radius: 8px; }
            .statement-summary span { display: block; font-size: 10px; text-transform: uppercase; color: #888; }
            .statement-summary strong { font-size: 14px; }
            .statement-closing { background: #f0fdfa; }
            footer { text-align: center; margin-top: 1.5rem; color: #888; font-size: 11px; }
        </style>
    </head><body>${body}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
}

export function exportStatementPdf() {
    if (!window.jspdf) { showToast('PDF library not available.', 'error'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const s = getSettlementSummary();

    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('Ocean Travel — Owner Settlement Statement', 105, 16, { align: 'center' });
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`${formatDateToDMMMY(formatDateForSheet(s.start))}  –  ${formatDateToDMMMY(formatDateForSheet(s.end))}  ·  Owner Settlement`, 105, 22, { align: 'center' });

    const summaryRows = [
        ['Opening Balance', formatMMK(s.opening)],
        ['Ticket Sales Total', formatMMK(s.ticketSalesTotal)],
        ['Owner Payable (Tickets)', formatMMK(s.ownerPayable)],
        ['My Commission', formatMMK(s.myCommission)],
        ['Extra Profit', formatMMK(s.extraProfit)],
        ['Total My Profit', formatMMK(s.myProfit)],
        ['Adjustments', formatMMK(s.adjustmentsTotal)],
        ['Settlements Paid', formatMMK(s.paidToOwner)],
        ['Closing Balance', formatMMK(s.closing)]
    ];
    if (doc.autoTable) {
        doc.autoTable({
            head: [['Summary', 'Amount']],
            body: summaryRows,
            startY: 28,
            styles: { fontSize: 10 },
            headStyles: { fillColor: [13, 148, 136] }
        });

        const ticketBody = s.periodTickets.map(t => [
            formatDateToDMMMY(t.issued_date),
            t.booking_reference || '—',
            t.name || '—',
            Math.round(getTicketGrossAmount(t)).toLocaleString(),
            n(t.commission).toLocaleString(),
            n(t.extra_fare).toLocaleString(),
            Math.round(getTicketOwnerPayable(t)).toLocaleString()
        ]);
        doc.autoTable({
            head: [['Issued', 'PNR', 'Client', 'Ticket Amount', 'Comm.', 'Extra', 'Owner Payable']],
            body: ticketBody.length ? ticketBody : [['—', '—', '—', '—', '—', '—', '—']],
            startY: doc.lastAutoTable.finalY + 6,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [31, 138, 101] }
        });

        const settleBody = s.periodSettlements.map(x => [
            x.settlement_date || '—',
            x.payment_method || '—',
            x.transaction_id || '—',
            n(x.amount_paid).toLocaleString()
        ]);
        doc.autoTable({
            head: [['Settlement Date', 'Method', 'Txn ID', 'Amount']],
            body: settleBody.length ? settleBody : [['—', '—', '—', '—']],
            startY: doc.lastAutoTable.finalY + 6,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [192, 133, 50] }
        });
    } else {
        let y = 32;
        summaryRows.forEach(([k, v]) => { doc.text(`${k}: ${v}`, 14, y); y += 6; });
    }

    doc.setFontSize(8);
    doc.text('Prepared By ____________________        Owner Confirmation ____________________', 105, 282, { align: 'center' });
    doc.text('All amounts in MMK · Owner Settlement · Private · Confidential', 105, 290, { align: 'center' });
    doc.save(`owner_statement_${Date.now()}.pdf`);
}

/* ============================================================
   WIRING
   ============================================================ */

export function initSettlementView() {
    const root = document.getElementById('settle-view');
    if (!root || root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';

    document.getElementById('newSettlementBtn')?.addEventListener('click', () => openNewSettlementModal());
    document.getElementById('closeMonthBtn')?.addEventListener('click', () => openCloseMonthModal());

    document.querySelectorAll('#settlePeriodTabs .period-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            ui.period = btn.dataset.period;
            persistUiState();
            displaySettlements();
        });
    });

    document.querySelectorAll('#settleBasisToggle .basis-option').forEach(btn => {
        btn.addEventListener('click', () => {
            ui.basis = btn.dataset.basis;
            persistUiState();
            displaySettlements();
        });
    });

    document.getElementById('settleApplyCustom')?.addEventListener('click', () => {
        const s = document.getElementById('settleStartDate').value;
        const e = document.getElementById('settleEndDate').value;
        if (!s || !e) return showToast('Pick start and end dates.', 'error');
        ui.period = 'custom';
        ui.customStart = new Date(s);
        ui.customEnd = new Date(e);
        displaySettlements();
    });

}
