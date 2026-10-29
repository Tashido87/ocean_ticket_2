/**
 * @fileoverview Firebase Firestore data layer.
 * Replaces api.js. All database operations go through this file.
 *
 * Includes Two-Tier Progressive Sync + IndexedDB Archive Cache + Delta Sync:
 * - Tier 1 (Active Real-Time Window): Watches the newest records in real time for instant startup
 *   and low Firestore listener overhead, plus a live `updatedAt >= sessionStart` delta listener.
 * - Tier 2 (Unlimited Historical Archive): Hydrates all older records via cursor pagination (`startAfter`)
 *   and caches the archive in IndexedDB with `updatedAt` delta sync — eliminating the old 2,000-ticket
 *   hard drop-off while minimizing Firestore read costs and memory spikes on startup.
 */

import { db } from './firebase-config.js';
import {
    collection,
    doc,
    getDocs,
    getDocsFromCache,
    getDoc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    query,
    orderBy,
    where,
    limit,
    startAfter,
    Timestamp,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from './utils.js';

// --- COLLECTION REFERENCES ---
const ticketsCol = collection(db, 'tickets');
const bookingsCol = collection(db, 'bookings');
const settlementsCol = collection(db, 'settlements');
const historyCol = collection(db, 'history');
const closedPeriodsCol = collection(db, 'closedPeriods');
const adjustmentsCol = collection(db, 'settlementAdjustments');
const dashboardTasksCol = collection(db, 'dashboardTasks');
const hotelsCol = collection(db, 'hotelReservations');

// --- SCALABLE ARCHIVE & DELTA SYNC CONFIGURATION ---
const ACTIVE_REALTIME_TICKET_LIMIT = 400;
const ARCHIVE_TICKET_PAGE_SIZE = 750;
const ACTIVE_REALTIME_BOOKING_LIMIT = 300;
const ARCHIVE_BOOKING_PAGE_SIZE = 500;
const DEFAULT_HISTORY_REALTIME_LIMIT = 300;

const ARCHIVE_IDB_NAME = 'ocean_scalable_cache_v1';
const ARCHIVE_IDB_STORE = 'collection_archives';

function getTimestampMs(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') {
        return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    }
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Date.parse(value) || 0;
    return 0;
}

function reviveTimestamps(record) {
    if (!record || typeof record !== 'object') return record;
    const copy = { ...record };
    for (const field of ['createdAt', 'updatedAt', 'issuedAt', 'cancelledAt', 'expiredAt']) {
        const val = copy[field];
        if (val && typeof val === 'object' && typeof val.seconds === 'number' && typeof val.toMillis !== 'function') {
            try {
                copy[field] = new Timestamp(val.seconds, val.nanoseconds || 0);
            } catch {
                // Keep plain object if Timestamp constructor fails
            }
        }
    }
    return copy;
}

function sortRecordsByCreatedAtDesc(records) {
    return records.sort((a, b) => {
        const diff = getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt);
        return diff !== 0 ? diff : String(b.id || '').localeCompare(String(a.id || ''));
    });
}

function openArchiveDb() {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }
        try {
            const req = indexedDB.open(ARCHIVE_IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const idb = req.result;
                if (!idb.objectStoreNames.contains(ARCHIVE_IDB_STORE)) {
                    idb.createObjectStore(ARCHIVE_IDB_STORE, { keyPath: 'collection' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function readArchiveCache(collectionKey) {
    const idb = await openArchiveDb();
    if (!idb) return null;
    return new Promise((resolve) => {
        try {
            const tx = idb.transaction(ARCHIVE_IDB_STORE, 'readonly');
            const req = tx.objectStore(ARCHIVE_IDB_STORE).get(collectionKey);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function writeArchiveCache(collectionKey, payload) {
    const idb = await openArchiveDb();
    if (!idb) return;
    return new Promise((resolve) => {
        try {
            const tx = idb.transaction(ARCHIVE_IDB_STORE, 'readwrite');
            tx.objectStore(ARCHIVE_IDB_STORE).put({
                collection: collectionKey,
                ...payload,
                savedAt: Date.now()
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

const activeSyncControllers = new Map();

function notifyCollectionDeletion(collectionName, docId) {
    const controllers = activeSyncControllers.get(collectionName);
    if (!controllers) return;
    controllers.forEach(ctrl => ctrl.handleLocalDelete(docId));
}

/**
 * Creates a progressive two-tier real-time + archive sync subscription.
 * 1. Immediately streams the active window (`activeLimit`) via `onSnapshot` for instant boot.
 * 2. Watches `updatedAt >= sessionStart` in real time so edits to older archived records sync live.
 * 3. Hydrates all older records in the background via IndexedDB cache + `updatedAt` delta sync
 *    or cursor pagination (`startAfter`), eliminating any 2,000-document drop-off.
 */
function subscribeProgressiveCollection({
    collectionName,
    colRef,
    activeLimit,
    pageSize,
    maxLimit = null,
    callback,
    errorCallback,
    defaultErrorToast = false
}) {
    const recordsMap = new Map();
    let activeWindowIds = new Set();
    let unmounted = false;
    let initialActiveDelivered = false;
    let archiveHydrationStarted = false;
    let persistTimer = null;
    let archiveComplete = false;
    let lastSyncMs = 0;

    const getOrderedRecords = () => {
        const list = sortRecordsByCreatedAtDesc(Array.from(recordsMap.values()));
        return (typeof maxLimit === 'number' && maxLimit > 0) ? list.slice(0, maxLimit) : list;
    };

    const emit = () => {
        if (unmounted) return;
        callback(getOrderedRecords());
    };

    const scheduleArchivePersist = (completeFlag = archiveComplete) => {
        if (unmounted) return;
        archiveComplete = completeFlag || archiveComplete;
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            if (unmounted) return;
            const itemsObj = {};
            recordsMap.forEach((val, key) => {
                itemsObj[key] = val;
            });
            void writeArchiveCache(collectionName, {
                itemsById: itemsObj,
                completeArchive: archiveComplete,
                lastSyncMs: lastSyncMs || Date.now()
            });
        }, 600);
    };

    const controller = {
        handleLocalDelete(docId) {
            if (recordsMap.delete(docId)) {
                activeWindowIds.delete(docId);
                scheduleArchivePersist();
                emit();
            }
        }
    };

    if (!activeSyncControllers.has(collectionName)) {
        activeSyncControllers.set(collectionName, new Set());
    }
    activeSyncControllers.get(collectionName).add(controller);

    const archiveCachePromise = readArchiveCache(collectionName);
    const effectiveActiveLimit = (typeof maxLimit === 'number' && maxLimit > 0 && maxLimit < activeLimit)
        ? maxLimit
        : activeLimit;

    // Tier 0: Instant Cache Hydration from IndexedDB (Stale-While-Revalidate)
    // Emits local cached records immediately (20-50ms) so the UI appears instantly without waiting for remote Firestore!
    void (async () => {
        try {
            const cached = await archiveCachePromise;
            if (unmounted || initialActiveDelivered) return;
            if (cached?.itemsById && typeof cached.itemsById === 'object') {
                const keys = Object.keys(cached.itemsById);
                if (keys.length > 0) {
                    for (const [id, rawItem] of Object.entries(cached.itemsById)) {
                        if (!recordsMap.has(id)) {
                            recordsMap.set(id, reviveTimestamps(rawItem));
                        }
                    }
                    if (!unmounted && !initialActiveDelivered) {
                        emit();
                    }
                }
            }
        } catch (err) {
            console.warn(`Instant cache hydration warning (${collectionName}):`, err);
        }
    })();

    // Tier 1: Real-time listener on the active newest window
    const activeQuery = query(colRef, orderBy('createdAt', 'desc'), limit(effectiveActiveLimit));
    const unsubActive = onSnapshot(activeQuery, (snapshot) => {
        if (unmounted) return;

        const nextWindowIds = new Set();
        let oldestActiveTimestampMs = Infinity;

        snapshot.docs.forEach(d => {
            const record = { id: d.id, ...d.data() };
            nextWindowIds.add(d.id);
            recordsMap.set(d.id, record);
            const ts = getTimestampMs(record.createdAt);
            if (ts > 0 && ts < oldestActiveTimestampMs) {
                oldestActiveTimestampMs = ts;
            }
        });

        // Remove any record that was previously in the active window and is newer than the window tail
        // but disappeared from the snapshot (meaning it was deleted on another client).
        activeWindowIds.forEach(prevId => {
            if (!nextWindowIds.has(prevId)) {
                const existing = recordsMap.get(prevId);
                const existingTs = getTimestampMs(existing?.createdAt);
                if (!existing || snapshot.docs.length < effectiveActiveLimit || existingTs >= oldestActiveTimestampMs) {
                    recordsMap.delete(prevId);
                }
            }
        });
        activeWindowIds = nextWindowIds;
        lastSyncMs = Date.now();

        initialActiveDelivered = true;
        emit();

        // Trigger Tier 2 background archive hydration once after initial active window renders
        if (!archiveHydrationStarted) {
            archiveHydrationStarted = true;
            const lastDocSnap = snapshot.docs[snapshot.docs.length - 1] || null;
            const hasMoreBeyondActive = snapshot.docs.length >= effectiveActiveLimit && (!maxLimit || maxLimit > effectiveActiveLimit);
            const runBackgroundHydration = () => {
                if (!unmounted) {
                    void hydrateArchiveInBackground(lastDocSnap, hasMoreBeyondActive);
                }
            };
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                window.requestIdleCallback(runBackgroundHydration, { timeout: 1200 });
            } else {
                setTimeout(runBackgroundHydration, 120);
            }
        } else {
            scheduleArchivePersist();
        }
    }, (error) => {
        console.error(`Firestore on${collectionName}Change error:`, error);
        if (errorCallback) errorCallback(error);
        else if (defaultErrorToast) showToast(`Sync error (${collectionName}): ${error.message || error}`, 'error');
    });

    // Tier 1b: Lightweight real-time delta listener for edits made to older archived records during this session
    const sessionStart = Timestamp.fromMillis(Date.now() - 30000);
    const liveDeltaQuery = query(colRef, where('updatedAt', '>=', sessionStart));
    const unsubDelta = onSnapshot(liveDeltaQuery, (snapshot) => {
        if (unmounted || snapshot.empty) return;
        let changed = false;
        snapshot.docChanges().forEach(change => {
            const docId = change.doc.id;
            if (change.type === 'removed') {
                if (recordsMap.delete(docId)) changed = true;
            } else {
                recordsMap.set(docId, { id: docId, ...change.doc.data() });
                changed = true;
            }
        });
        if (changed) {
            lastSyncMs = Date.now();
            scheduleArchivePersist();
            if (initialActiveDelivered) emit();
        }
    }, () => {
        // Ignore delta listener errors silently; primary active listener handles error reporting
    });

    // Tier 2: Non-blocking archive hydration + delta sync
    async function hydrateArchiveInBackground(initialCursorDoc, hasMoreBeyondActive) {
        try {
            const cached = await archiveCachePromise;
            if (unmounted) return;

            if (cached?.itemsById && typeof cached.itemsById === 'object') {
                let restoredCount = 0;
                for (const [id, rawItem] of Object.entries(cached.itemsById)) {
                    if (!recordsMap.has(id)) {
                        recordsMap.set(id, reviveTimestamps(rawItem));
                        restoredCount++;
                    }
                }
                if (restoredCount > 0 && !unmounted) {
                    emit();
                }

                // If we already have a complete archive in IndexedDB, just fetch the delta since lastSyncMs!
                if (cached.completeArchive && cached.lastSyncMs > 0) {
                    const deltaSince = Timestamp.fromMillis(Math.max(0, cached.lastSyncMs - 120000));
                    const deltaSnap = await getDocs(query(colRef, where('updatedAt', '>', deltaSince)));
                    if (unmounted) return;
                    let deltaUpdated = 0;
                    deltaSnap.docs.forEach(d => {
                        recordsMap.set(d.id, { id: d.id, ...d.data() });
                        deltaUpdated++;
                    });
                    archiveComplete = true;
                    lastSyncMs = Date.now();
                    scheduleArchivePersist(true);
                    if (deltaUpdated > 0) emit();
                    return;
                }
            }

            // If total documents in collection fit inside the active window, archive is already 100% complete
            if (!hasMoreBeyondActive || !initialCursorDoc) {
                archiveComplete = true;
                lastSyncMs = Date.now();
                scheduleArchivePersist(true);
                return;
            }

            // Paginate through all remaining historical records using startAfter
            let cursorDoc = initialCursorDoc;
            while (!unmounted && cursorDoc) {
                if (typeof maxLimit === 'number' && maxLimit > 0 && recordsMap.size >= maxLimit) {
                    break;
                }
                const remainingWanted = (typeof maxLimit === 'number' && maxLimit > 0)
                    ? Math.min(pageSize, Math.max(1, maxLimit - recordsMap.size))
                    : pageSize;

                const pageQuery = query(colRef, orderBy('createdAt', 'desc'), startAfter(cursorDoc), limit(remainingWanted));
                let pageSnap = null;
                try {
                    const cachedSnap = await getDocsFromCache(pageQuery);
                    if (cachedSnap && cachedSnap.docs.length === remainingWanted) {
                        pageSnap = cachedSnap;
                    }
                } catch {
                    // Fallback to standard getDocs
                }
                if (!pageSnap) {
                    pageSnap = await getDocs(pageQuery);
                }
                if (unmounted || !pageSnap || pageSnap.empty) break;

                let addedInPage = 0;
                pageSnap.docs.forEach(d => {
                    if (!recordsMap.has(d.id)) {
                        recordsMap.set(d.id, { id: d.id, ...d.data() });
                        addedInPage++;
                    }
                });

                cursorDoc = pageSnap.docs[pageSnap.docs.length - 1] || null;
                if (addedInPage > 0 && !unmounted) {
                    emit();
                }

                if (pageSnap.docs.length < remainingWanted) {
                    // Reached the very beginning of historical records
                    archiveComplete = true;
                    break;
                }

                // Yield briefly to keep main thread responsive
                await new Promise(resolve => setTimeout(resolve, 40));
            }

            if (!unmounted) {
                lastSyncMs = Date.now();
                scheduleArchivePersist(archiveComplete);
            }
        } catch (err) {
            console.warn(`Background archive hydration warning (${collectionName}):`, err);
        }
    }

    return () => {
        unmounted = true;
        if (persistTimer) clearTimeout(persistTimer);
        unsubActive();
        unsubDelta();
        activeSyncControllers.get(collectionName)?.delete(controller);
    };
}

/**
 * Paginated one-time fetcher that loads all documents (or up to `maxLimit`) without
 * a hardcoded 2,000-document truncation ceiling.
 */
async function fetchAllPaginated(colRef, pageSize = 1000, maxLimit = null) {
    const results = [];
    let cursorDoc = null;

    while (true) {
        const remaining = (typeof maxLimit === 'number' && maxLimit > 0)
            ? Math.min(pageSize, maxLimit - results.length)
            : pageSize;
        if (remaining <= 0) break;

        const pageQuery = cursorDoc
            ? query(colRef, orderBy('createdAt', 'desc'), startAfter(cursorDoc), limit(remaining))
            : query(colRef, orderBy('createdAt', 'desc'), limit(remaining));

        const snap = await getDocs(pageQuery);
        if (snap.empty) break;

        snap.docs.forEach(d => results.push({ id: d.id, ...d.data() }));
        cursorDoc = snap.docs[snap.docs.length - 1];

        if (snap.docs.length < remaining) break;
    }

    return results;
}

// --- TICKETS ---

export async function getTickets(maxLimit = null) {
    return fetchAllPaginated(ticketsCol, ARCHIVE_TICKET_PAGE_SIZE, maxLimit);
}

export function onTicketsChange(callback, errorCallback, maxLimit = null) {
    return subscribeProgressiveCollection({
        collectionName: 'tickets',
        colRef: ticketsCol,
        activeLimit: ACTIVE_REALTIME_TICKET_LIMIT,
        pageSize: ARCHIVE_TICKET_PAGE_SIZE,
        maxLimit,
        callback,
        errorCallback,
        defaultErrorToast: true
    });
}

export async function addTicket(data) {
    const docRef = await addDoc(ticketsCol, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return docRef.id;
}

export async function addTickets(ticketObjects) {
    const batch = writeBatch(db);
    const ids = [];
    ticketObjects.forEach(data => {
        const docRef = doc(ticketsCol);
        batch.set(docRef, {
            ...data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        ids.push(docRef.id);
    });
    await batch.commit();
    return ids;
}

export async function updateTicket(docId, data) {
    const docRef = doc(db, 'tickets', docId);
    await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function batchUpdateTickets(updates) {
    // updates: array of { id: string, data: object }
    const batch = writeBatch(db);
    updates.forEach(({ id, data }) => {
        const docRef = doc(db, 'tickets', id);
        batch.update(docRef, { ...data, updatedAt: serverTimestamp() });
    });
    await batch.commit();
}

// --- BOOKINGS ---

export async function getBookings(maxLimit = null) {
    return fetchAllPaginated(bookingsCol, ARCHIVE_BOOKING_PAGE_SIZE, maxLimit);
}

export function onBookingsChange(callback, errorCallback, maxLimit = null) {
    return subscribeProgressiveCollection({
        collectionName: 'bookings',
        colRef: bookingsCol,
        activeLimit: ACTIVE_REALTIME_BOOKING_LIMIT,
        pageSize: ARCHIVE_BOOKING_PAGE_SIZE,
        maxLimit,
        callback,
        errorCallback,
        defaultErrorToast: false
    });
}

export async function addBookings(bookingObjects) {
    const batch = writeBatch(db);
    const ids = [];
    bookingObjects.forEach(data => {
        const docRef = doc(bookingsCol);
        batch.set(docRef, {
            ...data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        ids.push(docRef.id);
    });
    await batch.commit();
    return ids;
}

export async function updateBooking(docId, data) {
    const docRef = doc(db, 'bookings', docId);
    await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function batchUpdateBookings(updates) {
    const batch = writeBatch(db);
    updates.forEach(({ id, data }) => {
        const docRef = doc(db, 'bookings', id);
        batch.update(docRef, { ...data, updatedAt: serverTimestamp() });
    });
    await batch.commit();
}

// --- DASHBOARD TASKS & REMINDERS ---

export function onDashboardTasksChange(callback, errorCallback) {
    const q = query(dashboardTasksCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, errorCallback);
}

export async function addDashboardTask(data) {
    const ref = await addDoc(dashboardTasksCol, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return ref.id;
}

export async function updateDashboardTask(id, data) {
    await updateDoc(doc(db, 'dashboardTasks', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function deleteDashboardTask(id) {
    await deleteDoc(doc(db, 'dashboardTasks', id));
}

// --- SETTLEMENTS ---

export async function getSettlements() {
    const q = query(settlementsCol, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function onSettlementsChange(callback, errorCallback) {
    const q = query(settlementsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        const settlements = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(settlements);
    }, (error) => {
        console.error("Firestore onSettlementsChange error:", error);
        if (errorCallback) errorCallback(error);
    });
}

export async function addSettlement(data) {
    const docRef = await addDoc(settlementsCol, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return docRef.id;
}

export async function updateSettlement(id, data) {
    await updateDoc(doc(db, 'settlements', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function deleteSettlement(id) {
    await deleteDoc(doc(db, 'settlements', id));
}

// --- CLOSED PERIODS (Monthly Lock) ---

export async function getClosedPeriods() {
    const q = query(closedPeriodsCol, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function onClosedPeriodsChange(callback, errorCallback) {
    const q = query(closedPeriodsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
        console.error("Firestore onClosedPeriodsChange error:", error);
        if (errorCallback) errorCallback(error);
    });
}

export async function addClosedPeriod(data) {
    const ref = await addDoc(closedPeriodsCol, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return ref.id;
}

export async function deleteClosedPeriod(id) {
    await deleteDoc(doc(db, 'closedPeriods', id));
}

// --- SETTLEMENT ADJUSTMENTS ---

export async function getAdjustments() {
    const q = query(adjustmentsCol, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function onAdjustmentsChange(callback) {
    const q = query(adjustmentsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

export async function addAdjustment(data) {
    const ref = await addDoc(adjustmentsCol, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return ref.id;
}

export async function deleteAdjustment(id) {
    await deleteDoc(doc(db, 'settlementAdjustments', id));
}

// --- HISTORY ---

export async function getHistory(maxLimit = 500) {
    return fetchAllPaginated(historyCol, 500, maxLimit);
}

export async function addHistory(data) {
    const docRef = await addDoc(historyCol, {
        ...data,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

/**
 * Atomically updates a single ticket and writes an audit log in the same transaction/batch.
 */
export async function updateTicketWithAudit(ticketId, updateData, auditData) {
    const batch = writeBatch(db);
    const ticketRef = doc(db, 'tickets', ticketId);
    batch.update(ticketRef, {
        ...updateData,
        updatedAt: serverTimestamp()
    });
    if (auditData) {
        const historyRef = doc(historyCol);
        batch.set(historyRef, {
            ...auditData,
            createdAt: serverTimestamp()
        });
    }
    await batch.commit();
}

/**
 * Atomically batch-updates multiple tickets and writes multiple audit logs in a single batch.
 */
export async function batchUpdateWithAudit(ticketUpdates = [], auditEntries = []) {
    const batch = writeBatch(db);
    (ticketUpdates || []).forEach(({ id, data }) => {
        const docRef = doc(db, 'tickets', id);
        batch.update(docRef, { ...data, updatedAt: serverTimestamp() });
    });
    (auditEntries || []).forEach(entry => {
        const historyRef = doc(historyCol);
        batch.set(historyRef, { ...entry, createdAt: serverTimestamp() });
    });
    await batch.commit();
}

// --- GENERIC ---

export async function deleteDocument(collectionName, docId) {
    await deleteDoc(doc(db, collectionName, docId));
    notifyCollectionDeletion(collectionName, docId);
}

export function onHistoryChange(callback, maxLimit = DEFAULT_HISTORY_REALTIME_LIMIT) {
    const q = maxLimit
        ? query(historyCol, orderBy('createdAt', 'desc'), limit(maxLimit))
        : query(historyCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        const history = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(history);
    });
}

export async function getDocument(collectionName, docId) {
    const docRef = doc(db, collectionName, docId);
    const snap = await getDoc(docRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// --- HOTEL RESERVATIONS ---

export function onHotelsChange(callback, errorCallback) {
    const q = query(hotelsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        const hotels = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(hotels);
    }, (error) => {
        console.error("Firestore onHotelsChange error:", error);
        if (errorCallback) errorCallback(error);
    });
}

export async function addHotelReservation(data) {
    const docRef = await addDoc(hotelsCol, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return docRef.id;
}

export async function updateHotelReservation(docId, data) {
    const docRef = doc(db, 'hotelReservations', docId);
    await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function deleteHotelReservation(docId) {
    await deleteDoc(doc(db, 'hotelReservations', docId));
}
