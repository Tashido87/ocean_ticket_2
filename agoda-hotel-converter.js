/**
 * Agoda China Visa Hotel Booking Confirmation Generator
 * Generates official Agoda Booking Confirmations for China Visa applications.
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
            // Handle DD/MM/YYYY
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
 * Calculates a default cancellation date (e.g., 15-30 days before arrival)
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
 * Generate preview HTML markup that renders identically to the Agoda Booking Confirmation
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

    const remarksTaxes = data.remarksTaxes || 'Included : Taxes and fees USD 51.22';
    const remarksSpecial = data.remarksSpecial || 'NonSmoke,LargeBed';

    return `
    <div class="agoda-booking-wrapper" id="agodaBookingDocument" style="background:#ffffff; color:#000000; font-family:'Liberation Sans', Arial, Helvetica, sans-serif; width:100%; max-width:708px; margin:0 auto; box-sizing:border-box; line-height:1.25; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        
        <!-- Outer Border Container -->
        <div style="border:1.2px solid #000000; padding:10px 14px 12px 14px; background:#ffffff; box-sizing:border-box;">
            
            <!-- 1. Header Row -->
            <div style="display:flex; justify-content:space-between; align-items:flex-end; padding:2px 2px 8px 2px;">
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
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 6px; font-size: 9.5px;">
                
                <!-- Left Column -->
                <div style="display:flex; flex-direction:column; gap:4.5px;">
                    <!-- Booking ID -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Booking ID :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${bookingId}
                        </div>
                    </div>

                    <!-- Booking Reference No -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Booking Reference No :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${bookingRefNo}
                        </div>
                    </div>

                    <!-- Client -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Client :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:10px; color:#000000;">
                            ${clientName}
                        </div>
                    </div>

                    <!-- Member ID -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Member ID :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${memberId}
                        </div>
                    </div>

                    <!-- Country of Residence -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Country of Residence :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${countryOfResidence}
                        </div>
                    </div>

                    <!-- Property -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Property :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000; padding:0 4px; text-align:center; overflow:hidden;">
                            ${propertyName}
                        </div>
                    </div>

                    <!-- Address (multiline) -->
                    <div style="display:flex; align-items:stretch;">
                        <span style="width:125px; color:#000000; padding-top:6px;">Address :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; min-height:40px; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:bold; font-size:9px; line-height:1.3; color:#000000; padding:4px 6px; text-align:center;">
                            ${propertyAddress.split('\n').join('<br>')}
                        </div>
                    </div>

                    <!-- Property Contact Number -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Property Contact Number :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${propertyContact}
                        </div>
                    </div>
                </div>

                <!-- Right Column -->
                <div style="display:flex; flex-direction:column; gap:4.5px;">
                    <!-- Number of Rooms -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Number of Rooms :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numRooms}
                        </div>
                    </div>

                    <!-- Number of Extra Beds -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Number of Extra Beds :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numExtraBeds}
                        </div>
                    </div>

                    <!-- Number of Adults -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Number of Adults :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numAdults}
                        </div>
                    </div>

                    <!-- Number of Children -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Number of Children :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${numChildren}
                        </div>
                    </div>

                    <!-- Room Type -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Room Type :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:18px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                            ${roomType}
                        </div>
                    </div>

                    <!-- Promotion -->
                    <div style="display:flex; align-items:center;">
                        <span style="width:125px; color:#000000;">Promotion :</span>
                        <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:19px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:8.8px; color:#000000; padding:0 4px; white-space:nowrap; overflow:hidden;">
                            ${promotion}
                        </div>
                    </div>

                    <!-- Promotion condition note -->
                    <div style="font-size:9.2px; color:#000000; margin-top:3px; padding-left:2px;">
                        For Full Promotion details and conditions see confirmation email
                    </div>
                </div>

            </div>

            <!-- 4. Cancellation Policy Banner -->
            <div style="background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; padding:5px 8px; margin:6px 0; font-size:9.5px; line-height:1.35; color:#000000;">
                <strong>Cancellation Policy:</strong> Risk-free booking! You can cancel until ${cancellationDate} and pay nothing! If you fail to arrive or cancel the booking, no refund will be given. If you fail to arrive or cancel the booking, no refund will be given.
            </div>

            <!-- 5. Benefits Included Banner -->
            <div style="background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; padding:4px 8px; margin-bottom:6px; font-size:9.5px; color:#000000;">
                Benefits Included Express check-in, Free WiFi
            </div>

            <!-- 6. Dates Row (Arrival & Departure) -->
            <div style="display:flex; gap:16px; margin:7px 0; font-size:9.5px; align-items:center;">
                <div style="display:flex; align-items:center; flex:1;">
                    <span style="font-weight:bold; margin-right:8px; width:65px;">Arrival :</span>
                    <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:20px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                        ${arrivalDate}
                    </div>
                </div>
                <div style="display:flex; align-items:center; flex:1;">
                    <span style="font-weight:bold; margin-right:8px; width:75px;">Departure :</span>
                    <div class="agoda-pill-box" style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; height:20px; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#000000;">
                        ${departureDate}
                    </div>
                </div>
            </div>

            <!-- 7. Booked And Payable By / Signature Section -->
            <div style="display:flex; gap:14px; margin-top:8px; margin-bottom:8px; align-items:stretch;">
                <!-- Left Box -->
                <div style="flex:1; display:flex; flex-direction:column;">
                    <div style="font-weight:bold; font-size:9.5px; margin-bottom:4px;">Booked And Payable By :</div>
                    <div style="flex:1; background:#ebebeb; border:1px solid #d4d4d4; border-radius:4px; padding:8px 10px; font-size:9.5px; line-height:1.45; color:#000000;">
                        Agoda Company Pte, Ltd.<br>
                        30 Cecil Street, Prudential Tower #19-08,<br>
                        Singapore 049712
                    </div>
                </div>
                <!-- Right Box (Stamp & Signature) -->
                <div style="width:190px; height:98px; background:#ffffff; border:1px solid #d4d4d4; border-radius:4px; display:flex; align-items:center; justify-content:center; padding:4px; box-sizing:border-box;">
                    <img src="${stampSrc}" alt="Authorized Stamp & Signature" style="max-width:100%; max-height:100%; object-fit:contain;">
                </div>
            </div>

            <!-- 8. Remarks & Customer Support Row -->
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-top:10px; margin-bottom:8px; font-size:9.5px;">
                <!-- Remarks -->
                <div style="font-weight:bold; line-height:1.4; color:#000000;">
                    <div>Remarks :</div>
                    <div>${remarksTaxes}</div>
                    <div>${remarksSpecial}</div>
                    <div>All special requests are subject to availability upon arrival</div>
                </div>
                <!-- Customer Support -->
                <div style="text-align:right; line-height:1.4; color:#000000;">
                    <div style="font-weight:bold;">Call our Customer Service Center 24/7 :</div>
                    <div>Customer Support : +60 3 2053 1869, +1 866 656 8207</div>
                    <div style="font-weight:normal;">(Long distance charge may apply)</div>
                </div>
            </div>

            <!-- 9. Notes Section -->
            <div style="border:1px solid #000000; border-radius:4px; padding:6px 10px; margin-top:8px; font-size:9.5px; line-height:1.35; color:#000000;">
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
 * Generate native jsPDF vector document
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

    const remarksTaxes = String(data.remarksTaxes || 'Included : Taxes and fees USD 51.22');
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

    const innerX = 41.5;
    const innerW = 518.4;
    const rightEdge = innerX + innerW;

    // 1. Header
    // Logo
    if (logoDataUrl) {
        doc.addImage(logoDataUrl, 'PNG', innerX, outerY + 5, 58.8, 30.8);
    }

    // Right Header Text
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
    doc.text("Please present either an electronic or paper copy of your booking confirmation upon check-in.", rightEdge, outerY + 34, { align: 'right' });

    // 2. Grey Repeating Banner Strip
    const stripY = outerY + 40;
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

    // Colors for rounded pills
    const pillBg = [235, 235, 235];
    const pillBorder = [212, 212, 212];
    doc.setDrawColor(...pillBorder);
    doc.setLineWidth(0.5);

    // 3. Two-Column Details
    const leftPillX = 136.6;
    const leftPillW = 147.9;
    const rightLabelX = 298.5;
    const rightPillX = 380.8;
    const rightPillW = 170.3;

    let curY = stripY + 18.4;
    const rowH = 13.5;
    const rowGap = 3.0;

    function drawPill(x, y, w, h, text, isMultiline = false, fontSize = 7.3, isBold = true) {
        doc.setFillColor(...pillBg);
        doc.roundedRect(x, y, w, h, 3, 3, 'FD');
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setFontSize(fontSize);
        doc.setTextColor(0, 0, 0);
        if (isMultiline) {
            const lines = text.split('\n');
            const startY = y + (h / 2) - ((lines.length - 1) * 4.5);
            lines.forEach((line, idx) => {
                doc.text(line.trim(), x + (w / 2), startY + (idx * 9) + 2.5, { align: 'center' });
            });
        } else {
            doc.text(String(text || ''), x + (w / 2), y + (h / 2) + 2.5, { align: 'center' });
        }
    }

    // Row 1: Booking ID | Number of Rooms
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);
    doc.text("Booking ID :", innerX, curY + 9.5);
    drawPill(leftPillX, curY, leftPillW, rowH, bookingId);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Number of Rooms :", rightLabelX, curY + 9.5);
    drawPill(rightPillX, curY, rightPillW, rowH, numRooms);

    // Row 2: Booking Reference No | Number of Extra Beds
    curY += rowH + rowGap;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Booking Reference No :", innerX, curY + 9.5);
    drawPill(leftPillX, curY, leftPillW, rowH, bookingRefNo);

    doc.setFont('helvetica', 'normal');
    doc.text("Number of Extra Beds :", rightLabelX, curY + 9.5);
    drawPill(rightPillX, curY, rightPillW, rowH, numExtraBeds);

    // Row 3: Client | Number of Adults
    curY += rowH + rowGap;
    doc.setFont('helvetica', 'normal');
    doc.text("Client :", innerX, curY + 9.5);
    drawPill(leftPillX, curY, leftPillW, rowH, clientName, false, 8.0, true);

    doc.setFont('helvetica', 'normal');
    doc.text("Number of Adults :", rightLabelX, curY + 9.5);
    drawPill(rightPillX, curY, rightPillW, rowH, numAdults);

    // Row 4: Member ID | Number of Children
    curY += rowH + rowGap;
    doc.setFont('helvetica', 'normal');
    doc.text("Member ID :", innerX, curY + 9.5);
    drawPill(leftPillX, curY, leftPillW, rowH, memberId);

    doc.setFont('helvetica', 'normal');
    doc.text("Number of Children :", rightLabelX, curY + 9.5);
    drawPill(rightPillX, curY, rightPillW, rowH, numChildren);

    // Row 5: Country of Residence | Room Type
    curY += rowH + rowGap;
    doc.setFont('helvetica', 'normal');
    doc.text("Country of Residence :", innerX, curY + 9.5);
    drawPill(leftPillX, curY, leftPillW, rowH, countryOfResidence);

    doc.setFont('helvetica', 'normal');
    doc.text("Room Type :", rightLabelX, curY + 9.5);
    drawPill(rightPillX, curY, rightPillW, rowH, roomType);

    // Row 6: Property | Promotion
    curY += rowH + rowGap;
    doc.setFont('helvetica', 'normal');
    doc.text("Property :", innerX, curY + 9.5);
    drawPill(leftPillX, curY, leftPillW, rowH, propertyName);

    doc.setFont('helvetica', 'normal');
    doc.text("Promotion :", rightLabelX, curY + 9.5);
    drawPill(rightPillX, curY, rightPillW, 14.5, promotion, false, 6.7, true);

    // Promotion note below
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(0, 0, 0);
    doc.text("For Full Promotion details and conditions see confirmation email", rightLabelX, curY + 24);

    // Row 7: Address (multiline)
    curY += rowH + rowGap;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Address :", innerX, curY + 9.5);
    drawPill(leftPillX, curY, leftPillW, 31.0, propertyAddress, true, 6.8, true);

    // Row 8: Property Contact Number
    curY += 31.0 + rowGap;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Property Contact Number :", innerX, curY + 9.5);
    drawPill(leftPillX, curY, leftPillW, rowH, propertyContact);

    // 4. Cancellation Policy Banner
    curY += rowH + 6.0;
    const cancelH = 25.5;
    doc.setFillColor(...pillBg);
    doc.roundedRect(innerX, curY, innerW, cancelH, 3, 3, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.setTextColor(0, 0, 0);
    
    // Line 1:
    const cancelText1 = `Cancellation Policy: Risk-free booking! You can cancel until ${cancellationDate} and pay nothing! If you fail to arrive or cancel the booking, no refund will be`;
    doc.text(cancelText1, innerX + 4.5, curY + 9.5);
    // Line 2:
    const cancelText2 = "given. If you fail to arrive or cancel the booking, no refund will be given.";
    doc.text(cancelText2, innerX + 4.5, curY + 19.5);

    // 5. Benefits Included Banner
    curY += cancelH + 3.0;
    const benefitH = 15.5;
    doc.setFillColor(...pillBg);
    doc.roundedRect(innerX, curY, innerW, benefitH, 3, 3, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text("Benefits Included Express check-in, Free WiFi", innerX + 4.5, curY + 10.5);

    // 6. Dates Row (Arrival & Departure)
    curY += benefitH + 5.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text("Arrival :", innerX + 6.0, curY + 10.0);
    drawPill(86.5, curY, 131.0, 14.5, arrivalDate, false, 7.3, true);

    doc.setFont('helvetica', 'bold');
    doc.text("Departure :", 226.5, curY + 10.0);
    drawPill(280.5, curY, 131.0, 14.5, departureDate, false, 7.3, true);

    // 7. Booked And Payable By / Signature Section
    // Stamp box on right
    const stampBoxX = 419.0;
    const stampBoxY = curY;
    const stampBoxW = 133.5;
    const stampBoxH = 72.0;

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...pillBorder);
    doc.roundedRect(stampBoxX, stampBoxY, stampBoxW, stampBoxH, 3, 3, 'FD');
    if (stampDataUrl) {
        doc.addImage(stampDataUrl, 'PNG', stampBoxX + 2, stampBoxY + 1, stampBoxW - 4, stampBoxH - 2);
    }

    // Booked and payable by on left
    curY += 19.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text("Booked And Payable By :", innerX + 6.0, curY);

    const payableBoxY = curY + 3.5;
    const payableBoxW = 356.5;
    const payableBoxH = 32.5;
    doc.setFillColor(...pillBg);
    doc.roundedRect(innerX + 6.0, payableBoxY, payableBoxW, payableBoxH, 3, 3, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text("Agoda Company Pte, Ltd.", innerX + 11.0, payableBoxY + 9.5);
    doc.text("30 Cecil Street, Prudential Tower #19-08,", innerX + 11.0, payableBoxY + 19.5);
    doc.text("Singapore 049712", innerX + 11.0, payableBoxY + 28.5);

    // 8. Remarks & Customer Support
    curY = stampBoxY + stampBoxH + 11.5;

    // Left Remarks
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(0, 0, 0);
    doc.text("Remarks :", innerX, curY);
    doc.text(remarksTaxes, innerX, curY + 10.0);
    doc.text(remarksSpecial, innerX, curY + 20.0);
    doc.text("All special requests are subject to availability upon arrival", innerX, curY + 30.0);

    // Right Customer Support
    doc.setFont('helvetica', 'bold');
    doc.text("Call our Customer Service Center 24/7 :", rightEdge, curY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text("Customer Support : +60 3 2053 1869, +1 866 656 8207", rightEdge, curY + 10.0, { align: 'right' });
    doc.text("(Long distance charge may apply)", rightEdge, curY + 20.0, { align: 'right' });

    // 9. Notes Box at Bottom
    curY += 38.0;
    const notesBoxH = 43.5;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    doc.rect(innerX, curY, innerW, notesBoxH, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text("Notes", innerX + 6.0, curY + 11.0);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.text("• All rooms are guaranteed on the day of arrival. In the case of a no-show, your room(s) will be released and you will be subject to the terms and", innerX + 6.0, curY + 22.0);
    doc.text("   conditions of the Cancellation/No-Show Policy specified at the time you made the booking as well as noted in the Confirmation Email.", innerX + 6.0, curY + 32.0);

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
