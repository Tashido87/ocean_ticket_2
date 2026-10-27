/**
 * @fileoverview Dashboard Module for Ocean Air Ticket Management.
 * Extracted from main.js to modularize Dashboard KPIs, Charts, Travel Schedule,
 * Unpaid Tickets, Tasks & Reminders, Expiring Passports, and Trip Plan Detail Modal.
 */

import { state } from "./state.js";
import { addDashboardTask, updateDashboardTask, deleteDashboardTask, batchUpdateTickets, batchUpdateWithAudit } from "./db.js";
import {
    showToast,
    parseSheetDate,
    parseDateInput,
    parseDeadline,
    setButtonLoading,
    addRecentActivity,
    isTicketPaid,
    isFeeEntryRow,
    isCanceledTicket,
    renderAirlineName,
    renderPhoneticExpansionHtml,
    wirePhoneticToggle,
    formatSafeAccountLink,
    getSocialPlatformMeta,
    formatDateForSheet,
    buildCustomerMessage,
    copyCustomerMessageToClipboard,
    isInternationalFlightRoute,
    compactPlace,
    getPnrSectors,
    getPnrRouteDisplay,
    getPnrTravelDateDisplay
} from "./utils.js";
import { updateUnpaidCount, displayTickets } from "./tickets.js";
import { getSettlementSummary } from "./settlement.js";
import { loadFeaturedClients, getExpiringPassportClients, viewClientHistory } from "./clients.js";
import { findTicketForManage } from "./manage.js";
import { generateInvoice, generateInvoiceImage, analyzeInvoiceScenario } from "./invoice.js";
import { selectPassengerTickets } from "./invoice-selection.mjs";
import { loadDocumentLibraries } from "./document-libraries.js";
import {
    showView,
    initializeDatepickers,
    initializeTimePicker,
    updateNotifications,
    updateUpcomingPnrs,
    openModal,
    closeModal,
    showConfirmModal,
    showInvoiceOptionModal
} from "./ui.js";

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
    return (Number(t.net_amount) || 0) + (Number(t.date_change) || 0);
}

function ticketRevenueAmount(t) {
    return (Number(t.net_amount) || 0) + (Number(t.date_change) || 0);
}

function ticketGrossAmount(t) {
    return (Number(t.net_amount) || 0) + (Number(t.date_change) || 0) + (Number(t.extra_fare) || 0) + (Number(t.sub_agent_fare) || 0);
}

function ticketUnsettledAgentFare(t) {
    if (!t || isCanceledTicket(t) || t.sub_agent_settled) return 0;
    if (isTicketPaid(t) && !t.sub_agent_manually_unsettled) return 0;
    return Math.max(0, Number(t.sub_agent_fare) || 0);
}

function getAccountUnsettledAgentFare(accountName, fallbackTickets = []) {
    const normAcc = String(accountName || '').trim().toLowerCase();
    const seen = new Set();
    let total = 0;

    if (normAcc && normAcc !== 'undefined') {
        (state.allTickets || []).forEach(t => {
            if (isCanceledTicket(t)) return;
            const tAcc = String(t.account_name || '').trim().toLowerCase();
            if (tAcc === normAcc) {
                const key = t.id || `${t.booking_reference}|${t.name}|${t.departing_on}|${t.leg || ''}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    total += ticketUnsettledAgentFare(t);
                }
            }
        });
    }

    (fallbackTickets || []).forEach(t => {
        if (!t || isCanceledTicket(t)) return;
        const key = t.id || `${t.booking_reference}|${t.name}|${t.departing_on}|${t.leg || ''}`;
        if (!seen.has(key)) {
            seen.add(key);
            total += ticketUnsettledAgentFare(t);
        }
    });

    return total;
}

function ticketProfitAmount(t) {
    if (t.source === 'self' && !(Number(t.commission) > 0)) {
        return (Number(t.base_fare) || 0) + (Number(t.extra_fare) || 0) - (Number(t.cost_price) || 0);
    }
    return (Number(t.commission) || 0) + (Number(t.extra_fare) || 0);
}

function hotelProfitAmount(h) {
    return Number(h.commission) || 0;
}

function ticketOwnerPayableAmount(t) {
    if (isCanceledTicket(t)) return 0;
    if (t.source === 'self') return 0;
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

function activeHotelRowsInRange(range) {
    return (state.allHotels || []).filter(h => {
        const checkinDate = parseSheetDate(h.checkin);
        return inDashboardRange(checkinDate, range);
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

function dashboardRouteLabel(record) {
    if (!record) return '—';
    if (Array.isArray(record) || record.trip_type === 'Round-Trip' || record.is_round_trip) {
        return getPnrRouteDisplay(record);
    }
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
        else group.unpaidAmount += Math.max(0, ticketGrossAmount(ticket) - ticketUnsettledAgentFare(ticket));
    });

    return [...groups.values()].sort((a, b) => a.date - b.date);
}

function groupUnpaidTickets(rows, hotelRows = (state.allHotels || [])) {
    const groups = new Map();

    // Match Client Detail outstanding logic: unpaid money can live on passenger rows
    // or on "(Fees)" change rows. Fee rows are not clients, but they are still receivables.
    const activeTickets = rows.filter(ticket => !isCanceledTicket(ticket));

    // Group by PNR first (normalize PNR to upper-case trim)
    const pnrGroups = new Map();
    activeTickets.forEach(ticket => {
        const rawPnr = String(ticket.booking_reference || '').trim();
        const pnrKey = rawPnr.toUpperCase() || String(ticket.id || '').trim() || 'No PNR';
        if (!pnrGroups.has(pnrKey)) {
            pnrGroups.set(pnrKey, { displayPnr: rawPnr || pnrKey, tickets: [] });
        }
        pnrGroups.get(pnrKey).tickets.push(ticket);
    });

    // For each PNR, compute total unpaid amount across ALL rows (passenger + fees)
    pnrGroups.forEach(({ displayPnr, tickets }, pnrKey) => {
        let unpaidAmount = 0;
        let paidAmount = 0;
        let agentFareAmount = 0;
        let hasFeeUnpaid = false;

        tickets.forEach(t => {
            const isFee = isFeeEntryRow(t);
            const gross = ticketGrossAmount(t);
            const agentFare = ticketUnsettledAgentFare(t);
            const netReceivable = Math.max(0, gross - agentFare);
            let itemUnpaid = 0;
            let itemPaid = 0;

            if (isTicketPaid(t)) {
                itemPaid = gross;
                itemUnpaid = 0;
            } else if (t.outstanding_amount !== undefined && Number(t.outstanding_amount) >= 0) {
                const rawOut = Number(t.outstanding_amount);
                itemPaid = Math.max(0, gross - rawOut);
                itemUnpaid = Math.max(0, netReceivable - itemPaid);
            } else {
                itemPaid = 0;
                itemUnpaid = netReceivable;
            }

            agentFareAmount += agentFare;
            paidAmount += itemPaid;

            if (itemUnpaid > 0) {
                unpaidAmount += itemUnpaid;
                if (isFee || Number(t.date_change) > 0) {
                    hasFeeUnpaid = true;
                }
            }
        });

        if (unpaidAmount > 0) {
            const nonFeeTickets = tickets.filter(t => !isFeeEntryRow(t));
            const feeTickets = tickets.filter(t => isFeeEntryRow(t));
            const passengerTicket = nonFeeTickets[0] || feeTickets[0] || tickets[0];

            // Resolve Client Name (ticket.name represents Client Name; account_name is Social Media Account Name)
            const accountName = String(
                passengerTicket.account_name ||
                tickets.find(t => t.account_name)?.account_name ||
                ''
            ).trim();

            const candidateTickets = nonFeeTickets.length > 0 ? nonFeeTickets : (tickets.length > 0 ? tickets : [passengerTicket]);
            const clientNames = [...new Set(
                candidateTickets
                    .map(t => String(t.name || '')
                        .replace(/\s*\(\s*(fees|balance)\s*\)\s*$/i, '')
                        .trim()
                    )
                    .filter(n => n && n.toLowerCase() !== 'undefined')
            )];

            const rawPaxName = clientNames.join(', ') || String(
                passengerTicket.name ||
                tickets.find(t => t.name)?.name ||
                ''
            ).replace(/\s*\(fees\)\s*$/i, '').replace(/\s*\(balance\)\s*$/i, '').trim();

            const clientLabel = rawPaxName ||
                (accountName && accountName.toLowerCase() !== 'undefined' ? accountName : 'Client');

            // Travel Date: prefer ticket with valid departing_on
            const dateTicket = nonFeeTickets.find(t => parseSheetDate(t.departing_on)) ||
                               feeTickets.find(t => parseSheetDate(t.departing_on)) ||
                               passengerTicket;
            const routeTicket = nonFeeTickets.find(t => t.departure && t.destination) ||
                                feeTickets.find(t => t.departure && t.destination) ||
                                passengerTicket;

            const totalGross = tickets.reduce((sum, t) => sum + ticketGrossAmount(t), 0);
            const cleanSocial = (accountName && accountName.toLowerCase() !== 'undefined') ? accountName : '';
            const accountDisplayLabel = cleanSocial || clientLabel;
            const accountGroupKey = accountDisplayLabel.trim().toLowerCase();

            groups.set(pnrKey, {
                isHotel: false,
                pnr: displayPnr,
                client: clientLabel,
                rawClient: clientLabel,
                socialAccount: cleanSocial,
                accountDisplayLabel,
                accountGroupKey,
                accountType: String(passengerTicket.account_type || tickets.find(t => t.account_type)?.account_type || '').trim(),
                accountLink: String(passengerTicket.account_link || tickets.find(t => t.account_link)?.account_link || '').trim(),
                airline: String(passengerTicket.airline || tickets.find(t => t.airline)?.airline || '').trim(),
                travelDateStr: getPnrTravelDateDisplay(tickets) || String(dateTicket.departing_on || '').trim(),
                issuedDateStr: String(passengerTicket.issued_date || '').trim(),
                rawPassenger: rawPaxName,
                route: getPnrRouteDisplay(tickets),
                sectors: getPnrSectors(tickets),
                dueDate: parseSheetDate(dateTicket.departing_on),
                issuedDate: parseSheetDate(passengerTicket.issued_date),
                amount: unpaidAmount,
                totalGross,
                agentFareAmount,
                paidAmount,
                tickets: nonFeeTickets.length || tickets.length,
                ticketRows: tickets,
                hasFeeRows: hasFeeUnpaid
            });
        }
    });

    // Include Unpaid Hotel Reservations
    (hotelRows || []).forEach(h => {
        const rawPaid = h.paid !== undefined && h.paid !== null && h.paid !== '' ? h.paid : h.payment_status;
        const paidKey = String(rawPaid ?? '').trim().toLowerCase();
        if (paidKey === 'paid' || rawPaid === true) return;

        const gross = Number(h.selling_price || h.net_amount || 0);
        let unpaid = gross;
        let paid = 0;
        if (paidKey === 'partial') {
            if (h.outstanding_amount !== undefined && Number(h.outstanding_amount) >= 0) {
                unpaid = Number(h.outstanding_amount);
                paid = Math.max(0, gross - unpaid);
            } else if (h.paid_amount) {
                paid = Number(h.paid_amount);
                unpaid = Math.max(0, gross - paid);
            }
        }
        if (unpaid <= 0) return;

        const hotelKey = `HOTEL_${h.id || h.booking_ref || Math.random()}`;
        const clientName = String(h.client_name || 'Guest').trim();
        const hotelName = String(h.hotel_name || 'Hotel').trim();
        const displayRef = String(h.booking_ref || hotelName || 'Hotel').trim();
        const cleanSocial = String(h.account_name || '').trim();
        const accountDisplayLabel = cleanSocial || clientName;
        const accountGroupKey = accountDisplayLabel.trim().toLowerCase();

        const checkinDate = parseSheetDate(h.checkin) || parseSheetDate(h.booking_date);
        const checkoutDate = parseSheetDate(h.checkout);

        groups.set(hotelKey, {
            isHotel: true,
            hotelId: h.id,
            pnr: displayRef,
            client: clientName,
            rawClient: clientName,
            socialAccount: cleanSocial,
            accountDisplayLabel,
            accountGroupKey,
            accountType: String(h.account_type || '').trim(),
            accountLink: String(h.account_link || '').trim(),
            airline: hotelName,
            hotelName,
            city: String(h.city || '').trim(),
            country: String(h.country || '').trim(),
            checkin: String(h.checkin || '').trim(),
            checkout: String(h.checkout || '').trim(),
            travelDateStr: h.checkin ? `${h.checkin}${h.checkout ? ` to ${h.checkout}` : ''}` : '',
            issuedDateStr: String(h.booking_date || '').trim(),
            rawPassenger: clientName,
            route: `${hotelName}${h.city ? ` (${h.city})` : ''}`,
            sectors: [{
                departure: `${hotelName}${h.city ? `, ${h.city}` : ''}`,
                destination: h.checkin && h.checkout ? `${h.checkin} → ${h.checkout}` : ''
            }],
            dueDate: checkinDate,
            issuedDate: parseSheetDate(h.booking_date),
            amount: unpaid,
            totalGross: gross,
            agentFareAmount: 0,
            paidAmount: paid,
            tickets: 1,
            ticketRows: [],
            hotelRow: h,
            hasFeeRows: false
        });
    });

    const accountPnrCounts = new Map();
    const accountHotelCounts = new Map();
    groups.forEach(g => {
        if (g.isHotel) {
            accountHotelCounts.set(g.accountGroupKey, (accountHotelCounts.get(g.accountGroupKey) || 0) + 1);
        } else {
            accountPnrCounts.set(g.accountGroupKey, (accountPnrCounts.get(g.accountGroupKey) || 0) + 1);
        }
    });
    groups.forEach(g => {
        g.accountPnrCount = accountPnrCounts.get(g.accountGroupKey) || 0;
        g.accountHotelCount = accountHotelCounts.get(g.accountGroupKey) || 0;
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
let dashboardRenderFrame = null;
export function updateDashboardData() {
    if (!document.getElementById('home-view')?.classList.contains('active')) return;
    if (dashboardRenderFrame !== null) return;
    dashboardRenderFrame = requestAnimationFrame(() => {
        dashboardRenderFrame = null;
        if (document.getElementById('home-view')?.classList.contains('active')) renderDashboardData();
    });
}

function renderDashboardData() {
    const range = getDashboardDateRange();
    const prevRange = getPreviousDashboardRange(range);
    const ticketsInPeriod = activeTicketRowsInRange(range);
    const prevTicketsInPeriod = activeTicketRowsInRange(prevRange);

    // 1. Total Sales (Net amount + Date change fees)
    const curSales = ticketsInPeriod.filter(t => t.source !== 'self').reduce((sum, t) => sum + ticketSalesAmount(t), 0);
    const prevSales = prevTicketsInPeriod.filter(t => t.source !== 'self').reduce((sum, t) => sum + ticketSalesAmount(t), 0);

    // 2. Total Tickets (Count of Passenger Tickets)
    const curTickets = ticketsInPeriod.filter(t => !isFeeEntryRow(t) && !isCanceledTicket(t) && t.source !== 'self').length;
    const prevTickets = prevTicketsInPeriod.filter(t => !isFeeEntryRow(t) && !isCanceledTicket(t) && t.source !== 'self').length;

    // 3. Total Profit (total commission of the month + total extra fare + self purchased profit)
    const curCommission = ticketsInPeriod.filter(t => t.source !== 'self').reduce((sum, t) => sum + (Number(t.commission) || 0), 0) +
                         activeHotelRowsInRange(range).filter(h => h.source !== 'self').reduce((sum, h) => sum + (Number(h.commission) || 0), 0);
    const curExtraFare = ticketsInPeriod.filter(t => t.source !== 'self').reduce((sum, t) => sum + (Number(t.extra_fare) || 0), 0);

    // 3b. Self-Purchased Profit
    const curSelfHotelProfit = activeHotelRowsInRange(range).filter(h => h.source === 'self').reduce((sum, h) => sum + hotelProfitAmount(h), 0);
    const curSelfTicketProfit = ticketsInPeriod.filter(t => t.source === 'self').reduce((sum, t) => sum + ticketProfitAmount(t), 0);
    const curSelfProfit = curSelfHotelProfit + curSelfTicketProfit;

    const curProfit = curCommission + curExtraFare + curSelfProfit;

    // Previous period (for trend calculation)
    const prevCommission = prevTicketsInPeriod.filter(t => t.source !== 'self').reduce((sum, t) => sum + (Number(t.commission) || 0), 0) +
                          activeHotelRowsInRange(prevRange).filter(h => h.source !== 'self').reduce((sum, h) => sum + (Number(h.commission) || 0), 0);
    const prevExtraFare = prevTicketsInPeriod.filter(t => t.source !== 'self').reduce((sum, t) => sum + (Number(t.extra_fare) || 0), 0);
    
    const prevSelfHotelProfit = activeHotelRowsInRange(prevRange).filter(h => h.source === 'self').reduce((sum, h) => sum + hotelProfitAmount(h), 0);
    const prevSelfTicketProfit = prevTicketsInPeriod.filter(t => t.source === 'self').reduce((sum, t) => sum + ticketProfitAmount(t), 0);
    const prevSelfProfit = prevSelfHotelProfit + prevSelfTicketProfit;

    const prevProfit = prevCommission + prevExtraFare + prevSelfProfit;

    // 4. Remaining Due to Owner (scoped to active dashboard date range)
    const settleSummary = getSettlementSummary(range);
    const curRemainingDue = settleSummary.remainingDue;

    // Also gather data for side panels
    const unpaidGroups = groupUnpaidTickets(state.allTickets || []);
    const curUnpaid = unpaidGroups.reduce((sum, group) => sum + group.amount, 0);
    const upcomingTrips = getUpcomingTripGroups(7);
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
        
    setText('self-profit-value', formatDashboardAmount(curSelfProfit));
    setHtml('self-profit-trend-wrapper', getTrendBadgeHtml(curSelfProfit, prevSelfProfit));

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
    updatePaymentStatusChart();
    updateRoutePerformanceChart();
    updateAirlineChart();
    updateOwnerPayableChart();
    updateSettlementDashboard();
}

function wireDashboardPnrButtons(container) {
    // Buttons removed in favor of global .clickable-pnr listener
}

export function showTripPlanDetail(pnr) {
    const searchPnr = String(pnr || '').trim().toUpperCase();
    if (!searchPnr || searchPnr === 'NO PNR' || searchPnr === '—' || searchPnr === 'N/A') return;

    let allRows = (state.allTickets || []).filter(t =>
        String(t.booking_reference || '').trim().toUpperCase() === searchPnr &&
        !isCanceledTicket(t)
    );
    if (!allRows.length) {
        allRows = (state.allTickets || []).filter(t =>
            String(t.booking_reference || '').trim().toUpperCase() === searchPnr
        );
    }
    if (!allRows.length && Array.isArray(state.filteredTickets)) {
        allRows = (state.filteredTickets || []).filter(t =>
            String(t.booking_reference || '').trim().toUpperCase() === searchPnr
        );
    }
    if (!allRows.length) {
        showView('manage');
        findTicketForManage(pnr);
        return;
    }

    const passengerRows = allRows.filter(t => !isFeeEntryRow(t));
    const feeRows = allRows.filter(t => isFeeEntryRow(t));
    const lead = passengerRows[0] || allRows[0];
    const issuedDates = [...new Set((passengerRows.length ? passengerRows : allRows)
        .map(ticket => formatDashboardDateLabel(ticket.issued_date, ''))
        .filter(Boolean))];
    let accountName = allRows
        .map(t => String(t.account_name || '').trim())
        .find(name => name && name.toLowerCase() !== 'undefined') || '';
    let accountType = allRows
        .map(t => String(t.account_type || '').trim())
        .find(type => type && type.toLowerCase() !== 'undefined') || '';
    let accountLink = allRows
        .map(t => String(t.account_link || '').trim())
        .find(link => link && link.toLowerCase() !== 'undefined') || '';

    // If missing, look up client by accountName
    if ((!accountLink || !accountType) && accountName && Array.isArray(state.allClients)) {
        const clientByAcc = state.allClients.find(c => 
            String(c.account_name || '').trim().toLowerCase() === accountName.toLowerCase()
        );
        if (clientByAcc) {
            if (!accountLink && clientByAcc.account_link) accountLink = String(clientByAcc.account_link).trim();
            if (!accountType && clientByAcc.account_type) accountType = String(clientByAcc.account_type).trim();
        }
    }

    // If still missing, check bookings for this PNR
    if ((!accountLink || !accountType || !accountName) && Array.isArray(state.allBookings)) {
        const matchedBooking = state.allBookings.find(b => 
            String(b.booking_reference || '').trim().toUpperCase() === String(pnr || '').trim().toUpperCase()
        );
        if (matchedBooking) {
            if (!accountName && matchedBooking.account_name) accountName = String(matchedBooking.account_name).trim();
            if (!accountType && matchedBooking.account_type) accountType = String(matchedBooking.account_type).trim();
            if (!accountLink && matchedBooking.account_link) accountLink = String(matchedBooking.account_link).trim();
        }
    }

    // If still missing, check passenger names against state.allClients
    if ((!accountLink || !accountType) && Array.isArray(state.allClients)) {
        for (const t of allRows) {
            const rawPaxName = String(t.name || '').replace(/\s*\(fees\)\s*$/i, '').trim().toLowerCase();
            if (!rawPaxName) continue;
            const clientByName = state.allClients.find(c => 
                String(c.name || '').trim().toLowerCase() === rawPaxName &&
                !String(c.name || '').includes('(Fees)')
            );
            if (clientByName) {
                if (!accountLink && clientByName.account_link) accountLink = String(clientByName.account_link).trim();
                if (!accountType && clientByName.account_type) accountType = String(clientByName.account_type).trim();
                if (!accountName && clientByName.account_name) accountName = String(clientByName.account_name).trim();
                if (accountLink && accountType) break;
            }
        }
    }

    // If no explicit accountLink, check if accountName itself is a link, handle, or phone number
    if (!accountLink && accountName) {
        const cleanedDigits = accountName.replace(/[^\d+]/g, '');
        if (/^(\+?959|09|\d{7,12})$/.test(cleanedDigits) ||
            accountName.startsWith('@') ||
            /^(https?:\/\/|[a-z0-9-]+\.[a-z]{2,})/i.test(accountName)) {
            accountLink = accountName;
        }
    }

    const safeAccountLink = accountLink ? formatSafeAccountLink(accountLink, accountType) : '';
    const socialMeta = (accountType || accountLink) ? getSocialPlatformMeta(accountType, accountLink) : null;

    // Group passenger rows to avoid duplicating round-trip legs for the SAME passenger,
    // while keeping distinct passengers who share the same name completely separate!
    const passengerMap = new Map();
    passengerRows.forEach((t, idx) => {
        const baseName = String(t.name || '').replace(/\s*\(fees\)\s*$/i, '').trim();
        const leg = String(t.leg || '').toLowerCase(); // 'outbound' | 'return'
        const docId = String(t.id_no || t.nrc_no || t.passport_no || '').trim().toLowerCase();

        // 1. If explicit passenger_id exists, use it as unique identifier
        let key = t.passenger_id ? `pax:${t.passenger_id}` : '';

        // 2. If docId (NRC or passport) exists, identify by baseName + docId
        if (!key && docId) {
            key = `doc:${baseName.toLowerCase()}|${docId}`;
        }

        // 3. For round-trip bookings without passenger_id or docId:
        // Match return leg to an unpaired outbound leg entry with the same name
        if (!key && leg === 'return') {
            const matchingOutboundKey = [...passengerMap.keys()].find(k => {
                const item = passengerMap.get(k);
                return item.baseName.toLowerCase() === baseName.toLowerCase() && !item.hasReturn;
            });
            if (matchingOutboundKey) {
                key = matchingOutboundKey;
            }
        }

        // 4. Fallback: preserve distinct identity using ticket id/index so two people with the same name are NOT merged!
        if (!key) {
            key = `row:${baseName.toLowerCase()}|${t.id || idx}`;
        }

        if (!passengerMap.has(key)) {
            passengerMap.set(key, {
                name: t.name || 'Passenger',
                baseName,
                amount: 0,
                allPaid: true,
                tickets: [],
                hasReturn: leg === 'return',
                id_no: t.id_no || t.nrc_no || t.passport_no || '',
                client_key: t.client_key || '',
                passenger_id: t.passenger_id || ''
            });
        }
        const entry = passengerMap.get(key);
        if (leg === 'return') entry.hasReturn = true;
        entry.amount += ticketGrossAmount(t);
        if (!isTicketPaid(t)) entry.allPaid = false;
        if (t.ticket_number && t.ticket_number !== 'N/A') {
            if (!entry.tickets.includes(t.ticket_number)) {
                entry.tickets.push(t.ticket_number);
            }
        }
    });
    const uniquePassengers = [...passengerMap.values()];

    const passengerList = uniquePassengers.map(p => {
        const matchedClient = state.allClients?.find(c => {
            if (p.client_key && c.client_key === p.client_key) return true;
            if (p.id_no && (c.id_no === p.id_no || c.nrc_no === p.id_no || c.passport_no === p.id_no)) return true;
            return String(c.name || '').toLowerCase() === p.baseName.toLowerCase() && !String(c.name || '').includes('(Fees)');
        });
        const ck = matchedClient?.client_key || p.client_key || '';
        const nameHtml = ck
            ? `<a href="#" class="clickable-client-link pax-name-premium" data-client-key="${dashboardEscapeHtml(ck)}">${dashboardEscapeHtml(p.name)}</a>`
            : `<span class="pax-name-premium">${dashboardEscapeHtml(p.name)}</span>`;
        const initials = p.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'PA';
        const ticketList = p.tickets.filter(tn => tn !== 'N/A').join(', ') || 'N/A';
        return `
            <div class="pax-row-premium">
                <div class="pax-avatar">${initials}</div>
                <div class="pax-details-premium">
                    ${nameHtml}
                    <span class="pax-ticket-premium">Ticket: ${dashboardEscapeHtml(ticketList)}</span>
                </div>
                <div class="pax-finance-premium">
                    <span class="pax-amount-premium">${formatDashboardAmount(p.amount)} MMK</span>
                    <span class="pax-status-badge-premium ${p.allPaid ? 'paid' : 'unpaid'}">
                        <i class="fa-solid ${p.allPaid ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${p.allPaid ? 'Paid' : 'Unpaid'}
                    </span>
                </div>
            </div>
        `;
    }).join('');

function getFeeRowDateChangeText(t, allRows = []) {
    if (!t) return 'Date Change';

    const formatCleanDate = (val) => {
        if (!val) return '';
        const s = String(val).trim();
        if (s === '—' || s === 'N/A' || s === 'Date missing') return '';
        const parsed = parseSheetDate(s);
        if (parsed && !isNaN(parsed.getTime())) {
            return formatDateForSheet(parsed);
        }
        return s;
    };

    // 1. Direct explicit previous_date and new_date on ticket
    if (t.previous_date && (t.new_date || t.departing_on)) {
        const from = formatCleanDate(t.previous_date);
        const to = formatCleanDate(t.new_date || t.departing_on);
        if (from && to && from !== to) return `${from} → ${to}`;
    }

    // 2. Check if remarks already has explicit date change pattern (e.g. "15/10/2026 → 19/10/2026")
    const rawRemarks = String(t.remarks || '').trim();
    if (rawRemarks) {
        const arrowMatch = rawRemarks.match(/(\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3,4})[-/.]\d{2,4})\s*(?:→|->|to)\s*(\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3,4})[-/.]\d{2,4})/i);
        if (arrowMatch) {
            const from = formatCleanDate(arrowMatch[1]);
            const to = formatCleanDate(arrowMatch[2]);
            if (from && to) return `${from} → ${to}`;
        }
    }

    // 3. Search state.history for Travel Date modifications for this PNR
    const pnr = String(t.booking_reference || '').trim().toUpperCase();
    const baseName = String(t.name || '').replace(/\s*\(fees\)\s*$/i, '').trim().toUpperCase();

    if (Array.isArray(state.history) && state.history.length > 0 && pnr) {
        const matchingHistory = state.history.filter(h => {
            const hpnr = String(h.pnr || '').trim().toUpperCase();
            if (!hpnr || hpnr !== pnr) return false;
            const details = String(h.details || '');
            return details.includes('Travel Date:');
        });

        if (matchingHistory.length > 0) {
            // Find entry matching passenger name or fallback to latest matching PNR entry
            const entry = matchingHistory.find(h => {
                const hName = String(h.name || '').replace(/\s*\(fees\)\s*$/i, '').trim().toUpperCase();
                return hName && baseName && (hName.includes(baseName) || baseName.includes(hName));
            }) || matchingHistory[0];

            const details = String(entry.details || '');
            const dateMatch = details.match(/Travel Date:\s*([^;.\n]+?)\s+to\s+([^;.\n]+?)(?:[;.]|$)/i);
            if (dateMatch) {
                const from = formatCleanDate(dateMatch[1]);
                const to = formatCleanDate(dateMatch[2]);
                if (from && to) return `${from} → ${to}`;
            }
        }
    }

    // 4. Check against non-fee passenger tickets in allRows
    if (Array.isArray(allRows) && t.departing_on) {
        const passengerTicket = allRows.find(row => !isFeeEntryRow(row) && row.departing_on);
        if (passengerTicket && passengerTicket.departing_on) {
            const from = formatCleanDate(passengerTicket.departing_on);
            const to = formatCleanDate(t.departing_on);
            if (from && to && from !== to) return `${from} → ${to}`;
        }
    }

    // 5. If we only know destination date (departing_on)
    if (t.departing_on) {
        const to = formatCleanDate(t.departing_on);
        if (to) return `→ ${to}`;
    }

    // 6. Fallback if remarks was generic fee text: avoid noise
    if (rawRemarks.startsWith('Fee Entry')) {
        return 'Date Change';
    }

    return rawRemarks || 'Date Change';
}

    const feeList = feeRows.length ? feeRows.map(t => {
        const paid = isTicketPaid(t);
        const amount = ticketGrossAmount(t);
        const baseName = String(t.name || '').replace(/\s*\(fees\)\s*$/i, '').trim();
        const matchedClient = state.allClients.find(c => String(c.name || '').toLowerCase() === baseName.toLowerCase() && !String(c.name || '').includes('(Fees)'));
        const ck = matchedClient?.client_key || '';
        const nameHtml = ck
            ? `<a href="#" class="clickable-client-link pax-name-premium" data-client-key="${dashboardEscapeHtml(ck)}">${dashboardEscapeHtml(t.name || 'Fee')}</a>`
            : `<span class="pax-name-premium">${dashboardEscapeHtml(t.name || 'Fee')}</span>`;
        const dateChangeSub = getFeeRowDateChangeText(t, allRows);
        return `
            <div class="pax-row-premium">
                <div class="pax-avatar fee-avatar"><i class="fa-solid fa-tag"></i></div>
                <div class="pax-details-premium">
                    ${nameHtml}
                    <span class="pax-ticket-premium">${dashboardEscapeHtml(dateChangeSub)}</span>
                </div>
                <div class="pax-finance-premium">
                    <span class="pax-amount-premium">${formatDashboardAmount(amount)} MMK</span>
                    <span class="pax-status-badge-premium ${paid ? 'paid' : 'unpaid'}">
                        <i class="fa-solid ${paid ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${paid ? 'Paid' : 'Unpaid'}
                    </span>
                </div>
            </div>
        `;
    }).join('') : '';

    const totalUnpaid = allRows.filter(t => !isTicketPaid(t)).reduce((s, t) => s + ticketGrossAmount(t), 0);
    const totalAmount = allRows.reduce((s, t) => s + ticketGrossAmount(t), 0);
    const totalReceived = Math.max(0, totalAmount - totalUnpaid);
    const totalProfit = allRows.reduce((s, t) => s + (Number(t.commission) || 0) + (Number(t.extra_fare) || 0), 0);
    const isLargePax = uniquePassengers.length >= 4;

    // Separate Booking / Ticket Status
    const allPnrTickets = (state.allTickets || []).filter(t =>
        String(t.booking_reference || '').trim().toUpperCase() === searchPnr
    );
    const baseTickets = allPnrTickets.length ? allPnrTickets : allRows;
    const canceledCount = baseTickets.filter(t => isCanceledTicket(t)).length;
    let bookingStatusHtml = '';
    if (canceledCount === baseTickets.length && baseTickets.length > 0) {
        bookingStatusHtml = `<span class="pnr-status-badge pnr-status-booking-canceled" title="Booking status: Canceled"><i class="fa-solid fa-ban"></i> Canceled</span>`;
    } else if (canceledCount > 0) {
        bookingStatusHtml = `<span class="pnr-status-badge pnr-status-booking-partial" title="Booking status: Partially Canceled"><i class="fa-solid fa-triangle-exclamation"></i> Partial Cancel</span>`;
    } else {
        bookingStatusHtml = `<span class="pnr-status-badge pnr-status-booking-confirmed" title="Booking status: Confirmed"><i class="fa-solid fa-circle-check"></i> Confirmed</span>`;
    }

    // Separate Payment Status
    let paymentStatusHtml = '';
    if (totalUnpaid === 0 && totalAmount > 0) {
        paymentStatusHtml = `<span class="pnr-status-badge pnr-status-payment-paid" title="Payment status: Fully Paid"><i class="fa-solid fa-circle-check"></i> Paid</span>`;
    } else if (totalUnpaid > 0 && totalReceived > 0) {
        paymentStatusHtml = `<span class="pnr-status-badge pnr-status-payment-partial" title="Payment status: Partially Paid"><i class="fa-solid fa-clock"></i> Partial</span>`;
    } else if (totalAmount === 0) {
        paymentStatusHtml = `<span class="pnr-status-badge pnr-status-payment-paid" title="Payment status: Paid"><i class="fa-solid fa-circle-check"></i> Paid</span>`;
    } else {
        paymentStatusHtml = `<span class="pnr-status-badge pnr-status-payment-unpaid" title="Payment status: Unpaid"><i class="fa-solid fa-circle-exclamation"></i> Unpaid</span>`;
    }

    const pnrSectors = getPnrSectors(allRows);
    const pnrRouteDisplay = getPnrRouteDisplay(allRows);
    const pnrTravelDateDisplay = getPnrTravelDateDisplay(allRows);
    const uniqueAirlines = [...new Set(allRows.map(t => String(t.airline || '').trim()).filter(Boolean))];
    const airlinesLabel = uniqueAirlines.join(' / ') || lead.airline || '';

    const isIntlFlight = isInternationalFlightRoute(lead.departure, lead.destination, pnrSectors);
    const msgPassengers = uniquePassengers.map(p => ({
        name: p.name || 'Passenger',
        extra: p.ticketNumber && p.ticketNumber !== 'Issued' ? `Ticket: ${p.ticketNumber}` : ''
    }));
    const customerMsgMm = buildCustomerMessage({
        mode: 'ticket',
        lang: 'mm',
        pnr: searchPnr,
        airline: airlinesLabel,
        routeText: pnrRouteDisplay,
        departure: lead.departure || '',
        destination: lead.destination || '',
        travelDate: pnrTravelDateDisplay || lead.departing_on || '',
        legs: pnrSectors,
        passengers: msgPassengers
    });
    const customerMsgEn = buildCustomerMessage({
        mode: 'ticket',
        lang: 'en',
        pnr: searchPnr,
        airline: airlinesLabel,
        routeText: pnrRouteDisplay,
        departure: lead.departure || '',
        destination: lead.destination || '',
        travelDate: pnrTravelDateDisplay || lead.departing_on || '',
        legs: pnrSectors,
        passengers: msgPassengers
    });

    const sectorsHtml = (pnrSectors.length > 0 ? pnrSectors : [{ departure: lead.departure, destination: lead.destination }]).map(sec => `
        <div class="pnr-route-pill">
            <span class="pnr-route-code" title="${dashboardEscapeHtml(sec.departure || 'Departure')}">${dashboardEscapeHtml(compactPlace(sec.departure) || 'N/A')}</span>
            <div class="pnr-route-arrow-flow" aria-hidden="true">
                <span class="pnr-flow-line"></span>
                <i class="fa-solid fa-plane pnr-flow-icon"></i>
                <span class="pnr-flow-line"></span>
            </div>
            <span class="pnr-route-code" title="${dashboardEscapeHtml(sec.destination || 'Destination')}">${dashboardEscapeHtml(compactPlace(sec.destination) || 'N/A')}</span>
        </div>
    `).join('<span class="pnr-sector-divider" style="color:var(--dash-text-muted, #94a3b8); font-weight:700; font-size:16px; margin:0 2px;">/</span>');

    const airlinesHtml = uniqueAirlines.length > 0
        ? uniqueAirlines.map(a => renderAirlineName(a, { size: 'sm' })).join('<span style="color:var(--dash-text-muted, #94a3b8); margin:0 4px;">•</span>')
        : renderAirlineName(lead.airline || 'Airline', { size: 'sm' });

    const content = `
        <div class="trip-detail-modal-container">
            <!-- Toolbar -->
            <div class="pnr-dialog-toolbar">
                <div class="pnr-toolbar-title-group">
                    <span class="pnr-toolbar-title">Booking Details</span>
                    ${isLargePax ? `<span class="pnr-toolbar-badge">${uniquePassengers.length} Passengers</span>` : ''}
                </div>
                <div class="pnr-toolbar-actions-group">
                    ${isLargePax ? `
                    <button type="button" class="pnr-toolbar-jump-btn" id="tripPlanJumpManageTopBtn" title="Open full management page">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> Full Detail
                    </button>` : ''}
                    <button type="button" id="tripPlanTopCloseBtn" class="pnr-close-circle-btn" aria-label="Close booking details">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            <!-- 1. Top Section: PNR, Route, Airline, Statuses -->
            <div class="pnr-modal-top-card">
                <div class="pnr-top-flight-bar">
                    <div class="pnr-routes-cluster" style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        ${sectorsHtml}
                    </div>
                    <div class="pnr-airline-box">
                        ${airlinesHtml}
                    </div>
                </div>

                <div class="pnr-top-code-status-grid">
                    <div class="pnr-code-cell">
                        <span class="pnr-mini-label">Booking Reference (PNR)</span>
                        <div class="pnr-value-row">
                            <strong class="pnr-value-large">${dashboardEscapeHtml(pnr)}</strong>
                            <button type="button" class="pnr-icon-action-btn" id="tripPnrCopyBtn" title="Copy PNR to clipboard" aria-label="Copy PNR">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                            <button type="button" class="pnr-phonetic-btn" id="tripPnrPhoneticToggle" title="Spell PNR phonetically" aria-expanded="false" aria-label="Spell PNR phonetically">
                                <i class="fa-solid fa-spell-check"></i>
                            </button>
                        </div>
                        ${renderPhoneticExpansionHtml(pnr, 'tripPnrPhoneticPanel')}
                    </div>

                    <div class="pnr-status-cell">
                        <span class="pnr-mini-label">Statuses</span>
                        <div class="pnr-dual-status-cluster">
                            <div class="pnr-status-pair">
                                <span class="pnr-status-caption">Booking</span>
                                ${bookingStatusHtml}
                            </div>
                            <div class="pnr-status-pair">
                                <span class="pnr-status-caption">Payment</span>
                                ${paymentStatusHtml}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 2. Middle Section: Travel/Issued Dates & Contact Account -->
            <div class="pnr-modal-middle-card">
                <div class="pnr-meta-grid">
                    <div class="pnr-meta-cell">
                        <span class="pnr-meta-label"><i class="fa-regular fa-calendar"></i> Travel Date</span>
                        <strong class="pnr-meta-val">${dashboardEscapeHtml(pnrTravelDateDisplay || lead.departing_on || 'N/A')}</strong>
                    </div>
                    <div class="pnr-meta-cell">
                        <span class="pnr-meta-label"><i class="fa-regular fa-calendar-check"></i> Issued Date${issuedDates.length > 1 ? 's' : ''}</span>
                        <strong class="pnr-meta-val">${dashboardEscapeHtml(issuedDates.join(', ') || 'N/A')}</strong>
                    </div>
                    <div class="pnr-meta-cell pnr-meta-contact-cell">
                        <span class="pnr-meta-label"><i class="fa-solid fa-address-book"></i> Contact Account</span>
                        <div class="pnr-contact-row">
                            <strong class="pnr-contact-client-name" title="${dashboardEscapeHtml(accountName || accountLink)}">${dashboardEscapeHtml(accountName || 'Client')}</strong>
                            ${safeAccountLink && socialMeta ? `
                            <a href="${dashboardEscapeHtml(safeAccountLink)}"
                               target="_blank"
                               rel="noopener noreferrer"
                               class="pnr-social-link-btn"
                               title="Open ${dashboardEscapeHtml(socialMeta.label)}: ${dashboardEscapeHtml(accountLink)}"
                               style="--platform-color: ${socialMeta.color}; --platform-bg: ${socialMeta.badgeBg};"
                               onclick="event.stopPropagation();"
                               aria-label="Open ${dashboardEscapeHtml(socialMeta.label)}">
                                <i class="${socialMeta.icon}" aria-hidden="true"></i>
                                <span class="pnr-social-link-label">${dashboardEscapeHtml(socialMeta.label)}</span>
                                <i class="fa-solid fa-arrow-up-right-from-square pnr-social-link-arrow" aria-hidden="true"></i>
                            </a>` : (socialMeta && accountType ? `
                            <span class="pnr-social-platform-pill" style="--platform-color: ${socialMeta.color}; --platform-bg: ${socialMeta.badgeBg};">
                                <i class="${socialMeta.icon}" aria-hidden="true"></i>
                                <span>${dashboardEscapeHtml(socialMeta.label)}</span>
                            </span>` : '')}
                        </div>
                    </div>
                </div>
            </div>

            <!-- 3. Passenger List -->
            <div class="pnr-modal-roster-card">
                <div class="pnr-roster-header-bar">
                    <span class="pnr-roster-title"><i class="fa-solid fa-user-check"></i> Passenger List</span>
                    <span class="pnr-roster-pax-count">${uniquePassengers.length} ${uniquePassengers.length === 1 ? 'Passenger' : 'Passengers'}</span>
                </div>
                <div class="pnr-roster-body ${isLargePax ? 'pnr-scrollable-roster' : ''}">
                    <div class="passengers-list-premium">
                        ${passengerList || '<div class="empty-list-msg">No passenger tickets found.</div>'}
                    </div>
                    ${feeList ? `
                    <div class="pnr-roster-addons-wrap">
                        <div class="pnr-addon-label"><i class="fa-solid fa-tags"></i> Add-ons & Adjustments</div>
                        <div class="passengers-list-premium">
                            ${feeList}
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>

            <!-- 4. Bottom Section: Total, Received, Outstanding, 1-Click Customer Message & Primary Actions -->
            <div class="pnr-modal-bottom-card">
                <div class="pnr-settlement-row">
                    <div class="pnr-settlement-cell">
                        <span class="pnr-settlement-label">Total Booking</span>
                        <strong class="pnr-settlement-val">${formatDashboardAmount(totalAmount)} <span class="pnr-settlement-curr">MMK</span></strong>
                    </div>
                    <div class="pnr-settlement-cell">
                        <span class="pnr-settlement-label">Received</span>
                        <strong class="pnr-settlement-val ${totalReceived > 0 ? 'pnr-val-received' : ''}">${formatDashboardAmount(totalReceived)} <span class="pnr-settlement-curr">MMK</span></strong>
                    </div>
                    <div class="pnr-settlement-cell">
                        <span class="pnr-settlement-label">Total Profit</span>
                        <strong class="pnr-settlement-val ${totalProfit < 0 ? 'pnr-val-outstanding' : 'pnr-val-profit'}" style="color: ${totalProfit < 0 ? '#dc2626' : '#059669'};">
                            ${formatDashboardAmount(totalProfit)} <span class="pnr-settlement-curr">MMK</span>
                        </strong>
                    </div>
                </div>

                <!-- 1-Click Copy Customer Message Bar -->
                <div class="pnr-customer-msg-bar">
                    <div class="pnr-customer-msg-info">
                        <span class="pnr-customer-msg-title"><i class="fa-regular fa-comment-dots"></i> Customer Message</span>
                        <span class="pnr-customer-msg-badge ${isIntlFlight ? 'intl' : 'dom'}">
                            <i class="fa-solid ${isIntlFlight ? 'fa-earth-asia' : 'fa-plane-up'}"></i>
                            ${isIntlFlight ? 'International • 3h Check-in' : 'Domestic • 2h Check-in'}
                        </span>
                    </div>
                    <div class="pnr-customer-msg-actions">
                        <button type="button" class="pnr-msg-copy-btn primary" id="tripCopyMsgMmBtn" title="1-Click Copy Myanmar Message for Customer">
                            <i class="fa-solid fa-copy"></i> Copy Message (MM)
                        </button>
                        <button type="button" class="pnr-msg-copy-btn" id="tripCopyMsgEnBtn" title="1-Click Copy English Message for Customer">
                            <i class="fa-regular fa-copy"></i> Copy (EN)
                        </button>
                        <button type="button" class="pnr-msg-copy-btn icon-only" id="tripToggleMsgPreviewBtn" title="Preview / Customize Customer Message" aria-expanded="false">
                            <i class="fa-regular fa-eye"></i>
                        </button>
                    </div>
                </div>
                <div class="pnr-customer-msg-preview" id="tripCustomerMsgPreviewWrap" hidden>
                    <textarea id="tripCustomerMsgTextarea" rows="7" class="pnr-customer-msg-textarea">${dashboardEscapeHtml(customerMsgMm)}</textarea>
                </div>

                <div class="pnr-modal-footer-actions">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary pnr-footer-btn-copy" id="tripPnrCopyBtnBottom">
                            <i class="fa-regular fa-copy"></i> Copy PNR
                        </button>
                        ${totalUnpaid > 0 ? `
                        <button type="button" class="btn btn-secondary pnr-footer-btn-reminder" id="tripPlanReminderCardBtn" title="Generate Consolidated Payment Reminder Card (PNG / PDF) for this Account">
                            <i class="fa-solid fa-file-invoice-dollar"></i> Payment Reminder Card
                        </button>
                        ` : ''}
                    </div>
                    <div class="pnr-footer-action-right">
                        <button type="button" class="btn btn-secondary" id="tripPlanCloseBtn">Done</button>
                        <button type="button" class="btn btn-primary pnr-footer-btn-manage" id="tripPlanManageActionBtn">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i> Open Full Detail
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const modalDialogClass = isLargePax
        ? 'solid-modal pnr-detail-dialog pnr-side-panel'
        : 'solid-modal pnr-detail-dialog';

    openModal(content, modalDialogClass);
    wirePhoneticToggle('tripPnrPhoneticToggle', 'tripPnrPhoneticPanel');

    let activeMsgLang = 'mm';
    const previewWrap = document.getElementById('tripCustomerMsgPreviewWrap');
    const previewTextarea = document.getElementById('tripCustomerMsgTextarea');
    const copyMsgMmBtn = document.getElementById('tripCopyMsgMmBtn');
    const copyMsgEnBtn = document.getElementById('tripCopyMsgEnBtn');
    const togglePreviewBtn = document.getElementById('tripToggleMsgPreviewBtn');

    const handleCopyCustomerMsg = async (lang, btnEl) => {
        const defaultText = lang === 'en' ? customerMsgEn : customerMsgMm;
        const textToCopy = (previewWrap && !previewWrap.hidden && previewTextarea && activeMsgLang === lang)
            ? previewTextarea.value
            : defaultText;
        if (previewTextarea && activeMsgLang !== lang) {
            previewTextarea.value = defaultText;
        }
        activeMsgLang = lang;
        const ok = await copyCustomerMessageToClipboard(textToCopy);
        if (ok) {
            showToast(lang === 'en' ? 'Customer message (English) copied!' : 'Customer ဆီပို့ရန် မြန်မာစာသား ကူးယူပြီးပါပြီ!', 'success');
            if (btnEl) {
                const origHtml = btnEl.innerHTML;
                btnEl.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                setTimeout(() => { btnEl.innerHTML = origHtml; }, 1800);
            }
        }
    };

    copyMsgMmBtn?.addEventListener('click', () => handleCopyCustomerMsg('mm', copyMsgMmBtn));
    copyMsgEnBtn?.addEventListener('click', () => handleCopyCustomerMsg('en', copyMsgEnBtn));
    togglePreviewBtn?.addEventListener('click', () => {
        if (!previewWrap) return;
        const nextHidden = !previewWrap.hidden;
        previewWrap.hidden = nextHidden;
        togglePreviewBtn.setAttribute('aria-expanded', String(!nextHidden));
    });

    const handleCopyPnr = async () => {
        try {
            await navigator.clipboard.writeText(searchPnr);
            showToast(`PNR ${searchPnr} copied to clipboard!`, 'success');
        } catch (e) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = searchPnr;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast(`PNR ${searchPnr} copied to clipboard!`, 'success');
            } catch (fallbackErr) {
                showToast(`PNR: ${searchPnr}`, 'info');
            }
        }
    };

    const handleJumpManage = () => {
        closeModal();
        showView('manage');
        findTicketForManage(searchPnr);
    };

    document.getElementById('tripPlanTopCloseBtn')?.addEventListener('click', closeModal);
    document.getElementById('tripPlanCloseBtn')?.addEventListener('click', closeModal);
    document.getElementById('tripPnrCopyBtn')?.addEventListener('click', handleCopyPnr);
    document.getElementById('tripPnrCopyBtnBottom')?.addEventListener('click', handleCopyPnr);
    document.getElementById('tripPlanManageActionBtn')?.addEventListener('click', handleJumpManage);
    document.getElementById('tripPlanJumpManageTopBtn')?.addEventListener('click', handleJumpManage);
    document.getElementById('tripPlanReminderCardBtn')?.addEventListener('click', () => {
        const cleanAcc = (accountName && accountName.toLowerCase() !== 'undefined')
            ? accountName.trim().toLowerCase()
            : String(lead.name || '').replace(/\s*\(\s*(fees|balance)\s*\)\s*$/i, '').trim().toLowerCase();
        openPaymentReminderCardModal({ accountKey: cleanAcc, pnr: searchPnr });
    });

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

window.showTripPlanDetail = showTripPlanDetail;

function renderDashboardTravelSchedule(groups) {
    const container = document.getElementById('dashboardTravelSchedule');
    if (!container) return;

    if (!groups.length) {
        container.innerHTML = `
            <div class="dashboard-empty-panel">
                <span class="mini-travel-illustration" aria-hidden="true"></span>
                <strong>No upcoming travel</strong>
                <span>No ticket travel dates are scheduled in the next 7 days.</span>
            </div>
        `;
        return;
    }

    // Render every upcoming trip; the panel itself is height-locked so only
    // ~5 rows are visible and the rest are reached via internal vertical scroll.
    container.innerHTML = groups.map(group => {
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
                    <small>${renderAirlineName(group.airline, { size: 'xs' })}</small>
                </div>
                <button type="button" class="dashboard-row-action" data-dashboard-pnr="${dashboardEscapeHtml(group.pnr)}">View</button>
            </div>
        `;
    }).join('');
    wireDashboardPnrButtons(container);
}

let dashboardUnpaidSearchTerm = '';
let dashboardUnpaidViewMode = 'pnr'; // 'pnr' | 'account'
let dashboardUnpaidTypeFilter = 'all'; // 'all' | 'ticket' | 'hotel'

function consolidateUnpaidByAccount(groups) {
    const accountMap = new Map();
    groups.forEach(g => {
        const key = g.accountGroupKey || String(g.socialAccount || g.client || g.pnr).toLowerCase();
        if (!accountMap.has(key)) {
            accountMap.set(key, {
                accountGroupKey: key,
                accountDisplayLabel: g.accountDisplayLabel || g.socialAccount || g.client || 'Customer',
                socialAccount: g.socialAccount || '',
                accountType: g.accountType || '',
                accountLink: g.accountLink || '',
                pnrGroups: [],
                hotelGroups: [],
                pnrList: [],
                clientsSet: new Set(),
                totalGross: 0,
                agentFareAmount: 0,
                paidAmount: 0,
                unpaidAmount: 0,
                ticketCount: 0,
                hotelCount: 0,
                earliestDue: null
            });
        }
        const entry = accountMap.get(key);
        if (g.isHotel) {
            entry.hotelGroups.push(g);
            entry.hotelCount += 1;
        } else {
            entry.pnrGroups.push(g);
            entry.pnrList.push(g.pnr);
            entry.ticketCount += Number(g.tickets) || 1;
        }
        if (g.client) entry.clientsSet.add(g.client);
        entry.totalGross += Number(g.totalGross) || Number(g.amount) || 0;
        entry.agentFareAmount += Number(g.agentFareAmount) || 0;
        entry.paidAmount += Number(g.paidAmount) || 0;
        entry.unpaidAmount += Number(g.amount) || 0;
        if (g.dueDate?.getTime?.()) {
            if (!entry.earliestDue || g.dueDate < entry.earliestDue) {
                entry.earliestDue = g.dueDate;
            }
        }
    });

    accountMap.forEach(entry => {
        const groupTickets = entry.pnrGroups.flatMap(g => g.ticketRows || []);
        const totalAccountUnsettledAgentFare = getAccountUnsettledAgentFare(
            entry.socialAccount || entry.accountDisplayLabel,
            groupTickets
        );
        if (totalAccountUnsettledAgentFare > entry.agentFareAmount) {
            entry.agentFareAmount = totalAccountUnsettledAgentFare;
        }
        entry.unpaidAmount = Math.max(0, entry.totalGross - entry.agentFareAmount - entry.paidAmount);
    });

    return [...accountMap.values()].sort((a, b) => {
        const aCount = a.pnrGroups.length + a.hotelCount;
        const bCount = b.pnrGroups.length + b.hotelCount;
        if (bCount !== aCount) return bCount - aCount;
        return b.unpaidAmount - a.unpaidAmount;
    });
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
                <strong>No unpaid bookings</strong>
                <span>All tickets and hotel stays are marked paid.</span>
            </div>
        `;
        return;
    }

    const ticketCount = groups.filter(g => !g.isHotel).length;
    const hotelCount = groups.filter(g => g.isHotel).length;
    const totalCount = groups.length;

    // Filter by type (all / tickets / hotels)
    let typeFiltered = groups;
    if (dashboardUnpaidTypeFilter === 'ticket') {
        typeFiltered = typeFiltered.filter(g => !g.isHotel);
    } else if (dashboardUnpaidTypeFilter === 'hotel') {
        typeFiltered = typeFiltered.filter(g => g.isHotel);
    }

    // Filter groups by search term if provided
    const term = (dashboardUnpaidSearchTerm || '').toLowerCase().trim();
    const filteredGroups = term
        ? typeFiltered.filter(g =>
            String(g.pnr || '').toLowerCase().includes(term) ||
            String(g.client || '').toLowerCase().includes(term) ||
            String(g.rawClient || '').toLowerCase().includes(term) ||
            String(g.socialAccount || '').toLowerCase().includes(term) ||
            String(g.rawPassenger || '').toLowerCase().includes(term) ||
            String(g.hotelName || '').toLowerCase().includes(term) ||
            String(g.city || '').toLowerCase().includes(term) ||
            String(g.route || '').toLowerCase().includes(term)
        )
        : typeFiltered;

    const consolidatedAccounts = consolidateUnpaidByAccount(filteredGroups);
    const multiTicketAccountCount = consolidateUnpaidByAccount(groups).filter(a => (a.pnrGroups.length + a.hotelCount) > 1).length;

    let tableHeadHtml = '';
    let tableRowsHtml = '';

    if (dashboardUnpaidViewMode === 'account') {
        tableHeadHtml = `
            <tr>
                <th>ACCOUNT / CUSTOMER</th>
                <th>UNPAID BOOKINGS</th>
                <th>TOTAL / PAID</th>
                <th>BALANCE DUE</th>
                <th>ACTION</th>
            </tr>
        `;
        tableRowsHtml = consolidatedAccounts.map(acc => {
            const pnrBadges = acc.pnrList.slice(0, 4).map(p =>
                `<a href="#" class="clickable-pnr" data-pnr="${dashboardEscapeHtml(p)}">${dashboardEscapeHtml(p)}</a>`
            ).join(' ');
            const extraPnrs = acc.pnrList.length > 4 ? ` <small>+${acc.pnrList.length - 4}</small>` : '';

            const hotelBadges = (acc.hotelGroups || []).slice(0, 3).map(h =>
                `<a href="#" class="clickable-hotel-ref" data-hotel-id="${h.hotelId}" style="display:inline-flex; align-items:center; gap:3px; background:rgba(13,110,119,0.12); color:#0D6E77; border-radius:4px; padding:2px 6px; font-weight:600; font-size:11px;"><i class="fa-solid fa-hotel"></i> ${dashboardEscapeHtml(h.pnr || h.hotelName)}</a>`
            ).join(' ');
            const extraHotels = (acc.hotelGroups || []).length > 3 ? ` <small>+${acc.hotelGroups.length - 3}</small>` : '';

            const bookingCountParts = [];
            if (acc.pnrGroups.length > 0) bookingCountParts.push(`${acc.pnrGroups.length} PNR${acc.pnrGroups.length > 1 ? 's' : ''}`);
            if (acc.hotelCount > 0) bookingCountParts.push(`${acc.hotelCount} Hotel Stay${acc.hotelCount > 1 ? 's' : ''}`);

            const passengerPreview = [...acc.clientsSet].slice(0, 2).join(', ');
            return `
                <tr>
                    <td>
                        <div class="unpaid-client-primary">${dashboardEscapeHtml(acc.accountDisplayLabel)}</div>
                        ${passengerPreview && passengerPreview.toLowerCase() !== acc.accountDisplayLabel.toLowerCase()
                            ? `<div class="unpaid-account-sub"><i class="fa-regular fa-user"></i> ${dashboardEscapeHtml(passengerPreview)}</div>`
                            : ''}
                    </td>
                    <td>
                        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                            ${pnrBadges}${extraPnrs}${hotelBadges}${extraHotels}
                        </div>
                        <div class="unpaid-account-sub">${bookingCountParts.join(' • ')}</div>
                    </td>
                    <td class="num">
                        <div style="font-size:0.75rem; color:var(--dash-text-muted);">Total: ${formatDashboardAmount(acc.totalGross)}</div>
                        ${acc.agentFareAmount > 0 ? `<div style="font-size:0.75rem; color:#D97706;">Agent Fare: -${formatDashboardAmount(acc.agentFareAmount)}</div>` : ''}
                        <div style="font-size:0.75rem; color:#059669;">Paid: ${formatDashboardAmount(acc.paidAmount)}</div>
                    </td>
                    <td class="num"><strong>${formatDashboardAmount(acc.unpaidAmount)} MMK</strong></td>
                    <td>
                        <div class="unpaid-row-actions">
                            <button type="button" class="dashboard-row-action reminder-card-btn primary-pill" data-reminder-account="${dashboardEscapeHtml(acc.accountGroupKey)}" title="1-Click Payment Reminder Card (PNG / PDF)">
                                <i class="fa-solid fa-file-invoice-dollar"></i> Card
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } else {
        tableHeadHtml = `
            <tr>
                <th>PNR / REF</th>
                <th>CLIENT / ACCOUNT</th>
                <th>ROUTE / HOTEL</th>
                <th>AMOUNT DUE</th>
                <th>ACTION</th>
            </tr>
        `;
        tableRowsHtml = filteredGroups.map(group => {
            if (group.isHotel) {
                return `
                    <tr>
                        <td>
                            <div style="display:flex; flex-direction:column; gap:2px; align-items:flex-start;">
                                <span class="unpaid-tag-hotel"><i class="fa-solid fa-hotel"></i> Hotel</span>
                                <strong><a href="#" class="clickable-hotel-ref" data-hotel-id="${group.hotelId}">${dashboardEscapeHtml(group.pnr)}</a></strong>
                            </div>
                        </td>
                        <td>
                            <div class="unpaid-client-primary">${dashboardEscapeHtml(group.client)}</div>
                            ${group.socialAccount && group.socialAccount.toLowerCase() !== group.client.toLowerCase()
                                ? `<div class="unpaid-account-sub"><i class="fa-solid fa-at"></i> ${dashboardEscapeHtml(group.socialAccount)}</div>`
                                : ''}
                        </td>
                        <td>
                            <div class="unpaid-route-stack">
                                <div class="unpaid-route-line" title="${dashboardEscapeHtml(group.hotelName)}">
                                    <i class="fa-solid fa-hotel" style="color:#0D6E77; margin-right:4px;"></i> <strong>${dashboardEscapeHtml(group.hotelName)}</strong>${group.city ? ` <small style="color:var(--dash-text-muted);">(${dashboardEscapeHtml(group.city)})</small>` : ''}
                                </div>
                                <div class="unpaid-route-line return-line" style="font-size:0.75rem; color:var(--dash-text-muted);">
                                    <i class="fa-regular fa-calendar-days" style="margin-right:4px;"></i> ${dashboardEscapeHtml(group.travelDateStr || 'Stay')}
                                </div>
                            </div>
                        </td>
                        <td class="num">
                            <strong>${formatDashboardAmount(group.amount)} MMK</strong>
                            <span class="payment-badge payment-${group.hotelRow?.paid || 'unpaid'}" style="font-size:10px; margin-left:4px; padding:2px 6px; text-transform:capitalize;">${group.hotelRow?.paid === 'partial' ? 'Partial' : 'Unpaid'}</span>
                        </td>
                        <td>
                            <div class="unpaid-row-actions">
                                <button type="button" class="dashboard-row-action reminder-card-btn" data-reminder-account="${dashboardEscapeHtml(group.accountGroupKey)}" data-reminder-pnr="${dashboardEscapeHtml(group.pnr)}" title="Payment Reminder Card for ${dashboardEscapeHtml(group.client)}">
                                    <i class="fa-solid fa-file-invoice-dollar"></i>
                                </button>
                                <button type="button" class="dashboard-row-action clickable-hotel-ref" data-hotel-id="${group.hotelId}" title="View Hotel Reservation Details">
                                    <i class="fa-solid fa-eye"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }

            const feeBadge = group.hasFeeRows
                ? `<span class="unpaid-tag-fee" title="Includes Date Change or Fee Entry">Fee</span>`
                : '';
            const showSocialSub = (group.socialAccount && group.socialAccount.toLowerCase() !== group.client.toLowerCase()) || group.accountPnrCount > 1;
            const socialSubHtml = showSocialSub
                ? `<div class="unpaid-account-sub" title="Social Media Account: ${dashboardEscapeHtml(group.accountDisplayLabel)}">
                    <i class="fa-solid fa-at"></i> ${dashboardEscapeHtml(group.accountDisplayLabel)}
                    ${group.accountPnrCount > 1 ? `<span class="unpaid-multi-count" title="Same account has ${group.accountPnrCount} unpaid PNRs">${group.accountPnrCount} PNRs</span>` : ''}
                   </div>`
                : '';
            return `
                <tr>
                    <td><strong><a href="#" class="clickable-pnr" data-pnr="${dashboardEscapeHtml(group.pnr)}">${dashboardEscapeHtml(group.pnr)}</a></strong></td>
                    <td>
                        <div class="unpaid-client-primary">${dashboardEscapeHtml(group.client)}</div>
                        ${socialSubHtml}
                    </td>
                    <td>
                        <div class="unpaid-route-stack">
                            ${(group.sectors && group.sectors.length > 0 ? group.sectors : [{ departure: group.route }]).map((sec, sIdx) => `
                                <div class="unpaid-route-line${sIdx > 0 ? ' return-line' : ''}" title="${sec.destination ? `${dashboardEscapeHtml(sec.departure)} → ${dashboardEscapeHtml(sec.destination)}` : dashboardEscapeHtml(sec.departure || '')}">
                                    ${sec.destination ? `${dashboardEscapeHtml(compactPlace(sec.departure))} → ${dashboardEscapeHtml(compactPlace(sec.destination))}` : dashboardEscapeHtml(sec.departure || '—')}
                                </div>
                            `).join('')}
                        </div>
                    </td>
                    <td class="num">${formatDashboardAmount(group.amount)} MMK ${feeBadge}</td>
                    <td>
                        <div class="unpaid-row-actions">
                            <button type="button" class="dashboard-row-action reminder-card-btn" data-reminder-account="${dashboardEscapeHtml(group.accountGroupKey)}" data-reminder-pnr="${dashboardEscapeHtml(group.pnr)}" title="Payment Reminder Card (PNG / PDF) for ${dashboardEscapeHtml(group.accountDisplayLabel)}${group.accountPnrCount > 1 ? ` (${group.accountPnrCount} unpaid PNRs)` : ''}">
                                <i class="fa-solid fa-file-invoice-dollar"></i>
                            </button>
                            <button type="button" class="dashboard-row-action" data-dashboard-pnr="${dashboardEscapeHtml(group.pnr)}" title="View PNR details">
                                <i class="fa-solid fa-eye"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    container.innerHTML = `
        <div class="unpaid-summary-grid">
            <div><span>Total Unpaid</span><strong>${formatDashboardAmount(totalAmount)}</strong><small>MMK</small></div>
            <div><span>Overdue</span><strong>${overdue.length}</strong><small>Bookings</small></div>
            <div><span>Due Today</span><strong>${dueToday.length}</strong><small>Bookings</small></div>
            <div><span>Due This Week</span><strong>${dueThisWeek.length}</strong><small>Bookings</small></div>
        </div>
        <div class="dashboard-unpaid-toolbar">
            <input type="text" id="dashboardUnpaidSearch" placeholder="Filter PNR, hotel, client, or route..." value="${dashboardEscapeHtml(dashboardUnpaidSearchTerm)}">
            <div class="unpaid-view-mode-switch" role="group" aria-label="Type filter">
                <button type="button" class="unpaid-mode-btn ${dashboardUnpaidTypeFilter === 'all' ? 'active' : ''}" data-unpaid-type="all">
                    All (${totalCount})
                </button>
                <button type="button" class="unpaid-mode-btn ${dashboardUnpaidTypeFilter === 'ticket' ? 'active' : ''}" data-unpaid-type="ticket">
                    <i class="fa-solid fa-plane"></i> Tickets (${ticketCount})
                </button>
                <button type="button" class="unpaid-mode-btn ${dashboardUnpaidTypeFilter === 'hotel' ? 'active' : ''}" data-unpaid-type="hotel">
                    <i class="fa-solid fa-hotel"></i> Hotels ${hotelCount > 0 ? `<span class="unpaid-mode-badge">${hotelCount}</span>` : ''}
                </button>
            </div>
            <div class="unpaid-view-mode-switch" role="group" aria-label="Unpaid view mode">
                <button type="button" class="unpaid-mode-btn ${dashboardUnpaidViewMode === 'pnr' ? 'active' : ''}" data-unpaid-mode="pnr">
                    By Booking
                </button>
                <button type="button" class="unpaid-mode-btn ${dashboardUnpaidViewMode === 'account' ? 'active' : ''}" data-unpaid-mode="account" title="Group unpaid bookings by Social Media Account Name">
                    By Account ${multiTicketAccountCount > 0 ? `<span class="unpaid-mode-badge">${multiTicketAccountCount}</span>` : ''}
                </button>
            </div>
        </div>
        <div class="dashboard-table-wrap">
            <table class="dashboard-mini-table">
                <thead>
                    ${tableHeadHtml}
                </thead>
                <tbody>
                    ${tableRowsHtml || `<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--dash-text-muted);">No unpaid bookings matching "${dashboardEscapeHtml(dashboardUnpaidSearchTerm)}"</td></tr>`}
                </tbody>
            </table>
        </div>
    `;

    wireDashboardPnrButtons(container);

    container.querySelectorAll('[data-unpaid-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextType = btn.dataset.unpaidType;
            if (nextType && nextType !== dashboardUnpaidTypeFilter) {
                dashboardUnpaidTypeFilter = nextType;
                renderDashboardUnpaidTickets(groups);
            }
        });
    });

    container.querySelectorAll('.unpaid-mode-btn[data-unpaid-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextMode = btn.dataset.unpaidMode;
            if (nextMode && nextMode !== dashboardUnpaidViewMode) {
                dashboardUnpaidViewMode = nextMode;
                renderDashboardUnpaidTickets(groups);
            }
        });
    });

    container.querySelectorAll('.reminder-card-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const accountKey = btn.dataset.reminderAccount || '';
            const pnr = btn.dataset.reminderPnr || '';
            openPaymentReminderCardModal({ accountKey, pnr });
        });
    });

    const searchInput = document.getElementById('dashboardUnpaidSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            dashboardUnpaidSearchTerm = e.target.value;
            renderDashboardUnpaidTickets(groups);
            const inputRef = document.getElementById('dashboardUnpaidSearch');
            if (inputRef) {
                inputRef.focus();
                inputRef.selectionStart = inputRef.selectionEnd = inputRef.value.length;
            }
        });
    }
}

const REMINDER_BANK_CARDS = [
    {
        bank: 'KBZ',
        items: [
            { label: 'KBZ Pay', account: '09740862500' },
            { label: 'Special Account', account: '02051102000725501' },
            { label: 'Normal Account', account: '18230199926109801' }
        ]
    },
    {
        bank: 'AYA',
        items: [
            { label: 'AYA Pay', account: '09740862500' },
            { label: 'Banking', account: '40039173610' }
        ]
    },
    {
        bank: 'UAB Bank',
        items: [
            { label: 'UAB Pay', account: '09740862500' },
            { label: 'UAB Banking', account: '20010588572' }
        ]
    }
];

const REMINDER_CARD_STYLE_CSS = `
    .payment-reminder-card-sheet,
    #paymentReminderCardCanvasTarget {
        width: 794px !important;
        min-width: 794px !important;
        max-width: 794px !important;
        min-height: 1123px !important;
        box-sizing: border-box !important;
        margin: 0 auto !important;
        padding: 44px 56px 40px !important;
        background: #ffffff !important;
        color: #232323 !important;
        font-family: Arial, Helvetica, sans-serif !important;
        display: flex !important;
        flex-direction: column !important;
        position: relative !important;
    }
    #paymentReminderCardCanvasTarget * {
        box-sizing: border-box !important;
    }
    #paymentReminderCardCanvasTarget .prc-sheet-main {
        flex: 1 !important;
        display: flex !important;
        flex-direction: column !important;
        width: 100% !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-top {
        display: flex !important;
        justify-content: space-between !important;
        align-items: flex-start !important;
        width: 100% !important;
    }
    #paymentReminderCardCanvasTarget .prc-brand {
        width: 220px !important;
    }
    #paymentReminderCardCanvasTarget .prc-brand img.prc-brand-logo {
        display: block !important;
        width: 200px !important;
        max-width: 200px !important;
        height: auto !important;
        max-height: 60px !important;
        object-fit: contain !important;
        object-position: left top !important;
    }
    #paymentReminderCardCanvasTarget .prc-top-right {
        text-align: right !important;
    }
    #paymentReminderCardCanvasTarget .prc-doc-type {
        margin: 0 0 4px !important;
        font-size: 28px !important;
        font-weight: 700 !important;
        letter-spacing: 0.04em !important;
        color: #232323 !important;
        line-height: 1.1 !important;
    }
    #paymentReminderCardCanvasTarget .prc-doc-id {
        margin: 0 0 3px !important;
        font-size: 13px !important;
        color: #5F6B78 !important;
        font-weight: 600 !important;
    }
    #paymentReminderCardCanvasTarget .prc-doc-date {
        margin: 0 !important;
        font-size: 13px !important;
        color: #5F6B78 !important;
    }
    #paymentReminderCardCanvasTarget .prc-company-lines {
        margin-top: 14px !important;
    }
    #paymentReminderCardCanvasTarget .prc-company-lines p {
        margin: 0 0 3px !important;
        font-size: 10.5px !important;
        color: #5F6B78 !important;
        line-height: 1.4 !important;
    }
    #paymentReminderCardCanvasTarget .prc-header-rule {
        height: 2.5px !important;
        background: #AA0F11 !important;
        margin: 12px 0 18px !important;
        border: none !important;
        width: 100% !important;
    }
    #paymentReminderCardCanvasTarget .prc-billing-row {
        display: flex !important;
        justify-content: space-between !important;
        align-items: flex-start !important;
        margin-bottom: 22px !important;
        width: 100% !important;
    }
    #paymentReminderCardCanvasTarget .prc-billed-label {
        font-size: 10px !important;
        font-weight: 700 !important;
        color: #AA0F11 !important;
        margin-bottom: 4px !important;
        letter-spacing: 0.05em !important;
    }
    #paymentReminderCardCanvasTarget .prc-client-name {
        font-size: 18px !important;
        font-weight: 700 !important;
        color: #232323 !important;
        margin-bottom: 4px !important;
    }
    #paymentReminderCardCanvasTarget .prc-pnr-line {
        font-size: 11.5px !important;
        color: #232323 !important;
        line-height: 1.4 !important;
    }
    #paymentReminderCardCanvasTarget .prc-platform-badge {
        display: inline-block !important;
        padding: 1px 7px !important;
        border-radius: 999px !important;
        background: #F1F5F9 !important;
        border: 1px solid #CBD5E1 !important;
        color: #0F172A !important;
        font-size: 10px !important;
        font-weight: 700 !important;
    }
    #paymentReminderCardCanvasTarget .prc-meta-right {
        display: flex !important;
        flex-direction: column !important;
        gap: 5px !important;
        min-width: 200px !important;
    }
    #paymentReminderCardCanvasTarget .prc-meta-row {
        display: flex !important;
        justify-content: space-between !important;
        font-size: 11.5px !important;
    }
    #paymentReminderCardCanvasTarget .prc-meta-label {
        color: #5F6B78 !important;
    }
    #paymentReminderCardCanvasTarget .prc-meta-val {
        font-weight: 700 !important;
        color: #232323 !important;
    }
    #paymentReminderCardCanvasTarget .prc-status-pending {
        color: #AA0F11 !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-table {
        width: 100% !important;
        border-collapse: collapse !important;
        margin-bottom: 16px !important;
        table-layout: fixed !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-table th {
        padding: 8px 6px !important;
        border-bottom: 1px solid #E2E6EA !important;
        font-size: 10.5px !important;
        font-weight: 700 !important;
        color: #5F6B78 !important;
        background: transparent !important;
        text-align: left !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-table td {
        padding: 9px 6px !important;
        border-bottom: 1px solid #E2E6EA !important;
        font-size: 11.5px !important;
        color: #232323 !important;
        vertical-align: middle !important;
        word-break: break-word !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-table th.col-idx,
    #paymentReminderCardCanvasTarget .prc-inv-table td.col-idx {
        text-align: center !important;
        width: 28px !important;
        color: #5F6B78 !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-table th.col-pnr,
    #paymentReminderCardCanvasTarget .prc-inv-table td.col-pnr {
        text-align: left !important;
        width: 95px !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-table th.col-desc,
    #paymentReminderCardCanvasTarget .prc-inv-table td.col-desc {
        text-align: left !important;
        width: 140px !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-table th.col-route,
    #paymentReminderCardCanvasTarget .prc-inv-table td.col-route {
        text-align: left !important;
        width: 165px !important;
    }
    #paymentReminderCardCanvasTarget .prc-inv-table th.col-num,
    #paymentReminderCardCanvasTarget .prc-inv-table td.col-num {
        text-align: right !important;
        width: 86px !important;
        font-variant-numeric: tabular-nums !important;
        font-weight: 700 !important;
    }
    #paymentReminderCardCanvasTarget .prc-totals-section {
        width: 290px !important;
        margin-left: auto !important;
        margin-top: 4px !important;
        margin-bottom: 22px !important;
    }
    #paymentReminderCardCanvasTarget .prc-total-line {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        font-size: 12px !important;
        color: #5F6B78 !important;
        padding: 4px 0 !important;
    }
    #paymentReminderCardCanvasTarget .prc-total-line span:last-child {
        font-variant-numeric: tabular-nums !important;
        font-weight: 700 !important;
        color: #232323 !important;
    }
    #paymentReminderCardCanvasTarget .prc-balance-pill {
        background: #AA0F11 !important;
        border-radius: 6px !important;
        padding: 9px 14px !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        color: #ffffff !important;
        font-weight: 700 !important;
        font-size: 13px !important;
        letter-spacing: 0.03em !important;
        margin-top: 8px !important;
    }
    #paymentReminderCardCanvasTarget .prc-balance-pill span:last-child {
        font-variant-numeric: tabular-nums !important;
        font-weight: 800 !important;
    }
    #paymentReminderCardCanvasTarget .prc-thank-you {
        text-align: center !important;
        font-style: italic !important;
        font-size: 12.5px !important;
        color: #5F6B78 !important;
        margin-top: auto !important;
        margin-bottom: auto !important;
        padding: 24px 0 !important;
    }
    #paymentReminderCardCanvasTarget .prc-payment-section {
        margin-top: auto !important;
        margin-bottom: 24px !important;
        width: 100% !important;
    }
    #paymentReminderCardCanvasTarget .prc-payment-title {
        font-size: 12px !important;
        font-weight: 700 !important;
        color: #232323 !important;
        letter-spacing: 0.04em !important;
        margin-bottom: 4px !important;
    }
    #paymentReminderCardCanvasTarget .prc-account-name {
        font-size: 13px !important;
        font-weight: 700 !important;
        color: #AA0F11 !important;
        margin-bottom: 12px !important;
    }
    #paymentReminderCardCanvasTarget .prc-bank-cards {
        display: grid !important;
        grid-template-columns: repeat(3, 1fr) !important;
        gap: 14px !important;
        width: 100% !important;
    }
    #paymentReminderCardCanvasTarget .prc-bank-card {
        background: #F7F8F9 !important;
        border: 1px solid #E2E6EA !important;
        border-radius: 6px !important;
        overflow: hidden !important;
    }
    #paymentReminderCardCanvasTarget .prc-bank-card-header {
        background: #232323 !important;
        color: #ffffff !important;
        font-weight: 700 !important;
        font-size: 11.5px !important;
        padding: 6px 12px !important;
        border-bottom: 2px solid #AA0F11 !important;
    }
    #paymentReminderCardCanvasTarget .prc-bank-card-body {
        padding: 8px 12px 10px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
    }
    #paymentReminderCardCanvasTarget .prc-bank-row {
        line-height: 1.35 !important;
    }
    #paymentReminderCardCanvasTarget .prc-bank-label {
        font-size: 9.5px !important;
        color: #5F6B78 !important;
    }
    #paymentReminderCardCanvasTarget .prc-bank-acc {
        font-size: 11.5px !important;
        font-weight: 700 !important;
        color: #232323 !important;
    }
    #paymentReminderCardCanvasTarget .prc-footer {
        margin-top: auto !important;
        text-align: center !important;
        padding-top: 24px !important;
        width: 100% !important;
    }
    #paymentReminderCardCanvasTarget .prc-footer-tagline {
        font-size: 11px !important;
        font-weight: 700 !important;
        color: #AA0F11 !important;
        letter-spacing: 0.08em !important;
        margin-bottom: 5px !important;
    }
    #paymentReminderCardCanvasTarget .prc-footer-line {
        width: 70px !important;
        height: 1px !important;
        background: #E2E6EA !important;
        margin: 0 auto 6px !important;
    }
    #paymentReminderCardCanvasTarget .prc-footer-contact {
        font-size: 10px !important;
        color: #5F6B78 !important;
    }
`;

export function openPaymentReminderCardModal({ accountKey = '', pnr = '' } = {}) {
    const allUnpaidGroups = groupUnpaidTickets(state.allTickets || []);
    const normalizedAccKey = String(accountKey || '').trim().toLowerCase();
    const normalizedPnr = String(pnr || '').trim().toUpperCase();

    const accountMatchedGroups = normalizedAccKey
        ? allUnpaidGroups.filter(g => g.accountGroupKey === normalizedAccKey)
        : [];
    const singlePnrGroups = normalizedPnr
        ? allUnpaidGroups.filter(g => String(g.pnr || '').trim().toUpperCase() === normalizedPnr)
        : [];

    const initialGroups = accountMatchedGroups.length > 0 ? accountMatchedGroups : singlePnrGroups;
    if (!initialGroups.length) {
        showToast('No unpaid tickets found for this customer.', 'info');
        return;
    }

    // If a specific PNR was clicked on a row, default to 'single' so ONLY that client's booking is shown.
    // If opened without a specific PNR (e.g. from Group by Account view), default to 'account'.
    let scopeMode = (normalizedPnr && singlePnrGroups.length > 0)
        ? 'single'
        : (accountMatchedGroups.length > 1 ? 'account' : 'all');
    let customExtraPaid = null; // null means use computed paidAmount from tickets
    let customExtraAgentFare = null; // null means use computed unsettled sub_agent_fare

    const todayFormatted = new Date().toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric'
    });

    const getActiveGroups = () => {
        if (scopeMode === 'single' && singlePnrGroups.length > 0) {
            return singlePnrGroups;
        }
        return accountMatchedGroups.length > 0 ? accountMatchedGroups : singlePnrGroups;
    };

    const getActiveLeadGroup = () => {
        const grps = getActiveGroups();
        return grps[0] || initialGroups[0];
    };

    const getActiveDisplayName = () => {
        const lead = getActiveLeadGroup();
        if (scopeMode === 'single') {
            return lead.client || lead.accountDisplayLabel || lead.socialAccount || 'Customer';
        }
        return lead.accountDisplayLabel || lead.socialAccount || lead.client || 'Customer';
    };

    const buildLineItems = (groupsToUse) => {
        const items = [];
        groupsToUse.forEach(group => {
            const rows = Array.isArray(group.ticketRows) && group.ticketRows.length > 0
                ? group.ticketRows
                : [];
            if (rows.length > 0) {
                rows.forEach(t => {
                    const gross = ticketGrossAmount(t);
                    const agentFare = ticketUnsettledAgentFare(t);
                    const paid = isTicketPaid(t)
                        ? gross
                        : (t.outstanding_amount !== undefined && Number(t.outstanding_amount) >= 0
                            ? Math.max(0, gross - Number(t.outstanding_amount))
                            : 0);
                    const due = Math.max(0, gross - paid);
                    const isFee = isFeeEntryRow(t);
                    items.push({
                        pnr: group.pnr,
                        issuedDate: String(t.issued_date || group.issuedDateStr || '').trim() || '-',
                        passenger: String(t.name || group.client || 'Passenger').trim(),
                        isFee,
                        airline: String(t.airline || group.airline || '').trim(),
                        route: (t.departure && t.destination) ? getPnrRouteDisplay(t) : group.route,
                        travelDate: (t.departing_on ? formatDashboardDateLabel(t.departing_on) : '') || group.travelDateStr || '-',
                        gross,
                        agentFare,
                        paid,
                        due
                    });
                });
            } else {
                items.push({
                    pnr: group.pnr,
                    issuedDate: group.issuedDateStr || '-',
                    passenger: group.client,
                    isFee: group.hasFeeRows,
                    airline: group.airline || '',
                    route: group.route,
                    travelDate: group.travelDateStr || '-',
                    gross: group.totalGross || group.amount,
                    agentFare: group.agentFareAmount || 0,
                    paid: group.paidAmount || 0,
                    due: group.amount
                });
            }
        });
        return items;
    };

    const computeSummary = (items, groupsToUse = getActiveGroups()) => {
        const totalGross = items.reduce((s, item) => s + item.gross, 0);
        const defaultPaid = items.reduce((s, item) => s + item.paid, 0);
        const itemsAgentFare = items.reduce((s, item) => s + (item.agentFare || 0), 0);
        const groupTicketRows = (groupsToUse || []).flatMap(g => g.ticketRows || []);
        const activeLead = getActiveLeadGroup();
        const defaultAgentFare = scopeMode === 'single'
            ? itemsAgentFare
            : Math.max(
                itemsAgentFare,
                getAccountUnsettledAgentFare(activeLead.socialAccount || activeLead.accountDisplayLabel || 'Customer', groupTicketRows)
            );
        const effectiveAgentFare = customExtraAgentFare !== null
            ? Math.max(0, Number(customExtraAgentFare) || 0)
            : defaultAgentFare;
        const effectivePaid = customExtraPaid !== null
            ? Math.max(0, Number(customExtraPaid) || 0)
            : defaultPaid;
        const balanceDue = Math.max(0, totalGross - effectiveAgentFare - effectivePaid);
        return { totalGross, defaultAgentFare, effectiveAgentFare, defaultPaid, effectivePaid, balanceDue };
    };

    const buildCardInnerHtml = () => {
        const groupsToUse = getActiveGroups();
        const activeLead = getActiveLeadGroup();
        const activeDisplayName = getActiveDisplayName();
        const items = buildLineItems(groupsToUse);
        const { totalGross, effectiveAgentFare, effectivePaid, balanceDue } = computeSummary(items, groupsToUse);

        const rowsHtml = items.map((item, idx) => `
            <tr style="${idx % 2 === 1 ? 'background: #F7F8F9;' : 'background: #FFFFFF;'}">
                <td class="col-idx" style="padding: 9px 6px; border-bottom: 1px solid #E2E6EA; font-size: 11.5px; color: #5F6B78; text-align: center; width: 28px;">${idx + 1}</td>
                <td class="col-pnr" style="padding: 9px 6px; border-bottom: 1px solid #E2E6EA; font-size: 11.5px; color: #232323; text-align: left; width: 95px;">
                    <div class="prc-cell-pnr" style="font-family: Arial, Helvetica, sans-serif; font-weight: 700; color: #232323; font-size: 11.5px;">${dashboardEscapeHtml(item.pnr)}</div>
                    <div class="prc-cell-sub" style="font-size: 10px; color: #5F6B78; margin-top: 2px;">Issued: ${dashboardEscapeHtml(item.issuedDate)}</div>
                </td>
                <td class="col-desc" style="padding: 9px 6px; border-bottom: 1px solid #E2E6EA; font-size: 11.5px; color: #232323; text-align: left; width: 140px;">
                    <div class="prc-cell-pax" style="font-weight: 700; color: #232323; font-size: 11.5px;">${dashboardEscapeHtml(item.passenger)}</div>
                    ${item.isFee ? `<span class="prc-fee-badge" style="display: inline-block; margin-top: 2px; padding: 1px 6px; border-radius: 4px; background: #FEF3C7; color: #B45309; font-size: 9.5px; font-weight: 700;">Date Change / Fee</span>` : ''}
                </td>
                <td class="col-route" style="padding: 9px 6px; border-bottom: 1px solid #E2E6EA; font-size: 11.5px; color: #232323; text-align: left; width: 165px;">
                    <div class="prc-cell-route" style="font-weight: 600; color: #232323; font-size: 11.5px;">${dashboardEscapeHtml(item.route)}</div>
                    <div class="prc-cell-sub" style="font-size: 10px; color: #5F6B78; margin-top: 2px;">${item.airline ? `${dashboardEscapeHtml(item.airline)} · ` : ''}Travel: ${dashboardEscapeHtml(item.travelDate)}</div>
                </td>
                <td class="col-num" style="padding: 9px 6px; border-bottom: 1px solid #E2E6EA; font-size: 11.5px; color: #232323; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; width: 86px;">${formatDashboardAmount(item.gross)}</td>
                <td class="col-num prc-cell-paid" style="padding: 9px 6px; border-bottom: 1px solid #E2E6EA; font-size: 11.5px; color: #059669; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; width: 80px;">${formatDashboardAmount(item.paid)}</td>
                <td class="col-num prc-cell-due" style="padding: 9px 6px; border-bottom: 1px solid #E2E6EA; font-size: 11.5px; color: #AA0F11; text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; width: 88px;">${formatDashboardAmount(item.due)}</td>
            </tr>
        `).join('');

        const bankCardsHtml = REMINDER_BANK_CARDS.map(card => `
            <div class="prc-bank-card" style="background: #F7F8F9; border: 1px solid #E2E6EA; border-radius: 6px; overflow: hidden;">
                <div class="prc-bank-card-header" style="background: #232323; color: #ffffff; font-weight: 700; font-size: 11.5px; padding: 6px 12px; border-bottom: 2px solid #AA0F11;">${dashboardEscapeHtml(card.bank)}</div>
                <div class="prc-bank-card-body" style="padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 6px;">
                    ${card.items.map(item => `
                        <div class="prc-bank-row" style="line-height: 1.35; display: flex; justify-content: space-between; align-items: baseline;">
                            <div class="prc-bank-label" style="font-size: 9.5px; color: #5F6B78;">${dashboardEscapeHtml(item.label)}</div>
                            <div class="prc-bank-acc" style="font-size: 11.5px; font-weight: 700; color: #232323; font-family: Arial, Helvetica, sans-serif;">${dashboardEscapeHtml(item.account)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

        return `
            <style id="prcCardEmbeddedStyles">${REMINDER_CARD_STYLE_CSS}</style>
            <div class="prc-sheet-main" style="flex: 1; display: flex; flex-direction: column; width: 100%; box-sizing: border-box;">
                <div class="prc-inv-top" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <div class="prc-brand" style="width: 220px;">
                        <img src="./ocean-travel-logo.png" alt="Ocean Travel" class="prc-brand-logo" crossorigin="anonymous" style="display: block; width: 200px; max-width: 200px; height: auto; max-height: 60px; object-fit: contain; object-position: left top;" />
                    </div>
                    <div class="prc-top-right" style="text-align: right;">
                        <h1 class="prc-doc-type" style="margin: 0 0 4px; font-size: 28px; font-weight: 700; letter-spacing: 0.04em; color: #232323; line-height: 1.1;">PAYMENT REMINDER</h1>
                        <p class="prc-doc-id" style="margin: 0 0 3px; font-size: 13px; color: #5F6B78; font-weight: 600;">PR-${dashboardEscapeHtml(activeLead.pnr || 'OCT26')}</p>
                        <p class="prc-doc-date" style="margin: 0; font-size: 13px; color: #5F6B78;">${dashboardEscapeHtml(todayFormatted)} · Due on Receipt</p>
                    </div>
                </div>

                <div class="prc-company-lines" style="margin-top: 14px;">
                    <p style="margin: 0 0 3px; font-size: 10.5px; color: #5F6B78; line-height: 1.4;">A3-1, Room 603, Myanma Gone Yi Housing, Upper Pansodan St,<br>Mingalar Taung Nyunt Tsp, Yangon</p>
                    <p style="margin: 0 0 3px; font-size: 10.5px; color: #5F6B78; line-height: 1.4;">09964403435, 09740862500 · oceantravel.mm@gmail.com</p>
                </div>

                <hr class="prc-header-rule" style="height: 2.5px; background: #AA0F11; margin: 12px 0 18px; border: none; width: 100%;" />

                <div class="prc-billing-row" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; width: 100%;">
                    <div>
                        <div class="prc-billed-label" style="font-size: 10px; font-weight: 700; color: #AA0F11; margin-bottom: 4px; letter-spacing: 0.05em;">BILLED TO</div>
                        <div class="prc-client-name" style="font-size: 18px; font-weight: 700; color: #232323; margin-bottom: 4px;">${dashboardEscapeHtml(activeDisplayName)}</div>
                        ${activeLead.socialAccount ? `<div class="prc-pnr-line" style="font-size: 11.5px; color: #232323; line-height: 1.4;">Account: ${dashboardEscapeHtml(activeLead.socialAccount)}${activeLead.accountType ? ` · <span class="prc-platform-badge" style="display: inline-block; padding: 1px 7px; border-radius: 999px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #0F172A; font-size: 10px; font-weight: 700;">${dashboardEscapeHtml(activeLead.accountType)}</span>` : ''}</div>` : ''}
                        <div class="prc-pnr-line" style="font-size: 11.5px; color: #232323; line-height: 1.4;">${scopeMode === 'single' ? `Booking: PNR ${dashboardEscapeHtml(activeLead.pnr)}` : `Unpaid Bookings: ${groupsToUse.length} PNR${groupsToUse.length > 1 ? 's' : ''}`} (${items.length} Item${items.length > 1 ? 's' : ''})</div>
                    </div>
                    <div class="prc-meta-right" style="display: flex; flex-direction: column; gap: 5px; min-width: 200px;">
                        <div class="prc-meta-row" style="display: flex; justify-content: space-between; font-size: 11.5px;"><span class="prc-meta-label" style="color: #5F6B78;">Reminder Date</span><span class="prc-meta-val" style="font-weight: 700; color: #232323;">${dashboardEscapeHtml(todayFormatted)}</span></div>
                        <div class="prc-meta-row" style="display: flex; justify-content: space-between; font-size: 11.5px;"><span class="prc-meta-label" style="color: #5F6B78;">Terms</span><span class="prc-meta-val" style="font-weight: 700; color: #232323;">Due on Receipt</span></div>
                        <div class="prc-meta-row" style="display: flex; justify-content: space-between; font-size: 11.5px;"><span class="prc-meta-label" style="color: #5F6B78;">Status</span><span class="prc-meta-val prc-status-pending" style="font-weight: 700; color: #AA0F11;">Payment Pending</span></div>
                    </div>
                </div>

                <table class="prc-inv-table" style="width: 100%; border-collapse: collapse; margin-bottom: 16px; table-layout: fixed; background: #FFFFFF;">
                    <thead>
                        <tr>
                            <th class="col-idx" style="padding: 8px 6px; border-bottom: 1px solid #E2E6EA; font-size: 10.5px; font-weight: 700; color: #5F6B78; text-align: center; width: 28px;">#</th>
                            <th class="col-pnr" style="padding: 8px 6px; border-bottom: 1px solid #E2E6EA; font-size: 10.5px; font-weight: 700; color: #5F6B78; text-align: left; width: 95px;">PNR / REF</th>
                            <th class="col-desc" style="padding: 8px 6px; border-bottom: 1px solid #E2E6EA; font-size: 10.5px; font-weight: 700; color: #5F6B78; text-align: left; width: 140px;">PASSENGER & DETAILS</th>
                            <th class="col-route" style="padding: 8px 6px; border-bottom: 1px solid #E2E6EA; font-size: 10.5px; font-weight: 700; color: #5F6B78; text-align: left; width: 165px;">ROUTE & TRAVEL DATE</th>
                            <th class="col-num" style="padding: 8px 6px; border-bottom: 1px solid #E2E6EA; font-size: 10.5px; font-weight: 700; color: #5F6B78; text-align: right; width: 86px;">TOTAL (MMK)</th>
                            <th class="col-num" style="padding: 8px 6px; border-bottom: 1px solid #E2E6EA; font-size: 10.5px; font-weight: 700; color: #5F6B78; text-align: right; width: 80px;">PAID (MMK)</th>
                            <th class="col-num" style="padding: 8px 6px; border-bottom: 1px solid #E2E6EA; font-size: 10.5px; font-weight: 700; color: #5F6B78; text-align: right; width: 88px;">DUE (MMK)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>

                <div class="prc-totals-section" style="width: 290px; margin-left: auto; margin-top: 4px; margin-bottom: 22px;">
                    <div class="prc-total-line" style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #5F6B78; padding: 4px 0;">
                        <span>Sub Total</span>
                        <span style="font-variant-numeric: tabular-nums; font-weight: 700; color: #232323;">${formatDashboardAmount(totalGross)} MMK</span>
                    </div>
                    ${effectiveAgentFare > 0 ? `
                    <div class="prc-total-line prc-agent-fare-line" style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #5F6B78; padding: 4px 0;">
                        <span>Agent Fare</span>
                        <span style="font-variant-numeric: tabular-nums; font-weight: 700; color: #D97706;">- ${formatDashboardAmount(effectiveAgentFare)} MMK</span>
                    </div>
                    ` : ''}
                    <div class="prc-total-line prc-paid-line" style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #5F6B78; padding: 4px 0;">
                        <span>Paid / Deposit</span>
                        <span style="font-variant-numeric: tabular-nums; font-weight: 700; color: #059669;">- ${formatDashboardAmount(effectivePaid)} MMK</span>
                    </div>
                    <div class="prc-balance-pill" style="background: #AA0F11; border-radius: 6px; padding: 9px 14px; display: flex; justify-content: space-between; align-items: center; color: #ffffff; font-weight: 700; font-size: 13px; letter-spacing: 0.03em; margin-top: 8px;">
                        <span>BALANCE DUE</span>
                        <span style="font-variant-numeric: tabular-nums; font-weight: 800;">MMK ${formatDashboardAmount(balanceDue)}</span>
                    </div>
                </div>

                <div class="prc-thank-you" style="text-align: center; font-style: italic; font-size: 12.5px; color: #5F6B78; margin-top: auto; margin-bottom: auto; padding: 22px 0;">
                    Thank you for choosing Ocean Travel. Please transfer the outstanding balance to one of our accounts below.
                </div>

                <div class="prc-payment-section" style="margin-top: auto; margin-bottom: 24px; width: 100%;">
                    <div class="prc-payment-title" style="font-size: 12px; font-weight: 700; color: #232323; letter-spacing: 0.04em; margin-bottom: 4px;">PAYMENT METHODS</div>
                    <div class="prc-account-name" style="font-size: 13px; font-weight: 700; color: #AA0F11; margin-bottom: 12px;">Account Name: AUNG PYAE SONE</div>
                    <div class="prc-bank-cards" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; width: 100%;">
                        ${bankCardsHtml}
                    </div>
                </div>

                <div class="prc-footer" style="margin-top: auto; text-align: center; padding-top: 24px; width: 100%;">
                    <div class="prc-footer-tagline" style="font-size: 11px; font-weight: 700; color: #AA0F11; letter-spacing: 0.08em; margin-bottom: 5px;">EXPLORE. DISCOVER. EXPERIENCE.</div>
                    <div class="prc-footer-line" style="width: 70px; height: 1px; background: #E2E6EA; margin: 0 auto 6px;"></div>
                    <div class="prc-footer-contact" style="font-size: 10px; color: #5F6B78;">OCEAN TRAVEL & TOUR CO., LTD. · oceantravel.mm@gmail.com · 09964403435 / 09740862500</div>
                </div>
            </div>
        `;
    };

    const buildReminderTextMm = () => {
        const groupsToUse = getActiveGroups();
        const activeDisplayName = getActiveDisplayName();
        const items = buildLineItems(groupsToUse);
        const { totalGross, effectiveAgentFare, effectivePaid, balanceDue } = computeSummary(items, groupsToUse);
        const lines = items.map((item, idx) =>
            `  ${idx + 1}. PNR: ${item.pnr} | ${item.passenger} (${item.route}, ${item.travelDate}) — ${formatDashboardAmount(item.gross)} MMK`
        ).join('\n');

        return [
            `မင်္ဂလာပါ ${activeDisplayName} ခင်ဗျာ 🙏`,
            `Ocean Travel မှ လူကြီးမင်း၏ မရှင်းလင်းရသေးသော လေယာဉ်လက်မှတ် စာရင်းချုပ် (Payment Reminder) အား လေးစားစွာ ပေးပို့အပ်ပါသည်ခင်ဗျာ။`,
            ``,
            `🎫 လက်မှတ်စာရင်း (${groupsToUse.length} PNR / ${items.length} စောင်)`,
            lines,
            ``,
            `💰 ငွေစာရင်းချုပ်`,
            `• စုစုပေါင်း ကျသင့်ငွေ (Total): ${formatDashboardAmount(totalGross)} MMK`,
            ...(effectiveAgentFare > 0 ? [`• အေးဂျင့်ခ နှုတ်ငွေ (Agent Fare): -${formatDashboardAmount(effectiveAgentFare)} MMK`] : []),
            `• ပေးချေပြီးငွေ (Paid): ${formatDashboardAmount(effectivePaid)} MMK`,
            `• ပေးချေရန် ကျန်ငွေ (Balance Due): ${formatDashboardAmount(balanceDue)} MMK`,
            ``,
            `🏦 ငွေလွှဲပေးပို့နိုင်သော အကောင့်များ (Aung Pyae Sone)`,
            `• KBZ Pay / AYA Pay / UAB Pay: 09740862500`,
            `• KBZ Special Account: 02051102000725501`,
            `• KBZ Normal Account: 18230199926109801`,
            `• AYA Bank: 40039173610 | UAB Bank: 20010588572`,
            ``,
            `ငွေလွှဲပြီးပါက ပြေစာ (Screenshot) လေး ပြန်လည်ပေးပို့ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်ခင်ဗျာ။ အထူးကျေးဇူးတင်ရှိပါသည်ခင်ဗျာ။ 💙`
        ].join('\n');
    };

    const initialGroupsToUse = getActiveGroups();
    const initialItems = buildLineItems(initialGroupsToUse);
    const initialSummary = computeSummary(initialItems, initialGroupsToUse);

    const modalHtml = `
        <div class="prc-modal-wrapper">
            <div class="prc-modal-toolbar">
                <div class="prc-modal-toolbar-left">
                    <h3 class="prc-modal-title"><i class="fa-solid fa-file-invoice-dollar"></i> Payment Reminder Card</h3>
                    ${accountMatchedGroups.length > 1 && singlePnrGroups.length > 0 ? `
                    <div class="prc-scope-switch">
                        <button type="button" class="prc-scope-btn${scopeMode === 'single' ? ' active' : ''}" data-prc-scope="single">
                            Only PNR ${dashboardEscapeHtml(normalizedPnr)} (${dashboardEscapeHtml(singlePnrGroups[0]?.client || 'Client')})
                        </button>
                        <button type="button" class="prc-scope-btn${scopeMode === 'account' ? ' active' : ''}" data-prc-scope="account">
                            All ${accountMatchedGroups.length} PNRs (${dashboardEscapeHtml(accountMatchedGroups[0]?.accountDisplayLabel || 'Account')})
                        </button>
                    </div>
                    ` : ''}
                </div>
                <button type="button" class="pnr-close-circle-btn" id="prcCloseModalBtn" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div class="prc-controls-bar">
                <div class="prc-inputs-row">
                    <div class="prc-paid-input-group">
                        <label for="prcCustomAgentFareInput">Agent Fare (MMK):</label>
                        <input type="number" id="prcCustomAgentFareInput" min="0" step="1000" value="${initialSummary.effectiveAgentFare}" placeholder="0">
                    </div>
                    <div class="prc-paid-input-group">
                        <label for="prcCustomPaidInput">Paid / Deposit (MMK):</label>
                        <input type="number" id="prcCustomPaidInput" min="0" step="1000" value="${initialSummary.effectivePaid}" placeholder="0">
                    </div>
                </div>
                <div class="prc-export-actions">
                    <button type="button" class="btn btn-secondary prc-action-btn" id="prcCopyTextBtn">
                        <i class="fa-regular fa-copy"></i> Copy Text (MM)
                    </button>
                    <button type="button" class="btn btn-secondary prc-action-btn" id="prcDownloadPdfBtn">
                        <i class="fa-solid fa-file-pdf"></i> Download PDF (A4)
                    </button>
                    <button type="button" class="btn btn-primary prc-action-btn" id="prcDownloadPngBtn">
                        <i class="fa-solid fa-image"></i> Download PNG
                    </button>
                </div>
            </div>

            <div class="prc-preview-scroll-viewport">
                <div id="paymentReminderCardCanvasTarget" class="payment-reminder-card-sheet" style="width: 794px; min-width: 794px; max-width: 794px; min-height: 1123px; box-sizing: border-box; margin: 0 auto; padding: 44px 56px 40px; background: #ffffff; color: #232323; font-family: Arial, Helvetica, sans-serif; display: flex; flex-direction: column; text-align: left;">
                    ${buildCardInnerHtml()}
                </div>
            </div>
        </div>
    `;

    openModal(modalHtml, 'solid-modal prc-dialog-modal');

    const refreshCardView = () => {
        const target = document.getElementById('paymentReminderCardCanvasTarget');
        if (target) target.innerHTML = buildCardInnerHtml();
    };

    const waitForTargetImages = (root) => {
        const images = Array.from(root.querySelectorAll('img'));
        return Promise.all(
            images.map((img) => new Promise((resolve) => {
                if (img.complete && img.naturalWidth !== 0) {
                    resolve();
                    return;
                }
                img.onload = () => resolve();
                img.onerror = () => resolve();
                setTimeout(resolve, 1500);
            }))
        );
    };

    document.getElementById('prcCloseModalBtn')?.addEventListener('click', closeModal);

    document.querySelectorAll('.prc-scope-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.prc-scope-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            scopeMode = btn.dataset.prcScope || 'single';
            customExtraPaid = null;
            customExtraAgentFare = null;
            const activeGrps = getActiveGroups();
            const newSummary = computeSummary(buildLineItems(activeGrps), activeGrps);
            const agentInput = document.getElementById('prcCustomAgentFareInput');
            if (agentInput) agentInput.value = newSummary.effectiveAgentFare;
            const paidInput = document.getElementById('prcCustomPaidInput');
            if (paidInput) paidInput.value = newSummary.effectivePaid;
            refreshCardView();
        });
    });

    const agentFareInput = document.getElementById('prcCustomAgentFareInput');
    if (agentFareInput) {
        agentFareInput.addEventListener('input', (e) => {
            const raw = e.target.value;
            customExtraAgentFare = raw === '' ? 0 : Math.max(0, Number(raw) || 0);
            refreshCardView();
        });
    }

    const paidInput = document.getElementById('prcCustomPaidInput');
    if (paidInput) {
        paidInput.addEventListener('input', (e) => {
            const raw = e.target.value;
            customExtraPaid = raw === '' ? 0 : Math.max(0, Number(raw) || 0);
            refreshCardView();
        });
    }

    const copyTextBtn = document.getElementById('prcCopyTextBtn');
    copyTextBtn?.addEventListener('click', async () => {
        const text = buildReminderTextMm();
        const ok = await copyCustomerMessageToClipboard(text);
        if (ok) {
            showToast('Payment Reminder စာသား ကူးယူပြီးပါပြီ!', 'success');
            const orig = copyTextBtn.innerHTML;
            copyTextBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
            setTimeout(() => { copyTextBtn.innerHTML = orig; }, 1800);
        }
    });

    const safeFileSlug = (getActiveDisplayName()).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'Customer';

    const downloadPngBtn = document.getElementById('prcDownloadPngBtn');
    downloadPngBtn?.addEventListener('click', async () => {
        const target = document.getElementById('paymentReminderCardCanvasTarget');
        if (!target) return;
        const origHtml = downloadPngBtn.innerHTML;
        try {
            downloadPngBtn.disabled = true;
            downloadPngBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rendering...';
            await loadDocumentLibraries('canvas');
            await waitForTargetImages(target);
            const canvas = await window.html2canvas(target, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#FFFFFF',
                logging: false,
                width: 794,
                windowWidth: 1200
            });
            const link = document.createElement('a');
            link.download = `Payment-Reminder-${safeFileSlug}-${new Date().toISOString().slice(0, 10)}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast('Payment Reminder (PNG) downloaded!', 'success');
        } catch (err) {
            console.error('Failed to export PNG:', err);
            showToast('Could not generate PNG image.', 'error');
        } finally {
            downloadPngBtn.disabled = false;
            downloadPngBtn.innerHTML = origHtml;
        }
    });

    const downloadPdfBtn = document.getElementById('prcDownloadPdfBtn');
    downloadPdfBtn?.addEventListener('click', async () => {
        const target = document.getElementById('paymentReminderCardCanvasTarget');
        if (!target) return;
        const origHtml = downloadPdfBtn.innerHTML;
        try {
            downloadPdfBtn.disabled = true;
            downloadPdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rendering...';
            await loadDocumentLibraries('pdf', 'canvas');
            await waitForTargetImages(target);
            const canvas = await window.html2canvas(target, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#FFFFFF',
                logging: false,
                width: 794,
                windowWidth: 1200
            });
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({
                orientation: 'p',
                unit: 'mm',
                format: 'a4'
            });
            const pdfWidth = 210;
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            if (pdfHeight <= 297.5) {
                pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
            } else {
                let heightLeft = pdfHeight;
                let position = 0;
                pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
                heightLeft -= 297;
                while (heightLeft > 0) {
                    position -= 297;
                    pdf.addPage();
                    pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
                    heightLeft -= 297;
                }
            }
            pdf.save(`Payment-Reminder-${safeFileSlug}-${new Date().toISOString().slice(0, 10)}.pdf`);
            showToast('Payment Reminder (A4 PDF) downloaded!', 'success');
        } catch (err) {
            console.error('Failed to export PDF:', err);
            showToast('Could not generate PDF document.', 'error');
        } finally {
            downloadPdfBtn.disabled = false;
            downloadPdfBtn.innerHTML = origHtml;
        }
    });
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

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
    const dayAfterTomorrowStart = tomorrowStart + 24 * 60 * 60 * 1000;

    return [...grouped.values()].map(group => {
        const deadlineTime = group.deadline.getTime();
        const minutes = Math.round((deadlineTime - Date.now()) / 60000);
        let tone = 'neutral';
        let label = 'Upcoming';
        if (minutes < 0) {
            tone = 'danger';
            label = 'Overdue';
        } else if (deadlineTime >= todayStart && deadlineTime < tomorrowStart) {
            // Deadline is within calendar today
            if (minutes <= 3 * 60) {
                tone = 'danger';
                label = 'Due soon';
            } else {
                tone = 'warning';
                label = 'Due today';
            }
        } else if (deadlineTime >= tomorrowStart && deadlineTime < dayAfterTomorrowStart) {
            // Deadline is tomorrow
            tone = 'warning';
            label = 'Due tomorrow';
        } else if (minutes <= 7 * 24 * 60) {
            tone = 'neutral';
            label = 'This week';
        } else {
            tone = 'neutral';
            label = 'Upcoming';
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

let dashboardPassportFilter = 'all';
let dashboardPassportShowAll = false;

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

    container.querySelectorAll('[data-passport-client]').forEach(button => {
        button.addEventListener('click', () => {
            const clientKey = button.dataset.passportClient;
            if (clientKey) viewClientHistory(clientKey);
        });
    });

    container.querySelectorAll('[data-passport-filter]').forEach(button => {
        button.addEventListener('click', () => {
            dashboardPassportFilter = button.dataset.passportFilter || 'all';
            dashboardPassportShowAll = false;
            updateDashboardData();
        });
    });

    const toggleAllBtn = container.querySelector('#toggleAllExpiringPassportsBtn');
    if (toggleAllBtn) {
        toggleAllBtn.addEventListener('click', () => {
            dashboardPassportShowAll = !dashboardPassportShowAll;
            updateDashboardData();
        });
    }
}

function renderDashboardTasksReminders({ activeBookings, dueToday, unpaidGroups, financialPendingCount, upcomingTrips }) {
    const container = document.getElementById('dashboardTasksReminders');
    const hint = document.getElementById('dashboardTasksHint');
    if (!container) return;

    const bookingReminders = getBookingDeadlineReminderRows(activeBookings);
    const expiringPassports = getExpiringPassportClients();
    const vipExpiringCount = expiringPassports.filter(item => item.isVip).length;
    const filteredPassports = dashboardPassportFilter === 'vip'
        ? expiringPassports.filter(item => item.isVip)
        : expiringPassports;

    const manualTasks = [...(state.dashboardTasks || [])]
        .map(normalizeDashboardTask)
        .filter(task => task.source === 'manual' && task.title)
        .sort((a, b) => Number(a.done) - Number(b.done) || getManualTaskSortValue(a) - getManualTaskSortValue(b) || taskTimestampValue(b.createdAt) - taskTimestampValue(a.createdAt));
    const openManualCount = manualTasks.filter(task => !task.done).length;
    const urgentBookingCount = bookingReminders.filter(item => ['danger', 'warning'].includes(item.tone)).length;
    if (hint) {
        const totalOpen = openManualCount + urgentBookingCount + expiringPassports.length;
        hint.textContent = expiringPassports.length > 0
            ? `${totalOpen} open · ${expiringPassports.length} passport${expiringPassports.length === 1 ? '' : 's'}`
            : `${totalOpen} open`;
    }

    const bookingHtml = bookingReminders.length
        ? bookingReminders.slice(0, 15).map(item => `
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

    const visiblePassports = dashboardPassportShowAll ? filteredPassports : filteredPassports.slice(0, 8);
    const passportHtml = visiblePassports.length
        ? visiblePassports.map(({ client, status, isFeatured, isFrequent, isVip }) => {
            const vipBadge = isFeatured
                ? `<span class="passport-vip-badge is-featured" title="Featured VIP Client"><i class="fa-solid fa-star"></i> VIP</span>`
                : isFrequent
                ? `<span class="passport-vip-badge is-frequent" title="Repeat Client (${client.ticket_count} tickets)">VIP · ${client.ticket_count}</span>`
                : '';
            const contactText = client.phone || client.account_name || 'No contact';
            const passportNoText = client.passport_no ? client.passport_no.toUpperCase() : 'Passport';
            const badgeText = status.level === 'expired'
                ? `Expired ${status.daysAbs}d ago`
                : `In ${status.daysUntil}d`;
            return `
                <button type="button" class="dashboard-auto-task passport-expiry-task danger ${isVip ? 'is-vip-client' : ''}" data-passport-client="${dashboardEscapeHtml(client.client_key)}">
                    <span class="task-auto-icon passport-alert-icon"><i class="fa-solid fa-passport"></i></span>
                    <span class="task-auto-body">
                        <strong>${dashboardEscapeHtml(client.name || 'Client')} ${vipBadge}</strong>
                        <small>${dashboardEscapeHtml(passportNoText)} · Exp: <b>${dashboardEscapeHtml(status.formatted)}</b> · ${dashboardEscapeHtml(contactText)}</small>
                    </span>
                    <span class="dashboard-status danger">${dashboardEscapeHtml(badgeText)}</span>
                </button>
            `;
        }).join('') + (filteredPassports.length > 8 ? `
            <button type="button" class="passport-show-more-btn" id="toggleAllExpiringPassportsBtn">
                ${dashboardPassportShowAll ? 'Show fewer' : `Show all ${filteredPassports.length} expiring passports`}
            </button>
        ` : '')
        : `<div class="task-empty-line">${dashboardPassportFilter === 'vip' ? 'No VIP passports expiring within 6 months.' : 'No client passports expiring within 6 months.'}</div>`;

    const manualHtml = manualTasks.length
        ? manualTasks.slice(0, 20).map(task => {
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
        <div class="task-mini-section">
            <div class="task-mini-title"><span>Booking deadlines</span><small>${bookingReminders.length}</small></div>
            <div class="task-mini-list">${bookingHtml}</div>
        </div>
        <div class="task-mini-section passport-expiry-mini-section">
            <div class="task-mini-title">
                <span><i class="fa-solid fa-passport" style="color:var(--dash-coral); margin-right:4px;"></i> Expiring Passports (&lt; 6 Months)</span>
                <div class="passport-filter-pills">
                    <button type="button" class="passport-filter-pill ${dashboardPassportFilter === 'all' ? 'active' : ''}" data-passport-filter="all">All (${expiringPassports.length})</button>
                    <button type="button" class="passport-filter-pill ${dashboardPassportFilter === 'vip' ? 'active' : ''}" data-passport-filter="vip"><i class="fa-solid fa-star"></i> VIP (${vipExpiringCount})</button>
                </div>
            </div>
            <div class="task-mini-list">${passportHtml}</div>
        </div>
        <div class="task-mini-section">
            <div class="task-mini-title">
                <span>My tasks (${openManualCount} open)</span>
                <button type="button" class="btn btn-primary btn-sm" id="openTaskModalBtn" style="border-radius:50%; width:28px; height:28px; min-width:28px; min-height:28px; padding:0; display:inline-flex; align-items:center; justify-content:center;" title="Add Task">
                    <i class="fa-solid fa-plus" style="font-size:12px;"></i>
                </button>
            </div>
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

    const p = dashboardChartPalette();
    if (state.charts.paymentStatusChart) {
        state.charts.paymentStatusChart.data.labels = labels;
        state.charts.paymentStatusChart.data.datasets[0].data = data;
        state.charts.paymentStatusChart.data.datasets[0].backgroundColor = hasData ? [p.mint, p.coral, p.butter, p.lavender] : ['#f1eee9', '#f1eee9', '#f1eee9', '#f1eee9'];
        state.charts.paymentStatusChart.data.datasets[0].borderColor = p.surface;
        if (state.charts.paymentStatusChart.options.plugins?.legend?.labels) {
            state.charts.paymentStatusChart.options.plugins.legend.labels.color = p.text;
        }
        state.charts.paymentStatusChart.update('none');
        return;
    }

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

    const p = dashboardChartPalette();
    if (state.charts.routePerformanceChart) {
        state.charts.routePerformanceChart.data.labels = rows.map(r => r[0]);
        state.charts.routePerformanceChart.data.datasets[0].data = rows.map(r => r[1].profit);
        state.charts.routePerformanceChart.data.datasets[0].backgroundColor = p.mint;
        state.charts.routePerformanceChart.data.datasets[0].borderColor = p.ink;
        state.charts.routePerformanceChart.options.scales.x.ticks.color = p.text;
        state.charts.routePerformanceChart.options.scales.x.grid.color = p.grid;
        state.charts.routePerformanceChart.options.scales.y.ticks.color = p.text;
        state.charts.routePerformanceChart.update('none');
        return;
    }

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

    const p = dashboardChartPalette();
    if (state.charts.ownerPayableChart) {
        state.charts.ownerPayableChart.data.labels = months;
        state.charts.ownerPayableChart.data.datasets[0].data = ownerPayable;
        state.charts.ownerPayableChart.data.datasets[1].data = paidToOwner;
        state.charts.ownerPayableChart.data.datasets[0].backgroundColor = p.butter;
        state.charts.ownerPayableChart.data.datasets[1].borderColor = p.coral;
        state.charts.ownerPayableChart.data.datasets[1].backgroundColor = p.coral;
        if (state.charts.ownerPayableChart.options.plugins?.legend?.labels) {
            state.charts.ownerPayableChart.options.plugins.legend.labels.color = p.text;
        }
        state.charts.ownerPayableChart.options.scales.x.ticks.color = p.text;
        state.charts.ownerPayableChart.options.scales.x.grid.color = p.grid;
        state.charts.ownerPayableChart.options.scales.y.ticks.color = p.text;
        state.charts.ownerPayableChart.options.scales.y.grid.color = p.grid;
        state.charts.ownerPayableChart.update('none');
        return;
    }

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
    const canvas = document.getElementById('airlineChart');
    if (!canvas || typeof Chart === 'undefined') return;
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

    const ctx = canvas.getContext('2d');

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

    if (state.charts.airlineChart) {
        state.charts.airlineChart.data.labels = labels;
        state.charts.airlineChart.data.datasets[0].data = data;
        state.charts.airlineChart.data.datasets[0].backgroundColor = labels[0] === "No Data" ? ['#e2e8f0'] : colors.slice(0, labels.length);
        state.charts.airlineChart.data.datasets[0].borderColor = palette.surface;
        if (state.charts.airlineChart.options.plugins?.legend?.labels) {
            state.charts.airlineChart.options.plugins.legend.labels.color = textColor;
        }
        state.charts.airlineChart.update('none');
        return;
    }

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

    (state.allHotels || []).forEach(h => {
        const checkinDate = parseSheetDate(h.checkin);
        if (!checkinDate || !inDashboardRange(checkinDate, range)) return;
        const bucket = bucketMap.get(bucketKey(checkinDate));
        if (!bucket) return;
        
        // Hotel revenue is the customer base fare (gross sales)
        bucket.revenue += Number(h.base_fare || 0);
        // Hotel profit is the agent commission
        bucket.profit += Number(h.commission || 0);
    });

    const computed = getComputedStyle(document.body);
    const textColor = (computed.getPropertyValue('--chart-text') || '').trim() || '#24242b';
    const gridColor = (computed.getPropertyValue('--chart-grid') || '').trim() || 'rgba(36,36,43,0.10)';
    const revenueBase = (computed.getPropertyValue('--chart-revenue') || '').trim() || '#0284C7';
    const profitBase = (computed.getPropertyValue('--chart-profit') || computed.getPropertyValue('--chart-tickets') || '').trim() || '#F97316';
    const cancelBase = (computed.getPropertyValue('--coral') || '').trim() || '#EF4444';

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
    const revenueFill = ctx.createLinearGradient(0, 0, 0, 320);
    revenueFill.addColorStop(0, withAlpha(revenueBase, 0.28));
    revenueFill.addColorStop(0.65, withAlpha(revenueBase, 0.08));
    revenueFill.addColorStop(1, withAlpha(revenueBase, 0.00));

    const profitFill = ctx.createLinearGradient(0, 0, 0, 320);
    profitFill.addColorStop(0, withAlpha(profitBase, 0.30));
    profitFill.addColorStop(0.65, withAlpha(profitBase, 0.09));
    profitFill.addColorStop(1, withAlpha(profitBase, 0.00));

    const hasCancellations = buckets.some(b => b.cancellations > 0);
    const datasets = [{
        label: 'Revenue',
        data: buckets.map(bucket => bucket.revenue),
        borderColor: revenueBase,
        backgroundColor: revenueFill,
        borderWidth: 3.5,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: revenueBase,
        pointHoverBorderWidth: 2.5,
        tension: 0.45,
        fill: true,
        yAxisID: 'y'
    }, {
        label: 'Profit',
        data: buckets.map(bucket => bucket.profit),
        type: 'line',
        borderColor: profitBase,
        backgroundColor: profitFill,
        borderWidth: 3.5,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: profitBase,
        pointHoverBorderWidth: 2.5,
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

    if (state.charts.comparisonChart) {
        state.charts.comparisonChart.data.labels = buckets.map(bucket => bucket.label);
        state.charts.comparisonChart.data.datasets = datasets;
        state.charts.comparisonChart.update('none');
        return;
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

export {
    dashboardPeriodState,
    normalizeDashboardTask,
    loadDashboardTasksFromStorage,
    saveDashboardTasksToStorage,
    upsertLocalDashboardTask,
    removeLocalDashboardTask,
    dashboardEscapeHtml,
    initializeDashboardSelectors,
    renderDashboardData
};

