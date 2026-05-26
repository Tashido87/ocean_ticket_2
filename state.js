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
    allClosedPeriods: [],
    allAdjustments: [],
    dashboardTasks: [],
    allHotels: [],
    filteredHotels: [],
    hotelPage: 1,
    featuredClients: [], // For starred clients
    history: [],
    charts: {
        comparisonChart: null,
        airlineChart: null
    },
    isSubmitting: false,
    rowsPerPage: 15,
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
    timeUpdateInterval: null, // To hold the timer
    unsubscribers: [], // Firestore real-time listener unsubscribe functions
    recordsEditMode: false // Inline edit mode state for Records
};

// --- AUTHENTICATION STATE ---
let currentUser = null;

export function getCurrentUserState() {
    return currentUser;
}

export function setCurrentUser(user) {
    currentUser = user;
}
