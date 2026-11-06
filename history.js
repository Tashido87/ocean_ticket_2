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
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const timestamp = `${day}-${month}-${year} ${timeStr}`;

    const currentUser = opts.user || getCurrentUserState();
    const userPayload = {
        uid: currentUser?.uid || 'system',
        email: currentUser?.email || '',
        displayName: currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Admin'
    };

    return {
        date: timestamp,
        isoDate: now.toISOString(),
        name: ticket?.name || ticket?.passenger_name || ticket?.applicant_name || ticket?.client_name || ticket?.guest_name || 'Unknown',
        pnr: ticket?.booking_reference || ticket?.pnr || ticket?.confirmation_no || '—',
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
    bindClickablePnrs(container);
}

/**
 * Formats timestamp for display in activity logs.
 * @param {Object} entry Audit record.
 * @returns {string} Formatted timestamp.
 */
export function formatLogTimestamp(entry) {
    if (entry.createdAt?.toDate) {
        const d = entry.createdAt.toDate();
        const day = String(d.getDate()).padStart(2, '0');
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        return `${day}-${monthNames[d.getMonth()]}-${d.getFullYear()} ${timeStr}`;
    }
    if (entry.isoDate) {
        const d = new Date(entry.isoDate);
        if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            return `${day}-${monthNames[d.getMonth()]}-${d.getFullYear()} ${timeStr}`;
        }
    }
    return entry.date || '—';
}

/**
 * Returns formatted HTML action badge based on action type.
 * @param {string} action Action string.
 * @returns {string} HTML badge markup.
 */
export function getActionBadgeHtml(action) {
    const act = String(action || 'UPDATE').toUpperCase();
    if (act.includes('DELETE')) {
        return `<span class="log-badge badge-deleted"><i class="fa-solid fa-trash-can"></i> Deleted</span>`;
    }
    if (act.includes('CANCEL')) {
        return `<span class="log-badge badge-canceled"><i class="fa-solid fa-ban"></i> Canceled</span>`;
    }
    if (act.includes('CREATE') || act === 'NEW') {
        return `<span class="log-badge badge-created"><i class="fa-solid fa-circle-plus"></i> Created</span>`;
    }
    if (act.includes('FEE') || act.includes('FINANCIAL') || act.includes('PAYMENT') || act.includes('DATE_CHANGE')) {
        let label = 'Financial';
        if (act.includes('FEE')) label = 'Fee Added';
        else if (act.includes('PAYMENT')) label = 'Payment';
        else if (act.includes('DATE_CHANGE')) label = 'Date Change';
        return `<span class="log-badge badge-financial"><i class="fa-solid fa-coins"></i> ${label}</span>`;
    }
    return `<span class="log-badge badge-modified"><i class="fa-solid fa-pen"></i> Modified</span>`;
}

/**
 * Binds click handler to PNR links to quickly open the manage screen.
 * @param {HTMLElement} container DOM element containing clickable PNRs.
 */
export function bindClickablePnrs(container) {
    if (!container) return;
    container.querySelectorAll('.clickable-pnr').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pnr = e.currentTarget.dataset.pnr;
            if (pnr && pnr !== '—' && pnr !== 'N/A' && pnr !== 'No PNR') {
                import('./ui.js').then(({ showView }) => {
                    showView('manage');
                    const manageInput = document.getElementById('managePnr');
                    if (manageInput) manageInput.value = pnr;
                    const findBtn = document.getElementById('findTicketBtn');
                    if (findBtn) findBtn.click();
                });
            }
        });
    });
}

let logsInitialized = false;

/**
 * Initializes the dedicated Activity Logs view event listeners.
 */
export function initLogsView() {
    if (!logsInitialized) {
        logsInitialized = true;
        const searchInput = document.getElementById('logsSearchInput');
        const clearBtn = document.getElementById('logsClearSearchBtn');
        const actionFilter = document.getElementById('logsActionFilter');
        const resetBtn = document.getElementById('logsResetFiltersBtn');
        const refreshBtn = document.getElementById('refreshLogsBtn');

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                if (clearBtn) clearBtn.style.display = searchInput.value ? 'inline-block' : 'none';
                renderLogsView(1);
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                clearBtn.style.display = 'none';
                renderLogsView(1);
            });
        }
        if (actionFilter) {
            actionFilter.addEventListener('change', () => {
                renderLogsView(1);
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                if (clearBtn) clearBtn.style.display = 'none';
                if (actionFilter) actionFilter.value = 'all';
                renderLogsView(1);
            });
        }
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Refreshing...';
                try {
                    await loadHistory();
                    renderLogsView(1);
                    showToast('Activity logs refreshed', 'success');
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh Logs';
                }
            });
        }
    }
    renderLogsView(state.logsPage || 1);
}

/**
 * Renders the Activity Logs table with filtering, search, and pagination.
 * @param {number} [page=1] Target page number.
 */
export async function renderLogsView(page = 1) {
    const table = document.getElementById('activityLogsTable');
    const tbody = document.getElementById('activityLogsBody');
    const emptyState = document.getElementById('logsEmptyState');
    const countBadge = document.getElementById('logsTotalCountBadge');

    if (!tbody) return;

    if (!state.history || state.history.length === 0) {
        await loadHistory();
    }

    state.logsPage = page;
    const allHistory = state.history || [];

    const searchQuery = (document.getElementById('logsSearchInput')?.value || '').trim().toLowerCase();
    const actionFilter = document.getElementById('logsActionFilter')?.value || 'all';

    const filtered = allHistory.filter(entry => {
        // Action filter
        if (actionFilter !== 'all') {
            const act = String(entry.action || 'UPDATE').toUpperCase();
            if (actionFilter === 'CREATED') {
                if (!act.includes('CREATE') && act !== 'NEW') return false;
            } else if (actionFilter === 'MODIFIED') {
                if (!act.includes('MODIFY') && !act.includes('UPDATE') && !act.includes('GROUP')) return false;
            } else if (actionFilter === 'DELETED') {
                if (!act.includes('DELETE')) return false;
            } else if (actionFilter === 'FINANCIAL') {
                if (!act.includes('FEE') && !act.includes('FINANCIAL') && !act.includes('PAYMENT') && !act.includes('DATE_CHANGE') && !entry.financial) return false;
            } else if (actionFilter === 'CANCELED') {
                if (!act.includes('CANCEL')) return false;
            }
        }

        // Search query filter
        if (searchQuery) {
            const name = String(entry.name || '').toLowerCase();
            const pnr = String(entry.pnr || '').toLowerCase();
            const details = String(entry.details || '').toLowerCase();
            const action = String(entry.action || '').toLowerCase();
            const user = String(entry.user?.displayName || entry.user?.email || '').toLowerCase();
            const changes = Array.isArray(entry.changes) ? entry.changes.map(c => `${c.field} ${c.from} ${c.to}`).join(' ').toLowerCase() : '';
            const matches = name.includes(searchQuery) ||
                            pnr.includes(searchQuery) ||
                            details.includes(searchQuery) ||
                            action.includes(searchQuery) ||
                            user.includes(searchQuery) ||
                            changes.includes(searchQuery);
            if (!matches) return false;
        }

        return true;
    });

    if (countBadge) {
        if (filtered.length === allHistory.length) {
            countBadge.textContent = `${allHistory.length} Total Logs`;
        } else {
            countBadge.textContent = `${filtered.length} of ${allHistory.length} Logs`;
        }
    }

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        if (table) table.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        const paginationContainer = document.getElementById('logsPagination');
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    if (table) table.style.display = 'table';
    if (emptyState) emptyState.style.display = 'none';

    const pageSize = state.rowsPerPage || 20;
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

    paginated.forEach(entry => {
        const row = tbody.insertRow();

        const userName = entry.user?.displayName || entry.user?.name || entry.user?.email?.split('@')[0] || 'Admin';
        const userEmail = entry.user?.email ? ` (${entry.user.email})` : '';

        // 1. Timestamp
        const dateCell = row.insertCell(0);
        dateCell.className = 'logs-col-time';
        const timeBadge = document.createElement('span');
        timeBadge.className = 'audit-date-badge';
        timeBadge.textContent = formatLogTimestamp(entry);
        dateCell.appendChild(timeBadge);

        // 2. User
        const userCell = row.insertCell(1);
        userCell.className = 'logs-col-user';
        const userBadge = document.createElement('span');
        userBadge.className = 'audit-user-badge';
        userBadge.title = userName + userEmail;
        userBadge.innerHTML = `<i class="fa-solid fa-user-circle"></i> ${escapeHtml(userName)}`;
        userCell.appendChild(userBadge);

        // 3. Action
        const actionCell = row.insertCell(2);
        actionCell.className = 'logs-col-action';
        actionCell.innerHTML = getActionBadgeHtml(entry.action);

        // 4. Passenger / Client Name
        const nameCell = row.insertCell(3);
        nameCell.className = 'logs-col-name';
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = entry.name || '—';
        nameCell.appendChild(nameStrong);

        // 5. PNR / Ref
        const pnrCell = row.insertCell(4);
        pnrCell.className = 'logs-col-pnr';
        if (entry.pnr && entry.pnr !== '—' && entry.pnr !== 'N/A' && entry.pnr !== 'No PNR') {
            const pnrLink = document.createElement('a');
            pnrLink.href = '#';
            pnrLink.className = 'clickable-pnr';
            pnrLink.dataset.pnr = entry.pnr;
            pnrLink.textContent = entry.pnr;
            pnrCell.appendChild(pnrLink);
        } else {
            pnrCell.textContent = '—';
        }

        // 6. Changes & Details
        const detailsCell = row.insertCell(5);
        detailsCell.className = 'logs-col-details';

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
                } else if (toLower === 'deleted') {
                    toClass += ' diff-to-unpaid';
                } else if (toLower === 'created') {
                    toClass += ' diff-to-paid';
                }

                chip.innerHTML = `<strong>${escapeHtml(fieldName)}:</strong> <span class="diff-from">${escapeHtml(fromVal)}</span> <i class="fa-solid fa-arrow-right-long"></i> <span class="${toClass}">${escapeHtml(toVal)}</span>`;
                diffContainer.appendChild(chip);
            });
            detailsCell.appendChild(diffContainer);

            const noteToShow = getCleanAuditNote(entry.details, entry.changes);
            if (noteToShow) {
                const note = document.createElement('div');
                note.className = 'audit-note';
                note.textContent = noteToShow;
                detailsCell.appendChild(note);
            }
        } else {
            const noteToShow = getCleanAuditNote(entry.details, []);
            detailsCell.textContent = noteToShow || '—';
        }
    });

    setupGenericPagination(filtered, 'logsPagination', (p) => renderLogsView(p), page);
    bindClickablePnrs(tbody);
}

if (typeof window !== 'undefined') {
    window._refreshLogsView = () => {
        const logsView = document.getElementById('logs-view');
        if (logsView && logsView.style.display !== 'none') {
            renderLogsView(state.logsPage || 1);
        }
    };
}