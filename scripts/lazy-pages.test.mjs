import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('page tools load on demand, initialize once, and allow retry after failure', async () => {
    const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const source = main.slice(main.indexOf('let hotelPageReady ='), main.indexOf("document.addEventListener('ocean:viewchange'"));
    const calls = { hotel: 0, service: 0, air: 0, agoda: 0, errors: 0 };
    let fail = true;
    const view = { inert: false, setAttribute() {}, removeAttribute() {}, before() {} };
    const hotel = {
        initHotelService() { calls.service++; },
        initHotelReservationSystem() { calls.hotel++; },
        renderHotelReservations() {}
    };
    const context = vm.createContext({
        document: { getElementById: () => view, createElement: () => ({ setAttribute() {}, remove() {} }) },
        console: { error() {} },
        showToast() { calls.errors++; },
        initializeAirAsiaGenerator() { calls.air++; },
        initializeChinaHotelGenerator() { calls.agoda++; },
        async importModule(path) {
            if (path.includes('hotel.js?')) return hotel;
            if (fail) throw new Error('Network offline');
            return {};
        }
    });
    const names = ['extractTextFromPdf', 'parseItineraryText', 'renderAirAsiaTicketHtml', 'downloadAirAsiaPdf', 'downloadAirAsiaImage', 'shareAirAsiaTicket', 'formatCheckedBaggageLine', 'renderAgodaHotelHtml', 'downloadAgodaPdf', 'downloadAgodaImage', 'shareAgodaBooking', 'generateRandomBookingId', 'generateRandomMemberId', 'formatAgodaDate', 'calculateDefaultCancellationDate', 'DESTINATION_PRESETS', 'parseHotelConfirmationPdf'];
    vm.runInContext(`let hotelModule; let ${names.join(',')};\n${source.replaceAll('import(', 'importModule(')}`, context);
    await context.loadPageFeatures('home');
    assert.equal(calls.hotel, 0);
    await context.loadPageFeatures('services');
    assert.equal(calls.errors, 1);
    assert.equal(view.inert, false);
    fail = false;
    await Promise.all([context.loadPageFeatures('services'), context.loadPageFeatures('services'), context.loadPageFeatures('hotel')]);
    await context.loadPageFeatures('services');
    assert.deepEqual(calls, { hotel: 1, service: 1, air: 1, agoda: 1, errors: 1 });
});
