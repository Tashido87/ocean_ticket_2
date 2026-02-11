/**
 * @fileoverview Manages the global state for the application.
 */

// --- GLOBAL STATE & CACHE ---
export const state = {
    allTickets: [],
    filteredTickets: [],
    allBookings: [],
    filteredBookings: [],
    allClients: [],
    allSettlements: [],
    featuredClients: [], // For starred clients
    history: [],
    charts: {
        comparisonChart: null
    },
    isSubmitting: false,
    rowsPerPage: 10,
    currentPage: 1,
    bookingCurrentPage: 1,
    historyPage: 1,
    clientPage: 1,
    settlementPage: 1,
    searchTimeout: null,
    clientSearchQuery: '', // Stores the last client search
    onlyShowFeatured: false, // ADD THIS LINE
    cache: {}, // In-memory cache
    bookingToUpdate: null,
    commissionRates: { // Default commission rates
        cut: 0.60 // 60%
    },
    timeUpdateInterval: null // To hold the timer
};

// --- AUTHENTICATION STATE ---
let tokenClient;
let gapiInited = false;
let gisInited = false;

export function getAuth() {
    return {
        tokenClient,
        gapiInited,
        gisInited
    };
}

export function setTokenClient(client) {
    tokenClient = client;
}

export function setGapiInited(value) {
    gapiInited = value;
}

export function setGisInited(value) {
    gisInited = value;
}