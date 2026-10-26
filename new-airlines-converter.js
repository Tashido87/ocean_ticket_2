import { loadDocumentLibraries } from './document-libraries.js';
import {
    CHINA_EASTERN_LOGO_DATA_URL,
    VIETNAM_AIRLINES_LOGO_DATA_URL,
    CATHAY_PACIFIC_LOGO_DATA_URL,
    HONG_KONG_AIRLINES_LOGO_DATA_URL,
    HK_EXPRESS_LOGO_DATA_URL
} from './new-airlines-logos.js';
import {
    resolveAirportName,
    splitCityAndAirport,
    formatPassengerName,
    generateRandomSeat
} from './china-airlines-parser.mjs';

/**
 * Get guaranteed logo Data URL for HTML preview and PDF export
 */
export async function getNewAirlineLogoDataUrl(airline) {
    if (/China Eastern/i.test(airline || '')) return CHINA_EASTERN_LOGO_DATA_URL;
    if (/Vietnam/i.test(airline || '')) return VIETNAM_AIRLINES_LOGO_DATA_URL;
    if (/Cathay/i.test(airline || '')) return CATHAY_PACIFIC_LOGO_DATA_URL;
    if (/Hong Kong Airlines/i.test(airline || '')) return HONG_KONG_AIRLINES_LOGO_DATA_URL;
    if (/HK Express/i.test(airline || '')) return HK_EXPRESS_LOGO_DATA_URL;
    return CHINA_EASTERN_LOGO_DATA_URL;
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
 * Format passenger name ensuring NO (ADT) is attached anywhere
 */
function normalizePaxName(rawName) {
    const clean = formatPassengerName(rawName || 'PASSENGER / SAMPLE MR');
    return clean.replace(/\s*\((?:ADT|CHD|INF)\)$/i, '').trim();
}

/**
 * Format baggage string compactly for table cells (prevents overflow)
 * e.g. "30 kg per person\nDimensions of each piece cannot exceed..." -> "30 kg"
 */
function formatCompactBaggage(bagStr, defaultVal = '20 kg') {
    if (!bagStr || typeof bagStr !== 'string') return defaultVal;
    const clean = bagStr.split('\n')[0].trim();
    if (/(?:no\s*free\s*baggage|no\s*checked\s*baggage|no\s*baggage\s*allowance|(?<!\d)0\s*(?:kg|pcs?|pieces?)\b|\bnil\b|\bnone\b|\bnot\s*included\b)/i.test(clean)) {
        return 'No free baggage';
    }
    const m = clean.match(/(?:checked:\s*)?(\d+\s*(?:kg|kilos?|pc|pcs|pieces?)(?:\s*\([^)]+\))?)/i);
    if (m) {
        return m[1].replace(/checked:\s*/i, '').trim();
    }
    if (clean.length <= 15) return clean;
    return clean.substring(0, 15).trim();
}

/**
 * Resolve carry-on / cabin baggage weight dynamically from ticket data
 */
export function resolveCarryOnText(data, defaultWeight = '7kg') {
    if (!data) return defaultWeight;

    if (data.carryOnWeight) {
        const m = String(data.carryOnWeight).match(/(\d+)\s*kg/i);
        if (m) return `${m[1]}kg`;
    }

    if (data.carryOnBaggage) {
        const m = String(data.carryOnBaggage).match(/(\d+)\s*kg/i);
        if (m) return `${m[1]}kg`;
    }

    if (data.checkedBaggage) {
        const m = String(data.checkedBaggage).match(/Carry-on\s*:\s*(\d+)\s*kg/i);
        if (m) return `${m[1]}kg`;
    }

    if (data.flights && data.flights.length > 0) {
        for (const f of data.flights) {
            if (f && f.carryOn) {
                const m = String(f.carryOn).match(/(\d+)\s*kg/i);
                if (m) return `${m[1]}kg`;
            }
            if (f && f.baggage && /carry-on/i.test(f.baggage)) {
                const m = String(f.baggage).match(/(\d+)\s*kg/i);
                if (m) return `${m[1]}kg`;
            }
        }
    }

    return defaultWeight;
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
 * Clean ASCII string for jsPDF (eliminates Unicode arrows, broken symbols)
 */
function toSafeAscii(str) {
    if (!str) return '';
    return String(str)
        .replace(/[➔➜➝→]/g, 'TO')
        .replace(/[✈]/g, '->')
        .replace(/[•●·]/g, '-')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[—–]/g, '-');
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

    return flights.map(fl => {
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
 * Prepare passenger list ensuring NO (ADT)
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
    const logoSrc = CHINA_EASTERN_LOGO_DATA_URL;
    const pnr = (data.pnr || data.bookingNo || 'D8YUUK').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `781-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'China Eastern Airlines', 'MU 562', 'Airbus A350-900');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '2PC (23kg)');
    const carryOnText = resolveCarryOnText(data, '7kg');

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#2D3748; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.06); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Top Navy & Burgundy Brand Stripe -->
        <div style="height:3px; background:#0B2341; margin-bottom:18px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="China Eastern Airlines" style="height:44px; max-width:240px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:17px; font-weight:800; color:#0B2341; letter-spacing:0.5px; text-transform:uppercase;">Passenger E-Ticket Receipt</div>
                <div style="font-size:11px; font-weight:700; color:#8B1E2D; letter-spacing:0.5px; margin-top:2px;">ELECTRONIC ITINERARY / PASSENGER RECEIPT</div>
                <div style="font-size:10px; color:#646E7D; margin-top:2px;">Issuing Carrier: CHINA EASTERN AIRLINES (MU - 781)</div>
            </div>
        </div>

        <!-- Booking Overview Table -->
        <table style="width:100%; border-collapse:collapse; background:#F8F9FB; border:1px solid #DAE0E9; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; width:18%; font-weight:700; color:#646E7D;">Passenger Name</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; width:32%; font-weight:700; color:#0B2341; font-size:12px;">${escapeHtml(paxList[0].name)}</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; width:18%; font-weight:700; color:#646E7D;">Booking Ref (PNR)</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; width:32%; font-weight:800; color:#0B2341; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; font-weight:700; color:#646E7D;">E-Ticket Number</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; font-weight:700; color:#2D3748;">${escapeHtml(ticketNo)}</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; font-weight:700; color:#646E7D;">Date of Issue</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; color:#2D3748;">${escapeHtml(issuedDate)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; font-weight:700; color:#646E7D;">Issuing Office / IATA</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; color:#2D3748;">CHINA EASTERN AIRLINES / 41300921</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; font-weight:700; color:#646E7D;">Booking Status</td>
                <td style="padding:7px 10px; border:1px solid #DAE0E9; font-weight:700; color:#166534;">Confirmed / OK</td>
            </tr>
        </table>

        <!-- Section: Flight Itinerary -->
        <div style="font-size:11.5px; font-weight:800; color:#0B2341; border-left:3px solid #8B1E2D; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Flight Itinerary
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #DAE0E9;">
            <thead>
                <tr style="background:#0B2341; color:#ffffff; text-align:left;">
                    <th style="padding:8px 10px; border:1px solid #0B2341; font-weight:700; width:13%;">FLIGHT</th>
                    <th style="padding:8px 10px; border:1px solid #0B2341; font-weight:700; width:18%;">DEPARTURE</th>
                    <th style="padding:8px 10px; border:1px solid #0B2341; font-weight:700; width:18%;">ARRIVAL</th>
                    <th style="padding:8px 10px; border:1px solid #0B2341; font-weight:700; width:18%;">CLASS</th>
                    <th style="padding:8px 10px; border:1px solid #0B2341; font-weight:700; text-align:center; width:8%;">SEAT</th>
                    <th style="padding:8px 10px; border:1px solid #0B2341; font-weight:700; width:15%;">BAGGAGE</th>
                    <th style="padding:8px 10px; border:1px solid #0B2341; font-weight:700; text-align:center; width:10%;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#F8F9FB'};">
                    <td style="padding:8px 10px; border:1px solid #DAE0E9; vertical-align:top;">
                        <div style="font-weight:800; color:#0B2341; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#646E7D; margin-top:2px;">China Eastern</div>
                        <div style="font-size:9.5px; color:#646E7D;">${escapeHtml(fl.aircraft || 'Airbus A350-900')}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE0E9; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                        <div style="font-size:10px; color:#646E7D; margin-top:2px;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#0B2341; font-size:12px;">${escapeHtml(fl.depTime)}</div>
                        ${fl.depTerminal ? `<div style="font-size:9.5px; color:#646E7D;">T${escapeHtml(fl.depTerminal)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE0E9; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748; font-size:11.5px;">${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:10px; color:#646E7D; margin-top:2px;">${escapeHtml(fl.arrDateFormatted || fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#0B2341; font-size:12px;">${escapeHtml(fl.arrTime)}</div>
                        ${fl.arrTerminal ? `<div style="font-size:9.5px; color:#646E7D;">T${escapeHtml(fl.arrTerminal)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE0E9; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748;">${escapeHtml(fl.flightClass || 'Economy (Y)')}</div>
                        ${fl.fareBasis ? `<div style="font-size:9.5px; color:#646E7D; margin-top:2px;">Fare: ${escapeHtml(fl.fareBasis)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE0E9; vertical-align:top; text-align:center;">
                        <span style="font-weight:700; color:#0B2341; font-size:11px;">${escapeHtml(fl.seat)}</span>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE0E9; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748;">${escapeHtml(checkedBag)}</div>
                        <div style="font-size:9.5px; color:#646E7D;">Carry-on: ${escapeHtml(carryOnText)}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE0E9; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#166534;">OK</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Fare and Endorsements -->
        <table style="width:100%; border-collapse:collapse; background:#F8F9FB; border:1px solid #DAE0E9; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #DAE0E9; width:22%; font-weight:700; color:#646E7D;">Form of Payment</td>
                <td style="padding:6px 10px; border:1px solid #DAE0E9; width:28%; color:#2D3748;">ELECTRONIC TICKET / INVOICED</td>
                <td style="padding:6px 10px; border:1px solid #DAE0E9; width:22%; font-weight:700; color:#646E7D;">Total Amount</td>
                <td style="padding:6px 10px; border:1px solid #DAE0E9; width:28%; font-weight:800; color:#0B2341;">PAID / TAXES INCL</td>
            </tr>
            <tr>
                <td style="padding:6px 10px; border:1px solid #DAE0E9; font-weight:700; color:#646E7D;">Endorsements</td>
                <td colspan="3" style="padding:6px 10px; border:1px solid #DAE0E9; color:#646E7D; font-size:10px;">
                    NON-ENDORSABLE / REBOOKING RESTRICTIONS APPLY / SKYTEAM RECOGNIZED
                </td>
            </tr>
        </table>

        <!-- Notice & Legal Reminders -->
        <div style="background:#F8F9FB; border:1px solid #DAE0E9; border-radius:6px; padding:10px 14px; font-size:10px; color:#646E7D; line-height:1.5;">
            <div style="font-weight:800; color:#0B2341; margin-bottom:3px; text-transform:uppercase;">Notice & Travel Reminders</div>
            <div>- Check-in counters open 3 hours prior and close strictly 60 minutes before departure. Gate closes 20 minutes prior.</div>
            <div>- Passengers must present a valid government-issued photo ID / passport matching the electronic ticket name at check-in.</div>
            <div>- Checked baggage allowance as indicated above. Carry-on baggage: 1 piece (max ${escapeHtml(carryOnText)}, 55x40x20cm).</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            China Eastern Airlines Co., Ltd. • Pudong International Airport, Shanghai, China • www.ceair.com
        </div>

    </div>
    `;
}

export async function generateChinaEasternPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = CHINA_EASTERN_LOGO_DATA_URL;
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const NAVY = [11, 35, 65];     // #0B2341 (Professional Navy)
    const BURGUNDY = [139, 30, 45]; // #8B1E2D (Classic Deep Burgundy)
    const BORDER = [218, 224, 233];
    const BG_LIGHT = [248, 249, 251];
    const TEXT_DK = [45, 55, 72];
    const TEXT_MUT = [100, 110, 125];
    const GREEN = [22, 101, 52];

    const pnr = (data.pnr || data.bookingNo || 'D8YUUK').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `781-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'China Eastern Airlines', 'MU 562', 'Airbus A350-900');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '2PC (23kg)');
    const carryOnText = resolveCarryOnText(data, '7kg');

    // Top Stripe
    doc.setFillColor(...NAVY);
    doc.rect(marginL, 30, contentW, 3, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', marginL, 42, 165, 40);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...NAVY);
    doc.text('PASSENGER E-TICKET RECEIPT', marginR, 52, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(...BURGUNDY);
    doc.text('ELECTRONIC ITINERARY / PASSENGER RECEIPT', marginR, 65, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Issuing Carrier: CHINA EASTERN AIRLINES (MU - 781)', marginR, 77, { align: 'right' });

    let curY = 94;

    // Booking Details Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 60, 'FD');

    doc.line(marginL, curY + 20, marginR, curY + 20);
    doc.line(marginL, curY + 40, marginR, curY + 40);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Passenger Name:', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text(toSafeAscii(paxList[0].name), marginL + 95, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Booking Ref (PNR):', marginL + 280, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...NAVY);
    doc.text(toSafeAscii(pnr), marginL + 380, curY + 13);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text('E-Ticket Number:', marginL + 8, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(ticketNo), marginL + 95, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Date of Issue:', marginL + 280, curY + 33);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(issuedDate), marginL + 380, curY + 33);

    // Row 3
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Issuing Office:', marginL + 8, curY + 53);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('CHINA EASTERN AIRLINES / 41300921', marginL + 95, curY + 53);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Booking Status:', marginL + 280, curY + 53);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('Confirmed / OK', marginL + 380, curY + 53);

    curY += 72;

    // Flight Itinerary Title
    doc.setFillColor(...BURGUNDY);
    doc.rect(marginL, curY, 3, 11, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text('FLIGHT ITINERARY', marginL + 8, curY + 9);

    curY += 15;

    // Flight Table Header
    doc.setFillColor(...NAVY);
    doc.rect(marginL, curY, contentW, 18, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('FLIGHT', marginL + 8, curY + 12);
    doc.text('DEPARTURE', marginL + 72, curY + 12);
    doc.text('ARRIVAL', marginL + 164, curY + 12);
    doc.text('CLASS', marginL + 258, curY + 12);
    doc.text('SEAT', marginL + 350, curY + 12);
    doc.text('BAGGAGE', marginL + 390, curY + 12);
    doc.text('STATUS', marginL + 474, curY + 12);

    curY += 18;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 44;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...NAVY);
        doc.text(toSafeAscii(fl.flightNo), marginL + 8, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text('China Eastern', marginL + 8, curY + 24);
        doc.text(toSafeAscii(fl.aircraft || 'Airbus A350'), marginL + 8, curY + 34);

        // Departure Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${toSafeAscii(fl.depCity)} (${toSafeAscii(fl.fromCode)})`, marginL + 72, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.depDateFormatted || ''), marginL + 72, curY + 24);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...NAVY);
        doc.text(`${toSafeAscii(fl.depTime)}${fl.depTerminal ? `  T${toSafeAscii(fl.depTerminal)}` : ''}`, marginL + 72, curY + 34);

        // Arrival Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${toSafeAscii(fl.arrCity)} (${toSafeAscii(fl.toCode)})`, marginL + 164, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.arrDateFormatted || fl.depDateFormatted || ''), marginL + 164, curY + 24);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...NAVY);
        doc.text(`${toSafeAscii(fl.arrTime)}${fl.arrTerminal ? `  T${toSafeAscii(fl.arrTerminal)}` : ''}`, marginL + 164, curY + 34);

        // Class Column (Spacious 90pt width - never collides!)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(fl.flightClass || 'Economy (Y)'), marginL + 258, curY + 15);

        if (fl.fareBasis) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(...TEXT_MUT);
            doc.text(`Fare: ${toSafeAscii(fl.fareBasis)}`, marginL + 258, curY + 26);
        }

        // Seat Column (CLEAN TEXT - NO BUTTON PILL)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...NAVY);
        doc.text(toSafeAscii(fl.seat), marginL + 368, curY + 21, { align: 'center' });

        // Baggage Column (COMPACT - NO OVERFLOW)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(checkedBag), marginL + 390, curY + 15);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(`Carry-on: ${carryOnText}`, marginL + 390, curY + 26);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...GREEN);
        doc.text('OK', marginL + 490, curY + 21, { align: 'center' });

        curY += rowH;
    });

    curY += 12;

    // Payment Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 36, 'FD');
    doc.line(marginL, curY + 18, marginR, curY + 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Form of Payment:', marginL + 8, curY + 12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('ELECTRONIC TICKET / INVOICED', marginL + 95, curY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Total Amount:', marginL + 300, curY + 12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...NAVY);
    doc.text('PAID / TAXES INCL', marginL + 380, curY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Endorsements:', marginL + 8, curY + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('NON-ENDORSABLE / REBOOKING RESTRICTIONS APPLY / SKYTEAM', marginL + 95, curY + 30);

    curY += 46;

    // Notice Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 52, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text('NOTICE & TRAVEL REMINDERS', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('- Check-in counters open 3 hours prior and close strictly 60 minutes before departure. Gate closes 20 minutes prior.', marginL + 8, curY + 24);
    doc.text('- Passengers must present a valid government photo ID / passport matching the electronic ticket name at check-in.', marginL + 8, curY + 34);
    doc.text(`- Checked baggage allowance as indicated above. Carry-on baggage: 1 piece (max ${carryOnText}, 55x40x20cm).`, marginL + 8, curY + 44);

    curY += 66;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140, 149, 159);
    doc.text(toSafeAscii('China Eastern Airlines Co., Ltd. - Pudong International Airport, Shanghai, China - www.ceair.com'), contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}

/* ========================================================================= */
/* 2. VIETNAM AIRLINES (VN / 738) - HTML & PDF                              */
/* ========================================================================= */

export function renderVietnamAirlinesTicketHtml(data) {
    const logoSrc = VIETNAM_AIRLINES_LOGO_DATA_URL;
    const pnr = (data.pnr || data.bookingNo || '64FFCC').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `738 ${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Vietnam Airlines', 'VN 126', 'Boeing 787-9');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '1PC (23kg)');
    const carryOnText = resolveCarryOnText(data, '7kg');

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#232D37; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.06); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Top Deep Teal Accent Bar -->
        <div style="height:3px; background:#004851; margin-bottom:18px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="Vietnam Airlines" style="height:48px; max-width:240px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:17px; font-weight:800; color:#004851; letter-spacing:0.5px; text-transform:uppercase;">Electronic Ticket Receipt</div>
                <div style="font-size:11px; font-weight:700; color:#9C7A14; letter-spacing:0.5px; margin-top:2px;">VIETNAM AIRLINES - SKYTEAM MEMBER</div>
                <div style="font-size:10px; color:#5F6973; margin-top:2px;">Issuing Carrier: VIETNAM AIRLINES (VN - 738)</div>
            </div>
        </div>

        <!-- Booking Overview Table -->
        <table style="width:100%; border-collapse:collapse; background:#F5F9FA; border:1px solid #C3D7DB; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; width:20%; font-weight:700; color:#004851;">Passenger Name</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; width:30%; font-weight:700; color:#232D37; font-size:12px;">${escapeHtml(paxList[0].name)}</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; width:20%; font-weight:700; color:#004851;">Booking Ref (PNR)</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; width:30%; font-weight:800; color:#004851; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; font-weight:700; color:#004851;">Ticket Number</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; font-weight:700; color:#232D37;">${escapeHtml(ticketNo)}</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; font-weight:700; color:#004851;">Date of Issue</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; color:#232D37;">${escapeHtml(issuedDate)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; font-weight:700; color:#004851;">Issuing Office</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; color:#232D37;">VIETNAM AIRLINES OFFICIAL / AGENT</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; font-weight:700; color:#004851;">Status</td>
                <td style="padding:7px 10px; border:1px solid #C3D7DB; font-weight:700; color:#166534;">CONFIRMED / OK</td>
            </tr>
        </table>

        <!-- Section Title -->
        <div style="font-size:11.5px; font-weight:800; color:#004851; border-left:3px solid #9C7A14; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Flight Details & Itinerary
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #C3D7DB;">
            <thead>
                <tr style="background:#004851; color:#ffffff; text-align:left;">
                    <th style="padding:8px 10px; border:1px solid #004851; font-weight:700; width:13%;">FLIGHT</th>
                    <th style="padding:8px 10px; border:1px solid #004851; font-weight:700; width:18%;">DEPARTURE</th>
                    <th style="padding:8px 10px; border:1px solid #004851; font-weight:700; width:18%;">ARRIVAL</th>
                    <th style="padding:8px 10px; border:1px solid #004851; font-weight:700; width:18%;">CLASS</th>
                    <th style="padding:8px 10px; border:1px solid #004851; font-weight:700; text-align:center; width:8%;">SEAT</th>
                    <th style="padding:8px 10px; border:1px solid #004851; font-weight:700; width:15%;">BAGGAGE</th>
                    <th style="padding:8px 10px; border:1px solid #004851; font-weight:700; text-align:center; width:10%;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#F5F9FA'};">
                    <td style="padding:8px 10px; border:1px solid #C3D7DB; vertical-align:top;">
                        <div style="font-weight:800; color:#004851; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#5F6973; margin-top:2px;">Vietnam Airlines</div>
                        <div style="font-size:9.5px; color:#5F6973;">${escapeHtml(fl.aircraft || 'Boeing 787-9')}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #C3D7DB; vertical-align:top;">
                        <div style="font-weight:700; color:#232D37; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                        <div style="font-size:10px; color:#5F6973; margin-top:2px;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#004851; font-size:12px;">${escapeHtml(fl.depTime)}</div>
                        ${fl.depTerminal ? `<div style="font-size:9.5px; color:#5F6973;">T${escapeHtml(fl.depTerminal)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #C3D7DB; vertical-align:top;">
                        <div style="font-weight:700; color:#232D37; font-size:11.5px;">${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:10px; color:#5F6973; margin-top:2px;">${escapeHtml(fl.arrDateFormatted || fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#004851; font-size:12px;">${escapeHtml(fl.arrTime)}</div>
                        ${fl.arrTerminal ? `<div style="font-size:9.5px; color:#5F6973;">T${escapeHtml(fl.arrTerminal)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #C3D7DB; vertical-align:top;">
                        <div style="font-weight:700; color:#232D37;">${escapeHtml(fl.flightClass || 'Economy Classic (K)')}</div>
                        ${fl.fareBasis ? `<div style="font-size:9.5px; color:#5F6973; margin-top:2px;">Fare: ${escapeHtml(fl.fareBasis)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #C3D7DB; vertical-align:top; text-align:center;">
                        <span style="font-weight:700; color:#004851; font-size:11px;">${escapeHtml(fl.seat)}</span>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #C3D7DB; vertical-align:top;">
                        <div style="font-weight:700; color:#232D37;">${escapeHtml(checkedBag)}</div>
                        <div style="font-size:9.5px; color:#5F6973;">Carry-on: ${escapeHtml(carryOnText)}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #C3D7DB; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#166534;">OK</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Payment & Conditions Box -->
        <table style="width:100%; border-collapse:collapse; background:#F5F9FA; border:1px solid #C3D7DB; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #C3D7DB; width:22%; font-weight:700; color:#004851;">Payment</td>
                <td style="padding:6px 10px; border:1px solid #C3D7DB; width:28%; color:#232D37;">ELECTRONIC TICKET / PAID</td>
                <td style="padding:6px 10px; border:1px solid #C3D7DB; width:22%; font-weight:700; color:#004851;">Total Amount</td>
                <td style="padding:6px 10px; border:1px solid #C3D7DB; width:28%; font-weight:800; color:#004851;">INCLUDED / PAID IN FULL</td>
            </tr>
            <tr>
                <td style="padding:6px 10px; border:1px solid #C3D7DB; font-weight:700; color:#004851;">Conditions</td>
                <td colspan="3" style="padding:6px 10px; border:1px solid #C3D7DB; color:#5F6973; font-size:10px;">
                    NON-ENDORSABLE / REBOOKING APPLIES / LOTUSMILES ACCRUAL ELIGIBLE
                </td>
            </tr>
        </table>

        <!-- Check-in & Conditions Notice -->
        <div style="background:#F5F9FA; border:1px solid #C3D7DB; border-radius:6px; padding:10px 14px; font-size:10px; color:#5F6973; line-height:1.5;">
            <div style="font-weight:800; color:#004851; margin-bottom:3px; text-transform:uppercase;">Important Travel Information</div>
            <div>- Online check-in is available 24 hours to 1 hour before scheduled flight at www.vietnamairlines.com.</div>
            <div>- Check-in counters close 50 min before domestic flights and 60 min before international flights.</div>
            <div>- Free cabin baggage limit: 1 piece (max ${escapeHtml(carryOnText)}) + 1 small personal item.</div>
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

    const logoDataUrl = VIETNAM_AIRLINES_LOGO_DATA_URL;
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const TEAL = [0, 72, 81];      // #004851 (Deep Marine Teal)
    const GOLD = [156, 122, 20];   // #9C7A14 (Muted Antique Gold)
    const BORDER = [195, 215, 219];
    const BG_LIGHT = [245, 249, 250];
    const TEXT_DK = [35, 45, 55];
    const TEXT_MUT = [95, 105, 115];
    const GREEN = [22, 101, 52];

    const pnr = (data.pnr || data.bookingNo || '64FFCC').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `738 ${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Vietnam Airlines', 'VN 126', 'Boeing 787-9');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '1PC (23kg)');
    const carryOnText = resolveCarryOnText(data, '7kg');

    // Top Teal Bar
    doc.setFillColor(...TEAL);
    doc.rect(marginL, 30, contentW, 3, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', marginL, 40, 140, 51);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...TEAL);
    doc.text('ELECTRONIC TICKET RECEIPT', marginR, 52, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(...GOLD);
    doc.text('VIETNAM AIRLINES - SKYTEAM MEMBER', marginR, 65, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Issuing Carrier: VIETNAM AIRLINES (VN - 738)', marginR, 77, { align: 'right' });

    let curY = 96;

    // Booking Details Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 60, 'FD');

    doc.line(marginL, curY + 20, marginR, curY + 20);
    doc.line(marginL, curY + 40, marginR, curY + 40);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEAL);
    doc.text('Passenger Name:', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(paxList[0].name), marginL + 110, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEAL);
    doc.text('Booking Ref (PNR):', marginL + 285, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...TEAL);
    doc.text(toSafeAscii(pnr), marginL + 380, curY + 13);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEAL);
    doc.text('Ticket Number:', marginL + 8, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(ticketNo), marginL + 110, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Date of Issue:', marginL + 285, curY + 33);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(issuedDate), marginL + 380, curY + 33);

    // Row 3
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Issuing Office:', marginL + 8, curY + 53);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('VIETNAM AIRLINES OFFICIAL', marginL + 110, curY + 53);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Booking Status:', marginL + 285, curY + 53);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('Confirmed / OK', marginL + 380, curY + 53);

    curY += 72;

    // Flight Details Title
    doc.setFillColor(...GOLD);
    doc.rect(marginL, curY, 3, 11, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEAL);
    doc.text('FLIGHT DETAILS & ITINERARY', marginL + 8, curY + 9);

    curY += 15;

    // Flight Table Header
    doc.setFillColor(...TEAL);
    doc.rect(marginL, curY, contentW, 18, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('FLIGHT', marginL + 8, curY + 12);
    doc.text('DEPARTURE', marginL + 72, curY + 12);
    doc.text('ARRIVAL', marginL + 164, curY + 12);
    doc.text('CLASS', marginL + 258, curY + 12);
    doc.text('SEAT', marginL + 350, curY + 12);
    doc.text('BAGGAGE', marginL + 390, curY + 12);
    doc.text('STATUS', marginL + 474, curY + 12);

    curY += 18;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 44;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEAL);
        doc.text(toSafeAscii(fl.flightNo), marginL + 8, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Vietnam Airlines', marginL + 8, curY + 24);
        doc.text(toSafeAscii(fl.aircraft || 'Boeing 787-9'), marginL + 8, curY + 34);

        // Departure Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${toSafeAscii(fl.depCity)} (${toSafeAscii(fl.fromCode)})`, marginL + 72, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.depDateFormatted || ''), marginL + 72, curY + 24);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEAL);
        doc.text(`${toSafeAscii(fl.depTime)}${fl.depTerminal ? `  T${toSafeAscii(fl.depTerminal)}` : ''}`, marginL + 72, curY + 34);

        // Arrival Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${toSafeAscii(fl.arrCity)} (${toSafeAscii(fl.toCode)})`, marginL + 164, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.arrDateFormatted || fl.depDateFormatted || ''), marginL + 164, curY + 24);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEAL);
        doc.text(`${toSafeAscii(fl.arrTime)}${fl.arrTerminal ? `  T${toSafeAscii(fl.arrTerminal)}` : ''}`, marginL + 164, curY + 34);

        // Class Column (Spacious 90pt width - never collides!)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(fl.flightClass || 'Economy (K)'), marginL + 258, curY + 15);

        if (fl.fareBasis) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(...TEXT_MUT);
            doc.text(`Fare: ${toSafeAscii(fl.fareBasis)}`, marginL + 258, curY + 26);
        }

        // Seat Column (CLEAN TEXT - NO BUTTON PILL)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEAL);
        doc.text(toSafeAscii(fl.seat), marginL + 368, curY + 21, { align: 'center' });

        // Baggage Column (COMPACT - NO OVERFLOW)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(checkedBag), marginL + 390, curY + 15);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(`Carry-on: ${carryOnText}`, marginL + 390, curY + 26);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...GREEN);
        doc.text('OK', marginL + 490, curY + 21, { align: 'center' });

        curY += rowH;
    });

    curY += 12;

    // Payment Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 36, 'FD');
    doc.line(marginL, curY + 18, marginR, curY + 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEAL);
    doc.text('Payment:', marginL + 8, curY + 12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('ELECTRONIC TICKET / PAID', marginL + 95, curY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Total Amount:', marginL + 300, curY + 12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('INCLUDED / PAID IN FULL', marginL + 380, curY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('Conditions:', marginL + 8, curY + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('NON-ENDORSABLE / REBOOKING APPLIES / LOTUSMILES ACCRUAL ELIGIBLE', marginL + 95, curY + 30);

    curY += 46;

    // Notice Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 52, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEAL);
    doc.text('IMPORTANT TRAVEL INFORMATION', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('- Online check-in is available 24 hours to 1 hour before scheduled flight at www.vietnamairlines.com.', marginL + 8, curY + 24);
    doc.text('- Check-in counters close 50 min before domestic flights and 60 min before international flights.', marginL + 8, curY + 34);
    doc.text(`- Free cabin baggage limit: 1 piece (max ${carryOnText}) + 1 small personal item.`, marginL + 8, curY + 44);

    curY += 66;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140, 149, 159);
    doc.text(toSafeAscii('Vietnam Airlines JSC - 200 Nguyen Son, Long Bien, Hanoi, Vietnam - www.vietnamairlines.com'), contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}

/* ========================================================================= */
/* 3. CATHAY PACIFIC (CX / 160) - HTML & PDF                                */
/* ========================================================================= */

export function renderCathayPacificTicketHtml(data) {
    const logoSrc = CATHAY_PACIFIC_LOGO_DATA_URL;
    const pnr = (data.pnr || data.bookingNo || '62M8HE').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `160-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Cathay Pacific', 'CX 714', 'Airbus A350-1000');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '2PC (23kg)');
    const carryOnText = resolveCarryOnText(data, '7kg');

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#222222; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.06); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Top Cathay Jade Line -->
        <div style="height:3px; background:#004C48; margin-bottom:18px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="Cathay Pacific" style="height:28px; max-width:240px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:19px; font-weight:700; color:#004C48; font-family:'Times New Roman', serif, Georgia; letter-spacing:0.5px;">eTicket Receipt</div>
                <div style="font-size:10px; color:#666666; letter-spacing:0.5px; margin-top:2px;">Cathay Pacific Airways (CX - 160) • oneworld</div>
                <div style="font-size:12px; font-weight:700; color:#004C48; margin-top:2px;">Booking Ref: ${escapeHtml(pnr)}</div>
            </div>
        </div>

        <!-- Passenger & Booking Summary Strip -->
        <table style="width:100%; border-collapse:collapse; background:#F7F9F8; border:1px solid #CDDAD8; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; width:18%; font-weight:700; color:#004C48;">Passenger Name</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; width:32%; font-weight:700; color:#222222; font-size:12px;">${escapeHtml(paxList[0].name)}</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; width:18%; font-weight:700; color:#004C48;">Booking Reference</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; width:32%; font-weight:800; color:#004C48; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; font-weight:700; color:#004C48;">Ticket Number</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; font-weight:700; color:#222222;">${escapeHtml(ticketNo)}</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; font-weight:700; color:#004C48;">Date of Issue</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; color:#222222;">${escapeHtml(issuedDate)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; font-weight:700; color:#004C48;">Issuing Office</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; color:#222222;">CATHAY PACIFIC E-TICKETING / AGENT</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; font-weight:700; color:#004C48;">Reservation Status</td>
                <td style="padding:7px 10px; border:1px solid #CDDAD8; font-weight:700; color:#166534;">Confirmed (OK)</td>
            </tr>
        </table>

        <!-- Section: Flight Itinerary -->
        <div style="font-size:11.5px; font-weight:800; color:#004C48; border-left:3px solid #004C48; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Sector / Flight Itinerary
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #CDDAD8;">
            <thead>
                <tr style="background:#004C48; color:#ffffff; text-align:left;">
                    <th style="padding:8px 10px; border:1px solid #004C48; font-weight:700; width:22%;">SECTOR</th>
                    <th style="padding:8px 10px; border:1px solid #004C48; font-weight:700; width:11%;">FLIGHT</th>
                    <th style="padding:8px 10px; border:1px solid #004C48; font-weight:700; width:13%;">DATE</th>
                    <th style="padding:8px 10px; border:1px solid #004C48; font-weight:700; width:14%;">DEP / ARR</th>
                    <th style="padding:8px 10px; border:1px solid #004C48; font-weight:700; width:13%;">CLASS</th>
                    <th style="padding:8px 10px; border:1px solid #004C48; font-weight:700; text-align:center; width:8%;">SEAT</th>
                    <th style="padding:8px 10px; border:1px solid #004C48; font-weight:700; width:11%;">BAGGAGE</th>
                    <th style="padding:8px 10px; border:1px solid #004C48; font-weight:700; text-align:center; width:8%;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#F7F9F8'};">
                    <td style="padding:8px 10px; border:1px solid #CDDAD8; vertical-align:top;">
                        <div style="font-weight:700; color:#004C48; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                        <div style="font-weight:700; color:#004C48; font-size:11.5px; margin-top:2px;">&rarr; ${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:9.5px; color:#666666; margin-top:3px;">${escapeHtml(fl.aircraft || 'Airbus A350-1000')}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #CDDAD8; vertical-align:top;">
                        <div style="font-weight:800; color:#004C48; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#666666; margin-top:2px;">Cathay Pacific</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #CDDAD8; vertical-align:top;">
                        <div style="font-weight:700; color:#222222;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-size:9.5px; color:#666666; margin-top:2px;">${escapeHtml(fl.duration || 'Non-Stop')}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #CDDAD8; vertical-align:top;">
                        <div style="font-weight:700; color:#004C48; font-size:11.5px;">${escapeHtml(fl.depTime)} - ${escapeHtml(fl.arrTime)}</div>
                        ${(fl.depTerminal || fl.arrTerminal) ? `<div style="font-size:9.5px; color:#666666; margin-top:2px;">T${escapeHtml(fl.depTerminal || '-')} &rarr; T${escapeHtml(fl.arrTerminal || '-')}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #CDDAD8; vertical-align:top;">
                        <div style="font-weight:700; color:#222222;">${escapeHtml(fl.flightClass || 'Economy (K)')}</div>
                        ${fl.fareBasis ? `<div style="font-size:9.5px; color:#666666; margin-top:2px;">Fare: ${escapeHtml(fl.fareBasis)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #CDDAD8; vertical-align:top; text-align:center;">
                        <span style="font-weight:700; color:#004C48; font-size:11px;">${escapeHtml(fl.seat)}</span>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #CDDAD8; vertical-align:top;">
                        <div style="font-weight:700; color:#222222;">${escapeHtml(checkedBag)}</div>
                        <div style="font-size:9.5px; color:#666666;">Cabin: ${escapeHtml(carryOnText)}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #CDDAD8; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#166534;">OK</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Baggage Policy Box -->
        <table style="width:100%; border-collapse:collapse; background:#F7F9F8; border:1px solid #CDDAD8; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #CDDAD8; width:22%; font-weight:700; color:#004C48;">Checked Baggage</td>
                <td style="padding:6px 10px; border:1px solid #CDDAD8; width:28%; color:#222222;">${escapeHtml(checkedBag)}</td>
                <td style="padding:6px 10px; border:1px solid #CDDAD8; width:22%; font-weight:700; color:#004C48;">Cabin Baggage</td>
                <td style="padding:6px 10px; border:1px solid #CDDAD8; width:28%; color:#222222;">1 piece up to ${escapeHtml(carryOnText)} + 1 small item</td>
            </tr>
            <tr>
                <td style="padding:6px 10px; border:1px solid #CDDAD8; font-weight:700; color:#004C48;">Form of Payment</td>
                <td style="padding:6px 10px; border:1px solid #CDDAD8; color:#222222;">ELECTRONIC TICKET / PAID</td>
                <td style="padding:6px 10px; border:1px solid #CDDAD8; font-weight:700; color:#004C48;">Endorsements</td>
                <td style="padding:6px 10px; border:1px solid #CDDAD8; color:#666666; font-size:10px;">NON-END / REBOOKING FEE APPLIES</td>
            </tr>
        </table>

        <!-- Travel Reminders Notice -->
        <div style="background:#F7F9F8; border:1px solid #CDDAD8; border-radius:6px; padding:10px 14px; font-size:10px; color:#555555; line-height:1.5;">
            <div style="font-weight:800; color:#004C48; margin-bottom:3px; text-transform:uppercase;">Cathay Pacific Travel Reminders</div>
            <div>- Manage Booking & Online Check-in: Available 48 hours up to 90 minutes prior to departure at cathaypacific.com.</div>
            <div>- Airport Bag Drop: Counters close 75 minutes prior to departure. Boarding gates close 20 minutes before departure.</div>
            <div>- Travel Documents: Passengers are responsible for ensuring their passports and entry visas meet requirements.</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            Cathay Pacific Airways Limited • Cathay City, Hong Kong International Airport • www.cathaypacific.com
        </div>

    </div>
    `;
}

export async function generateCathayPacificPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = CATHAY_PACIFIC_LOGO_DATA_URL;
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const JADE = [0, 76, 72];       // #004C48 (Muted Cathay Jade)
    const BORDER = [205, 218, 216];
    const BG_LIGHT = [247, 249, 248];
    const TEXT_DK = [34, 34, 34];
    const TEXT_MUT = [90, 90, 90];
    const GREEN = [22, 101, 52];

    const pnr = (data.pnr || data.bookingNo || '62M8HE').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `160-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Cathay Pacific', 'CX 714', 'Airbus A350-1000');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '2PC (23kg)');
    const carryOnText = resolveCarryOnText(data, '7kg');

    // Top Jade Line
    doc.setFillColor(...JADE);
    doc.rect(marginL, 30, contentW, 3, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', marginL, 46, 170, 24);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('times', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...JADE);
    doc.text('eTicket Receipt', marginR, 52, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text('Cathay Pacific Airways (CX - 160) - oneworld', marginR, 65, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...JADE);
    doc.text(`Booking Ref: ${pnr}`, marginR, 77, { align: 'right' });

    let curY = 94;

    // Passenger & Booking Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 60, 'FD');

    doc.line(marginL, curY + 20, marginR, curY + 20);
    doc.line(marginL, curY + 40, marginR, curY + 40);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...JADE);
    doc.text('Passenger Name:', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(paxList[0].name), marginL + 110, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...JADE);
    doc.text('Booking Reference:', marginL + 285, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...JADE);
    doc.text(toSafeAscii(pnr), marginL + 380, curY + 13);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...JADE);
    doc.text('Ticket Number:', marginL + 8, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(ticketNo), marginL + 110, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Date of Issue:', marginL + 285, curY + 33);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(issuedDate), marginL + 380, curY + 33);

    // Row 3
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Issuing Office:', marginL + 8, curY + 53);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('CATHAY PACIFIC E-TICKETING / AGENT', marginL + 110, curY + 53);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Reservation Status:', marginL + 285, curY + 53);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('Confirmed (OK)', marginL + 380, curY + 53);

    curY += 72;

    // Flight Details Title
    doc.setFillColor(...JADE);
    doc.rect(marginL, curY, 3, 11, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...JADE);
    doc.text('SECTOR / FLIGHT ITINERARY', marginL + 8, curY + 9);

    curY += 15;

    // Flight Table Header
    doc.setFillColor(...JADE);
    doc.rect(marginL, curY, contentW, 18, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('SECTOR', marginL + 8, curY + 12);
    doc.text('FLIGHT', marginL + 120, curY + 12);
    doc.text('DATE', marginL + 174, curY + 12);
    doc.text('DEP / ARR', marginL + 238, curY + 12);
    doc.text('CLASS', marginL + 310, curY + 12);
    doc.text('SEAT', marginL + 376, curY + 12);
    doc.text('BAGGAGE', marginL + 414, curY + 12);
    doc.text('STATUS', marginL + 476, curY + 12);

    curY += 18;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 44;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Sector Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...JADE);
        doc.text(`${toSafeAscii(fl.depCity)} (${toSafeAscii(fl.fromCode)})`, marginL + 8, curY + 13);
        doc.text(`-> ${toSafeAscii(fl.arrCity)} (${toSafeAscii(fl.toCode)})`, marginL + 8, curY + 23);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.aircraft || 'Airbus A350-1000'), marginL + 8, curY + 34);

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...JADE);
        doc.text(toSafeAscii(fl.flightNo), marginL + 120, curY + 15);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Cathay Pacific', marginL + 120, curY + 26);

        // Date Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(fl.depDateFormatted || ''), marginL + 174, curY + 15);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.duration || 'Non-Stop'), marginL + 174, curY + 26);

        // Dep / Arr Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...JADE);
        doc.text(`${toSafeAscii(fl.depTime)} - ${toSafeAscii(fl.arrTime)}`, marginL + 238, curY + 16);

        const termStr = (fl.depTerminal || fl.arrTerminal) ? `T${toSafeAscii(fl.depTerminal || '-')} -> T${toSafeAscii(fl.arrTerminal || '-')}` : '';
        if (termStr) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...TEXT_MUT);
            doc.text(termStr, marginL + 238, curY + 27);
        }

        // Class Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(fl.flightClass || 'Economy (K)'), marginL + 310, curY + 15);

        if (fl.fareBasis) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(...TEXT_MUT);
            doc.text(`Fare: ${toSafeAscii(fl.fareBasis)}`, marginL + 310, curY + 26);
        }

        // Seat Column (CLEAN TEXT - NO BUTTON PILL)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...JADE);
        doc.text(toSafeAscii(fl.seat), marginL + 394, curY + 21, { align: 'center' });

        // Baggage Column (COMPACT - NO OVERFLOW)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(checkedBag), marginL + 414, curY + 15);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(`Cabin: ${carryOnText}`, marginL + 414, curY + 26);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...GREEN);
        doc.text('OK', marginL + 494, curY + 21, { align: 'center' });

        curY += rowH;
    });

    curY += 12;

    // Baggage Policy Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 36, 'FD');
    doc.line(marginL, curY + 18, marginR, curY + 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...JADE);
    doc.text('Checked Baggage:', marginL + 8, curY + 12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(checkedBag), marginL + 95, curY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Cabin Baggage:', marginL + 285, curY + 12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(`1 piece up to ${carryOnText} + 1 small item`, marginL + 365, curY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Form of Payment:', marginL + 8, curY + 30);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('ELECTRONIC TICKET / PAID', marginL + 95, curY + 30);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...JADE);
    doc.text('Endorsements:', marginL + 285, curY + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('NON-END / REBOOKING FEE APPLIES', marginL + 365, curY + 30);

    curY += 46;

    // Reminders Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 52, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...JADE);
    doc.text('CATHAY PACIFIC TRAVEL REMINDERS', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('- Online Check-in is available 48 hours up to 90 minutes prior to departure at cathaypacific.com.', marginL + 8, curY + 24);
    doc.text('- Bag drop counters close 75 minutes prior to departure. Boarding gates close 20 minutes before departure.', marginL + 8, curY + 34);
    doc.text('- Passengers must hold a valid passport with at least 6 months validity and required destination visas.', marginL + 8, curY + 44);

    curY += 66;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140, 149, 159);
    doc.text(toSafeAscii('Cathay Pacific Airways Limited - Cathay City, Hong Kong International Airport - www.cathaypacific.com'), contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}

/* ========================================================================= */
/* 4. HONG KONG AIRLINES (HX / 851) - HTML & PDF                            */
/* ========================================================================= */

export function renderHongKongAirlinesTicketHtml(data) {
    const logoSrc = HONG_KONG_AIRLINES_LOGO_DATA_URL;
    const pnr = (data.pnr || data.bookingNo || 'HX7291').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `851-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Hong Kong Airlines', 'HX 264', 'Airbus A330-300');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '20 kg');
    const carryOnText = resolveCarryOnText(data, '7kg');

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#2D3748; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.06); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Top Deep Burgundy Accent Line -->
        <div style="height:3px; background:#8A1525; margin-bottom:18px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="Hong Kong Airlines" style="height:50px; max-width:200px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:17px; font-weight:800; color:#8A1525; letter-spacing:0.5px; text-transform:uppercase;">Electronic Ticket Receipt</div>
                <div style="font-size:11px; font-weight:700; color:#2D3748; letter-spacing:0.5px; margin-top:2px;">HONG KONG AIRLINES (HX - 851)</div>
                <div style="font-size:10px; color:#646E7D; margin-top:2px;">Booking Reference: ${escapeHtml(pnr)}</div>
            </div>
        </div>

        <!-- Booking Overview Table -->
        <table style="width:100%; border-collapse:collapse; background:#FCF8F8; border:1px solid #E2DADB; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #E2DADB; width:18%; font-weight:700; color:#8A1525;">Passenger Name</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; width:32%; font-weight:700; color:#2D3748; font-size:12px;">${escapeHtml(paxList[0].name)}</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; width:18%; font-weight:700; color:#8A1525;">Booking Ref (PNR)</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; width:32%; font-weight:800; color:#8A1525; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #E2DADB; font-weight:700; color:#8A1525;">E-Ticket Number</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; font-weight:700; color:#2D3748;">${escapeHtml(ticketNo)}</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; font-weight:700; color:#8A1525;">Date of Issue</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; color:#2D3748;">${escapeHtml(issuedDate)}</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #E2DADB; font-weight:700; color:#8A1525;">Issuing Carrier</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; color:#2D3748;">HONG KONG AIRLINES (HX)</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; font-weight:700; color:#8A1525;">Booking Status</td>
                <td style="padding:7px 10px; border:1px solid #E2DADB; font-weight:700; color:#166534;">Confirmed (OK)</td>
            </tr>
        </table>

        <!-- Section Title -->
        <div style="font-size:11.5px; font-weight:800; color:#8A1525; border-left:3px solid #8A1525; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Itinerary / Flight Details
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #E2DADB;">
            <thead>
                <tr style="background:#8A1525; color:#ffffff; text-align:left;">
                    <th style="padding:8px 10px; border:1px solid #8A1525; font-weight:700; width:13%;">FLIGHT</th>
                    <th style="padding:8px 10px; border:1px solid #8A1525; font-weight:700; width:18%;">DEPARTURE</th>
                    <th style="padding:8px 10px; border:1px solid #8A1525; font-weight:700; width:18%;">ARRIVAL</th>
                    <th style="padding:8px 10px; border:1px solid #8A1525; font-weight:700; width:18%;">CLASS</th>
                    <th style="padding:8px 10px; border:1px solid #8A1525; font-weight:700; text-align:center; width:8%;">SEAT</th>
                    <th style="padding:8px 10px; border:1px solid #8A1525; font-weight:700; width:15%;">BAGGAGE</th>
                    <th style="padding:8px 10px; border:1px solid #8A1525; font-weight:700; text-align:center; width:10%;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#FCF8F8'};">
                    <td style="padding:8px 10px; border:1px solid #E2DADB; vertical-align:top;">
                        <div style="font-weight:800; color:#8A1525; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#646E7D; margin-top:2px;">Hong Kong Airlines</div>
                        <div style="font-size:9.5px; color:#646E7D;">${escapeHtml(fl.aircraft || 'Airbus A330-300')}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #E2DADB; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                        <div style="font-size:10px; color:#646E7D; margin-top:2px;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#8A1525; font-size:12px;">${escapeHtml(fl.depTime)}</div>
                        ${fl.depTerminal ? `<div style="font-size:9.5px; color:#646E7D;">T${escapeHtml(fl.depTerminal)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #E2DADB; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748; font-size:11.5px;">${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:10px; color:#646E7D; margin-top:2px;">${escapeHtml(fl.arrDateFormatted || fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#8A1525; font-size:12px;">${escapeHtml(fl.arrTime)}</div>
                        ${fl.arrTerminal ? `<div style="font-size:9.5px; color:#646E7D;">T${escapeHtml(fl.arrTerminal)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #E2DADB; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748;">${escapeHtml(fl.flightClass || 'Economy (E)')}</div>
                        ${fl.fareBasis ? `<div style="font-size:9.5px; color:#646E7D; margin-top:2px;">Fare: ${escapeHtml(fl.fareBasis)}</div>` : ''}
                    </td>
                    <td style="padding:8px 10px; border:1px solid #E2DADB; vertical-align:top; text-align:center;">
                        <span style="font-weight:700; color:#8A1525; font-size:11px;">${escapeHtml(fl.seat)}</span>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #E2DADB; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748;">${escapeHtml(checkedBag)}</div>
                        <div style="font-size:9.5px; color:#646E7D;">Carry-on: ${escapeHtml(carryOnText)}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #E2DADB; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#166534;">OK</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Fare Breakdown Box -->
        <table style="width:100%; border-collapse:collapse; background:#FCF8F8; border:1px solid #E2DADB; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #E2DADB; width:22%; font-weight:700; color:#8A1525;">Form of Payment</td>
                <td style="padding:6px 10px; border:1px solid #E2DADB; width:28%; color:#2D3748;">ELECTRONIC TICKET / CREDIT CARD</td>
                <td style="padding:6px 10px; border:1px solid #E2DADB; width:22%; font-weight:700; color:#8A1525;">Total Amount</td>
                <td style="padding:6px 10px; border:1px solid #E2DADB; width:28%; font-weight:800; color:#8A1525;">PAID / INVOICED</td>
            </tr>
            <tr>
                <td style="padding:6px 10px; border:1px solid #E2DADB; font-weight:700; color:#8A1525;">Endorsements</td>
                <td colspan="3" style="padding:6px 10px; border:1px solid #E2DADB; color:#646E7D; font-size:10px;">
                    NON-ENDORSABLE / REBOOKING RESTRICTIONS APPLY / HONG KONG AIRLINES
                </td>
            </tr>
        </table>

        <!-- Notice Box -->
        <div style="background:#FCF8F8; border:1px solid #E2DADB; border-radius:6px; padding:10px 14px; font-size:10px; color:#646E7D; line-height:1.5;">
            <div style="font-weight:800; color:#8A1525; margin-bottom:3px; text-transform:uppercase;">Important Notices & Reminders</div>
            <div>- Check-in counters close 60 minutes before departure. Boarding gate closes strictly 20 minutes before departure.</div>
            <div>- Free checked baggage allowance: 20kg (1 piece). Maximum dimensions: 158cm (L+W+H). Carry-on baggage: 7kg.</div>
            <div>- Passengers must ensure passports possess at least 6 months validity from date of travel.</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            Hong Kong Airlines Limited • 11/F, One Citygate, Tung Chung, Lantau, Hong Kong • www.hongkongairlines.com
        </div>

    </div>
    `;
}

export async function generateHongKongAirlinesPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = HONG_KONG_AIRLINES_LOGO_DATA_URL;
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const BURGUNDY = [138, 21, 37]; // #8A1525 (Muted Deep Burgundy)
    const BORDER = [226, 218, 219];
    const BG_LIGHT = [252, 248, 248];
    const TEXT_DK = [45, 55, 72];
    const TEXT_MUT = [100, 110, 125];
    const GREEN = [22, 101, 52];

    const pnr = (data.pnr || data.bookingNo || 'HX7291').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `851-${Math.floor(2000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'Hong Kong Airlines', 'HX 264', 'Airbus A330-300');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '20 kg');
    const carryOnText = resolveCarryOnText(data, '7kg');

    // Top Burgundy Line
    doc.setFillColor(...BURGUNDY);
    doc.rect(marginL, 30, contentW, 3, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', marginL, 38, 75, 54);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...BURGUNDY);
    doc.text('ELECTRONIC TICKET RECEIPT', marginR, 52, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DK);
    doc.text('HONG KONG AIRLINES (HX - 851)', marginR, 65, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text(`Booking Reference: ${pnr}`, marginR, 77, { align: 'right' });

    let curY = 96;

    // Booking Details Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 60, 'FD');

    doc.line(marginL, curY + 20, marginR, curY + 20);
    doc.line(marginL, curY + 40, marginR, curY + 40);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BURGUNDY);
    doc.text('Passenger Name:', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(paxList[0].name), marginL + 110, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BURGUNDY);
    doc.text('Booking Ref (PNR):', marginL + 285, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...BURGUNDY);
    doc.text(toSafeAscii(pnr), marginL + 380, curY + 13);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BURGUNDY);
    doc.text('E-Ticket Number:', marginL + 8, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(ticketNo), marginL + 110, curY + 33);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BURGUNDY);
    doc.text('Date of Issue:', marginL + 285, curY + 33);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(issuedDate), marginL + 380, curY + 33);

    // Row 3
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BURGUNDY);
    doc.text('Issuing Carrier:', marginL + 8, curY + 53);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('HONG KONG AIRLINES (HX)', marginL + 110, curY + 53);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BURGUNDY);
    doc.text('Booking Status:', marginL + 285, curY + 53);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('Confirmed (OK)', marginL + 380, curY + 53);

    curY += 72;

    // Flight Details Title
    doc.setFillColor(...BURGUNDY);
    doc.rect(marginL, curY, 3, 11, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...BURGUNDY);
    doc.text('ITINERARY / FLIGHT DETAILS', marginL + 8, curY + 9);

    curY += 15;

    // Flight Table Header
    doc.setFillColor(...BURGUNDY);
    doc.rect(marginL, curY, contentW, 18, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('FLIGHT', marginL + 8, curY + 12);
    doc.text('DEPARTURE', marginL + 72, curY + 12);
    doc.text('ARRIVAL', marginL + 164, curY + 12);
    doc.text('CLASS', marginL + 258, curY + 12);
    doc.text('SEAT', marginL + 350, curY + 12);
    doc.text('BAGGAGE', marginL + 390, curY + 12);
    doc.text('STATUS', marginL + 474, curY + 12);

    curY += 18;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 44;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...BURGUNDY);
        doc.text(toSafeAscii(fl.flightNo), marginL + 8, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text('Hong Kong Airlines', marginL + 8, curY + 24);
        doc.text(toSafeAscii(fl.aircraft || 'Airbus A330'), marginL + 8, curY + 34);

        // Departure Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${toSafeAscii(fl.depCity)} (${toSafeAscii(fl.fromCode)})`, marginL + 72, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.depDateFormatted || ''), marginL + 72, curY + 24);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...BURGUNDY);
        doc.text(`${toSafeAscii(fl.depTime)}${fl.depTerminal ? `  T${toSafeAscii(fl.depTerminal)}` : ''}`, marginL + 72, curY + 34);

        // Arrival Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${toSafeAscii(fl.arrCity)} (${toSafeAscii(fl.toCode)})`, marginL + 164, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.arrDateFormatted || fl.depDateFormatted || ''), marginL + 164, curY + 24);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...BURGUNDY);
        doc.text(`${toSafeAscii(fl.arrTime)}${fl.arrTerminal ? `  T${toSafeAscii(fl.arrTerminal)}` : ''}`, marginL + 164, curY + 34);

        // Class Column (Spacious 90pt width - never collides!)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(fl.flightClass || 'Economy (E)'), marginL + 258, curY + 15);

        if (fl.fareBasis) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(...TEXT_MUT);
            doc.text(`Fare: ${toSafeAscii(fl.fareBasis)}`, marginL + 258, curY + 26);
        }

        // Seat Column (CLEAN TEXT - NO BUTTON PILL)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...BURGUNDY);
        doc.text(toSafeAscii(fl.seat), marginL + 368, curY + 21, { align: 'center' });

        // Baggage Column (COMPACT - NO OVERFLOW)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(checkedBag), marginL + 390, curY + 15);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(`Carry-on: ${toSafeAscii(carryOnText)}`, marginL + 390, curY + 26);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...GREEN);
        doc.text('OK', marginL + 490, curY + 21, { align: 'center' });

        curY += rowH;
    });

    curY += 12;

    // Payment Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 36, 'FD');
    doc.line(marginL, curY + 18, marginR, curY + 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...BURGUNDY);
    doc.text('Form of Payment:', marginL + 8, curY + 12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text('ELECTRONIC TICKET / CREDIT CARD', marginL + 95, curY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BURGUNDY);
    doc.text('Total Amount:', marginL + 300, curY + 12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BURGUNDY);
    doc.text('PAID / INVOICED', marginL + 380, curY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BURGUNDY);
    doc.text('Endorsements:', marginL + 8, curY + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('NON-ENDORSABLE / REBOOKING RESTRICTIONS APPLY / HONG KONG AIRLINES', marginL + 95, curY + 30);

    curY += 46;

    // Notice Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 52, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...BURGUNDY);
    doc.text('IMPORTANT NOTICES & TRAVEL REMINDERS', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('- Check-in counters close 60 minutes prior to departure. Boarding gate closes strictly 20 minutes before departure.', marginL + 8, curY + 24);
    doc.text(`- Free checked baggage allowance: 20kg (1 piece). Maximum dimensions: 158cm (L+W+H). Carry-on baggage: ${toSafeAscii(carryOnText)}.`, marginL + 8, curY + 34);
    doc.text('- Passengers must hold a valid passport with at least 6 months validity from date of travel.', marginL + 8, curY + 44);

    curY += 66;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140, 149, 159);
    doc.text(toSafeAscii('Hong Kong Airlines Limited - Tung Chung, Lantau, Hong Kong - www.hongkongairlines.com'), contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}

/* ========================================================================= */
/* 5. HK EXPRESS (UO) - HTML & PDF                                          */
/* ========================================================================= */

export function renderHkExpressTicketHtml(data) {
    const logoSrc = HK_EXPRESS_LOGO_DATA_URL;
    const pnr = (data.pnr || data.bookingNo || 'UO8812').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `016${Math.floor(1000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'HK Express', 'UO 614', 'Airbus A321neo');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '20 kg');
    const carryOnText = resolveCarryOnText(data, '7kg');

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#2D3748; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:32px 38px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.06); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.4; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Top Corporate Slate Plum Bar -->
        <div style="height:3px; background:#381E54; margin-bottom:18px;"></div>

        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
            <div>
                <img src="${logoSrc}" alt="HK Express" style="height:38px; max-width:200px; object-fit:contain; display:block;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:17px; font-weight:800; color:#381E54; letter-spacing:0.5px; text-transform:uppercase;">Booking Itinerary & E-Receipt</div>
                <div style="font-size:11px; font-weight:700; color:#2A4365; letter-spacing:0.5px; margin-top:2px;">HK EXPRESS (UO) • A CATHAY COMPANY</div>
                <div style="font-size:10px; color:#646E7D; margin-top:2px;">Booking Reference: ${escapeHtml(pnr)}</div>
            </div>
        </div>

        <!-- Booking Overview Table -->
        <table style="width:100%; border-collapse:collapse; background:#F8F9FB; border:1px solid #DAE1E9; font-size:11px; margin-bottom:20px;">
            <tr>
                <td style="padding:7px 10px; border:1px solid #DAE1E9; width:22%; font-weight:700; color:#381E54;">Booking Reference (PNR)</td>
                <td style="padding:7px 10px; border:1px solid #DAE1E9; width:28%; font-weight:800; color:#381E54; font-size:13px; letter-spacing:0.5px;">${escapeHtml(pnr)}</td>
                <td style="padding:7px 10px; border:1px solid #DAE1E9; width:20%; font-weight:700; color:#381E54;">Status</td>
                <td style="padding:7px 10px; border:1px solid #DAE1E9; width:30%; font-weight:700; color:#166534;">CONFIRMED / PAID</td>
            </tr>
            <tr>
                <td style="padding:7px 10px; border:1px solid #DAE1E9; font-weight:700; color:#381E54;">Booking Date</td>
                <td style="padding:7px 10px; border:1px solid #DAE1E9; color:#2D3748;">${escapeHtml(issuedDate)}</td>
                <td style="padding:7px 10px; border:1px solid #DAE1E9; font-weight:700; color:#381E54;">Ticket / Order</td>
                <td style="padding:7px 10px; border:1px solid #DAE1E9; font-weight:700; color:#2D3748;">${escapeHtml(ticketNo)}</td>
            </tr>
        </table>

        <!-- Guest Details Table (CLEAN - NO BUTTON PILLS) -->
        <div style="font-size:11.5px; font-weight:800; color:#381E54; border-left:3px solid #2A4365; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Guest & Baggage Details
        </div>
        <table style="width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #DAE1E9; font-size:11px; margin-bottom:20px;">
            <thead>
                <tr style="background:#F0F2F6; color:#381E54; text-align:left;">
                    <th style="padding:7px 10px; border:1px solid #DAE1E9; font-weight:700; width:40%;">GUEST NAME</th>
                    <th style="padding:7px 10px; border:1px solid #DAE1E9; font-weight:700; width:20%; text-align:center;">SEAT</th>
                    <th style="padding:7px 10px; border:1px solid #DAE1E9; font-weight:700; width:20%;">CHECKED BAGGAGE</th>
                    <th style="padding:7px 10px; border:1px solid #DAE1E9; font-weight:700; width:20%;">CABIN BAGGAGE</th>
                </tr>
            </thead>
            <tbody>
                ${paxList.map(p => `
                <tr>
                    <td style="padding:7px 10px; border:1px solid #DAE1E9; font-weight:700; color:#2D3748;">${escapeHtml(p.name)}</td>
                    <td style="padding:7px 10px; border:1px solid #DAE1E9; text-align:center; font-weight:700; color:#381E54;">${escapeHtml(p.seat)}</td>
                    <td style="padding:7px 10px; border:1px solid #DAE1E9; color:#2D3748; font-weight:600;">${escapeHtml(checkedBag)}</td>
                    <td style="padding:7px 10px; border:1px solid #DAE1E9; color:#646E7D;">${escapeHtml(carryOnText)} carry-on</td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Section: Flights -->
        <div style="font-size:11.5px; font-weight:800; color:#381E54; border-left:3px solid #381E54; padding-left:8px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Flight Details
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border:1px solid #DAE1E9;">
            <thead>
                <tr style="background:#381E54; color:#ffffff; text-align:left;">
                    <th style="padding:8px 10px; border:1px solid #381E54; font-weight:700;">FLIGHT</th>
                    <th style="padding:8px 10px; border:1px solid #381E54; font-weight:700;">DEPARTURE</th>
                    <th style="padding:8px 10px; border:1px solid #381E54; font-weight:700;">ARRIVAL</th>
                    <th style="padding:8px 10px; border:1px solid #381E54; font-weight:700;">AIRCRAFT</th>
                    <th style="padding:8px 10px; border:1px solid #381E54; font-weight:700;">CLASS</th>
                    <th style="padding:8px 10px; border:1px solid #381E54; font-weight:700; text-align:center;">STATUS</th>
                </tr>
            </thead>
            <tbody>
                ${flights.map((fl, idx) => `
                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#F8F9FB'};">
                    <td style="padding:8px 10px; border:1px solid #DAE1E9; vertical-align:top;">
                        <div style="font-weight:800; color:#381E54; font-size:12px;">${escapeHtml(fl.flightNo)}</div>
                        <div style="font-size:9.5px; color:#646E7D; margin-top:2px;">HK Express</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE1E9; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748; font-size:11.5px;">${escapeHtml(fl.depCity)} (${escapeHtml(fl.fromCode)})</div>
                        <div style="font-size:10px; color:#646E7D; margin-top:2px;">${escapeHtml(fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#381E54; font-size:12px;">${escapeHtml(fl.depTime)}</div>
                        <div style="font-size:9.5px; color:#646E7D;">${escapeHtml(fl.depTerminal)}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE1E9; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748; font-size:11.5px;">${escapeHtml(fl.arrCity)} (${escapeHtml(fl.toCode)})</div>
                        <div style="font-size:10px; color:#646E7D; margin-top:2px;">${escapeHtml(fl.arrDateFormatted || fl.depDateFormatted)}</div>
                        <div style="font-weight:700; color:#381E54; font-size:12px;">${escapeHtml(fl.arrTime)}</div>
                        <div style="font-size:9.5px; color:#646E7D;">${escapeHtml(fl.arrTerminal)}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE1E9; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748;">${escapeHtml(fl.aircraft || 'Airbus A321neo')}</div>
                        <div style="font-size:9.5px; color:#646E7D; margin-top:2px;">${escapeHtml(fl.duration || 'Non-Stop')}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE1E9; vertical-align:top;">
                        <div style="font-weight:700; color:#2D3748;">${escapeHtml(fl.flightClass || 'Economy (Fun)')}</div>
                    </td>
                    <td style="padding:8px 10px; border:1px solid #DAE1E9; vertical-align:top; text-align:center;">
                        <span style="font-weight:800; color:#166534;">CONFIRMED</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Payment Breakdown Box -->
        <table style="width:100%; border-collapse:collapse; background:#F8F9FB; border:1px solid #DAE1E9; font-size:10.5px; margin-bottom:18px;">
            <tr>
                <td style="padding:6px 10px; border:1px solid #DAE1E9; width:25%; font-weight:700; color:#381E54;">Payment Status</td>
                <td style="padding:6px 10px; border:1px solid #DAE1E9; width:25%; font-weight:700; color:#166534;">COMPLETED / PAID</td>
                <td style="padding:6px 10px; border:1px solid #DAE1E9; width:25%; font-weight:700; color:#381E54;">Total Amount</td>
                <td style="padding:6px 10px; border:1px solid #DAE1E9; width:25%; font-weight:800; color:#381E54;">PAID IN FULL</td>
            </tr>
        </table>

        <!-- Reminders Box -->
        <div style="background:#F8F9FB; border:1px solid #DAE1E9; border-radius:6px; padding:10px 14px; font-size:10px; color:#646E7D; line-height:1.5;">
            <div style="font-weight:800; color:#381E54; margin-bottom:3px; text-transform:uppercase;">HK Express Travel Reminders</div>
            <div>- Online Check-in opens 48 hours and closes 75 minutes before departure at hkexpress.com or mobile app.</div>
            <div>- Arrive at airport at least 2 to 3 hours prior to departure for check-in, document verification and security checks.</div>
            <div>- Strict cabin baggage limits apply: 1 carry-on bag (up to ${escapeHtml(carryOnText)}, 56x36x23cm) + 1 small personal item.</div>
        </div>

        <div style="text-align:center; font-size:9.5px; color:#8C959F; margin-top:14px;">
            Hong Kong Express Airways Limited • Hong Kong International Airport • www.hkexpress.com
        </div>

    </div>
    `;
}

export async function generateHkExpressPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = HK_EXPRESS_LOGO_DATA_URL;
    const marginL = 40;
    const marginR = 555;
    const contentW = marginR - marginL; // 515 pt

    const PLUM = [56, 30, 84];      // #381E54 (Corporate Slate Plum)
    const SLATE = [42, 67, 101];    // #2A4365 (Deep Slate Blue)
    const BORDER = [218, 225, 233];
    const BG_LIGHT = [248, 249, 251];
    const TEXT_DK = [45, 55, 72];
    const TEXT_MUT = [100, 110, 125];
    const GREEN = [22, 101, 52];

    const pnr = (data.pnr || data.bookingNo || 'UO8812').trim().toUpperCase();
    const ticketNo = data.ticketNo || data.eTicketNo || `016${Math.floor(1000000000 + Math.random() * 900000000)}`;
    const issuedDate = data.issuedDate || '21 Oct 2026';
    const paxList = preparePaxList(data);
    const flights = prepareFlightList(data, 'HK Express', 'UO 614', 'Airbus A321neo');
    const checkedBag = formatCompactBaggage(data.checkedBaggage, '20 kg');
    const carryOnText = resolveCarryOnText(data, '7kg');

    // Top Stripe
    doc.setFillColor(...PLUM);
    doc.rect(marginL, 30, contentW, 3, 'F');

    // Header Logo & Titles
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', marginL, 42, 155, 41);
        } catch (e) {
            console.warn('Logo error:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...PLUM);
    doc.text('BOOKING ITINERARY & E-RECEIPT', marginR, 52, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(...SLATE);
    doc.text('HK EXPRESS (UO) - A CATHAY COMPANY', marginR, 65, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUT);
    doc.text(`Booking Reference: ${pnr}`, marginR, 77, { align: 'right' });

    let curY = 94;

    // Booking Overview Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.8);
    doc.rect(marginL, curY, contentW, 40, 'FD');
    doc.line(marginL, curY + 20, marginR, curY + 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PLUM);
    doc.text('Booking Reference (PNR):', marginL + 8, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...PLUM);
    doc.text(toSafeAscii(pnr), marginL + 125, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PLUM);
    doc.text('Status:', marginL + 300, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('CONFIRMED / PAID', marginL + 345, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Booking Date:', marginL + 8, curY + 31);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(issuedDate), marginL + 95, curY + 31);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_MUT);
    doc.text('Ticket / Order:', marginL + 300, curY + 31);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_DK);
    doc.text(toSafeAscii(ticketNo), marginL + 375, curY + 31);

    curY += 50;

    // Guest Details Section (CLEAN TEXT - NO BUTTON PILLS)
    doc.setFillColor(...SLATE);
    doc.rect(marginL, curY, 3, 11, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...PLUM);
    doc.text('GUEST & BAGGAGE DETAILS', marginL + 8, curY + 9);

    curY += 15;

    // Guest Details Header
    doc.setFillColor(240, 242, 246);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 16, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...PLUM);
    doc.text('GUEST NAME', marginL + 8, curY + 11);
    doc.text('SEAT', marginL + 220, curY + 11, { align: 'center' });
    doc.text('CHECKED BAGGAGE', marginL + 310, curY + 11);
    doc.text('CABIN BAGGAGE', marginL + 430, curY + 11);

    curY += 16;

    paxList.forEach((p, idx) => {
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, 20, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${idx + 1}. ${toSafeAscii(p.name)}`, marginL + 8, curY + 13);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...PLUM);
        doc.text(toSafeAscii(p.seat), marginL + 220, curY + 13, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(checkedBag), marginL + 310, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...TEXT_MUT);
        doc.text(`${toSafeAscii(carryOnText)} carry-on`, marginL + 430, curY + 13);

        curY += 20;
    });

    curY += 12;

    // Flight Details Section
    doc.setFillColor(...PLUM);
    doc.rect(marginL, curY, 3, 11, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...PLUM);
    doc.text('FLIGHT DETAILS', marginL + 8, curY + 9);

    curY += 15;

    // Flight Table Header
    doc.setFillColor(...PLUM);
    doc.rect(marginL, curY, contentW, 18, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('FLIGHT', marginL + 8, curY + 12);
    doc.text('DEPARTURE', marginL + 75, curY + 12);
    doc.text('ARRIVAL', marginL + 185, curY + 12);
    doc.text('AIRCRAFT', marginL + 295, curY + 12);
    doc.text('CLASS', marginL + 390, curY + 12);
    doc.text('STATUS', marginL + 475, curY + 12);

    curY += 18;

    // Flight Rows
    flights.forEach((fl, idx) => {
        const rowH = 44;
        doc.setFillColor(idx % 2 === 0 ? 255 : BG_LIGHT[0], idx % 2 === 0 ? 255 : BG_LIGHT[1], idx % 2 === 0 ? 255 : BG_LIGHT[2]);
        doc.setDrawColor(...BORDER);
        doc.rect(marginL, curY, contentW, rowH, 'FD');

        // Flight Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...PLUM);
        doc.text(toSafeAscii(fl.flightNo), marginL + 8, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text('HK Express', marginL + 8, curY + 24);

        // Departure Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${toSafeAscii(fl.depCity)} (${toSafeAscii(fl.fromCode)})`, marginL + 75, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.depDateFormatted || ''), marginL + 75, curY + 24);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...PLUM);
        doc.text(`${toSafeAscii(fl.depTime)}  ${toSafeAscii(fl.depTerminal || '')}`, marginL + 75, curY + 34);

        // Arrival Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_DK);
        doc.text(`${toSafeAscii(fl.arrCity)} (${toSafeAscii(fl.toCode)})`, marginL + 185, curY + 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.arrDateFormatted || fl.depDateFormatted || ''), marginL + 185, curY + 24);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...PLUM);
        doc.text(`${toSafeAscii(fl.arrTime)}  ${toSafeAscii(fl.arrTerminal || '')}`, marginL + 185, curY + 34);

        // Aircraft Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(fl.aircraft || 'Airbus A321neo'), marginL + 295, curY + 15);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUT);
        doc.text(toSafeAscii(fl.duration || 'Non-Stop'), marginL + 295, curY + 26);

        // Class Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...TEXT_DK);
        doc.text(toSafeAscii(fl.flightClass || 'Economy (Fun)'), marginL + 390, curY + 21);

        // Status Column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...GREEN);
        doc.text('CONFIRMED', marginL + 475, curY + 21);

        curY += rowH;
    });

    curY += 12;

    // Payment Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 20, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...PLUM);
    doc.text('Payment Status:', marginL + 8, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('COMPLETED / PAID', marginL + 95, curY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PLUM);
    doc.text('Total Amount:', marginL + 300, curY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PLUM);
    doc.text('PAID IN FULL', marginL + 380, curY + 13);

    curY += 28;

    // Reminders Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER);
    doc.rect(marginL, curY, contentW, 52, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...PLUM);
    doc.text('HK EXPRESS TRAVEL REMINDERS', marginL + 8, curY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUT);
    doc.text('- Online Check-in opens 48 hours and closes 75 minutes before departure at hkexpress.com or app.', marginL + 8, curY + 24);
    doc.text('- Please arrive at the airport at least 2 to 3 hours prior to departure for check-in and security checks.', marginL + 8, curY + 34);
    doc.text(`- Strict baggage limits: 1 carry-on bag (up to ${toSafeAscii(carryOnText)}, 56x36x23cm) + 1 small personal item.`, marginL + 8, curY + 44);

    curY += 66;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140, 149, 159);
    doc.text(toSafeAscii('Hong Kong Express Airways Limited - Hong Kong International Airport - www.hkexpress.com'), contentW / 2 + marginL, curY, { align: 'center' });

    return doc;
}
