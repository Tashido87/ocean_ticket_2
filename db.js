/**
 * @fileoverview Firebase Firestore data layer.
 * Replaces api.js. All database operations go through this file.
 */

import { db } from './firebase-config.js';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    query,
    orderBy,
    where,
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

// --- TICKETS ---

export async function getTickets() {
    const q = query(ticketsCol, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function onTicketsChange(callback) {
    const q = query(ticketsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        const tickets = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(tickets);
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

export async function getBookings() {
    const q = query(bookingsCol, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function onBookingsChange(callback) {
    const q = query(bookingsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        const bookings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(bookings);
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

export function onSettlementsChange(callback) {
    const q = query(settlementsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        const settlements = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(settlements);
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

export function onClosedPeriodsChange(callback) {
    const q = query(closedPeriodsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
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

export async function getHistory() {
    const q = query(historyCol, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addHistory(data) {
    const docRef = await addDoc(historyCol, {
        ...data,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

// --- GENERIC ---

export async function deleteDocument(collectionName, docId) {
    await deleteDoc(doc(db, collectionName, docId));
}

export function onHistoryChange(callback) {
    const q = query(historyCol, orderBy('createdAt', 'desc'));
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
const hotelsCol = collection(db, 'hotelReservations');

export function onHotelsChange(callback) {
    const q = query(hotelsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        const hotels = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(hotels);
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
