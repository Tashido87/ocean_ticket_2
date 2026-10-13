import {
    state,
    getCurrentUserState
} from './state.js';
import {
    getHistory,
    addHistory
} from './db.js';
import {
    showToast,
    escapeHtml
} from './utils.js';
import {
    setupGenericPagination
} from './ui.js';

/**
 * Creates a structured audit payload conforming to the audit schema.
 * @param {Object} ticket The ticket or entity being modified.
 * @param {string} [details=''] Human readable summary of change.
 * @param {Object} [opts={}]
 * @param {string} [opts.action='UPDATE'] e.g. FINANCIAL_UPDATE, PAYMENT_UPDATE, DATE_CHANGE, CANCELED
 * @param {Array<{field: string, from: any, to: any}>} [opts.changes=[]] Structured field diffs
 * @param {boolean} [opts.financial=false] Whether this involves financial change
 * @param {Object} [opts.user=null] Explicit user override if any
 * @returns {Object} Structured audit record
 */
export function createAuditPayload(ticket, details = '', opts = {}) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[now.getMonth()];
    const year = now.getFullYear();
    const timestamp = `${day}-${month}-${year}`;

    const currentUser = opts.user || getCurrentUserState();
    const userPayload = {
        uid: currentUser?.uid || 'system',
        email: currentUser?.email || '',
        displayName: currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Admin'
    };

    return {
        date: timestamp,
        name: ticket?.name || 'Unknown',
        pnr: ticket?.booking_reference || ticket?.pnr || '—',
        ticketId: ticket?.id || '',
        action: opts.action || 'UPDATE',
        user: userPayload,
        changes: Array.isArray(opts.changes) ? opts.changes : [],
        financial: Boolean(opts.financial),
        details: String(details || '')
    };
}

/**
 * Loads the modification history from Firestore.
 */
export async function loadHistory() {
    try {
        const history = await getHistory();
        state.history = history.reverse(); // Show most recent first
    } catch (error) {
        console.error("Error loading history:", error);
    }
}

/**
 * Saves a new structured entry to the modification history log.
 * @param {Object} ticket The ticket object related to the history entry.
 * @param {string} details A description of the change that was made.
 * @param {Object} [opts={}] Structured options (action, changes, financial, user)
 */
export async function saveHistory(ticket, details, opts = {}) {
    const payload = createAuditPayload(ticket, details, opts);
    try {
        await addHistory(payload);
    } catch (error) {
        console.error("Could not save history:", error);
        showToast('Failed to log action to history.', 'error');
    }
}

/**
 * Displays the modification history with pagination and structured diffs.
 * @param {number} page The page number to display.
 * @param {Array<Object>} [historyToShow=state.history] The history records to display.
 */
export function displayHistory(page, historyToShow = state.history) {
    const container = document.getElementById('modificationHistoryBody');
    const historySection = document.getElementById('modificationHistoryContainer');

    if (!container || !historySection) return;

    container.innerHTML = '';
    state.historyPage = page;

    if (historyToShow.length === 0) {
        historySection.style.display = 'none';
        return;
    }
    historySection.style.display = 'block';

    const paginated = historyToShow.slice((page - 1) * state.rowsPerPage, page * state.rowsPerPage);
    paginated.forEach(entry => {
        const row = container.insertRow();

        // User badge
        const userName = entry.user?.displayName || entry.user?.name || entry.user?.email || '—';
        const userEmail = entry.user?.email ? ` (${entry.user.email})` : '';
        const userHtml = `<span class="audit-user-badge" title="${escapeHtml(userName + userEmail)}"><i class="fa-solid fa-user-circle"></i> ${escapeHtml(userName)}</span>`;

        // Details + structured change chips
        let detailsHtml = escapeHtml(entry.details || '');
        if (Array.isArray(entry.changes) && entry.changes.length > 0) {
            const chips = entry.changes.map(c => {
                const fieldName = escapeHtml(String(c.field || '').replace(/_/g, ' '));
                const fromVal = escapeHtml(String(c.from ?? '—'));
                const toVal = escapeHtml(String(c.to ?? '—'));
                return `<span class="audit-diff-chip"><strong>${fieldName}:</strong> <span class="diff-from">${fromVal}</span> <i class="fa-solid fa-arrow-right-long"></i> <span class="diff-to">${toVal}</span></span>`;
            }).join(' ');
            detailsHtml = `<div class="audit-diff-container">${chips}</div>` + (entry.details ? `<div class="audit-note">${escapeHtml(entry.details)}</div>` : '');
        }

        row.innerHTML = `
            <td><span class="audit-date-badge">${escapeHtml(entry.date || '')}</span></td>
            <td>${userHtml}</td>
            <td><strong>${escapeHtml(entry.name || '')}</strong></td>
            <td>${entry.pnr ? `<a href="#" class="clickable-pnr" data-pnr="${escapeHtml(entry.pnr)}">${escapeHtml(entry.pnr)}</a>` : '—'}</td>
            <td>${detailsHtml}</td>
        `;
    });

    setupGenericPagination(historyToShow, 'modificationHistoryPagination', (p) => displayHistory(p, historyToShow), page);
}