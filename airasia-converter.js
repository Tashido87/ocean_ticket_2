/**
 * AirAsia E-Ticket Itinerary Generator & Converter
 * Converts Trip.com / OTA PDF itineraries into official AirAsia E-Ticket Receipts.
 */

import { showToast } from './utils.js';

let cachedAirAsiaLogoDataUrl = null;
let cachedVietJetLogoDataUrl = null;
let cachedThaiLogoDataUrl = null;

/**
 * Preload and cache Airline logo as data URL for jsPDF and HTML preview
 */
export async function getAirlineLogoDataUrl(airline = 'AirAsia') {
    const isThai = (airline === 'Thai Airways') || /thai\s*airways/i.test(airline || '');
    const isVietJet = (airline === 'VietJet Air') || /vietjet/i.test(airline || '');
    if (isThai && cachedThaiLogoDataUrl) return cachedThaiLogoDataUrl;
    if (isVietJet && cachedVietJetLogoDataUrl) return cachedVietJetLogoDataUrl;
    if (!isThai && !isVietJet && cachedAirAsiaLogoDataUrl) return cachedAirAsiaLogoDataUrl;

    const logoSrc = isThai ? 'thai-airways-logo.png?v=2' : (isVietJet ? 'vietjet-logo.png?v=2' : 'airasia-logo.png?v=2');
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
        if (isThai) {
            cachedThaiLogoDataUrl = dataUrl;
        } else if (isVietJet) {
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
    'nagoya': 'NGO',
    'chubu': 'NGO',
    'centrair': 'NGO',
    'taipei': 'TPE',
    'hong kong': 'HKG',
    'macau': 'MFM',
    'guangzhou': 'CAN',
    'shanghai': 'PVG',
    'phnom penh': 'PNH',
    'siem reap': 'REP',
    'vientiane': 'VTE',
    'london': 'LHR',
    'heathrow': 'LHR',
    'gatwick': 'LGW',
    'frankfurt': 'FRA',
    'paris': 'CDG',
    'charles de gaulle': 'CDG',
    'zurich': 'ZRH',
    'sydney': 'SYD',
    'melbourne': 'MEL',
    'brisbane': 'BNE',
    'perth': 'PER',
    'dubai': 'DXB',
    'doha': 'DOH',
    'delhi': 'DEL',
    'mumbai': 'BOM'
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
    if (lower.includes('london') || lower.includes('heathrow') || lower.includes('gatwick')) return 'London';
    if (lower.includes('paris') || lower.includes('charles de gaulle')) return 'Paris';
    if (lower.includes('frankfurt')) return 'Frankfurt';
    if (lower.includes('zurich')) return 'Zurich';
    if (lower.includes('sydney')) return 'Sydney';
    if (lower.includes('melbourne')) return 'Melbourne';

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
    const isThai = /(?:thai\s*airways|\bTG\s*\d{3,4}\b)/i.test(clean);
    const isVietJet = /(?:vietjet|viet\s*jet|\bVJ\d{3,4}\b|\bVZ\d{3,4}\b)/i.test(clean);
    const isAirAsia = /(?:airasia|air\s*asia|\b(?:AK|FD|QZ|D7|XJ|Z2)\d{3,4}\b)/i.test(clean);

    if (isThai) {
        airline = 'Thai Airways';
    } else if (isVietJet) {
        airline = 'VietJet Air';
    } else if (isAirAsia) {
        airline = 'AirAsia';
    }

    // 1. Booking No & PNR
    let pnr = '';
    const bookingNoMatch = clean.match(/Booking\s*No\.?\s*([0-9A-Z]+)/i);
    let bookingNo = bookingNoMatch ? bookingNoMatch[1].trim() : '';

    const invalidPnrs = /^(erence|reference|booking|flight|status|adult|cannot|exceed|person|economy|business|premium|first|details|ticket|passenger|notice|confirm|confirmed|baggage)$/i;
    const pnrs = [];

    // A. Trip.com OTA table match: "Economy -- XXXXXX" or "Business -- XXXXXX" (Supports multi-sector PNRs)
    const pnrMatches = [...clean.matchAll(/(?:Economy|Business|Premium\s*Economy)\s+(?:--|[0-9A-Z-]+)\s+([A-Z0-9]{5,7})\b/gi)];
    for (const m of pnrMatches) {
        const val = m[1].trim().toUpperCase();
        if (!invalidPnrs.test(val) && !pnrs.includes(val)) {
            pnrs.push(val);
        }
    }

    // B. Explicit colon match: "Booking Ref: XXXXXX", "Booking Reference: XXXXXX", "PNR: XXXXXX", "Airline Booking Reference: XXXXXX"
    if (pnrs.length === 0) {
        const colonMatch = clean.match(/(?:Booking\s*Ref(?:erence)?|PNR|Airline\s*Booking\s*Reference)\s*[:：]\s*([A-Z0-9]{5,7})\b/i);
        if (colonMatch && !invalidPnrs.test(colonMatch[1].trim())) {
            pnrs.push(colonMatch[1].trim().toUpperCase());
        }
    }

    // C. Direct newline match for standalone "Booking Ref\nXXXXXX"
    if (pnrs.length === 0) {
        const standaloneLineMatch = clean.match(/^[ \t]*Booking\s*Ref[ \t]*\r?\n[ \t]*([A-Z0-9]{5,7})\b/im);
        if (standaloneLineMatch && !invalidPnrs.test(standaloneLineMatch[1].trim())) {
            pnrs.push(standaloneLineMatch[1].trim().toUpperCase());
        }
    }

    // D. Fallback line match for 'Airline Booking Reference ... XXXXXX'
    if (pnrs.length === 0) {
        const pnrMatch = clean.match(/(?:Airline\s*Booking\s*Reference|PNR\s*[:\s]*)[^\n\r]*?([A-Z0-9]{5,7})\b/i);
        if (pnrMatch && !invalidPnrs.test(pnrMatch[1].trim())) {
            pnrs.push(pnrMatch[1].trim().toUpperCase());
        }
    }

    pnr = pnrs.join(' / ');
    if (!bookingNo && pnr) bookingNo = pnr;

    // 2. Class - explicitly check for Cabin class only
    let flightClass = 'Economy';
    const classDetailMatch = clean.match(/Class\s*\n\s*([^\n\r]+)/i) || clean.match(/\b(Economy\s*\([A-Z]\)|Business\s*\([A-Z]\)|First\s*\([A-Z]\))\b/i);
    if (classDetailMatch) {
        flightClass = classDetailMatch[1].trim();
    } else if (/\bPremium\s*Economy\b/i.test(clean)) flightClass = 'Premium Economy';
    else if (/\bBusiness\b/i.test(clean)) flightClass = 'Business';
    else if (/\bFirst\s+Class\b/i.test(clean)) flightClass = 'First Class';
    else if (/\bEconomy\b/i.test(clean)) flightClass = 'Economy';

    // 3. Issued Date
    let issuedDate = '';
    const issuedDateMatch = clean.match(/Issued\s*Date[:\s]*([0-9]{1,2}\s+[A-Za-z]{3,}\s+[0-9]{4}|[A-Za-z]{3,}\s+[0-9]{1,2},?\s+[0-9]{4})/i);
    if (issuedDateMatch) {
        issuedDate = issuedDateMatch[1].trim();
    } else {
        const today = new Date();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        issuedDate = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
    }

    // 4. Check-in notice
    let checkinNotice = '';
    const explicitCheckinMatch = clean.match(/CHECK[- ]?IN\s*(\([A-Za-z0-9\s]+\))?[:\s\-]*([0-9]{1,2}\s+[A-Za-z]{3,}\s*(?:[0-9]{4},?)?\s*[0-9]{1,2}:[0-9]{2}\s*(?:AM|PM)?)/i) ||
                                 clean.match(/CHECK[- ]?IN\s*(\([A-Za-z0-9\s]+\))?[:\s\-]*([0-9]{1,2}\s+[A-Za-z]{3,}\s+[0-9]{1,2}:[0-9]{2}\s*(?:AM|PM)?)/i);
    if (explicitCheckinMatch) {
        checkinNotice = explicitCheckinMatch[0].replace(/[\r\n]+/g, ' ').trim();
    } else {
        const checkinRuleMatch = clean.match(/(?:arrive\s+at\s+[^.\n\r]+?|at\s+least)\s*([0-9]{1,2}\s*(?:h|hr|hrs|hours?))\s*(?:prior to|before)\s*departure/i);
        if (checkinRuleMatch) {
            checkinNotice = `${checkinRuleMatch[1].trim()} before departure`;
        }
    }

    // 5. E-Ticket No
    let eTicketNo = 'To be advised at check-in';
    const eticketMatch = clean.match(/E-ticket\s*No\.?\s*([0-9-]{10,})/i);
    if (eticketMatch && !eticketMatch[1].includes('--')) {
        eTicketNo = eticketMatch[1].trim();
    }

    // 6. Passengers (Supports Multiple Passengers)
    const passengers = [];
    const lines = clean.split(/[\r\n]+/);

    // Method Thai Airways Table format
    const thaiPaxSection = clean.match(/Passenger\s*Details\s+([\s\S]*?)(?=Baggage|Notes|Important|$)/i);
    if (thaiPaxSection) {
        const pLines = thaiPaxSection[1].split(/[\r\n]+/).map(s => s.trim()).filter(s => s && !/^(Name|E-Ticket|Passport|Expiry|Passenger|Details)/i.test(s));
        let i = 0;
        while (i < pLines.length) {
            const nameCandidate = pLines[i];
            if (nameCandidate && nameCandidate.length > 2 && !/^\d+$/.test(nameCandidate)) {
                let pTicket = (i + 1 < pLines.length && /^\d{10,}$/.test(pLines[i + 1])) ? pLines[i + 1] : '';
                let pPassport = (i + 2 < pLines.length && /^[A-Z0-9]{6,10}$/.test(pLines[i + 2])) ? pLines[i + 2] : '';
                let pExpiry = (i + 3 < pLines.length && /^\d{4}-\d{2}-\d{2}$/.test(pLines[i + 3])) ? pLines[i + 3] : '';
                if (pTicket) {
                    passengers.push({
                        name: nameCandidate.toUpperCase(),
                        type: 'Adult',
                        eticket: pTicket,
                        eTicketNo: pTicket,
                        passport: pPassport,
                        expiry: pExpiry
                    });
                    i += 4;
                    continue;
                }
            }
            i++;
        }
    }

    // Method Thai Direct OCR/confirmation:
    if (passengers.length === 0) {
        const thaiBlockMatches = [...clean.matchAll(/([A-Z\s]{3,40})\s+([A-Z0-9]{6,10})[\r\n\s]+(Adult|Child|Infant)?\s*(\d{4}-\d{2}-\d{2})?[\r\n\s]+(?:E-Ticket\s*Number:?\s*(\d{10,}))/gi)];
        for (const m of thaiBlockMatches) {
            const rawName = m[1].replace(/\s+/g, ' ').trim().toUpperCase();
            if (!/^(kuala|bangkok|baggage|flight|airline|primary|contact)/i.test(rawName)) {
                passengers.push({
                    name: rawName,
                    passport: m[2],
                    type: m[3] || 'Adult',
                    expiry: m[4] || '',
                    eticket: m[5] || '',
                    eTicketNo: m[5] || ''
                });
            }
        }
    }

    // Method A: Baggage section passenger lines "NAME (Adults)"
    if (passengers.length === 0) {
        for (const line of lines) {
            const m = line.trim().match(/^([A-Za-z\s]{3,45})\s*\((Adults?|Children|Infants?)\)$/i);
            if (m) {
                const rawName = m[1].replace(/\s+/g, ' ').trim().toUpperCase();
                if (!/^(kuala|johor|singapore|bangkok|baggage|flight|airline|personal|carry|phu quoc|ho chi|vietjet|airasia)/i.test(rawName)) {
                    const pType = m[2].replace(/s$/i, '');
                    const formattedType = pType.toLowerCase() === 'adult' ? 'Adult' : pType;
                    if (!passengers.some(p => p.name === rawName)) {
                        passengers.push({ name: rawName, type: formattedType, eticket: '', passport: '', expiry: '' });
                    }
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
                        passengers.push({ name: n, type: 'Adult', eticket: '', passport: '', expiry: '' });
                    }
                }
            }
        }
    }

    // Method B2: Numbered passenger lines "1. NAME (Adult)" or "1. NAME E-Ticket: ..."
    if (passengers.length === 0) {
        for (const line of lines) {
            const numMatch = line.trim().match(/^(\d+)[\.\)]\s+([A-Za-z\s]{3,45}?)(?:\s+(Adult|Child|Infant)|\s+E-?Ticket|\s+Passport|\s*$)/i);
            if (numMatch) {
                const rawName = numMatch[2].replace(/\s+/g, ' ').trim().toUpperCase();
                if (rawName && rawName.length > 2 && !/^(kuala|johor|singapore|bangkok|baggage|flight|airline|personal|carry|route|terminal)/i.test(rawName)) {
                    const pTicketMatch = line.match(/(?:E-?Ticket|Ticket|Tkt)[:\s]*([0-9-]{10,})/i);
                    const pPassportMatch = line.match(/(?:Passport|PPT)[:\s]*([A-Z0-9]{6,10})/i);
                    const pExpiryMatch = line.match(/(?:Expiry|Exp)[:\s]*([0-9-]{4,10})/i);
                    if (!passengers.some(p => p.name === rawName)) {
                        passengers.push({
                            name: rawName,
                            type: numMatch[3] ? (numMatch[3].toLowerCase() === 'adult' ? 'Adult' : numMatch[3]) : 'Adult',
                            eticket: pTicketMatch ? pTicketMatch[1].trim() : '',
                            eTicketNo: pTicketMatch ? pTicketMatch[1].trim() : '',
                            passport: pPassportMatch ? pPassportMatch[1].trim() : '',
                            expiry: pExpiryMatch ? pExpiryMatch[1].trim() : ''
                        });
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
            passengers.push({ name: singleName, type: singleType === 'adult' ? 'Adult' : singleType, eticket: '', passport: '', expiry: '' });
        }
    }

    const passengerName = passengers[0]?.name || '';
    const passengerType = passengers[0]?.type || 'Adult';

    // 7. Section-based Departure & Arrival Parser Helper
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
        const dateMatch = block.match(/\b([A-Za-z]{3,}\s+\d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Za-z]{3,},?\s*\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}[-\/]\d{1,2}[-\/]\d{4})\b/);
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

    // 8. Parse Multiple Flight Sectors
    const flights = [];

    // Check Thai Airways direct Flight Details block:
    const thaiFlMatch = clean.match(/Flight\s*Details\s+([\s\S]*?)(?=Passenger\s*Details|Baggage|Notes|$)/i);
    if (airline === 'Thai Airways' && thaiFlMatch) {
        const tfText = thaiFlMatch[1].trim();
        const tfLines = tfText.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
        
        let headerRoute = '';
        let routeMatch = tfLines[0]?.match(/^([A-Za-z\s]+?)\s+(?:v|»|✈|->|-)\s+([A-Za-z\s]+?)$/i);
        let depCity = routeMatch ? routeMatch[1].trim() : '';
        let arrCity = routeMatch ? routeMatch[2].trim() : '';

        let flightNo = 'TG 910';
        let carrier = 'Thai Airways International';
        let flCarrierMatch = tfLines[1]?.match(/(TG\s*\d{3,4})\s*(?:\||-)?\s*(.*)/i);
        if (flCarrierMatch) {
            flightNo = flCarrierMatch[1].toUpperCase();
            carrier = flCarrierMatch[2].trim() || carrier;
        }

        let depTime = tfLines[2] || '';
        let arrTime = tfLines[3] || '';
        let depDateFormatted = tfLines[4] || '';
        let arrDateFormatted = tfLines[5] || '';
        let depAirport = tfLines[6] || '';
        let arrAirport = tfLines[7] || '';

        const durationMatch = tfText.match(/Duration\s*\n\s*([^\n\r]+)/i);
        const aircraftMatch = tfText.match(/Aircraft\s*\n\s*([^\n\r]+)/i);
        const classMatch = tfText.match(/Class\s*\n\s*([^\n\r]+)/i);
        const routeCodeMatch = tfText.match(/Route\s*\n\s*([^\n\r]+)/i);

        const duration = durationMatch ? durationMatch[1].trim() : '12h 30min, Non-Stop';
        const aircraft = aircraftMatch ? aircraftMatch[1].trim() : 'Boeing 777-300ER';
        const secClass = classMatch ? classMatch[1].trim() : flightClass;
        const route = routeCodeMatch ? routeCodeMatch[1].trim() : (depCity && arrCity ? `${depCity} - ${arrCity}` : 'BKK - LHR');

        let depTerminal = '';
        let arrTerminal = '';
        const depTermMatch = depAirport.match(/,\s*(Terminal\s*[0-9A-Z]+|T\d+)/i);
        if (depTermMatch) {
            depTerminal = depTermMatch[1];
            depAirport = depAirport.replace(depTermMatch[0], '').trim();
        }
        const arrTermMatch = arrAirport.match(/,\s*(Terminal\s*[0-9A-Z]+|T\d+)/i);
        if (arrTermMatch) {
            arrTerminal = arrTermMatch[1];
            arrAirport = arrAirport.replace(arrTermMatch[0], '').trim();
        }

        flights.push({
            sectorHeader: headerRoute,
            flightNo,
            airlineName: carrier,
            depTime,
            depDateFormatted,
            depAirport,
            depTerminal,
            arrTime,
            arrDateFormatted,
            arrAirport,
            arrTerminal,
            route,
            duration,
            aircraft,
            flightClass: secClass
        });
    }

    // If flights is still empty, parse using standard sector method
    if (flights.length === 0) {
        const flBlockMatch = clean.match(/Flight\s*Information([\s\S]*?)(?=Important\s*Information|Baggage\s*Allowance|Baggage\s*Details|$)/i);
        const flText = flBlockMatch ? flBlockMatch[1] : clean;

        const depMatches = [...flText.matchAll(/\bDeparture\b/gi)];

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

            const defaultCarrier = airline === 'Thai Airways' ? 'Thai Airways International' : (airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad');
            const defaultFlightNo = airline === 'Thai Airways' ? 'TG 910' : '';

            flights.push({
                flightNo: defaultFlightNo,
                airlineName: defaultCarrier,
                depTime: dep.time,
                depDateFormatted: formatTicketDate(dep.dateRaw),
                depAirport,
                depTerminal: dep.terminal,
                arrTime: arr.time,
                arrDateFormatted: formatTicketDate(arr.dateRaw),
                arrAirport,
                arrTerminal: arr.terminal,
                route,
                duration: '12h 30min, Non-Stop',
                aircraft: 'Boeing 777-300ER',
                flightClass
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
                
                // If segment has no departure time and no arrival info, skip non-flight text
                if (!dep.time && !arr.time && !/Airline\s+/i.test(segmentText)) {
                    continue;
                }
                
                let sectorAirline = airline === 'Thai Airways' ? 'Thai Airways International' : (airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad');
                let sectorFlightNo = '';
                
                const airMatch = segmentText.match(/Airline\s+(.*?)\s+(AK\d{3,4}|FD\d{3,4}|QZ\d{3,4}|D7\d{3,4}|XJ\d{3,4}|Z2\d{3,4}|VJ\d{3,4}|VZ\d{3,4}|TG\s*\d{3,4}|[A-Z0-9]{2}\s*\d{3,4})\b/i);
                if (airMatch) {
                    sectorAirline = airMatch[1].trim();
                    sectorFlightNo = airMatch[2].replace(/\s+/g, '');
                    if (/^TG\d/i.test(sectorFlightNo)) sectorFlightNo = sectorFlightNo.replace(/^TG/i, 'TG ');
                } else {
                    const fnMatch = segmentText.match(/\b(AK|FD|QZ|D7|XJ|Z2|VJ|VZ|TG)\s*(\d{3,4})\b/i);
                    if (fnMatch) {
                        sectorFlightNo = fnMatch[1].toUpperCase() === 'TG' ? `TG ${fnMatch[2]}` : (fnMatch[1].toUpperCase() + fnMatch[2]);
                    }
                    const anMatch = segmentText.match(/Airline\s*[:\t ]+([^\\n\\r]+)/i);
                    if (anMatch) {
                        sectorAirline = anMatch[1].replace(/(?:AK|FD|QZ|D7|XJ|Z2|VJ|VZ|TG)\d+/i, '').trim() || sectorAirline;
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

                const acMatch = segmentText.match(/(Boeing\s*[\w-]+|Airbus\s*[\w-]+|A3\d{2}[\w-]*|B7\d{2}[\w-]*)/i);
                const aircraft = acMatch ? acMatch[1].trim() : 'Boeing 777-300ER';

                const durMatch = segmentText.match(/(\d+h\s*\d+m(?:in)?)/i);
                const duration = durMatch ? durMatch[1].trim() : '12h 30min, Non-Stop';
                
                flights.push({
                    sectorHeader,
                    flightNo: sectorFlightNo || (airline === 'Thai Airways' ? 'TG 910' : ''),
                    airlineName: sectorAirline,
                    depTime: dep.time,
                    depDateFormatted: formatTicketDate(dep.dateRaw),
                    depAirport,
                    depTerminal: dep.terminal,
                    arrTime: arr.time,
                    arrDateFormatted: formatTicketDate(arr.dateRaw),
                    arrAirport,
                    arrTerminal: arr.terminal,
                    route,
                    duration,
                    aircraft,
                    flightClass
                });
            }
        }
    }

    const primaryFlight = flights[0] || {};

    // Auto-calculate check-in notice if not already extracted or if it's a relative rule
    if (flights.length > 0) {
        const depCode = lookupAirportCode(primaryFlight.depAirport) || 'BKK';
        if (!checkinNotice || /before departure/i.test(checkinNotice)) {
            let calculated = false;
            if (primaryFlight.depTime && primaryFlight.depDateFormatted) {
                try {
                    const d = new Date(`${primaryFlight.depDateFormatted} ${primaryFlight.depTime}`);
                    if (!isNaN(d.getTime())) {
                        d.setHours(d.getHours() - 3);
                        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const hours = d.getHours();
                        const minutes = String(d.getMinutes()).padStart(2, '0');
                        const ampm = hours >= 12 ? 'PM' : 'AM';
                        const h12 = hours % 12 || 12;
                        checkinNotice = `(${depCode}) ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${h12}:${minutes} ${ampm}`;
                        calculated = true;
                    }
                } catch (e) {}
            }
            if (!calculated) {
                checkinNotice = `(${depCode}) 3 hours before departure`;
            }
        } else if (!checkinNotice.includes('(')) {
            checkinNotice = `(${depCode}) ${checkinNotice}`;
        }
    }

    // 9. Baggage
    let checkedBaggage = '30 kg per person\nEach piece max 119 x 119 x 81 cm (total 319 cm)';
    let carryOnBaggage = '1 piece per person\nMax 56 x 36 x 23 cm per piece';
    let personalItem = '1 piece per person\nMax 40 x 30 x 10 cm per piece, fits under the seat in front of you';

    if (airline === 'Thai Airways') {
        const thaiBagMatch = clean.match(/Checked:\s*([^\n\r]+)/i);
        if (thaiBagMatch) {
            checkedBaggage = `Checked: ${thaiBagMatch[1].trim()}`;
        } else {
            const bagWeight = clean.match(/(\d+)\s*kg/i);
            if (bagWeight && bagWeight[1] === '23') {
                checkedBaggage = 'Checked: 2 Pcs, 23 kg   |   Carry-on: 7 kg';
            } else if (bagWeight) {
                checkedBaggage = `Checked: ${bagWeight[1]} kg   |   Carry-on: 7 kg`;
            } else {
                checkedBaggage = 'Checked: 2 Pcs, 23 kg   |   Carry-on: 7 kg';
            }
        }
    } else {
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

        checkedBaggage = `${weightVal} kg per person\nEach piece max ${dimStr}${totalStr}`;
    }

    // Assign individual sector PNR to each flight if multiple PNRs exist
    flights.forEach((f, idx) => {
        if (!f.pnr) {
            f.pnr = (pnrs && pnrs[idx]) ? pnrs[idx] : (pnrs && pnrs[0] ? pnrs[0] : pnr);
        }
    });

    return {
        airline,
        bookingNo,
        pnr,
        pnrs,
        flightClass,
        eTicketNo,
        issuedDate,
        checkinNotice,
        passengerName,
        passengerType,
        passengers,
        flights,
        // Primary flight fields for backward compatibility
        flightNo: primaryFlight.flightNo || '',
        airlineName: primaryFlight.airlineName || (airline === 'Thai Airways' ? 'Thai Airways International' : (airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad')),
        depTime: primaryFlight.depTime || '',
        depDateFormatted: primaryFlight.depDateFormatted || '',
        depAirport: primaryFlight.depAirport || '',
        depTerminal: primaryFlight.depTerminal || '',
        arrTime: primaryFlight.arrTime || '',
        arrDateFormatted: primaryFlight.arrDateFormatted || '',
        arrAirport: primaryFlight.arrAirport || '',
        arrTerminal: primaryFlight.arrTerminal || '',
        route: primaryFlight.route || '',
        duration: primaryFlight.duration || '12h 30min, Non-Stop',
        aircraft: primaryFlight.aircraft || 'Boeing 777-300ER',
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
 * Generate native vector jsPDF document for Thai Airways matching official template
 * Layout: Header → Booking Strip → Flight Details → Passenger Details → Baggage → Notes → Footer
 */
// Embedded 48x48 crisp white right-pointing airplane icon (facing destination)
const AIRPLANE_WHITE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAbElEQVR4nO3VuxGAMAyD4YhjKxiHIiOxrSjoOAqby6Pg/2qdI6dxKQAAAACAORQN2q49izxJOkO56EDb/l4nT1K4W4hvR9Oh7+/UzGctPcuMwAKzscBsLDDbmszvA+7Zlgn/5xIDAAAAABq7AKFlHkgPZB8oAAAAAElFTkSuQmCC';

export async function generateThaiAirwaysPdfDoc(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getAirlineLogoDataUrl('Thai Airways');

    const marginL = 42.5;
    const rightEdge = 552.8;
    const textW = rightEdge - marginL; // 510.3 pt

    const P = [61, 30, 109];       // #3D1E6D
    const A = [217, 163, 0];       // #D9A300
    const T = [246, 243, 251];     // #F6F3FB
    const AT = [253, 246, 227];    // #FDF6E3
    const PB = [213, 203, 232];    // #D5CBE8
    const LP = [240, 232, 255];    // #F0E8FF
    const DK = [51, 51, 51];       // #333333
    const MUT = [136, 136, 136];   // #888888
    const WHT = [255, 255, 255];   // #FFFFFF
    const BLK = [17, 17, 17];      // #111111

    const pnr = (data.pnr || data.bookingNo || '').trim().toUpperCase();
    const issuedDate = data.issuedDate || formatTicketDate(new Date());
    const paxList = (data.passengers && data.passengers.length > 0)
        ? data.passengers
        : [{ name: data.passengerName || '', type: data.passengerType || 'Adult', eticket: data.eTicketNo || '', passport: '', expiry: '' }];
    const paxSummary = paxList.length === 1 ? `1 ${paxList[0].type || 'Adult'}` : `${paxList.length} Adults`;

    const flights = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || 'TG 910', airlineName: 'Thai Airways International',
            depTime: data.depTime || '00:45', depDateFormatted: data.depDateFormatted || 'Wednesday, 30 September 2026',
            depAirport: data.depAirport || 'Bangkok - Suvarnabhumi Intl (BKK)', depTerminal: data.depTerminal || '',
            arrTime: data.arrTime || '07:15', arrDateFormatted: data.arrDateFormatted || 'Wednesday, 30 September 2026',
            arrAirport: data.arrAirport || 'London - Heathrow (LHR)', arrTerminal: data.arrTerminal || 'Terminal 2',
            route: data.route || 'BKK - LHR', duration: data.duration || '12h 30min, Non-Stop', aircraft: data.aircraft || 'Boeing 777-300ER', flightClass: data.flightClass || 'Economy (T)'
        }];
    const firstFlight = flights[0];
    const depCity = extractCityName(firstFlight.depAirport) || 'Bangkok';
    const arrCity = extractCityName(firstFlight.arrAirport) || 'London';

    let checkinNotice = (data.checkinNotice || '').trim();
    const firstDepCode = lookupAirportCode(firstFlight.depAirport) || 'BKK';

    // Auto-calculate check-in notice if not provided
    if (!checkinNotice) {
        if (firstFlight.depTime && firstFlight.depDateFormatted) {
            try {
                const d = new Date(`${firstFlight.depDateFormatted} ${firstFlight.depTime}`);
                if (!isNaN(d.getTime())) {
                    d.setHours(d.getHours() - 3);
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const hours = d.getHours();
                    const minutes = String(d.getMinutes()).padStart(2, '0');
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    const h12 = hours % 12 || 12;
                    checkinNotice = `(${firstDepCode}) ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${h12}:${minutes} ${ampm}`;
                }
            } catch (e) {}
        }
        if (!checkinNotice) {
            checkinNotice = `(${firstDepCode}) 3 hours before departure`;
        }
    }

    let checkinLbl = `Check-in (${firstDepCode})`;
    let checkinVal = '';

    if (checkinNotice) {
        const parenMatch = checkinNotice.match(/\(([A-Za-z0-9\s]+)\)/);
        const codeInParen = parenMatch ? parenMatch[1].trim() : firstDepCode;
        const resolvedCode = lookupAirportCode(codeInParen) || codeInParen;
        checkinLbl = `Check-in (${resolvedCode})`;

        checkinVal = checkinNotice
            .replace(/^check[- ]?in/i, '')
            .replace(/\([^)]+\)/g, '')
            .replace(/^[\s:\-]+/, '')
            .trim();
    }
    if (!checkinVal) {
        checkinVal = '3 hours before departure';
    }

    // 1. HEADER
    // Logo: width ~150, height ~44 (aspect ratio 3.4:1)
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', 42.5, 40, 150, 44);
        } catch (e) {
            console.warn('Logo load error', e);
        }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...P);
    doc.text("E-TICKET", rightEdge, 58, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...DK);
    doc.text("Booking Confirmed", rightEdge, 73, { align: "right" });
    doc.text("Thai Airways International (TG)", rightEdge, 86, { align: "right" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...P);
    doc.text(`Booking Ref: ${pnr}`, rightEdge, 104, { align: "right" });

    // Gold Rule below header
    doc.setDrawColor(...A);
    doc.setLineWidth(2.83); // 1mm
    doc.line(48.5, 122.4, 546.8, 122.4);

    // 2. BOOKING STRIP
    const stripY = 137.5;
    const stripH = 58.5;
    doc.setFillColor(...T);
    doc.rect(marginL, stripY, textW, stripH, 'F');
    doc.setDrawColor(...PB);
    doc.setLineWidth(0.5);
    doc.rect(marginL, stripY, textW, stripH, 'S');

    // Horizontal divider
    doc.line(marginL, stripY + 23.5, rightEdge, stripY + 23.5);
    // Vertical dividers (matches reference exactly: 127.6, 240.9, 326.0, 439.4, 501.7)
    const sCols = [127.6, 240.9, 326.0, 439.4, 501.7];
    sCols.forEach(x => doc.line(x, stripY, x, stripY + stripH));

    // Strip Row 1
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DK);
    doc.text("Booking Ref", marginL + 5, stripY + 15.5);
    const pnrFontSize = pnr.length > 10 ? 8.0 : (pnr.length > 7 ? 8.5 : 9.5);
    doc.setFontSize(pnrFontSize);
    doc.setTextColor(...BLK);
    doc.text(pnr, 127.6 + 5, stripY + 15.5, { maxWidth: 103 });

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DK);
    doc.text("Issued Date", 240.9 + 5, stripY + 15.5);
    doc.setFont("helvetica", "normal");
    doc.text(issuedDate, 326.0 + 5, stripY + 15.5, { maxWidth: 80 });

    doc.setFont("helvetica", "bold");
    doc.text("Passengers", 439.4 + 5, stripY + 15.5);
    doc.setFont("helvetica", "normal");
    doc.text(paxSummary, 501.7 + 5, stripY + 15.5, { maxWidth: 40 });

    // Strip Row 2
    doc.setFont("helvetica", "bold");
    doc.text(checkinLbl, marginL + 5, stripY + 39, { maxWidth: 70 });
    doc.setFont("helvetica", "normal");
    const checkinLines = doc.splitTextToSize(checkinVal, 103);
    doc.setFontSize(8.5);
    if (checkinLines.length > 1) {
        doc.text(checkinLines.slice(0, 2), 127.6 + 5, stripY + 34);
    } else {
        doc.text(checkinLines[0] || '', 127.6 + 5, stripY + 39);
    }

    doc.setFont("helvetica", "bold");
    doc.text("Status", 240.9 + 5, stripY + 39);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BLK);
    doc.text("Confirmed", 326.0 + 5, stripY + 39);

    doc.setTextColor(...DK);
    doc.setFont("helvetica", "bold");
    doc.text("Alliance", 439.4 + 5, stripY + 39);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Star", 501.7 + 5, stripY + 33);
    doc.text("Alliance", 501.7 + 5, stripY + 44);

    let curY = stripY + stripH + 16; // ~212 pt

    // 3. FLIGHT DETAILS
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...P);
    doc.text("Flight Details", marginL, curY);
    curY += 8; // ~220 pt

    flights.forEach((f) => {
        const sDepCity = extractCityName(f.depAirport) || 'Bangkok';
        const sArrCity = extractCityName(f.arrAirport) || 'London';
        const sFlightNo = (f.flightNo && !/^(AK|VJ)/i.test(f.flightNo)) ? f.flightNo : 'TG 910';
        const sRoute = f.route || `${lookupAirportCode(f.depAirport) || 'BKK'} - ${lookupAirportCode(f.arrAirport) || 'LHR'}`;

        // Upper Purple Box (Unified 109 pt height)
        const upperBoxH = 109.0;
        doc.setFillColor(...P);
        doc.rect(marginL, curY, textW, upperBoxH, 'F');

        // Top line inside Purple Box: Origin ✈ Destination & FlightNo | Carrier & Sector Booking Ref
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...WHT);
        doc.text(`${sDepCity} `, marginL + 8, curY + 21);
        const cityW = doc.getTextWidth(`${sDepCity} `);
        
        // Draw real airplane icon (pointing right towards destination)
        try {
            doc.addImage(AIRPLANE_WHITE_PNG, 'PNG', marginL + 8 + cityW, curY + 9, 13, 13);
        } catch (e) {
            doc.text("→", marginL + 8 + cityW + 1, curY + 21);
        }
        
        const planeW = 15;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(`   ${sArrCity}`, marginL + 8 + cityW + planeW, curY + 21);

        const sectorPnr = f.pnr || pnr;

        if (sectorPnr) {
            const pnrBadgeText = `Booking Ref: ${sectorPnr}`;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            const badgeW = doc.getTextWidth(pnrBadgeText) + 10;
            const badgeH = 14;
            const badgeX = rightEdge - 8 - badgeW;
            const badgeY = curY + 11;

            doc.setFillColor(...A); // Gold
            doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'F');
            doc.setTextColor(...P); // Deep Purple
            doc.text(pnrBadgeText, badgeX + badgeW / 2, badgeY + 10, { align: "center" });

            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...WHT);
            doc.text(`${sFlightNo}  |  Thai Airways International`, badgeX - 8, curY + 21, { align: "right" });
        } else {
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...WHT);
            doc.text(`${sFlightNo}  |  Thai Airways International`, rightEdge - 8, curY + 21, { align: "right" });
        }

        // Times (Bold 16pt White)
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...WHT);
        doc.text(f.depTime || "00:45", marginL + 8, curY + 52);
        doc.text(f.arrTime || "07:15", marginL + 258, curY + 52);

        // Dates (Lavender 8pt)
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...LP);
        doc.text(f.depDateFormatted || "Wednesday, 30 September 2026", marginL + 8, curY + 76);
        doc.text(f.arrDateFormatted || "Wednesday, 30 September 2026", marginL + 258, curY + 76);

        // Airports (Lavender 8pt)
        const depAirStr = `${f.depAirport || 'Bangkok - Suvarnabhumi Intl (BKK)'}${f.depTerminal ? ', ' + f.depTerminal : ''}`;
        const arrAirStr = `${f.arrAirport || 'London - Heathrow (LHR)'}${f.arrTerminal ? ', ' + f.arrTerminal : ''}`;
        doc.text(depAirStr, marginL + 8, curY + 100);
        doc.text(arrAirStr, marginL + 258, curY + 100);

        curY += upperBoxH;

        // Lower Cream/Gold Info Table (47 pt height)
        const lowerBoxH = 47.0;
        doc.setFillColor(...AT);
        doc.rect(marginL, curY, textW, lowerBoxH, 'F');
        doc.setDrawColor(...A);
        doc.setLineWidth(0.5);
        doc.rect(marginL, curY, textW, lowerBoxH, 'S');

        // Divider lines (exact from ref: 121.9, 297.6, 377.0)
        doc.line(marginL, curY + 23.5, rightEdge, curY + 23.5);
        [121.9, 297.6, 377.0].forEach(x => doc.line(x, curY, x, curY + lowerBoxH));

        // Info Row 1
        doc.setTextColor(...BLK);
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.text("Duration", marginL + 6, curY + 15.5);
        doc.setFont("helvetica", "normal");
        doc.text(f.duration || "12h 30min, Non-Stop", 121.9 + 6, curY + 15.5, { maxWidth: 160 });

        doc.setFont("helvetica", "bold");
        doc.text("Aircraft", 297.6 + 6, curY + 15.5);
        doc.setFont("helvetica", "normal");
        doc.text(f.aircraft || "Boeing 777-300ER", 377.0 + 6, curY + 15.5, { maxWidth: 160 });

        // Info Row 2
        doc.setFont("helvetica", "bold");
        doc.text("Class", marginL + 6, curY + 39);
        doc.setFont("helvetica", "normal");
        doc.text(f.flightClass || data.flightClass || "Economy (T)", 121.9 + 6, curY + 39, { maxWidth: 160 });

        doc.setFont("helvetica", "bold");
        doc.text(sectorPnr ? "Booking Ref" : "Route", 297.6 + 6, curY + 39);
        doc.setFont("helvetica", sectorPnr ? "bold" : "normal");
        const depCode = lookupAirportCode(f.depAirport) || 'DEP';
        const arrCode = lookupAirportCode(f.arrAirport) || 'ARR';
        const refStr = sectorPnr ? `${sectorPnr} (${depCode} - ${arrCode})` : sRoute;
        doc.text(refStr, 377.0 + 6, curY + 39, { maxWidth: 155 });

        curY += lowerBoxH + 16;
    });

    // 4. PASSENGER DETAILS
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...P);
    doc.text("Passenger Details", marginL, curY);
    curY += 8;

    const paxHeaderH = 23.0;
    doc.setFillColor(...P);
    doc.rect(marginL, curY, textW, paxHeaderH, 'F');
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHT);

    // Columns: 189.9, 337.3, 445.0
    doc.text("Name", marginL + 6, curY + 15.5);
    doc.text("E-Ticket No.", 189.9 + 6, curY + 15.5);
    doc.text("Passport", 337.3 + 6, curY + 15.5);
    doc.text("Expiry", 445.0 + 6, curY + 15.5);
    curY += paxHeaderH;

    const paxRowH = 23.5;
    paxList.forEach((p, idx) => {
        const bg = (idx % 2 === 0) ? T : [255, 255, 255];
        doc.setFillColor(...bg);
        doc.rect(marginL, curY, textW, paxRowH, 'F');
        doc.setDrawColor(...PB);
        doc.setLineWidth(0.5);
        doc.rect(marginL, curY, textW, paxRowH, 'S');

        [189.9, 337.3, 445.0].forEach(x => doc.line(x, curY, x, curY + paxRowH));

        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...BLK);
        doc.text(p.name || "", marginL + 6, curY + 15.5, { maxWidth: 130 });

        doc.setFont("helvetica", "normal");
        doc.text(p.eticket || p.eTicketNo || data.eTicketNo || "", 189.9 + 6, curY + 15.5, { maxWidth: 135 });
        doc.text(p.passport || "", 337.3 + 6, curY + 15.5, { maxWidth: 95 });
        doc.text(p.expiry || "", 445.0 + 6, curY + 15.5, { maxWidth: 90 });

        curY += paxRowH;
    });

    curY += 16;

    // 5. BAGGAGE & EXTRA SERVICES
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...P);
    doc.text("Baggage & Extra Services", marginL, curY);
    curY += 8;

    const bagRowH = 23.5;
    const totalBagH = bagRowH * paxList.length;
    doc.setFillColor(...AT);
    doc.rect(marginL, curY, textW, totalBagH, 'F');
    doc.setDrawColor(...A);
    doc.setLineWidth(0.5);
    doc.rect(marginL, curY, textW, totalBagH, 'S');

    // Vertical divider at 178.6
    doc.line(178.6, curY, 178.6, curY + totalBagH);

    paxList.forEach((p, idx) => {
        const rowY = curY + (idx * bagRowH);
        if (idx > 0) {
            doc.line(marginL, rowY, rightEdge, rowY);
        }
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...BLK);
        doc.text(p.name || "", marginL + 6, rowY + 15.5, { maxWidth: 120 });

        doc.setFont("helvetica", "normal");
        const bagInfo = p.baggage || data.checkedBaggage || "Checked: 2 Pcs, 23 kg   |   Carry-on: 7 kg";
        doc.text(bagInfo, 178.6 + 6, rowY + 15.5, { maxWidth: 350 });
    });

    curY += totalBagH + 16;

    // 6. NOTES
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...P);
    doc.text("Notes", marginL, curY);
    curY += 14;

    const notesBullets = [
        "•  Passengers must present the valid ID used to purchase the ticket at check-in; boarding pass or this itinerary may also be required.",
        "•  Tickets must be used in the sequence set out in the itinerary, otherwise the airline reserves the right to refuse carriage.",
        "•  Extra services (preferred seat / additional baggage, etc.): to change seats, flights or travel dates, please contact THAI Worldwide Office or\n   THAI Contact Center (+66-2-3561111).",
        "•  Carriage is subject to the Geneva Convention / Warsaw Treaty System where applicable to the journey."
    ];

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...DK);

    notesBullets.forEach(b => {
        const lines = b.split('\n');
        lines.forEach(l => {
            doc.text(l, marginL + 6, curY);
            curY += 12;
        });
        curY += 2;
    });

    curY += 8;

    // 7. BOTTOM GOLD RULE
    doc.setDrawColor(...A);
    doc.setLineWidth(1.7);
    doc.line(48.5, curY, 546.8, curY);
    curY += 16;

    // 8. CENTERED FOOTER
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUT);
    const depDateShort = firstFlight.depDateFormatted ? firstFlight.depDateFormatted.replace(/^[A-Za-z]+day,\s*/, '').toUpperCase() : '30 SEP 2026';
    const footerMsg = `thaiairways.com   |   Booking Ref ${pnr}   |   ${firstFlight.flightNo || 'TG 910'} ${depCity} - ${arrCity}, ${depDateShort}`;
    doc.text(footerMsg, 595.28 / 2, curY, { align: "center" });

    return doc;
}

/**
 * Generate native vector jsPDF document matching the exact official template
 */
export async function generateAirAsiaPdfDoc(data) {
    if (data.airline === 'Thai Airways' || /thai\s*airways/i.test(data.airlineName || '') || /TG\s*\d/i.test(data.flightNo || '')) {
        return generateThaiAirwaysPdfDoc(data);
    }
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
        doc.text(f.flightNo || "", marginX + 6, currentFlY + 14);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.text(f.airlineName || "", marginX + 6, currentFlY + 25);

        const secPnr = f.pnr || data.pnr;
        if (secPnr) {
            const badgeText = `Booking Ref: ${secPnr}`;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7.5);
            const badgeW = doc.getTextWidth(badgeText) + 8;
            const badgeH = 12;
            const badgeX = marginX + 6;
            const badgeY = currentFlY + 29;

            doc.setFillColor(255, 235, 235); // #FFEBEB
            doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'F');
            doc.setDrawColor(255, 193, 193); // #FFC1C1
            doc.setLineWidth(0.5);
            doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'S');

            doc.setTextColor(...redColor);
            doc.text(badgeText, badgeX + 4, badgeY + 8.5);
        }

        // CRUCIAL FIX: Reset text color back to darkColor so departure/arrival/route/class are never red!
        doc.setTextColor(...darkColor);

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

        doc.setTextColor(...darkColor);
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

    doc.setTextColor(...darkColor);
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
    const isThai = (data.airline === 'Thai Airways') || /thai\s*airways/i.test(data.airlineName || '') || /TG\s*\d/i.test(data.flightNo || '');
    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isThai ? 'ThaiAirways' : (isVietJet ? 'VietJet' : 'AirAsia');
    const primaryName = (data.passengers && data.passengers[0]?.name) || data.passengerName || prefix;
    const safeName = primaryName.replace(/[^a-zA-Z0-9]/g, '_');
    const safePnr = (data.pnr || data.bookingNo || 'Itinerary').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${prefix}_Ticket_${safeName}_${safePnr}.pdf`;

    const doc = await generateAirAsiaPdfDoc(data);
    doc.save(filename);
    return filename;
}

/**
 * Generate preview HTML markup for Thai Airways matching official template
 */
export function renderThaiAirwaysTicketHtml(data) {
    const logoSrc = cachedThaiLogoDataUrl || 'thai-airways-logo.png?v=2';
    const pnr = (data.pnr || data.bookingNo || '').trim().toUpperCase();
    const issuedDate = data.issuedDate || formatTicketDate(new Date());

    const paxList = (data.passengers && data.passengers.length > 0)
        ? data.passengers
        : [{ name: data.passengerName || '', type: data.passengerType || 'Adult', eticket: data.eTicketNo || '', passport: '', expiry: '' }];

    const flights = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || '', airlineName: data.airlineName || 'Thai Airways International',
            depTime: data.depTime || '', depDateFormatted: data.depDateFormatted || '', depAirport: data.depAirport || '', depTerminal: data.depTerminal || '',
            arrTime: data.arrTime || '', arrDateFormatted: data.arrDateFormatted || '', arrAirport: data.arrAirport || '', arrTerminal: data.arrTerminal || '',
            route: data.route || '', duration: data.duration || '', aircraft: data.aircraft || '', flightClass: data.flightClass || 'Economy'
        }];
    const firstFlight = flights[0];
    const depCity = extractCityName(firstFlight.depAirport) || 'Bangkok';
    const arrCity = extractCityName(firstFlight.arrAirport) || 'London';
    const paxSummary = paxList.length === 1 ? `1 ${paxList[0].type || 'Adult'}` : `${paxList.length} Adults`;

    let checkinNotice = (data.checkinNotice || '').trim();
    const firstDepCode = lookupAirportCode(firstFlight.depAirport) || 'BKK';

    if (!checkinNotice) {
        if (firstFlight.depTime && firstFlight.depDateFormatted) {
            try {
                const d = new Date(`${firstFlight.depDateFormatted} ${firstFlight.depTime}`);
                if (!isNaN(d.getTime())) {
                    d.setHours(d.getHours() - 3);
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const hours = d.getHours();
                    const minutes = String(d.getMinutes()).padStart(2, '0');
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    const h12 = hours % 12 || 12;
                    checkinNotice = `(${firstDepCode}) ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${h12}:${minutes} ${ampm}`;
                }
            } catch (e) {}
        }
        if (!checkinNotice) {
            checkinNotice = `(${firstDepCode}) 3 hours before departure`;
        }
    }

    let checkinLbl = `Check-in (${firstDepCode})`;
    let checkinVal = '';

    if (checkinNotice) {
        const parenMatch = checkinNotice.match(/\(([A-Za-z0-9\s]+)\)/);
        const codeInParen = parenMatch ? parenMatch[1].trim() : firstDepCode;
        const resolvedCode = lookupAirportCode(codeInParen) || codeInParen;
        checkinLbl = `Check-in (${resolvedCode})`;

        checkinVal = checkinNotice
            .replace(/^check[- ]?in/i, '')
            .replace(/\([^)]+\)/g, '')
            .replace(/^[\s:\-]+/, '')
            .trim();
    }
    if (!checkinVal) {
        checkinVal = '3 hours before departure';
    }

    const depDateShort = firstFlight.depDateFormatted ? firstFlight.depDateFormatted.replace(/^[A-Za-z]+day,\s*/, '').toUpperCase() : '';

    return `
    <div style="font-family:Helvetica,Arial,sans-serif; max-width:700px; margin:0 auto; padding:24px 28px; background:#ffffff; color:#111; line-height:1.4;">

        <!-- 1. HEADER -->
        <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:4px;">
            <img src="${logoSrc}" alt="Thai Airways" style="height:42px; object-fit:contain; background:transparent;">
            <div style="text-align:right;">
                <div style="font-size:22px; font-weight:800; color:#3D1E6D; letter-spacing:0.5px;">E-TICKET</div>
                <div style="font-size:10px; color:#555;">Booking Confirmed</div>
                <div style="font-size:10px; color:#555;">Thai Airways International (TG)</div>
                <div style="font-size:15px; font-weight:700; color:#3D1E6D; margin-top:2px;">Booking Ref: ${pnr}</div>
            </div>
        </div>
        <div style="height:3px; background:#D9A300; margin-bottom:12px;"></div>

        <!-- 2. BOOKING STRIP -->
        <table style="width:100%; border-collapse:collapse; background:#F6F3FB; border:1px solid #D5CBE8; font-size:11px; margin-bottom:14px;">
            <tr>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; width:14%; font-weight:700; color:#333;">Booking Ref</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; width:21%; font-weight:700; font-size:13px; color:#111;">${pnr}</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; width:13%; font-weight:700; color:#333;">Issued Date</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; width:21%; color:#333;">${issuedDate}</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; width:13%; font-weight:700; color:#333;">Passengers</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; width:18%; color:#333;">${paxSummary}</td>
            </tr>
            <tr>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; font-weight:700; color:#333;">${checkinLbl}</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; color:#333; word-break:break-word; max-width:130px;">${checkinVal}</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; font-weight:700; color:#333;">Status</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; font-weight:700; color:#111;">Confirmed</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; font-weight:700; color:#333;">Alliance</td>
                <td style="padding:6px 6px; border:1px solid #D5CBE8; color:#333; line-height:1.2;">Star<br>Alliance</td>
            </tr>
        </table>

        <!-- 3. FLIGHT DETAILS -->
        <div style="font-size:14px; font-weight:800; color:#3D1E6D; margin-bottom:6px;">Flight Details</div>
        <div style="margin-bottom:14px;">
            ${flights.map(f => {
                const fDepCity = extractCityName(f.depAirport) || 'Departure';
                const fArrCity = extractCityName(f.arrAirport) || 'Arrival';
                let fArrAirport = f.arrAirport || '';
                if (f.arrTerminal) fArrAirport += `, ${f.arrTerminal}`;
                const sRoute = f.route || `${lookupAirportCode(f.depAirport) || 'DEP'} - ${lookupAirportCode(f.arrAirport) || 'ARR'}`;

                const fFlightNo = (f.flightNo && !/^(AK|VJ)/i.test(f.flightNo)) ? f.flightNo : 'TG 910';
                const fPnr = f.pnr || pnr;

                return `
                <!-- Flight Card -->
                <div style="border:1px solid #D5CBE8; border-radius:3px; overflow:hidden; margin-bottom:12px;">
                    <!-- Upper Purple Box (Unified Deep Purple Card) -->
                    <div style="background:#3D1E6D; color:#ffffff; padding:12px 14px;">
                        <!-- Top Line: Origin ✈ Destination & FlightNo | Carrier & Sector Booking Ref -->
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
                            <div style="font-size:16px; font-weight:800; letter-spacing:0.3px;">${fDepCity} &nbsp; ✈ &nbsp; ${fArrCity}</div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="font-size:11px; font-weight:500; opacity:0.95;">${fFlightNo} &nbsp;|&nbsp; Thai Airways International</div>
                                ${fPnr ? `<div style="background:#D9A300; color:#3D1E6D; font-size:11.5px; font-weight:800; padding:2px 8px; border-radius:3px; letter-spacing:0.5px; white-space:nowrap; box-shadow:0 1px 3px rgba(0,0,0,0.25);">Booking Ref: ${fPnr}</div>` : ''}
                            </div>
                        </div>
                        <!-- Times / Dates / Airports inside Purple Card -->
                        <div style="display:flex; justify-content:space-between;">
                            <div style="flex:1;">
                                <div style="font-size:22px; font-weight:800; color:#ffffff; line-height:1;">${f.depTime || '00:45'}</div>
                                <div style="font-size:10px; color:#F0E8FF; margin-top:6px;">${f.depDateFormatted || 'Wednesday, 30 September 2026'}</div>
                                <div style="font-size:10px; color:#F0E8FF; margin-top:4px;">${f.depAirport || 'Bangkok - Suvarnabhumi Intl (BKK)'}${f.depTerminal ? ', ' + f.depTerminal : ''}</div>
                            </div>
                            <div style="flex:1; padding-left:16px;">
                                <div style="font-size:22px; font-weight:800; color:#ffffff; line-height:1;">${f.arrTime || '07:15'}</div>
                                <div style="font-size:10px; color:#F0E8FF; margin-top:6px;">${f.arrDateFormatted || 'Wednesday, 30 September 2026'}</div>
                                <div style="font-size:10px; color:#F0E8FF; margin-top:4px;">${fArrAirport || 'London - Heathrow (LHR), Terminal 2'}</div>
                            </div>
                        </div>
                    </div>
                    <!-- Lower Cream Box (Info Grid) -->
                    <table style="width:100%; border-collapse:collapse; background:#FDF6E3; border-top:1px solid #D9A300; font-size:11px;">
                        <tr>
                            <td style="padding:6px 10px; border:1px solid #D9A300; width:16%; font-weight:700; color:#111;">Duration</td>
                            <td style="padding:6px 10px; border:1px solid #D9A300; width:34%; color:#111;">${f.duration || '12h 30min, Non-Stop'}</td>
                            <td style="padding:6px 10px; border:1px solid #D9A300; width:16%; font-weight:700; color:#111;">Aircraft</td>
                            <td style="padding:6px 10px; border:1px solid #D9A300; width:34%; color:#111;">${f.aircraft || 'Boeing 777-300ER'}</td>
                        </tr>
                        <tr>
                            <td style="padding:6px 10px; border:1px solid #D9A300; font-weight:700; color:#111;">Class</td>
                            <td style="padding:6px 10px; border:1px solid #D9A300; color:#111;">${f.flightClass || data.flightClass || 'Economy (T)'}</td>
                            <td style="padding:6px 10px; border:1px solid #D9A300; font-weight:700; color:#111;">${fPnr ? 'Booking Ref' : 'Route'}</td>
                            <td style="padding:6px 10px; border:1px solid #D9A300; color:#111;">${fPnr ? `<strong style="color:#3D1E6D; font-size:12px;">${fPnr}</strong> &nbsp;<span style="color:#555;">(${sRoute})</span>` : sRoute}</td>
                        </tr>
                    </table>
                </div>
                `;
            }).join('')}
        </div>

        <!-- 4. PASSENGER DETAILS -->
        <div style="font-size:14px; font-weight:800; color:#3D1E6D; margin-bottom:6px;">Passenger Details</div>
        <table style="width:100%; border-collapse:collapse; border:1px solid #D5CBE8; font-size:11px; margin-bottom:14px;">
            <thead>
                <tr style="background:#3D1E6D; color:#fff;">
                    <th style="padding:7px 8px; text-align:left; border:1px solid #D5CBE8; width:30%; font-weight:700;">Name</th>
                    <th style="padding:7px 8px; text-align:left; border:1px solid #D5CBE8; width:30%; font-weight:700;">E-Ticket No.</th>
                    <th style="padding:7px 8px; text-align:left; border:1px solid #D5CBE8; width:22%; font-weight:700;">Passport</th>
                    <th style="padding:7px 8px; text-align:left; border:1px solid #D5CBE8; width:18%; font-weight:700;">Expiry</th>
                </tr>
            </thead>
            <tbody>
                ${paxList.map((p, idx) => `
                    <tr style="background:${idx % 2 === 0 ? '#F6F3FB' : '#fff'};">
                        <td style="padding:7px 8px; border:1px solid #D5CBE8; font-weight:700; color:#111;">${p.name || ''}</td>
                        <td style="padding:7px 8px; border:1px solid #D5CBE8; color:#111;">${p.eticket || p.eTicketNo || data.eTicketNo || ''}</td>
                        <td style="padding:7px 8px; border:1px solid #D5CBE8; color:#111;">${p.passport || ''}</td>
                        <td style="padding:7px 8px; border:1px solid #D5CBE8; color:#111;">${p.expiry || ''}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- 5. BAGGAGE & EXTRA SERVICES -->
        <div style="font-size:14px; font-weight:800; color:#3D1E6D; margin-bottom:6px;">Baggage &amp; Extra Services</div>
        <table style="width:100%; border-collapse:collapse; background:#FDF6E3; border:1px solid #D9A300; font-size:11px; margin-bottom:14px;">
            ${paxList.map(p => `
                <tr>
                    <td style="padding:7px 8px; border:1px solid #D9A300; width:30%; font-weight:700; color:#111;">${p.name || ''}</td>
                    <td style="padding:7px 8px; border:1px solid #D9A300; width:70%; color:#111;">${p.baggage || data.checkedBaggage || 'Checked: 2 Pcs, 23 kg   |   Carry-on: 7 kg'}</td>
                </tr>
            `).join('')}
        </table>

        <!-- 6. NOTES -->
        <div style="font-size:14px; font-weight:800; color:#3D1E6D; margin-bottom:6px;">Notes</div>
        <ul style="margin:0 0 14px 0; padding-left:16px; font-size:9px; color:#333; line-height:1.55;">
            <li style="margin-bottom:3px;">Passengers must present the valid ID used to purchase the ticket at check-in; boarding pass or this itinerary may also be required.</li>
            <li style="margin-bottom:3px;">Tickets must be used in the sequence set out in the itinerary, otherwise the airline reserves the right to refuse carriage.</li>
            <li style="margin-bottom:3px;">Extra services (preferred seat / additional baggage, etc.): to change seats, flights or travel dates, please contact THAI Worldwide Office or THAI Contact Center (+66-2-3561111).</li>
            <li style="margin-bottom:3px;">Carriage is subject to the Geneva Convention / Warsaw Treaty System where applicable to the journey.</li>
        </ul>

        <!-- 7. FOOTER -->
        <div style="height:2px; background:#D9A300; margin-bottom:10px;"></div>
        <div style="text-align:center; font-size:9px; color:#888; line-height:1.4;">
            thaiairways.com &nbsp;&nbsp;|&nbsp;&nbsp; Booking Ref ${pnr} &nbsp;&nbsp;|&nbsp;&nbsp; ${firstFlight.flightNo || 'TG 910'} ${depCity} - ${arrCity}, ${depDateShort}
        </div>

    </div>
    `;
}
/**
 * Generate preview HTML markup that renders identically to the PDF
 */
export function renderAirAsiaTicketHtml(data) {
    if (data.airline === 'Thai Airways' || /thai\s*airways/i.test(data.airlineName || '') || /TG\s*\d/i.test(data.flightNo || '')) {
        return renderThaiAirwaysTicketHtml(data);
    }
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
                            ${(f.pnr || data.pnr) ? `<div style="display:inline-block; margin-top:5px; background:#FFEBEB; color:#E31E24; padding:2px 7px; border-radius:3px; font-weight:800; font-size:11px; border:1px solid #FFC1C1; letter-spacing:0.3px;">Booking Ref: ${f.pnr || data.pnr}</div>` : ''}
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

    const isThai = (data.airline === 'Thai Airways') || /thai\s*airways/i.test(data.airlineName || '') || /TG\s*\d/i.test(data.flightNo || '');
    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isThai ? 'ThaiAirways' : (isVietJet ? 'VietJet' : 'AirAsia');
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

    const isThai = (data.airline === 'Thai Airways') || /thai\s*airways/i.test(data.airlineName || '') || /TG\s*\d/i.test(data.flightNo || '');
    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isThai ? 'ThaiAirways' : (isVietJet ? 'VietJet' : 'AirAsia');
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
