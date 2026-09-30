/**
 * Agoda China Visa Hotel Booking Confirmation Generator
 * Generates official Agoda Booking Confirmations for China Visa applications.
 * Exactly matches official colors, layout, and spacing.
 */

import { showToast } from './utils.js';

let cachedAgodaLogoDataUrl = null;
let cachedAgodaStampDataUrl = null;

/**
 * Preload and cache Agoda logo as data URL for jsPDF and HTML preview
 */
export async function getAgodaLogoDataUrl() {
    if (cachedAgodaLogoDataUrl) return cachedAgodaLogoDataUrl;
    const logoSrc = 'agoda-logo.png';
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
        cachedAgodaLogoDataUrl = dataUrl;
        return dataUrl;
    } catch (err) {
        console.warn('Failed to load agoda-logo.png as data URL', err);
        return logoSrc;
    }
}

/**
 * Preload and cache Agoda stamp & signature as data URL
 */
export async function getAgodaStampDataUrl() {
    if (cachedAgodaStampDataUrl) return cachedAgodaStampDataUrl;
    const stampSrc = 'agoda-stamp.png';
    try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = stampSrc;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        cachedAgodaStampDataUrl = dataUrl;
        return dataUrl;
    } catch (err) {
        console.warn('Failed to load agoda-stamp.png as data URL', err);
        return stampSrc;
    }
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
 * Calculates a default cancellation date (e.g., 20 days before arrival)
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
            const cancelDate = new Date(d.getTime() - (20 * 24 * 60 * 60 * 1000));
            return formatAgodaDate(cancelDate);
        }
    } catch (e) {}
    return 'August 30, 2026';
}

/**
 * Generate preview HTML markup that renders identically to the original Agoda Booking Confirmation
 */
export function renderAgodaHotelHtml(data) {
    const logoSrc = cachedAgodaLogoDataUrl || 'agoda-logo.png';
    const stampSrc = cachedAgodaStampDataUrl || 'agoda-stamp.png';

    const clientName = (data.clientName || 'AUNG KHIN NYUNT').trim().toUpperCase();
    const bookingId = data.bookingId || generateRandomBookingId();
    const memberId = data.memberId || generateRandomMemberId();
    const bookingRefNo = data.bookingRefNo || '';
    const countryOfResidence = data.countryOfResidence || 'Myanmar';
    const propertyName = data.propertyName || 'Grand Park Guangzhou Hotel';
    const propertyAddress = data.propertyAddress || '20 Hong Hua Qiao, Wuhua, Guangzhou,\nChina';
    const propertyContact = data.propertyContact || '+86 871 6538 6688';

    const numRooms = data.numRooms !== undefined && data.numRooms !== '' ? data.numRooms : 1;
    const numExtraBeds = data.numExtraBeds !== undefined && data.numExtraBeds !== '' ? data.numExtraBeds : 0;
    const numAdults = data.numAdults !== undefined && data.numAdults !== '' ? data.numAdults : 1;
    const numChildren = data.numChildren !== undefined && data.numChildren !== '' ? data.numChildren : 0;
    const roomType = data.roomType || 'Superior Deluxe';
    const promotion = data.promotion || 'Long Stay Deal. Price includes 10% discount!';

    const arrivalDate = formatAgodaDate(data.arrivalDate || 'October 16, 2026');
    const departureDate = formatAgodaDate(data.departureDate || 'October 26, 2026');
    const cancellationDate = data.cancellationDate || calculateDefaultCancellationDate(arrivalDate);

    const remarksSpecial = data.remarksSpecial || 'NonSmoke,LargeBed';

    return `
    <div class="agoda-booking-wrapper" id="agodaBookingDocument" style="background:#ffffff; color:#000000; font-family:'Liberation Sans', Arial, Helvetica, sans-serif; width:100%; max-width:708px; margin:0 auto; box-sizing:border-box; line-height:1.25; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Outer Border Container -->
        <div style="border:1.1px solid #000000; padding:10px 14px 14px 14px; background:#ffffff; box-sizing:border-box;">
            
            <!-- 1. Header Row -->
            <div style="display:flex; justify-content:space-between; align-items:flex-end; padding:2px 2px 6px 2px;">
                <div style="width:90px; height:46px; display:flex; align-items:center;">
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
                        <span style="font-weight:bold; color:#000000; font-size:10.5px;">${clientName}</span>
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

                    <!-- Property (White box with thin border) -->
                    <div style="display:flex; align-items:center; height:19px; margin-top:2px;">
                        <span style="width:125px; color:#000000;">Property :</span>
                        <div style="flex:1; background:#ffffff; border:1px solid #c0c0c0; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000; padding:0 4px; overflow:hidden;">
                            ${propertyName}
                        </div>
                    </div>

                    <!-- Address (White box with thin border, multiline) -->
                    <div style="display:flex; align-items:stretch; min-height:40px; margin-top:2px;">
                        <span style="width:125px; color:#000000; padding-top:4px;">Address :</span>
                        <div style="flex:1; background:#ffffff; border:1px solid #c0c0c0; border-radius:2px; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:bold; font-size:9px; line-height:1.25; color:#000000; padding:3px 4px; text-align:center;">
                            ${propertyAddress.split('\n').join('<br>')}
                        </div>
                    </div>

                    <!-- Property Contact Number (White box with thin border) -->
                    <div style="display:flex; align-items:center; height:19px; margin-top:2px;">
                        <span style="width:125px; color:#000000;">Property Contact Number :</span>
                        <div style="flex:1; background:#ffffff; border:1px solid #c0c0c0; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${propertyContact}
                        </div>
                    </div>
                </div>

                <!-- Right Column (Inside a unified light-gray container with WHITE boxes inside) -->
                <div style="background:#ebebeb; border:1px solid #dcdcdc; border-radius:4px; padding:6px 10px; display:flex; flex-direction:column; gap:4.5px;">
                    <!-- Number of Rooms -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Number of Rooms :</span>
                        <div style="width:160px; background:#ffffff; border:1px solid #d4d4d4; border-radius:2px; height:17px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numRooms}
                        </div>
                    </div>

                    <!-- Number of Extra Beds -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Number of Extra Beds :</span>
                        <div style="width:160px; background:#ffffff; border:1px solid #d4d4d4; border-radius:2px; height:17px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numExtraBeds}
                        </div>
                    </div>

                    <!-- Number of Adults -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Number of Adults :</span>
                        <div style="width:160px; background:#ffffff; border:1px solid #d4d4d4; border-radius:2px; height:17px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numAdults}
                        </div>
                    </div>

                    <!-- Number of Children -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Number of Children :</span>
                        <div style="width:160px; background:#ffffff; border:1px solid #d4d4d4; border-radius:2px; height:17px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numChildren}
                        </div>
                    </div>

                    <!-- Room Type -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Room Type :</span>
                        <div style="width:160px; background:#ffffff; border:1px solid #d4d4d4; border-radius:2px; height:17px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${roomType}
                        </div>
                    </div>

                    <!-- Promotion -->
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="color:#000000;">Promotion :</span>
                        <div style="width:160px; background:#ffffff; border:1px solid #d4d4d4; border-radius:2px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:8.6px; color:#000000; padding:0 3px; white-space:nowrap; overflow:hidden;">
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
                Benefits Included Express check-in, Free WiFi
            </div>

            <!-- 6. Dates Row (Arrival & Departure) -->
            <div style="display:flex; align-items:center; gap:20px; margin:10px 0 14px 0; font-size:9.5px;">
                <div style="display:flex; align-items:center;">
                    <span style="font-weight:bold; margin-right:8px; width:55px;">Arrival :</span>
                    <div style="width:140px; background:#ebebeb; border:1px solid #d4d4d4; border-radius:3px; height:19px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                        ${arrivalDate}
                    </div>
                </div>
                <div style="display:flex; align-items:center;">
                    <span style="font-weight:bold; margin-right:8px; width:70px;">Departure :</span>
                    <div style="width:140px; background:#ebebeb; border:1px solid #d4d4d4; border-radius:3px; height:19px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                        ${departureDate}
                    </div>
                </div>
            </div>

            <!-- 7. Booked And Payable By / Signature Section (Properly separated, NO overlap!) -->
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                <!-- Left Box: Booked And Payable By -->
                <div style="flex:1; max-width:410px;">
                    <div style="font-weight:bold; font-size:9.5px; margin-bottom:4px;">Booked And Payable By :</div>
                    <div style="background:#ebebeb; border:1px solid #d4d4d4; border-radius:3px; padding:8px 10px; font-size:9.5px; line-height:1.45; color:#000000;">
                        Agoda Company Pte, Ltd.<br>
                        30 Cecil Street, Prudential Tower #19-08,<br>
                        Singapore 049712
                    </div>
                </div>
                <!-- Right Box: Stamp & Signature -->
                <div style="width:190px; height:98px; background:#ffffff; border:1px solid #d4d4d4; border-radius:3px; display:flex; align-items:center; justify-content:center; padding:3px; box-sizing:border-box;">
                    <img src="${stampSrc}" alt="Authorized Stamp & Signature" style="max-width:100%; max-height:100%; object-fit:contain;">
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
            <div style="border:1.1px solid #000000; border-radius:3px; padding:7px 10px; font-size:9.5px; line-height:1.35; color:#000000;">
                <div style="font-weight:bold; margin-bottom:3px;">Notes</div>
                <div style="display:flex; align-items:flex-start;">
                    <span style="margin-right:5px; font-size:11px;">•</span>
                    <div>
                        All rooms are guaranteed on the day of arrival. In the case of a no-show, your room(s) will be released and you will be subject to the terms and conditions of the Cancellation/No-Show Policy specified at the time you made the booking as well as noted in the Confirmation Email.
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

    const logoDataUrl = await getAgodaLogoDataUrl();
    const stampDataUrl = await getAgodaStampDataUrl();

    const clientName = (data.clientName || 'AUNG KHIN NYUNT').trim().toUpperCase();
    const bookingId = String(data.bookingId || generateRandomBookingId());
    const memberId = String(data.memberId || generateRandomMemberId());
    const bookingRefNo = String(data.bookingRefNo || '');
    const countryOfResidence = String(data.countryOfResidence || 'Myanmar');
    const propertyName = String(data.propertyName || 'Grand Park Guangzhou Hotel');
    const propertyAddress = String(data.propertyAddress || '20 Hong Hua Qiao, Wuhua, Guangzhou,\nChina');
    const propertyContact = String(data.propertyContact || '+86 871 6538 6688');

    const numRooms = String(data.numRooms !== undefined && data.numRooms !== '' ? data.numRooms : 1);
    const numExtraBeds = String(data.numExtraBeds !== undefined && data.numExtraBeds !== '' ? data.numExtraBeds : 0);
    const numAdults = String(data.numAdults !== undefined && data.numAdults !== '' ? data.numAdults : 1);
    const numChildren = String(data.numChildren !== undefined && data.numChildren !== '' ? data.numChildren : 0);
    const roomType = String(data.roomType || 'Superior Deluxe');
    const promotion = String(data.promotion || 'Long Stay Deal. Price includes 10% discount!');

    const arrivalDate = formatAgodaDate(data.arrivalDate || 'October 16, 2026');
    const departureDate = formatAgodaDate(data.departureDate || 'October 26, 2026');
    const cancellationDate = data.cancellationDate || calculateDefaultCancellationDate(arrivalDate);

    const remarksSpecial = String(data.remarksSpecial || 'NonSmoke,LargeBed');

    // Page: 595.28 x 841.89 pt
    const outerX = 35.2;
    const outerY = 38.6;
    const outerW = 531.0;
    const outerH = 496.8;

    // Outer boundary line
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.8);
    doc.rect(outerX, outerY, outerW, outerH, 'S');

    const innerX = 41.9;
    const innerW = 517.6;
    const rightEdge = innerX + innerW;

    // 1. Header
    if (logoDataUrl) {
        doc.addImage(logoDataUrl, 'PNG', innerX, outerY + 5, 58.8, 30.8);
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
    const rightColH = 123.8;
    doc.setFillColor(220, 220, 220); // #dcdcdc
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

    // Row 6: Property (White box with thin border)
    doc.setFont('helvetica', 'normal');
    doc.text("Property :", labelX, 184.0);
    const boxX = 136.6;
    const boxW = 147.9;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(212, 212, 212);
    doc.setLineWidth(0.5);
    doc.rect(boxX, 175.3, boxW, 14.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text(propertyName, boxX + (boxW / 2), 185.0, { align: 'center' });

    // Row 7: Address (White box with thin border, multiline)
    doc.setFont('helvetica', 'normal');
    doc.text("Address :", labelX, 202.0);
    doc.setFillColor(255, 255, 255);
    doc.rect(boxX, 192.6, boxW, 31.9, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    const addrLines = propertyAddress.split('\n');
    if (addrLines.length > 1) {
        doc.text(addrLines[0].trim(), boxX + (boxW / 2), 205.5, { align: 'center' });
        doc.text(addrLines[1].trim(), boxX + (boxW / 2), 215.5, { align: 'center' });
    } else {
        doc.text(propertyAddress.trim(), boxX + (boxW / 2), 210.5, { align: 'center' });
    }

    // Row 8: Property Contact Number (White box with thin border)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Property Contact Number :", labelX, 235.8);
    doc.setFillColor(255, 255, 255);
    doc.rect(boxX, 227.4, boxW, 14.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.text(propertyContact, boxX + (boxW / 2), 237.0, { align: 'center' });

    // Right Column rows (Inside gray container, with WHITE boxes):
    const rLabelX = 298.8;
    const rBoxX = 380.8;
    const rBoxW = 170.3;

    function drawWhiteRightBox(y, h, text, isSmall = false) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(212, 212, 212);
        doc.setLineWidth(0.5);
        doc.rect(rBoxX, y, rBoxW, h, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isSmall ? 6.7 : 7.3);
        doc.setTextColor(0, 0, 0);
        doc.text(String(text || ''), rBoxX + (rBoxW / 2), y + (h / 2) + 2.5, { align: 'center' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);

    doc.text("Number of Rooms :", rLabelX, 107.0);
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
    doc.setFillColor(220, 220, 220);
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
    doc.setFillColor(220, 220, 220);
    doc.rect(innerX, benefitY, innerW, benefitH, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Benefits Included Express check-in, Free WiFi", innerX + 4.5, benefitY + 10.5);

    // 6. Dates Row (Arrival & Departure pills are Gray)
    const datesY = 301.3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text("Arrival :", innerX + 6.0, datesY + 9.0);

    // Arrival pill (Gray)
    doc.setFillColor(220, 220, 220);
    doc.rect(86.8, datesY, 131.1, 12.3, 'F');
    doc.text(arrivalDate, 86.8 + (131.1 / 2), datesY + 9.0, { align: 'center' });

    doc.text("Departure :", 226.8, datesY + 9.0);
    // Departure pill (Gray)
    doc.setFillColor(220, 220, 220);
    doc.rect(280.6, datesY, 131.1, 12.3, 'F');
    doc.text(departureDate, 280.6 + (131.1 / 2), datesY + 9.0, { align: 'center' });

    // 7. Stamp & Signature Box (Starts at y=301.3, h=72.3, on right side)
    const stampBoxX = 418.9;
    const stampBoxY = 301.3;
    const stampBoxW = 133.9;
    const stampBoxH = 72.3;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(212, 212, 212);
    doc.setLineWidth(0.5);
    doc.rect(stampBoxX, stampBoxY, stampBoxW, stampBoxH, 'FD');
    if (stampDataUrl) {
        doc.addImage(stampDataUrl, 'PNG', stampBoxX + 2, stampBoxY + 1, stampBoxW - 4, stampBoxH - 2);
    }

    // Booked And Payable By (On left, below Arrival/Departure - NO OVERLAP!)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);
    doc.text("Booked And Payable By :", innerX + 6.0, 327.5);

    // Booked and Payable By Box (Gray)
    const payableBoxY = 334.9;
    const payableBoxW = 357.4;
    const payableBoxH = 32.5;
    doc.setFillColor(220, 220, 220);
    doc.rect(54.3, payableBoxY, payableBoxW, payableBoxH, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Agoda Company Pte, Ltd.", 60.0, payableBoxY + 9.5);
    doc.text("30 Cecil Street, Prudential Tower #19-08,", 60.0, payableBoxY + 19.5);
    doc.text("Singapore 049712", 60.0, payableBoxY + 28.5);

    // 8. Remarks (On Left, below Booked and Payable By)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text("Remarks :", innerX, 392.0);
    doc.text(remarksSpecial, innerX, 402.0);
    doc.text("All special requests are subject to availability upon arrival", innerX, 412.0);

    // 9. Call our Customer Service Center 24/7 (Pushed down on the right side)
    doc.setFont('helvetica', 'bold');
    doc.text("Call our Customer Service Center 24/7 :", rightEdge, 453.5, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text("Customer Support : +60 3 2053 1869, +1 866 656 8207", rightEdge, 463.5, { align: 'right' });
    doc.text("(Long distance charge may apply)", rightEdge, 473.5, { align: 'right' });

    // 10. Notes Box (At bottom, black border)
    const notesY = 485.0;
    const notesH = 43.7;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    doc.rect(innerX, notesY, innerW, notesH, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text("Notes", innerX + 6.0, notesY + 11.0);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.text("• All rooms are guaranteed on the day of arrival. In the case of a no-show, your room(s) will be released and you will be subject to the terms and", innerX + 6.0, notesY + 21.0);
    doc.text("   conditions of the Cancellation/No-Show Policy specified at the time you made the booking as well as noted in the Confirmation Email.", innerX + 6.0, notesY + 31.0);

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
 * Export booking as image (PNG) using html2canvas
 */
export async function downloadAgodaImage(data) {
    if (!window.html2canvas) {
        throw new Error('html2canvas library is not loaded');
    }
    const previewEl = document.getElementById('agodaBookingDocument');
    if (!previewEl) return;

    const canvas = await window.html2canvas(previewEl, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff'
    });

    const clientName = (data.clientName || 'Guest').trim();
    const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
    const safeId = (data.bookingId || 'Agoda').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Agoda_Hotel_Booking_${safeName}_${safeId}.png`;

    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
    return filename;
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
