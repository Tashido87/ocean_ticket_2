import test from 'node:test';
import assert from 'node:assert/strict';

import {
    renderChinaEasternTicketHtml,
    generateChinaEasternPdfDoc,
    renderVietnamAirlinesTicketHtml,
    generateVietnamAirlinesPdfDoc,
    renderCathayPacificTicketHtml,
    generateCathayPacificPdfDoc,
    renderHongKongAirlinesTicketHtml,
    generateHongKongAirlinesPdfDoc,
    renderHkExpressTicketHtml,
    generateHkExpressPdfDoc
} from '../new-airlines-converter.js';

import {
    renderAirAsiaTicketHtml,
    generateAirAsiaPdfDoc,
    buildTicketDownloadFilename
} from '../airasia-converter.js';

import {
    detectAirlineFromText,
    generateTicketNumber,
    getAirlineCarrierName
} from '../china-airlines-parser.mjs';

// Setup Mock jsPDF
class MockJsPDF {
    constructor() {
        this.internal = { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } };
    }
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setFillColor() {}
    setDrawColor() {}
    setLineWidth() {}
    line() {}
    rect() {}
    roundedRect() {}
    text() {}
    getTextWidth(str) { return (str || '').length * 5; }
    splitTextToSize(text) { return [text]; }
    addImage() {}
    save() {}
    output() { return new ArrayBuffer(2048); }
}

globalThis.window = {
    jspdf: { jsPDF: MockJsPDF }
};

test('China Eastern Airlines: HTML preview and PDF generator match brand specifications', async () => {
    const data = {
        airline: 'China Eastern',
        passengerName: 'WANG / XIAOMING MR',
        pnr: 'PK2PKZ',
        ticketNo: '781-2490182341',
        issuedDate: '21 Oct 2026',
        flights: [{
            flightNo: 'MU 562',
            depAirport: 'Sydney - Kingsford Smith (SYD)',
            depTerminal: 'Terminal 1',
            arrAirport: 'Shanghai - Pudong (PVG)',
            arrTerminal: 'Terminal 1',
            depTime: '11:00',
            arrTime: '19:20',
            depDateFormatted: 'Wednesday, 21 Oct 2026',
            flightClass: 'Economy (T)',
            aircraft: 'Airbus A350-900',
            seat: '14A'
        }],
        checkedBaggage: '2PC (23KG each)'
    };

    const html = renderChinaEasternTicketHtml(data);
    assert.match(html, /PASSENGER E-TICKET RECEIPT/i);
    assert.match(html, /ELECTRONIC ITINERARY \/ PASSENGER RECEIPT/);
    assert.match(html, /WANG \/ XIAOMING MR/);
    assert.match(html, /PK2PKZ/);
    assert.match(html, /781-2490182341/);
    assert.match(html, /MU 562/);
    assert.match(html, /SYD/);
    assert.match(html, /PVG/);
    assert.match(html, /2PC \(23kg/i);

    const doc = await generateChinaEasternPdfDoc(data);
    assert.ok(doc);

    // Test dispatch through universal renderAirAsiaTicketHtml
    const dispatchedHtml = renderAirAsiaTicketHtml(data);
    assert.match(dispatchedHtml, /PASSENGER E-TICKET RECEIPT/i);

    // Test filename
    const fn = buildTicketDownloadFilename(data, 'pdf');
    assert.match(fn, /^ChinaEastern_ETicket_PK2PKZ_/);
});

test('Vietnam Airlines: HTML preview and PDF generator match brand specifications', async () => {
    const data = {
        airline: 'Vietnam Airlines',
        passengerName: 'NGUYEN / VAN A MR',
        pnr: 'VN64FF',
        ticketNo: '738 2402560327',
        issuedDate: '21 Oct 2026',
        flights: [{
            flightNo: 'VN 126',
            depAirport: 'Ho Chi Minh - Tan Son Nhat (SGN)',
            depTerminal: 'Terminal 1',
            arrAirport: 'Da Nang - International (DAD)',
            arrTerminal: 'Terminal 1',
            depTime: '08:30',
            arrTime: '09:50',
            depDateFormatted: 'Wednesday, 21 Oct 2026',
            flightClass: 'Economy Classic (K)',
            aircraft: 'Boeing 787-9',
            seat: '16C'
        }],
        checkedBaggage: '1PC (23KG)'
    };

    const html = renderVietnamAirlinesTicketHtml(data);
    assert.match(html, /ELECTRONIC TICKET RECEIPT/i);
    assert.match(html, /VIETNAM AIRLINES - SKYTEAM MEMBER/);
    assert.match(html, /NGUYEN \/ VAN A MR/);
    assert.match(html, /VN64FF/);
    assert.match(html, /738 2402560327/);
    assert.match(html, /VN 126/);
    assert.match(html, /SGN/);
    assert.match(html, /DAD/);

    const doc = await generateVietnamAirlinesPdfDoc(data);
    assert.ok(doc);

    const dispatchedDoc = await generateAirAsiaPdfDoc(data);
    assert.ok(dispatchedDoc);

    const fn = buildTicketDownloadFilename(data, 'pdf');
    assert.match(fn, /^VietnamAirlines_ETicket_VN64FF_/);
});

test('Cathay Pacific: HTML preview and PDF generator match brand specifications', async () => {
    const data = {
        airline: 'Cathay Pacific',
        passengerName: 'CHAN / TAI MAN MR',
        pnr: 'CX8901',
        ticketNo: '160-2396886426',
        issuedDate: '21 Oct 2026',
        flights: [{
            flightNo: 'CX 714',
            depAirport: 'Singapore - Changi (SIN)',
            depTerminal: 'Terminal 4',
            arrAirport: 'Hong Kong - International (HKG)',
            arrTerminal: 'Terminal 1',
            depTime: '01:15',
            arrTime: '05:05',
            depDateFormatted: 'Wednesday, 21 Oct 2026',
            flightClass: 'Economy (K)',
            aircraft: 'Airbus A350-1000',
            seat: '18D'
        }],
        checkedBaggage: '2PC (23KG each)'
    };

    const html = renderCathayPacificTicketHtml(data);
    assert.match(html, /eTicket Receipt/i);
    assert.match(html, /Cathay Pacific Airways/);
    assert.match(html, /CHAN \/ TAI MAN MR/);
    assert.match(html, /CX8901/);
    assert.match(html, /160-2396886426/);
    assert.match(html, /CX 714/);
    assert.match(html, /SIN/);
    assert.match(html, /HKG/);

    const doc = await generateCathayPacificPdfDoc(data);
    assert.ok(doc);

    const fn = buildTicketDownloadFilename(data, 'pdf');
    assert.match(fn, /^CathayPacific_ETicket_CX8901_/);
});

test('Hong Kong Airlines: HTML preview and PDF generator match brand specifications', async () => {
    const data = {
        airline: 'Hong Kong Airlines',
        passengerName: 'LEE / SIU LUNG MR',
        pnr: 'HX9921',
        ticketNo: '851-4920193850',
        issuedDate: '21 Oct 2026',
        flights: [{
            flightNo: 'HX 264',
            depAirport: 'Hong Kong - International (HKG)',
            depTerminal: 'Terminal 1',
            arrAirport: 'Taipei - Taoyuan (TPE)',
            arrTerminal: 'Terminal 1',
            depTime: '10:25',
            arrTime: '12:15',
            depDateFormatted: 'Wednesday, 21 Oct 2026',
            flightClass: 'Economy (E)',
            aircraft: 'Airbus A330-300',
            seat: '15B'
        }],
        checkedBaggage: '20KG / 1PC'
    };

    const html = renderHongKongAirlinesTicketHtml(data);
    assert.match(html, /ELECTRONIC TICKET RECEIPT/i);
    assert.match(html, /HONG KONG AIRLINES \(HX - 851\)/);
    assert.match(html, /LEE \/ SIU LUNG MR/);
    assert.match(html, /HX9921/);
    assert.match(html, /851-4920193850/);
    assert.match(html, /HX 264/);

    const doc = await generateHongKongAirlinesPdfDoc(data);
    assert.ok(doc);

    const fn = buildTicketDownloadFilename(data, 'pdf');
    assert.match(fn, /^HongKongAirlines_ETicket_HX9921_/);
});

test('HK Express: HTML preview and PDF generator match brand specifications', async () => {
    const data = {
        airline: 'HK Express',
        passengerName: 'CHEUNG / CHEUK NAM MR',
        pnr: 'UO3342',
        ticketNo: '01684920192',
        issuedDate: '21 Oct 2026',
        flights: [{
            flightNo: 'UO 614',
            depAirport: 'Hong Kong - International (HKG)',
            depTerminal: 'Terminal 1',
            arrAirport: 'Seoul - Incheon (ICN)',
            arrTerminal: 'Terminal 1',
            depTime: '08:10',
            arrTime: '13:00',
            depDateFormatted: 'Wednesday, 21 Oct 2026',
            flightClass: 'Economy (Fun)',
            aircraft: 'Airbus A321neo',
            seat: '12A'
        }],
        checkedBaggage: 'Checked: 20kg'
    };

    const html = renderHkExpressTicketHtml(data);
    assert.match(html, /BOOKING ITINERARY & E-RECEIPT/i);
    assert.match(html, /CHEUNG \/ CHEUK NAM MR/);
    assert.match(html, /UO3342/);
    assert.match(html, /UO 614/);
    assert.match(html, /20kg/i);
    assert.match(html, /7kg carry-on/i);

    const doc = await generateHkExpressPdfDoc(data);
    assert.ok(doc);

    const fn = buildTicketDownloadFilename(data, 'pdf');
    assert.match(fn, /^HKExpress_ETicket_UO3342_/);
});

test('Parser and Ticket Generator correctly handles all 5 new airlines', () => {
    // Airline Detection from text & flight number
    assert.equal(detectAirlineFromText('Flight MU562 SYD to PVG'), 'China Eastern');
    assert.equal(detectAirlineFromText('Vietnam Airlines reservation VN126'), 'Vietnam Airlines');
    assert.equal(detectAirlineFromText('Cathay Pacific CX714 departure'), 'Cathay Pacific');
    assert.equal(detectAirlineFromText('Hong Kong Airlines HX264 TPE'), 'Hong Kong Airlines');
    assert.equal(detectAirlineFromText('HK Express UO614 to ICN'), 'HK Express');

    // Carrier name mapping
    assert.equal(getAirlineCarrierName('MU562'), 'CHINA EASTERN AIRLINES');
    assert.equal(getAirlineCarrierName('VN126'), 'VIETNAM AIRLINES');
    assert.equal(getAirlineCarrierName('CX714'), 'CATHAY PACIFIC AIRWAYS');
    assert.equal(getAirlineCarrierName('HX264'), 'HONG KONG AIRLINES');
    assert.equal(getAirlineCarrierName('UO614'), 'HK EXPRESS');

    // Ticket Number generation prefixes
    assert.match(generateTicketNumber('China Eastern'), /^781 \d{10}$/);
    assert.match(generateTicketNumber('Vietnam Airlines'), /^738 \d{10}$/);
    assert.match(generateTicketNumber('Cathay Pacific'), /^160 \d{10}$/);
    assert.match(generateTicketNumber('Hong Kong Airlines'), /^851 \d{10}$/);
});
