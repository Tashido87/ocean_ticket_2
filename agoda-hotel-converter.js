/**
 * Agoda Hotel Booking Confirmation Generator
 * Generates official Agoda Booking Confirmations (Guangzhou, Singapore, etc.).
 * Exactly matches official colors, layout, and spacing.
 */

import { showToast } from './utils.js';

export const DESTINATION_PRESETS = {
    Bangkok: {
        destination: 'Bangkok',
        propertyName: 'Grande Centre Point Ratchadamri',
        propertyAddress: '153/2 Mahatlek Luang 1, Ratchadamri Rd,\nLumpini, Pathumwan,\nBangkok (and vicinity), Thailand',
        propertyContact: '+66 209 19000',
        stampFile: 'agoda-stamp.png',
        bookedPayableTitle: 'Booked And Payable By :',
        bookedPayableAddress: 'Agoda Company Pte, Ltd.\n30 Cecil Street, Prudential Tower #19-08,\nSingapore 049712',
        benefits: 'Express check-in, Free WiFi'
    },
    Guangzhou: {
        destination: 'Guangzhou',
        propertyName: 'Grand Park Guangzhou Hotel',
        propertyAddress: '20 Hong Hua Qiao, Wuhua, Guangzhou,\nChina',
        propertyContact: '+86 871 6538 6688',
        stampFile: 'agoda-stamp.png',
        bookedPayableTitle: 'Booked And Payable By :',
        bookedPayableAddress: 'Agoda Company Pte, Ltd.\n30 Cecil Street, Prudential Tower #19-08,\nSingapore 049712',
        benefits: 'Express check-in, Free WiFi'
    },
    'Kuala Lumpur': {
        destination: 'Kuala Lumpur',
        propertyName: 'THE FACE Style Hotel',
        propertyAddress: '1020 Jalan Sultan Ismail,\nKuala Lumpur (and vicinity), Malaysia',
        propertyContact: '+60 3216 81688',
        stampFile: 'agoda-stamp.png',
        bookedPayableTitle: 'Booked And Payable By :',
        bookedPayableAddress: 'Agoda Company Pte, Ltd.\n30 Cecil Street, Prudential Tower #19-08,\nSingapore 049712',
        benefits: 'Express check-in, Free WiFi'
    },
    Singapore: {
        destination: 'Singapore',
        propertyName: 'Village Hotel Bugis by Far East\nHospitality',
        propertyAddress: '390 Victoria Street, Bugis, Singapore,\nSingapore, 188061',
        propertyContact: '+65 6297 2828',
        stampFile: 'agoda-stamp-singapore.png',
        bookedPayableTitle: 'Booked And Payable Through :',
        bookedPayableAddress: 'Agoda Company Pte, Ltd.\n36 Robinson Road, City House #20-01,\nSingapore 068877',
        benefits: 'Coffee & tea, Free pool access, Free fitness center access, Free WiFi, Parking'
    }
};

let cachedAgodaLogoDataUrl = null;
let cachedAgodaStampDataUrl = null;
let cachedAgodaSingaporeStampDataUrl = null;

async function loadImgToDataUrl(src) {
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
    return canvas.toDataURL('image/png');
}

/**
 * Preload and cache Agoda logo as data URL for jsPDF and HTML preview
 */
export async function getAgodaLogoDataUrl() {
    if (cachedAgodaLogoDataUrl) return cachedAgodaLogoDataUrl;
    const logoSrc = 'agoda-logo.png';
    try {
        const dataUrl = await loadImgToDataUrl(logoSrc);
        cachedAgodaLogoDataUrl = dataUrl;
        return dataUrl;
    } catch (err) {
        console.warn('Failed to load agoda-logo.png as data URL', err);
        return logoSrc;
    }
}

/**
 * Preload and cache Agoda stamp & signature as data URL for specified destination
 */
export async function getAgodaStampDataUrl(destination = 'Guangzhou') {
    const isSingapore = String(destination || '').trim().toLowerCase() === 'singapore';
    if (isSingapore) {
        if (cachedAgodaSingaporeStampDataUrl) return cachedAgodaSingaporeStampDataUrl;
        const stampSrc = 'agoda-stamp-singapore.png';
        try {
            const dataUrl = await loadImgToDataUrl(stampSrc);
            cachedAgodaSingaporeStampDataUrl = dataUrl;
            return dataUrl;
        } catch (err) {
            console.warn('Failed to load agoda-stamp-singapore.png as data URL', err);
            return stampSrc;
        }
    } else {
        if (cachedAgodaStampDataUrl) return cachedAgodaStampDataUrl;
        const stampSrc = 'agoda-stamp.png';
        try {
            const dataUrl = await loadImgToDataUrl(stampSrc);
            cachedAgodaStampDataUrl = dataUrl;
            return dataUrl;
        } catch (err) {
            console.warn('Failed to load agoda-stamp.png as data URL', err);
            return stampSrc;
        }
    }
}

export async function preloadAgodaAssets() {
    await Promise.allSettled([
        getAgodaLogoDataUrl(),
        getAgodaStampDataUrl('Guangzhou'),
        getAgodaStampDataUrl('Singapore')
    ]);
}

/**
 * Generates a random 12-digit Agoda booking ID (e.g., 211010462452)
 */
export function generateRandomBookingId() {
    const prefix = '2110';
    const random8 = Math.floor(10000000 + Math.random() * 90000000).toString();
    return prefix + random8;
}

/**
 * Generates a random 10-digit Agoda member ID (e.g., 4531467124)
 */
export function generateRandomMemberId() {
    const prefix = '453';
    const random7 = Math.floor(1000000 + Math.random() * 9000000).toString();
    return prefix + random7;
}

/**
 * Formats a date into "Month D, YYYY" (e.g. "October 16, 2026")
 */
export function formatAgodaDate(dateInput) {
    if (!dateInput) return '';
    try {
        let d;
        if (typeof dateInput === 'string') {
            const trimmed = dateInput.trim();
            if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
                const parts = trimmed.split('/');
                d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
            } else {
                d = new Date(trimmed);
            }
        } else if (dateInput instanceof Date) {
            d = dateInput;
        }

        if (d && !isNaN(d.getTime())) {
            const months = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];
            return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
        }
        return String(dateInput);
    } catch (e) {
        return String(dateInput);
    }
}

/**
 * Calculates a default cancellation date (3 days / 72 hours before arrival date)
 */
export function calculateDefaultCancellationDate(arrivalDateStr) {
    try {
        let d;
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(arrivalDateStr)) {
            const parts = arrivalDateStr.split('/');
            d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        } else {
            d = new Date(arrivalDateStr);
        }
        if (d && !isNaN(d.getTime())) {
            // 3 days (72 hours) before arrival
            const cancelDate = new Date(d.getTime() - (3 * 24 * 60 * 60 * 1000));
            return formatAgodaDate(cancelDate);
        }
    } catch (e) {}
    return '';
}

/**
 * Generate preview HTML markup that renders identically to the original Agoda Booking Confirmation
 */
export function renderAgodaHotelHtml(data = {}) {
    const destination = (data.destination || 'Bangkok').trim();
    const isSingapore = destination.toLowerCase() === 'singapore';
    const preset = DESTINATION_PRESETS[destination] || (isSingapore ? DESTINATION_PRESETS.Singapore : DESTINATION_PRESETS.Bangkok);

    const logoSrc = cachedAgodaLogoDataUrl || 'agoda-logo.png';
    const stampSrc = isSingapore
        ? (cachedAgodaSingaporeStampDataUrl || 'agoda-stamp-singapore.png')
        : (cachedAgodaStampDataUrl || 'agoda-stamp.png');

    const clientName = (data.clientName || '').trim().toUpperCase();
    const bookingId = data.bookingId || generateRandomBookingId();
    const memberId = data.memberId || generateRandomMemberId();
    const bookingRefNo = data.bookingRefNo || '';
    const countryOfResidence = data.countryOfResidence || 'Myanmar';
    const propertyName = data.propertyName || preset.propertyName;
    const propertyAddress = data.propertyAddress || preset.propertyAddress;
    const propertyContact = data.propertyContact || preset.propertyContact;

    const numRooms = data.numRooms !== undefined && data.numRooms !== '' ? data.numRooms : 1;
    const numExtraBeds = data.numExtraBeds !== undefined && data.numExtraBeds !== '' ? data.numExtraBeds : 0;
    const numAdults = data.numAdults !== undefined && data.numAdults !== '' ? data.numAdults : 1;
    const numChildren = data.numChildren !== undefined && data.numChildren !== '' ? data.numChildren : 0;
    const roomType = data.roomType || 'Superior Deluxe';
    const promotion = data.promotion || 'Long Stay Deal. Price includes 10% discount!';

    const arrivalDate = data.arrivalDate ? formatAgodaDate(data.arrivalDate) : '';
    const departureDate = data.departureDate ? formatAgodaDate(data.departureDate) : '';
    const cancellationDate = data.cancellationDate || (arrivalDate ? calculateDefaultCancellationDate(arrivalDate) : '');

    const bookedPayableTitle = data.bookedPayableTitle || preset.bookedPayableTitle || (isSingapore ? 'Booked And Payable Through :' : 'Booked And Payable By :');
    const bookedPayableAddress = data.bookedPayableAddress || preset.bookedPayableAddress || (isSingapore ? 'Agoda Company Pte, Ltd.\n36 Robinson Road, City House #20-01,\nSingapore 068877' : 'Agoda Company Pte, Ltd.\n30 Cecil Street, Prudential Tower #19-08,\nSingapore 049712');
    const bookedPayableAddressHtml = bookedPayableAddress.split('\n').join('<br>');

    const benefits = data.benefits || preset.benefits || (isSingapore ? 'Coffee & tea, Free pool access, Free fitness center access, Free WiFi, Parking' : 'Express check-in, Free WiFi');
    const cleanBenefits = benefits.replace(/^Benefits Included\s*/i, '');

    const remarksSpecial = data.remarksSpecial || 'NonSmoke,LargeBed';

    return `
    <div class="agoda-booking-wrapper" id="agodaBookingDocument" style="background:#ffffff; color:#000000; font-family:'Liberation Sans', Arial, Helvetica, sans-serif; width:100%; max-width:708px; margin:0 auto; box-sizing:border-box; line-height:1.25; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Outer Border Container -->
        <div style="border:1.1px solid #000000; padding:10px 14px 14px 14px; background:#ffffff; box-sizing:border-box;">
            
            <!-- 1. Header Row -->
            <div style="display:flex; justify-content:space-between; align-items:flex-end; padding:2px 2px 6px 2px;">
                <div style="width:115px; height:52px; display:flex; align-items:center;">
                    <img src="${logoSrc}" alt="agoda" style="max-width:100%; max-height:100%; object-fit:contain;">
                </div>
                <div style="text-align:right;">
                    <div style="font-size:25px; font-weight:bold; line-height:1.1; letter-spacing:-0.4px;">
                        <span style="color:#000000;">Booking </span><span style="color:#fe0000;">Confirmation</span>
                    </div>
                    <div style="font-size:9.5px; color:#000000; margin-top:5px;">
                        Please present either an electronic or paper copy of your booking confirmation upon check-in.
                    </div>
                </div>
            </div>

            <!-- 2. Repeating Agoda Strip Banner -->
            <div style="background:#c5c5c3; height:15px; display:flex; justify-content:space-between; align-items:center; margin:4px 0 10px 0; padding:0 12px; box-sizing:border-box;">
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
                <span style="color:#ffffff; font-weight:bold; font-size:9.5px;">agoda</span>
            </div>

            <!-- 3. Main Details Grid (Two Columns) -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 8px; font-size: 9.5px;">
                
                <!-- Left Column (NO gray background on top items; white boxes only for Property, Address, Contact) -->
                <div style="display:flex; flex-direction:column; gap:5px;">
                    <!-- Booking ID -->
                    <div style="display:flex; align-items:center; height:18px;">
                        <span style="width:125px; color:#000000;">Booking ID :</span>
                        <span style="font-weight:bold; color:#000000; font-size:9.5px;">${bookingId}</span>
                    </div>

                    <!-- Booking Reference No -->
                    <div style="display:flex; align-items:center; height:18px;">
                        <span style="width:125px; color:#000000;">Booking Reference No :</span>
                        <span style="font-weight:bold; color:#000000; font-size:9.5px;">${bookingRefNo}</span>
                    </div>

                    <!-- Client -->
                    <div style="display:flex; align-items:center; height:18px;">
                        <span style="width:125px; color:#000000;">Client :</span>
                        <span style="font-weight:bold; color:#000000; font-size:10.5px;">${clientName || '&nbsp;'}</span>
                    </div>

                    <!-- Member ID -->
                    <div style="display:flex; align-items:center; height:18px;">
                        <span style="width:125px; color:#000000;">Member ID :</span>
                        <span style="font-weight:bold; color:#000000; font-size:9.5px;">${memberId}</span>
                    </div>

                    <!-- Country of Residence -->
                    <div style="display:flex; align-items:center; height:18px;">
                        <span style="width:125px; color:#000000;">Country of Residence :</span>
                        <span style="font-weight:bold; color:#000000; font-size:9.5px;">${countryOfResidence}</span>
                    </div>

                    <!-- Property (White box with thin border, left-aligned) -->
                    <div style="display:flex; align-items:flex-start; margin-top:3px;">
                        <span style="width:125px; color:#000000; padding-top:4px;">Property :</span>
                        <div style="flex:1; background:#ffffff; border:1px solid #c0c0c0; border-radius:2px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; font-weight:bold; font-size:9.2px; line-height:1.25; color:#000000; padding:4px 6px; text-align:left;">
                            ${propertyName.split('\n').join('<br>')}
                        </div>
                    </div>

                    <!-- Address (White box with thin border, multiline, left-aligned) -->
                    <div style="display:flex; align-items:flex-start; margin-top:3px;">
                        <span style="width:125px; color:#000000; padding-top:4px;">Address :</span>
                        <div style="flex:1; background:#ffffff; border:1px solid #c0c0c0; border-radius:2px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; font-weight:bold; font-size:8.5px; line-height:1.25; color:#000000; padding:4px 6px; text-align:left; word-break:break-word;">
                            ${propertyAddress.split('\n').join('<br>')}
                        </div>
                    </div>

                    ${propertyContact && propertyContact.trim() ? `
                    <!-- Property Contact Number (White box with thin border) -->
                    <div style="display:flex; align-items:center; height:19px; margin-top:3px;">
                        <span style="width:125px; color:#000000;">Property Contact Number :</span>
                        <div style="flex:1; background:#ffffff; border:1px solid #c0c0c0; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:flex-start; padding:0 6px; font-weight:bold; color:#000000;">
                            ${propertyContact}
                        </div>
                    </div>
                    ` : ''}
                </div>

                <!-- Right Column (Inside a light-gray container with gray-filled WHITE-BORDER boxes inside) -->
                <div style="background:#ebebeb; border:1px solid #dcdcdc; border-radius:4px; padding:6px 10px; display:flex; flex-direction:column; gap:4.5px;">
                    <!-- Number of Rooms -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Number of Rooms:</span>
                        <div style="width:165px; background:#dcdcdc; border:1.5px solid #ffffff; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numRooms}
                        </div>
                    </div>

                    <!-- Number of Extra Beds -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Number of Extra Beds :</span>
                        <div style="width:165px; background:#dcdcdc; border:1.5px solid #ffffff; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numExtraBeds}
                        </div>
                    </div>

                    <!-- Number of Adults -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Number of Adults :</span>
                        <div style="width:165px; background:#dcdcdc; border:1.5px solid #ffffff; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numAdults}
                        </div>
                    </div>

                    <!-- Number of Children -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Number of Children :</span>
                        <div style="width:165px; background:#dcdcdc; border:1.5px solid #ffffff; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numChildren}
                        </div>
                    </div>

                    <!-- Room Type -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Room Type :</span>
                        <div style="width:165px; background:#dcdcdc; border:1.5px solid #ffffff; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${roomType}
                        </div>
                    </div>

                    <!-- Promotion -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Promotion :</span>
                        <div style="width:165px; background:#dcdcdc; border:1.5px solid #ffffff; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:7.4px; color:#000000; padding:0 3px; white-space:nowrap;">
                            ${promotion}
                        </div>
                    </div>

                    <!-- Promotion condition note -->
                    <div style="font-size:9px; color:#000000; margin-top:2px;">
                        For Full Promotion details and conditions see confirmation email
                    </div>
                </div>

            </div>

            <!-- 4. Cancellation Policy Banner -->
            <div style="background:#ebebeb; border:1px solid #d4d4d4; border-radius:3px; padding:5px 8px; margin:7px 0; font-size:9.5px; line-height:1.35; color:#000000;">
                <strong>Cancellation Policy:</strong> Risk-free booking! You can cancel until ${cancellationDate} and pay nothing! If you fail to arrive or cancel the booking, no refund will be given. If you fail to arrive or cancel the booking, no refund will be given.
            </div>

            <!-- 5. Benefits Included Banner -->
            <div style="background:#ebebeb; border:1px solid #d4d4d4; border-radius:3px; padding:4px 8px; margin-bottom:10px; font-size:9.5px; color:#000000;">
                Benefits Included ${cleanBenefits}
            </div>

            <!-- 6 & 7. Combined Dates, Booked and Payable, and Stamp Container -->
            <div style="border:1px solid #c0c0c0; border-radius:3px; padding:8px 10px; margin:14px 0 16px 0; box-sizing:border-box; background:#ffffff;">
                <div style="display:flex; justify-content:space-between; align-items:stretch; gap:12px;">
                    <!-- Left Section: Dates row + Booked and Payable box -->
                    <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between;">
                        <!-- Dates Row -->
                        <div style="display:flex; align-items:center; gap:14px; font-size:9.5px; margin-bottom:8px;">
                            <div style="display:flex; align-items:center;">
                                <span style="font-weight:bold; margin-right:6px; width:50px; color:#000000;">Arrival :</span>
                                <div style="width:125px; background:#dcdcdc; border-radius:2px; height:19px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                                    ${arrivalDate || '&nbsp;'}
                                </div>
                            </div>
                            <div style="display:flex; align-items:center;">
                                <span style="font-weight:bold; margin-right:6px; width:65px; color:#000000;">Departure :</span>
                                <div style="width:125px; background:#dcdcdc; border-radius:2px; height:19px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                                    ${departureDate || '&nbsp;'}
                                </div>
                            </div>
                        </div>

                        <!-- Booked and Payable -->
                        <div>
                            <div style="font-weight:bold; font-size:9.5px; margin-bottom:3px; color:#000000;">${bookedPayableTitle}</div>
                            <div style="background:#ebebeb; border-radius:2px; padding:6px 10px; font-size:9.2px; line-height:1.4; color:#000000;">
                                ${bookedPayableAddressHtml}
                            </div>
                        </div>
                    </div>

                    <!-- Right Section: Stamp & Signature Box (Stretches from top to bottom) -->
                    <div style="width:175px; min-height:86px; border:1px solid #c0c0c0; border-radius:2px; display:flex; align-items:center; justify-content:center; padding:3px; box-sizing:border-box; background:#ffffff; align-self:stretch;">
                        <img src="${stampSrc}" alt="Authorized Stamp & Signature" style="width:100%; height:100%; object-fit:contain; display:block;">
                    </div>
                </div>
            </div>

            <!-- 8. Remarks Section -->
            <div style="font-weight:bold; font-size:9.5px; line-height:1.45; color:#000000; margin-bottom:32px;">
                <div>Remarks :</div>
                <div>${remarksSpecial}</div>
                <div>All special requests are subject to availability upon arrival</div>
            </div>

            <!-- 9. Customer Support Row (Pushed down to the bottom right) -->
            <div style="text-align:right; font-size:9.5px; line-height:1.4; color:#000000; margin-bottom:14px;">
                <div style="font-weight:bold;">Call our Customer Service Center 24/7 :</div>
                <div>Customer Support : +60 3 2053 1869, +1 866 656 8207</div>
                <div style="font-weight:normal;">(Long distance charge may apply)</div>
            </div>

            <!-- 10. Notes Section (Placed cleanly at the bottom) -->
            <div style="border:1.1px solid #000000; border-radius:3px; padding:7px 10px; font-size:9.2px; line-height:1.35; color:#000000;">
                <div style="font-weight:bold; margin-bottom:4px; font-size:9.5px;">Notes</div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <div style="display:flex; align-items:flex-start;">
                        <span style="margin-right:5px; font-size:10px; line-height:1.2;">•</span>
                        <div><span style="color:#d90000; font-weight:bold;">IMPORTANT:</span> At check-in, you must present a valid photo ID with your address confirming the same name as the lead guest on the booking. For bookings paid with a credit card, you may also need to present the card used to make the payment. Failure to do so may result in the hotel requesting additional payment or your reservation not being honored.</div>
                    </div>
                    <div style="display:flex; align-items:flex-start;">
                        <span style="margin-right:5px; font-size:10px; line-height:1.2;">•</span>
                        <div>All rooms are guaranteed on the day of arrival. In the case of a no-show, your room(s) will be released and you will be subject to the terms and conditions of the Cancellation/No-Show Policy specified at the time you made the booking as well as noted in the Confirmation Email.</div>
                    </div>
                    <div style="display:flex; align-items:flex-start;">
                        <span style="margin-right:5px; font-size:10px; line-height:1.2;">•</span>
                        <div>The total price for this booking does not include mini-bar items, telephone usage, laundry service, etc. The property will bill you directly.</div>
                    </div>
                    <div style="display:flex; align-items:flex-start;">
                        <span style="margin-right:5px; font-size:10px; line-height:1.2;">•</span>
                        <div>In cases where Breakfast is included with the room rate, please note that certain properties may charge extra for children travelling with their parents. If applicable, the property will bill you directly. Upon arrival, if you have any questions, please verify with the property.</div>
                    </div>
                </div>
            </div>

        </div>
    </div>
    `;
}

/**
 * Generate native jsPDF vector document matching original coordinates
 */
export async function generateAgodaPdfDoc(data) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('jsPDF library is not loaded');
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const destination = String(data.destination || 'Bangkok').trim();
    const isSingapore = destination.toLowerCase() === 'singapore';
    const preset = DESTINATION_PRESETS[destination] || (isSingapore ? DESTINATION_PRESETS.Singapore : DESTINATION_PRESETS.Bangkok);

    const logoDataUrl = await getAgodaLogoDataUrl();
    const stampDataUrl = await getAgodaStampDataUrl(destination);

    const clientName = (data.clientName || '').trim().toUpperCase();
    const bookingId = String(data.bookingId || generateRandomBookingId());
    const memberId = String(data.memberId || generateRandomMemberId());
    const bookingRefNo = String(data.bookingRefNo || '');
    const countryOfResidence = String(data.countryOfResidence || 'Myanmar');
    const propertyName = String(data.propertyName || preset.propertyName);
    const propertyAddress = String(data.propertyAddress || preset.propertyAddress);
    const propertyContact = String(data.propertyContact || preset.propertyContact);

    const numRooms = String(data.numRooms !== undefined && data.numRooms !== '' ? data.numRooms : 1);
    const numExtraBeds = String(data.numExtraBeds !== undefined && data.numExtraBeds !== '' ? data.numExtraBeds : 0);
    const numAdults = String(data.numAdults !== undefined && data.numAdults !== '' ? data.numAdults : 1);
    const numChildren = String(data.numChildren !== undefined && data.numChildren !== '' ? data.numChildren : 0);
    const roomType = String(data.roomType || 'Superior Deluxe');
    const promotion = String(data.promotion || 'Long Stay Deal. Price includes 10% discount!');

    const arrivalDate = data.arrivalDate ? formatAgodaDate(data.arrivalDate) : '';
    const departureDate = data.departureDate ? formatAgodaDate(data.departureDate) : '';
    const cancellationDate = data.cancellationDate || (arrivalDate ? calculateDefaultCancellationDate(arrivalDate) : '');

    const remarksSpecial = String(data.remarksSpecial || 'NonSmoke,LargeBed');

    const bookedPayableTitle = data.bookedPayableTitle || preset.bookedPayableTitle || (isSingapore ? 'Booked And Payable Through :' : 'Booked And Payable By :');
    const bookedPayableAddress = data.bookedPayableAddress || preset.bookedPayableAddress || (isSingapore ? 'Agoda Company Pte, Ltd.\n36 Robinson Road, City House #20-01,\nSingapore 068877' : 'Agoda Company Pte, Ltd.\n30 Cecil Street, Prudential Tower #19-08,\nSingapore 049712');

    // Page: 595.28 x 841.89 pt
    const outerX = 35.2;
    const outerY = 38.6;
    const outerW = 531.0;
    const outerH = 550.0;

    // Outer boundary line
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.8);
    doc.rect(outerX, outerY, outerW, outerH, 'S');

    const innerX = 41.9;
    const innerW = 517.6;
    const rightEdge = innerX + innerW;

    // 1. Header
    if (logoDataUrl) {
        doc.addImage(logoDataUrl, 'PNG', innerX, outerY + 3.5, 68.0, 34.6);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20.2);
    
    const confirmWord = "Confirmation";
    const bookingWord = "Booking ";
    doc.setTextColor(254, 0, 0);
    doc.text(confirmWord, rightEdge, outerY + 24, { align: 'right' });
    const confirmWidth = doc.getTextWidth(confirmWord);
    
    doc.setTextColor(0, 0, 0);
    doc.text(bookingWord, rightEdge - confirmWidth, outerY + 24, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Please present either an electronic or paper copy of your booking confirmation upon check-in.", rightEdge, outerY + 35, { align: 'right' });

    // 2. Grey Repeating Banner Strip
    const stripY = 78.4;
    const stripH = 10.1;
    doc.setFillColor(197, 197, 195);
    doc.rect(innerX, stripY, innerW, stripH, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(255, 255, 255);
    const agodaWords = 11;
    const stepX = innerW / agodaWords;
    for (let i = 0; i < agodaWords; i++) {
        const textX = innerX + (i * stepX) + (stepX / 2);
        doc.text("agoda", textX, stripY + 7.5, { align: 'center' });
    }

    // 3. Middle Section:
    // Left column: NO gray background for top 5 rows; thin white boxes for Property, Address, Contact
    // Right column: BIG gray background box covering the entire right column!

    // Right Column Background Container:
    const rightColX = 292.9;
    const rightColW = 266.6;
    const rightColY = 96.8;
    const rightColH = 125.0;
    doc.setFillColor(235, 235, 235); // #ebebeb
    doc.rect(rightColX, rightColY, rightColW, rightColH, 'F');

    // Left Column items:
    const labelX = 44.7;
    const valueX = 143.3;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);

    // Row 1: Booking ID
    doc.text("Booking ID :", labelX, 105.5);
    doc.setFont('helvetica', 'bold');
    doc.text(bookingId, valueX, 105.5);

    // Row 2: Booking Reference No
    doc.setFont('helvetica', 'normal');
    doc.text("Booking Reference No :", labelX, 121.2);
    if (bookingRefNo) {
        doc.setFont('helvetica', 'bold');
        doc.text(bookingRefNo, valueX, 121.2);
    }

    // Row 3: Client
    doc.setFont('helvetica', 'normal');
    doc.text("Client :", labelX, 137.0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.0);
    doc.text(clientName, valueX, 137.0);

    // Row 4: Member ID
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Member ID :", labelX, 152.6);
    doc.setFont('helvetica', 'bold');
    doc.text(memberId, valueX, 152.6);

    // Row 5: Country of Residence
    doc.setFont('helvetica', 'normal');
    doc.text("Country of Residence :", labelX, 168.3);
    doc.setFont('helvetica', 'bold');
    doc.text(countryOfResidence, valueX, 168.3);

    // Row 6: Property (White box with thin border, left-aligned)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Property :", labelX, 184.0);
    const boxX = 136.6;
    const boxW = 148.5;
    const maxTextW = boxW - 8.0;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(212, 212, 212);
    doc.setLineWidth(0.5);

    const rawPLines = propertyName.split('\n').map(l => l.trim()).filter(Boolean);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    let pLines = [];
    rawPLines.forEach(l => pLines.push(...doc.splitTextToSize(l, maxTextW)));
    const pBoxH = pLines.length > 1 ? (pLines.length === 2 ? 22.0 : 28.0) : 15.0;
    doc.rect(boxX, 175.3, boxW, pBoxH, 'FD');
    if (pLines.length === 1) {
        doc.text(pLines[0].trim(), boxX + 4.0, 185.0);
    } else if (pLines.length === 2) {
        doc.text(pLines[0].trim(), boxX + 4.0, 183.0);
        doc.text(pLines[1].trim(), boxX + 4.0, 192.5);
    } else {
        doc.setFontSize(6.4);
        pLines.forEach((pl, idx) => {
            doc.text(pl.trim(), boxX + 4.0, 182.0 + (idx * 8.5));
        });
    }

    // Row 7: Address (White box with thin border, multiline, left-aligned)
    const addrBoxStartY = 175.3 + pBoxH + 3.0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Address :", labelX, addrBoxStartY + 10.0);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(212, 212, 212);
    doc.setLineWidth(0.5);

    const rawAddrLines = propertyAddress.split('\n').map(l => l.trim()).filter(Boolean);
    let addrFontSize = 6.8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(addrFontSize);
    let addrLines = [];
    rawAddrLines.forEach(l => addrLines.push(...doc.splitTextToSize(l, maxTextW)));

    if (addrLines.length >= 3) {
        addrFontSize = 6.2;
        doc.setFontSize(addrFontSize);
        addrLines = [];
        rawAddrLines.forEach(l => addrLines.push(...doc.splitTextToSize(l, maxTextW)));
    }
    if (addrLines.length >= 4) {
        addrFontSize = 5.6;
        doc.setFontSize(addrFontSize);
        addrLines = [];
        rawAddrLines.forEach(l => addrLines.push(...doc.splitTextToSize(l, maxTextW)));
    }

    let addrBoxH = 15.0;
    if (addrLines.length === 2) {
        addrBoxH = 22.0;
    } else if (addrLines.length === 3) {
        addrBoxH = 27.0;
    } else if (addrLines.length >= 4) {
        addrBoxH = 32.0;
    }

    doc.rect(boxX, addrBoxStartY, boxW, addrBoxH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(addrFontSize);

    if (addrLines.length === 1) {
        doc.text(addrLines[0].trim(), boxX + 4.0, addrBoxStartY + 10.5);
    } else if (addrLines.length === 2) {
        doc.text(addrLines[0].trim(), boxX + 4.0, addrBoxStartY + 9.5);
        doc.text(addrLines[1].trim(), boxX + 4.0, addrBoxStartY + 18.0);
    } else if (addrLines.length === 3) {
        doc.text(addrLines[0].trim(), boxX + 4.0, addrBoxStartY + 8.5);
        doc.text(addrLines[1].trim(), boxX + 4.0, addrBoxStartY + 16.5);
        doc.text(addrLines[2].trim(), boxX + 4.0, addrBoxStartY + 24.5);
    } else {
        addrLines.forEach((al, idx) => {
            doc.text(al.trim(), boxX + 4.0, addrBoxStartY + 7.5 + (idx * 7.5));
        });
    }

    // Row 8: Property Contact Number (Only if propertyContact is provided)
    if (propertyContact && propertyContact.trim() !== '') {
        const contactY = addrBoxStartY + addrBoxH + 3.0;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.3);
        doc.text("Property Contact Number :", labelX, contactY + 9.5);
        doc.setFillColor(255, 255, 255);
        doc.rect(boxX, contactY, boxW, 14.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.text(propertyContact, boxX + 4.5, contactY + 9.5);
    }

    // Right Column rows (Inside gray container, with gray-fill WHITE-BORDER boxes):
    const rLabelX = 298.8;
    const rBoxX = 380.8;
    const rBoxW = 170.3;

    function drawWhiteRightBox(y, h, text, isSmall = false) {
        doc.setFillColor(220, 220, 220); // gray fill
        doc.setDrawColor(255, 255, 255); // white border
        doc.setLineWidth(1.2); // crisp white outline
        doc.rect(rBoxX, y, rBoxW, h, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isSmall ? 6.7 : 7.3);
        doc.setTextColor(0, 0, 0);
        doc.text(String(text || ''), rBoxX + (rBoxW / 2), y + (h / 2) + 2.5, { align: 'center' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);

    doc.text("Number of Rooms:", rLabelX, 107.0);
    drawWhiteRightBox(99.6, 14.6, numRooms);

    doc.setFont('helvetica', 'normal');
    doc.text("Number of Extra Beds :", rLabelX, 124.5);
    drawWhiteRightBox(117.0, 14.6, numExtraBeds);

    doc.setFont('helvetica', 'normal');
    doc.text("Number of Adults :", rLabelX, 141.8);
    drawWhiteRightBox(134.4, 14.6, numAdults);

    doc.setFont('helvetica', 'normal');
    doc.text("Number of Children :", rLabelX, 159.2);
    drawWhiteRightBox(151.7, 14.6, numChildren);

    doc.setFont('helvetica', 'normal');
    doc.text("Room Type :", rLabelX, 176.5);
    drawWhiteRightBox(169.1, 14.6, roomType);

    doc.setFont('helvetica', 'normal');
    doc.text("Promotion :", rLabelX, 194.5);
    drawWhiteRightBox(186.5, 15.7, promotion, true);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.text("For Full Promotion details and conditions see confirmation email", rLabelX, 213.5);

    // 4. Cancellation Policy Banner (Gray)
    const cancelY = 247.5;
    const cancelH = 25.8;
    doc.setFillColor(235, 235, 235);
    doc.rect(innerX, cancelY, innerW, cancelH, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(0, 0, 0);
    const cancelMsg1 = `Cancellation Policy: Risk-free booking! You can cancel until ${cancellationDate} and pay nothing! If you fail to arrive or cancel the booking, no refund will be`;
    const cancelMsg2 = `given. If you fail to arrive or cancel the booking, no refund will be given.`;
    doc.text(cancelMsg1, innerX + 4.5, cancelY + 10.0);
    doc.text(cancelMsg2, innerX + 4.5, cancelY + 20.0);

    // 5. Benefits Included Banner (Gray)
    const benefitY = 276.1;
    const benefitH = 15.7;
    doc.setFillColor(235, 235, 235);
    doc.rect(innerX, benefitY, innerW, benefitH, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    const benefitsText = (data.benefits || preset.benefits || (isSingapore ? 'Coffee & tea, Free pool access, Free fitness center access, Free WiFi, Parking' : 'Express check-in, Free WiFi')).replace(/^Benefits Included\s*/i, '');
    doc.text(`Benefits Included ${benefitsText}`, innerX + 4.5, benefitY + 10.5);

    // 6 & 7. Combined Container (Arrival/Departure + Booked and Payable + Stamp)
    const combBoxY = 299.0;
    const combBoxH = 82.0;
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.6);
    doc.rect(innerX, combBoxY, innerW, combBoxH, 'FD');

    // Right: Stamp & Signature Box (Stretches from top to bottom of combined container!)
    const stampBoxW = 145.0;
    const stampBoxH = 70.0;
    const stampBoxX = rightEdge - stampBoxW - 6.0;
    const stampBoxY = combBoxY + 6.0;

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(205, 205, 205);
    doc.setLineWidth(0.6);
    doc.rect(stampBoxX, stampBoxY, stampBoxW, stampBoxH, 'FD');

    if (stampDataUrl) {
        const pad = 2.5;
        const maxW = stampBoxW - (pad * 2);
        const maxH = stampBoxH - (pad * 2);
        const naturalRatio = isSingapore ? (369.0 / 237.0) : (1024.0 / 568.0);
        let drawW = maxW;
        let drawH = drawW / naturalRatio;
        if (drawH > maxH) {
            drawH = maxH;
            drawW = drawH * naturalRatio;
        }
        const drawX = stampBoxX + ((stampBoxW - drawW) / 2);
        const drawY = stampBoxY + ((stampBoxH - drawH) / 2);
        doc.addImage(stampDataUrl, 'PNG', drawX, drawY, drawW, drawH);
    }

    // Left: Dates Row
    const datesY = combBoxY + 6.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);
    doc.text("Arrival :", innerX + 6.0, datesY + 9.5);

    // Arrival pill (Gray)
    const arrPillX = innerX + 42.0;
    const arrPillW = 105.0;
    const arrPillH = 13.5;
    const arrPillY = datesY;
    doc.setFillColor(220, 220, 220);
    doc.rect(arrPillX, arrPillY, arrPillW, arrPillH, 'F');
    doc.text(arrivalDate, arrPillX + (arrPillW / 2), arrPillY + 9.5, { align: 'center' });

    // Departure
    const depLabelX = arrPillX + arrPillW + 10.0;
    doc.text("Departure :", depLabelX, datesY + 9.5);

    // Departure pill (Gray)
    const depPillX = depLabelX + 48.0;
    const depPillW = 105.0;
    const depPillH = 13.5;
    const depPillY = datesY;
    doc.setFillColor(220, 220, 220);
    doc.rect(depPillX, depPillY, depPillW, depPillH, 'F');
    doc.text(departureDate, depPillX + (depPillW / 2), depPillY + 9.5, { align: 'center' });

    // Lower portion: Booked and Payable Title + Gray Address Box
    const lowerY = datesY + arrPillH + 6.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.text(bookedPayableTitle, innerX + 6.0, lowerY + 6.0);

    const payableBoxY = lowerY + 9.0;
    const payableBoxW = (stampBoxX - innerX) - 12.0;
    const payableBoxH = (stampBoxY + stampBoxH) - payableBoxY;
    doc.setFillColor(235, 235, 235);
    doc.rect(innerX + 6.0, payableBoxY, payableBoxW, payableBoxH, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(0, 0, 0);
    const payableLines = bookedPayableAddress.split('\n');
    if (payableLines.length >= 3) {
        doc.text(payableLines[0].trim(), innerX + 11.0, payableBoxY + 11.0);
        doc.text(payableLines[1].trim(), innerX + 11.0, payableBoxY + 21.0);
        doc.text(payableLines[2].trim(), innerX + 11.0, payableBoxY + 31.0);
    } else {
        payableLines.forEach((l, idx) => {
            doc.text(l.trim(), innerX + 11.0, payableBoxY + 11.0 + (idx * 10.0));
        });
    }

    // 8. Remarks (On Left, below combined container)
    const remarksY = 394.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);
    doc.text("Remarks :", innerX, remarksY);
    doc.text(remarksSpecial, innerX, remarksY + 10.0);
    doc.text("All special requests are subject to availability upon arrival", innerX, remarksY + 20.0);

    // 9. Call our Customer Service Center 24/7 (Pushed down on the right side)
    const callY = 444.0;
    doc.setFont('helvetica', 'bold');
    doc.text("Call our Customer Service Center 24/7 :", rightEdge, callY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text("Customer Support : +60 3 2053 1869, +1 866 656 8207", rightEdge, callY + 10.0, { align: 'right' });
    doc.text("(Long distance charge may apply)", rightEdge, callY + 20.0, { align: 'right' });

    // 10. Notes Box (At bottom, black border)
    const notesY = 480.0;
    const notesH = 92.0;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    doc.rect(innerX, notesY, innerW, notesH, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);
    doc.text("Notes", innerX + 6.0, notesY + 9.5);

    const noteStep = 8.6;
    const bulletIndent = 11.5;
    doc.setFontSize(6.7);

    // Bullet 1
    let curNoteY = notesY + 19.0;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text("•", innerX + 6.0, curNoteY);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(217, 0, 0);
    doc.text("IMPORTANT:", innerX + bulletIndent, curNoteY);
    const impWidth = doc.getTextWidth("IMPORTANT: ");

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text("At check-in, you must present a valid photo ID with your address confirming the same name as the lead guest on the booking. For", innerX + bulletIndent + impWidth, curNoteY);

    curNoteY += noteStep;
    doc.text("bookings paid with a credit card, you may also need to present the card used to make the payment. Failure to do so may result in the hotel", innerX + bulletIndent, curNoteY);

    curNoteY += noteStep;
    doc.text("requesting additional payment or your reservation not being honored.", innerX + bulletIndent, curNoteY);

    // Bullet 2
    curNoteY += noteStep + 1.6;
    doc.text("•", innerX + 6.0, curNoteY);
    doc.text("All rooms are guaranteed on the day of arrival. In the case of a no-show, your room(s) will be released and you will be subject to the terms and", innerX + bulletIndent, curNoteY);

    curNoteY += noteStep;
    doc.text("conditions of the Cancellation/No-Show Policy specified at the time you made the booking as well as noted in the Confirmation Email.", innerX + bulletIndent, curNoteY);

    // Bullet 3
    curNoteY += noteStep + 1.6;
    doc.text("•", innerX + 6.0, curNoteY);
    doc.text("The total price for this booking does not include mini-bar items, telephone usage, laundry service, etc. The property will bill you directly.", innerX + bulletIndent, curNoteY);

    // Bullet 4
    curNoteY += noteStep + 1.6;
    doc.text("•", innerX + 6.0, curNoteY);
    doc.text("In cases where Breakfast is included with the room rate, please note that certain properties may charge extra for children travelling with their", innerX + bulletIndent, curNoteY);

    curNoteY += noteStep;
    doc.text("parents. If applicable, the property will bill you directly. Upon arrival, if you have any questions, please verify with the property.", innerX + bulletIndent, curNoteY);

    return doc;
}

/**
 * Download the generated Agoda PDF
 */
export async function downloadAgodaPdf(data) {
    const clientName = (data.clientName || 'Guest').trim();
    const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
    const safeId = (data.bookingId || 'Agoda').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Agoda_Hotel_Booking_${safeName}_${safeId}.pdf`;

    const doc = await generateAgodaPdfDoc(data);
    doc.save(filename);
    return filename;
}

/**
 * Export booking as image (PNG)
 * Renders the official PDF directly to canvas via PDF.js to guarantee 100% identical dimensions, layout, and quality as the PDF.
 */
export async function downloadAgodaImage(data) {
    const clientName = (data.clientName || 'Guest').trim();
    const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
    const safeId = (data.bookingId || 'Agoda').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Agoda_Hotel_Booking_${safeName}_${safeId}.png`;

    // 1. Primary method: Render from PDF using PDF.js for 100% identical layout and dimensions
    if (window.pdfjsLib) {
        try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const doc = await generateAgodaPdfDoc(data);
            const pdfArrayBuffer = doc.output('arraybuffer');
            const loadingTask = window.pdfjsLib.getDocument({ data: pdfArrayBuffer });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);

            // Scale 2.5 on A4 (595.28 x 841.89 pt) produces 1488 x 2105 px high-resolution image
            const scale = 2.5;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            const ctx = canvas.getContext('2d');

            await page.render({ canvasContext: ctx, viewport }).promise;

            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return filename;
        } catch (pdfErr) {
            console.warn('PDF.js image export failed, falling back to html2canvas', pdfErr);
        }
    }

    // 2. Fallback method: html2canvas with full A4 width container (794px)
    if (window.html2canvas) {
        const previewEl = document.getElementById('agodaBookingDocument');
        if (previewEl) {
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.left = '-9999px';
            container.style.top = '0';
            container.style.width = '794px';
            container.style.background = '#ffffff';
            container.appendChild(previewEl.cloneNode(true));
            document.body.appendChild(container);
            try {
                const targetNode = container.firstElementChild;
                targetNode.style.width = '794px';
                targetNode.style.maxWidth = '794px';
                const canvas = await window.html2canvas(targetNode, {
                    scale: 2.0,
                    useCORS: true,
                    backgroundColor: '#ffffff'
                });
                const link = document.createElement('a');
                link.download = filename;
                link.href = canvas.toDataURL('image/png');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                return filename;
            } finally {
                document.body.removeChild(container);
            }
        }
    }

    throw new Error('Image export failed: no supported rendering library available');
}

/**
 * Share booking via Web Share API
 */
export async function shareAgodaBooking(data) {
    const filename = await downloadAgodaPdf(data);
    showToast(`PDF downloaded: ${filename}`, 'success');

    const clientName = (data.clientName || 'Guest').trim();
    if (navigator.share && navigator.canShare) {
        try {
            const doc = await generateAgodaPdfDoc(data);
            const blob = doc.output('blob');
            const file = new File([blob], filename, { type: 'application/pdf' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Agoda Booking Confirmation - ${clientName}`,
                    text: `Agoda Hotel Booking Confirmation for ${clientName} (Booking ID: ${data.bookingId || ''})`,
                    files: [file]
                });
            } else {
                await navigator.share({
                    title: `Agoda Booking Confirmation - ${clientName}`,
                    text: `Agoda Hotel Booking Confirmation for ${clientName} (Booking ID: ${data.bookingId || ''})`
                });
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.warn('Share error:', e);
            }
        }
    }
}
