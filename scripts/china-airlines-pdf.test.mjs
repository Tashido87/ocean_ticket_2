import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createDefaultChinaAirlinesData,
    generateChinaAirlinesPdfDoc,
    renderChinaAirlinesTicketHtml
} from '../china-airlines-converter.js';

test('renderChinaAirlinesTicketHtml returns valid HTML with authentic layout', () => {
    const data = createDefaultChinaAirlinesData();
    data.passengerName = 'Khin Sein Ms';
    data.pnr = 'FEYF43';
    data.ticketNo = '297 2425301246';
    data.flights[0].duration = '03:40';

    const html = renderChinaAirlinesTicketHtml(data);
    assert.match(html, /ELECTRONIC TICKET RECEIPT/);
    assert.match(html, /Khin Sein Ms \(ADT\)/);
    assert.match(html, /FEYF43/);
    assert.match(html, /297 2425301246/);
    assert.match(html, /CI834/);
    assert.match(html, /BANGKOK SUVARNABHUMI INTL/);
    assert.match(html, /TAIPEI TAIWAN TAOYUAN INTL/);
    assert.match(html, /Duration : <\/span><strong[^>]*>03:40/);
    assert.match(html, /ECOMMERCE, NO\. 1, Q HOUSE LUMPINI/);
    assert.match(html, /ELECTRONIC TICKET REMARKS/);
    // Ensure check in text is NOT in HTML
    assert.equal(html.includes('Suvarnabhumi check in'), false);
});

test('generateChinaAirlinesPdfDoc calls jsPDF drawing methods accurately', async () => {
    const data = createDefaultChinaAirlinesData();
    data.passengerName = 'Khin Sein Ms';
    data.pnr = 'FEYF43';
    data.ticketNo = '297 2425301246';

    const drawnTexts = [];
    const drawnRects = [];
    const drawnImages = [];

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
        rect(x, y, w, h, style) { drawnRects.push({ x, y, w, h, style }); }
        text(str, x, y) { drawnTexts.push({ str, x, y }); }
        getTextWidth(str) { return str.length * 5; }
        splitTextToSize(text) { return [text]; }
        addImage(data, format, x, y, w, h) { drawnImages.push({ data, format, x, y, w, h }); }
        save() {}
        output() { return new ArrayBuffer(2048); }
    }

    globalThis.window = {
        jspdf: { jsPDF: MockJsPDF }
    };

    const doc = await generateChinaAirlinesPdfDoc(data);
    assert.ok(doc);

    // Verify key elements were drawn
    const allTexts = drawnTexts.map(t => Array.isArray(t.str) ? t.str.join(' ') : String(t.str)).join(' ');
    assert.match(allTexts, /Passenger/);
    assert.match(allTexts, /Khin Sein Ms \(ADT\)/);
    assert.match(allTexts, /Booking ref/);
    assert.match(allTexts, /FEYF43/);
    assert.match(allTexts, /Ticket number/);
    assert.match(allTexts, /297 2425301246/);
    assert.match(allTexts, /ELECTRONIC TICKET RECEIPT/);
    assert.match(allTexts, /At check-in, you must show a photo ID/);
    assert.match(allTexts, /BANGKOK SUVARNABHUMI INTL/);
    assert.match(allTexts, /TAIPEI TAIWAN TAOYUAN INTL/);
    assert.match(allTexts, /CI834/);
    assert.match(allTexts, /03:40/);
    assert.match(allTexts, /ELECTRONIC TICKET REMARKS/);

    // Verify check-in text is omitted
    assert.equal(allTexts.includes('Suvarnabhumi check in'), false);
});
