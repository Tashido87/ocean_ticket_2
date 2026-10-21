import { loadDocumentLibraries } from './document-libraries.js';
import {
    resolveAirportName,
    splitCityAndAirport,
    formatPassengerName,
    generateRandomSeat,
    formatAirlineDate,
    formatIssueDate,
    calculateTicketValidity
} from './china-airlines-parser.mjs';

/**
 * Cached Logo Data URLs for the 5 New Airlines
 */
let cachedChinaEasternLogoDataUrl = null;
let cachedVietnamAirlinesLogoDataUrl = null;
let cachedCathayPacificLogoDataUrl = null;
let cachedHongKongAirlinesLogoDataUrl = null;
let cachedHkExpressLogoDataUrl = null;

/**
 * Preload and cache logo as Data URL for HTML preview and PDF export
 */
export async function getNewAirlineLogoDataUrl(airline) {
    if (typeof Image === 'undefined') {
        if (/China Eastern/i.test(airline)) return 'assets/china-eastern-logo.png';
        if (/Vietnam/i.test(airline)) return 'assets/vietnam-airlines-logo.png';
        if (/Cathay/i.test(airline)) return 'assets/cathay-pacific-logo.png';
        if (/Hong Kong Airlines/i.test(airline)) return 'assets/hong-kong-airlines-logo.png';
        if (/HK Express/i.test(airline)) return 'assets/hk-express-logo.png';
        return 'assets/china-eastern-logo.png';
    }

    if (/China Eastern/i.test(airline) && cachedChinaEasternLogoDataUrl) return cachedChinaEasternLogoDataUrl;
    if (/Vietnam/i.test(airline) && cachedVietnamAirlinesLogoDataUrl) return cachedVietnamAirlinesLogoDataUrl;
    if (/Cathay/i.test(airline) && cachedCathayPacificLogoDataUrl) return cachedCathayPacificLogoDataUrl;
    if (/Hong Kong Airlines/i.test(airline) && cachedHongKongAirlinesLogoDataUrl) return cachedHongKongAirlinesLogoDataUrl;
    if (/HK Express/i.test(airline) && cachedHkExpressLogoDataUrl) return cachedHkExpressLogoDataUrl;

    let src = 'assets/china-eastern-logo.png';
    if (/China Eastern/i.test(airline)) src = 'assets/china-eastern-logo.png';
    else if (/Vietnam/i.test(airline)) src = 'assets/vietnam-airlines-logo.png';
    else if (/Cathay/i.test(airline)) src = 'assets/cathay-pacific-logo.png';
    else if (/Hong Kong Airlines/i.test(airline)) src = 'assets/hong-kong-airlines-logo.png';
    else if (/HK Express/i.test(airline)) src = 'assets/hk-express-logo.png';

    try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = src;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');

        if (/China Eastern/i.test(airline)) cachedChinaEasternLogoDataUrl = dataUrl;
        else if (/Vietnam/i.test(airline)) cachedVietnamAirlinesLogoDataUrl = dataUrl;
        else if (/Cathay/i.test(airline)) cachedCathayPacificLogoDataUrl = dataUrl;
        else if (/Hong Kong Airlines/i.test(airline)) cachedHongKongAirlinesLogoDataUrl = dataUrl;
        else if (/HK Express/i.test(airline)) cachedHkExpressLogoDataUrl = dataUrl;

        return dataUrl;
    } catch (e) {
        console.warn('Could not cache logo for', airline, e);
        return src;
    }
}

/**
 * HTML Escape Helper
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Format passenger name ensuring (ADT) is attached
 */
function normalizePaxName(rawName) {
    return formatPassengerName(rawName || 'PASSENGER / SAMPLE MR');
}

/**
 * Extract clean airport code e.g. 'TPE' from 'Taipei - Taoyuan (TPE)'
 */
function extractAirportCode(str) {
    if (!str) return '';
    const m = String(str).match(/\(([A-Z]{3})\)/);
    if (m) return m[1];
    const m2 = String(str).match(/\b([A-Z]{3})\b/);
    if (m2) return m2[1];
    return '';
}

/**
 * Extract clean city name
 */
function extractCityName(str) {
    if (!str) return '';
    const clean = String(str).trim();
    const dashIdx = clean.indexOf(' - ');
    if (dashIdx !== -1) {
        return clean.substring(0, dashIdx).trim();
    }
    const split = splitCityAndAirport(clean);
    return split.city || clean;
}

/**
 * Normalize flight sectors for rendering
 */
function prepareFlightList(data, defaultAirlineName, defaultFlightNo, defaultAircraft) {
    const flights = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || defaultFlightNo,
            airlineName: data.airlineName || defaultAirlineName,
            depTime: data.depTime || '09:00',
            depDateFormatted: data.depDateFormatted || 'Saturday, 1 Nov 2026',
            depAirport: data.depAirport || 'Yangon - Mingaladon (RGN)',
            depTerminal: data.depTerminal || 'Terminal 1',
            arrTime: data.arrTime || '14:30',
            arrDateFormatted: data.arrDateFormatted || 'Saturday, 1 Nov 2026',
            arrAirport: data.arrAirport || 'Bangkok - Suvarnabhumi (BKK)',
            arrTerminal: data.arrTerminal || 'Terminal 1',
            route: data.route || 'RGN - BKK',
            duration: data.duration || '2h 30min, Non-Stop',
            aircraft: data.aircraft || defaultAircraft,
            flightClass: data.flightClass || 'Economy (Y)',
            seat: data.seat || ''
        }];

    return flights.map((fl, idx) => {
        const fromCode = extractAirportCode(fl.depAirport) || 'RGN';
        const toCode = extractAirportCode(fl.arrAirport) || 'BKK';
        const depCity = extractCityName(fl.depAirport) || 'YANGON';
        const arrCity = extractCityName(fl.arrAirport) || 'BANGKOK';
        const seat = fl.seat || data.seat || generateRandomSeat();
        return {
            ...fl,
            fromCode,
            toCode,
            depCity,
            arrCity,
            seat,
            depTerminal: fl.depTerminal || 'Terminal 1',
            arrTerminal: fl.arrTerminal || 'Terminal 1'
        };
    });
}

/**
 * Prepare passenger list
 */
function preparePaxList(data) {
    if (data.passengers && data.passengers.length > 0) {
        return data.passengers.map(p => ({
            name: normalizePaxName(p.name),
            type: p.type || 'Adult',
            seat: p.seat || data.seat || generateRandomSeat()
        }));
    }
    return [{
        name: normalizePaxName(data.passengerName),
        type: data.passengerType || 'Adult',
        seat: data.seat || generateRandomSeat()
    }];
}

/* ========================================================================= */
/* 1. CHINA EASTERN AIRLINES (MU / 781) - HTML & PDF                        */
/* ========================================================================= */

export function renderChinaEasternTicketHtml(data) {
    const logoSrc = cachedChinaEasternLogoDataUrl || 'assets/china-eastern-logo.png';
    const pnr = (data.pnr || data.bookingNo || 'D8YUUK').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `781-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'China Eastern Airlines', 'MU 562', 'Airbus A350-900');
    const checkedBag = data.checkedBaggage || '2PC (23KG each)';

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#24292F; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.08); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Top Crimson Brand Accent -->
        <div style="height:4px; background:#CE1126; margin-bottom:18px; border-radius:2px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="China Eastern Airlines" style="height:44px; max-width:240px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:18px; font-weight:800; color:#CE1126; letter-spacing:0.5px; text-transform:uppercase;">Passenger E-Ticket Receipt</div>
                <div style="font-size:12px; font-weight:700; color:#00205B; letter-spacing:1px; margin-top:1px;">电子客票行程单 / 旅客联</div>
                <div style="font-size:10px; color:#57606A; margin-top:3px;">Issuing Carrier: CHINA EASTERN AIRLINES (MU - 781)</div>
            </div>
        </div>

        <!-- Booking & Passenger Overview Table -->
        <table style="width:100%; border-collapse:collapse; background:#F6F8FA; border:1px solid #D0D7DE; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; width:18%; font-weight:700; color:#57606A;">Passenger Name</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; width:32%; font-weight:700; color:#00205B; font-size:12px;">${escapeHtml(paxList[0].name)}</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; width:18%; font-weight:700; color:#57606A;">Booking Ref (PNR)</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; width:32%; font-weight:800; color:#CE1126; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; font-weight:700; color:#57606A;">E-Ticket Number</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; font-weight:700; color:#24292F;">${escapeHtml(ticketNo)}</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; font-weight:700; color:#57606A;">Date of Issue</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; color:#24292F;">${escapeHtml(issuedDate)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; font-weight:700; color:#57606A;">Issuing Office / IATA</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; color:#24292F;">CHINA EASTERN TICKETING / 41300921</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; font-weight:700; color:#57606A;">Booking Status</td>
                <td style="padding:7px 10px; border:1px solid #D0D7DE; font-weight:700; color:#1A7F37;">Confirmed / OK</td>
            </tr>
        </table>

        <!-- Section: Flight Itinerary -->
        <div style="font-size:12px; font-weight:800; color:#00205B; border-left:4px solid #CE1126; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Flight Itinerary / 航程信息
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #D0D7DE;">
            <thead>
                <tr style="background:#00205B; color:#ffffff; text-align:left;">
                    <th style="padding:8px; border:1px solid #00205B; font-weight:700;">FLIGHT</th>
                    <th style="padding:8px; border:1px solid #00205B; font-weight:700;">DEPARTURE</th>
                    <th style="padding:8px; border:1px solid #00205B; font-weight:700;">ARRIVAL</th>
                    <th style="padding:8px; border:1px solid #00205B; font-weight:700;">CLASS</th>
                    <th style="padding:8px; border:1px solid #00205B; font-weight:700; text-align:center;">SEAT</th>
                    <th style="padding:8px; border:1px solid #00205B; font-weight:700;">BAGGAGE</th>
                    <th style="padding:8px; border:1px solid #00205B; font-weight:700; text-align:center;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#F6F8FA'};">
                    <td style="padding:8px; border:1px solid #D0D7DE; vertical-align:top;">
                        <div style="font-weight:800; color:#CE1126; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#57606A; margin-top:2px;">Operated by China Eastern</div>
                        <div style="font-size:9.5px; color:#57606A;">${escapeHtml(fl.aircraft || 'Airbus A350-900')}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #D0D7DE; vertical-align:top;">
                        <div style="font-weight:700; color:#24292F; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                        <div style="font-size:10px; color:#57606A; margin-top:2px;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#00205B; font-size:12px;">${escapeHtml(fl.depTime)}</div>
                        <div style="font-size:9.5px; color:#57606A;">${escapeHtml(fl.depTerminal)}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #D0D7DE; vertical-align:top;">
                        <div style="font-weight:700; color:#24292F; font-size:11.5px;">${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:10px; color:#57606A; margin-top:2px;">${escapeHtml(fl.arrDateFormatted || fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#00205B; font-size:12px;">${escapeHtml(fl.arrTime)}</div>
                        <div style="font-size:9.5px; color:#57606A;">${escapeHtml(fl.arrTerminal)}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #D0D7DE; vertical-align:top;">
                        <div style="font-weight:700; color:#24292F;">${escapeHtml(fl.flightClass || 'Economy (Y)')}</div>
                        <div style="font-size:9.5px; color:#57606A; margin-top:2px;">Fare Basis: YOWMU</div>
                    </td>
                    <td style="padding:8px; border:1px solid #D0D7DE; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#00205B; background:#EBF0F8; padding:3px 7px; border-radius:4px; font-size:11px; border:1px solid #C4D3E8;">${escapeHtml(fl.seat)}</span>
                    </td>
                    <td style="padding:8px; border:1px solid #D0D7DE; vertical-align:top;">
                        <div style="font-weight:700; color:#24292F;">${escapeHtml(checkedBag)}</div>
                        <div style="font-size:9.5px; color:#57606A;">Carry-on: 1PC (8KG)</div>
                    </td>
                    <td style="padding:8px; border:1px solid #D0D7DE; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#1A7F37;">OK</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Fare and Endorsements -->
        <table style="width:100%; border-collapse:collapse; background:#F6F8FA; border:1px solid #D0D7DE; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #D0D7DE; width:22%; font-weight:700; color:#57606A;">Payment / 付款方式</td>
                <td style="padding:6px 10px; border:1px solid #D0D7DE; width:28%; color:#24292F;">ELECTRONIC TICKET / INVOICED</td>
                <td style="padding:6px 10px; border:1px solid #D0D7DE; width:22%; font-weight:700; color:#57606A;">Total Amount / 总额</td>
                <td style="padding:6px 10px; border:1px solid #D0D7DE; width:28%; font-weight:800; color:#00205B;">PAID / TAXES INCL</td>
            </tr>
            <tr>
                <td style="padding:6px 10px; border:1px solid #D0D7DE; font-weight:700; color:#57606A;">Endorsements / 签注</td>
                <td colspan="3" style="padding:6px 10px; border:1px solid #D0D7DE; color:#57606A; font-size:10px;">
                    NON-ENDORSABLE / REBOOKING RESTRICTIONS APPLY / SKYTEAM RECOGNIZED
                </td>
            </tr>
        </table>

        <!-- Notice & Legal Reminders -->
        <div style="background:#FFF9F9; border:1px solid #F3D3D5; border-radius:6px; padding:10px 14px; font-size:10px; color:#57606A; line-height:1.5;">
            <div style="font-weight:800; color:#CE1126; margin-bottom:3px; text-transform:uppercase;">Notice & Check-in Reminders / 注意事项</div>
            <div>• Check-in counters normally open 3 hours prior and close strictly 60 minutes before scheduled departure time. Boarding gate closes 20 minutes before departure.</div>
            <div>• Passengers must present a valid government-issued photo ID / passport matching the passenger name on the electronic ticket at check-in.</div>
            <div>• Free baggage allowance: checked baggage up to 2 pieces (max 23kg each); cabin baggage 1 piece (max 8kg, 55x40x20cm). Excess baggage fees apply if exceeded.</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            China Eastern Airlines Co., Ltd. • 52 Airport Road, Pudong International Airport, Shanghai, China • www.ceair.com
        </div>

    </div>
    `;
}

export async function generateChinaEasternPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getNewAirlineLogoDataUrl('China Eastern');
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const RED = [206, 17, 38];    // #CE1126
    const NAVY = [0, 32, 91];     // #00205B
    const BORDER = [208, 215, 222];
    const BG_LIGHT = [246, 248, 250];
    const TEXT_DK = [36, 41, 47];
    const TEXT_MUT = [87, 96, 106];
    const GREEN = [26, 127, 55];

    const pnr = (data.pnr || data.bookingNo || 'D8YUUK').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `781-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'China Eastern Airlines', 'MU 562', 'Airbus A350-900');
    const checkedBag = data.checkedBaggage || '2PC (23KG each)';

    // Top Red Accent Line
    doc.setFillColor(...RED);
    doc.rect(marginL, 30, contentW, 4, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            // natural ratio 4.12:1 (795x193) -> 165 x 40 pt
            doc.addImage(logoDataUrl, 'PNG', marginL, 42, 165, 40);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...RED);
    doc.text('PASSENGER E-TICKET RECEIPT', marginR, 52, { align: 'right' });

    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text('电子客票行程单 / 旅客联', marginR, 66, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Issuing Carrier: CHINA EASTERN AIRLINES (MU - 781)', marginR, 79, { align: 'right' });

    let curY = 96;

    // Booking Details Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 64, 'FD');

    // Horizontal inner dividers
    doc.line(marginL, curY + 21, marginR, curY + 21);
    doc.line(marginL, curY + 42, marginR, curY + 42);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Passenger Name:', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text(paxList[0].name, marginL + 95, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Booking Ref (PNR):', marginL + 280, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...RED);
    doc.text(pnr, marginL + 380, curY + 14);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('E-Ticket Number:', marginL + 8, curY + 35);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DK);
    doc.text(ticketNo, marginL + 95, curY + 35);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Date of Issue:', marginL + 280, curY + 35);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(issuedDate, marginL + 380, curY + 35);

    // Row 3
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Issuing Office:', marginL + 8, curY + 56);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('CHINA EASTERN AIRLINES / 41300921', marginL + 95, curY + 56);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Booking Status:', marginL + 280, curY + 56);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('Confirmed / OK', marginL + 380, curY + 56);

    curY += 76;

    // Flight Itinerary Title
    doc.setFillColor(...RED);
    doc.rect(marginL, curY, 3, 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text('FLIGHT ITINERARY / 航程信息', marginL + 8, curY + 10);

    curY += 16;

    // Flight Table Header
    doc.setFillColor(...NAVY);
    doc.rect(marginL, curY, contentW, 20, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('FLIGHT', marginL + 8, curY + 13);
    doc.text('DEPARTURE', marginL + 75, curY + 13);
    doc.text('ARRIVAL', marginL + 185, curY + 13);
    doc.text('CLASS', marginL + 295, curY + 13);
    doc.text('SEAT', marginL + 355, curY + 13);
    doc.text('BAGGAGE', marginL + 400, curY + 13);
    doc.text('STATUS', marginL + 475, curY + 13);

    curY += 20;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 46;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...RED);
        doc.text(fl.flightNo, marginL + 8, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('China Eastern', marginL + 8, curY + 25);
        doc.text(fl.aircraft || 'Airbus A350', marginL + 8, curY + 36);

        // Departure Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${fl.depCity} (${fl.fromCode})`, marginL + 75, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(fl.depDateFormatted || '', marginL + 75, curY + 25);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...NAVY);
        doc.text(`${fl.depTime}  ${fl.depTerminal || ''}`, marginL + 75, curY + 36);

        // Arrival Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${fl.arrCity} (${fl.toCode})`, marginL + 185, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(fl.arrDateFormatted || fl.depDateFormatted || '', marginL + 185, curY + 25);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...NAVY);
        doc.text(`${fl.arrTime}  ${fl.arrTerminal || ''}`, marginL + 185, curY + 36);

        // Class Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(fl.flightClass || 'Economy (Y)', marginL + 295, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Fare: YOWMU', marginL + 295, curY + 28);

        // Seat Column
        doc.setFillColor(235, 240, 248);
        doc.rect(marginL + 352, curY + 10, 26, 16, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...NAVY);
        doc.text(fl.seat, marginL + 365, curY + 22, { align: 'center' });

        // Baggage Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(checkedBag, marginL + 400, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Carry-on: 1PC 8KG', marginL + 400, curY + 28);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...GREEN);
        doc.text('OK', marginL + 488, curY + 22);

        curY += rowH;
    });

    curY += 12;

    // Payment & Endorsement Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 40, 'FD');
    doc.line(marginL, curY + 20, marginR, curY + 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Payment / 付款方式:', marginL + 8, curY + 13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('ELECTRONIC TICKET / INVOICED', marginL + 105, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Total Amount / 总额:', marginL + 300, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...NAVY);
    doc.text('PAID / TAXES INCL', marginL + 400, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Endorsements / 签注:', marginL + 8, curY + 33);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('NON-ENDORSABLE / REBOOKING RESTRICTIONS APPLY / SKYTEAM RECOGNIZED', marginL + 105, curY + 33);

    curY += 50;

    // Notices Box
    doc.setFillColor(255, 249, 249);
    doc.setDrawColor(243, 211, 213);
    doc.rect(marginL, curY, contentW, 58, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...RED);
    doc.text('NOTICE & TRAVEL REMINDERS / 注意事项', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('• Check-in counters open 3 hours prior and close strictly 60 minutes before departure. Gate closes 20 minutes prior.', marginL + 8, curY + 26);
    doc.text('• Passengers must present a valid government photo ID / passport matching the electronic ticket name at check-in.', marginL + 8, curY + 37);
    doc.text('• Free checked baggage allowance: 2 pieces (max 23kg each). Carry-on baggage: 1 piece (max 8kg, 55x40x20cm).', marginL + 8, curY + 48);

    curY += 72;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 149, 159);
    doc.text('China Eastern Airlines Co., Ltd. • Pudong International Airport, Shanghai, China • www.ceair.com', contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}

/* ========================================================================= */
/* 2. VIETNAM AIRLINES (VN / 738) - HTML & PDF                              */
/* ========================================================================= */

export function renderVietnamAirlinesTicketHtml(data) {
    const logoSrc = cachedVietnamAirlinesLogoDataUrl || 'assets/vietnam-airlines-logo.png';
    const pnr = (data.pnr || data.bookingNo || '64FFCC').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `738 ${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Vietnam Airlines', 'VN 126', 'Boeing 787-9');
    const checkedBag = data.checkedBaggage || '1PC (23KG)';

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#1A202C; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.08); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Dual Golden Lotus & Teal Accent Bar -->
        <div style="height:3px; background:#D4A017; border-radius:2px 2px 0 0;"></div>
        <div style="height:3px; background:#005F6E; margin-bottom:18px; border-radius:0 0 2px 2px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="Vietnam Airlines" style="height:48px; max-width:240px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:18px; font-weight:800; color:#005F6E; letter-spacing:0.5px; text-transform:uppercase;">Electronic Ticket Receipt</div>
                <div style="font-size:12px; font-weight:700; color:#D4A017; letter-spacing:0.8px; margin-top:1px;">PHIẾU THU VÉ ĐIỆN TỬ</div>
                <div style="font-size:10px; color:#57606A; margin-top:3px;">VIETNAM AIRLINES (VN - 738) • A SkyTeam Member</div>
            </div>
        </div>

        <!-- Booking & Passenger Overview Table -->
        <table style="width:100%; border-collapse:collapse; background:#F0F7F8; border:1px solid #B2D6DC; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; width:20%; font-weight:700; color:#005F6E;">Passenger Name / Tên</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; width:30%; font-weight:700; color:#1A202C; font-size:12px;">${escapeHtml(paxList[0].name)}</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; width:20%; font-weight:700; color:#005F6E;">Booking Ref (PNR)</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; width:30%; font-weight:800; color:#005F6E; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; font-weight:700; color:#005F6E;">Ticket No. / Số vé</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; font-weight:700; color:#1A202C;">${escapeHtml(ticketNo)}</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; font-weight:700; color:#005F6E;">Issue Date / Ngày xuất</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; color:#1A202C;">${escapeHtml(issuedDate)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; font-weight:700; color:#005F6E;">Issuing Office / Nơi xuất</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; color:#1A202C;">VIETNAM AIRLINES OFFICIAL / APPOINTED AGENT</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; font-weight:700; color:#005F6E;">Status / Tình trạng</td>
                <td style="padding:7px 10px; border:1px solid #B2D6DC; font-weight:700; color:#0E8A4C;">CONFIRMED / ĐÃ XÁC NHẬN</td>
            </tr>
        </table>

        <!-- Section Title -->
        <div style="font-size:12px; font-weight:800; color:#005F6E; border-left:4px solid #D4A017; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Flight Details / Lịch Trình Chuyến Bay
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #B2D6DC;">
            <thead>
                <tr style="background:#005F6E; color:#ffffff; text-align:left;">
                    <th style="padding:8px; border:1px solid #005F6E; font-weight:700;">CHUYẾN BAY / FLIGHT</th>
                    <th style="padding:8px; border:1px solid #005F6E; font-weight:700;">KHỞI HÀNH / DEPARTURE</th>
                    <th style="padding:8px; border:1px solid #005F6E; font-weight:700;">ĐẾN / ARRIVAL</th>
                    <th style="padding:8px; border:1px solid #005F6E; font-weight:700;">HẠNG / CLASS</th>
                    <th style="padding:8px; border:1px solid #005F6E; font-weight:700; text-align:center;">GHẾ / SEAT</th>
                    <th style="padding:8px; border:1px solid #005F6E; font-weight:700;">HÀNH LÝ / BAGGAGE</th>
                    <th style="padding:8px; border:1px solid #005F6E; font-weight:700; text-align:center;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#F0F7F8'};">
                    <td style="padding:8px; border:1px solid #B2D6DC; vertical-align:top;">
                        <div style="font-weight:800; color:#005F6E; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#57606A; margin-top:2px;">Operated by Vietnam Airlines</div>
                        <div style="font-size:9.5px; color:#57606A;">${escapeHtml(fl.aircraft || 'Boeing 787-9')}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #B2D6DC; vertical-align:top;">
                        <div style="font-weight:700; color:#1A202C; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                        <div style="font-size:10px; color:#57606A; margin-top:2px;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#005F6E; font-size:12px;">${escapeHtml(fl.depTime)}</div>
                        <div style="font-size:9.5px; color:#57606A;">${escapeHtml(fl.depTerminal)}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #B2D6DC; vertical-align:top;">
                        <div style="font-weight:700; color:#1A202C; font-size:11.5px;">${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:10px; color:#57606A; margin-top:2px;">${escapeHtml(fl.arrDateFormatted || fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#005F6E; font-size:12px;">${escapeHtml(fl.arrTime)}</div>
                        <div style="font-size:9.5px; color:#57606A;">${escapeHtml(fl.arrTerminal)}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #B2D6DC; vertical-align:top;">
                        <div style="font-weight:700; color:#1A202C;">${escapeHtml(fl.flightClass || 'Economy Classic (K)')}</div>
                        <div style="font-size:9.5px; color:#57606A; margin-top:2px;">Fare Basis: KOWVN</div>
                    </td>
                    <td style="padding:8px; border:1px solid #B2D6DC; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#005F6E; background:#E2EFF1; padding:3px 7px; border-radius:4px; font-size:11px; border:1px solid #B8DCDF;">${escapeHtml(fl.seat)}</span>
                    </td>
                    <td style="padding:8px; border:1px solid #B2D6DC; vertical-align:top;">
                        <div style="font-weight:700; color:#1A202C;">${escapeHtml(checkedBag)}</div>
                        <div style="font-size:9.5px; color:#57606A;">Carry-on: 12KG total</div>
                    </td>
                    <td style="padding:8px; border:1px solid #B2D6DC; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#0E8A4C;">OK</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Payment & Conditions Box -->
        <table style="width:100%; border-collapse:collapse; background:#F0F7F8; border:1px solid #B2D6DC; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #B2D6DC; width:22%; font-weight:700; color:#005F6E;">Payment / Thanh toán</td>
                <td style="padding:6px 10px; border:1px solid #B2D6DC; width:28%; color:#1A202C;">ELECTRONIC TICKET / PAID</td>
                <td style="padding:6px 10px; border:1px solid #B2D6DC; width:22%; font-weight:700; color:#005F6E;">Total / Tổng tiền</td>
                <td style="padding:6px 10px; border:1px solid #B2D6DC; width:28%; font-weight:800; color:#005F6E;">INCLUDED / ĐÃ THANH TOÁN</td>
            </tr>
            <tr>
                <td style="padding:6px 10px; border:1px solid #B2D6DC; font-weight:700; color:#005F6E;">Conditions / Điều kiện</td>
                <td colspan="3" style="padding:6px 10px; border:1px solid #B2D6DC; color:#57606A; font-size:10px;">
                    NON-ENDORSABLE / REBOOKING APPLIES / LOTUSMILES ACCRUAL ELIGIBLE
                </td>
            </tr>
        </table>

        <!-- Check-in & Conditions Notice -->
        <div style="background:#FBF8EE; border:1px solid #EADBB0; border-radius:6px; padding:10px 14px; font-size:10px; color:#57606A; line-height:1.5;">
            <div style="font-weight:800; color:#D4A017; margin-bottom:3px; text-transform:uppercase;">Important Information / Lưu ý quan trọng</div>
            <div>• Quý khách vui lòng làm thủ tục trực tuyến từ 24 tiếng đến 1 tiếng trước giờ khởi hành / Online check-in is available 24 hours to 1 hour before scheduled flight.</div>
            <div>• Quầy thủ tục đóng trước 50 phút đối với chuyến bay nội địa và 60 phút đối với chuyến bay quốc tế / Check-in counters close 50 min before domestic and 60 min before international flights.</div>
            <div>• Tiêu chuẩn hành lý xách tay: 1 kiện xách tay (tối đa 10kg) + 1 phụ kiện (tối đa 2kg), tổng trọng lượng không quá 12kg.</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            Vietnam Airlines JSC • 200 Nguyen Son, Long Bien, Hanoi, Vietnam • www.vietnamairlines.com
        </div>

    </div>
    `;
}

export async function generateVietnamAirlinesPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getNewAirlineLogoDataUrl('Vietnam Airlines');
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const TEAL = [0, 95, 110];     // #005F6E
    const GOLD = [212, 160, 23];   // #D4A017
    const BORDER = [178, 214, 220]; // #B2D6DC
    const BG_LIGHT = [240, 247, 248]; // #F0F7F8
    const TEXT_DK = [26, 32, 44];
    const TEXT_MUT = [87, 96, 106];
    const GREEN = [14, 138, 76];

    const pnr = (data.pnr || data.bookingNo || '64FFCC').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `738 ${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Vietnam Airlines', 'VN 126', 'Boeing 787-9');
    const checkedBag = data.checkedBaggage || '1PC (23KG)';

    // Top Dual Gold & Teal Accent Bar
    doc.setFillColor(...GOLD);
    doc.rect(marginL, 30, contentW, 2.5, 'F');
    doc.setFillColor(...TEAL);
    doc.rect(marginL, 32.5, contentW, 2.5, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            // natural ratio 2.75:1 (911x331) -> 140 x 51 pt
            doc.addImage(logoDataUrl, 'PNG', marginL, 42, 140, 51);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...TEAL);
    doc.text('ELECTRONIC TICKET RECEIPT', marginR, 52, { align: 'right' });

    doc.setFontSize(10);
    doc.setTextColor(...GOLD);
    doc.text('PHIẾU THU VÉ ĐIỆN TỬ', marginR, 66, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('VIETNAM AIRLINES (VN - 738) • SkyTeam', marginR, 79, { align: 'right' });

    let curY = 100;

    // Booking Details Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 64, 'FD');

    doc.line(marginL, curY + 21, marginR, curY + 21);
    doc.line(marginL, curY + 42, marginR, curY + 42);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEAL);
    doc.text('Passenger Name / Tên:', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_DK);
    doc.text(paxList[0].name, marginL + 115, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEAL);
    doc.text('Booking Ref (PNR):', marginL + 285, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text(pnr, marginL + 380, curY + 14);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEAL);
    doc.text('Ticket No. / Số vé:', marginL + 8, curY + 35);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DK);
    doc.text(ticketNo, marginL + 115, curY + 35);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Issue Date / Ngày xuất:', marginL + 285, curY + 35);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(issuedDate, marginL + 380, curY + 35);

    // Row 3
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Issuing Office / Nơi xuất:', marginL + 8, curY + 56);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('VIETNAM AIRLINES OFFICIAL', marginL + 115, curY + 56);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Status / Tình trạng:', marginL + 285, curY + 56);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('CONFIRMED / ĐÃ XÁC NHẬN', marginL + 380, curY + 56);

    curY += 76;

    // Flight Details Title
    doc.setFillColor(...GOLD);
    doc.rect(marginL, curY, 3, 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEAL);
    doc.text('FLIGHT DETAILS / LỊCH TRÌNH CHUYẾN BAY', marginL + 8, curY + 10);

    curY += 16;

    // Flight Table Header
    doc.setFillColor(...TEAL);
    doc.rect(marginL, curY, contentW, 20, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('FLIGHT', marginL + 8, curY + 13);
    doc.text('DEPARTURE', marginL + 75, curY + 13);
    doc.text('ARRIVAL', marginL + 185, curY + 13);
    doc.text('CLASS', marginL + 295, curY + 13);
    doc.text('SEAT', marginL + 355, curY + 13);
    doc.text('BAGGAGE', marginL + 400, curY + 13);
    doc.text('STATUS', marginL + 475, curY + 13);

    curY += 20;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 46;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...TEAL);
        doc.text(fl.flightNo, marginL + 8, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Vietnam Airlines', marginL + 8, curY + 25);
        doc.text(fl.aircraft || 'Boeing 787-9', marginL + 8, curY + 36);

        // Departure Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${fl.depCity} (${fl.fromCode})`, marginL + 75, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(fl.depDateFormatted || '', marginL + 75, curY + 25);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEAL);
        doc.text(`${fl.depTime}  ${fl.depTerminal || ''}`, marginL + 75, curY + 36);

        // Arrival Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${fl.arrCity} (${fl.toCode})`, marginL + 185, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(fl.arrDateFormatted || fl.depDateFormatted || '', marginL + 185, curY + 25);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEAL);
        doc.text(`${fl.arrTime}  ${fl.arrTerminal || ''}`, marginL + 185, curY + 36);

        // Class Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(fl.flightClass || 'Economy (K)', marginL + 295, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Fare: KOWVN', marginL + 295, curY + 28);

        // Seat Column
        doc.setFillColor(226, 239, 241);
        doc.rect(marginL + 352, curY + 10, 26, 16, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEAL);
        doc.text(fl.seat, marginL + 365, curY + 22, { align: 'center' });

        // Baggage Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(checkedBag, marginL + 400, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Carry-on: 12KG total', marginL + 400, curY + 28);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...GREEN);
        doc.text('OK', marginL + 488, curY + 22);

        curY += rowH;
    });

    curY += 12;

    // Payment Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 40, 'FD');
    doc.line(marginL, curY + 20, marginR, curY + 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEAL);
    doc.text('Payment / Thanh toán:', marginL + 8, curY + 13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('ELECTRONIC TICKET / PAID', marginL + 115, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Total / Tổng tiền:', marginL + 300, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('INCLUDED / ĐÃ THANH TOÁN', marginL + 400, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Conditions / Điều kiện:', marginL + 8, curY + 33);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('NON-ENDORSABLE / REBOOKING APPLIES / LOTUSMILES ACCRUAL ELIGIBLE', marginL + 115, curY + 33);

    curY += 50;

    // Important Notice Box
    doc.setFillColor(251, 248, 238);
    doc.setDrawColor(234, 219, 176);
    doc.rect(marginL, curY, contentW, 58, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GOLD);
    doc.text('IMPORTANT TRAVEL INFORMATION / LƯU Ý QUAN TRỌNG', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('• Online check-in is available 24 hours to 1 hour before scheduled flight at www.vietnamairlines.com.', marginL + 8, curY + 26);
    doc.text('• Check-in counters close 50 min before domestic flights and 60 min before international flights.', marginL + 8, curY + 37);
    doc.text('• Free cabin baggage limit: 1 piece (max 10kg) + 1 small personal item (max 2kg), total weight not exceeding 12kg.', marginL + 8, curY + 48);

    curY += 72;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 149, 159);
    doc.text('Vietnam Airlines JSC • 200 Nguyen Son, Long Bien, Hanoi, Vietnam • www.vietnamairlines.com', contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}

/* ========================================================================= */
/* 3. CATHAY PACIFIC (CX / 160) - HTML & PDF                                */
/* ========================================================================= */

export function renderCathayPacificTicketHtml(data) {
    const logoSrc = cachedCathayPacificLogoDataUrl || 'assets/cathay-pacific-logo.png';
    const pnr = (data.pnr || data.bookingNo || '62M8HE').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `160-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Cathay Pacific', 'CX 714', 'Airbus A350-1000');
    const checkedBag = data.checkedBaggage || '2PC (23KG each)';

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#222222; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.08); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Top Cathay Jade Accent Line -->
        <div style="height:3px; background:#006564; margin-bottom:18px; border-radius:2px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="Cathay Pacific" style="height:32px; max-width:240px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:20px; font-weight:700; color:#006564; font-family:'Times New Roman', serif, Georgia; letter-spacing:0.5px;">eTicket Receipt</div>
                <div style="font-size:10.5px; color:#555555; letter-spacing:0.5px; margin-top:2px;">Cathay Pacific Airways (CX - 160) • oneworld</div>
                <div style="font-size:13px; font-weight:700; color:#006564; margin-top:2px;">Booking Ref: ${escapeHtml(pnr)}</div>
            </div>
        </div>

        <!-- Passenger & Booking Summary Strip -->
        <table style="width:100%; border-collapse:collapse; background:#F7FAF9; border:1px solid #CFDCDA; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; width:18%; font-weight:700; color:#006564;">Passenger Name</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; width:32%; font-weight:700; color:#1A202C; font-size:12px;">${escapeHtml(paxList[0].name)}</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; width:18%; font-weight:700; color:#006564;">Booking Reference</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; width:32%; font-weight:800; color:#006564; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; font-weight:700; color:#006564;">Ticket Number</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; font-weight:700; color:#222222;">${escapeHtml(ticketNo)}</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; font-weight:700; color:#006564;">Date of Issue</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; color:#222222;">${escapeHtml(issuedDate)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; font-weight:700; color:#006564;">Issuing Office</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; color:#222222;">CATHAY PACIFIC E-TICKETING / AGENT</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; font-weight:700; color:#006564;">Reservation Status</td>
                <td style="padding:7px 10px; border:1px solid #CFDCDA; font-weight:700; color:#0E8A4C;">Confirmed (OK)</td>
            </tr>
        </table>

        <!-- Section: Flight Itinerary -->
        <div style="font-size:12px; font-weight:800; color:#006564; border-left:4px solid #006564; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Sector / Flight Itinerary
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #CFDCDA;">
            <thead>
                <tr style="background:#006564; color:#ffffff; text-align:left;">
                    <th style="padding:8px; border:1px solid #006564; font-weight:700;">SECTOR (FROM / TO)</th>
                    <th style="padding:8px; border:1px solid #006564; font-weight:700;">FLIGHT</th>
                    <th style="padding:8px; border:1px solid #006564; font-weight:700;">DATE</th>
                    <th style="padding:8px; border:1px solid #006564; font-weight:700;">DEP / ARR</th>
                    <th style="padding:8px; border:1px solid #006564; font-weight:700;">CLASS</th>
                    <th style="padding:8px; border:1px solid #006564; font-weight:700; text-align:center;">SEAT</th>
                    <th style="padding:8px; border:1px solid #006564; font-weight:700;">BAGGAGE</th>
                    <th style="padding:8px; border:1px solid #006564; font-weight:700; text-align:center;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#F7FAF9'};">
                    <td style="padding:8px; border:1px solid #CFDCDA; vertical-align:top;">
                        <div style="font-weight:700; color:#006564; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)}) ➔ ${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:9.5px; color:#555555; margin-top:2px;">${escapeHtml(fl.depTerminal)} ➔ ${escapeHtml(fl.arrTerminal)}</div>
                        <div style="font-size:9.5px; color:#555555;">${escapeHtml(fl.aircraft || 'Airbus A350-1000')}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #CFDCDA; vertical-align:top;">
                        <div style="font-weight:800; color:#006564; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#555555; margin-top:2px;">Cathay Pacific</div>
                    </td>
                    <td style="padding:8px; border:1px solid #CFDCDA; vertical-align:top;">
                        <div style="font-weight:700; color:#222222;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-size:9.5px; color:#555555; margin-top:2px;">${escapeHtml(fl.duration || 'Non-Stop')}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #CFDCDA; vertical-align:top;">
                        <div style="font-weight:700; color:#006564; font-size:11.5px;">${escapeHtml(fl.depTime)} - ${escapeHtml(fl.arrTime)}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #CFDCDA; vertical-align:top;">
                        <div style="font-weight:700; color:#222222;">${escapeHtml(fl.flightClass || 'Economy (K)')}</div>
                        <div style="font-size:9.5px; color:#555555; margin-top:2px;">Fare: KR21WEAR</div>
                    </td>
                    <td style="padding:8px; border:1px solid #CFDCDA; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#006564; background:#E5F0EE; padding:3px 7px; border-radius:4px; font-size:11px; border:1px solid #C0D8D4;">${escapeHtml(fl.seat)}</span>
                    </td>
                    <td style="padding:8px; border:1px solid #CFDCDA; vertical-align:top;">
                        <div style="font-weight:700; color:#222222;">${escapeHtml(checkedBag)}</div>
                        <div style="font-size:9.5px; color:#555555;">Cabin: 1PC 7KG</div>
                    </td>
                    <td style="padding:8px; border:1px solid #CFDCDA; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#0E8A4C;">OK</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Baggage Policy Box -->
        <table style="width:100%; border-collapse:collapse; background:#F7FAF9; border:1px solid #CFDCDA; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #CFDCDA; width:22%; font-weight:700; color:#006564;">Checked Baggage</td>
                <td style="padding:6px 10px; border:1px solid #CFDCDA; width:28%; color:#222222;">2 pieces, up to 23 kg (50 lb) each</td>
                <td style="padding:6px 10px; border:1px solid #CFDCDA; width:22%; font-weight:700; color:#006564;">Cabin Baggage</td>
                <td style="padding:6px 10px; border:1px solid #CFDCDA; width:28%; color:#222222;">1 piece up to 7 kg + 1 small item</td>
            </tr>
            <tr>
                <td style="padding:6px 10px; border:1px solid #CFDCDA; font-weight:700; color:#006564;">Form of Payment</td>
                <td style="padding:6px 10px; border:1px solid #CFDCDA; color:#222222;">ELECTRONIC TICKET / PAID</td>
                <td style="padding:6px 10px; border:1px solid #CFDCDA; font-weight:700; color:#006564;">Endorsements</td>
                <td style="padding:6px 10px; border:1px solid #CFDCDA; color:#555555; font-size:10px;">NON-END / REBOOKING FEE APPLIES</td>
            </tr>
        </table>

        <!-- Travel Reminders Notice -->
        <div style="background:#F2F7F6; border:1px solid #C4DEDB; border-radius:6px; padding:10px 14px; font-size:10px; color:#555555; line-height:1.5;">
            <div style="font-weight:800; color:#006564; margin-bottom:3px; text-transform:uppercase;">Cathay Pacific Travel Reminders</div>
            <div>• Manage Booking & Online Check-in: Available 48 hours up to 90 minutes prior to departure at cathaypacific.com.</div>
            <div>• Airport Bag Drop: Counters close 75 minutes prior to departure. Boarding gates close 20 minutes before departure.</div>
            <div>• Travel Documents: Passengers are responsible for ensuring their passports and entry visas meet the requirements of their destinations.</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            Cathay Pacific Airways Limited • Cathay City, 8 Scenic Path, Hong Kong International Airport, Lantau, Hong Kong • www.cathaypacific.com
        </div>

    </div>
    `;
}

export async function generateCathayPacificPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getNewAirlineLogoDataUrl('Cathay Pacific');
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const JADE = [0, 101, 100];     // #006564
    const BORDER = [207, 220, 218]; // #CFDCDA
    const BG_LIGHT = [247, 250, 249]; // #F7FAF9
    const TEXT_DK = [34, 34, 34];
    const TEXT_MUT = [85, 85, 85];
    const GREEN = [14, 138, 76];

    const pnr = (data.pnr || data.bookingNo || '62M8HE').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `160-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Cathay Pacific', 'CX 714', 'Airbus A350-1000');
    const checkedBag = data.checkedBaggage || '2PC (23KG each)';

    // Top Jade Accent Bar
    doc.setFillColor(...JADE);
    doc.rect(marginL, 30, contentW, 3, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            // natural ratio 7.1:1 (788x111) -> 170 x 24 pt
            doc.addImage(logoDataUrl, 'PNG', marginL, 48, 170, 24);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('times', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...JADE);
    doc.text('eTicket Receipt', marginR, 52, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Cathay Pacific Airways (CX - 160) • oneworld', marginR, 66, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...JADE);
    doc.text(`Booking Ref: ${pnr}`, marginR, 79, { align: 'right' });

    let curY = 96;

    // Passenger & Booking Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 64, 'FD');

    doc.line(marginL, curY + 21, marginR, curY + 21);
    doc.line(marginL, curY + 42, marginR, curY + 42);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...JADE);
    doc.text('Passenger Name:', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_DK);
    doc.text(paxList[0].name, marginL + 110, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...JADE);
    doc.text('Booking Reference:', marginL + 285, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...JADE);
    doc.text(pnr, marginL + 380, curY + 14);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...JADE);
    doc.text('Ticket Number:', marginL + 8, curY + 35);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DK);
    doc.text(ticketNo, marginL + 110, curY + 35);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Date of Issue:', marginL + 285, curY + 35);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(issuedDate, marginL + 380, curY + 35);

    // Row 3
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Issuing Office:', marginL + 8, curY + 56);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('CATHAY PACIFIC E-TICKETING / AGENT', marginL + 110, curY + 56);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Reservation Status:', marginL + 285, curY + 56);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('Confirmed (OK)', marginL + 380, curY + 56);

    curY += 76;

    // Flight Details Title
    doc.setFillColor(...JADE);
    doc.rect(marginL, curY, 3, 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...JADE);
    doc.text('SECTOR / FLIGHT ITINERARY', marginL + 8, curY + 10);

    curY += 16;

    // Flight Table Header
    doc.setFillColor(...JADE);
    doc.rect(marginL, curY, contentW, 20, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('SECTOR (FROM / TO)', marginL + 8, curY + 13);
    doc.text('FLIGHT', marginL + 155, curY + 13);
    doc.text('DATE', marginL + 215, curY + 13);
    doc.text('DEP / ARR', marginL + 295, curY + 13);
    doc.text('CLASS', marginL + 360, curY + 13);
    doc.text('SEAT', marginL + 410, curY + 13);
    doc.text('BAGGAGE', marginL + 445, curY + 13);
    doc.text('STATUS', marginL + 495, curY + 13);

    curY += 20;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 46;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Sector Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...JADE);
        doc.text(`${fl.depCity} (${fl.fromCode}) ➔ ${fl.arrCity} (${fl.toCode})`, marginL + 8, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(`${fl.depTerminal || ''} ➔ ${fl.arrTerminal || ''}`, marginL + 8, curY + 25);
        doc.text(fl.aircraft || 'Airbus A350-1000', marginL + 8, curY + 36);

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...JADE);
        doc.text(fl.flightNo, marginL + 155, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Cathay Pacific', marginL + 155, curY + 28);

        // Date Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(fl.depDateFormatted || '', marginL + 215, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(fl.duration || 'Non-Stop', marginL + 215, curY + 28);

        // Dep / Arr Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...JADE);
        doc.text(`${fl.depTime} - ${fl.arrTime}`, marginL + 295, curY + 22);

        // Class Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(fl.flightClass || 'Economy (K)', marginL + 360, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Fare: KR21WEAR', marginL + 360, curY + 28);

        // Seat Column
        doc.setFillColor(229, 240, 238);
        doc.rect(marginL + 406, curY + 10, 24, 16, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...JADE);
        doc.text(fl.seat, marginL + 418, curY + 22, { align: 'center' });

        // Baggage Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(checkedBag, marginL + 445, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Cabin: 1PC 7KG', marginL + 445, curY + 28);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...GREEN);
        doc.text('OK', marginL + 508, curY + 22);

        curY += rowH;
    });

    curY += 12;

    // Baggage Policy Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 40, 'FD');
    doc.line(marginL, curY + 20, marginR, curY + 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...JADE);
    doc.text('Checked Baggage:', marginL + 8, curY + 13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('2 pieces, up to 23 kg (50 lb) each', marginL + 95, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Cabin Baggage:', marginL + 285, curY + 13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('1 piece up to 7 kg + 1 small item', marginL + 365, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Form of Payment:', marginL + 8, curY + 33);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('ELECTRONIC TICKET / PAID', marginL + 95, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Endorsements:', marginL + 285, curY + 33);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('NON-END / REBOOKING FEE APPLIES', marginL + 365, curY + 33);

    curY += 50;

    // Cathay Travel Reminders Box
    doc.setFillColor(242, 247, 246);
    doc.setDrawColor(196, 222, 219);
    doc.rect(marginL, curY, contentW, 58, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...JADE);
    doc.text('CATHAY PACIFIC TRAVEL REMINDERS', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('• Online Check-in is available 48 hours up to 90 minutes prior to scheduled departure at cathaypacific.com.', marginL + 8, curY + 26);
    doc.text('• Bag drop counters close 75 minutes prior to departure. Boarding gates close strictly 20 minutes before departure.', marginL + 8, curY + 37);
    doc.text('• Passengers must hold a valid passport with at least 6 months validity and required destination visas.', marginL + 8, curY + 48);

    curY += 72;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 149, 159);
    doc.text('Cathay Pacific Airways Limited • Cathay City, Hong Kong International Airport • www.cathaypacific.com', contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}

/* ========================================================================= */
/* 4. HONG KONG AIRLINES (HX / 851) - HTML & PDF                            */
/* ========================================================================= */

export function renderHongKongAirlinesTicketHtml(data) {
    const logoSrc = cachedHongKongAirlinesLogoDataUrl || 'assets/hong-kong-airlines-logo.png';
    const pnr = (data.pnr || data.bookingNo || 'HX7291').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `851-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Hong Kong Airlines', 'HX 264', 'Airbus A330-300');
    const checkedBag = data.checkedBaggage || '20KG / 1PC';

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#1F1F1F; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.08); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Top Bauhinia Crimson Accent Line -->
        <div style="height:4px; background:#C41230; margin-bottom:18px; border-radius:2px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="Hong Kong Airlines" style="height:50px; max-width:200px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:18px; font-weight:800; color:#C41230; letter-spacing:0.5px; text-transform:uppercase;">Electronic Ticket Receipt</div>
                <div style="font-size:12px; font-weight:700; color:#1F1F1F; letter-spacing:0.8px; margin-top:1px;">電子機票收據 / 行程單</div>
                <div style="font-size:10px; color:#666666; margin-top:3px;">Hong Kong Airlines (HX - 851)</div>
            </div>
        </div>

        <!-- Booking & Passenger Overview Table -->
        <table style="width:100%; border-collapse:collapse; background:#FDF5F6; border:1px solid #E0E0E0; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; width:18%; font-weight:700; color:#C41230;">Passenger Name</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; width:32%; font-weight:700; color:#1F1F1F; font-size:12px;">${escapeHtml(paxList[0].name)}</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; width:18%; font-weight:700; color:#C41230;">Booking Ref (PNR)</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; width:32%; font-weight:800; color:#C41230; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; font-weight:700; color:#C41230;">E-Ticket Number</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; font-weight:700; color:#1F1F1F;">${escapeHtml(ticketNo)}</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; font-weight:700; color:#C41230;">Date of Issue</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; color:#1F1F1F;">${escapeHtml(issuedDate)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; font-weight:700; color:#C41230;">Issuing Carrier</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; color:#1F1F1F;">HONG KONG AIRLINES (HX) / TRIP.COM</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; font-weight:700; color:#C41230;">Booking Status</td>
                <td style="padding:7px 10px; border:1px solid #E0E0E0; font-weight:700; color:#0E8A4C;">Confirmed (OK)</td>
            </tr>
        </table>

        <!-- Section Title -->
        <div style="font-size:12px; font-weight:800; color:#C41230; border-left:4px solid #C41230; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Itinerary / Flight Details
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #E0E0E0;">
            <thead>
                <tr style="background:#C41230; color:#ffffff; text-align:left;">
                    <th style="padding:8px; border:1px solid #C41230; font-weight:700;">FLIGHT</th>
                    <th style="padding:8px; border:1px solid #C41230; font-weight:700;">DEPARTURE</th>
                    <th style="padding:8px; border:1px solid #C41230; font-weight:700;">ARRIVAL</th>
                    <th style="padding:8px; border:1px solid #C41230; font-weight:700;">CLASS</th>
                    <th style="padding:8px; border:1px solid #C41230; font-weight:700; text-align:center;">SEAT</th>
                    <th style="padding:8px; border:1px solid #C41230; font-weight:700;">BAGGAGE</th>
                    <th style="padding:8px; border:1px solid #C41230; font-weight:700; text-align:center;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#FDF5F6'};">
                    <td style="padding:8px; border:1px solid #E0E0E0; vertical-align:top;">
                        <div style="font-weight:800; color:#C41230; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#666666; margin-top:2px;">Hong Kong Airlines</div>
                        <div style="font-size:9.5px; color:#666666;">${escapeHtml(fl.aircraft || 'Airbus A330-300')}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #E0E0E0; vertical-align:top;">
                        <div style="font-weight:700; color:#1F1F1F; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                        <div style="font-size:10px; color:#666666; margin-top:2px;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#C41230; font-size:12px;">${escapeHtml(fl.depTime)}</div>
                        <div style="font-size:9.5px; color:#666666;">${escapeHtml(fl.depTerminal)}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #E0E0E0; vertical-align:top;">
                        <div style="font-weight:700; color:#1F1F1F; font-size:11.5px;">${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:10px; color:#666666; margin-top:2px;">${escapeHtml(fl.arrDateFormatted || fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#C41230; font-size:12px;">${escapeHtml(fl.arrTime)}</div>
                        <div style="font-size:9.5px; color:#666666;">${escapeHtml(fl.arrTerminal)}</div>
                    </td>
                    <td style="padding:8px; border:1px solid #E0E0E0; vertical-align:top;">
                        <div style="font-weight:700; color:#1F1F1F;">${escapeHtml(fl.flightClass || 'Economy (E)')}</div>
                        <div style="font-size:9.5px; color:#666666; margin-top:2px;">Fare Basis: EOWHX</div>
                    </td>
                    <td style="padding:8px; border:1px solid #E0E0E0; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#C41230; background:#FDEAEF; padding:3px 7px; border-radius:4px; font-size:11px; border:1px solid #F3BDC9;">${escapeHtml(fl.seat)}</span>
                    </td>
                    <td style="padding:8px; border:1px solid #E0E0E0; vertical-align:top;">
                        <div style="font-weight:700; color:#1F1F1F;">${escapeHtml(checkedBag)}</div>
                        <div style="font-size:9.5px; color:#666666;">Cabin: 1PC 7KG</div>
                    </td>
                    <td style="padding:8px; border:1px solid #E0E0E0; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#0E8A4C;">OK</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Fare Breakdown Box -->
        <table style="width:100%; border-collapse:collapse; background:#FDF5F6; border:1px solid #E0E0E0; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #E0E0E0; width:22%; font-weight:700; color:#C41230;">Form of Payment</td>
                <td style="padding:6px 10px; border:1px solid #E0E0E0; width:28%; color:#1F1F1F;">ELECTRONIC TICKET / CREDIT CARD</td>
                <td style="padding:6px 10px; border:1px solid #E0E0E0; width:22%; font-weight:700; color:#C41230;">Total Amount</td>
                <td style="padding:6px 10px; border:1px solid #E0E0E0; width:28%; font-weight:800; color:#C41230;">PAID / INVOICED</td>
            </tr>
            <tr>
                <td style="padding:6px 10px; border:1px solid #E0E0E0; font-weight:700; color:#C41230;">Endorsements</td>
                <td colspan="3" style="padding:6px 10px; border:1px solid #E0E0E0; color:#666666; font-size:10px;">
                    NON-ENDORSABLE / REBOOKING RESTRICTIONS APPLY / HONG KONG AIRLINES
                </td>
            </tr>
        </table>

        <!-- Notice Box -->
        <div style="background:#FFF8F8; border:1px solid #F5C6CB; border-radius:6px; padding:10px 14px; font-size:10px; color:#666666; line-height:1.5;">
            <div style="font-weight:800; color:#C41230; margin-bottom:3px; text-transform:uppercase;">Important Notices & Reminders</div>
            <div>• Check-in counters close 60 minutes before scheduled departure. Boarding gate closes strictly 20 minutes before departure.</div>
            <div>• Free checked baggage allowance is 20kg (1 piece). Maximum dimensions: 158cm (L+W+H). Cabin baggage is 7kg.</div>
            <div>• Passengers are advised to ensure passports possess at least 6 months validity from date of travel.</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            Hong Kong Airlines Limited • 11/F, One Citygate, 20 Tat Tung Road, Tung Chung, Lantau, Hong Kong • www.hongkongairlines.com
        </div>

    </div>
    `;
}

export async function generateHongKongAirlinesPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getNewAirlineLogoDataUrl('Hong Kong Airlines');
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const CRIMSON = [196, 18, 48];  // #C41230
    const BORDER = [224, 224, 224];
    const BG_LIGHT = [253, 245, 246];
    const TEXT_DK = [31, 31, 31];
    const TEXT_MUT = [102, 102, 102];
    const GREEN = [14, 138, 76];

    const pnr = (data.pnr || data.bookingNo || 'HX7291').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `851-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Hong Kong Airlines', 'HX 264', 'Airbus A330-300');
    const checkedBag = data.checkedBaggage || '20KG / 1PC';

    // Top Crimson Accent Line
    doc.setFillColor(...CRIMSON);
    doc.rect(marginL, 30, contentW, 4, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            // natural ratio 1.38:1 (1024x743) -> 75 x 54 pt
            doc.addImage(logoDataUrl, 'PNG', marginL, 40, 75, 54);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...CRIMSON);
    doc.text('ELECTRONIC TICKET RECEIPT', marginR, 52, { align: 'right' });

    doc.setFontSize(10);
    doc.setTextColor(...TEXT_DK);
    doc.text('電子機票收據 / 行程單', marginR, 66, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Hong Kong Airlines (HX - 851)', marginR, 79, { align: 'right' });

    let curY = 100;

    // Booking Details Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 64, 'FD');

    doc.line(marginL, curY + 21, marginR, curY + 21);
    doc.line(marginL, curY + 42, marginR, curY + 42);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...CRIMSON);
    doc.text('Passenger Name:', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_DK);
    doc.text(paxList[0].name, marginL + 110, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...CRIMSON);
    doc.text('Booking Ref (PNR):', marginL + 285, curY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...CRIMSON);
    doc.text(pnr, marginL + 380, curY + 14);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...CRIMSON);
    doc.text('E-Ticket Number:', marginL + 8, curY + 35);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DK);
    doc.text(ticketNo, marginL + 110, curY + 35);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...CRIMSON);
    doc.text('Date of Issue:', marginL + 285, curY + 35);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(issuedDate, marginL + 380, curY + 35);

    // Row 3
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...CRIMSON);
    doc.text('Issuing Carrier:', marginL + 8, curY + 56);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('HONG KONG AIRLINES (HX) / TRIP.COM', marginL + 110, curY + 56);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...CRIMSON);
    doc.text('Booking Status:', marginL + 285, curY + 56);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('Confirmed (OK)', marginL + 380, curY + 56);

    curY += 76;

    // Flight Details Title
    doc.setFillColor(...CRIMSON);
    doc.rect(marginL, curY, 3, 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...CRIMSON);
    doc.text('ITINERARY / FLIGHT DETAILS', marginL + 8, curY + 10);

    curY += 16;

    // Flight Table Header
    doc.setFillColor(...CRIMSON);
    doc.rect(marginL, curY, contentW, 20, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('FLIGHT', marginL + 8, curY + 13);
    doc.text('DEPARTURE', marginL + 75, curY + 13);
    doc.text('ARRIVAL', marginL + 185, curY + 13);
    doc.text('CLASS', marginL + 295, curY + 13);
    doc.text('SEAT', marginL + 355, curY + 13);
    doc.text('BAGGAGE', marginL + 400, curY + 13);
    doc.text('STATUS', marginL + 475, curY + 13);

    curY += 20;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 46;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...CRIMSON);
        doc.text(fl.flightNo, marginL + 8, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Hong Kong Airlines', marginL + 8, curY + 25);
        doc.text(fl.aircraft || 'Airbus A330', marginL + 8, curY + 36);

        // Departure Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${fl.depCity} (${fl.fromCode})`, marginL + 75, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(fl.depDateFormatted || '', marginL + 75, curY + 25);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...CRIMSON);
        doc.text(`${fl.depTime}  ${fl.depTerminal || ''}`, marginL + 75, curY + 36);

        // Arrival Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${fl.arrCity} (${fl.toCode})`, marginL + 185, curY + 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(fl.arrDateFormatted || fl.depDateFormatted || '', marginL + 185, curY + 25);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...CRIMSON);
        doc.text(`${fl.arrTime}  ${fl.arrTerminal || ''}`, marginL + 185, curY + 36);

        // Class Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(fl.flightClass || 'Economy (E)', marginL + 295, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Fare: EOWHX', marginL + 295, curY + 28);

        // Seat Column
        doc.setFillColor(253, 234, 239);
        doc.rect(marginL + 352, curY + 10, 26, 16, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...CRIMSON);
        doc.text(fl.seat, marginL + 365, curY + 22, { align: 'center' });

        // Baggage Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(checkedBag, marginL + 400, curY + 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Cabin: 1PC 7KG', marginL + 400, curY + 28);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...GREEN);
        doc.text('OK', marginL + 488, curY + 22);

        curY += rowH;
    });

    curY += 12;

    // Payment Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 40, 'FD');
    doc.line(marginL, curY + 20, marginR, curY + 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...CRIMSON);
    doc.text('Form of Payment:', marginL + 8, curY + 13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('ELECTRONIC TICKET / CREDIT CARD', marginL + 95, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...CRIMSON);
    doc.text('Total Amount:', marginL + 300, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...CRIMSON);
    doc.text('PAID / INVOICED', marginL + 380, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...CRIMSON);
    doc.text('Endorsements:', marginL + 8, curY + 33);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('NON-ENDORSABLE / REBOOKING RESTRICTIONS APPLY / HONG KONG AIRLINES', marginL + 95, curY + 33);

    curY += 50;

    // Notice Box
    doc.setFillColor(255, 248, 248);
    doc.setDrawColor(245, 198, 203);
    doc.rect(marginL, curY, contentW, 58, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...CRIMSON);
    doc.text('IMPORTANT NOTICES & TRAVEL REMINDERS', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('• Check-in counters close 60 minutes prior to departure. Boarding gates close strictly 20 minutes before departure.', marginL + 8, curY + 26);
    doc.text('• Free checked baggage allowance: 20kg (1 piece). Maximum dimensions: 158cm (L+W+H). Carry-on baggage: 7kg.', marginL + 8, curY + 37);
    doc.text('• Passengers must hold a valid passport with at least 6 months validity from date of travel.', marginL + 8, curY + 48);

    curY += 72;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 149, 159);
    doc.text('Hong Kong Airlines Limited • Tung Chung, Lantau, Hong Kong • www.hongkongairlines.com', contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}

/* ========================================================================= */
/* 5. HK EXPRESS (UO) - HTML & PDF                                          */
/* ========================================================================= */

export function renderHkExpressTicketHtml(data) {
    const logoSrc = cachedHkExpressLogoDataUrl || 'assets/hk-express-logo.png';
    const pnr = (data.pnr || data.bookingNo || 'UO8812').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `016${Math.floor(1000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'HK Express', 'UO 614', 'Airbus A321neo');
    const checkedBag = data.checkedBaggage || 'Checked: 20kg';

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#222222; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.08); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Modern HK Express Gradient Accent Line -->
        <div style="height:4px; background:linear-gradient(90deg, #5E17EB 0%, #00B6DE 100%); margin-bottom:18px; border-radius:2px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="HK Express" style="height:40px; max-width:200px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:18px; font-weight:800; color:#5E17EB; letter-spacing:0.5px; text-transform:uppercase;">Booking Itinerary & E-Receipt</div>
                <div style="font-size:11px; font-weight:700; color:#00B6DE; letter-spacing:0.8px; margin-top:1px;">YOUR BOOKING IS CONFIRMED!</div>
                <div style="font-size:10px; color:#666666; margin-top:3px;">HK Express (UO) • A Cathay Company</div>
            </div>
        </div>

        <!-- Booking Overview Card -->
        <div style="background:#F8F6FD; border:1.5px solid #DCD2F7; border-radius:8px; padding:12px 16px; margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <span style="font-size:10.5px; font-weight:700; color:#666666; text-transform:uppercase;">Booking Reference (PNR):</span>
                    <span style="font-size:16px; font-weight:800; color:#5E17EB; letter-spacing:1px; margin-left:8px;">${escapeHtml(pnr)}</span>
                </div>
                <div>
                    <span style="display:inline-block; background:#E6F9F0; color:#0E8A4C; border:1px solid #A3E6C5; font-weight:800; font-size:11px; padding:4px 10px; border-radius:12px;">CONFIRMED / PAID</span>
                </div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:11px; color:#555555; border-top:1px solid #EBE4FA; padding-top:8px;">
                <div><strong>Booking Date:</strong> ${escapeHtml(issuedDate)}</div>
                <div><strong>Ticket / Order:</strong> ${escapeHtml(ticketNo)}</div>
                <div><strong>Passengers:</strong> ${paxList.length} ${paxList.length === 1 ? 'Guest' : 'Guests'}</div>
            </div>
        </div>

        <!-- Passenger & Add-ons Block -->
        <div style="background:#ffffff; border:1px solid #E3DCF7; border-radius:8px; padding:12px 16px; margin-bottom:20px;">
            <div style="font-size:11px; font-weight:800; color:#5E17EB; text-transform:uppercase; margin-bottom:8px;">Guest & Travel Add-ons</div>
            ${paxList.map((p, i) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:${i < paxList.length - 1 ? '1px dashed #EBE4FA' : 'none'};">
                    <div style="font-weight:700; font-size:12px; color:#222222;">
                        ${i + 1}. ${escapeHtml(p.name)}
                    </div>
                    <div>
                        <span style="display:inline-block; background:#5E17EB; color:#ffffff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; margin-right:6px;">Seat: ${escapeHtml(p.seat)}</span>
                        <span style="display:inline-block; background:#00B6DE; color:#ffffff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; margin-right:6px;">${escapeHtml(checkedBag)}</span>
                        <span style="display:inline-block; background:#ECE7F8; color:#5E17EB; font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px;">Cabin: 7kg</span>
                    </div>
                </div>
            `).join('')}
        </div>

        <!-- Section: Flights -->
        <div style="font-size:12px; font-weight:800; color:#5E17EB; border-left:4px solid #00B6DE; padding-left:8px; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.5px;">
            Flight Details
        </div>

        ${flights.map((fl, idx) => `
        <div style="border:1px solid #DCD2F7; border-radius:8px; margin-bottom:14px; overflow:hidden;">
            <!-- Sector Header Bar -->
            <div style="background:#5E17EB; color:#ffffff; padding:8px 14px; font-size:11.5px; font-weight:700; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    FLIGHT ${idx + 1}: ${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)}) ➔ ${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})
                </div>
                <div style="font-size:11px; font-weight:800; color:#00B6DE;">
                    ${escapeHtml(fl.flightNo)}
                </div>
            </div>
            <!-- Sector Body -->
            <div style="padding:12px 14px; background:#FAF8FF; display:flex; justify-content:space-between; align-items:flex-start; font-size:11px;">
                <div style="width:36%;">
                    <div style="font-size:10px; color:#666666; text-transform:uppercase;">DEPARTING</div>
                    <div style="font-size:13px; font-weight:800; color:#222222; margin-top:2px;">${escapeHtml(fl.depTime)}</div>
                    <div style="font-weight:700; color:#5E17EB;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                    <div style="font-size:10px; color:#666666;">${escapeHtml(fl.depDateFormatted)}</div>
                    <div style="font-size:10px; color:#555555; margin-top:2px;">${escapeHtml(fl.depTerminal)}</div>
                </div>
                <div style="width:28%; text-align:center; padding-top:6px;">
                    <div style="font-size:10px; font-weight:700; color:#00B6DE;">${escapeHtml(fl.duration || 'Non-Stop')}</div>
                    <div style="font-size:13px; color:#5E17EB; margin:4px 0;">✈ ➔</div>
                    <div style="font-size:10px; color:#666666;">${escapeHtml(fl.aircraft || 'Airbus A321neo')}</div>
                    <div style="font-size:10px; font-weight:700; color:#222222; margin-top:2px;">${escapeHtml(fl.flightClass || 'Economy (Fun)')}</div>
                </div>
                <div style="width:36%; text-align:right;">
                    <div style="font-size:10px; color:#666666; text-transform:uppercase;">ARRIVING</div>
                    <div style="font-size:13px; font-weight:800; color:#222222; margin-top:2px;">${escapeHtml(fl.arrTime)}</div>
                    <div style="font-weight:700; color:#5E17EB;">${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                    <div style="font-size:10px; color:#666666;">${escapeHtml(fl.arrDateFormatted || fl.depDateFormatted)}</div>
                    <div style="font-size:10px; color:#555555; margin-top:2px;">${escapeHtml(fl.arrTerminal)}</div>
                </div>
            </div>
        </div>
        `).join('')}

        <!-- Payment Breakdown Box -->
        <table style="width:100%; border-collapse:collapse; background:#F8F6FD; border:1px solid #DCD2F7; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #DCD2F7; width:25%; font-weight:700; color:#5E17EB;">Payment Status</td>
                <td style="padding:6px 10px; border:1px solid #DCD2F7; width:25%; font-weight:700; color:#0E8A4C;">COMPLETED / PAID</td>
                <td style="padding:6px 10px; border:1px solid #DCD2F7; width:25%; font-weight:700; color:#5E17EB;">Total Amount</td>
                <td style="padding:6px 10px; border:1px solid #DCD2F7; width:25%; font-weight:800; color:#5E17EB;">PAID IN FULL</td>
            </tr>
        </table>

        <!-- Reminders Box -->
        <div style="background:#FAF8FF; border:1px solid #DCD2F7; border-radius:6px; padding:10px 14px; font-size:10px; color:#555555; line-height:1.5;">
            <div style="font-weight:800; color:#5E17EB; margin-bottom:3px; text-transform:uppercase;">HK Express Travel Reminders</div>
            <div>• Online Check-in opens 48 hours and closes 75 minutes before departure at hkexpress.com or mobile app.</div>
            <div>• Airport Arrival: Arrive at airport at least 2 to 3 hours prior to departure for check-in and security checks.</div>
            <div>• Baggage Policy: Strict limits apply. 1 carry-on bag (up to 7kg, 56x36x23cm) + 1 personal item. Excess fees charged at gate.</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            Hong Kong Express Airways Limited • 11/F Gatehouse, Hong Kong International Airport • www.hkexpress.com
        </div>

    </div>
    `;
}

export async function generateHkExpressPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getNewAirlineLogoDataUrl('HK Express');
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const PURPLE = [94, 23, 235];   // #5E17EB
    const CYAN = [0, 182, 222];     // #00B6DE
    const BORDER = [220, 210, 247]; // #DCD2F7
    const BG_LIGHT = [248, 246, 253]; // #F8F6FD
    const TEXT_DK = [34, 34, 34];
    const TEXT_MUT = [102, 102, 102];
    const GREEN = [14, 138, 76];

    const pnr = (data.pnr || data.bookingNo || 'UO8812').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `016${Math.floor(1000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'HK Express', 'UO 614', 'Airbus A321neo');
    const checkedBag = data.checkedBaggage || 'Checked: 20kg';

    // Top Modern Purple & Cyan Gradient Bars
    doc.setFillColor(...PURPLE);
    doc.rect(marginL, 30, contentW * 0.6, 3, 'F');
    doc.setFillColor(...CYAN);
    doc.rect(marginL + (contentW * 0.6), 30, contentW * 0.4, 3, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            // natural ratio 3.8:1 (661x174) -> 155 x 41 pt
            doc.addImage(logoDataUrl, 'PNG', marginL, 42, 155, 41);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14.5);
    doc.setTextColor(...PURPLE);
    doc.text('BOOKING ITINERARY & E-RECEIPT', marginR, 52, { align: 'right' });

    doc.setFontSize(9.5);
    doc.setTextColor(...CYAN);
    doc.text('YOUR TRIP IS CONFIRMED!', marginR, 66, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('HK Express (UO) • A Cathay Company', marginR, 79, { align: 'right' });

    let curY = 96;

    // Booking Overview Card
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(1);
    doc.roundedRect(marginL, curY, contentW, 52, 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('BOOKING REFERENCE (PNR):', marginL + 12, curY + 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...PURPLE);
    doc.text(pnr, marginL + 160, curY + 19);

    // Green Badge
    doc.setFillColor(230, 249, 240);
    doc.setDrawColor(163, 230, 197);
    doc.roundedRect(marginR - 120, curY + 8, 108, 18, 9, 9, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GREEN);
    doc.text('CONFIRMED / PAID', marginR - 66, curY + 20, { align: 'center' });

    doc.setDrawColor(235, 228, 250);
    doc.line(marginL + 12, curY + 32, marginR - 12, curY + 32);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text(`Booking Date: ${issuedDate}`, marginL + 12, curY + 44);
    doc.text(`Ticket: ${ticketNo}`, marginL + 180, curY + 44);
    doc.text(`Guests: ${paxList.length}`, marginR - 12, curY + 44, { align: 'right' });

    curY += 62;

    // Passenger & Add-ons Box
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(marginL, curY, contentW, 36 + (paxList.length * 16), 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...PURPLE);
    doc.text('GUEST & TRAVEL ADD-ONS', marginL + 12, curY + 16);

    let paxY = curY + 30;
    paxList.forEach((p, idx) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${idx + 1}. ${p.name}`, marginL + 12, paxY);

        // Badge Seat
        doc.setFillColor(...PURPLE);
        doc.roundedRect(marginR - 220, paxY - 9, 58, 13, 6, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text(`Seat: ${p.seat}`, marginR - 191, paxY, { align: 'center' });

        // Badge Baggage
        doc.setFillColor(...CYAN);
        doc.roundedRect(marginR - 155, paxY - 9, 80, 13, 6, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text(checkedBag, marginR - 115, paxY, { align: 'center' });

        // Badge Cabin
        doc.setFillColor(236, 231, 248);
        doc.roundedRect(marginR - 68, paxY - 9, 56, 13, 6, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...PURPLE);
        doc.text('Cabin: 7kg', marginR - 40, paxY, { align: 'center' });

        paxY += 16;
    });

    curY += 46 + (paxList.length * 16);

    // Section Title
    doc.setFillColor(...CYAN);
    doc.rect(marginL, curY, 3, 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...PURPLE);
    doc.text('FLIGHT DETAILS', marginL + 8, curY + 10);

    curY += 16;

    // Flight Cards
    flights.forEach((fl, idx) => {
        const cardH = 68;

        // Header bar of card
        doc.setFillColor(...PURPLE);
        doc.rect(marginL, curY, contentW, 18, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        doc.text(`FLIGHT ${idx + 1}: ${fl.depCity} (${fl.fromCode}) ➔ ${fl.arrCity} (${fl.toCode})`, marginL + 8, curY + 12);

        doc.setTextColor(...CYAN);
        doc.text(fl.flightNo, marginR - 8, curY + 12, { align: 'right' });

        // Body of card
        doc.setFillColor(250, 248, 255);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY + 18, contentW, cardH - 18, 'FD');

        // Departing Side
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text('DEPARTING', marginL + 12, curY + 30);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...TEXT_DK);
        doc.text(fl.depTime, marginL + 12, curY + 43);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...PURPLE);
        doc.text(`${fl.depCity} (${fl.fromCode})`, marginL + 12, curY + 54);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(`${fl.depDateFormatted} • ${fl.depTerminal}`, marginL + 12, curY + 63);

        // Center Duration
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...CYAN);
        doc.text(fl.duration || 'Non-Stop', contentW / 2 + marginL, curY + 36, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(fl.aircraft || 'Airbus A321neo', contentW / 2 + marginL, curY + 48, { align: 'center' });
        doc.text(fl.flightClass || 'Economy (Fun)', contentW / 2 + marginL, curY + 58, { align: 'center' });

        // Arriving Side
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text('ARRIVING', marginR - 12, curY + 30, { align: 'right' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...TEXT_DK);
        doc.text(fl.arrTime, marginR - 12, curY + 43, { align: 'right' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...PURPLE);
        doc.text(`${fl.arrCity} (${fl.toCode})`, marginR - 12, curY + 54, { align: 'right' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_MUT);
        doc.text(`${fl.arrDateFormatted || fl.depDateFormatted} • ${fl.arrTerminal}`, marginR - 12, curY + 63, { align: 'right' });

        curY += cardH + 10;
    });

    // Payment Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 20, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PURPLE);
    doc.text('Payment Status:', marginL + 8, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('COMPLETED / PAID', marginL + 95, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PURPLE);
    doc.text('Total Amount:', marginL + 300, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PURPLE);
    doc.text('PAID IN FULL', marginL + 380, curY + 13);

    curY += 28;

    // Reminders Box
    doc.setFillColor(250, 248, 255);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 58, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PURPLE);
    doc.text('HK EXPRESS TRAVEL REMINDERS', marginL + 8, curY + 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('• Online Check-in opens 48 hours and closes 75 minutes before departure at hkexpress.com or app.', marginL + 8, curY + 26);
    doc.text('• Please arrive at the airport at least 2 to 3 hours prior to departure for check-in and security checks.', marginL + 8, curY + 37);
    doc.text('• Strict baggage limits: 1 carry-on bag (up to 7kg, 56x36x23cm) + 1 small personal item. Excess fees charged at gate.', marginL + 8, curY + 48);

    curY += 72;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 149, 159);
    doc.text('Hong Kong Express Airways Limited • Hong Kong International Airport • www.hkexpress.com', contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}
