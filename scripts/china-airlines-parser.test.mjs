import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseItinerarySchedule,
    formatPassengerName,
    generateBookingRef,
    generateTicketNumber,
    formatAirlineDate,
    calculateTicketValidity,
    formatIssueDate
} from '../china-airlines-parser.mjs';

test('formatPassengerName appends (ADT) if not present', () => {
    assert.equal(formatPassengerName('Khin Sein Ms'), 'Khin Sein Ms (ADT)');
    assert.equal(formatPassengerName('KHIN SEIN MS (ADT)'), 'KHIN SEIN MS (ADT)');
    assert.equal(formatPassengerName('MR JOHN DOE'), 'MR JOHN DOE (ADT)');
    assert.equal(formatPassengerName('DOE / JOHN MR'), 'DOE / JOHN MR (ADT)');
    assert.equal(formatPassengerName('WIN MAR SEIN'), 'WIN MAR SEIN (ADT)');
    assert.equal(formatPassengerName(''), '');
});

test('generateBookingRef creates 6-char alphanumeric code', () => {
    const pnr = generateBookingRef();
    assert.equal(pnr.length, 6);
    assert.match(pnr, /^[A-Z0-9]{6}$/);
});

test('generateTicketNumber creates 13-digit ticket starting with 297', () => {
    const tkt = generateTicketNumber();
    assert.match(tkt, /^297\s\d{10}$/);
});

test('ticket validity calculation matches China Airlines rules', () => {
    const depDate = '25SEP2026';
    const issueDate = '18JUL2026';

    // 1. Same day formula (standard promo / restricted)
    const sameDay = calculateTicketValidity(depDate, issueDate, 'same_day');
    assert.equal(sameDay.nvb, '25SEP2026');
    assert.equal(sameDay.nva, '25SEP2026');

    // 2. 1-year formula (flexible / annual open)
    const annual = calculateTicketValidity(depDate, issueDate, '1_year');
    assert.equal(annual.nvb, '25SEP2026');
    assert.equal(annual.nva, '18JUL2027');

    // 3. 3-months formula
    const threeM = calculateTicketValidity(depDate, issueDate, '3_months');
    assert.equal(threeM.nvb, '25SEP2026');
    assert.equal(threeM.nva, '25DEC2026');
});

test('parseItinerarySchedule extracts sectors from Trip.com screenshot OCR (Round Trip)', () => {
    const ocrText = `
Estimating resolution as 151
$88 Yangon (RGN) — Taipei (TPE) | Tue, Nov 3 | Duration 3h 55m

10:50 RGN Yangon Intl. T1
China Airlines CI7916 Airbus A321neo Economy class ‘e ¥ Yt Fi

16:15 TPE Taipei Taiwan Taoyuan Intl. T1
§88 Taipei (TPE) = Yangon (RGN) | Tue, Nov 17 | Duration 4h 20m

07:00 TPE Taipei Taiwan Taoyuan Intl. T1

China Airlines CI7915 Airbus A321neo Economy class ‘= ¥ YT

BY
a

09:50 RGN Yangon Intl. T1
    `;

    const result = parseItinerarySchedule(ocrText, 2026);
    assert.equal(result.flights.length, 2);

    // Sector 1
    const s1 = result.flights[0];
    assert.equal(s1.flightNo, 'CI7916');
    assert.match(s1.from, /YANGON/i);
    assert.match(s1.to, /TAIPEI/i);
    assert.equal(s1.depTime, '10:50');
    assert.equal(s1.arrTime, '16:15');
    assert.equal(s1.depDate, '03NOV2026');
    assert.equal(s1.arrDate, '03NOV2026');
    assert.equal(s1.duration, '03:55');
    assert.equal(s1.depTerminal, '1');
    assert.equal(s1.arrTerminal, '1');

    // Sector 2
    const s2 = result.flights[1];
    assert.equal(s2.flightNo, 'CI7915');
    assert.match(s2.from, /TAIPEI/i);
    assert.match(s2.to, /YANGON/i);
    assert.equal(s2.depTime, '07:00');
    assert.equal(s2.arrTime, '09:50');
    assert.equal(s2.depDate, '17NOV2026');
    assert.equal(s2.arrDate, '17NOV2026');
    assert.equal(s2.duration, '04:20');
    assert.equal(s2.depTerminal, '1');
    assert.equal(s2.arrTerminal, '1');
});

test('parseItinerarySchedule extracts One-Way flight and handles manual passenger name', () => {
    const ocrText = `
Bangkok (BKK) — Taipei (TPE) | Fri, Sep 25 | Duration 3h 40m
10:50 BKK Suvarnabhumi Intl.
China Airlines CI834 Boeing 777 Economy class
15:30 TPE Taipei Taiwan Taoyuan Intl. T1
    `;

    const result = parseItinerarySchedule(ocrText, 2026);
    assert.equal(result.flights.length, 1);
    const f = result.flights[0];
    assert.equal(f.flightNo, 'CI834');
    assert.match(f.from, /BANGKOK/i);
    assert.match(f.to, /TAIPEI/i);
    assert.equal(f.depTime, '10:50');
    assert.equal(f.arrTime, '15:30');
    assert.equal(f.depDate, '25SEP2026');
    assert.equal(f.duration, '03:40');

    // Name is empty initially, user supplies it and gets formatted with (ADT)
    const formatted = formatPassengerName('Khin Sein Ms');
    assert.equal(formatted, 'Khin Sein Ms (ADT)');
});
