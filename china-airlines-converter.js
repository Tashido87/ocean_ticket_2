import { loadDocumentLibraries } from './document-libraries.js';
import { showToast } from './utils.js';
import {
    AIRPORT_NAME_MAP,
    formatPassengerName,
    generateRandomSeat,
    generateBookingRef,
    generateTicketNumber,
    formatAirlineDate,
    formatIssueDate,
    calculateTicketValidity,
    normalizeDuration,
    resolveAirportName,
    parseItinerarySchedule
} from './china-airlines-parser.mjs';

export {
    AIRPORT_NAME_MAP,
    formatPassengerName,
    generateRandomSeat,
    generateBookingRef,
    generateTicketNumber,
    formatAirlineDate,
    formatIssueDate,
    calculateTicketValidity,
    normalizeDuration,
    resolveAirportName,
    parseItinerarySchedule
};

let cachedLogoDataUrl = null;
let cachedBarcodeDataUrl = null;
let isPdfDownloading = false;

/**
 * Preload and cache China Airlines logo as Data URL
 */
export async function getChinaAirlinesLogoDataUrl() {
    if (cachedLogoDataUrl) return cachedLogoDataUrl;
    if (typeof Image === 'undefined') return null;
    try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            // Use clean authentic banner (without stamped check-in text)
            img.src = 'assets/china-airlines-pdf-banner.png';
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        cachedLogoDataUrl = canvas.toDataURL('image/png');
        return cachedLogoDataUrl;
    } catch (err) {
        console.warn('Could not load china-airlines-pdf-banner.png, trying fallback logo:', err);
        try {
            const img2 = new Image();
            img2.crossOrigin = 'Anonymous';
            await new Promise((resolve, reject) => {
                img2.onload = resolve;
                img2.onerror = reject;
                img2.src = 'assets/china-airlines-logo.png';
            });
            const canvas2 = document.createElement('canvas');
            canvas2.width = img2.naturalWidth || img2.width;
            canvas2.height = img2.naturalHeight || img2.height;
            const ctx2 = canvas2.getContext('2d');
            ctx2.drawImage(img2, 0, 0);
            cachedLogoDataUrl = canvas2.toDataURL('image/png');
            return cachedLogoDataUrl;
        } catch (e) {
            console.error('Failed to load any China Airlines logo:', e);
            return 'assets/china-airlines-logo.png';
        }
    }
}

/**
 * Preload and cache Barcode graphic as Data URL
 */
export async function getChinaAirlinesBarcodeDataUrl() {
    if (cachedBarcodeDataUrl) return cachedBarcodeDataUrl;
    if (typeof Image === 'undefined') return null;
    try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = 'assets/china-airlines-barcode.png';
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        cachedBarcodeDataUrl = canvas.toDataURL('image/png');
        return cachedBarcodeDataUrl;
    } catch (err) {
        console.warn('Could not load china-airlines-barcode.png:', err);
        return 'assets/china-airlines-barcode.png';
    }
}

/**
 * Safe HTML escape
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Build default ticket data structure
 */
export function createDefaultChinaAirlinesData() {
    const today = new Date();
    const issueDateStr = formatIssueDate(today);
    const flightDateStr = formatAirlineDate(today);

    return {
        passengerName: '',
        pnr: generateBookingRef(),
        ticketNo: generateTicketNumber(),
        issueOffice: 'ECOMMERCE, NO. 1, Q HOUSE LUMPINI BUILDING,, ROOM 1103, 11TH FL., SOUTH SATHON RD.,, BANGKOK 10120, THAILAND',
        telephone: '66-2-2108999',
        issueDate: issueDateStr,
        validityMode: 'same_day',
        flights: [
            {
                from: 'BANGKOK SUVARNABHUMI INTL',
                fromCode: 'BKK',
                depTerminal: '',
                to: 'TAIPEI TAIWAN TAOYUAN INTL',
                toCode: 'TPE',
                arrTerminal: '1',
                flightNo: 'CI834',
                depTime: '10:50',
                depDate: flightDateStr,
                arrTime: '15:30',
                arrDate: flightDateStr,
                cabinClass: 'THSHBZB, D',
                seat: generateRandomSeat('Economy'),
                operatedBy: 'CHINA AIRLINES LTD.',
                marketedBy: 'CHINA AIRLINES LTD.',
                bookingStatus: 'OK',
                baggage: '2PC',
                fareBasis: 'DOTH',
                nvb: flightDateStr,
                nva: flightDateStr,
                duration: '03:40',
                lastCheckIn: ''
            }
        ]
    };
}

/**
 * Render authentic China Airlines Electronic Ticket Receipt HTML
 */
export function renderChinaAirlinesTicketHtml(data) {
    const pnr = (data.pnr || data.bookingNo || '').trim().toUpperCase();
    const ticketNo = (data.ticketNo || data.eTicketNo || (data.passengers && data.passengers[0]?.eticket) || '').trim();
    const rawPax = (data.passengerName || (data.passengers && data.passengers[0]?.name) || '').trim();
    const paxName = rawPax ? formatPassengerName(rawPax) : '';
    const issueDate = data.issueDate || data.issuedDate || formatIssueDate(new Date());
    const telephone = data.telephone || '66-2-2108999';

    const logoSrc = cachedLogoDataUrl || 'assets/china-airlines-pdf-banner.png';
    const barcodeSrc = cachedBarcodeDataUrl || 'assets/china-airlines-barcode.png';

    const rawFlights = (data.flights && data.flights.length > 0)
        ? data.flights
        : createDefaultChinaAirlinesData().flights;

    const flightCardsHtml = rawFlights.map((f, idx) => {
        const fromText = escapeHtml(f.from || f.depAirport || '');
        const toText = escapeHtml(f.to || f.arrAirport || '');
        const arrTerminalText = f.arrTerminal ? `<div style="font-size:10pt; font-weight:bold; margin-top:2px; color:#000000;">Terminal: ${escapeHtml(f.arrTerminal)}</div>` : '';
        const depTerminalText = f.depTerminal ? `<div style="font-size:10pt; font-weight:bold; margin-top:2px; color:#000000;">Terminal: ${escapeHtml(f.depTerminal)}</div>` : '';
        const flightNoText = escapeHtml(f.flightNo || 'CI834');
        const depTimeText = escapeHtml(f.depTime || '10:50');
        const depDateText = escapeHtml(f.depDate || f.depDateFormatted || '');
        const arrTimeText = escapeHtml(f.arrTime || '15:30');
        const arrDateText = escapeHtml(f.arrDate || f.arrDateFormatted || f.depDate || f.depDateFormatted || '');
        const lastCheckIn = escapeHtml(f.lastCheckIn || '');

        const cabinClass = escapeHtml(f.cabinClass || f.flightClass || 'Economy, Y');
        const seat = escapeHtml(f.seat || generateRandomSeat(f.cabinClass || f.flightClass));
        const bookingStatus = escapeHtml(f.bookingStatus || 'OK');
        const duration = escapeHtml(f.duration || '03:40');
        const operatedBy = escapeHtml(f.operatedBy || f.airlineName || 'CHINA AIRLINES LTD.');
        const marketedBy = escapeHtml(f.marketedBy || f.airlineName || 'CHINA AIRLINES LTD.');
        const baggage = escapeHtml(f.baggage || '2PC');
        const fareBasis = escapeHtml(f.fareBasis || 'DOTH');
        const nvb = escapeHtml(f.nvb || f.depDate || f.depDateFormatted || '');
        const nva = escapeHtml(f.nva || f.depDate || f.depDateFormatted || '');

        return `
        <div class="ci-flight-block" style="margin-bottom:12px; border-bottom:1.4pt solid #2d73b9;">
            <!-- Grey Header Flight Row -->
            <div style="background:#ebebeb; padding:8px 10px; display:grid; grid-template-columns: 160px 150px 50px 75px 75px 1fr; gap:6px; font-size:10pt; font-weight:bold; color:#000000; align-items:start; line-height:1.25;">
                <div>
                    <div>${fromText}</div>
                    ${depTerminalText}
                </div>
                <div>
                    <div>${toText}</div>
                    ${arrTerminalText}
                </div>
                <div>${flightNoText}</div>
                <div>
                    <div>${depTimeText}</div>
                    <div style="font-size:9.5pt; font-weight:bold;">${depDateText}</div>
                </div>
                <div>
                    <div>${arrTimeText}</div>
                    <div style="font-size:9.5pt; font-weight:bold;">${arrDateText}</div>
                </div>
                <div style="font-size:9pt; font-weight:normal; color:#444444;">
                    ${lastCheckIn}
                </div>
            </div>

            <!-- White Metadata Row (3 columns) -->
            <div style="background:#ffffff; padding:7px 10px 9px 10px; display:grid; grid-template-columns: 1.1fr 1.2fr 0.9fr; gap:10px; font-size:8pt; line-height:1.55; color:#000000;">
                <div>
                    <div><span style="color:#444444;">Class : </span><strong style="color:#000000;">${cabinClass}</strong></div>
                    <div><span style="color:#444444;">Seat : </span><strong style="color:#000000;">${seat}</strong></div>
                    <div><span style="color:#444444;">Booking status (1) : </span><strong style="color:#000000;">${bookingStatus}</strong></div>
                    <div><span style="color:#444444;">Duration : </span><strong style="color:#000000;">${duration}</strong></div>
                </div>
                <div>
                    <div><span style="color:#444444;">Operated by : </span><strong style="color:#000000;">${operatedBy}</strong></div>
                    <div><span style="color:#444444;">Marketed by : </span><strong style="color:#000000;">${marketedBy}</strong></div>
                    <div><span style="color:#444444;">Baggage (4) : </span><strong style="color:#000000;">${baggage}</strong></div>
                    <div><span style="color:#444444;">Fare basis : </span><strong style="color:#000000;">${fareBasis}</strong></div>
                </div>
                <div>
                    <div><span style="color:#444444;">NVB (2) : </span><strong style="color:#000000;">${nvb}</strong></div>
                    <div><span style="color:#444444;">NVA (3) : </span><strong style="color:#000000;">${nva}</strong></div>
                </div>
            </div>
        </div>
        `;
    }).join('');

    return `
    <div class="china-airlines-receipt" id="chinaAirlinesTicketDocument" style="background:#ffffff; color:#000000; font-family:Arial, Helvetica, sans-serif; width:595.3pt; max-width:100%; box-sizing:border-box; margin:0 auto; padding:20pt 22pt; box-shadow:0 4px 20px rgba(0,0,0,0.12); border-radius:4px; line-height:1.3; -webkit-print-color-adjust:exact; print-color-adjust:exact; text-rendering:optimizeLegibility;">
        
        <!-- Top Logo Banner -->
        <div style="width:100%; height:54pt; display:flex; align-items:center; justify-content:flex-start; margin-bottom:20pt;">
            <img src="${logoSrc}" alt="China Airlines" style="height:100%; max-width:100%; object-fit:contain; display:block;" onerror="this.onerror=null; this.src='assets/china-airlines-logo.png';">
        </div>

        <!-- Upper Info Section: 2 Columns -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24pt; font-family:Arial, Helvetica, sans-serif;">
            
            <!-- Left Info: Passenger, Booking ref, Ticket number -->
            <div style="flex:1; max-width:300pt; padding-top:4pt;">
                <div style="font-size:13.5pt; margin-bottom:5pt; line-height:1.2;">
                    <span style="color:#434343;">Passenger : </span>
                    <strong style="color:#000000; font-weight:bold;">${escapeHtml(paxName)}</strong>
                </div>
                <div style="font-size:13.5pt; margin-bottom:5pt; line-height:1.2;">
                    <span style="color:#434343;">Booking ref : </span>
                    <strong style="color:#000000; font-weight:bold;">${escapeHtml(pnr)}</strong>
                </div>
                <div style="font-size:11pt; line-height:1.2;">
                    <span style="color:#434343;">Ticket number : </span>
                    <strong style="color:#000000; font-weight:bold;">${escapeHtml(ticketNo)}</strong>
                </div>
            </div>

            <!-- Right Info: Barcode + Issuing Office -->
            <div style="width:235pt; text-align:left;">
                <!-- Barcode left-aligned with Issuing office -->
                <div style="height:48pt; margin-bottom:8pt; display:flex; justify-content:flex-start; align-items:flex-start;">
                    <img src="${barcodeSrc}" alt="Barcode" style="height:46pt; width:auto; max-width:110pt; object-fit:contain; object-position:left top; display:block; margin:0; padding:0;">
                </div>
                <div style="font-size:10.5pt; line-height:1.32; color:#000000;">
                    <div style="font-weight:bold; margin-bottom:2pt;">Issuing office :</div>
                    <div style="font-size:10pt;">ECOMMERCE, NO. 1, Q HOUSE LUMPINI</div>
                    <div style="font-size:10pt;">BUILDING,, ROOM 1103, 11TH FL., SOUTH</div>
                    <div style="font-size:10pt;">SATHON RD.,, BANGKOK 10120, THAILAND</div>
                    <div style="font-size:10pt; margin-top:1pt;">Telephone : ${escapeHtml(telephone)}</div>
                    <div style="font-size:10pt; margin-top:1pt;">Date: ${escapeHtml(issueDate)}</div>
                </div>
            </div>
        </div>

        <!-- Blue RECEIPT Banner -->
        <div style="background:#004586; color:#ffffff; padding:6pt 10pt; margin-bottom:5pt; border-radius:0;">
            <div style="font-size:15.5pt; font-weight:bold; letter-spacing:0.5px; text-transform:uppercase;">
                ELECTRONIC TICKET RECEIPT
            </div>
        </div>

        <!-- Notice -->
        <div style="font-size:8.8pt; color:#000000; margin-bottom:14pt; padding-left:1pt;">
            At check-in, you must show a photo ID.
        </div>

        <!-- Flight Table Header -->
        <div style="background:#2d73b9; color:#ffffff; padding:4pt 10pt; display:grid; grid-template-columns: 160px 150px 50px 75px 75px 1fr; gap:6px; font-size:8pt; font-weight:bold; text-transform:none; margin-bottom:2px;">
            <div>From</div>
            <div>To</div>
            <div>Flight</div>
            <div>Departure</div>
            <div>Arrival</div>
            <div>Last check-in</div>
        </div>

        <!-- Flights Sectors List -->
        ${flightCardsHtml}

        <!-- Footnotes -->
        <div style="font-size:7.8pt; color:#000000; line-height:1.35; margin-bottom:14pt; padding-left:1pt;">
            (1) OK = confirmed (2) NVB = Not valid before (3) NVA = Not valid after (4) Each passenger can check in a specific amount of baggage at no extra cost as indicated above in the column baggage.
        </div>

        <!-- Electronic Ticket Remarks -->
        <div style="margin-top:10pt; padding-left:1pt;">
            <div style="font-size:8pt; font-weight:bold; color:#444444; margin-bottom:6pt; text-transform:uppercase;">
                ELECTRONIC TICKET REMARKS
            </div>
            
            <div style="font-size:8pt; line-height:1.45; color:#000000; padding-left:18pt;">
                <div style="position:relative; margin-bottom:2.5pt;">
                    <span style="position:absolute; left:-14pt; font-size:6pt; top:1pt;">&#9632;</span>
                    All times are local.
                </div>
                <div style="position:relative; margin-bottom:2.5pt;">
                    <span style="position:absolute; left:-14pt; font-size:6pt; top:1pt;">&#9632;</span>
                    The name field on this e-ticket receipt is in the order of the passenger's passport: 1. Family name 2. Given name 3. Title.
                </div>
                <div style="position:relative; margin-bottom:2.5pt;">
                    <span style="position:absolute; left:-14pt; font-size:6pt; top:1pt;">&#9632;</span>
                    For details of ticket validity, please refer to the <a href="https://www.china-airlines.com" target="_blank" style="color:#0000ff; text-decoration:underline;">Article 3.2</a> of General Conditions of Carriage.
                </div>
                <div style="position:relative; margin-bottom:2.5pt;">
                    <span style="position:absolute; left:-14pt; font-size:6pt; top:1pt;">&#9632;</span>
                    The following carrier imposed fees and charges collected as tax codes XP/YR/OB on your ticket are non-refundable:
                    <div style="margin-top:1px;">(1) Change/Reissue fee : XP；(2) Booking Service Charge : YR；(3) Credit Card Surcharge : OB</div>
                </div>
            </div>
        </div>

    </div>
    `;
}

/**
 * Generate A4 PDF using jsPDF matching authentic layout
 */
export async function generateChinaAirlinesPdfDoc(data) {
    await loadDocumentLibraries('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginX = 22.0;

    const logoDataUrl = await getChinaAirlinesLogoDataUrl();
    const barcodeDataUrl = await getChinaAirlinesBarcodeDataUrl();

    // 1. Top Logo Banner
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', 26.0, 18.0, 545.0, 54.0);
        } catch (e) {
            console.warn('Could not add logo to PDF:', e);
        }
    }

    // 2. Left Column: Passenger, Booking ref, Ticket number
    const paxRaw = (data.passengerName || (data.passengers && data.passengers[0]?.name) || '').trim();
    const paxName = paxRaw ? formatPassengerName(paxRaw) : '';
    const pnr = (data.pnr || data.bookingNo || '').trim().toUpperCase();
    const ticketNo = (data.ticketNo || data.eTicketNo || (data.passengers && data.passengers[0]?.eticket) || '').trim();

    // Passenger
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(13.5);
    doc.setTextColor(67, 67, 67); // #434343
    doc.text('Passenger : ', marginX, 126.0);
    const passLabelWidth = doc.getTextWidth('Passenger : ');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(paxName, marginX + passLabelWidth, 126.0);

    // Booking ref
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(67, 67, 67);
    doc.text('Booking ref : ', marginX, 144.5);
    const bkgLabelWidth = doc.getTextWidth('Booking ref : ');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(pnr, marginX + bkgLabelWidth, 144.5);

    // Ticket number
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11.0);
    doc.setTextColor(67, 67, 67);
    doc.text('Ticket number : ', marginX, 162.5);
    const tktLabelWidth = doc.getTextWidth('Ticket number : ');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(ticketNo, marginX + tktLabelWidth, 162.5);

    // 3. Right Column: Barcode & Issuing Office
    const rightColX = 338.0;
    if (barcodeDataUrl) {
        try {
            doc.addImage(barcodeDataUrl, 'PNG', rightColX, 122.0, 101.0, 48.0);
        } catch (e) {
            console.warn('Could not add barcode to PDF:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(0, 0, 0);
    doc.text('Issuing office :', rightColX, 178.0);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.0);
    doc.text('ECOMMERCE, NO. 1, Q HOUSE LUMPINI', rightColX, 192.5);
    doc.text('BUILDING,, ROOM 1103, 11TH FL., SOUTH', rightColX, 206.5);
    doc.text('SATHON RD.,, BANGKOK 10120, THAILAND', rightColX, 220.5);
    doc.text(`Telephone : ${data.telephone || '66-2-2108999'}`, rightColX, 234.5);
    doc.text(`Date: ${data.issueDate || data.issuedDate || formatIssueDate(new Date())}`, rightColX, 248.5);

    // 4. Blue ELECTRONIC TICKET RECEIPT Banner
    const bannerY = 276.0;
    doc.setFillColor(0, 69, 134); // #004586
    doc.rect(0, bannerY, pageWidth, 31.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15.5);
    doc.setTextColor(255, 255, 255);
    doc.text('ELECTRONIC TICKET RECEIPT', marginX, bannerY + 21.0);

    // 5. Notice
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(0, 0, 0);
    doc.text('At check-in, you must show a photo ID.', marginX, bannerY + 44.0);

    // 6. Flight Sectors Table Header
    let tableY = bannerY + 54.0;
    doc.setFillColor(45, 115, 185); // #2d73b9
    doc.rect(marginX, tableY, pageWidth - (marginX * 2), 19.0, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.0);
    doc.setTextColor(255, 255, 255);
    doc.text('From', marginX + 5, tableY + 13.0);
    doc.text('To', marginX + 160, tableY + 13.0);
    doc.text('Flight', marginX + 310, tableY + 13.0);
    doc.text('Departure', marginX + 360, tableY + 13.0);
    doc.text('Arrival', marginX + 430, tableY + 13.0);
    doc.text('Last check-in', marginX + 495, tableY + 13.0);

    tableY += 19.0;

    // 7. Render Flight Sectors
    const flights = (data.flights && data.flights.length > 0)
        ? data.flights
        : createDefaultChinaAirlinesData().flights;

    for (let i = 0; i < flights.length; i++) {
        const f = flights[i];

        // Grey summary section
        const greyHeight = 48.0;
        doc.setFillColor(235, 235, 235); // #ebebeb
        doc.rect(marginX, tableY, pageWidth - (marginX * 2), greyHeight, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.0);
        doc.setTextColor(0, 0, 0);

        // From
        const fromLines = doc.splitTextToSize(f.from || f.depAirport || '', 150);
        doc.text(fromLines, marginX + 5, tableY + 15.0);

        // To + Terminal
        const toLines = doc.splitTextToSize(f.to || f.arrAirport || '', 145);
        doc.text(toLines, marginX + 160, tableY + 15.0);
        const term = f.arrTerminal || '';
        if (term) {
            const arrTermY = tableY + 15.0 + (toLines.length * 11.0);
            doc.text(`Terminal: ${term}`, marginX + 160, arrTermY);
        }

        // Flight
        doc.text(f.flightNo || 'CI834', marginX + 310, tableY + 15.0);

        // Departure
        doc.text(f.depTime || '10:50', marginX + 360, tableY + 15.0);
        doc.text(f.depDate || f.depDateFormatted || '', marginX + 360, tableY + 28.0);

        // Arrival
        doc.text(f.arrTime || '15:30', marginX + 430, tableY + 15.0);
        doc.text(f.arrDate || f.arrDateFormatted || f.depDate || f.depDateFormatted || '', marginX + 430, tableY + 28.0);

        tableY += greyHeight;

        // White metadata section
        const metaHeight = 52.0;
        doc.setFillColor(255, 255, 255);
        doc.rect(marginX, tableY, pageWidth - (marginX * 2), metaHeight, 'F');

        doc.setFontSize(8.0);
        // Column 1
        const c1X = marginX + 5;
        doc.setTextColor(68, 68, 68); doc.text('Class : ', c1X, tableY + 12.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.cabinClass || f.flightClass || 'Economy, Y', c1X + 35, tableY + 12.0);

        const seatStr = f.seat || generateRandomSeat(f.cabinClass || f.flightClass);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('Seat : ', c1X, tableY + 24.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(seatStr, c1X + 35, tableY + 24.0);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('Booking status (1) : ', c1X, tableY + 36.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.bookingStatus || 'OK', c1X + 78, tableY + 36.0);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('Duration : ', c1X, tableY + 48.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.duration || '03:40', c1X + 42, tableY + 48.0);

        // Column 2
        const c2X = marginX + 160;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('Operated by : ', c2X, tableY + 12.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.operatedBy || f.airlineName || 'CHINA AIRLINES LTD.', c2X + 56, tableY + 12.0);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('Marketed by : ', c2X, tableY + 24.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.marketedBy || f.airlineName || 'CHINA AIRLINES LTD.', c2X + 56, tableY + 24.0);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('Baggage (4) : ', c2X, tableY + 36.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.baggage || '2PC', c2X + 56, tableY + 36.0);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('Fare basis : ', c2X, tableY + 48.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.fareBasis || 'DOTH', c2X + 46, tableY + 48.0);

        // Column 3
        const c3X = marginX + 420;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('NVB (2) : ', c3X, tableY + 24.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.nvb || f.depDate || f.depDateFormatted || '', c3X + 40, tableY + 24.0);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(68, 68, 68); doc.text('NVA (3) : ', c3X, tableY + 36.0);
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.text(f.nva || f.depDate || f.depDateFormatted || '', c3X + 40, tableY + 36.0);

        tableY += metaHeight;

        // Divider line
        doc.setDrawColor(45, 115, 185); // #2d73b9
        doc.setLineWidth(1.4);
        doc.line(marginX, tableY, pageWidth - marginX, tableY);

        tableY += 8.0;
    }

    // 8. Footnotes
    tableY += 6.0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(0, 0, 0);
    const noteLine1 = '(1) OK = confirmed (2) NVB = Not valid before (3) NVA = Not valid after (4) Each passenger can check in a specific amount of baggage at no extra';
    const noteLine2 = 'cost as indicated above in the column baggage.';
    doc.text(noteLine1, marginX, tableY);
    doc.text(noteLine2, marginX, tableY + 11.0);

    tableY += 26.0;

    // 9. Electronic Ticket Remarks
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.0);
    doc.setTextColor(68, 68, 68);
    doc.text('ELECTRONIC TICKET REMARKS', marginX, tableY);

    tableY += 13.0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.0);
    doc.setTextColor(0, 0, 0);

    // Bullet 1
    doc.rect(marginX + 20, tableY - 4.5, 3.0, 3.0, 'F');
    doc.text('All times are local.', marginX + 30, tableY);

    // Bullet 2
    tableY += 11.5;
    doc.rect(marginX + 20, tableY - 4.5, 3.0, 3.0, 'F');
    doc.text("The name field on this e-ticket receipt is in the order of the passenger's passport: 1. Family name 2. Given name 3. Title.", marginX + 30, tableY);

    // Bullet 3
    tableY += 11.5;
    doc.rect(marginX + 20, tableY - 4.5, 3.0, 3.0, 'F');
    doc.text('For details of ticket validity, please refer to the Article 3.2 of General Conditions of Carriage.', marginX + 30, tableY);

    // Bullet 4
    tableY += 11.5;
    doc.rect(marginX + 20, tableY - 4.5, 3.0, 3.0, 'F');
    doc.text('The following carrier imposed fees and charges collected as tax codes XP/YR/OB on your ticket are non-refundable:', marginX + 30, tableY);

    tableY += 11.5;
    doc.text('(1) Change/Reissue fee : XP；(2) Booking Service Charge : YR；(3) Credit Card Surcharge : OB', marginX + 30, tableY);

    return doc;
}

/**
 * Trigger PDF Download
 */
export async function downloadChinaAirlinesPdf(data) {
    if (isPdfDownloading) return null;
    const rawPax = (data.passengerName || (data.passengers && data.passengers[0]?.name) || '').trim();
    if (!rawPax) {
        showToast('Please enter passenger name before downloading ticket.', 'warning');
        return null;
    }
    isPdfDownloading = true;
    try {
        const pnr = (data.pnr || 'TICKET').trim().toUpperCase();
        const safePax = rawPax.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `ChinaAirlines_ETicket_${pnr}_${safePax}.pdf`;

        const doc = await generateChinaAirlinesPdfDoc(data);
        doc.save(filename);
        showToast(`Downloaded ${filename}`, 'success');
        return filename;
    } catch (err) {
        console.error('PDF generation error:', err);
        showToast('Failed to generate PDF. Check console.', 'error');
        throw err;
    } finally {
        isPdfDownloading = false;
    }
}

/**
 * Trigger PNG Image Download
 */
export async function downloadChinaAirlinesImage(data) {
    const rawPax = (data.passengerName || (data.passengers && data.passengers[0]?.name) || '').trim();
    if (!rawPax) {
        showToast('Please enter passenger name before exporting image.', 'warning');
        return null;
    }
    await loadDocumentLibraries('canvas');
    if (!window.html2canvas) {
        throw new Error('html2canvas library is not loaded');
    }
    const previewEl = document.getElementById('chinaAirlinesTicketDocument');
    if (!previewEl) return;

    try {
        const canvas = await window.html2canvas(previewEl, {
            scale: 2.5,
            useCORS: true,
            backgroundColor: '#ffffff'
        });

        const pnr = (data.pnr || 'TICKET').trim().toUpperCase();
        const safePax = rawPax.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `ChinaAirlines_ETicket_${pnr}_${safePax}.png`;

        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast(`Downloaded ${filename}`, 'success');
        return filename;
    } catch (err) {
        console.error('Image export error:', err);
        showToast('Failed to export image.', 'error');
        throw err;
    }
}

/**
 * Process image file with Tesseract OCR
 */
export async function parseTripScheduleImage(fileOrBlob) {
    await loadDocumentLibraries('ocr');
    if (!window.Tesseract) {
        throw new Error('Tesseract OCR library could not be loaded.');
    }

    // Convert file to Image
    const imgUrl = URL.createObjectURL(fileOrBlob);
    try {
        const img = new Image();
        await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
            img.src = imgUrl;
        });

        // Preprocess canvas for high OCR accuracy
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Boost contrast and grayscale
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            const gray = (d[i] * 0.299) + (d[i + 1] * 0.587) + (d[i + 2] * 0.114);
            const contrast = Math.max(0, Math.min(255, ((gray - 128) * 1.35) + 128));
            d[i] = contrast;
            d[i + 1] = contrast;
            d[i + 2] = contrast;
        }
        ctx.putImageData(imgData, 0, 0);

        const { data: { text } } = await window.Tesseract.recognize(canvas, 'eng');
        return parseItinerarySchedule(text);
    } finally {
        URL.revokeObjectURL(imgUrl);
    }
}

/**
 * Process PDF file to extract text
 */
export async function parseTripSchedulePdf(file) {
    await loadDocumentLibraries('reader');
    if (!window.pdfjsLib) {
        throw new Error('PDF.js library is not loaded');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
    }
    return parseItinerarySchedule(fullText);
}
