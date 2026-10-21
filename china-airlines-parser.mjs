/**
 * Universal E-Ticket Itinerary & Travel Schedule Parser
 * Extracts flight sectors, dates, times, airports, terminals, flight numbers,
 * duration, passenger names, booking refs, and detects airline from Trip.com / Agoda schedules.
 */

export const AIRPORT_NAME_MAP = {
    RGN: 'YANGON INTL',
    TPE: 'TAIPEI TAIWAN TAOYUAN INTL',
    BKK: 'BANGKOK SUVARNABHUMI INTL',
    DMK: 'BANGKOK DON MUEANG INTL',
    SIN: 'SINGAPORE CHANGI INTL',
    HKG: 'HONG KONG INTL',
    KHH: 'KAOHSIUNG INTL',
    NRT: 'TOKYO NARITA INTL',
    HND: 'TOKYO HANEDA INTL',
    KIX: 'OSAKA KANSAI INTL',
    ICN: 'SEOUL INCHEON INTL',
    SGN: 'HO CHI MINH TAN SON NHAT INTL',
    HAN: 'HANOI NOI BAI INTL',
    CNX: 'CHIANG MAI INTL',
    MDL: 'MANDALAY INTL',
    MNL: 'MANILA NINOY AQUINO INTL',
    KUL: 'KUALA LUMPUR INTL',
    SFO: 'SAN FRANCISCO INTL',
    LAX: 'LOS ANGELES INTL',
    JFK: 'NEW YORK JOHN F. KENNEDY INTL',
    SYD: 'SYDNEY KINGSFORD SMITH INTL',
    MEL: 'MELBOURNE INTL',
    LHR: 'LONDON HEATHROW INTL',
    FRA: 'FRANKFURT MAIN INTL',
    AMS: 'AMSTERDAM SCHIPHOL INTL'
};

const MONTH_NAMES = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

const MONTH_FULL_NAMES = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];

/**
 * Separate City Name from Airport Name
 * Known multi-word cities or first word as City (e.g. BANGKOK SUVARNABHUMI INTL -> city: 'BANGKOK', airport: 'SUVARNABHUMI INTL')
 */
export function splitCityAndAirport(name) {
    if (!name) return { city: '', airport: '' };
    const str = String(name).trim();
    const multiWordCities = [
        'HO CHI MINH CITY', 'HO CHI MINH', 'KUALA LUMPUR', 'CHIANG MAI',
        'NEW YORK', 'SAN FRANCISCO', 'LOS ANGELES', 'HONG KONG',
        'DA NANG', 'PHNOM PENH', 'SIEM REAP', 'DON MUEANG', 'BANDAR SERI BEGAWAN'
    ];
    for (const mwc of multiWordCities) {
        if (str.toUpperCase().startsWith(mwc)) {
            const airport = str.slice(mwc.length).trim();
            return { city: str.slice(0, mwc.length), airport };
        }
    }
    const spaceIdx = str.indexOf(' ');
    if (spaceIdx === -1) {
        return { city: str, airport: '' };
    }
    return {
        city: str.slice(0, spaceIdx),
        airport: str.slice(spaceIdx + 1).trim()
    };
}

/**
 * Format passenger name ensuring (ADT) is attached for adults
 */
export function formatPassengerName(name) {
    if (!name || typeof name !== 'string') return '';
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return '';
    if (/\(ADT\)$/i.test(clean)) {
        return clean.replace(/\(adt\)$/i, '(ADT)');
    }
    if (/\((CHD|INF)\)$/i.test(clean)) {
        return clean;
    }
    return `${clean} (ADT)`;
}

/**
 * Generate seat number between rows 10-20 and columns A to F
 * e.g. 10A, 11D, 12F, 14B, 15C, 16A, 18D, 19E, 20F
 */
export function generateRandomSeat() {
    const rows = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
    const r = rows[Math.floor(Math.random() * rows.length)];
    const c = cols[Math.floor(Math.random() * cols.length)];
    return `${r}${c}`;
}

/**
 * Generate 6-character random alphanumeric PNR (Amadeus / Sabre style)
 */
export function generateBookingRef() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Generate 13-digit China Airlines ticket number (prefix 297)
 */
export function generateTicketNumber() {
    const min = 2000000000;
    const max = 2999999999;
    const serial = Math.floor(min + Math.random() * (max - min));
    return `297 ${serial}`;
}

/**
 * Format a Date object or date string into standard airline date: 25SEP2026
 */
export function formatAirlineDate(input, fullMonth = false) {
    if (!input) return '';
    let d;
    if (input instanceof Date) {
        d = input;
    } else if (typeof input === 'string') {
        const standardMatch = input.match(/^(\d{1,2})([A-Za-z]{3,9})(\d{4})$/);
        if (standardMatch) {
            const day = standardMatch[1].padStart(2, '0');
            const monStr = standardMatch[2].toUpperCase();
            const year = standardMatch[3];
            let monIdx = MONTH_NAMES.findIndex(m => monStr.startsWith(m));
            if (monIdx === -1) monIdx = MONTH_FULL_NAMES.findIndex(m => monStr.startsWith(m));
            if (monIdx !== -1) {
                return `${day}${fullMonth ? MONTH_FULL_NAMES[monIdx] : MONTH_NAMES[monIdx]}${year}`;
            }
            return input.toUpperCase();
        }

        const dateParts = input.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) || input.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (dateParts) {
            if (dateParts[1].length === 4) {
                d = new Date(parseInt(dateParts[1], 10), parseInt(dateParts[2], 10) - 1, parseInt(dateParts[3], 10));
            } else {
                d = new Date(parseInt(dateParts[3], 10), parseInt(dateParts[2], 10) - 1, parseInt(dateParts[1], 10));
            }
        } else {
            d = new Date(input);
        }
    }
    if (!d || isNaN(d.getTime())) return String(input).toUpperCase();

    const day = String(d.getDate()).padStart(2, '0');
    const mon = fullMonth ? MONTH_FULL_NAMES[d.getMonth()] : MONTH_NAMES[d.getMonth()];
    const yr = d.getFullYear();
    return `${day}${mon}${yr}`;
}

/**
 * Format Issue Date (like sample PDF: 18JULY2026 or 18JUL2026)
 */
export function formatIssueDate(input) {
    return formatAirlineDate(input, true);
}

/**
 * Calculate NVB & NVA based on China Airlines ticketing formulas
 */
export function calculateTicketValidity(departureDateStr, issueDateStr, mode = 'same_day') {
    const nvb = formatAirlineDate(departureDateStr);
    let nva = nvb;

    if (mode === '1_year') {
        const base = issueDateStr ? parseAirlineDateToDate(issueDateStr) : parseAirlineDateToDate(departureDateStr);
        if (base) {
            const plusYear = new Date(base.getTime());
            plusYear.setFullYear(plusYear.getFullYear() + 1);
            nva = formatAirlineDate(plusYear);
        }
    } else if (mode === '3_months') {
        const base = parseAirlineDateToDate(departureDateStr);
        if (base) {
            const plusMonths = new Date(base.getTime());
            plusMonths.setMonth(plusMonths.getMonth() + 3);
            nva = formatAirlineDate(plusMonths);
        }
    } else if (mode === '6_months') {
        const base = parseAirlineDateToDate(departureDateStr);
        if (base) {
            const plusMonths = new Date(base.getTime());
            plusMonths.setMonth(plusMonths.getMonth() + 6);
            nva = formatAirlineDate(plusMonths);
        }
    }
    return { nvb, nva };
}

export function parseAirlineDateToDate(str) {
    if (!str) return null;
    const m = String(str).match(/^(\d{1,2})([A-Za-z]{3,9})(\d{4})$/);
    if (!m) {
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }
    const day = parseInt(m[1], 10);
    const monStr = m[2].toUpperCase();
    const yr = parseInt(m[3], 10);
    let monIdx = MONTH_NAMES.findIndex(mon => monStr.startsWith(mon));
    if (monIdx === -1) monIdx = MONTH_FULL_NAMES.findIndex(mon => monStr.startsWith(mon));
    if (monIdx === -1) return null;
    return new Date(yr, monIdx, day);
}

/**
 * Parse duration e.g. "3h 55m", "Duration 4h 20m", "03:40" -> "03:55"
 */
export function normalizeDuration(str) {
    if (!str) return '03:40';
    const clean = String(str).trim();
    const hm = clean.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/i);
    if (hm) {
        const hours = hm[1].padStart(2, '0');
        const mins = (hm[2] || '0').padStart(2, '0');
        return `${hours}:${mins}`;
    }
    const colonMatch = clean.match(/(\d{1,2}):(\d{2})/);
    if (colonMatch) {
        return `${colonMatch[1].padStart(2, '0')}:${colonMatch[2]}`;
    }
    return clean;
}

/**
 * Resolve standard airport full name
 */
export function resolveAirportName(codeOrName) {
    if (!codeOrName) return '';
    const upper = String(codeOrName).trim().toUpperCase();
    const codeMatch = upper.match(/\b([A-Z]{3})\b/);
    if (codeMatch && AIRPORT_NAME_MAP[codeMatch[1]]) {
        return AIRPORT_NAME_MAP[codeMatch[1]];
    }

    let cleaned = upper
        .replace(/\b(T\d|TERMINAL\s*\d)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!/INTL|AIRPORT/i.test(cleaned)) {
        cleaned += ' INTL';
    }
    return cleaned;
}

/**
 * Detect airline template name from text or flight number
 */
export function detectAirlineFromText(text, flightNo = '') {
    const combined = `${flightNo} ${text}`.toUpperCase();
    if (/\bCI\s*\d/i.test(combined) || /CHINA\s*AIRLINES/i.test(combined)) {
        return 'China Airlines';
    }
    if (/\b(AK|FD|QZ|Z2|D7|XJ)\s*\d/i.test(combined) || /AIRASIA/i.test(combined)) {
        return 'AirAsia';
    }
    if (/\bVJ\s*\d/i.test(combined) || /VIETJET/i.test(combined)) {
        return 'VietJet Air';
    }
    if (/\bTG\s*\d/i.test(combined) || /THAI\s*AIRWAYS/i.test(combined)) {
        return 'Thai Airways';
    }
    if (/\bSQ\s*\d/i.test(combined) || /SINGAPORE\s*AIR/i.test(combined)) {
        return 'Singapore Airlines';
    }
    if (/\bBR\s*\d/i.test(combined) || /EVA\s*AIR/i.test(combined)) {
        return 'EVA Air';
    }
    if (/\bTR\s*\d/i.test(combined) || /SCOOT/i.test(combined)) {
        return 'Scoot';
    }
    return 'AirAsia';
}

/**
 * Get carrier title from flight number
 */
export function getAirlineCarrierName(flightNo, defaultName = 'China Airlines') {
    const fn = (flightNo || '').toUpperCase();
    if (/^CI/i.test(fn)) return 'CHINA AIRLINES LTD.';
    if (/^(AK|FD|QZ|Z2|D7)/i.test(fn)) return 'AirAsia';
    if (/^VJ/i.test(fn)) return 'VietJet Air';
    if (/^TG/i.test(fn)) return 'Thai Airways International';
    if (/^SQ/i.test(fn)) return 'Singapore Airlines';
    if (/^BR/i.test(fn)) return 'EVA Air';
    if (/^TR/i.test(fn)) return 'Scoot';
    return defaultName;
}

/**
 * Parse an itinerary schedule text or OCR output from Trip.com / Agoda
 * Supports all airlines (China Airlines, AirAsia, VietJet, Thai, SQ, EVA, Scoot)
 */
export function parseItinerarySchedule(rawText, defaultYear = new Date().getFullYear()) {
    if (!rawText || typeof rawText !== 'string') {
        return { passengerName: '', pnr: '', ticketNo: '', flights: [], detectedAirline: 'China Airlines' };
    }

    const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const flights = [];

    // Check for passenger name if present in text (default to empty string if not found)
    let passengerName = '';
    const paxMatch = text.match(/(?:Passenger|Guest|Name|Traveler|Pax)(?:\s*Name)?[:\s]+([A-Za-z\s/]+?)(?:\s*\(ADT\)|\n|$)/i);
    if (paxMatch && paxMatch[1].trim().length > 2) {
        passengerName = formatPassengerName(paxMatch[1]);
    }

    // Check for booking ref / PNR in text
    let pnr = '';
    const pnrMatch = text.match(/(?:Booking\s*ref|PNR|Airline\s*booking\s*ref|Reservation\s*code)[:\s]+([A-Z0-9]{6})/i);
    if (pnrMatch) {
        pnr = pnrMatch[1].toUpperCase();
    }

    // Check for ticket number
    let ticketNo = '';
    const tktMatch = text.match(/(?:Ticket\s*number|E-Ticket\s*No|TKT)[:\s]+(297\s*\d{10}|\d{13})/i);
    if (tktMatch) {
        const raw = tktMatch[1].replace(/\s+/g, '');
        ticketNo = `${raw.slice(0, 3)} ${raw.slice(3)}`;
    }

    // Universal flight number regex (supports CI, AK, FD, VJ, TG, SQ, BR, TR, etc.)
    const flightRegex = /(?:China\s*Airlines|AirAsia|VietJet|Thai\s*Airways|Singapore\s*Airlines|EVA\s*Air|Scoot)?\s*([A-Z0-9]{2}\s*\d{3,4})/gi;
    const sectorHeaderRegex = /([A-Za-z\s]+)\s*\(([A-Z]{3})\)\s*[-—=–]\s*([A-Za-z\s]+)\s*\(([A-Z]{3})\)(?:[^\n]*?\|\s*([A-Za-z]{3},\s*[A-Za-z]{3}\s*\d{1,2}))?(?:[^\n]*?Duration\s*([0-9hm\s]+))?/gi;

    const sectorMatches = [];
    let match;
    while ((match = sectorHeaderRegex.exec(text)) !== null) {
        sectorMatches.push({
            index: match.index,
            fromCity: match[1].trim(),
            fromCode: match[2].toUpperCase(),
            toCity: match[3].trim(),
            toCode: match[4].toUpperCase(),
            dateStr: match[5] ? match[5].trim() : '',
            durationStr: match[6] ? match[6].trim() : ''
        });
    }

    if (sectorMatches.length > 0) {
        for (let i = 0; i < sectorMatches.length; i++) {
            const current = sectorMatches[i];
            const nextIndex = (i + 1 < sectorMatches.length) ? sectorMatches[i + 1].index : text.length;
            const chunk = text.slice(current.index, nextIndex);

            // Flight number in chunk
            const fnMatch = chunk.match(/(?:China\s*Airlines|AirAsia|VietJet|Thai\s*Airways|Singapore\s*Airlines|EVA\s*Air|Scoot)?\s*([A-Z0-9]{2}\s*\d{3,4})/i) || chunk.match(/\b([A-Z0-9]{2}\s*\d{3,4})\b/i);
            const flightNo = fnMatch ? fnMatch[1].replace(/\s+/g, '').toUpperCase() : 'CI7916';

            // Times & Terminals
            const timeMatches = [];
            const timeRegex = /(\d{1,2}:\d{2})\s+([A-Z]{3})?([^\n]*?)(?:T(\d+)|Terminal\s*(\d+))?(?:\n|$)/gi;
            let tm;
            while ((tm = timeRegex.exec(chunk)) !== null) {
                timeMatches.push({
                    time: tm[1],
                    code: tm[2] || '',
                    line: tm[3] || '',
                    terminal: tm[4] || tm[5] || ''
                });
            }

            let depTime = '10:50';
            let arrTime = '16:15';
            let depTerminal = '';
            let arrTerminal = '';

            if (timeMatches.length >= 2) {
                depTime = timeMatches[0].time;
                depTerminal = timeMatches[0].terminal || '';
                arrTime = timeMatches[timeMatches.length - 1].time;
                arrTerminal = timeMatches[timeMatches.length - 1].terminal || '';
            } else {
                const genericTimes = chunk.match(/(\d{1,2}:\d{2})/g);
                if (genericTimes && genericTimes.length >= 2) {
                    depTime = genericTimes[0];
                    arrTime = genericTimes[1];
                }
                const termMatches = chunk.match(/T(\d+)|Terminal\s*(\d+)/gi);
                if (termMatches) {
                    const t1 = termMatches[0].match(/\d+/);
                    if (t1) depTerminal = t1[0];
                    if (termMatches.length > 1) {
                        const t2 = termMatches[1].match(/\d+/);
                        if (t2) arrTerminal = t2[0];
                    }
                }
            }

            // Parse Date
            let depDate = '';
            const dateChunkMatch = current.dateStr || (chunk.match(/(?:[A-Za-z]{3},\s*)?([A-Za-z]{3})\s*(\d{1,2})/i) ? chunk.match(/(?:[A-Za-z]{3},\s*)?([A-Za-z]{3})\s*(\d{1,2})/i)[0] : '');
            if (dateChunkMatch) {
                const dm = dateChunkMatch.match(/([A-Za-z]{3})\s*(\d{1,2})/i);
                if (dm) {
                    const mon = dm[1].toUpperCase();
                    const day = dm[2].padStart(2, '0');
                    depDate = `${day}${mon}${defaultYear}`;
                }
            }
            if (!depDate) {
                depDate = formatAirlineDate(new Date());
            }
            const arrDate = depDate;

            // Duration
            let duration = '03:40';
            if (current.durationStr) {
                duration = normalizeDuration(current.durationStr);
            } else {
                const durMatch = chunk.match(/Duration\s*([0-9hm\s]+)/i);
                if (durMatch) duration = normalizeDuration(durMatch[1]);
            }

            // Cabin class
            let cabinClass = 'Economy, Y';
            const classMatch = chunk.match(/(Economy|Business|Premium\s*Economy)(?:\s*class)?/i);
            if (classMatch) {
                const cName = classMatch[1].toLowerCase();
                if (cName.includes('business')) {
                    cabinClass = 'Business, C';
                } else if (cName.includes('premium')) {
                    cabinClass = 'Premium Economy, W';
                } else {
                    cabinClass = 'Economy, Y';
                }
            }

            const fromName = AIRPORT_NAME_MAP[current.fromCode] || resolveAirportName(current.fromCity || current.fromCode);
            const toName = AIRPORT_NAME_MAP[current.toCode] || resolveAirportName(current.toCity || current.toCode);
            const validity = calculateTicketValidity(depDate, depDate, 'same_day');
            const carrier = getAirlineCarrierName(flightNo);

            flights.push({
                from: fromName,
                depAirport: fromName,
                fromCode: current.fromCode,
                depTerminal: depTerminal || '1',
                to: toName,
                arrAirport: toName,
                toCode: current.toCode,
                arrTerminal: arrTerminal || '1',
                flightNo,
                depTime,
                depDate,
                depDateFormatted: depDate,
                arrTime,
                arrDate,
                arrDateFormatted: arrDate,
                cabinClass,
                flightClass: cabinClass,
                seat: generateRandomSeat(cabinClass),
                operatedBy: carrier,
                marketedBy: carrier,
                airlineName: carrier,
                bookingStatus: 'OK',
                baggage: '2PC',
                fareBasis: 'YOW',
                nvb: validity.nvb,
                nva: validity.nva,
                duration,
                route: `${current.fromCode} - ${current.toCode}`
            });
        }
    } else {
        // Fallback: look for flight numbers
        const ciMatches = [];
        let ciMatch;
        while ((ciMatch = flightRegex.exec(text)) !== null) {
            ciMatches.push({ index: ciMatch.index, flightNo: ciMatch[1].replace(/\s+/g, '').toUpperCase() });
        }

        if (ciMatches.length > 0) {
            for (let i = 0; i < ciMatches.length; i++) {
                const cur = ciMatches[i];
                const nextIdx = (i + 1 < ciMatches.length) ? ciMatches[i + 1].index : text.length;
                const chunk = text.slice(Math.max(0, cur.index - 100), nextIdx);

                const times = chunk.match(/(\d{1,2}:\d{2})/g) || ['10:50', '15:30'];
                const depTime = times[0] || '10:50';
                const arrTime = times[1] || '15:30';

                const codes = chunk.match(/\b([A-Z]{3})\b/g) || ['RGN', 'TPE'];
                const fromCode = codes[0] || 'RGN';
                const toCode = codes[1] || 'TPE';

                const curDate = formatAirlineDate(new Date());
                const validity = calculateTicketValidity(curDate, curDate, 'same_day');
                const carrier = getAirlineCarrierName(cur.flightNo);

                flights.push({
                    from: AIRPORT_NAME_MAP[fromCode] || resolveAirportName(fromCode),
                    depAirport: AIRPORT_NAME_MAP[fromCode] || resolveAirportName(fromCode),
                    fromCode,
                    depTerminal: '1',
                    to: AIRPORT_NAME_MAP[toCode] || resolveAirportName(toCode),
                    arrAirport: AIRPORT_NAME_MAP[toCode] || resolveAirportName(toCode),
                    toCode,
                    arrTerminal: '1',
                    flightNo: cur.flightNo,
                    depTime,
                    depDate: curDate,
                    depDateFormatted: curDate,
                    arrTime,
                    arrDate: curDate,
                    arrDateFormatted: curDate,
                    cabinClass: 'Economy, Y',
                    flightClass: 'Economy, Y',
                    seat: generateRandomSeat('Economy'),
                    operatedBy: carrier,
                    marketedBy: carrier,
                    airlineName: carrier,
                    bookingStatus: 'OK',
                    baggage: '2PC',
                    fareBasis: 'YOW',
                    nvb: validity.nvb,
                    nva: validity.nva,
                    duration: '03:55',
                    route: `${fromCode} - ${toCode}`
                });
            }
        }
    }

    const detectedAirline = detectAirlineFromText(text, flights[0]?.flightNo || '');

    return {
        passengerName, // Blank by default if not in schedule
        pnr: pnr || generateBookingRef(),
        ticketNo: ticketNo || generateTicketNumber(),
        flights,
        detectedAirline
    };
}
