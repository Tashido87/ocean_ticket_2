/**
 * AirAsia E-Ticket Itinerary Generator & Converter
 * Converts Trip.com / OTA PDF itineraries into official AirAsia E-Ticket Receipts.
 */

import { showToast } from './utils.js';

let cachedLogoDataUrl = null;

/**
 * Preload and cache AirAsia logo as data URL for jsPDF and HTML preview
 */
export async function getAirAsiaLogoDataUrl() {
    if (cachedLogoDataUrl) return cachedLogoDataUrl;
    try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = 'airasia-logo.png';
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        cachedLogoDataUrl = canvas.toDataURL('image/png');
        return cachedLogoDataUrl;
    } catch (err) {
        console.warn('Failed to load airasia-logo.png as data URL', err);
        return 'airasia-logo.png';
    }
}

/**
 * Format date string into "DayName, D MonthName YYYY"
 */
export function formatTicketDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    } catch (e) {
        return dateStr;
    }
}

const AIRPORT_CODE_MAP = {
    'kuala lumpur': 'KUL',
    'klia': 'KUL',
    'johor bahru': 'JHB',
    'senai': 'JHB',
    'penang': 'PEN',
    'langkawi': 'LGK',
    'kota kinabalu': 'BKI',
    'kuching': 'KCH',
    'miri': 'MYY',
    'sibu': 'SBW',
    'tawau': 'TWU',
    'sandakan': 'SDK',
    'singapore': 'SIN',
    'changi': 'SIN',
    'bangkok': 'BKK',
    'suvarnabhumi': 'BKK',
    'don mueang': 'DMK',
    'phuket': 'HKT',
    'chiang mai': 'CNX',
    'krabi': 'KBV',
    'hat yai': 'HDY',
    'yangon': 'RGN',
    'mandalay': 'MDL',
    'ho chi minh': 'SGN',
    'hanoi': 'HAN',
    'da nang': 'DAD',
    'jakarta': 'CGK',
    'bali': 'DPS',
    'denpasar': 'DPS',
    'surabaya': 'SUB',
    'manila': 'MNL',
    'cebu': 'CEB',
    'seoul': 'ICN',
    'incheon': 'ICN',
    'tokyo': 'NRT',
    'narita': 'NRT',
    'haneda': 'HND',
    'osaka': 'KIX',
    'kansai': 'KIX',
    'taipei': 'TPE',
    'hong kong': 'HKG',
    'macau': 'MFM',
    'guangzhou': 'CAN',
    'shanghai': 'PVG',
    'phnom penh': 'PNH',
    'siem reap': 'REP',
    'vientiane': 'VTE'
};

export function lookupAirportCode(name) {
    if (!name) return '';
    // If code already present in parentheses
    const parenthesized = name.match(/\(([A-Z]{3})\)/);
    if (parenthesized) return parenthesized[1];

    const lower = name.toLowerCase();
    for (const [key, code] of Object.entries(AIRPORT_CODE_MAP)) {
        if (lower.includes(key)) return code;
    }
    return '';
}

export function extractCityName(name) {
    if (!name) return '';
    return name
        .replace(/\([A-Z]{3}\)/g, '')
        .replace(/\s*(?:International|Airport|Airfield|Senai|Terminal\s*\d+|T\d+).*/i, '')
        .trim();
}

/**
 * Parse text extracted from Trip.com / OTA PDF itinerary
 */
export function parseItineraryText(rawText) {
    const clean = rawText.replace(/\u2236/g, ':');

    // 1. Booking No
    const bookingNoMatch = clean.match(/Booking\s*No\.?\s*([0-9A-Z]+)/i);
    const bookingNo = bookingNoMatch ? bookingNoMatch[1].trim() : '';

    // 2. Airline Booking Reference (PNR)
    let pnr = '';
    const pnrMatch = clean.match(/Airline\s*Booking\s*Reference\s*(?:[^\n]*\n)?([A-Z0-9]{5,8})\b/i) ||
                     clean.match(/(?:Economy|Business|Premium)\s*(?:--|[0-9A-Z-]+)?\s*([A-Z0-9]{5,8})\b/i) ||
                     clean.match(/PNR\s*[:\s]*([A-Z0-9]{5,8})\b/i);
    if (pnrMatch) {
        pnr = pnrMatch[1].trim();
    }

    // 3. Class
    let flightClass = 'Economy';
    const classMatch = clean.match(/\b(Economy|Business|Premium\s*Economy|First)\b/i);
    if (classMatch) {
        flightClass = classMatch[1];
    }

    // 4. E-Ticket No
    let eTicketNo = 'To be advised at check-in';
    const eticketMatch = clean.match(/E-ticket\s*No\.?\s*([0-9-]{10,})/i);
    if (eticketMatch && !eticketMatch[1].includes('--')) {
        eTicketNo = eticketMatch[1].trim();
    }

    // 5. Passenger Name & Type
    let passengerName = '';
    let passengerType = 'Adult';
    // Check Baggage section first: "NAME (Adults)"
    const paxBaggageMatch = clean.match(/\n\s*([A-Z\s]{3,})\s*\((Adults?|Children|Infants?)\)/i);
    if (paxBaggageMatch) {
        passengerName = paxBaggageMatch[1].trim();
        passengerType = paxBaggageMatch[2].replace(/s$/i, '');
    } else {
        // Try Name table in Trip.com
        const nameBlockMatch = clean.match(/(?:Reference|Name\s+Class)[\s\S]*?\n([\s\S]*?)(?:Economy|Business|Premium|--)/i);
        if (nameBlockMatch) {
            let n = nameBlockMatch[1];
            n = n.replace(/\(First\s*name\)/gi, '')
                 .replace(/\(Last\s*name\)/gi, '')
                 .replace(/Reference/gi, '')
                 .replace(/\s+/g, ' ')
                 .trim();
            if (n) passengerName = n;
        }
    }
    if (passengerType.toLowerCase() === 'adult') passengerType = 'Adult';

    // 6. Flight Info
    let flightNo = '';
    let airlineName = 'AirAsia Berhad';
    const flInfoBlock = clean.match(/Flight\s*Information[\s\S]*?(?:Baggage\s*Allowance|$)/i);
    const flSearchText = flInfoBlock ? flInfoBlock[0] : clean;
    const airlineLineMatch = flSearchText.match(/Airline\s*[\t: ]+([^\n\r]+)/i);
    if (airlineLineMatch) {
        const rawAirlineLine = airlineLineMatch[1].trim();
        const flCodeMatch = rawAirlineLine.match(/([A-Z0-9]{2,3}\s*\d{3,4})/);
        if (flCodeMatch) {
            flightNo = flCodeMatch[1].replace(/\s+/g, '');
            airlineName = rawAirlineLine.replace(flCodeMatch[0], '').trim() || airlineName;
        } else {
            airlineName = rawAirlineLine;
        }
    } else {
        // Fallback search for flight code like AK6032, FD3564, etc.
        const generalFlMatch = clean.match(/\b(AK|FD|QZ|D7|XJ|Z2)\s*(\d{3,4})\b/i);
        if (generalFlMatch) {
            flightNo = generalFlMatch[1].toUpperCase() + generalFlMatch[2];
        }
    }

    // 7. Departure
    let depTime = '';
    let depDateRaw = '';
    let depAirport = '';
    let depTerminal = '';
    const depMatch = flSearchText.match(/Departure\s*[\t: ]*(\d{1,2}:\d{2}),?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4}),?\s*([^\n\r]+)/i);
    if (depMatch) {
        depTime = depMatch[1].trim();
        depDateRaw = depMatch[2].trim();
        depAirport = depMatch[3].trim();
        const termMatch = depAirport.match(/\b(T\d+|Terminal\s*\d+)\b/i);
        if (termMatch) {
            depTerminal = termMatch[0].replace(/^T(\d+)/i, 'Terminal $1');
            depAirport = depAirport.replace(termMatch[0], '').replace(/,\s*$/, '').trim();
        }
    }

    // 8. Arrival
    let arrTime = '';
    let arrDateRaw = '';
    let arrAirport = '';
    let arrTerminal = '';
    const arrMatch = flSearchText.match(/Arrival\s*[\t: ]*(\d{1,2}:\d{2}),?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4}),?\s*([^\n\r]+)/i);
    if (arrMatch) {
        arrTime = arrMatch[1].trim();
        arrDateRaw = arrMatch[2].trim();
        arrAirport = arrMatch[3].trim();
        const termMatch = arrAirport.match(/\b(T\d+|Terminal\s*\d+)\b/i);
        if (termMatch) {
            arrTerminal = termMatch[0].replace(/^T(\d+)/i, 'Terminal $1');
            arrAirport = arrAirport.replace(termMatch[0], '').replace(/,\s*$/, '').trim();
        }
    }

    // 9. Airport Codes & Route
    const depCode = lookupAirportCode(depAirport);
    const arrCode = lookupAirportCode(arrAirport);

    const depDateFormatted = formatTicketDate(depDateRaw);
    const arrDateFormatted = formatTicketDate(arrDateRaw);

    const depAirportFormatted = depAirport.includes(`(${depCode})`) ? depAirport : (depAirport + (depCode ? ` (${depCode})` : ''));
    const arrAirportFormatted = arrAirport.includes(`(${arrCode})`) ? arrAirport : (arrAirport + (arrCode ? ` (${arrCode})` : ''));

    const depCity = extractCityName(depAirport) || 'Kuala Lumpur';
    const arrCity = extractCityName(arrAirport) || 'Johor Bahru';
    const route = `${depCity} (${depCode || 'DEP'}) - ${arrCity} (${arrCode || 'ARR'})`;

    // 10. Baggage
    let checkedBaggage = '30 kg per person\nEach piece max 119 x 119 x 81 cm (total 319 cm)';
    const kgMatch = clean.match(/Checked\s*baggage\s*[\t: ]*(\d+\s*kg\s*per\s*person)/i);
    const dimMatch = clean.match(/(?:cannot\s*exceed|max)\s*(\d+\s*cm)\s*\(([0-9x\s]+cm)\)/i);
    if (kgMatch && dimMatch) {
        const dimStr = dimMatch[2].replace(/\s+/g, ' ').replace(/x/g, ' x ');
        checkedBaggage = `${kgMatch[1].trim()}\nEach piece max ${dimStr} (total ${dimMatch[1].trim()})`;
    } else if (kgMatch) {
        checkedBaggage = `${kgMatch[1].trim()}\nEach piece max 119 x 119 x 81 cm (total 319 cm)`;
    }

    const carryOnBaggage = '1 piece per person\nMax 56 x 36 x 23 cm per piece';
    const personalItem = '1 piece per person\nMax 40 x 30 x 10 cm per piece, fits under the seat in front of you';

    return {
        bookingNo,
        pnr,
        flightClass,
        eTicketNo,
        passengerName,
        passengerType,
        flightNo,
        airlineName,
        depTime,
        depDateFormatted,
        depAirport: depAirportFormatted,
        depTerminal,
        arrTime,
        arrDateFormatted,
        arrAirport: arrAirportFormatted,
        arrTerminal,
        route,
        checkedBaggage,
        carryOnBaggage,
        personalItem
    };
}

/**
 * Extract text from uploaded PDF file using PDF.js
 */
export async function extractTextFromPdf(file) {
    if (!window.pdfjsLib) {
        throw new Error('PDF.js library is not loaded. Please check your internet connection.');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
    }
    return fullText;
}

/**
 * Generate native vector jsPDF document matching the exact official template
 */
export async function generateAirAsiaPdfDoc(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getAirAsiaLogoDataUrl();

    // A4 dimensions in pt: 595.28 x 841.89
    const marginX = 48.5;
    const contentWidth = 498.2;
    const redColor = [227, 30, 36]; // #E31E24
    const darkColor = [51, 51, 51]; // #333333
    const greyBg = [245, 245, 245]; // #F5F5F5
    const pinkBg = [253, 236, 236]; // #FDECEC
    const borderGrey = [204, 204, 204]; // #CCCCCC
    const borderPink = [224, 170, 170]; // #E0AAAA
    const mutedColor = [102, 102, 102]; // #666666

    let cursorY = 46;

    // 1. HEADER
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', marginX, cursorY, 147, 63);
        } catch (e) {
            console.warn('Could not add logo to PDF', e);
        }
    }

    const rightX = marginX + contentWidth;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(...redColor);
    doc.text("E-TICKET", rightX, cursorY + 28, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...darkColor);
    doc.text("Itinerary Receipt", rightX, cursorY + 41, { align: "right" });
    doc.text(`Booking No. ${data.bookingNo || ''}`, rightX, cursorY + 53, { align: "right" });

    cursorY += 74;

    // Red Divider Line
    doc.setDrawColor(...redColor);
    doc.setLineWidth(3.4);
    doc.line(marginX, cursorY, marginX + contentWidth, cursorY);
    cursorY += 20;

    function drawSectionTitle(title, y) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(...redColor);
        doc.text(title, marginX, y);
    }

    // 2. BOOKING INFORMATION
    drawSectionTitle("Booking Information", cursorY);
    cursorY += 8;

    const bookBoxY = cursorY;
    const bookBoxHeight = 41;
    doc.setFillColor(...greyBg);
    doc.rect(marginX, bookBoxY, contentWidth, bookBoxHeight, 'F');
    doc.setDrawColor(...borderGrey);
    doc.setLineWidth(0.5);
    doc.rect(marginX, bookBoxY, contentWidth, bookBoxHeight, 'S');

    doc.line(marginX, bookBoxY + 20.5, marginX + contentWidth, bookBoxY + 20.5);

    const col2X = marginX + 125;
    const col3X = marginX + 255;
    const col4X = marginX + 402;
    doc.line(col2X, bookBoxY, col2X, bookBoxY + bookBoxHeight);
    doc.line(col3X, bookBoxY, col3X, bookBoxY + bookBoxHeight);
    doc.line(col4X, bookBoxY, col4X, bookBoxY + bookBoxHeight);

    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...darkColor);
    doc.text("Booking No.", marginX + 6, bookBoxY + 14);
    doc.setFont("helvetica", "normal");
    doc.text(data.bookingNo || "", col2X + 6, bookBoxY + 14);

    doc.setFont("helvetica", "bold");
    doc.text("Airline Booking Reference", col3X + 6, bookBoxY + 14);
    doc.setFont("helvetica", "normal");
    doc.text(data.pnr || "", col4X + 6, bookBoxY + 14);

    doc.setFont("helvetica", "bold");
    doc.text("E-Ticket No.", marginX + 6, bookBoxY + 34.5);
    doc.setFont("helvetica", "normal");
    doc.text(data.eTicketNo || "To be advised at check-in", col2X + 6, bookBoxY + 34.5);

    doc.setFont("helvetica", "bold");
    doc.text("Class", col3X + 6, bookBoxY + 34.5);
    doc.setFont("helvetica", "normal");
    doc.text(data.flightClass || "Economy", col4X + 6, bookBoxY + 34.5);

    cursorY += bookBoxHeight + 20;

    // 3. PASSENGER
    drawSectionTitle("Passenger", cursorY);
    cursorY += 8;

    const paxHeaderY = cursorY;
    const paxHeaderHeight = 21;
    doc.setFillColor(...redColor);
    doc.rect(marginX, paxHeaderY, contentWidth, paxHeaderHeight, 'F');
    doc.setDrawColor(...borderGrey);
    doc.setLineWidth(0.5);
    doc.rect(marginX, paxHeaderY, contentWidth, paxHeaderHeight, 'S');

    const paxColSplit = marginX + 340;
    doc.line(paxColSplit, paxHeaderY, paxColSplit, paxHeaderY + paxHeaderHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text("Name", marginX + 6, paxHeaderY + 14.5);
    doc.text("Type", paxColSplit + 6, paxHeaderY + 14.5);

    const paxRowHeight = 22.5;
    const paxRowY = paxHeaderY + paxHeaderHeight;
    doc.setFillColor(...greyBg);
    doc.rect(marginX, paxRowY, contentWidth, paxRowHeight, 'F');
    doc.setDrawColor(...borderGrey);
    doc.rect(marginX, paxRowY, contentWidth, paxRowHeight, 'S');
    doc.line(paxColSplit, paxRowY, paxColSplit, paxRowY + paxRowHeight);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...darkColor);
    doc.text(data.passengerName || "", marginX + 6, paxRowY + 15);
    doc.text(data.passengerType || "Adult", paxColSplit + 6, paxRowY + 15);

    cursorY = paxRowY + paxRowHeight + 20;

    // 4. FLIGHT INFORMATION
    drawSectionTitle("Flight Information", cursorY);
    cursorY += 8;

    const flHeaderY = cursorY;
    const flHeaderHeight = 21;
    doc.setFillColor(...redColor);
    doc.rect(marginX, flHeaderY, contentWidth, flHeaderHeight, 'F');
    doc.setDrawColor(...borderGrey);
    doc.setLineWidth(0.5);
    doc.rect(marginX, flHeaderY, contentWidth, flHeaderHeight, 'S');

    const flCol2 = marginX + 113.4;
    const flCol3 = marginX + 311.8;
    doc.line(flCol2, flHeaderY, flCol2, flHeaderY + flHeaderHeight);
    doc.line(flCol3, flHeaderY, flCol3, flHeaderY + flHeaderHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text("Flight", marginX + 6, flHeaderY + 14.5);
    doc.text("Departure", flCol2 + 6, flHeaderY + 14.5);
    doc.text("Arrival", flCol3 + 6, flHeaderY + 14.5);

    // Flight Row 1
    const flRow1Y = flHeaderY + flHeaderHeight;
    const flRow1Height = 47.5;
    doc.setFillColor(...greyBg);
    doc.rect(marginX, flRow1Y, contentWidth, flRow1Height, 'F');
    doc.setDrawColor(...borderGrey);
    doc.rect(marginX, flRow1Y, contentWidth, flRow1Height, 'S');
    doc.line(flCol2, flRow1Y, flCol2, flRow1Y + flRow1Height);
    doc.line(flCol3, flRow1Y, flCol3, flRow1Y + flRow1Height);

    doc.setTextColor(...darkColor);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.text(data.flightNo || "", marginX + 6, flRow1Y + 15);
    doc.setFont("helvetica", "normal");
    doc.text(data.airlineName || "", marginX + 6, flRow1Y + 28);

    // Departure text
    doc.setFont("helvetica", "bold");
    doc.text(data.depTime || "", flCol2 + 6, flRow1Y + 15);
    const depTimeWidth = doc.getTextWidth(data.depTime || "") + 1;
    doc.setFont("helvetica", "normal");
    doc.text(`, ${data.depDateFormatted || ""}`, flCol2 + 6 + depTimeWidth, flRow1Y + 15);
    doc.text(data.depAirport || "", flCol2 + 6, flRow1Y + 27.5);
    if (data.depTerminal) {
        doc.text(data.depTerminal, flCol2 + 6, flRow1Y + 40);
    }

    // Arrival text
    doc.setFont("helvetica", "bold");
    doc.text(data.arrTime || "", flCol3 + 6, flRow1Y + 15);
    const arrTimeWidth = doc.getTextWidth(data.arrTime || "") + 1;
    doc.setFont("helvetica", "normal");
    doc.text(`, ${data.arrDateFormatted || ""}`, flCol3 + 6 + arrTimeWidth, flRow1Y + 15);
    const arrAirportLines = doc.splitTextToSize(data.arrAirport || "", contentWidth - (flCol3 - marginX) - 12);
    doc.text(arrAirportLines, flCol3 + 6, flRow1Y + 27.5);

    // Route Row
    const flRow2Y = flRow1Y + flRow1Height;
    const flRow2Height = 22.5;
    doc.setFillColor(...greyBg);
    doc.rect(marginX, flRow2Y, contentWidth, flRow2Height, 'F');
    doc.setDrawColor(...borderGrey);
    doc.rect(marginX, flRow2Y, contentWidth, flRow2Height, 'S');
    doc.line(flCol2, flRow2Y, flCol2, flRow2Y + flRow2Height);

    doc.setFont("helvetica", "bold");
    doc.text("Route", marginX + 6, flRow2Y + 15);
    doc.setFont("helvetica", "normal");
    doc.text(data.route || "", flCol2 + 6, flRow2Y + 15);

    // Class Row
    const flRow3Y = flRow2Y + flRow2Height;
    const flRow3Height = 22.5;
    doc.setFillColor(...greyBg);
    doc.rect(marginX, flRow3Y, contentWidth, flRow3Height, 'F');
    doc.setDrawColor(...borderGrey);
    doc.rect(marginX, flRow3Y, contentWidth, flRow3Height, 'S');
    doc.line(flCol2, flRow3Y, flCol2, flRow3Y + flRow3Height);

    doc.setFont("helvetica", "bold");
    doc.text("Class", marginX + 6, flRow3Y + 15);
    doc.setFont("helvetica", "normal");
    doc.text(data.flightClass || "Economy", flCol2 + 6, flRow3Y + 15);

    cursorY = flRow3Y + flRow3Height + 20;

    // 5. BAGGAGE ALLOWANCE
    drawSectionTitle("Baggage Allowance", cursorY);
    cursorY += 8;

    const bagBoxY = cursorY;
    const bagBoxHeight = 105;
    doc.setFillColor(...pinkBg);
    doc.rect(marginX, bagBoxY, contentWidth, bagBoxHeight, 'F');
    doc.setDrawColor(...borderPink);
    doc.setLineWidth(0.5);
    doc.rect(marginX, bagBoxY, contentWidth, bagBoxHeight, 'S');

    const bagColSplit = marginX + 136;
    doc.line(bagColSplit, bagBoxY, bagColSplit, bagBoxY + bagBoxHeight);
    doc.line(marginX, bagBoxY + 35, marginX + contentWidth, bagBoxY + 35);
    doc.line(marginX, bagBoxY + 70, marginX + contentWidth, bagBoxY + 70);

    // Checked baggage
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...darkColor);
    doc.text("Checked baggage", marginX + 6, bagBoxY + 16);
    doc.setFont("helvetica", "normal");
    const checkedLines = (data.checkedBaggage || "").split('\n');
    doc.text(checkedLines[0] || "", bagColSplit + 6, bagBoxY + 15);
    if (checkedLines[1]) doc.text(checkedLines[1], bagColSplit + 6, bagBoxY + 28);

    // Carry-on baggage
    doc.setFont("helvetica", "bold");
    doc.text("Carry-on baggage", marginX + 6, bagBoxY + 51);
    doc.setFont("helvetica", "normal");
    const carryLines = (data.carryOnBaggage || "").split('\n');
    doc.text(carryLines[0] || "", bagColSplit + 6, bagBoxY + 50);
    if (carryLines[1]) doc.text(carryLines[1], bagColSplit + 6, bagBoxY + 63);

    // Personal item
    doc.setFont("helvetica", "bold");
    doc.text("Personal item", marginX + 6, bagBoxY + 86);
    doc.setFont("helvetica", "normal");
    const personalLines = (data.personalItem || "").split('\n');
    doc.text(personalLines[0] || "", bagColSplit + 6, bagBoxY + 85);
    if (personalLines[1]) doc.text(personalLines[1], bagColSplit + 6, bagBoxY + 98);

    cursorY += bagBoxHeight + 11;

    // Footnote
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...mutedColor);
    doc.text("* Total weight of personal item and carry-on baggage must not exceed 7 kg.", marginX, cursorY);

    cursorY += 18;

    // 6. IMPORTANT INFORMATION
    drawSectionTitle("Important Information", cursorY);
    cursorY += 14;

    const bullets = [
        {
            lead: "• Please arrive at the airport at least ",
            bold: "2 hours",
            tail: " before departure to allow enough time for check-in."
        },
        {
            lead: "• During airport procedures, passengers must present the valid ID used to purchase the ticket. Your boarding pass or itinerary may\n  also be required."
        },
        {
            lead: "• Tickets must be used in the sequence set out in the itinerary, otherwise the airline reserves the right to refuse carriage."
        },
        {
            lead: "• Please check the baggage information above for full details before travelling."
        }
    ];

    doc.setFontSize(8.5);
    doc.setTextColor(...darkColor);

    bullets.forEach(b => {
        if (b.bold) {
            doc.setFont("helvetica", "normal");
            doc.text(b.lead, marginX, cursorY);
            const leadW = doc.getTextWidth(b.lead);
            doc.setFont("helvetica", "bold");
            doc.text(b.bold, marginX + leadW, cursorY);
            const boldW = doc.getTextWidth(b.bold);
            doc.setFont("helvetica", "normal");
            doc.text(b.tail, marginX + leadW + boldW, cursorY);
            cursorY += 13.5;
        } else {
            doc.setFont("helvetica", "normal");
            const lines = b.lead.split('\n');
            lines.forEach(l => {
                doc.text(l, marginX, cursorY);
                cursorY += 12;
            });
            cursorY += 1.5;
        }
    });

    cursorY += 10;

    // Bottom Divider Line
    doc.setDrawColor(...redColor);
    doc.setLineWidth(1.7);
    doc.line(marginX, cursorY, marginX + contentWidth, cursorY);

    cursorY += 15;

    // Centered Footer Receipt Note
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(136, 136, 136);
    const footerMsg1 = `This document is an itinerary receipt for booking ${data.bookingNo || ''}. Please print it out and take it with you to ensure your trip goes as`;
    const footerMsg2 = `smoothly as possible.`;
    doc.text(footerMsg1, marginX + contentWidth / 2, cursorY, { align: "center" });
    doc.text(footerMsg2, marginX + contentWidth / 2, cursorY + 11, { align: "center" });

    return doc;
}

/**
 * Download the generated vector PDF
 */
export async function downloadAirAsiaPdf(data) {
    const doc = await generateAirAsiaPdfDoc(data);
    const safeName = (data.passengerName || 'AirAsia').replace(/[^a-zA-Z0-9]/g, '_');
    const safePnr = (data.pnr || data.bookingNo || 'Itinerary').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `AirAsia_Ticket_${safeName}_${safePnr}.pdf`;
    doc.save(filename);
    return filename;
}

/**
 * Generate preview HTML markup that renders identically to the PDF
 */
export function renderAirAsiaTicketHtml(data) {
    const logoSrc = cachedLogoDataUrl || 'airasia-logo.png';
    const checkedLines = (data.checkedBaggage || '').split('\n');
    const carryLines = (data.carryOnBaggage || '').split('\n');
    const personalLines = (data.personalItem || '').split('\n');

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#333333; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:40px 48px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.08); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.35; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:14px;">
            <div style="width:190px; height:80px; display:flex; align-items:center;">
                <img src="${logoSrc}" alt="AirAsia" style="max-width:100%; max-height:100%; object-fit:contain;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:26px; font-weight:800; color:#E31E24; letter-spacing:0.5px; line-height:1.1;">E-TICKET</div>
                <div style="font-size:12px; color:#444444; margin-top:4px;">Itinerary Receipt</div>
                <div style="font-size:12px; color:#444444; margin-top:2px;">Booking No. <strong>${data.bookingNo || ''}</strong></div>
            </div>
        </div>

        <!-- Top Red Rule -->
        <div style="height:4.5px; background:#E31E24; margin-bottom:20px;"></div>

        <!-- Booking Information Section -->
        <div style="margin-bottom:20px;">
            <div style="font-size:15px; font-weight:700; color:#E31E24; margin-bottom:8px;">Booking Information</div>
            <table style="width:100%; border-collapse:collapse; background:#F5F5F5; border:1px solid #CCCCCC; font-size:12px;">
                <tr>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:25%;"><strong>Booking No.</strong></td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:25%;">${data.bookingNo || ''}</td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:28%;"><strong>Airline Booking Reference</strong></td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:22%; font-weight:600;">${data.pnr || ''}</td>
                </tr>
                <tr>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC;"><strong>E-Ticket No.</strong></td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC;">${data.eTicketNo || 'To be advised at check-in'}</td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC;"><strong>Class</strong></td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC;">${data.flightClass || 'Economy'}</td>
                </tr>
            </table>
        </div>

        <!-- Passenger Section -->
        <div style="margin-bottom:20px;">
            <div style="font-size:15px; font-weight:700; color:#E31E24; margin-bottom:8px;">Passenger</div>
            <table style="width:100%; border-collapse:collapse; background:#F5F5F5; border:1px solid #CCCCCC; font-size:12px;">
                <thead>
                    <tr style="background:#E31E24; color:#FFFFFF;">
                        <th style="padding:8px 10px; text-align:left; border:1px solid #CCCCCC; width:68%; font-weight:700;">Name</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid #CCCCCC; width:32%; font-weight:700;">Type</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding:8px 10px; border:1px solid #CCCCCC; font-weight:600;">${data.passengerName || ''}</td>
                        <td style="padding:8px 10px; border:1px solid #CCCCCC;">${data.passengerType || 'Adult'}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Flight Information Section -->
        <div style="margin-bottom:20px;">
            <div style="font-size:15px; font-weight:700; color:#E31E24; margin-bottom:8px;">Flight Information</div>
            <table style="width:100%; border-collapse:collapse; background:#F5F5F5; border:1px solid #CCCCCC; font-size:12px;">
                <thead>
                    <tr style="background:#E31E24; color:#FFFFFF;">
                        <th style="padding:8px 10px; text-align:left; border:1px solid #CCCCCC; width:22%; font-weight:700;">Flight</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid #CCCCCC; width:40%; font-weight:700;">Departure</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid #CCCCCC; width:38%; font-weight:700;">Arrival</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding:10px; border:1px solid #CCCCCC; vertical-align:top;">
                            <div style="font-weight:700; font-size:13px; color:#111111;">${data.flightNo || ''}</div>
                            <div style="color:#555555; margin-top:2px;">${data.airlineName || ''}</div>
                        </td>
                        <td style="padding:10px; border:1px solid #CCCCCC; vertical-align:top;">
                            <div><strong>${data.depTime || ''}</strong>, ${data.depDateFormatted || ''}</div>
                            <div style="margin-top:2px; font-weight:500;">${data.depAirport || ''}</div>
                            ${data.depTerminal ? `<div style="color:#555555; margin-top:2px;">${data.depTerminal}</div>` : ''}
                        </td>
                        <td style="padding:10px; border:1px solid #CCCCCC; vertical-align:top;">
                            <div><strong>${data.arrTime || ''}</strong>, ${data.arrDateFormatted || ''}</div>
                            <div style="margin-top:2px; font-weight:500;">${data.arrAirport || ''}</div>
                            ${data.arrTerminal ? `<div style="color:#555555; margin-top:2px;">${data.arrTerminal}</div>` : ''}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:7px 10px; border:1px solid #CCCCCC;"><strong>Route</strong></td>
                        <td colspan="2" style="padding:7px 10px; border:1px solid #CCCCCC;">${data.route || ''}</td>
                    </tr>
                    <tr>
                        <td style="padding:7px 10px; border:1px solid #CCCCCC;"><strong>Class</strong></td>
                        <td colspan="2" style="padding:7px 10px; border:1px solid #CCCCCC;">${data.flightClass || 'Economy'}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Baggage Allowance Section -->
        <div style="margin-bottom:20px;">
            <div style="font-size:15px; font-weight:700; color:#E31E24; margin-bottom:8px;">Baggage Allowance</div>
            <table style="width:100%; border-collapse:collapse; background:#FDECEC; border:1px solid #E0AAAA; font-size:12px;">
                <tr>
                    <td style="padding:10px; border:1px solid #E0AAAA; width:28%; vertical-align:top;"><strong>Checked baggage</strong></td>
                    <td style="padding:10px; border:1px solid #E0AAAA; width:72%;">
                        <div style="font-weight:600;">${checkedLines[0] || '30 kg per person'}</div>
                        <div style="color:#555555; margin-top:2px;">${checkedLines[1] || 'Each piece max 119 x 119 x 81 cm (total 319 cm)'}</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding:10px; border:1px solid #E0AAAA; vertical-align:top;"><strong>Carry-on baggage</strong></td>
                    <td style="padding:10px; border:1px solid #E0AAAA;">
                        <div style="font-weight:600;">${carryLines[0] || '1 piece per person'}</div>
                        <div style="color:#555555; margin-top:2px;">${carryLines[1] || 'Max 56 x 36 x 23 cm per piece'}</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding:10px; border:1px solid #E0AAAA; vertical-align:top;"><strong>Personal item</strong></td>
                    <td style="padding:10px; border:1px solid #E0AAAA;">
                        <div style="font-weight:600;">${personalLines[0] || '1 piece per person'}</div>
                        <div style="color:#555555; margin-top:2px;">${personalLines[1] || 'Max 40 x 30 x 10 cm per piece, fits under the seat in front of you'}</div>
                    </td>
                </tr>
            </table>
            <div style="font-size:11px; color:#666666; margin-top:7px;">
                * Total weight of personal item and carry-on baggage must not exceed 7 kg.
            </div>
        </div>

        <!-- Important Information Section -->
        <div style="margin-bottom:20px;">
            <div style="font-size:15px; font-weight:700; color:#E31E24; margin-bottom:8px;">Important Information</div>
            <ul style="margin:0; padding-left:18px; font-size:11.5px; color:#333333; line-height:1.5;">
                <li style="margin-bottom:4px;">Please arrive at the airport at least <strong>2 hours</strong> before departure to allow enough time for check-in.</li>
                <li style="margin-bottom:4px;">During airport procedures, passengers must present the valid ID used to purchase the ticket. Your boarding pass or itinerary may also be required.</li>
                <li style="margin-bottom:4px;">Tickets must be used in the sequence set out in the itinerary, otherwise the airline reserves the right to refuse carriage.</li>
                <li style="margin-bottom:4px;">Please check the baggage information above for full details before travelling.</li>
            </ul>
        </div>

        <!-- Bottom Red Rule -->
        <div style="height:2px; background:#E31E24; margin-bottom:14px;"></div>

        <!-- Footer Receipt Note -->
        <div style="text-align:center; font-size:11px; color:#888888; line-height:1.4;">
            This document is an itinerary receipt for booking ${data.bookingNo || ''}. Please print it out and take it with you to ensure your trip goes as smoothly as possible.
        </div>

    </div>
    `;
}

/**
 * Export ticket as image (PNG)
 */
export async function downloadAirAsiaImage(data) {
    if (!window.html2canvas) {
        throw new Error('html2canvas library is not loaded');
    }
    const previewEl = document.getElementById('airAsiaTicketDocument');
    if (!previewEl) return;

    const canvas = await window.html2canvas(previewEl, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff'
    });

    const safeName = (data.passengerName || 'AirAsia').replace(/[^a-zA-Z0-9]/g, '_');
    const safePnr = (data.pnr || data.bookingNo || 'Itinerary').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `AirAsia_Ticket_${safeName}_${safePnr}.png`;

    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
    return filename;
}

/**
 * Share ticket via Web Share API
 */
export async function shareAirAsiaTicket(data) {
    const filename = await downloadAirAsiaPdf(data);
    showToast(`PDF downloaded: ${filename}`, 'success');

    if (navigator.share && navigator.canShare) {
        try {
            const doc = await generateAirAsiaPdfDoc(data);
            const blob = doc.output('blob');
            const file = new File([blob], filename, { type: 'application/pdf' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `AirAsia E-Ticket - ${data.passengerName || ''}`,
                    text: `AirAsia E-Ticket Itinerary Receipt for booking ${data.bookingNo || ''} (PNR: ${data.pnr || ''})`,
                    files: [file]
                });
            } else {
                await navigator.share({
                    title: `AirAsia E-Ticket - ${data.passengerName || ''}`,
                    text: `AirAsia E-Ticket Receipt for booking ${data.bookingNo || ''} (PNR: ${data.pnr || ''})`
                });
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.warn('Share error:', e);
            }
        }
    }
}
