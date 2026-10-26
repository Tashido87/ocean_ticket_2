import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItineraryText, formatCheckedBaggageLine, renderAirAsiaTicketHtml } from '../airasia-converter.js';
import { parseItinerarySchedule } from '../china-airlines-parser.mjs';

test('parseItineraryText correctly detects "No free baggage allowance" and does not hardcode 30 kg', () => {
    const rawTripDoc = `
Trip.com E-Ticket / Receipt
Booking No. 12984719284
Booking Ref: ABCDEF
Thai AirAsia FD 252 Economy
Passenger: SOE SANDAR TUN
Yangon (RGN) to Bangkok (DMK)
Departure: 14 Nov 2026 08:30
Arrival: 14 Nov 2026 10:15

Baggage Allowance
Personal item: 1 piece per person (max 40x30x10 cm)
Carry-on baggage: 1 piece per person (max 56x36x23 cm)
Checked baggage: No free baggage allowance
* The total weight of the personal item and carry-on baggage cannot exceed 7 kg.
`;

    const parsed = parseItineraryText(rawTripDoc);
    assert.equal(parsed.airline, 'AirAsia');
    assert.match(parsed.checkedBaggage, /no\s*free\s*baggage\s*allowance/i);
    assert.doesNotMatch(parsed.checkedBaggage, /30\s*kg/i);
    assert.doesNotMatch(parsed.checkedBaggage, /7\s*kg\s*per\s*person/i);
});

test('parseItineraryText parses explicit weight when baggage is included', () => {
    const docWith20kg = `
Booking Reference: HIGGNX
AirAsia FD 252
Checked baggage: 20 kg per person
Carry-on baggage: 1 piece per person (max 56x36x23 cm)
`;
    const parsed = parseItineraryText(docWith20kg);
    assert.match(parsed.checkedBaggage, /20\s*kg\s*per\s*person/i);
});

test('parseItineraryText handles 0 kg as no free baggage allowance', () => {
    const doc0kg = `
Booking Ref: QWERT1
Scoot TR 801
Checked baggage: 0 kg
Carry-on: 7 kg
`;
    const parsed = parseItineraryText(doc0kg);
    assert.equal(parsed.airline, 'Scoot');
    assert.match(parsed.checkedBaggage, /Checked:\s*No free baggage allowance/i);
    assert.doesNotMatch(parsed.checkedBaggage, /30\s*kg/i);
});

test('formatCheckedBaggageLine formats no free baggage cleanly', () => {
    assert.equal(
        formatCheckedBaggageLine('No free baggage allowance\nOptional checked baggage can be purchased separately'),
        'Checked: No free baggage allowance   |   Carry-on: 7 kg'
    );
    assert.equal(
        formatCheckedBaggageLine('Checked: 0 kg'),
        'Checked: No free baggage allowance   |   Carry-on: 7 kg'
    );
    assert.equal(
        formatCheckedBaggageLine('20 kg per person'),
        'Checked: 20 kg   |   Carry-on: 7 kg'
    );
    assert.equal(
        formatCheckedBaggageLine('Checked: 2 Pcs, 23 kg   |   Carry-on: 7 kg'),
        'Checked: 2 Pcs, 23 kg   |   Carry-on: 7 kg'
    );
});

test('renderAirAsiaTicketHtml does not display piece dimensions when no baggage allowance', () => {
    const data = {
        airline: 'AirAsia',
        pnr: 'FD1234',
        passengerName: 'SOE SANDAR TUN',
        checkedBaggage: 'No free baggage allowance\nOptional checked baggage can be purchased separately',
        carryOnBaggage: '1 piece per person\nMax 56 x 36 x 23 cm per piece',
        personalItem: '1 piece per person\nMax 40 x 30 x 10 cm per piece',
        flights: [{
            flightNo: 'FD 252',
            airlineName: 'Thai AirAsia',
            depTime: '08:30',
            arrTime: '10:15',
            depAirport: 'Yangon (RGN)',
            arrAirport: 'Bangkok (DMK)'
        }]
    };

    const html = renderAirAsiaTicketHtml(data);
    assert.match(html, /No free baggage allowance/i);
    assert.doesNotMatch(html, /30\s*kg\s*per\s*person/i);
    assert.doesNotMatch(html, /Each piece max 119 x 119 x 81 cm/i);
});

test('parseItinerarySchedule extracts "No free baggage allowance" for OCR itineraries', () => {
    const ocrText = `
Trip.com
Flight FD252
Booking Ref HIGGNX
Passenger: SOE SANDAR TUN
Checked baggage: No free baggage allowance
Personal item and carry-on max 7 kg
`;
    const res = parseItinerarySchedule(ocrText, 2026);
    assert.equal(res.detectedAirline, 'AirAsia');
    assert.match(res.checkedBaggage, /No free baggage allowance/i);
    assert.doesNotMatch(res.checkedBaggage, /30\s*kg/i);
});
