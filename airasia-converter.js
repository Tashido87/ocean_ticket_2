/**
 * AirAsia E-Ticket Itinerary Generator & Converter
 * Converts Trip.com / OTA PDF itineraries into official AirAsia E-Ticket Receipts.
 */

import { showToast } from './utils.js';

let cachedAirAsiaLogoDataUrl = null;
let cachedVietJetLogoDataUrl = null;
let cachedThaiLogoDataUrl = null;
let cachedSIADataUrl = null;
let cachedEvaAirLogoDataUrl = null;

/**
 * Preload and cache Airline logo as data URL for jsPDF and HTML preview
 */
export async function getAirlineLogoDataUrl(airline = 'AirAsia') {
    const isEva = (airline === 'EVA Air') || /eva\s*air|\bBR\b/i.test(airline || '');
    const isThai = (airline === 'Thai Airways') || /thai\s*airways/i.test(airline || '');
    const isVietJet = (airline === 'VietJet Air') || /vietjet/i.test(airline || '');
    const isSIA = (airline === 'Singapore Airlines') || /singapore\s*air(?:lines)?|\bSQ\b/i.test(airline || '');
    if (isEva && cachedEvaAirLogoDataUrl) return cachedEvaAirLogoDataUrl;
    if (isThai && cachedThaiLogoDataUrl) return cachedThaiLogoDataUrl;
    if (isVietJet && cachedVietJetLogoDataUrl) return cachedVietJetLogoDataUrl;
    if (isSIA && cachedSIADataUrl) return cachedSIADataUrl;
    if (!isEva && !isThai && !isVietJet && !isSIA && cachedAirAsiaLogoDataUrl) return cachedAirAsiaLogoDataUrl;

    const logoSrc = isEva ? 'eva-air-logo.png?v=2' : (isThai ? 'thai-airways-logo.png?v=2' : (isVietJet ? 'vietjet-logo.png?v=2' : (isSIA ? 'singapore-airlines-logo.png?v=2' : 'airasia-logo.png?v=2')));
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
        if (isEva) {
            cachedEvaAirLogoDataUrl = dataUrl;
        } else if (isThai) {
            cachedThaiLogoDataUrl = dataUrl;
        } else if (isVietJet) {
            cachedVietJetLogoDataUrl = dataUrl;
        } else if (isSIA) {
            cachedSIADataUrl = dataUrl;
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

let cachedAirplaneDataUrl = null;

/**
 * Preload and cache white airplane icon asset as data URL
 */
export async function getAirplaneIconDataUrl() {
    if (cachedAirplaneDataUrl) return cachedAirplaneDataUrl;
    try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = 'airplane-white.png?v=2';
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 48;
        canvas.height = img.naturalHeight || img.height || 48;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        cachedAirplaneDataUrl = canvas.toDataURL('image/png');
        return cachedAirplaneDataUrl;
    } catch (err) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 48;
            canvas.height = 48;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#FFFFFF';
                ctx.translate(24, 24);
                ctx.rotate(90 * Math.PI / 180);
                ctx.font = '32px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('✈', 0, 0);
                cachedAirplaneDataUrl = canvas.toDataURL('image/png');
                return cachedAirplaneDataUrl;
            }
        } catch (e2) {}
        return '';
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
    'taoyuan': 'TPE',
    'songshan': 'TSA',
    'kaohsiung': 'KHH',
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
    if (lower.includes('taipei') || lower.includes('taoyuan') || lower.includes('songshan')) return 'Taipei';
    if (lower.includes('kaohsiung')) return 'Kaohsiung';
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
    const isEva = /(?:eva\s*air(?:ways)?|evaair\.com|\bBR\s*\d{2,4}\b)/i.test(clean);
    const isSIA = /(?:singapore\s*air(?:lines)?|singaporeair\.com|\bSQ\s*\d{2,4}\b)/i.test(clean);
    const isThai = /(?:thai\s*airways|\bTG\s*\d{3,4}\b)/i.test(clean);
    const isVietJet = /(?:vietjet|viet\s*jet|\bVJ\d{3,4}\b|\bVZ\d{3,4}\b)/i.test(clean);
    const isAirAsia = /(?:airasia|air\s*asia|\b(?:AK|FD|QZ|D7|XJ|Z2)\d{3,4}\b)/i.test(clean);

    if (isEva) {
        airline = 'EVA Air';
    } else if (isSIA) {
        airline = 'Singapore Airlines';
    } else if (isThai) {
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
        for (const pl of pLines) {
            const rowMatch = pl.match(/^([A-Za-z\s]{3,40}?)\s+(?:([0-9-]{10,})|To\s*be\s*advised[^\n\r]*?)\s+(Adult|Child|Infant)(?:\s+([A-Z0-9—\-]+))?/i);
            if (rowMatch) {
                const rName = rowMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
                if (!/^(NAME|E-TICKET|TYPE|SEAT|PASSENGER)/i.test(rName) && !passengers.some(p => p.name === rName)) {
                    passengers.push({
                        name: rName,
                        eticket: rowMatch[2] || '',
                        eTicketNo: rowMatch[2] || '',
                        type: rowMatch[3] || 'Adult',
                        seat: (rowMatch[4] && rowMatch[4] !== '—') ? rowMatch[4] : ''
                    });
                }
            }
        }
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

    // Check Direct Confirmation Flight Details block (Thai Airways / Singapore Airlines / EVA Air):
    const thaiFlMatch = clean.match(/Flight\s*Details\s+([\s\S]*?)(?=Passenger\s*Details|Baggage|Notes|$)/i);
    if ((airline === 'EVA Air' || airline === 'Singapore Airlines' || airline === 'Thai Airways') && thaiFlMatch) {
        const tfText = thaiFlMatch[1].trim();
        const tfLines = tfText.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
        
        let headerRoute = '';
        let routeMatch = tfLines[0]?.match(/^([A-Za-z\s]+?)\s+(?:v|»|✈|->|-)\s+([A-Za-z\s]+?)$/i);
        let depCity = routeMatch ? routeMatch[1].trim() : '';
        let arrCity = routeMatch ? routeMatch[2].trim() : '';

        let flightNo = (airline === 'EVA Air' ? 'BR 001' : (airline === 'Singapore Airlines' ? 'SQ 001' : 'TG 910'));
        let carrier = (airline === 'EVA Air' ? 'EVA Air' : (airline === 'Singapore Airlines' ? 'Singapore Airlines' : 'Thai Airways International'));
        const flCarrierMatch = tfText.match(/([A-Z0-9]{2,3}\s*\d{2,4})\s*(?:\||-|\/)?\s*([A-Za-z\s]+)/i);
        if (flCarrierMatch) {
            flightNo = flCarrierMatch[1].toUpperCase();
            carrier = flCarrierMatch[2].trim() || carrier;
        }

        const timesMatch = tfText.match(/\b(\d{1,2}:\d{2})\b[^\n\r\d]*\b(\d{1,2}:\d{2})\b/);
        const datesMatch = [...tfText.matchAll(/\b([A-Za-z]+day,?\s*)?(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})\b/gi)];

        let depTime = timesMatch ? timesMatch[1] : (tfLines[2] || '');
        let arrTime = timesMatch ? timesMatch[2] : (tfLines[3] || '');
        let depDateFormatted = datesMatch.length >= 1 ? datesMatch[0][0] : (tfLines[4] || '');
        let arrDateFormatted = datesMatch.length >= 2 ? datesMatch[1][0] : (datesMatch.length === 1 ? datesMatch[0][0] : (tfLines[5] || ''));
        let depAirport = tfLines[6] || '';
        let arrAirport = tfLines[7] || '';

        const durationMatch = tfText.match(/Duration\s*[:\s]*([0-9]+\s*h(?:ours?)?(?:\s*[0-9]+\s*m(?:in)?)?(?:,?\s*Non[- ]?Stop)?)/i) || tfText.match(/Duration\s*\n\s*([^\n\r]+)/i);
        const aircraftMatch = tfText.match(/Aircraft\s*[:\s]*([A-Za-z0-9\s\-]+?)(?=\s+Class|\s+Route|\n|$)/i) || tfText.match(/Aircraft\s*\n\s*([^\n\r]+)/i);
        const classMatch = tfText.match(/Class\s*[:\s]*([A-Za-z0-9\s\(\)]+?)(?=\s+Route|\n|$)/i) || tfText.match(/Class\s*\n\s*([^\n\r]+)/i);
        const routeCodeMatch = tfText.match(/Route\s*[:\s]*([A-Z]{3}\s*-\s*[A-Z]{3})/i) || tfText.match(/Route\s*\n\s*([^\n\r]+)/i);

        const duration = durationMatch ? durationMatch[1].trim() : (airline === 'EVA Air' ? '3h 40min, Non-Stop' : (airline === 'Singapore Airlines' ? '13h 30min, Non-Stop' : '12h 30min, Non-Stop'));
        const aircraft = aircraftMatch ? aircraftMatch[1].trim() : (airline === 'EVA Air' ? 'Boeing 787-10' : (airline === 'Singapore Airlines' ? 'Airbus A380-800' : 'Boeing 777-300ER'));
        const secClass = classMatch ? classMatch[1].trim() : flightClass;
        const defaultRoute = (airline === 'EVA Air' ? 'TPE - BKK' : (airline === 'Singapore Airlines' ? 'SIN - LHR' : 'BKK - LHR'));
        const route = routeCodeMatch ? routeCodeMatch[1].trim() : (depCity && arrCity ? `${depCity} - ${arrCity}` : defaultRoute);

        const airportMatches = [...tfText.matchAll(/([A-Za-z\s\-]+?\([A-Z]{3}\)(?:,\s*Terminal\s*[0-9A-Z]+)?)/gi)];
        if (airportMatches && airportMatches.length >= 2) {
            depAirport = airportMatches[0][1].trim();
            arrAirport = airportMatches[1][1].trim();
        }

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

            const defaultCarrier = airline === 'EVA Air' ? 'EVA Air' : (airline === 'Singapore Airlines' ? 'Singapore Airlines' : (airline === 'Thai Airways' ? 'Thai Airways International' : (airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad')));
            const defaultFlightNo = airline === 'EVA Air' ? 'BR 001' : (airline === 'Singapore Airlines' ? 'SQ 001' : (airline === 'Thai Airways' ? 'TG 910' : ''));

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

    if (airline === 'EVA Air' || airline === 'Thai Airways') {
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
    } else if (airline === 'Singapore Airlines') {
        const siaBagMatch = clean.match(/Checked:\s*([^\n\r]+)/i);
        if (siaBagMatch) {
            checkedBaggage = `Checked: ${siaBagMatch[1].trim()}`;
        } else {
            const bagWeight = clean.match(/(\d+)\s*kg/i);
            checkedBaggage = bagWeight ? `Checked: ${bagWeight[1]} kg   |   Carry-on: 7 kg` : 'Checked: 30 kg   |   Carry-on: 7 kg';
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
        airlineName: primaryFlight.airlineName || (airline === 'EVA Air' ? 'EVA Air' : (airline === 'Singapore Airlines' ? 'Singapore Airlines' : (airline === 'Thai Airways' ? 'Thai Airways International' : (airline === 'VietJet Air' ? 'VietJet Air' : 'AirAsia Berhad')))),
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
 * Format or auto-calculate check-in time list for all flight sectors (3 hours before departure of each sector).
 * Returns array: [{ code: 'RGN', label: 'Check-in (RGN)', time: '1 Oct 2026, 4:00 PM' }, ...]
 */
export function getSectorCheckinList(data) {
    if (!data) return [{ code: 'DEP', label: 'Check-in', time: '3 hours before departure' }];
    const flights = (data.flights && data.flights.length > 0) ? data.flights : [data];
    const results = [];

    flights.forEach((f, idx) => {
        const depAirport = f.depAirport || (idx === 0 ? data.depAirport : '') || '';
        const depCode = lookupAirportCode(depAirport) || (idx === 0 ? 'DEP' : `SEC${idx + 1}`);
        let timeStr = '';

        // If sector 0 and user provided explicit checkinNotice that contains a formatted date/time
        if (idx === 0 && data.checkinNotice && !/before departure/i.test(data.checkinNotice)) {
            timeStr = data.checkinNotice
                .replace(/^check[- ]?in[\s:]*/i, '')
                .replace(/\([^)]+\)/g, '')
                .replace(/^[\s:\-]+/, '')
                .trim();
        }

        // Auto-compute 3 hours before departure if timeStr is not set
        if (!timeStr && f.depTime && f.depDateFormatted) {
            try {
                const d = new Date(`${f.depDateFormatted} ${f.depTime}`);
                if (!isNaN(d.getTime())) {
                    d.setHours(d.getHours() - 3);
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const hours = d.getHours();
                    const minutes = String(d.getMinutes()).padStart(2, '0');
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    const h12 = hours % 12 || 12;
                    timeStr = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${h12}:${minutes} ${ampm}`;
                }
            } catch (e) {}
        }

        if (!timeStr) {
            timeStr = '3 hours before departure';
        }

        results.push({
            code: depCode,
            label: `Check-in (${depCode})`,
            time: timeStr
        });
    });

    return results;
}

/**
 * Format or auto-calculate check-in time (3 hours before departure).
 * Returns clean, elegant string like "(DMK) 1 Oct 2026, 4:00 PM" or "1 Oct 2026, 4:00 PM"
 */
export function getFormattedCheckinTime(data) {
    const list = getSectorCheckinList(data);
    return list[0] ? `${list[0].label}: ${list[0].time}` : '3 hours before departure';
}

/**
 * Extract and resolve all booking references (PNRs) from sectors and form data.
 * Returns array of unique PNR strings e.g. ['HIGGNX', 'X9K2P']
 */
export function resolveAllPnrs(data) {
    if (!data) return [];
    const list = [];
    // 1. From individual sector flights
    if (data.flights && data.flights.length > 0) {
        data.flights.forEach(f => {
            if (f.pnr) {
                f.pnr.split(/[\/\s]+/).forEach(p => {
                    const c = p.trim().toUpperCase();
                    if (c && !list.includes(c)) list.push(c);
                });
            }
        });
    }
    // 2. From data.pnrs array
    if (data.pnrs && Array.isArray(data.pnrs)) {
        data.pnrs.forEach(p => {
            const c = (p || '').trim().toUpperCase();
            if (c && !list.includes(c)) list.push(c);
        });
    }
    // 3. From data.pnr string
    if (data.pnr) {
        data.pnr.split(/[\/\s]+/).forEach(p => {
            const c = p.trim().toUpperCase();
            if (c && !list.includes(c)) list.push(c);
        });
    }
    // 4. From data.bookingNo if formatted like PNR
    if (list.length === 0 && data.bookingNo) {
        const c = data.bookingNo.trim().toUpperCase();
        if (c.length >= 5 && c.length <= 8) list.push(c);
    }
    return list;
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

    const allPnrs = resolveAllPnrs(data);
    const pnr = allPnrs.length > 0 ? allPnrs.join(' / ') : ((data.pnr || data.bookingNo || 'TG9821').trim().toUpperCase());
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

    const sectorCheckins = getSectorCheckinList(data).slice(0, 2);
    const isMultiSector = sectorCheckins.length > 1;

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
    if (isMultiSector) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.6);
        doc.setTextColor(...DK);
        doc.text(sectorCheckins[0].label, marginL + 5, stripY + 33.5, { maxWidth: 72 });
        doc.text(sectorCheckins[1].label, marginL + 5, stripY + 48.0, { maxWidth: 72 });

        sectorCheckins.forEach((sc, i) => {
            const by = (i === 0) ? (stripY + 25.0) : (stripY + 39.5);
            const baselineY = (i === 0) ? (stripY + 33.5) : (stripY + 48.0);
            
            doc.setFont("helvetica", "bold");
            let cFontSize = 7.2;
            doc.setFontSize(cFontSize);
            let tw = doc.getTextWidth(sc.time);
            while (tw > 98 && cFontSize > 6.0) {
                cFontSize -= 0.3;
                doc.setFontSize(cFontSize);
                tw = doc.getTextWidth(sc.time);
            }
            const bgW = Math.min(tw + 8, 106);
            const bgH = 11.5;

            doc.setFillColor(236, 226, 252); // Richer lavender tint #ECE2FC
            doc.setDrawColor(154, 118, 208); // Crisp purple border #9A76D0
            doc.setLineWidth(0.7);
            doc.roundedRect(127.6 + 4, by, bgW, bgH, 2, 2, 'FD');

            doc.setTextColor(...P);
            doc.text(sc.time, 127.6 + 8, baselineY);
        });
    } else {
        const sc = sectorCheckins[0];
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...DK);
        doc.text(sc.label, marginL + 5, stripY + 42.0, { maxWidth: 72 });

        doc.setFont("helvetica", "bold");
        let cFontSize = 8.0;
        doc.setFontSize(cFontSize);
        let tw = doc.getTextWidth(sc.time);
        while (tw > 98 && cFontSize > 6.5) {
            cFontSize -= 0.3;
            doc.setFontSize(cFontSize);
            tw = doc.getTextWidth(sc.time);
        }
        const bgW = Math.min(tw + 8, 106);
        const bgH = 13.0;
        const by = stripY + 33.0;
        const baselineY = stripY + 42.0;

        doc.setFillColor(236, 226, 252); // Richer lavender tint #ECE2FC
        doc.setDrawColor(154, 118, 208); // Crisp purple border #9A76D0
        doc.setLineWidth(0.7);
        doc.roundedRect(127.6 + 4, by, bgW, bgH, 2, 2, 'FD');

        doc.setTextColor(...P);
        doc.text(sc.time, 127.6 + 8, baselineY);
    }

    doc.setFontSize(8.5);
    doc.setTextColor(...DK);
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

        // Top line inside Purple Box: Origin ➔ Destination & FlightNo | Carrier & Sector Booking Ref
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...WHT);
        doc.text(sDepCity, marginL + 8, curY + 21);
        const cityW = doc.getTextWidth(sDepCity);

        // Draw clean, elegant white vector right-arrow matching preview proportions
        const ax = marginL + 8 + cityW + 6;
        const ay = curY + 16.5;
        doc.setDrawColor(...WHT);
        doc.setFillColor(...WHT);
        doc.setLineWidth(1.4);
        doc.line(ax, ay, ax + 9, ay);
        doc.triangle(
            ax + 7.5, ay - 2.5,
            ax + 12.5, ay,
            ax + 7.5, ay + 2.5,
            'FD'
        );

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...WHT);
        doc.text(sArrCity, ax + 18, curY + 21);

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

        // Lower Cream/Gold Info Table (1 row, 23.5 pt height - Class & Booking ref row removed per user request)
        const lowerBoxH = 23.5;
        doc.setFillColor(...AT);
        doc.rect(marginL, curY, textW, lowerBoxH, 'F');
        doc.setDrawColor(...A);
        doc.setLineWidth(0.5);
        doc.rect(marginL, curY, textW, lowerBoxH, 'S');

        // Vertical divider lines: 121.9, 297.6, 377.0
        [121.9, 297.6, 377.0].forEach(x => doc.line(x, curY, x, curY + lowerBoxH));

        // Info Row: Duration & Aircraft
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

        curY += lowerBoxH + 14;
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
 * Generate native vector jsPDF document for EVA Air matching official template
 * Brand tokens:
 * Primary (EVA green): #007A3D [0, 122, 61]
 * Accent (EVA orange): #F26522 [242, 101, 34]
 * Light tint: #EEF7F0 [238, 247, 240]
 * Light orange: #FEF4EC [254, 244, 236]
 * Border gray-green: #BCD8C2 [188, 216, 194]
 * Border orange: #F26522 [242, 101, 34]
 * Check-in highlight tint: #DDF3E4 [221, 243, 228] (border: #58B675, text: #007A3D)
 */
export async function generateEvaAirPdfDoc(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getAirlineLogoDataUrl('EVA Air');

    const marginL = 42.5;
    const rightEdge = 552.8;
    const textW = rightEdge - marginL; // 510.3 pt (180mm)

    const EVAG = [0, 122, 61];     // #007A3D EVA Green
    const EVAO = [242, 101, 34];   // #F26522 EVA Orange
    const LT = [238, 247, 240];    // #EEF7F0 Light Green Tint
    const LO = [254, 244, 236];    // #FEF4EC Light Orange
    const BGG = [188, 216, 194];   // #BCD8C2 Border Gray-Green
    const CIBG = [221, 243, 228];  // Highlighted Check-in Badge background (#DDF3E4)
    const CIBD = [88, 182, 117];   // Highlighted Check-in Badge border (#58B675)
    const DK = [51, 51, 51];       // #333333 Dark Text
    const MUT = [119, 119, 119];   // #777777 Gray
    const WHT = [255, 255, 255];   // #FFFFFF White
    const BLK = [17, 17, 17];      // #111111

    const allPnrs = resolveAllPnrs(data);
    const pnr = allPnrs.length > 0 ? allPnrs.join(' / ') : ((data.pnr || data.bookingNo || 'EVA01').trim().toUpperCase());
    const isSample = /sample/i.test(pnr) || /sample/i.test(data.bookingNo || '') || /sample/i.test(data.passengerName || '') || data.isSample;
    const issuedDate = data.issuedDate || formatTicketDate(new Date());
    const paxList = (data.passengers && data.passengers.length > 0)
        ? data.passengers
        : [{ name: data.passengerName || 'SAMPLE PASSENGER', type: data.passengerType || 'Adult', eticket: data.eTicketNo || '', passport: '', expiry: '' }];
    const paxSummary = paxList.length === 1 ? `1 ${paxList[0].type || 'Adult'}` : `${paxList.length} Adults`;

    const flights = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || 'BR 001',
            airlineName: data.airlineName || 'EVA Air',
            depTime: data.depTime || '09:25',
            depDateFormatted: data.depDateFormatted || 'Sunday, 1 November 2026',
            depAirport: data.depAirport || 'Taipei - Taoyuan (TPE)',
            depTerminal: data.depTerminal || 'Terminal 2',
            arrTime: data.arrTime || '13:05',
            arrDateFormatted: data.arrDateFormatted || 'Sunday, 1 November 2026',
            arrAirport: data.arrAirport || 'Bangkok - Suvarnabhumi (BKK)',
            arrTerminal: data.arrTerminal || '',
            duration: data.duration || '3h 40min, Non-Stop',
            aircraft: data.aircraft || 'Boeing 787-10',
            flightClass: data.flightClass || 'Economy (Y)',
            route: data.route || 'TPE - BKK'
        }];

    const firstFlight = flights[0];
    const depCity = extractCityName(firstFlight.depAirport) || 'Taipei';
    const arrCity = extractCityName(firstFlight.arrAirport) || 'Bangkok';

    // 1. HEADER
    if (logoDataUrl) {
        try {
            // ~62mm wide = ~165-175 pt wide, cropped transparent PNG with natural 4.41:1 ratio
            const logoW = 165;
            const logoH = logoW / 4.414; // ~37.4 pt
            doc.addImage(logoDataUrl, 'PNG', marginL, 66, logoW, logoH, undefined, 'FAST');
        } catch (e) {
            console.warn("Logo add error:", e);
        }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...EVAG);
    doc.text("BOOKING CONFIRMATION", rightEdge, 68, { align: "right" });

    if (isSample) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(211, 47, 47);
        doc.text("SAMPLE — not a valid ticket", rightEdge, 79, { align: "right" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...DK);
        doc.text("EVA Air (BR)", rightEdge, 90, { align: "right" });

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...EVAG);
        doc.text(`Booking Ref: ${pnr}`, rightEdge, 106, { align: "right" });
    } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...DK);
        doc.text("EVA Air (BR)", rightEdge, 84, { align: "right" });

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...EVAG);
        doc.text(`Booking Ref: ${pnr}`, rightEdge, 102, { align: "right" });
    }

    // Full-width orange rule below header (1mm = 2.83pt)
    doc.setDrawColor(...EVAO);
    doc.setLineWidth(2.83);
    doc.line(marginL, 122.4, rightEdge, 122.4);

    // 2. BOOKING STRIP (2 rows x 6 columns)
    const stripY = 137.5;
    const stripH = 58.5;
    doc.setFillColor(...LT);
    doc.rect(marginL, stripY, textW, stripH, 'F');
    doc.setDrawColor(...BGG);
    doc.setLineWidth(0.5);
    doc.rect(marginL, stripY, textW, stripH, 'S');

    // Horizontal inner divider
    doc.line(marginL, stripY + 29.25, rightEdge, stripY + 29.25);

    // Column offsets
    const c0 = marginL;          // 42.5
    const c1 = marginL + 71.0;   // 113.5
    const c2 = c1 + 113.3;       // 226.8
    const c3 = c2 + 71.0;        // 297.8
    const c4 = c3 + 113.3;       // 411.1
    const c5 = c4 + 62.4;        // 473.5
    const cLines = [c1, c2, c3, c4, c5];
    cLines.forEach(cx => {
        doc.line(cx, stripY, cx, stripY + stripH);
    });

    // Strip Row 1
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...DK);
    doc.text("Booking Ref", c0 + 5, stripY + 18.0);

    doc.setFontSize(12);
    doc.setTextColor(...BLK);
    doc.text(pnr, c1 + 5, stripY + 18.0, { maxWidth: 103 });

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DK);
    doc.text("Issued Date", c2 + 5, stripY + 18.0);
    doc.setFont("helvetica", "normal");
    doc.text(issuedDate, c3 + 5, stripY + 18.0, { maxWidth: 103 });

    doc.setFont("helvetica", "bold");
    doc.text("Passengers", c4 + 5, stripY + 18.0);
    doc.setFont("helvetica", "normal");
    doc.text(paxSummary, c5 + 5, stripY + 18.0, { maxWidth: 70 });

    // Strip Row 2 (Highlighted Check-in)
    const sectorCheckins = getSectorCheckinList(data).slice(0, 2);
    const isMultiSector = sectorCheckins.length > 1;

    if (isMultiSector) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.6);
        doc.setTextColor(...DK);
        doc.text(sectorCheckins[0].label, c0 + 5, stripY + 39.5, { maxWidth: 65 });
        doc.text(sectorCheckins[1].label, c0 + 5, stripY + 52.0, { maxWidth: 65 });

        sectorCheckins.forEach((sc, i) => {
            const by = (i === 0) ? (stripY + 31.0) : (stripY + 44.5);
            const baselineY = (i === 0) ? (stripY + 39.5) : (stripY + 52.0);

            doc.setFont("helvetica", "bold");
            let cFontSize = 7.2;
            doc.setFontSize(cFontSize);
            let tw = doc.getTextWidth(sc.time);
            while (tw > 98 && cFontSize > 6.0) {
                cFontSize -= 0.3;
                doc.setFontSize(cFontSize);
                tw = doc.getTextWidth(sc.time);
            }
            const bgW = Math.min(tw + 8, 106);
            const bgH = 11.5;

            doc.setFillColor(...CIBG);
            doc.setDrawColor(...CIBD);
            doc.setLineWidth(0.7);
            doc.roundedRect(c1 + 4, by, bgW, bgH, 2, 2, 'FD');

            doc.setTextColor(...EVAG);
            doc.text(sc.time, c1 + 8, baselineY);
        });
    } else {
        const sc = sectorCheckins[0];
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...DK);
        doc.text(sc.label, c0 + 5, stripY + 46.5, { maxWidth: 65 });

        doc.setFont("helvetica", "bold");
        let cFontSize = 8.0;
        doc.setFontSize(cFontSize);
        let tw = doc.getTextWidth(sc.time);
        while (tw > 98 && cFontSize > 6.5) {
            cFontSize -= 0.3;
            doc.setFontSize(cFontSize);
            tw = doc.getTextWidth(sc.time);
        }
        const bgW = Math.min(tw + 8, 106);
        const bgH = 13.0;
        const by = stripY + 37.5;
        const baselineY = stripY + 46.5;

        doc.setFillColor(...CIBG);
        doc.setDrawColor(...CIBD);
        doc.setLineWidth(0.7);
        doc.roundedRect(c1 + 4, by, bgW, bgH, 2, 2, 'FD');

        doc.setTextColor(...EVAG);
        doc.text(sc.time, c1 + 8, baselineY);
    }

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DK);
    doc.text("Status", c2 + 5, stripY + 46.5);
    doc.setTextColor(...BLK);
    doc.text(isSample ? "Confirmed (Sample)" : "Confirmed", c3 + 5, stripY + 46.5);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DK);
    doc.text("Alliance", c4 + 5, stripY + 46.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.text("Star\nAlliance", c5 + 5, stripY + 43.5);

    // 3. FLIGHT DETAILS
    let curY = stripY + stripH + 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...EVAG);
    doc.text("Flight Details", marginL, curY);
    curY += 8;

    const numFlights = flights.length;
    const cardTopH = numFlights > 1 ? 95 : 108;
    const infoTableH = 40;

    flights.forEach(f => {
        const sDepCity = extractCityName(f.depAirport) || 'Taipei';
        const sArrCity = extractCityName(f.arrAirport) || 'Bangkok';
        let sArrAirport = f.arrAirport || '';
        if (f.arrTerminal) sArrAirport += `, ${f.arrTerminal}`;
        const sRoute = f.route || `${lookupAirportCode(f.depAirport) || 'TPE'} - ${lookupAirportCode(f.arrAirport) || 'BKK'}`;
        const sFlightNo = (f.flightNo && !/^(AK|FD|VJ)/i.test(f.flightNo)) ? f.flightNo : 'BR 001';

        // Green Card Top Bar + Upper section
        doc.setFillColor(...EVAG);
        doc.roundedRect(marginL, curY, textW, cardTopH, 2, 2, 'F');

        // Top bar text inside green card
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...WHT);
        doc.text(sDepCity, marginL + 8, curY + 21);
        const cityW = doc.getTextWidth(sDepCity);

        // Vector arrow
        const ax = marginL + 8 + cityW + 6;
        const ay = curY + 16.5;
        doc.setDrawColor(...WHT);
        doc.setFillColor(...WHT);
        doc.setLineWidth(1.4);
        doc.line(ax, ay, ax + 9, ay);
        doc.triangle(
            ax + 7.5, ay - 2.5,
            ax + 12.5, ay,
            ax + 7.5, ay + 2.5,
            'FD'
        );

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...WHT);
        doc.text(sArrCity, ax + 18, curY + 21);

        const sectorPnr = f.pnr || pnr;
        if (sectorPnr && sectorPnr !== pnr) {
            const pnrBadgeText = `Booking Ref: ${sectorPnr}`;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            const badgeW = doc.getTextWidth(pnrBadgeText) + 10;
            const badgeH = 14;
            const badgeX = rightEdge - 8 - badgeW;
            const badgeY = curY + 11;

            doc.setFillColor(...EVAO); // Orange badge
            doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'F');
            doc.setTextColor(...WHT); // White text on orange badge
            doc.text(pnrBadgeText, badgeX + badgeW / 2, badgeY + 10, { align: "center" });

            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...WHT);
            doc.text(`${sFlightNo}  |  EVA Air`, badgeX - 8, curY + 21, { align: "right" });
        } else {
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...WHT);
            doc.text(`${sFlightNo}  |  EVA Air`, rightEdge - 8, curY + 21, { align: "right" });
        }

        // Times (Bold 15pt White)
        doc.setFontSize(15);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...WHT);
        doc.text(f.depTime || "09:25", marginL + 8, curY + 50);
        doc.text(f.arrTime || "13:05", marginL + 258, curY + 50);

        // Dates (Light 8pt)
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(225, 245, 230);
        doc.text(f.depDateFormatted || "Sunday, 1 November 2026", marginL + 8, curY + 72);
        doc.text(f.arrDateFormatted || f.depDateFormatted || "Sunday, 1 November 2026", marginL + 258, curY + 72);

        // Airports + Terminals
        let depAirportFull = f.depAirport || "Taipei - Taoyuan (TPE)";
        if (f.depTerminal) depAirportFull += `, ${f.depTerminal}`;
        let arrAirportFull = sArrAirport || "Bangkok - Suvarnabhumi (BKK)";

        doc.text(depAirportFull, marginL + 8, curY + 86, { maxWidth: 240 });
        doc.text(arrAirportFull, marginL + 258, curY + 86, { maxWidth: 240 });

        curY += cardTopH;

        // Info table 2x4 with light-orange background and orange border
        doc.setFillColor(...LO);
        doc.rect(marginL, curY, textW, infoTableH, 'F');
        doc.setDrawColor(...EVAO);
        doc.setLineWidth(0.5);
        doc.rect(marginL, curY, textW, infoTableH, 'S');

        // Middle horizontal line
        doc.line(marginL, curY + 20, rightEdge, curY + 20);

        // Vertical columns
        const colW = [70, 185, 70, 185.3];
        const v1 = marginL + colW[0];
        const v2 = v1 + colW[1];
        const v3 = v2 + colW[2];
        doc.line(v1, curY, v1, curY + infoTableH);
        doc.line(v2, curY, v2, curY + infoTableH);
        doc.line(v3, curY, v3, curY + infoTableH);

        // Row 1
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...DK);
        doc.text("Duration", marginL + 6, curY + 13.5);
        doc.setFont("helvetica", "normal");
        doc.text(f.duration || "3h 40min, Non-Stop", v1 + 6, curY + 13.5, { maxWidth: 175 });

        doc.setFont("helvetica", "bold");
        doc.text("Aircraft", v2 + 6, curY + 13.5);
        doc.setFont("helvetica", "normal");
        doc.text(f.aircraft || "Boeing 787-10", v3 + 6, curY + 13.5, { maxWidth: 175 });

        // Row 2
        doc.setFont("helvetica", "bold");
        doc.text("Class", marginL + 6, curY + 33.5);
        doc.setFont("helvetica", "normal");
        doc.text(f.flightClass || "Economy (Y)", v1 + 6, curY + 33.5, { maxWidth: 175 });

        doc.setFont("helvetica", "bold");
        doc.text("Route", v2 + 6, curY + 33.5);
        doc.setFont("helvetica", "normal");
        doc.text(sRoute, v3 + 6, curY + 33.5, { maxWidth: 175 });

        curY += infoTableH + 12;
    });

    curY += 2;

    // 4. PASSENGER DETAILS
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...EVAG);
    doc.text("Passenger Details", marginL, curY);
    curY += 8;

    const paxHeaderH = 18.0;
    const paxRowH = 20.0;
    const paxCol1 = marginL;
    const paxCol2 = marginL + 140;
    const paxCol3 = marginL + 310;
    const paxCol4 = marginL + 410;

    // Table Header
    doc.setFillColor(...EVAG);
    doc.rect(marginL, curY, textW, paxHeaderH, 'F');
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHT);
    doc.text("Name", paxCol1 + 6, curY + 12.5);
    doc.text("E-Ticket No.", paxCol2 + 6, curY + 12.5);
    doc.text("Type", paxCol3 + 6, curY + 12.5);
    doc.text("Seat", paxCol4 + 6, curY + 12.5);

    curY += paxHeaderH;

    paxList.forEach((p, idx) => {
        doc.setFillColor(...LT);
        doc.rect(marginL, curY, textW, paxRowH, 'F');
        doc.setDrawColor(...BGG);
        doc.setLineWidth(0.5);
        doc.rect(marginL, curY, textW, paxRowH, 'S');

        doc.line(paxCol2, curY, paxCol2, curY + paxRowH);
        doc.line(paxCol3, curY, paxCol3, curY + paxRowH);
        doc.line(paxCol4, curY, paxCol4, curY + paxRowH);

        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...BLK);
        doc.text(p.name || "SAMPLE PASSENGER", marginL + 6, curY + 13.5, { maxWidth: 130 });

        doc.setFont("helvetica", "normal");
        doc.text(p.eticket || p.eTicketNo || data.eTicketNo || "To be advised at check-in", paxCol2 + 6, curY + 13.5, { maxWidth: 160 });
        doc.text(p.type || "Adult", paxCol3 + 6, curY + 13.5, { maxWidth: 90 });
        doc.text(p.seat || "—", paxCol4 + 6, curY + 13.5, { maxWidth: 90 });

        curY += paxRowH;
    });

    curY += 14;

    // 5. BAGGAGE ALLOWANCE
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...EVAG);
    doc.text("Baggage Allowance", marginL, curY);
    curY += 8;

    const bagRowH = 22.0;
    const totalBagH = bagRowH * paxList.length;
    doc.setFillColor(...LO);
    doc.rect(marginL, curY, textW, totalBagH, 'F');
    doc.setDrawColor(...EVAO);
    doc.setLineWidth(0.5);
    doc.rect(marginL, curY, textW, totalBagH, 'S');

    const bagSplit = marginL + 130;
    doc.line(bagSplit, curY, bagSplit, curY + totalBagH);

    paxList.forEach((p, idx) => {
        const rowY = curY + (idx * bagRowH);
        if (idx > 0) {
            doc.line(marginL, rowY, rightEdge, rowY);
        }
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...BLK);
        doc.text(p.name || "SAMPLE PASSENGER", marginL + 6, rowY + 14.5, { maxWidth: 120 });

        doc.setFont("helvetica", "normal");
        const bagInfo = p.baggage || data.checkedBaggage || "Checked: 30 kg   |   Carry-on: 7 kg";
        doc.text(bagInfo, bagSplit + 6, rowY + 14.5, { maxWidth: 360 });
    });

    curY += totalBagH + 14;

    // 6. NOTES
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...EVAG);
    doc.text("Notes", marginL, curY);
    curY += 12;

    const notesBullets = [];
    if (isSample) {
        notesBullets.push("•  This is a SAMPLE template for layout demonstration only — not a valid ticket or booking confirmation.");
    }
    notesBullets.push(
        "•  Passengers must present the valid ID used to purchase the ticket at check-in; boarding pass or itinerary may also be required.",
        "•  Tickets must be used in the sequence set out in the itinerary, otherwise the airline reserves the right to refuse carriage.",
        "•  Please arrive at the airport at least 3 hours before departure to allow enough time for check-in."
    );

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...DK);

    notesBullets.forEach(b => {
        const lines = doc.splitTextToSize(b, textW - 8);
        doc.text(lines, marginL + 4, curY);
        curY += (lines.length * 10) + 2;
    });

    curY += 6;

    // 7. FOOTER: thin orange rule (0.6mm = 1.7pt)
    doc.setDrawColor(...EVAO);
    doc.setLineWidth(1.7);
    doc.line(marginL, curY, rightEdge, curY);
    curY += 14;

    // Centered 8pt gray footer
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUT);
    const depDateShort = firstFlight.depDateFormatted ? firstFlight.depDateFormatted.replace(/^[A-Za-z]+day,\s*/, '').toUpperCase() : '1 NOV 2026';
    const footerMsg = isSample
        ? `evaair.com   |   SAMPLE TEMPLATE — not a valid ticket`
        : `evaair.com   |   Booking Ref ${pnr}   |   ${firstFlight.flightNo || 'BR 001'} ${depCity} - ${arrCity}, ${depDateShort}`;
    doc.text(footerMsg, 595.28 / 2, curY, { align: "center" });

    return doc;
}

/**
 * Generate native vector jsPDF document for Singapore Airlines matching official template
 * Brand tokens:
 * Primary (SQ blue): #1B3A6B [27, 58, 107]
 * Accent (SQ gold): #E8A90C [232, 169, 12]
 * Light tint: #F2F5FA [242, 245, 250]
 * Light gold: #FDF8EC [253, 248, 236]
 * Border blue-gray: #B9C6DD [185, 198, 221]
 * Border gold: #E8A90C [232, 169, 12]
 * Check-in highlight tint: #EBF2FC [235, 242, 252] (border: #9CB8E2, text: #1B3A6B)
 */
export async function generateSingaporeAirlinesPdfDoc(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const logoDataUrl = await getAirlineLogoDataUrl('Singapore Airlines');

    const marginL = 42.5;
    const rightEdge = 552.8;
    const textW = rightEdge - marginL; // 510.3 pt

    const SQB = [27, 58, 107];     // #1B3A6B SQ Blue
    const SQG = [232, 169, 12];    // #E8A90C SQ Gold
    const LT = [242, 245, 250];    // #F2F5FA Light Blue Tint
    const LG = [253, 248, 236];    // #FDF8EC Light Gold
    const BBG = [185, 198, 221];   // #B9C6DD Blue-gray border
    const CIBG = [224, 237, 253];  // Highlighted Check-in Badge background (#E0EDFD)
    const CIBD = [110, 157, 216];  // Highlighted Check-in Badge border (#6E9DD8)
    const DK = [51, 51, 51];       // #333333 Dark Text
    const MUT = [136, 136, 136];   // #888888 Gray
    const WHT = [255, 255, 255];   // #FFFFFF White
    const BLK = [17, 17, 17];      // #111111

    const allPnrs = resolveAllPnrs(data);
    const pnr = allPnrs.length > 0 ? allPnrs.join(' / ') : ((data.pnr || data.bookingNo || 'SMPL01').trim().toUpperCase());
    const issuedDate = data.issuedDate || formatTicketDate(new Date());
    const paxList = (data.passengers && data.passengers.length > 0)
        ? data.passengers
        : [{ name: data.passengerName || 'SAMPLE PASSENGER', type: data.passengerType || 'Adult', eticket: data.eTicketNo || '', passport: '', expiry: '' }];
    const paxSummary = paxList.length === 1 ? `1 ${paxList[0].type || 'Adult'}` : `${paxList.length} Adults`;

    const flights = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || 'SQ 001',
            airlineName: data.airlineName || 'Singapore Airlines',
            depTime: data.depTime || '09:00',
            depDateFormatted: data.depDateFormatted || 'Saturday, 1 November 2026',
            depAirport: data.depAirport || 'Singapore - Changi (SIN)',
            depTerminal: data.depTerminal || 'Terminal 3',
            arrTime: data.arrTime || '15:30',
            arrDateFormatted: data.arrDateFormatted || 'Saturday, 1 November 2026',
            arrAirport: data.arrAirport || 'London - Heathrow (LHR)',
            arrTerminal: data.arrTerminal || 'Terminal 2',
            duration: data.duration || '13h 30min, Non-Stop',
            aircraft: data.aircraft || 'Airbus A380-800',
            flightClass: data.flightClass || 'Economy (S)',
            route: data.route || 'SIN - LHR'
        }];

    const firstFlight = flights[0];
    const depCity = extractCityName(firstFlight.depAirport) || 'Singapore';
    const arrCity = extractCityName(firstFlight.arrAirport) || 'London';

    // 1. HEADER
    if (logoDataUrl) {
        try {
            // ~62mm wide = ~175 pt wide, cropped transparent PNG with natural 2.7:1 ratio
            const logoW = 165;
            const logoH = logoW / 2.72; // ~60.6 pt
            doc.addImage(logoDataUrl, 'PNG', marginL, 56, logoW, logoH, undefined, 'FAST');
        } catch (e) {
            console.warn("Logo add error:", e);
        }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...SQB);
    doc.text("BOOKING CONFIRMATION", rightEdge, 70, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...DK);
    doc.text("Singapore Airlines (SQ)", rightEdge, 86, { align: "right" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...SQB);
    doc.text(`Booking Ref: ${pnr}`, rightEdge, 104, { align: "right" });

    // Gold Rule below header (1mm = 2.83pt)
    doc.setDrawColor(...SQG);
    doc.setLineWidth(2.83);
    doc.line(marginL, 122.4, rightEdge, 122.4);

    // 2. BOOKING STRIP
    const stripY = 137.5;
    const stripH = 58.5;
    doc.setFillColor(...LT);
    doc.rect(marginL, stripY, textW, stripH, 'F');
    doc.setDrawColor(...BBG);
    doc.setLineWidth(0.5);
    doc.rect(marginL, stripY, textW, stripH, 'S');

    // Horizontal divider
    doc.line(marginL, stripY + 23.5, rightEdge, stripY + 23.5);
    // Vertical dividers: matches 180mm table proportions
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

    // Strip Row 2 (Prominent Highlighted Check-in Time)
    const sectorCheckins = getSectorCheckinList(data).slice(0, 2);
    const isMultiSector = sectorCheckins.length > 1;

    if (isMultiSector) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.6);
        doc.setTextColor(...DK);
        doc.text(sectorCheckins[0].label, marginL + 5, stripY + 33.5, { maxWidth: 72 });
        doc.text(sectorCheckins[1].label, marginL + 5, stripY + 48.0, { maxWidth: 72 });

        sectorCheckins.forEach((sc, i) => {
            const by = (i === 0) ? (stripY + 25.0) : (stripY + 39.5);
            const baselineY = (i === 0) ? (stripY + 33.5) : (stripY + 48.0);
            
            doc.setFont("helvetica", "bold");
            let cFontSize = 7.2;
            doc.setFontSize(cFontSize);
            let tw = doc.getTextWidth(sc.time);
            while (tw > 98 && cFontSize > 6.0) {
                cFontSize -= 0.3;
                doc.setFontSize(cFontSize);
                tw = doc.getTextWidth(sc.time);
            }
            const bgW = Math.min(tw + 8, 106);
            const bgH = 11.5;

            // Highlighted Badge with clear contrast
            doc.setFillColor(...CIBG);
            doc.setDrawColor(...CIBD);
            doc.setLineWidth(0.7);
            doc.roundedRect(127.6 + 4, by, bgW, bgH, 2, 2, 'FD');

            doc.setTextColor(...SQB);
            doc.text(sc.time, 127.6 + 8, baselineY);
        });
    } else {
        const sc = sectorCheckins[0];
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...DK);
        doc.text(sc.label, marginL + 5, stripY + 42.0, { maxWidth: 72 });

        doc.setFont("helvetica", "bold");
        let cFontSize = 8.0;
        doc.setFontSize(cFontSize);
        let tw = doc.getTextWidth(sc.time);
        while (tw > 98 && cFontSize > 6.5) {
            cFontSize -= 0.3;
            doc.setFontSize(cFontSize);
            tw = doc.getTextWidth(sc.time);
        }
        const bgW = Math.min(tw + 8, 106);
        const bgH = 13.0;
        const by = stripY + 33.0;
        const baselineY = stripY + 42.0;

        doc.setFillColor(...CIBG);
        doc.setDrawColor(...CIBD);
        doc.setLineWidth(0.7);
        doc.roundedRect(127.6 + 4, by, bgW, bgH, 2, 2, 'FD');

        doc.setTextColor(...SQB);
        doc.text(sc.time, 127.6 + 8, baselineY);
    }

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DK);
    doc.text("Status", 240.9 + 5, stripY + 42.0);
    doc.setTextColor(...BLK);
    doc.text("Confirmed", 326.0 + 5, stripY + 42.0);

    doc.setTextColor(...DK);
    doc.text("Alliance", 439.4 + 5, stripY + 42.0);
    doc.setFont("helvetica", "normal");
    doc.text("Star Alliance", 501.7 + 5, stripY + 42.0, { maxWidth: 45 });

    // 3. FLIGHT DETAILS
    let curY = stripY + stripH + 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...SQB);
    doc.text("Flight Details", marginL, curY);
    curY += 8;

    const numFlights = flights.length;
    const isMultiFlight = numFlights > 1;

    flights.forEach((f) => {
        const sDepCity = extractCityName(f.depAirport) || 'Singapore';
        const sArrCity = extractCityName(f.arrAirport) || 'London';
        const sFlightNo = (f.flightNo && !/^(AK|FD|VJ)/i.test(f.flightNo)) ? f.flightNo : 'SQ 001';

        // Upper Blue Card
        const upperBoxH = isMultiFlight ? 100 : 110;
        doc.setFillColor(...SQB);
        doc.rect(marginL, curY, textW, upperBoxH, 'F');
        doc.setDrawColor(...BBG);
        doc.setLineWidth(0.5);
        doc.rect(marginL, curY, textW, upperBoxH, 'S');

        // Top line inside Blue Card: Origin ➔ Destination
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...WHT);
        doc.text(sDepCity, marginL + 8, curY + 21);
        const cityW = doc.getTextWidth(sDepCity);

        // Elegant vector right-arrow
        const ax = marginL + 8 + cityW + 6;
        const ay = curY + 16.5;
        doc.setDrawColor(...WHT);
        doc.setFillColor(...WHT);
        doc.setLineWidth(1.4);
        doc.line(ax, ay, ax + 9, ay);
        doc.triangle(
            ax + 7.5, ay - 2.5,
            ax + 12.5, ay,
            ax + 7.5, ay + 2.5,
            'FD'
        );

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...WHT);
        doc.text(sArrCity, ax + 18, curY + 21);

        const sectorPnr = f.pnr || pnr;

        if (sectorPnr && sectorPnr !== pnr) {
            const pnrBadgeText = `Booking Ref: ${sectorPnr}`;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            const badgeW = doc.getTextWidth(pnrBadgeText) + 10;
            const badgeH = 14;
            const badgeX = rightEdge - 8 - badgeW;
            const badgeY = curY + 11;

            doc.setFillColor(...SQG); // Gold badge
            doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'F');
            doc.setTextColor(...SQB); // SQ Blue text
            doc.text(pnrBadgeText, badgeX + badgeW / 2, badgeY + 10, { align: "center" });

            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...WHT);
            doc.text(`${sFlightNo}  |  Singapore Airlines`, badgeX - 8, curY + 21, { align: "right" });
        } else {
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...WHT);
            doc.text(`${sFlightNo}  |  Singapore Airlines`, rightEdge - 8, curY + 21, { align: "right" });
        }

        // Times (Bold 15pt White)
        doc.setFontSize(15);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...WHT);
        doc.text(f.depTime || "09:00", marginL + 8, curY + 50);
        doc.text(f.arrTime || "15:30", marginL + 258, curY + 50);

        // Dates (Light 8pt)
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(225, 235, 250);
        doc.text(f.depDateFormatted || "Saturday, 1 November 2026", marginL + 8, curY + 72);
        doc.text(f.arrDateFormatted || "Saturday, 1 November 2026", marginL + 258, curY + 72);

        // Airports + Terminals (Light 8pt)
        const depAirStr = `${f.depAirport || 'Singapore - Changi (SIN)'}${f.depTerminal ? ', ' + f.depTerminal : ''}`;
        const arrAirStr = `${f.arrAirport || 'London - Heathrow (LHR)'}${f.arrTerminal ? ', ' + f.arrTerminal : ''}`;
        doc.text(depAirStr, marginL + 8, curY + 92);
        doc.text(arrAirStr, marginL + 258, curY + 92);

        curY += upperBoxH;

        // 2x4 Info Table (Duration | Aircraft / Class | Route) with Light-gold background and gold borders
        const infoRowH = 20.0;
        const lowerBoxH = infoRowH * 2;
        doc.setFillColor(...LG);
        doc.rect(marginL, curY, textW, lowerBoxH, 'F');
        doc.setDrawColor(...SQG);
        doc.setLineWidth(0.5);
        doc.rect(marginL, curY, textW, lowerBoxH, 'S');

        // Horizontal divider
        doc.line(marginL, curY + infoRowH, rightEdge, curY + infoRowH);
        // Vertical dividers: 121.9, 297.6, 377.0
        [121.9, 297.6, 377.0].forEach(x => doc.line(x, curY, x, curY + lowerBoxH));

        // Info Row 1: Duration | Aircraft
        doc.setTextColor(...DK);
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.text("Duration", marginL + 6, curY + 13.5);
        doc.setFont("helvetica", "normal");
        doc.text(f.duration || "13h 30min, Non-Stop", 121.9 + 6, curY + 13.5, { maxWidth: 160 });

        doc.setFont("helvetica", "bold");
        doc.text("Aircraft", 297.6 + 6, curY + 13.5);
        doc.setFont("helvetica", "normal");
        doc.text(f.aircraft || "Airbus A380-800", 377.0 + 6, curY + 13.5, { maxWidth: 160 });

        // Info Row 2: Class | Route
        const r2Y = curY + infoRowH;
        doc.setFont("helvetica", "bold");
        doc.text("Class", marginL + 6, r2Y + 13.5);
        doc.setFont("helvetica", "normal");
        doc.text(f.flightClass || data.flightClass || "Economy (S)", 121.9 + 6, r2Y + 13.5, { maxWidth: 160 });

        doc.setFont("helvetica", "bold");
        doc.text("Route", 297.6 + 6, r2Y + 13.5);
        doc.setFont("helvetica", "normal");
        const sRoute = f.route || `${lookupAirportCode(f.depAirport) || 'SIN'} - ${lookupAirportCode(f.arrAirport) || 'LHR'}`;
        doc.text(sRoute, 377.0 + 6, r2Y + 13.5, { maxWidth: 160 });

        curY += lowerBoxH + 14;
    });

    // 4. PASSENGER DETAILS
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...SQB);
    doc.text("Passenger Details", marginL, curY);
    curY += 8;

    const paxHeaderH = 22.0;
    doc.setFillColor(...SQB);
    doc.rect(marginL, curY, textW, paxHeaderH, 'F');
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHT);

    // Columns: Name | E-Ticket No. | Type | Seat
    const paxCol2 = marginL + 155;
    const paxCol3 = marginL + 310;
    const paxCol4 = marginL + 415;
    doc.text("Name", marginL + 6, curY + 14.5);
    doc.text("E-Ticket No.", paxCol2 + 6, curY + 14.5);
    doc.text("Type", paxCol3 + 6, curY + 14.5);
    doc.text("Seat", paxCol4 + 6, curY + 14.5);
    curY += paxHeaderH;

    const paxRowH = 22.0;
    paxList.forEach((p, idx) => {
        const bg = (idx % 2 === 0) ? LT : [255, 255, 255];
        doc.setFillColor(...bg);
        doc.rect(marginL, curY, textW, paxRowH, 'F');
        doc.setDrawColor(...BBG);
        doc.setLineWidth(0.5);
        doc.rect(marginL, curY, textW, paxRowH, 'S');

        [paxCol2, paxCol3, paxCol4].forEach(x => doc.line(x, curY, x, curY + paxRowH));

        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...BLK);
        doc.text(p.name || "SAMPLE PASSENGER", marginL + 6, curY + 14.5, { maxWidth: 145 });

        doc.setFont("helvetica", "normal");
        doc.text(p.eticket || p.eTicketNo || data.eTicketNo || "To be advised at check-in", paxCol2 + 6, curY + 14.5, { maxWidth: 145 });
        doc.text(p.type || "Adult", paxCol3 + 6, curY + 14.5, { maxWidth: 95 });
        doc.text(p.seat || "—", paxCol4 + 6, curY + 14.5, { maxWidth: 75 });

        curY += paxRowH;
    });

    curY += 14;

    // 5. BAGGAGE ALLOWANCE
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...SQB);
    doc.text("Baggage Allowance", marginL, curY);
    curY += 8;

    const bagRowH = 22.0;
    const totalBagH = bagRowH * paxList.length;
    doc.setFillColor(...LG);
    doc.rect(marginL, curY, textW, totalBagH, 'F');
    doc.setDrawColor(...SQG);
    doc.setLineWidth(0.5);
    doc.rect(marginL, curY, textW, totalBagH, 'S');

    // Vertical divider at marginL + 130
    const bagSplit = marginL + 130;
    doc.line(bagSplit, curY, bagSplit, curY + totalBagH);

    paxList.forEach((p, idx) => {
        const rowY = curY + (idx * bagRowH);
        if (idx > 0) {
            doc.line(marginL, rowY, rightEdge, rowY);
        }
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...BLK);
        doc.text(p.name || "SAMPLE PASSENGER", marginL + 6, rowY + 14.5, { maxWidth: 120 });

        doc.setFont("helvetica", "normal");
        const bagInfo = p.baggage || data.checkedBaggage || "Checked: 30 kg   |   Carry-on: 7 kg";
        doc.text(bagInfo, bagSplit + 6, rowY + 14.5, { maxWidth: 350 });
    });

    curY += totalBagH + 14;

    // 6. NOTES
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...SQB);
    doc.text("Notes", marginL, curY);
    curY += 12;

    const notesBullets = [
        "•  Passengers must present the valid ID used to purchase the ticket at check-in; boarding pass or itinerary may also be required.",
        "•  Tickets must be used in the sequence set out in the itinerary, otherwise the airline reserves the right to refuse carriage.",
        "•  Please arrive at the airport at least 3 hours before departure to allow enough time for check-in."
    ];

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...DK);

    notesBullets.forEach(b => {
        const lines = doc.splitTextToSize(b, textW - 8);
        doc.text(lines, marginL + 4, curY);
        curY += (lines.length * 10) + 2;
    });

    curY += 6;

    // 7. FOOTER: thin gold rule (0.6mm = 1.7pt)
    doc.setDrawColor(...SQG);
    doc.setLineWidth(1.7);
    doc.line(marginL, curY, rightEdge, curY);
    curY += 14;

    // Centered 8pt gray footer
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUT);
    const depDateShort = firstFlight.depDateFormatted ? firstFlight.depDateFormatted.replace(/^[A-Za-z]+day,\s*/, '').toUpperCase() : '1 NOV 2026';
    const footerMsg = `singaporeair.com   |   Booking Ref ${pnr}   |   ${firstFlight.flightNo || 'SQ 001'} ${depCity} - ${arrCity}, ${depDateShort}`;
    doc.text(footerMsg, 595.28 / 2, curY, { align: "center" });

    return doc;
}

/**
 * Generate native vector jsPDF document matching the exact official template
 */
export async function generateAirAsiaPdfDoc(data) {
    if (data.airline === 'EVA Air' || /eva\s*air|\bBR\s*\d/i.test(data.airlineName || '') || /BR\s*\d/i.test(data.flightNo || '')) {
        return generateEvaAirPdfDoc(data);
    }
    if (data.airline === 'Singapore Airlines' || /singapore\s*air(?:lines)?|\bSQ\s*\d/i.test(data.airlineName || '') || /SQ\s*\d/i.test(data.flightNo || '')) {
        return generateSingaporeAirlinesPdfDoc(data);
    }
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

    const sectorCheckins = getSectorCheckinList(data).slice(0, 2);
    const isMultiSector = sectorCheckins.length > 1;

    const row1H = isMultiSector ? 35 : 20.5;
    const row2H = 20.5;
    const bookBoxHeight = row1H + row2H;

    const bookBoxY = cursorY;
    doc.setFillColor(...greyBg);
    doc.rect(marginX, bookBoxY, contentWidth, bookBoxHeight, 'F');
    doc.setDrawColor(...borderGrey);
    doc.setLineWidth(0.5);
    doc.rect(marginX, bookBoxY, contentWidth, bookBoxHeight, 'S');

    doc.line(marginX, bookBoxY + row1H, marginX + contentWidth, bookBoxY + row1H);

    const col2X = marginX + 125;
    const col3X = marginX + 255;
    const col4X = marginX + 402;
    doc.line(col2X, bookBoxY, col2X, bookBoxY + bookBoxHeight);
    doc.line(col3X, bookBoxY, col3X, bookBoxY + bookBoxHeight);
    doc.line(col4X, bookBoxY, col4X, bookBoxY + bookBoxHeight);

    const badgeBg = isVietJet ? [255, 235, 235] : [255, 228, 231]; // richer rose/red tint
    const badgeBorder = isVietJet ? [248, 140, 140] : [240, 110, 120]; // prominent crisp border

    if (isMultiSector) {
        doc.setFontSize(8.2);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...darkColor);
        doc.text(sectorCheckins[0].label, marginX + 6, bookBoxY + 12.0);
        doc.text(sectorCheckins[1].label, marginX + 6, bookBoxY + 26.5);

        sectorCheckins.forEach((sc, i) => {
            const by = (i === 0) ? (bookBoxY + 3.0) : (bookBoxY + 17.5);
            const baselineY = (i === 0) ? (bookBoxY + 11.5) : (bookBoxY + 26.0);
            
            doc.setFont("helvetica", "bold");
            let cFontSize = 7.5;
            doc.setFontSize(cFontSize);
            let cTextW = doc.getTextWidth(sc.time);
            while (cTextW > 112 && cFontSize > 6.2) {
                cFontSize -= 0.3;
                doc.setFontSize(cFontSize);
                cTextW = doc.getTextWidth(sc.time);
            }
            const badgeW = Math.min(cTextW + 8, 122);
            const badgeH = 11.5;

            doc.setFillColor(...badgeBg);
            doc.setDrawColor(...badgeBorder);
            doc.setLineWidth(0.7);
            doc.roundedRect(col2X + 5, by, badgeW, badgeH, 2, 2, 'FD');

            doc.setTextColor(...redColor);
            doc.text(sc.time, col2X + 9, baselineY);
        });
    } else {
        const sc = sectorCheckins[0];
        doc.setFontSize(9.0);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...darkColor);
        doc.text(sc.label, marginX + 6, bookBoxY + 14);

        doc.setFont("helvetica", "bold");
        let checkinFontSize = 8.2;
        doc.setFontSize(checkinFontSize);
        let cTextW = doc.getTextWidth(sc.time);
        while (cTextW > 116 && checkinFontSize > 6.5) {
            checkinFontSize -= 0.3;
            doc.setFontSize(checkinFontSize);
            cTextW = doc.getTextWidth(sc.time);
        }

        const badgeW = Math.min(cTextW + 8, 122);
        const badgeH = 13.0;
        const badgeX = col2X + 5;
        const badgeY = bookBoxY + 3.5;

        doc.setFillColor(...badgeBg);
        doc.setDrawColor(...badgeBorder);
        doc.setLineWidth(0.7);
        doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'FD');

        doc.setTextColor(...redColor);
        doc.text(sc.time, badgeX + 4, bookBoxY + 13.0);
    }

    doc.setFontSize(9.5);
    doc.setTextColor(...darkColor);
    doc.setFont("helvetica", "bold");
    const midRow1Y = bookBoxY + (row1H / 2) + 3.5;
    doc.text("Airline Booking Reference", col3X + 6, midRow1Y);
    const allPnrs = resolveAllPnrs(data);
    const pnrVal = allPnrs.length > 0 ? allPnrs.join(' / ') : (data.pnr || "");
    if (doc.getTextWidth(pnrVal) > (contentWidth - (col4X - marginX) - 12) || pnrVal.length > 12) {
        doc.setFontSize(7.5);
    } else {
        doc.setFontSize(8.5);
    }
    doc.text(pnrVal, col4X + 6, midRow1Y);
    doc.setFontSize(9.5);

    // Row 2
    const row2Baseline = bookBoxY + row1H + 14;
    doc.setFont("helvetica", "bold");
    doc.text("E-Ticket No.", marginX + 6, row2Baseline);
    doc.setFont("helvetica", "normal");
    doc.text(data.eTicketNo || "To be advised at check-in", col2X + 6, row2Baseline);

    doc.setFont("helvetica", "bold");
    doc.text("Class", col3X + 6, row2Baseline);
    doc.setFont("helvetica", "normal");
    doc.text(data.flightClass || "Economy", col4X + 6, row2Baseline);

    cursorY += bookBoxHeight + (isMultiSector ? 9 : 20);

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
    const isEva = (data.airline === 'EVA Air') || /eva\s*air|\bBR\s*\d/i.test(data.airlineName || '') || /BR\s*\d/i.test(data.flightNo || '');
    const isSIA = (data.airline === 'Singapore Airlines') || /singapore\s*air(?:lines)?|\bSQ\s*\d/i.test(data.airlineName || '') || /SQ\s*\d/i.test(data.flightNo || '');
    const isThai = (data.airline === 'Thai Airways') || /thai\s*airways/i.test(data.airlineName || '') || /TG\s*\d/i.test(data.flightNo || '');
    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isEva ? 'EVAAir' : (isSIA ? 'SingaporeAirlines' : (isThai ? 'ThaiAirways' : (isVietJet ? 'VietJet' : 'AirAsia')));
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
    const logoSrc = cachedThaiLogoDataUrl || 'thai-airways-logo.png';
    const allPnrs = resolveAllPnrs(data);
    const pnr = allPnrs.length > 0 ? allPnrs.join(' / ') : ((data.pnr || data.bookingNo || '').trim().toUpperCase());
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

    const sectorCheckins = getSectorCheckinList(data).slice(0, 2);

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
                <td style="padding:6px 8px; border:1px solid #D5CBE8; width:14%; font-weight:700; color:#333;">Booking Ref</td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; width:27%; font-weight:700; font-size:13px; color:#111;">${pnr}</td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; width:13%; font-weight:700; color:#333;">Issued Date</td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; width:17%; color:#333;">${issuedDate}</td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; width:14%; font-weight:700; color:#333;">Passengers</td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; width:15%; color:#333;">${paxSummary}</td>
            </tr>
            <tr>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; font-weight:700; color:#3D1E6D; vertical-align:middle; white-space:nowrap;">
                    ${sectorCheckins.map((sc, i) => `
                        <div style="${i > 0 ? 'margin-top:6px;' : ''}; font-size:10.5px; white-space:nowrap;">${sc.label}</div>
                    `).join('')}
                </td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; vertical-align:middle; white-space:nowrap;">
                    ${sectorCheckins.map((sc, i) => `
                        <div style="${i > 0 ? 'margin-top:5px;' : ''}; white-space:nowrap;">
                            <span style="display:inline-block; background:#EDE4FC; color:#3D1E6D; border:1.5px solid #9A76D0; font-weight:800; font-size:10.5px; padding:3px 8px; border-radius:4px; white-space:nowrap; box-shadow:0 1px 3px rgba(61,30,109,0.12);">${sc.time}</span>
                        </div>
                    `).join('')}
                </td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; font-weight:700; color:#333; vertical-align:middle;">Status</td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; font-weight:700; color:#111; vertical-align:middle;">Confirmed</td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; font-weight:700; color:#333; vertical-align:middle;">Alliance</td>
                <td style="padding:6px 8px; border:1px solid #D5CBE8; color:#333; line-height:1.2; vertical-align:middle;">Star<br>Alliance</td>
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
                            <div style="font-size:16px; font-weight:800; letter-spacing:0.3px; display:inline-flex; align-items:center;">
                                <span>${fDepCity}</span>
                                <span style="display:inline-flex; align-items:center; margin:0 9px;">
                                    <svg width="22" height="15" viewBox="0 0 22 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <line x1="1" y1="7.5" x2="16" y2="7.5" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/>
                                        <polygon points="14,2.5 21,7.5 14,12.5" fill="#FFFFFF"/>
                                    </svg>
                                </span>
                                <span>${fArrCity}</span>
                            </div>
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
 * Generate preview HTML markup for EVA Air matching official template
 */
export function renderEvaAirTicketHtml(data) {
    const logoSrc = cachedEvaAirLogoDataUrl || 'eva-air-logo.png';
    const allPnrs = resolveAllPnrs(data);
    const pnr = allPnrs.length > 0 ? allPnrs.join(' / ') : ((data.pnr || data.bookingNo || 'EVA01').trim().toUpperCase());
    const isSample = /sample/i.test(pnr) || /sample/i.test(data.bookingNo || '') || /sample/i.test(data.passengerName || '') || data.isSample;
    const issuedDate = data.issuedDate || formatTicketDate(new Date());

    const paxList = (data.passengers && data.passengers.length > 0)
        ? data.passengers
        : [{ name: data.passengerName || 'SAMPLE PASSENGER', type: data.passengerType || 'Adult', eticket: data.eTicketNo || '', passport: '', expiry: '' }];
    const paxSummary = paxList.length === 1 ? `1 ${paxList[0].type || 'Adult'}` : `${paxList.length} Adults`;

    const flights = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || 'BR 001', airlineName: data.airlineName || 'EVA Air',
            depTime: data.depTime || '09:25', depDateFormatted: data.depDateFormatted || 'Sunday, 1 November 2026',
            depAirport: data.depAirport || 'Taipei - Taoyuan (TPE)', depTerminal: data.depTerminal || 'Terminal 2',
            arrTime: data.arrTime || '13:05', arrDateFormatted: data.arrDateFormatted || 'Sunday, 1 November 2026',
            arrAirport: data.arrAirport || 'Bangkok - Suvarnabhumi (BKK)', arrTerminal: data.arrTerminal || '',
            route: data.route || 'TPE - BKK', duration: data.duration || '3h 40min, Non-Stop', aircraft: data.aircraft || 'Boeing 787-10', flightClass: data.flightClass || 'Economy (Y)'
        }];
    const firstFlight = flights[0];
    const depCity = extractCityName(firstFlight.depAirport) || 'Taipei';
    const arrCity = extractCityName(firstFlight.arrAirport) || 'Bangkok';

    const sectorCheckins = getSectorCheckinList(data).slice(0, 2);
    const depDateShort = firstFlight.depDateFormatted ? firstFlight.depDateFormatted.replace(/^[A-Za-z]+day,\s*/, '').toUpperCase() : '1 NOV 2026';

    return `
    <div class="airasia-ticket-wrapper" id="airAsiaTicketDocument" style="background:#ffffff; color:#333333; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; padding:36px 44px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.08); max-width:800px; margin:0 auto; box-sizing:border-box; line-height:1.35; -webkit-print-color-adjust:exact; print-color-adjust:exact;">

        <!-- 1. HEADER -->
        <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:10px;">
            <div style="height:46px; display:flex; align-items:center;">
                <img src="${logoSrc}" alt="EVA Air" style="height:44px; max-width:210px; object-fit:contain; background:transparent;">
            </div>
            <div style="text-align:right;">
                <div style="font-size:22px; font-weight:800; color:#007A3D; letter-spacing:0.5px; line-height:1.15;">BOOKING CONFIRMATION</div>
                ${isSample ? `<div style="font-size:10px; font-weight:700; color:#D32F2F; margin-top:2px;">SAMPLE — not a valid ticket</div>` : ''}
                <div style="font-size:10px; color:#555; margin-top:2px;">EVA Air (BR)</div>
                <div style="font-size:15px; font-weight:700; color:#007A3D; margin-top:2px;">Booking Ref: ${pnr}</div>
            </div>
        </div>
        <div style="height:3.5px; background:#F26522; margin-bottom:14px;"></div>

        <!-- 2. BOOKING STRIP -->
        <table style="width:100%; border-collapse:collapse; background:#EEF7F0; border:1px solid #BCD8C2; font-size:11px; margin-bottom:14px;">
            <tr>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; width:14%; font-weight:700; color:#333;">Booking Ref</td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; width:27%; font-weight:700; font-size:12px; color:#111;">${pnr}</td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; width:13%; font-weight:700; color:#333;">Issued Date</td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; width:17%; color:#333;">${issuedDate}</td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; width:14%; font-weight:700; color:#333;">Passengers</td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; width:15%; color:#333;">${paxSummary}</td>
            </tr>
            <tr>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; font-weight:700; color:#007A3D; vertical-align:middle; white-space:nowrap;">
                    ${sectorCheckins.map((sc, i) => `
                        <div style="${i > 0 ? 'margin-top:6px;' : ''}; font-size:10.5px; white-space:nowrap;">${sc.label}</div>
                    `).join('')}
                </td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; vertical-align:middle; white-space:nowrap;">
                    ${sectorCheckins.map((sc, i) => `
                        <div style="${i > 0 ? 'margin-top:5px;' : ''}; white-space:nowrap;">
                            <span style="display:inline-block; background:#DDF3E4; color:#007A3D; border:1.5px solid #58B675; font-weight:800; font-size:10.5px; padding:3px 8px; border-radius:4px; white-space:nowrap; box-shadow:0 1px 3px rgba(0,122,61,0.12);">${sc.time}</span>
                        </div>
                    `).join('')}
                </td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; font-weight:700; color:#333; vertical-align:middle;">Status</td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; font-weight:700; color:#111; vertical-align:middle;">${isSample ? 'Confirmed (Sample)' : 'Confirmed'}</td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; font-weight:700; color:#333; vertical-align:middle;">Alliance</td>
                <td style="padding:6px 8px; border:1px solid #BCD8C2; color:#333; line-height:1.2; vertical-align:middle;">Star<br>Alliance</td>
            </tr>
        </table>

        <!-- 3. FLIGHT DETAILS -->
        <div style="font-size:14px; font-weight:800; color:#007A3D; margin-bottom:6px;">Flight Details</div>
        <div style="margin-bottom:14px;">
            ${flights.map(f => {
                const fDepCity = extractCityName(f.depAirport) || 'Taipei';
                const fArrCity = extractCityName(f.arrAirport) || 'Bangkok';
                let fArrAirport = f.arrAirport || '';
                if (f.arrTerminal) fArrAirport += `, ${f.arrTerminal}`;
                const sRoute = f.route || `${lookupAirportCode(f.depAirport) || 'TPE'} - ${lookupAirportCode(f.arrAirport) || 'BKK'}`;
                const fFlightNo = (f.flightNo && !/^(AK|FD|VJ)/i.test(f.flightNo)) ? f.flightNo : 'BR 001';
                const fPnr = f.pnr || pnr;

                return `
                <div style="border:1px solid #BCD8C2; border-radius:3px; overflow:hidden; margin-bottom:12px;">
                    <!-- Upper Green Card -->
                    <div style="background:#007A3D; color:#ffffff; padding:12px 14px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
                            <div style="font-size:16px; font-weight:800; letter-spacing:0.3px; display:inline-flex; align-items:center;">
                                <span>${fDepCity}</span>
                                <span style="display:inline-flex; align-items:center; margin:0 9px;">
                                    <svg width="20" height="13" viewBox="0 0 20 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <line x1="1" y1="6.5" x2="14" y2="6.5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
                                        <polygon points="13,2 19,6.5 13,11" fill="#FFFFFF"/>
                                    </svg>
                                </span>
                                <span>${fArrCity}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="font-size:11px; font-weight:500; opacity:0.95;">${fFlightNo} &nbsp;|&nbsp; EVA Air</div>
                                ${fPnr && fPnr !== pnr ? `<div style="background:#F26522; color:#FFFFFF; font-size:11.5px; font-weight:800; padding:2px 8px; border-radius:3px; letter-spacing:0.5px; white-space:nowrap; box-shadow:0 1px 3px rgba(0,0,0,0.25);">Booking Ref: ${fPnr}</div>` : ''}
                            </div>
                        </div>

                        <!-- Times & Airport -->
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                            <div>
                                <div style="font-size:20px; font-weight:800; letter-spacing:0.5px; line-height:1.1;">${f.depTime || '09:25'}</div>
                                <div style="font-size:10px; opacity:0.9; margin-top:3px;">${f.depDateFormatted || 'Sunday, 1 November 2026'}</div>
                                <div style="font-size:10px; opacity:0.9; margin-top:2px;">${f.depAirport || 'Taipei - Taoyuan (TPE)'}${f.depTerminal ? `, ${f.depTerminal}` : ''}</div>
                            </div>
                            <div>
                                <div style="font-size:20px; font-weight:800; letter-spacing:0.5px; line-height:1.1;">${f.arrTime || '13:05'}</div>
                                <div style="font-size:10px; opacity:0.9; margin-top:3px;">${f.arrDateFormatted || f.depDateFormatted || 'Sunday, 1 November 2026'}</div>
                                <div style="font-size:10px; opacity:0.9; margin-top:2px;">${fArrAirport || 'Bangkok - Suvarnabhumi (BKK)'}</div>
                            </div>
                        </div>
                    </div>

                    <!-- 2x4 Info Table with Light Orange Background & Orange Borders -->
                    <table style="width:100%; border-collapse:collapse; background:#FEF4EC; border-top:1px solid #F26522; font-size:11px;">
                        <tr>
                            <td style="padding:6px 10px; border-right:1px solid #F26522; border-bottom:1px solid #F26522; width:15%; font-weight:700; color:#333;">Duration</td>
                            <td style="padding:6px 10px; border-right:1px solid #F26522; border-bottom:1px solid #F26522; width:35%; color:#222;">${f.duration || '3h 40min, Non-Stop'}</td>
                            <td style="padding:6px 10px; border-right:1px solid #F26522; border-bottom:1px solid #F26522; width:15%; font-weight:700; color:#333;">Aircraft</td>
                            <td style="padding:6px 10px; border-bottom:1px solid #F26522; width:35%; color:#222;">${f.aircraft || 'Boeing 787-10'}</td>
                        </tr>
                        <tr>
                            <td style="padding:6px 10px; border-right:1px solid #F26522; font-weight:700; color:#333;">Class</td>
                            <td style="padding:6px 10px; border-right:1px solid #F26522; color:#222;">${f.flightClass || 'Economy (Y)'}</td>
                            <td style="padding:6px 10px; border-right:1px solid #F26522; font-weight:700; color:#333;">Route</td>
                            <td style="padding:6px 10px; color:#222;">${sRoute}</td>
                        </tr>
                    </table>
                </div>
                `;
            }).join('')}
        </div>

        <!-- 4. PASSENGER DETAILS -->
        <div style="font-size:14px; font-weight:800; color:#007A3D; margin-bottom:6px;">Passenger Details</div>
        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:14px; border:1px solid #BCD8C2;">
            <thead>
                <tr style="background:#007A3D; color:#ffffff;">
                    <th style="padding:6px 8px; text-align:left; border:1px solid #BCD8C2; width:28%; font-weight:700;">Name</th>
                    <th style="padding:6px 8px; text-align:left; border:1px solid #BCD8C2; width:36%; font-weight:700;">E-Ticket No.</th>
                    <th style="padding:6px 8px; text-align:left; border:1px solid #BCD8C2; width:20%; font-weight:700;">Type</th>
                    <th style="padding:6px 8px; text-align:left; border:1px solid #BCD8C2; width:16%; font-weight:700;">Seat</th>
                </tr>
            </thead>
            <tbody>
                ${paxList.map(p => `
                    <tr style="background:#EEF7F0;">
                        <td style="padding:6px 8px; border:1px solid #BCD8C2; font-weight:700; color:#111;">${p.name || 'SAMPLE PASSENGER'}</td>
                        <td style="padding:6px 8px; border:1px solid #BCD8C2; color:#333;">${p.eticket || p.eTicketNo || data.eTicketNo || 'To be advised at check-in'}</td>
                        <td style="padding:6px 8px; border:1px solid #BCD8C2; color:#333;">${p.type || 'Adult'}</td>
                        <td style="padding:6px 8px; border:1px solid #BCD8C2; color:#333;">${p.seat || '—'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- 5. BAGGAGE ALLOWANCE -->
        <div style="font-size:14px; font-weight:800; color:#007A3D; margin-bottom:6px;">Baggage Allowance</div>
        <table style="width:100%; border-collapse:collapse; background:#FEF4EC; border:1px solid #F26522; font-size:11px; margin-bottom:14px;">
            ${paxList.map(p => {
                const bagInfo = p.baggage || data.checkedBaggage || 'Checked: 30 kg   |   Carry-on: 7 kg';
                return `
                <tr>
                    <td style="padding:6px 10px; border:1px solid #F26522; width:28%; font-weight:700; color:#111;">${p.name || 'SAMPLE PASSENGER'}</td>
                    <td style="padding:6px 10px; border:1px solid #F26522; width:72%; color:#222;">${bagInfo}</td>
                </tr>
                `;
            }).join('')}
        </table>

        <!-- 6. NOTES -->
        <div style="font-size:14px; font-weight:800; color:#007A3D; margin-bottom:6px;">Notes</div>
        <ul style="margin:0 0 14px 0; padding-left:18px; font-size:10px; color:#444; line-height:1.45;">
            ${isSample ? `<li style="margin-bottom:3px; font-weight:600; color:#444;">This is a SAMPLE template for layout demonstration only — not a valid ticket or booking confirmation.</li>` : ''}
            <li style="margin-bottom:3px;">Passengers must present the valid ID used to purchase the ticket at check-in; boarding pass or itinerary may also be required.</li>
            <li style="margin-bottom:3px;">Tickets must be used in the sequence set out in the itinerary, otherwise the airline reserves the right to refuse carriage.</li>
            <li style="margin-bottom:3px;">Please arrive at the airport at least 3 hours before departure to allow enough time for check-in.</li>
        </ul>

        <!-- 7. FOOTER -->
        <div style="height:1.7px; background:#F26522; margin-bottom:10px;"></div>
        <div style="text-align:center; font-size:10px; color:#777; line-height:1.4;">
            ${isSample
                ? `evaair.com &nbsp;&nbsp;|&nbsp;&nbsp; SAMPLE TEMPLATE — not a valid ticket`
                : `evaair.com &nbsp;&nbsp;|&nbsp;&nbsp; Booking Ref ${pnr} &nbsp;&nbsp;|&nbsp;&nbsp; ${firstFlight.flightNo || 'BR 001'} ${depCity} - ${arrCity}, ${depDateShort}`}
        </div>

    </div>
    `;
}

/**
 * Generate preview HTML markup for Singapore Airlines matching official template
 */
export function renderSingaporeAirlinesTicketHtml(data) {
    const logoSrc = cachedSIADataUrl || 'singapore-airlines-logo.png';
    const allPnrs = resolveAllPnrs(data);
    const pnr = allPnrs.length > 0 ? allPnrs.join(' / ') : ((data.pnr || data.bookingNo || 'SMPL01').trim().toUpperCase());
    const issuedDate = data.issuedDate || formatTicketDate(new Date());

    const paxList = (data.passengers && data.passengers.length > 0)
        ? data.passengers
        : [{ name: data.passengerName || 'SAMPLE PASSENGER', type: data.passengerType || 'Adult', eticket: data.eTicketNo || '', passport: '', expiry: '' }];

    const flights = (data.flights && data.flights.length > 0)
        ? data.flights
        : [{
            flightNo: data.flightNo || 'SQ 001', airlineName: data.airlineName || 'Singapore Airlines',
            depTime: data.depTime || '09:00', depDateFormatted: data.depDateFormatted || 'Saturday, 1 November 2026', depAirport: data.depAirport || 'Singapore - Changi (SIN)', depTerminal: data.depTerminal || 'Terminal 3',
            arrTime: data.arrTime || '15:30', arrDateFormatted: data.arrDateFormatted || 'Saturday, 1 November 2026', arrAirport: data.arrAirport || 'London - Heathrow (LHR)', arrTerminal: data.arrTerminal || 'Terminal 2',
            route: data.route || 'SIN - LHR', duration: data.duration || '13h 30min, Non-Stop', aircraft: data.aircraft || 'Airbus A380-800', flightClass: data.flightClass || 'Economy (S)'
        }];
    const firstFlight = flights[0];
    const depCity = extractCityName(firstFlight.depAirport) || 'Singapore';
    const arrCity = extractCityName(firstFlight.arrAirport) || 'London';
    const paxSummary = paxList.length === 1 ? `1 ${paxList[0].type || 'Adult'}` : `${paxList.length} Adults`;

    const sectorCheckins = getSectorCheckinList(data).slice(0, 2);
    const depDateShort = firstFlight.depDateFormatted ? firstFlight.depDateFormatted.replace(/^[A-Za-z]+day,\s*/, '').toUpperCase() : '1 NOV 2026';

    return `
    <div style="font-family:Helvetica,Arial,sans-serif; max-width:700px; margin:0 auto; padding:24px 28px; background:#ffffff; color:#333; line-height:1.4;">

        <!-- 1. HEADER -->
        <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:4px;">
            <img src="${logoSrc}" alt="Singapore Airlines" style="height:46px; object-fit:contain; background:transparent;">
            <div style="text-align:right;">
                <div style="font-size:20px; font-weight:800; color:#1B3A6B; letter-spacing:0.5px;">BOOKING CONFIRMATION</div>
                <div style="font-size:10px; color:#555;">Singapore Airlines (SQ)</div>
                <div style="font-size:14px; font-weight:700; color:#1B3A6B; margin-top:2px;">Booking Ref: ${pnr}</div>
            </div>
        </div>
        <div style="height:3px; background:#E8A90C; margin-bottom:12px;"></div>

        <!-- 2. BOOKING STRIP -->
        <table style="width:100%; border-collapse:collapse; background:#F2F5FA; border:1px solid #B9C6DD; font-size:11px; margin-bottom:14px;">
            <tr>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; width:14%; font-weight:700; color:#333;">Booking Ref</td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; width:27%; font-weight:700; font-size:12px; color:#111;">${pnr}</td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; width:13%; font-weight:700; color:#333;">Issued Date</td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; width:17%; color:#333;">${issuedDate}</td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; width:14%; font-weight:700; color:#333;">Passengers</td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; width:15%; color:#333;">${paxSummary}</td>
            </tr>
            <tr>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; font-weight:700; color:#1B3A6B; vertical-align:middle; white-space:nowrap;">
                    ${sectorCheckins.map((sc, i) => `
                        <div style="${i > 0 ? 'margin-top:6px;' : ''}; font-size:10.5px; white-space:nowrap;">${sc.label}</div>
                    `).join('')}
                </td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; vertical-align:middle; white-space:nowrap;">
                    ${sectorCheckins.map((sc, i) => `
                        <div style="${i > 0 ? 'margin-top:5px;' : ''}; white-space:nowrap;">
                            <span style="display:inline-block; background:#E0EDFD; color:#1B3A6B; border:1.5px solid #6E9DD8; font-weight:800; font-size:10.5px; padding:3px 8px; border-radius:4px; white-space:nowrap; box-shadow:0 1px 3px rgba(27,58,107,0.12);">${sc.time}</span>
                        </div>
                    `).join('')}
                </td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; font-weight:700; color:#333; vertical-align:middle;">Status</td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; font-weight:700; color:#111; vertical-align:middle;">Confirmed</td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; font-weight:700; color:#333; vertical-align:middle;">Alliance</td>
                <td style="padding:6px 8px; border:1px solid #B9C6DD; color:#333; line-height:1.2; vertical-align:middle;">Star<br>Alliance</td>
            </tr>
        </table>

        <!-- 3. FLIGHT DETAILS -->
        <div style="font-size:14px; font-weight:800; color:#1B3A6B; margin-bottom:6px;">Flight Details</div>
        <div style="margin-bottom:14px;">
            ${flights.map(f => {
                const fDepCity = extractCityName(f.depAirport) || 'Singapore';
                const fArrCity = extractCityName(f.arrAirport) || 'London';
                let fArrAirport = f.arrAirport || '';
                if (f.arrTerminal) fArrAirport += `, ${f.arrTerminal}`;
                const sRoute = f.route || `${lookupAirportCode(f.depAirport) || 'SIN'} - ${lookupAirportCode(f.arrAirport) || 'LHR'}`;

                const fFlightNo = (f.flightNo && !/^(AK|FD|VJ)/i.test(f.flightNo)) ? f.flightNo : 'SQ 001';
                const fPnr = f.pnr || pnr;

                return `
                <!-- Flight Card -->
                <div style="border:1px solid #B9C6DD; border-radius:3px; overflow:hidden; margin-bottom:12px;">
                    <!-- Upper Blue Card -->
                    <div style="background:#1B3A6B; color:#ffffff; padding:12px 14px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
                            <div style="font-size:16px; font-weight:800; letter-spacing:0.3px; display:inline-flex; align-items:center;">
                                <span>${fDepCity}</span>
                                <span style="display:inline-flex; align-items:center; margin:0 9px;">
                                    <svg width="20" height="13" viewBox="0 0 20 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <line x1="1" y1="6.5" x2="14" y2="6.5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
                                        <polygon points="13,2 19,6.5 13,11" fill="#FFFFFF"/>
                                    </svg>
                                </span>
                                <span>${fArrCity}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="font-size:11px; font-weight:500; opacity:0.95;">${fFlightNo} &nbsp;|&nbsp; Singapore Airlines</div>
                                ${fPnr && fPnr !== pnr ? `<div style="background:#E8A90C; color:#1B3A6B; font-size:11.5px; font-weight:800; padding:2px 8px; border-radius:3px; letter-spacing:0.5px; white-space:nowrap; box-shadow:0 1px 3px rgba(0,0,0,0.25);">Booking Ref: ${fPnr}</div>` : ''}
                            </div>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <div style="flex:1;">
                                <div style="font-size:22px; font-weight:800; color:#ffffff; line-height:1;">${f.depTime || '09:00'}</div>
                                <div style="font-size:10px; color:#E1EBFA; margin-top:6px;">${f.depDateFormatted || 'Saturday, 1 November 2026'}</div>
                                <div style="font-size:10px; color:#E1EBFA; margin-top:4px;">${f.depAirport || 'Singapore - Changi (SIN)'}${f.depTerminal ? ', ' + f.depTerminal : ''}</div>
                            </div>
                            <div style="flex:1; padding-left:16px;">
                                <div style="font-size:22px; font-weight:800; color:#ffffff; line-height:1;">${f.arrTime || '15:30'}</div>
                                <div style="font-size:10px; color:#E1EBFA; margin-top:6px;">${f.arrDateFormatted || 'Saturday, 1 November 2026'}</div>
                                <div style="font-size:10px; color:#E1EBFA; margin-top:4px;">${fArrAirport || 'London - Heathrow (LHR), Terminal 2'}</div>
                            </div>
                        </div>
                    </div>
                    <!-- Lower Light-Gold Info Table (2x4 Grid) -->
                    <table style="width:100%; border-collapse:collapse; background:#FDF8EC; border-top:1px solid #E8A90C; font-size:11px;">
                        <tr>
                            <td style="padding:6px 10px; border:1px solid #E8A90C; width:16%; font-weight:700; color:#333;">Duration</td>
                            <td style="padding:6px 10px; border:1px solid #E8A90C; width:34%; color:#333;">${f.duration || '13h 30min, Non-Stop'}</td>
                            <td style="padding:6px 10px; border:1px solid #E8A90C; width:16%; font-weight:700; color:#333;">Aircraft</td>
                            <td style="padding:6px 10px; border:1px solid #E8A90C; width:34%; color:#333;">${f.aircraft || 'Airbus A380-800'}</td>
                        </tr>
                        <tr>
                            <td style="padding:6px 10px; border:1px solid #E8A90C; width:16%; font-weight:700; color:#333;">Class</td>
                            <td style="padding:6px 10px; border:1px solid #E8A90C; width:34%; color:#333;">${f.flightClass || data.flightClass || 'Economy (S)'}</td>
                            <td style="padding:6px 10px; border:1px solid #E8A90C; width:16%; font-weight:700; color:#333;">Route</td>
                            <td style="padding:6px 10px; border:1px solid #E8A90C; width:34%; color:#333;">${sRoute}</td>
                        </tr>
                    </table>
                </div>
                `;
            }).join('')}
        </div>

        <!-- 4. PASSENGER DETAILS -->
        <div style="font-size:14px; font-weight:800; color:#1B3A6B; margin-bottom:6px;">Passenger Details</div>
        <table style="width:100%; border-collapse:collapse; border:1px solid #B9C6DD; font-size:11px; margin-bottom:14px;">
            <thead>
                <tr style="background:#1B3A6B; color:#fff;">
                    <th style="padding:7px 8px; text-align:left; border:1px solid #B9C6DD; width:32%; font-weight:700;">Name</th>
                    <th style="padding:7px 8px; text-align:left; border:1px solid #B9C6DD; width:32%; font-weight:700;">E-Ticket No.</th>
                    <th style="padding:7px 8px; text-align:left; border:1px solid #B9C6DD; width:20%; font-weight:700;">Type</th>
                    <th style="padding:7px 8px; text-align:left; border:1px solid #B9C6DD; width:16%; font-weight:700;">Seat</th>
                </tr>
            </thead>
            <tbody>
                ${paxList.map((p, idx) => `
                    <tr style="background:${idx % 2 === 0 ? '#F2F5FA' : '#fff'};">
                        <td style="padding:7px 8px; border:1px solid #B9C6DD; font-weight:700; color:#111;">${p.name || 'SAMPLE PASSENGER'}</td>
                        <td style="padding:7px 8px; border:1px solid #B9C6DD; color:#111;">${p.eticket || p.eTicketNo || data.eTicketNo || 'To be advised at check-in'}</td>
                        <td style="padding:7px 8px; border:1px solid #B9C6DD; color:#111;">${p.type || 'Adult'}</td>
                        <td style="padding:7px 8px; border:1px solid #B9C6DD; color:#111;">${p.seat || '—'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- 5. BAGGAGE ALLOWANCE -->
        <div style="font-size:14px; font-weight:800; color:#1B3A6B; margin-bottom:6px;">Baggage Allowance</div>
        <table style="width:100%; border-collapse:collapse; background:#FDF8EC; border:1px solid #E8A90C; font-size:11px; margin-bottom:14px;">
            ${paxList.map(p => `
                <tr>
                    <td style="padding:7px 8px; border:1px solid #E8A90C; width:30%; font-weight:700; color:#111;">${p.name || 'SAMPLE PASSENGER'}</td>
                    <td style="padding:7px 8px; border:1px solid #E8A90C; width:70%; color:#111;">${p.baggage || data.checkedBaggage || 'Checked: 30 kg   |   Carry-on: 7 kg'}</td>
                </tr>
            `).join('')}
        </table>

        <!-- 6. NOTES -->
        <div style="font-size:14px; font-weight:800; color:#1B3A6B; margin-bottom:6px;">Notes</div>
        <ul style="margin:0 0 14px 0; padding-left:16px; font-size:9px; color:#333; line-height:1.55;">
            <li style="margin-bottom:3px;">Passengers must present the valid ID used to purchase the ticket at check-in; boarding pass or itinerary may also be required.</li>
            <li style="margin-bottom:3px;">Tickets must be used in the sequence set out in the itinerary, otherwise the airline reserves the right to refuse carriage.</li>
            <li style="margin-bottom:3px;">Please arrive at the airport at least 3 hours before departure to allow enough time for check-in.</li>
        </ul>

        <!-- 7. FOOTER -->
        <div style="height:2px; background:#E8A90C; margin-bottom:10px;"></div>
        <div style="text-align:center; font-size:9px; color:#888; line-height:1.4;">
            singaporeair.com &nbsp;&nbsp;|&nbsp;&nbsp; Booking Ref ${pnr} &nbsp;&nbsp;|&nbsp;&nbsp; ${firstFlight.flightNo || 'SQ 001'} ${depCity} - ${arrCity}, ${depDateShort}
        </div>

    </div>
    `;
}

/**
 * Generate preview HTML markup that renders identically to the PDF
 */
export function renderAirAsiaTicketHtml(data) {
    if (data.airline === 'EVA Air' || /eva\s*air|\bBR\s*\d/i.test(data.airlineName || '') || /BR\s*\d/i.test(data.flightNo || '')) {
        return renderEvaAirTicketHtml(data);
    }
    if (data.airline === 'Singapore Airlines' || /singapore\s*air(?:lines)?|\bSQ\s*\d/i.test(data.airlineName || '') || /SQ\s*\d/i.test(data.flightNo || '')) {
        return renderSingaporeAirlinesTicketHtml(data);
    }
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

    const sectorCheckins = getSectorCheckinList(data).slice(0, 2);
    const allPnrs = resolveAllPnrs(data);
    const displayPnr = allPnrs.length > 0 ? allPnrs.join(' / ') : (data.pnr || '');

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
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:24%; vertical-align:middle; white-space:nowrap;">
                        ${sectorCheckins.map((sc, i) => `
                            <div style="${i > 0 ? 'margin-top:6px;' : ''}; font-weight:700; font-size:11.5px; color:#333; white-space:nowrap;">${sc.label}</div>
                        `).join('')}
                    </td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:28%; vertical-align:middle; white-space:nowrap;">
                        ${sectorCheckins.map((sc, i) => `
                            <div style="${i > 0 ? 'margin-top:5px;' : ''}; white-space:nowrap;">
                                <span style="display:inline-block; background:${isVietJet ? '#FFF0F0' : '#FFE5E8'}; color:${isVietJet ? '#D32F2F' : '#C62828'}; border:1.5px solid ${isVietJet ? '#F88A8A' : '#FF7080'}; font-weight:800; font-size:11px; padding:3px 8px; border-radius:4px; white-space:nowrap; box-shadow:0 1px 3px rgba(227,30,36,0.12);">${sc.time}</span>
                            </div>
                        `).join('')}
                    </td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:27%; vertical-align:middle;"><strong>Airline Booking Reference</strong></td>
                    <td style="padding:7px 10px; border:1px solid #CCCCCC; width:21%; font-weight:700; vertical-align:middle;">${displayPnr}</td>
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

    const isEva = (data.airline === 'EVA Air') || /eva\s*air|\bBR\s*\d/i.test(data.airlineName || '') || /BR\s*\d/i.test(data.flightNo || '');
    const isSIA = (data.airline === 'Singapore Airlines') || /singapore\s*air(?:lines)?|\bSQ\s*\d/i.test(data.airlineName || '') || /SQ\s*\d/i.test(data.flightNo || '');
    const isThai = (data.airline === 'Thai Airways') || /thai\s*airways/i.test(data.airlineName || '') || /TG\s*\d/i.test(data.flightNo || '');
    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isEva ? 'EVAAir' : (isSIA ? 'SingaporeAirlines' : (isThai ? 'ThaiAirways' : (isVietJet ? 'VietJet' : 'AirAsia')));
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

    const isEva = (data.airline === 'EVA Air') || /eva\s*air|\bBR\s*\d/i.test(data.airlineName || '') || /BR\s*\d/i.test(data.flightNo || '');
    const isSIA = (data.airline === 'Singapore Airlines') || /singapore\s*air(?:lines)?|\bSQ\s*\d/i.test(data.airlineName || '') || /SQ\s*\d/i.test(data.flightNo || '');
    const isThai = (data.airline === 'Thai Airways') || /thai\s*airways/i.test(data.airlineName || '') || /TG\s*\d/i.test(data.flightNo || '');
    const isVietJet = (data.airline === 'VietJet Air') || /vietjet/i.test(data.airlineName || '') || /VJ\d/i.test(data.flightNo || '');
    const prefix = isEva ? 'EVAAir' : (isSIA ? 'SingaporeAirlines' : (isThai ? 'ThaiAirways' : (isVietJet ? 'VietJet' : 'AirAsia')));
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
