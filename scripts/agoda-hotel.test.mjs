import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DESTINATION_PRESETS,
    renderAgodaHotelHtml,
    parseHotelConfirmationText
} from '../agoda-hotel-converter.js';

test('DESTINATION_PRESETS includes all 4 Yangon hotels with verified phone numbers', () => {
    // 1. Lotte Hotel Yangon
    const lotte = DESTINATION_PRESETS['Yangon - Lotte'];
    assert.ok(lotte);
    assert.equal(lotte.propertyName, 'Lotte Hotel Yangon');
    assert.equal(lotte.propertyContact, '+95 1 935 1000');
    assert.match(lotte.propertyAddress, /82 Sin Phyu Shin Avenue/);

    // 2. Sedona Hotel Yangon
    const sedona = DESTINATION_PRESETS['Yangon - Sedona'];
    assert.ok(sedona);
    assert.equal(sedona.propertyName, 'Sedona Hotel Yangon');
    assert.equal(sedona.propertyContact, '+95 1 860 5377');
    assert.match(sedona.propertyAddress, /1 Kabar Aye Pagoda Rd/);

    // 3. Melia Yangon
    const melia = DESTINATION_PRESETS['Yangon - Melia'];
    assert.ok(melia);
    assert.equal(melia.propertyName, 'Melia Yangon');
    assert.equal(melia.propertyContact, '+95 1 934 5000');
    assert.match(melia.propertyAddress, /192, Kaba Aye Pagoda Road/);

    // 4. Sayarsan Hotel Yangon
    const sayarsan = DESTINATION_PRESETS['Yangon - Sayarsan'];
    assert.ok(sayarsan);
    assert.equal(sayarsan.propertyName, 'Sayarsan Hotel Yangon');
    assert.equal(sayarsan.propertyContact, '+95 1 860 5722');
    assert.match(sayarsan.propertyAddress, /Sayarsan Road/);

    // Aliases
    assert.equal(DESTINATION_PRESETS['Lotte Hotel Yangon'], lotte);
    assert.equal(DESTINATION_PRESETS['Sedona Hotel Yangon'], sedona);
    assert.equal(DESTINATION_PRESETS['Melia Yangon'], melia);
    assert.equal(DESTINATION_PRESETS['Sayarsan Hotel Yangon'], sayarsan);
});

test('renderAgodaHotelHtml renders Yangon hotel preview properly', () => {
    const html = renderAgodaHotelHtml({
        destination: 'Yangon - Lotte',
        clientName: 'TASHIDO',
        arrivalDate: '2026-11-01',
        departureDate: '2026-11-05'
    });
    assert.match(html, /Lotte Hotel Yangon/);
    assert.match(html, /\+95 1 935 1000/);
    assert.match(html, /TASHIDO/);
});

test('parseHotelConfirmationText detects Yangon hotels accurately', () => {
    const sampleVoucher = `
        Agoda Booking Confirmation
        Booking ID: 987654321012
        Hotel: Sedona Hotel Yangon
        Address: 1 Kabar Aye Pagoda Rd, Yankin Township
        Guest: TASHIDO
    `;
    const parsed = parseHotelConfirmationText(sampleVoucher);
    assert.equal(parsed.destination, 'Yangon - Sedona');
});
