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
 * Determines whether a history note should be rendered or suppressed as duplicate / empty.
 * @param {string} details Stored history detail string.
 * @param {Array<{field: string, from: any, to: any}>} [changes=[]] Structured field diffs.
 * @returns {string|null} Note text to show, or null if suppressed.
 */
export function getCleanAuditNote(details, changes = []) {
    if (!details || typeof details !== 'string') return null;
    const trimmed = details.trim();
    if (!trimmed) return null;

    // Suppress if the note is only an action label plus punctuation (e.g. "FINANCIAL & DATE UPDATE: .", "MODIFIED:", "UPDATE:")
    const strippedAction = trimmed.replace(/^[A-Z0-9\s&_\-]+:\s*/i, '').trim();
    if (strippedAction === '' || /^[\s.,;:|\-–—]+$/.test(strippedAction)) {
        return null;
    }

    if (!Array.isArray(changes) || changes.length === 0) {
        return trimmed;
    }

    // Normalise to lowercase alphanumeric tokens
    const tokenize = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);

    // Stop words that are connective or generic action words
    const stopWords = new Set([
        'payment', 'financial', 'date', 'update', 'modified', 'change', 'fee', 'added', 'ticket', 'updated',
        'paid', 'unpaid', 'via', 'on', 'to', 'from', 'for', 'in', 'and', 'by', 'the', 'with', 'marked', 'true', 'false', 'is'
    ]);

    const changeTokens = new Set();
    changes.forEach(c => {
        tokenize(c.field).forEach(t => changeTokens.add(t));
        tokenize(c.from).forEach(t => changeTokens.add(t));
        tokenize(c.to).forEach(t => changeTokens.add(t));
    });

    const noteTokens = tokenize(strippedAction).filter(t => !stopWords.has(t));
    const novelTokens = noteTokens.filter(t => !changeTokens.has(t));

    // If every significant token in the note is already represented in the changes, suppress the duplicate note
    if (novelTokens.length === 0) {
        return null;
    }

    return trimmed;
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

        // User badge data
        const userName = entry.user?.displayName || entry.user?.name || entry.user?.email || '—';
        const userEmail = entry.user?.email ? ` (${entry.user.email})` : '';

        const dateCell = row.insertCell(0);
        const userCell = row.insertCell(1);
        const nameCell = row.insertCell(2);
        const pnrCell = row.insertCell(3);
        const detailsCell = row.insertCell(4);

        // Date badge: plain text tabular 11.5px --text-muted
        const dateBadge = document.createElement('span');
        dateBadge.className = 'audit-date-badge';
        dateBadge.textContent = entry.date || '';
        dateCell.appendChild(dateBadge);

        // User badge: pale teal, capitalize name in CSS, hover title preserved
        const userBadge = document.createElement('span');
        userBadge.className = 'audit-user-badge';
        userBadge.title = userName + userEmail;
        userBadge.innerHTML = `<i class="fa-solid fa-user-circle"></i> `;
        userBadge.appendChild(document.createTextNode(userName));
        userCell.appendChild(userBadge);

        // Name cell (plain text)
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = entry.name || '';
        nameCell.appendChild(nameStrong);

        // PNR cell
        if (entry.pnr && entry.pnr !== '—') {
            const pnrLink = document.createElement('a');
            pnrLink.href = '#';
            pnrLink.className = 'clickable-pnr';
            pnrLink.dataset.pnr = entry.pnr;
            pnrLink.textContent = entry.pnr;
            pnrCell.appendChild(pnrLink);
        } else {
            pnrCell.textContent = '—';
        }

        // Details cell
        if (Array.isArray(entry.changes) && entry.changes.length > 0) {
            const diffContainer = document.createElement('div');
            diffContainer.className = 'audit-diff-container';
            entry.changes.forEach(c => {
                const chip = document.createElement('span');
                chip.className = 'audit-diff-chip';
                const fieldName = String(c.field || '').replace(/_/g, ' ');
                const fromVal = String(c.from ?? '—');
                const toVal = String(c.to ?? '—');

                let toClass = 'diff-to';
                const fieldLower = fieldName.toLowerCase();
                const toLower = toVal.toLowerCase();
                if (fieldLower.includes('paid')) {
                    if (toLower === 'true' || toLower === 'paid') {
                        toClass += ' diff-to-paid';
                    } else if (toLower === 'false' || toLower === 'unpaid') {
                        toClass += ' diff-to-unpaid';
                    }
                }

                chip.innerHTML = `<strong>${escapeHtml(fieldName)}:</strong> <span class="diff-from">${escapeHtml(fromVal)}</span> <i class="fa-solid fa-arrow-right-long"></i> <span class="${toClass}">${escapeHtml(toVal)}</span>`;
                diffContainer.appendChild(chip);
            });
            detailsCell.appendChild(diffContainer);

            // Deduplication rule: show note only if it adds a genuinely new fact
            const noteToShow = getCleanAuditNote(entry.details, entry.changes);
            if (noteToShow) {
                const note = document.createElement('div');
                note.className = 'audit-note';
                note.textContent = noteToShow;
                detailsCell.appendChild(note);
            }
        } else {
            // Plain-text detail rows: suppress empty/dangling labels
            const noteToShow = getCleanAuditNote(entry.details, []);
            detailsCell.textContent = noteToShow || '—';
        }
    });

    setupGenericPagination(historyToShow, 'modificationHistoryPagination', (p) => displayHistory(p, historyToShow), page);
}