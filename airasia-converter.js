/**
 * AirAsia E-Ticket Itinerary Generator & Converter
 * Converts Trip.com / OTA PDF itineraries into official AirAsia E-Ticket Receipts.
 */

import { showToast } from './utils.js';

let cachedAirAsiaLogoDataUrl = null;
let cachedVietJetLogoDataUrl = null;

/**
 * Preload and cache Airline logo as data URL for jsPDF and HTML preview
 */
export async function getAirlineLogoDataUrl(airline = 'AirAsia') {
    const isVietJet = (airline === 'VietJet Air') || /vietjet/i.test(airline || '');
    if (isVietJet && cachedVietJetLogoDataUrl) return cachedVietJetLogoDataUrl;
    if (!isVietJet && cachedAirAsiaLogoDataUrl) return cachedAirAsiaLogoDataUrl;

    const logoSrc = isVietJet ? 'vietjet-logo.png' : 'airasia-logo.png';
    try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = logoSrc;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (isVietJet) {
            cachedVietJetLogoDataUrl = dataUrl;
        } else {
            cachedAirAsiaLogoDataUrl = dataUrl;
        }
        return dataUrl;
    } catch (err) {
        console.warn(`Failed to load ${logoSrc} as data URL`, err);
        return logoSrc;
    }
}

/**
 * Backward compatibility alias
 */
export async function getAirAsiaLogoDataUrl() {
    return getAirlineLogoDataUrl('AirAsia');
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
    'phu quoc': 'PQC',
    'phú quốc': 'PQC',
    'ho chi minh': 'SGN',
    'tan son nhat': 'SGN',
    'saigon': 'SGN',
    'hanoi': 'HAN',
    'noi bai': 'HAN',
    'da nang': 'DAD',
    'cam ranh': 'CXR',
    'nha trang': 'CXR',
    'hai phong': 'HPH',
    'cat bi': 'HPH',
    'can tho': 'VCA',
    'hue': 'HUI',
    'phu bai': 'HUI',
    'vinh': 'VII',
    'da lat': 'DLI',
    'dalat': 'DLI',
    'lien khuong': 'DLI',
    'quy nhon': 'UIH',
    'phu cat': 'UIH',
    'buon ma thuot': 'BMV',
    'pleiku': 'PXU',
    'dong hoi': 'VDH',
    'chu lai': 'VCL',
    'con dao': 'VCS',
    'dien bien': 'DIN',
    'rach gia': 'VKG',
    'ca mau': 'CAH',
    'van don': 'VDO',
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
    const lower = name.toLowerCase();
    if (lower.includes('tan son nhat') || lower.includes('ho chi minh') || lower.includes('saigon')) return 'Ho Chi Minh City';
    if (lower.includes('phu quoc') || lower.includes('phú quốc')) return 'Phu Quoc';
    if (lower.includes('noi bai') || lower.includes('hanoi') || lower.includes('ha noi')) return 'Hanoi';
    if (lower.includes('da nang')) return 'Da Nang';
    if (lower.includes('cam ranh') || lower.includes('nha trang')) return 'Nha Trang';
    if (lower.includes('klia') || lower.includes('kuala lumpur')) return 'Kuala Lumpur';
    if (lower.includes('senai') || lower.includes('johor bahru')) return 'Johor Bahru';
    if (lower.includes('suvarnabhumi') || lower.includes('don mueang') || lower.includes('bangkok')) return 'Bangkok';
    if (lower.includes('yangon')) return 'Yangon';
    if (lower.includes('mandalay')) return 'Mandalay';
    if (lower.includes('narita') || lower.includes('haneda') || lower.includes('tokyo')) return 'Tokyo';
    if (lower.includes('singapore') || lower.includes('changi')) return 'Singapore';
    if (lower.includes('incheon') || lower.includes('seoul')) return 'Seoul';
    if (lower.includes('kansai') || lower.includes('osaka')) return 'Osaka';

    return name
        .replace(/\([A-Z]{3}\)/g, '')
        .replace(/\s*(?:International|Airport|Airfield|Senai|Terminal\s*[0-9A-Z]+|T\d+).*/i, '')
        .replace(/[,\-\/]+$/, '')
        .trim();
}

/**
 * Parse text extracted from Trip.com / OTA PDF itinerary
 */
export function parseItineraryText(rawText) {
    const clean = rawText.replace(/\u2236/g, ':');

    // 0. Airline Auto-Detection
    let airline = 'AirAsia';
    if (/(?:vietjet|viet\s*jet|\bVJ\d{3,4}\b|\bVZ\d{3,4}\b)/i.test(clean)) {
        airline = 'VietJet Air';
    } else if (/(?:airasia|air\s*asia|\b(?:AK|FD|QZ|D7|XJ|Z2)\d{3,4}\b)/i.test(clean)) {
        airline = 'AirAsia';
    }

    // 1. Booking No
    const bookingNoMatch = clean.match(/Booking\s*No\.?\s*([0-9A-Z]+)/i);
    const bookingNo = bookingNoMatch ? bookingNoMatch[1].trim() : '';

    // 2. Class - explicitly check for Cabin class only
    let flightClass = 'Economy';
    if (/\bPremium\s*Economy\b/i.test(clean)) flightClass = 'Premium Economy';
    else if (/\bBusiness\b/i.test(clean)) flightClass = 'Business';
    else if (/\bFirst\s+Class\b/i.test(clean)) flightClass = 'First Class';
    else if (/\bEconomy\b/i.test(clean)) flightClass = 'Economy';

    // 3. Airline Booking Reference (PNR) - collect all unique PNRs if multiple
    let pnr = '';
    const pnrMatches = [...clean.matchAll(/(?:Economy|Business|Premium\s*Economy)\s+(?:--|[0-9A-Z-]+)\s+([A-Z0-9]{5,7})\b/gi)];
    const pnrs = [];
    for (const m of pnrMatches) {
        const val = m[1].trim().toUpperCase();
        if (!/^(cannot|exceed|person|flight|adult)$/i.test(val) && !pnrs.includes(val)) {
            pnrs.push(val);
        }
    }
    if (pnrs.length === 0) {
        const pnrMatch = clean.match(/(?:Airline\s*Booking\s*Reference|PNR\s*[:\s]*)[^\n\r]*?([A-Z0-9]{5,7})\b/i);
        if (pnrMatch && !/^(cannot|exceed|person|flight|adult)$/i.test(pnrMatch[1])) {
            pnrs.push(pnrMatch[1].trim().toUpperCase());
        }
    }
    pnr = pnrs.join(' / ');

    // 4. E-Ticket No
    let eTicketNo = 'To be advised at check-in';
    const eticketMatch = clean.match(/E-ticket\s*No\.?\s*([0-9-]{10,})/i);
    if (eticketMatch && !eticketMatch[1].includes('--')) {
        eTicketNo = eticketMatch[1].trim();
    }

    // 5. Passengers (Supports Multiple Passengers)
    const passengers = [];
    const lines = clean.split(/[\r\n]+/);

    // Method A: Baggage section passenger lines "NAME (Adults)"
    for (const line of lines) {
        const m = line.trim().match(/^([A-Za-z\s]{3,45})\s*\((Adults?|Children|Infants?)\)$/i);
        if (m) {
            const rawName = m[1].replace(/\s+/g, ' ').trim().toUpperCase();
            if (!/^(kuala|johor|singapore|bangkok|baggage|flight|airline|personal|carry|phu quoc|ho chi|vietjet|airasia)/i.test(rawName)) {
                const pType = m[2].replace(/s$/i, '');
                const formattedType = pType.toLowerCase() === 'adult' ? 'Adult' : pType;
                if (!passengers.some(p => p.name === rawName)) {
                    passengers.push({ name: rawName, type: formattedType });
                }
            }
        }
    }

    // Method B: Passenger Table lines with (First name) or (Last name)
    if (passengers.length === 0) {
        for (const line of lines) {
            if (line.includes('(First name)') || line.includes('(Last name)') || /--\s+[A-Z0-9]{5,7}\b/i.test(line)) {
                let n = line.replace(/\(First\s*name\)/gi, '')
                            .replace(/\(Last\s*name\)/gi, '')
                            .replace(/(?:Economy|Business|Premium|--|[A-Z0-9]{5,7}).*/i, '')
                            .replace(/\s+/g, ' ')
                            .trim()
                            .toUpperCase();
                if (n && n.length > 2 && !/^(name|class|reference|airline|booking)/i.test(n)) {
                    if (!passengers.some(p => p.name === n)) {
                        passengers.push({ name: n, type: 'Adult' });
                    }
                }
            }
        }
    }

    // Method C: Fallback single match
    if (passengers.length === 0) {
        let singleName = '';
        let singleType = 'Adult';
        const paxBaggageMatch = clean.match(/\b([A-Z][A-Z\s]{2,35})\s*\((Adults?|Children|Infants?)\)/i);
        if (paxBaggageMatch && !/^(kuala|johor|singapore|bangkok|baggage|flight|airline|personal|carry)/i.test(paxBaggageMatch[1].trim())) {
            singleName = paxBaggageMatch[1].trim().toUpperCase();
            singleType = paxBaggageMatch[2].replace(/s$/i, '');
        } else {
            const nameBlockMatch = clean.match(/Reference[\s\n]+([A-Z\s\(\)]+?)(?=\s+(?:Economy|Business|Premium|--))/i) ||
                                   clean.match(/Name[\s\S]*?Reference[\s\n]+([A-Z\s\(\)]+?)(?=\s+(?:Economy|Business|Premium|--))/i);
            if (nameBlockMatch) {
                let n = nameBlockMatch[1]
                    .replace(/\(First\s*name\)/gi, '')
                    .replace(/\(Last\s*name\)/gi, '')
                    .replace(/Reference/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toUpperCase();
                if (n) singleName = n;
            }
        }
        if (singleName) {
            passengers.push({ name: singleName, type: singleType === 'adult' ? 'Adult' : singleType });
        }
    }

    const passengerName = passengers[0]?.name || '';
    const passengerType = passengers[0]?.type || 'Adult';

    // 6. Section-based Departure & Arrival Parser Helper
    function parseFlightSection(fullText, startWord, endWords) {
        const endGroup = endWords.map(w => `\\b${w}\\b`).join('|');
        const regex = new RegExp(`\\b${startWord}\\b([\\s\\S]*?)(?=${endGroup}|$)`, 'i');
        const match = fullText.match(regex);
        if (!match) return { time: '', dateRaw: '', terminal: '', airport: '' };
        let block = match[1].trim();

        // 1. Time
        let time = '';
        const timeMatch = block.match(/\b(\d{1,2})\s*[:.∶：]\s*(\d{2})\b/);
        if (timeMatch) {
            time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
            block = block.replace(timeMatch[0], ' ');
        }

        // 2. Date
        let dateRaw = '';
        const dateMatch = block.match(/\b([A-Za-z]{3,}\s+\d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Za-z]{3,},?\s*\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}[-\/]\d{1,2}[-\/]\d{1,2})\b/);
        if (dateMatch) {
            dateRaw = dateMatch[0].trim();
            block = block.replace(dateMatch[0], ' ');
        }

        // 3. Airport & Terminal
        let terminal = '';
        let airport = block
            .replace(/^[,\s\-\t:]+/, '')
            .replace(/[,\s\-\t:]+$/, '')
            .replace(/\s+/g, ' ')
            .trim();

        const endTermMatch = airport.match(/(?:,\s*)?(?:Terminal\s*([0-9A-Za-z]+)|T(\d+)|(?:\b([A-Z0-9])\b))\s*$/i);
        if (endTermMatch) {
            const val = endTermMatch[1] || endTermMatch[2] || endTermMatch[3];
            if (val && !/^(Airport|International|Domestic)$/i.test(val)) {
                terminal = `Terminal ${val}`;
                airport = airport.substring(0, endTermMatch.index).trim();
            }
        } else {
            const explicitTermMatch = airport.match(/\b(Terminal\s*[0-9A-Z]+|T\d+)\b/i);
            if (explicitTermMatch) {
                terminal = explicitTermMatch[0].replace(/^T(\d+)/i, 'Terminal $1');
                airport = airport.replace(explicitTermMatch[0], ' ').trim();
            }
        }

        if (!/airport/i.test(airport) && /international/i.test(airport)) {
            airport += ' Airport';
        }

        return { time, dateRaw, terminal, airport };
    }

    // 7. Parse Multiple Flight Sectors
    const flBlockMatch = clean.match(/Flight\s*Information([\s\S]*?)(?=Baggage\s*Allowance|$)/i);
    const flText = flBlockMatch ? flBlockMatch[1] : clean;

    const depMatches = [...flText.matchAll(/\bDeparture\b/gi)];
    const flights = [];

    if (depMatches.length === 0) {
        const dep = parseFlightSection(clean, 'Departure', ['Arrival']);
        const arr = parseFlightSection(clean, 'Arrival', ['Airline', 'Flight', 'Baggage', 'Personal', 'Carry']);
        const depCode = lookupAirportCode(dep.airport);
        let depAirport = dep.airport;
        if (depAirport && depCode && !depAirport.includes(`(${depCode})`)) depAirport += ` (${depCode})`;
        const arrCode = lookupAirportCode(arr.airport);
        let arrAirport = arr.airport;
        if (arrAirport && arrCode && !arrAirport.includes(`(${arrCode})`)) arrAirport += ` (${arrCode})`;
        const depCity = extractCityName(dep.airport);
        const arrCity = extractCityName(arr.airport);
        const route = `${depCity || 'DEP'} (${depCode || 'DEP'}) - ${arrCity || 'ARR'} (${arrCode || 'ARR'})`;

        flights.push({
            flightNo: '',
            airlineName: airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad',
            depTime: dep.time,
            depDateFormatted: formatTicketDate(dep.dateRaw),
            depAirport,
            depTerminal: dep.terminal,
            arrTime: arr.time,
            arrDateFormatted: formatTicketDate(arr.dateRaw),
            arrAirport,
            arrTerminal: arr.terminal,
            route
        });
    } else {
        for (let i = 0; i < depMatches.length; i++) {
            const curIdx = depMatches[i].index;
            const nextIdx = (i + 1 < depMatches.length) ? depMatches[i + 1].index : flText.length;
            
            const prevEnd = (i === 0) ? 0 : depMatches[i - 1].index;
            const leadingText = flText.substring(prevEnd, curIdx);
            
            const leadingLines = leadingText.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
            let sectorHeader = '';
            for (let j = leadingLines.length - 1; j >= 0; j--) {
                const line = leadingLines[j];
                if (line.includes('-') && !/transfer|baggage|flight information/i.test(line)) {
                    sectorHeader = line;
                    break;
                }
            }
            
            const segmentText = flText.substring(curIdx, nextIdx);
            
            const dep = parseFlightSection(segmentText, 'Departure', ['Arrival']);
            const arr = parseFlightSection(segmentText, 'Arrival', ['Airline', 'Flight', 'Transfer', 'Baggage']);
            
            let sectorAirline = airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad';
            let sectorFlightNo = '';
            const airMatch = segmentText.match(/Airline\s+(.*?)\s+(AK\d{3,4}|FD\d{3,4}|QZ\d{3,4}|D7\d{3,4}|XJ\d{3,4}|Z2\d{3,4}|VJ\d{3,4}|VZ\d{3,4}|[A-Z0-9]{2}\s*\d{3,4})\b/i);
            if (airMatch) {
                sectorAirline = airMatch[1].trim();
                sectorFlightNo = airMatch[2].replace(/\s+/g, '');
            } else {
                const fnMatch = segmentText.match(/\b(AK|FD|QZ|D7|XJ|Z2|VJ|VZ)\s*(\d{3,4})\b/i);
                if (fnMatch) {
                    sectorFlightNo = fnMatch[1].toUpperCase() + fnMatch[2];
                }
                const anMatch = segmentText.match(/Airline\s*[:\t ]+([^\\n\\r]+)/i);
                if (anMatch) {
                    sectorAirline = anMatch[1].replace(/(?:AK|FD|QZ|D7|XJ|Z2|VJ|VZ)\d+/i, '').trim() || sectorAirline;
                }
            }
            
            const depCode = lookupAirportCode(dep.airport);
            let depAirport = dep.airport;
            if (depAirport && depCode && !depAirport.includes(`(${depCode})`)) {
                depAirport += ` (${depCode})`;
            }
            
            const arrCode = lookupAirportCode(arr.airport);
            let arrAirport = arr.airport;
            if (arrAirport && arrCode && !arrAirport.includes(`(${arrCode})`)) {
                arrAirport += ` (${arrCode})`;
            }
            
            const depCity = extractCityName(dep.airport);
            const arrCity = extractCityName(arr.airport);
            let route = `${depCity || 'DEP'} (${depCode || 'DEP'}) - ${arrCity || 'ARR'} (${arrCode || 'ARR'})`;
            if ((!depCity || !arrCity) && sectorHeader) {
                route = sectorHeader;
            }
            
            flights.push({
                sectorHeader,
                flightNo: sectorFlightNo,
                airlineName: sectorAirline,
                depTime: dep.time,
                depDateFormatted: formatTicketDate(dep.dateRaw),
                depAirport,
                depTerminal: dep.terminal,
                arrTime: arr.time,
                arrDateFormatted: formatTicketDate(arr.dateRaw),
                arrAirport,
                arrTerminal: arr.terminal,
                route
            });
        }
    }

    const primaryFlight = flights[0] || {};

    // 8. Baggage
    const bagBlock = clean.match(/Checked\s*baggage[\s\S]*?(?=(?:Carry-on|Personal|Important|$))/i);
    const bagText = bagBlock ? bagBlock[0] : clean;

    const weightMatch = bagText.match(/(\d+)\s*kg/i);
    const weightVal = weightMatch ? weightMatch[1] : (airline === 'VietJet Air' ? '20' : '30');

    const dimMatch = bagText.match(/\(([0-9\s*xX]+cm)\)/i) ||
                     bagText.match(/(?:cannot\s*exceed|max)[\s\S]*?([0-9\s*xX]{7,}cm)/i);
    let dimStr = '119 x 119 x 81 cm';
    if (dimMatch) {
        dimStr = dimMatch[1].replace(/\s+/g, ' ').replace(/[xX]/g, ' x ').trim();
    }

    const totalMatch = bagText.match(/cannot\s*exceed\s*(\d+\s*cm)/i);
    const totalStr = totalMatch ? ` (total ${totalMatch[1]})` : '';

    const checkedBaggage = `${weightVal} kg per person\nEach piece max ${dimStr}${totalStr}`;

    const carryOnBaggage = '1 piece per person\nMax 56 x 36 x 23 cm per piece';
    const personalItem = '1 piece per person\nMax 40 x 30 x 10 cm per piece, fits under the seat in front of you';

    return {
        airline,
        bookingNo,
        pnr,
        flightClass,
        eTicketNo,
        passengerName,
        passengerType,
        passengers,
        flights,
        // Primary flight fields for backward compatibility
        flightNo: primaryFlight.flightNo || '',
        airlineName: primaryFlight.airlineName || (airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad'),
        depTime: primaryFlight.depTime || '',
        depDateFormatted: primaryFlight.depDateFormatted || '',
        depAirport: primaryFlight.depAirport || '',
        depTerminal: primaryFlight.depTerminal || '',
        arrTime: primaryFlight.arrTime || '',
        arrDateFormatted: primaryFlight.arrDateFormatted || '',
        arrAirport: primaryFlight.arrAirport || '',
        arrTerminal: primaryFlight.arrTerminal || '',
        route: primaryFlight.route || '',
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
        let pageText = '';
        let lastY = null;
        for (const item of textContent.items) {
            if (!item || typeof item.str !== 'string') continue;
            const currentY = (item.transform && item.transform.length > 5) ? item.transform[5] : null;
            if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 5) {
                pageText += '\n';
            } else if (pageText.length > 0 && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
                pageText += ' ';
            }
            pageText += item.str;
            if (currentY !== null) lastY = currentY;
        }
        fullText += pageText + '\n\n';
    }
    return fullText;
}


/**
 * Generate native vector jsPDF document matching the exact official template
 */
export async function generateAirAsiaPdfDoc(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const logoDataUrl = await getAirlineLogoDataUrl(isVietJet ? 'VietJet Air' : 'AirAsia');

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
            if (isVietJet) {
                doc.addImage(logoDataUrl, 'PNG', marginX, cursorY + 2, 115, 65);
            } else {
                doc.addImage(logoDataUrl, 'PNG', marginX, cursorY, 147, 63);
            }
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

    const bookNoVal = data.bookingNo || '';
    const bookNoLabel = "Booking No. ";
    doc.setFont("helvetica", "bold");
    doc.text(bookNoVal, rightX, cursorY + 53, { align: "right" });
    const bookNoValWidth = doc.getTextWidth(bookNoVal);
    doc.setFont("helvetica", "normal");
    doc.text(bookNoLabel, rightX - bookNoValWidth, cursorY + 53, { align: "right" });

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
    doc.setFont("helvetica", "bold");
    doc.text(data.bookingNo || "", col2X + 6, bookBoxY + 14);

    doc.setFont("helvetica", "bold");
    doc.text("Airline Booking Reference", col3X + 6, bookBoxY + 14);
    doc.setFont("helvetica", "bold");
    const pnrVal = data.pnr || "";
    if (doc.getTextWidth(pnrVal) > (contentWidth - (col4X - marginX) - 12)) {
        doc.setFontSize(8.0);
    }
    doc.text(pnrVal, col4X + 6, bookBoxY + 14);
    doc.setFontSize(9.5);

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

    const paxList = (data.passengers && data.passengers.length > 0)
        ? data.passengers
        : [{ name: data.passengerName || '', type: data.passengerType || 'Adult' }];

    const paxRowHeight = 22.5;
    let paxRowY = paxHeaderY + paxHeaderHeight;

    paxList.forEach((pax) => {
        doc.setFillColor(...greyBg);
        doc.rect(marginX, paxRowY, contentWidth, paxRowHeight, 'F');
        doc.setDrawColor(...borderGrey);
        doc.rect(marginX, paxRowY, contentWidth, paxRowHeight, 'S');
        doc.line(paxColSplit, paxRowY, paxColSplit, paxRowY + paxRowHeight);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(...darkColor);
        doc.text(pax.name || "", marginX + 6, paxRowY + 15);
        doc.setFont("helvetica", "normal");
        doc.text(pax.type || "Adult", paxColSplit + 6, paxRowY + 15);

        paxRowY += paxRowHeight;
    });

    cursorY = paxRowY + 20;

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

    let currentFlY = flHeaderY + flHeaderHeight;

    const flightsList = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || '',
            airlineName: data.airlineName || '',
            depTime: data.depTime || '',
            depDateFormatted: data.depDateFormatted || '',
            depAirport: data.depAirport || '',
            depTerminal: data.depTerminal || '',
            arrTime: data.arrTime || '',
            arrDateFormatted: data.arrDateFormatted || '',
            arrAirport: data.arrAirport || '',
            arrTerminal: data.arrTerminal || '',
            route: data.route || ''
        }];

    flightsList.forEach((f) => {
        const flRowHeight = 47.5;
        doc.setFillColor(...greyBg);
        doc.rect(marginX, currentFlY, contentWidth, flRowHeight, 'F');
        doc.setDrawColor(...borderGrey);
        doc.rect(marginX, currentFlY, contentWidth, flRowHeight, 'S');
        doc.line(flCol2, currentFlY, flCol2, currentFlY + flRowHeight);
        doc.line(flCol3, currentFlY, flCol3, currentFlY + flRowHeight);

        doc.setTextColor(...darkColor);
        doc.setFontSize(9.5);
        doc.setFont("helvetica", "bold");
        doc.text(f.flightNo || "", marginX + 6, currentFlY + 15);
        doc.setFont("helvetica", "normal");
        doc.text(f.airlineName || "", marginX + 6, currentFlY + 28);

        // Departure text
        doc.setFont("helvetica", "bold");
        doc.text(f.depTime || "", flCol2 + 6, currentFlY + 15);
        const depTimeWidth = doc.getTextWidth(f.depTime || "") + 1;
        doc.setFont("helvetica", "normal");
        doc.text(`, ${f.depDateFormatted || ""}`, flCol2 + 6 + depTimeWidth, currentFlY + 15);
        doc.text(f.depAirport || "", flCol2 + 6, currentFlY + 27.5);
        if (f.depTerminal) {
            doc.text(f.depTerminal, flCol2 + 6, currentFlY + 40);
        }

        // Arrival text
        doc.setFont("helvetica", "bold");
        doc.text(f.arrTime || "", flCol3 + 6, currentFlY + 15);
        const arrTimeWidth = doc.getTextWidth(f.arrTime || "") + 1;
        doc.setFont("helvetica", "normal");
        doc.text(`, ${f.arrDateFormatted || ""}`, flCol3 + 6 + arrTimeWidth, currentFlY + 15);
        const arrAirportLines = doc.splitTextToSize(f.arrAirport || "", contentWidth - (flCol3 - marginX) - 12);
        doc.text(arrAirportLines, flCol3 + 6, currentFlY + 27.5);
        if (f.arrTerminal) {
            doc.text(f.arrTerminal, flCol3 + 6, currentFlY + 40);
        }

        currentFlY += flRowHeight;

        // Route Row
        const flRouteRowHeight = 22.5;
        doc.setFillColor(...greyBg);
        doc.rect(marginX, currentFlY, contentWidth, flRouteRowHeight, 'F');
        doc.setDrawColor(...borderGrey);
        doc.rect(marginX, currentFlY, contentWidth, flRouteRowHeight, 'S');
        doc.line(flCol2, currentFlY, flCol2, currentFlY + flRouteRowHeight);

        doc.setFont("helvetica", "bold");
        doc.text("Route", marginX + 6, currentFlY + 15);
        doc.setFont("helvetica", "normal");
        doc.text(f.route || "", flCol2 + 6, currentFlY + 15);

        currentFlY += flRouteRowHeight;
    });

    // Class Row
    const flClassRowHeight = 22.5;
    doc.setFillColor(...greyBg);
    doc.rect(marginX, currentFlY, contentWidth, flClassRowHeight, 'F');
    doc.setDrawColor(...borderGrey);
    doc.rect(marginX, currentFlY, contentWidth, flClassRowHeight, 'S');
    doc.line(flCol2, currentFlY, flCol2, currentFlY + flClassRowHeight);

    doc.setFont("helvetica", "bold");
    doc.text("Class", marginX + 6, currentFlY + 15);
    doc.setFont("helvetica", "normal");
    doc.text(data.flightClass || "Economy", flCol2 + 6, currentFlY + 15);

    cursorY = currentFlY + flClassRowHeight + (flightsList.length > 1 ? 14 : 20);

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
            bold: "3 hours",
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
    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isVietJet ? 'VietJet' : 'AirAsia';
    const primaryName = (data.passengers && data.passengers[0]?.name) || data.passengerName || prefix;
    const safeName = primaryName.replace(/[^a-zA-Z0-9]/g, '_');
    const safePnr = (data.pnr || data.bookingNo || 'Itinerary').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${prefix}_Ticket_${safeName}_${safePnr}.pdf`;

    const doc = await generateAirAsiaPdfDoc(data);
    doc.save(filename);
    return filename;
}

/**
 * Generate preview HTML markup that renders identically to the PDF
 */
export function renderAirAsiaTicketHtml(data) {
    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const logoSrc = isVietJet ? (cachedVietJetLogoDataUrl || 'vietjet-logo.png') : (cachedAirAsiaLogoDataUrl || 'airasia-logo.png');
    const airlineTitle = isVietJet ? 'VietJet Air' : 'AirAsia';

    const checkedLines = (data.checkedBaggage || '').split('\n');
    const carryLines = (data.carryOnBaggage || '').split('\n');
    const personalLines = (data.personalItem || '').split('\n');

    const paxList = (data.passengers && data.passengers.length > 0)
        ? data.passengers
        : [{ name: data.passengerName || '', type: data.passengerType || 'Adult' }];

    const flightsList = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || '',
            airlineName: data.airlineName || (isVietJet ? 'VietJet Air' : 'AirAsia Berhad'),
            depTime: data.depTime || '',
            depDateFormatted: data.depDateFormatted || '',
            depAirport: data.depAirport || '',
            depTerminal: data.depTerminal || '',
            arrTime: data.arrTime || '',
            arrDateFormatted: data.arrDateFormatted || '',
            arrAirport: data.arrAirport || '',
            arrTerminal: data.arrTerminal || '',
            route: data.route || ''
        }];

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#333333; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:40px 48px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.08); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.35; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:14px;">
            <div style="width:190px; height:80px; display:flex; align-items:center;">
                <img src="${logoSrc}" alt="${airlineTitle}" style="max-width:100%; max-height:100%; object-fit:contain;">
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
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:25%; font-weight:700;">${data.bookingNo || ''}</td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:28%;"><strong>Airline Booking Reference</strong></td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:22%; font-weight:700;">${data.pnr || ''}</td>
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
                    ${paxList.map(p => `
                        <tr>
                            <td style="padding:8px 10px; border:1px solid #CCCCCC; font-weight:700;">${p.name || ''}</td>
                            <td style="padding:8px 10px; border:1px solid #CCCCCC;">${p.type || 'Adult'}</td>
                        </tr>
                    `).join('')}
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
                    ${flightsList.map(f => `
                    <tr>
                        <td style="padding:10px; border:1px solid #CCCCCC; vertical-align:top;">
                            <div style="font-weight:700; font-size:13px; color:#111111;">${f.flightNo || ''}</div>
                            <div style="color:#555555; margin-top:2px;">${f.airlineName || ''}</div>
                        </td>
                        <td style="padding:10px; border:1px solid #CCCCCC; vertical-align:top;">
                            <div><strong>${f.depTime || ''}</strong>, ${f.depDateFormatted || ''}</div>
                            <div style="margin-top:2px; font-weight:500;">${f.depAirport || ''}</div>
                            ${f.depTerminal ? `<div style="color:#555555; margin-top:2px;">${f.depTerminal}</div>` : ''}
                        </td>
                        <td style="padding:10px; border:1px solid #CCCCCC; vertical-align:top;">
                            <div><strong>${f.arrTime || ''}</strong>, ${f.arrDateFormatted || ''}</div>
                            <div style="margin-top:2px; font-weight:500;">${f.arrAirport || ''}</div>
                            ${f.arrTerminal ? `<div style="color:#555555; margin-top:2px;">${f.arrTerminal}</div>` : ''}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:7px 10px; border:1px solid #CCCCCC;"><strong>Route</strong></td>
                        <td colspan="2" style="padding:7px 10px; border:1px solid #CCCCCC;">${f.route || ''}</td>
                    </tr>
                    `).join('')}
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
                <li style="margin-bottom:4px;">Please arrive at the airport at least <strong>3 hours</strong> before departure to allow enough time for check-in.</li>
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

    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isVietJet ? 'VietJet' : 'AirAsia';
    const primaryName = (data.passengers && data.passengers[0]?.name) || data.passengerName || prefix;
    const safeName = primaryName.replace(/[^a-zA-Z0-9]/g, '_');
    const safePnr = (data.pnr || data.bookingNo || 'Itinerary').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${prefix}_Ticket_${safeName}_${safePnr}.png`;

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

    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isVietJet ? 'VietJet' : 'AirAsia';
    const primaryName = (data.passengers && data.passengers[0]?.name) || data.passengerName || prefix;

    if (navigator.share && navigator.canShare) {
        try {
            const doc = await generateAirAsiaPdfDoc(data);
            const blob = doc.output('blob');
            const file = new File([blob], filename, { type: 'application/pdf' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `${prefix} E-Ticket - ${primaryName}`,
                    text: `${prefix} E-Ticket Itinerary Receipt for booking ${data.bookingNo || ''} (PNR: ${data.pnr || ''})`,
                    files: [file]
                });
            } else {
                await navigator.share({
                    title: `${prefix} E-Ticket - ${primaryName}`,
                    text: `${prefix} E-Ticket Receipt for booking ${data.bookingNo || ''} (PNR: ${data.pnr || ''})`
                });
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.warn('Share error:', e);
            }
        }
    }
}
