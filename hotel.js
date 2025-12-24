/**
 * @fileoverview Manages the Hotel Booking Voucher generation service.
 * Supports specific layouts for Bangkok (BKK) and Kuala Lumpur (KUL).
 * NOW SUPPORTS: Child Detection (MSTR/MISS) & True PDF Generation.
 */

import { state } from './state.js';
import { showToast, formatDateToDMMMY } from './utils.js';

/* =========================================
   HOTEL BOOKING VOUCHER MODULE
   ========================================= */

/**
 * Initializes the hotel service event listeners.
 */
export function initHotelService() {
    const pdfBtn = document.getElementById('hotel-pdf-btn');
    const pngBtn = document.getElementById('hotel-png-btn');
    const clearBtn = document.getElementById('clear-hotel-btn');

    if (pdfBtn) pdfBtn.addEventListener('click', () => generateVoucher('pdf'));
    if (pngBtn) pngBtn.addEventListener('click', () => generateVoucher('png'));
    if (clearBtn) clearBtn.addEventListener('click', clearHotelInputs);
}

/**
 * Clears all input fields in the hotel booking form.
 */
function clearHotelInputs() {
    document.getElementById('hotel-city').value = 'BKK';
    document.getElementById('hotel-pnr').value = '';
    document.getElementById('hotel-arrival').value = '';
    document.getElementById('hotel-departure').value = '';
    document.getElementById('hotel-bed-qty').value = '1';
    document.getElementById('hotel-bed-type').value = 'Double';
    document.getElementById('hotel-extra-bed').checked = false;
}

/**
 * Main logic to generate the voucher data and render it.
 * @param {string} format 'pdf' or 'png'
 */
async function generateVoucher(format) {
    // 1. Collect Inputs
    const city = document.getElementById('hotel-city').value; // BKK or KUL
    const pnrInput = document.getElementById('hotel-pnr').value.trim();
    const arrivalDateStr = document.getElementById('hotel-arrival').value;
    const departureDateStr = document.getElementById('hotel-departure').value;
    const bedQty = document.getElementById('hotel-bed-qty').value;
    const bedType = document.getElementById('hotel-bed-type').value; // Double or Twin
    const hasExtraBed = document.getElementById('hotel-extra-bed').checked;

    // 2. Validation
    if (!pnrInput || !arrivalDateStr || !departureDateStr) {
        showToast('Please fill in PNR and Dates.', 'error');
        return;
    }

    // 3. Format Dates (e.g., "Nov 12, 2025")
    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    const arrival = formatDate(arrivalDateStr);
    const departure = formatDate(departureDateStr);

    // 4. Fetch Client Names from PNR(s) & Detect Children
    const pnrs = pnrInput.split(/[,\s]+/).filter(p => p.trim());
    let guestNames = [];
    let adultCount = 0;
    let childCount = 0;
    
    pnrs.forEach(pnr => {
        const tickets = state.allTickets.filter(t => 
            (t.booking_reference || '').toUpperCase() === pnr.toUpperCase()
        );
        tickets.forEach(t => {
            let rawName = (t.name || '').toUpperCase();
            let isChild = false;

            // Child Detection Logic:
            // Check if title is MSTR (Master) or MISS before removing it.
            // Assumption: MISS/MSTR is used for children.
            if (/\s(MSTR|MISS)(\s|$)/.test(rawName)) {
                isChild = true;
            }

            // Remove title at end (MR, MRS, MS, MSTR, MISS)
            rawName = rawName.replace(/\s+(MR|MRS|MS|MISS|MSTR)$/, '');
            
            // Format Name with Suffix
            let formattedName = rawName + (isChild ? "(Child)" : "(Adult)");
            
            if (!guestNames.includes(formattedName)) {
                guestNames.push(formattedName);
                if (isChild) childCount++; else adultCount++;
            }
        });
    });

    // Fallback if PNR not found (for manual testing)
    if (guestNames.length === 0) {
        showToast(`Warning: No passengers found for PNR ${pnrInput}. Using placeholder.`, 'info');
        guestNames = ["GUEST / NAME(Adult)"];
        adultCount = 1;
        childCount = 0;
    }

    // Generate Pax String (e.g., "2 Adult(s), 1 Child(ren)")
    let paxString = `${adultCount} Adult(s)`;
    if (childCount > 0) {
        paxString += `, ${childCount} Child(ren)`;
    }

    // 5. Generate Reference & Details
    const refNum = city === 'BKK' 
        ? Math.floor(10000000000 + Math.random() * 90000000000).toString().substring(0, 11)
        : Math.floor(100000000 + Math.random() * 900000000).toString().substring(0, 9);

    const plural = parseInt(bedQty) > 1 ? 's' : '';
    let bedDetail = `${bedQty} ${bedType} Bed${plural}`;
    if (hasExtraBed) bedDetail += " with 1 Extra Bed";

    const roomType = city === 'BKK' ? "Grand Deluxe" : "Executive Deluxe Room";
    
    // KUL Bed Request logic
    const bedRequest = bedDetail.toLowerCase().includes('twin') ? 'Twin bed' : 'Large bed';

    const data = {
        refNum,
        arrival,
        departure,
        guestNames,
        paxString, // Passed the formatted string
        unit: 1,
        roomType,
        bedDetail,
        bedRequest
    };

    // 6. Handle Output Format
    const container = document.getElementById('voucher-render-container');
    if (!container) return;

    if (format === 'png') {
        container.innerHTML = city === 'BKK' ? getBKKHtml(data) : getKULHtml(data);
        await downloadPNG(container, `Hotel_Voucher_${city}_${data.refNum}`);
        container.innerHTML = ''; 
        showToast(`${city} Voucher (PNG) generated!`, 'success');
    } else {
        // True PDF
        try {
            if (city === 'BKK') generateTruePdfBKK(data);
            else generateTruePdfKUL(data);
            showToast(`${city} Voucher (PDF) generated!`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error generating PDF', 'error');
        }
    }
}

/**
 * Generates a True PDF for Bangkok (BKK)
 */
function generateTruePdfBKK(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    
    const marginX = 40;
    let cursorY = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - (marginX * 2);

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text("HOTEL VOUCHER", marginX, cursorY);
    cursorY += 20;
    doc.setFontSize(12);
    doc.text("PLEASE PRESENT THIS VOUCHER UPON ARRIVAL.", marginX, cursorY);

    // Hotel Info
    cursorY += 30;
    doc.setFillColor(240, 240, 240);
    doc.rect(marginX, cursorY, contentWidth, 20, 'F');
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("Hotel Information", marginX + 10, cursorY + 14);

    cursorY += 35;
    doc.setFontSize(12);
    doc.text("Grande Centre Point Ratchadamri", marginX, cursorY);
    
    cursorY += 20;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Tel.", marginX, cursorY);
    doc.setFont("helvetica", "normal");
    doc.text("66-2-0919000", marginX + 60, cursorY);

    cursorY += 15;
    doc.setFont("helvetica", "bold");
    doc.text("Ads.", marginX, cursorY);
    doc.setFont("helvetica", "normal");
    const address = "153/2 Mahatlek Luang 1, Ratchadamri Rd Lumpini, Pathumwan, Bangkok (and vicinity), Thailand";
    const addressLines = doc.splitTextToSize(address, contentWidth - 60);
    doc.text(addressLines, marginX + 60, cursorY);

    // Order Info
    cursorY += 30;
    doc.setFillColor(240, 240, 240);
    doc.rect(marginX, cursorY, contentWidth, 20, 'F');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Order Information", marginX + 10, cursorY + 14);

    cursorY += 35;
    const col1X = marginX;
    const col2X = marginX + (contentWidth * 0.33);
    const col3X = marginX + (contentWidth * 0.66);

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Reference Number", col1X, cursorY);
    doc.text("Arrival Date", col2X, cursorY);
    doc.text("Departure Date", col3X, cursorY);

    cursorY += 15;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(data.refNum, col1X, cursorY);
    doc.text(data.arrival, col2X, cursorY);
    doc.text(data.departure, col3X, cursorY);

    // Table
    cursorY += 25;
    const guestsString = data.guestNames.join('\n');
    
    doc.autoTable({
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Unit', 'Room Type/Bed Type', 'Guests(First Name / Last Name)', 'Number', 'Meal Type']],
        body: [[
            data.unit,
            { content: `${data.roomType}\n${data.bedDetail}`, styles: { fontStyle: 'bold' } },
            guestsString,
            data.paxString, // Updated with child count
            'Room Only'
        ]],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 8, lineColor: [200, 200, 200], lineWidth: 0.5, valign: 'top' },
        headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', lineColor: [200, 200, 200], lineWidth: 0.5 },
        columnStyles: { 0: { halign: 'center', cellWidth: 40 }, 1: { cellWidth: 140 }, 2: { cellWidth: 160 }, 3: { cellWidth: 60 }, 4: { cellWidth: 80 } }
    });

    cursorY = doc.lastAutoTable.finalY + 30;

    // Footer
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("* Customer Requests", marginX, cursorY);
    
    cursorY += 15;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("The remarks for the establishment are for reference only. We cannot guarantee them.", marginX, cursorY);

    doc.save(`Hotel_Voucher_BKK_${data.refNum}.pdf`);
}

/**
 * Generates a True PDF for Kuala Lumpur (KUL)
 */
function generateTruePdfKUL(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const marginX = 40;
    let cursorY = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - (marginX * 2);

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.text("HOTEL VOUCHER", marginX, cursorY);
    cursorY += 20;
    doc.setFontSize(12);
    doc.text("PLEASE PRESENT THIS VOUCHER UPON ARRIVAL.", marginX, cursorY);

    // Hotel Info
    cursorY += 30;
    doc.setFillColor(240, 240, 240);
    doc.rect(marginX, cursorY, contentWidth, 20, 'F');
    doc.setFontSize(14);
    doc.text("Hotel Information", marginX + 10, cursorY + 14);

    // CHANGED: Increased from 35 to 50 to add space between Header and Hotel Name
    cursorY += 50; 
    doc.setFontSize(14);
    doc.text("THE FACE Style Hotel", marginX, cursorY);

    cursorY += 20;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Tel.", marginX, cursorY);
    doc.setFont("helvetica", "normal");
    doc.text("60321681688", marginX + 60, cursorY);

    cursorY += 15;
    doc.setFont("helvetica", "bold");
    doc.text("Ads.", marginX, cursorY);
    doc.setFont("helvetica", "normal");
    const address = "1020 Jalan Sultan Ismail, Kuala Lumpur (and vicinity), Malaysia";
    doc.text(address, marginX + 60, cursorY);

    // Order Info
    cursorY += 30;
    doc.setFillColor(240, 240, 240);
    doc.rect(marginX, cursorY, contentWidth, 20, 'F');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Order Information", marginX + 10, cursorY + 14);

    cursorY += 35;
    const col1X = marginX;
    const col2X = marginX + (contentWidth * 0.33);
    const col3X = marginX + (contentWidth * 0.66);

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Reference Number", col1X, cursorY);
    doc.text("Arrival Date", col2X, cursorY);
    doc.text("Departure Date", col3X, cursorY);

    cursorY += 15;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(data.refNum, col1X, cursorY);
    doc.text(data.arrival, col2X, cursorY);
    doc.text(data.departure, col3X, cursorY);

    // Table
    cursorY += 25;
    const guestsString = data.guestNames.join('\n\n'); 

    doc.autoTable({
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Unit', 'Room Type/Bed Type', 'Guests(First Name / Last Name)', 'Number', 'Meal Type']],
        body: [[
            data.unit,
            { content: `${data.roomType}\n${data.bedDetail}`, styles: { fontStyle: 'bold' } },
            guestsString,
            data.paxString, // Updated with child count
            'Room Only'
        ]],
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 10, lineColor: [220, 220, 220], lineWidth: 0.5, valign: 'top', textColor: 0 },
        headStyles: { fillColor: [247, 247, 247], textColor: [50, 50, 50], fontStyle: 'bold', lineColor: [220, 220, 220], lineWidth: 0.5 },
        columnStyles: { 0: { halign: 'center', cellWidth: 40 }, 1: { cellWidth: 140 }, 2: { cellWidth: 160 }, 3: { cellWidth: 70 }, 4: { cellWidth: 80 } }
    });

    cursorY = doc.lastAutoTable.finalY + 25;

    // Footer
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("* Customer Requests", marginX, cursorY);

    cursorY += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    
    // Horizontal Bullets
    doc.circle(marginX + 3, cursorY - 3, 1.5, 'F');
    doc.text("Higher floor room", marginX + 12, cursorY);
    
    let reqX = marginX + 130;
    doc.circle(reqX + 3, cursorY - 3, 1.5, 'F');
    doc.text("Non smoking room", reqX + 12, cursorY);

    reqX = marginX + 260;
    doc.circle(reqX + 3, cursorY - 3, 1.5, 'F');
    doc.text(data.bedRequest, reqX + 12, cursorY);

    cursorY += 20;
    doc.text("The remarks for the establishment are for reference only. We cannot guarantee them.", marginX, cursorY);

    // Reminder
    cursorY += 25;
    doc.setDrawColor(230, 230, 230);
    doc.line(marginX, cursorY, pageWidth - marginX, cursorY);
    
    cursorY += 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Reminder:", marginX, cursorY);

    cursorY += 15;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    
    const reminders = [
        "1. Upon your arrival please provide valid government-issued ID to the hotel front desk to locate the accurate booking.",
        "2. Please tell front desk agent your preferred bed type if your booking comes with more than one (e.g. Double or Twin). The final arrangement is fully subject to hotel's availability.",
        "3. All special requests are not guaranteed. Please confirm your special requests with front desk upon arrival.",
        "4. Check-in time starts at 15:00:00. Check-out time ends at 12:00:00. Please check-in before the latest check-in time.",
        "5. Please be noted that some hotels charge children extra breakfast fee even when your room offers breakfast. The actual situation is subject to the hotel regulations.",
        "6. Regular tax and fees are included in this stay. Additional charges (City tax, resort fees, etc.) may be charged directly by the hotel.",
        "7. Any other fees occured in the hotel such as additional service fees, violation fines will also be charged by the hotel directly.",
        "8. To make arrangements for check-in please contact the property at least 24 hours before arrival using the information on the booking confirmation."
    ];

    reminders.forEach(line => {
        const splitLine = doc.splitTextToSize(line, contentWidth);
        doc.text(splitLine, marginX, cursorY);
        cursorY += (splitLine.length * 11) + 4;
    });

    doc.save(`Hotel_Voucher_KUL_${data.refNum}.pdf`);
}

/**
 * Generates and downloads a PNG image using html2canvas.
 */
async function downloadPNG(element, filename) {
    if (!window.html2canvas) {
        showToast("HTML2Canvas library not loaded.", "error");
        return;
    }
    const sheet = element.querySelector('.voucher-a4-sheet');
    const canvas = await html2canvas(sheet, {
        scale: 2, 
        useCORS: true,
        backgroundColor: '#ffffff'
    });
    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/* =========================================
   HTML TEMPLATES (Visual/PNG Only)
   ========================================= */

function getBKKHtml(data) {
    const guestsHtml = data.guestNames.join('<br>');
    return `
    <div class="voucher-a4-sheet bkk-style">
        <style>
            .bkk-style { width: 794px; min-height: 1123px; padding: 40px; background: #fff; font-family: Arial, sans-serif; color: #000; box-sizing: border-box; }
            .bkk-header { margin-bottom: 20px; }
            .bkk-title { font-size: 24px; font-weight: bold; margin: 0; }
            .bkk-subtitle { font-size: 14px; font-weight: bold; margin-top: 5px; }
            .bkk-block-header { font-size: 16px; font-weight: bold; background-color: #f0f0f0; padding: 5px 10px; margin-top: 25px; margin-bottom: 15px; }
            .bkk-hotel-name { font-size: 16px; font-weight: bold; margin-bottom: 10px; }
            .bkk-info-row { display: flex; font-size: 12px; margin-bottom: 5px; }
            .bkk-label { width: 60px; font-weight: bold; }
            .bkk-value { flex: 1; }
            .bkk-grid { display: flex; margin-top: 10px; justify-content: space-between; }
            .bkk-grid-item { width: 32%; }
            .bkk-grid-label { font-size: 12px; font-weight: bold; margin-bottom: 4px; }
            .bkk-grid-value { font-size: 12px; }
            .bkk-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
            .bkk-table th { background-color: #f0f0f0; border: 1px solid #ccc; padding: 8px; text-align: left; font-weight: bold; }
            .bkk-table td { border: 1px solid #ccc; padding: 10px 8px; vertical-align: top; }
            .bkk-footer { margin-top: 25px; font-size: 12px; }
            .bkk-req-title { font-weight: bold; margin-bottom: 5px; }
        </style>

        <div class="bkk-header">
            <h1 class="bkk-title">HOTEL VOUCHER</h1>
            <div class="bkk-subtitle">PLEASE PRESENT THIS VOUCHER UPON ARRIVAL.</div>
        </div>

        <div class="bkk-block-header">Hotel Information</div>
        <div class="bkk-hotel-name">Grande Centre Point Ratchadamri</div>
        <div class="bkk-info-row">
            <div class="bkk-label">Tel.</div>
            <div class="bkk-value">66-2-0919000</div>
        </div>
        <div class="bkk-info-row">
            <div class="bkk-label">Ads.</div>
            <div class="bkk-value">153/2 Mahatlek Luang 1, Ratchadamri Rd Lumpini, Pathumwan, Bangkok (and vicinity), Thailand</div>
        </div>

        <div class="bkk-block-header">Order Information</div>
        <div class="bkk-grid">
            <div class="bkk-grid-item">
                <div class="bkk-grid-label">Reference Number</div>
                <div class="bkk-grid-value">${data.refNum}</div>
            </div>
            <div class="bkk-grid-item">
                <div class="bkk-grid-label">Arrival Date</div>
                <div class="bkk-grid-value">${data.arrival}</div>
            </div>
            <div class="bkk-grid-item">
                <div class="bkk-grid-label">Departure Date</div>
                <div class="bkk-grid-value">${data.departure}</div>
            </div>
        </div>

        <table class="bkk-table">
            <thead>
                <tr>
                    <th style="width: 8%;">Unit</th>
                    <th style="width: 25%;">Room Type/Bed Type</th>
                    <th style="width: 35%;">Guests(First Name / Last Name)</th>
                    <th style="width: 17%;">Number</th>
                    <th style="width: 15%;">Meal Type</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="text-align: center;">${data.unit}</td>
                    <td>
                        <div style="font-weight: bold; margin-bottom: 4px;">${data.roomType}</div>
                        <div>${data.bedDetail}</div>
                    </td>
                    <td>${guestsHtml}</td>
                    <td>${data.paxString}</td>
                    <td>Room Only</td>
                </tr>
            </tbody>
        </table>

        <div class="bkk-footer">
            <div class="bkk-req-title">* Customer Requests</div>
            <div>The remarks for the establishment are for reference only. We cannot guarantee them.</div>
        </div>
    </div>
    `;
}

function getKULHtml(data) {
    const guestsHtml = data.guestNames.join('<br><br>');
    return `
    <div class="voucher-a4-sheet kul-style">
        <style>
            .kul-style { width: 794px; min-height: 1123px; padding: 40px; background: #fff; font-family: Arial, sans-serif; color: #000; box-sizing: border-box; }
            .kul-header { margin-bottom: 25px; }
            .kul-title { font-size: 26px; font-weight: bold; margin: 0; }
            .kul-subtitle { font-size: 14px; font-weight: bold; margin-top: 8px; }
            
            /* CHANGED: Increased margin-bottom from 15px to 25px for spacing */
            .kul-block-header { font-size: 16px; font-weight: bold; background-color: #f0f0f0; padding: 6px 10px; margin-top: 30px; margin-bottom: 25px; color: #333; }
            
            .kul-hotel-name { font-size: 16px; font-weight: bold; margin-bottom: 12px; }
            .kul-info-row { display: flex; font-size: 12px; margin-bottom: 6px; line-height: 1.4; }
            .kul-label { width: 50px; font-weight: bold; color: #444; }
            .kul-value { flex: 1; color: #000; }
            .kul-grid { display: flex; margin-top: 15px; justify-content: space-between; }
            .kul-grid-item { width: 32%; }
            .kul-grid-label { font-size: 12px; font-weight: bold; color: #333; margin-bottom: 5px; }
            .kul-grid-value { font-size: 13px; color: #000; }
            .kul-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
            .kul-table th { background-color: #f7f7f7; border: 1px solid #ddd; padding: 10px; text-align: left; font-weight: bold; color: #333; }
            .kul-table td { border: 1px solid #ddd; padding: 12px 10px; vertical-align: top; color: #000; }
            .kul-footer { margin-top: 25px; font-size: 12px; color: #000; }
            .kul-req-title { font-weight: bold; font-size: 13px; margin-bottom: 8px; }
            .kul-req-list { list-style: none; padding: 0; margin: 0; display: flex; gap: 30px; }
            .kul-req-list li { display: flex; align-items: center; }
            .kul-req-list li::before { content: "•"; margin-right: 8px; font-size: 1.2em; }
            .kul-disclaimer { margin-top: 10px; font-size: 12px; }
            .kul-reminder { margin-top: 25px; border-top: 1px solid #eee; padding-top: 15px; }
            .kul-rem-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; display: block; }
            .kul-rem-list { margin: 0; padding-left: 20px; font-size: 11px; line-height: 1.5; color: #333; }
            .kul-rem-list li { margin-bottom: 6px; }
        </style>

        <div class="kul-header">
            <h1 class="kul-title">HOTEL VOUCHER</h1>
            <div class="kul-subtitle">PLEASE PRESENT THIS VOUCHER UPON ARRIVAL.</div>
        </div>

        <div class="kul-block-header">Hotel Information</div>
        <div class="kul-hotel-name">THE FACE Style Hotel</div>
        <div class="kul-info-row">
            <div class="kul-label">Tel.</div>
            <div class="kul-value">60321681688</div>
        </div>
        <div class="kul-info-row">
            <div class="kul-label">Ads.</div>
            <div class="kul-value">1020 Jalan Sultan Ismail, Kuala Lumpur (and vicinity), Malaysia</div>
        </div>

        <div class="kul-block-header">Order Information</div>
        <div class="kul-grid">
            <div class="kul-grid-item">
                <div class="kul-grid-label">Reference Number</div>
                <div class="kul-grid-value">${data.refNum}</div>
            </div>
             <div class="kul-grid-item">
                <div class="kul-grid-label">Arrival Date</div>
                <div class="kul-grid-value">${data.arrival}</div>
            </div>
            <div class="kul-grid-item">
                <div class="kul-grid-label">Departure Date</div>
                <div class="kul-grid-value">${data.departure}</div>
            </div>
        </div>

        <table class="kul-table">
            <thead>
                <tr>
                    <th style="width: 8%;">Unit</th>
                    <th style="width: 25%;">Room Type/Bed Type</th>
                    <th style="width: 35%;">Guests(First Name / Last Name)</th>
                    <th style="width: 15%;">Number</th>
                    <th style="width: 17%;">Meal Type</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="text-align: center;">${data.unit}</td>
                    <td>
                        <div style="font-weight: bold; margin-bottom: 5px;">${data.roomType}</div>
                        <div>${data.bedDetail}</div>
                    </td>
                    <td>${guestsHtml}</td>
                    <td style="white-space: nowrap;">${data.paxString}</td>
                    <td>Room Only</td>
                </tr>
            </tbody>
        </table>

        <div class="kul-footer">
            <div class="kul-req-title">* Customer Requests</div>
            <ul class="kul-req-list">
                <li>Higher floor room</li>
                <li>Non smoking room</li>
                <li>${data.bedRequest}</li>
            </ul>
            <div class="kul-disclaimer">The remarks for the establishment are for reference only. We cannot guarantee them.</div>
        </div>

        <div class="kul-reminder">
            <span class="kul-rem-title">Reminder:</span>
            <ol class="kul-rem-list">
                <li>Upon your arrival please provide valid government-issued ID to the hotel front desk to locate the accurate booking.</li>
                <li>Please tell front desk agent your preferred bed type if your booking comes with more than one (e.g. Double or Twin). The final arrangement is fully subject to hotel's availability.</li>
                <li>All special requests are not guaranteed. Please confirm your special requests with front desk upon arrival.</li>
                <li>Check-in time starts at 15:00:00. Check-out time ends at 12:00:00. Please check-in before the latest check-in time.</li>
                <li>Please be noted that some hotels charge children extra breakfast fee even when your room offers breakfast. The actual situation is subject to the hotel regulations.</li>
                <li>Regular tax and fees are included in this stay. Additional charges (City tax, resort fees, etc.) may be charged directly by the hotel.</li>
                <li>Any other fees occured in the hotel such as additional service fees, violation fines will also be charged by the hotel directly.</li>
                <li>To make arrangements for check-in please contact the property at least 24 hours before arrival using the information on the booking confirmation.</li>
            </ol>
        </div>
    </div>
    `;
}
