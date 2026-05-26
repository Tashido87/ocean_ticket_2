/**
 * @fileoverview Manages the Hotel Booking Voucher generation service.
 * Supports specific layouts for Bangkok (BKK) and Kuala Lumpur (KUL).
 * NOW SUPPORTS: Child Detection (MSTR/MISS) & True PDF Generation.
 */

import { state } from './state.js';
import { showToast, formatDateToDMMMY, setButtonLoading, showServiceToast, hideServiceToast, addRecentActivity, renderRecentActivity, escapeHtml } from './utils.js';
import { addHotelReservation, updateHotelReservation, deleteHotelReservation } from './db.js';

/* =========================================
   HOTEL BOOKING VOUCHER MODULE
   ========================================= */

/**
 * Initializes the hotel service event listeners.
 */
export function initHotelService() {
    const generateBtn = document.getElementById('hotelGenerateBtn');
    const clearBtn = document.getElementById('clearHotelBtn');

    if (generateBtn) generateBtn.addEventListener('click', () => runHotelGeneration(generateBtn));
    if (clearBtn) clearBtn.addEventListener('click', clearHotelInputs);
    setupHotelGuestSourceToggle();
}

function setupHotelGuestSourceToggle() {
    const radios = document.querySelectorAll('input[name="hotel_guest_source"]');
    const update = () => {
        const source = document.querySelector('input[name="hotel_guest_source"]:checked')?.value || 'pnr';
        const manualFields = document.getElementById('hotelManualFields');
        const pnrGroup = document.getElementById('hotel-pnr-group');
        const pnrInput = document.getElementById('hotel-pnr');
        const isManual = source === 'manual';
        if (manualFields) manualFields.hidden = !isManual;
        if (pnrGroup) pnrGroup.hidden = isManual;
        if (pnrInput) pnrInput.required = !isManual;
    };

    radios.forEach(radio => {
        if (radio.dataset.hotelSourceBound === 'true') return;
        radio.addEventListener('change', update);
        radio.dataset.hotelSourceBound = 'true';
    });
    update();
}

async function runHotelGeneration(btn) {
    const format = document.querySelector('input[name="hotel_format"]:checked')?.value || 'pdf';

    setButtonLoading(btn, true);
    try {
        await generateVoucher(format);
        showServiceToast('hotelToast', 'Voucher generated successfully!', 'success');
        const city = document.getElementById('hotel-city').value;
        addRecentActivity('hotel', `Hotel Voucher — ${city}`, format.toUpperCase());
    } catch (err) {
        console.error(err);
        showServiceToast('hotelToast', 'Failed to generate voucher.', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

/**
 * Clears all input fields in the hotel booking form.
 */
function clearHotelInputs() {
    document.getElementById('hotel-city').value = 'BKK';
    document.getElementById('hotel-pnr').value = '';
    document.getElementById('hotel_guest_source_pnr').checked = true;
    document.getElementById('hotel-manual-name').value = '';
    document.getElementById('hotel-manual-total').value = '1';
    document.getElementById('hotel-manual-adults').value = '1';
    document.getElementById('hotel-manual-children').value = '0';
    document.getElementById('hotel-arrival').value = '';
    document.getElementById('hotel-departure').value = '';
    document.getElementById('hotel-bed-qty').value = '1';
    document.getElementById('hotel-bed-type').value = 'Double';
    document.getElementById('hotel-extra-bed').checked = false;
    setupHotelGuestSourceToggle();
    hideServiceToast('hotelToast');
}

function readPositiveInt(id, fallback = 0) {
    const value = parseInt(document.getElementById(id)?.value || '', 10);
    return Number.isFinite(value) ? value : fallback;
}

function buildManualGuests() {
    const clientName = (document.getElementById('hotel-manual-name')?.value || '').trim().toUpperCase();
    const total = readPositiveInt('hotel-manual-total', 0);
    const adults = readPositiveInt('hotel-manual-adults', 0);
    const children = readPositiveInt('hotel-manual-children', 0);

    if (!clientName) {
        showToast('Please fill the manual client name.', 'error');
        return null;
    }
    if (total < 1) {
        showToast('Number of clients must be at least 1.', 'error');
        return null;
    }
    if (adults < 0 || children < 0 || adults + children < 1) {
        showToast('Please fill adult/child counts.', 'error');
        return null;
    }
    if (adults + children !== total) {
        showToast('Adult + child count must match number of clients.', 'error');
        return null;
    }

    const guestNames = [clientName];
    let paxString = `${adults} Adult(s)`;
    if (children > 0) paxString += `, ${children} Child(ren)`;

    return { guestNames, adultCount: adults, childCount: children, paxString };
}

function buildPnrGuests(pnrInput) {
    const pnrs = pnrInput.split(/[,\s]+/).filter(p => p.trim());
    const guestNames = [];
    let adultCount = 0;
    let childCount = 0;

    pnrs.forEach(pnr => {
        const tickets = state.allTickets.filter(t =>
            (t.booking_reference || '').toUpperCase() === pnr.toUpperCase()
        );
        tickets.forEach(t => {
            let rawName = (t.name || '').toUpperCase();

            // Filter out entries that are fees/adjustments
            if (rawName.includes('(FEES)')) return;

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
            const formattedName = rawName + (isChild ? "(Child)" : "(Adult)");

            if (!guestNames.includes(formattedName)) {
                guestNames.push(formattedName);
                if (isChild) childCount++; else adultCount++;
            }
        });
    });

    return { guestNames, adultCount, childCount };
}

function buildPaxString(adultCount, childCount) {
    let paxString = `${adultCount} Adult(s)`;
    if (childCount > 0) paxString += `, ${childCount} Child(ren)`;
    return paxString;
}

/**
 * Main logic to generate the voucher data and render it.
 * @param {string} format 'pdf' or 'png'
 */
async function generateVoucher(format) {
    // 1. Collect Inputs
    const city = document.getElementById('hotel-city').value; // BKK or KUL
    const guestSource = document.querySelector('input[name="hotel_guest_source"]:checked')?.value || 'pnr';
    const pnrInput = document.getElementById('hotel-pnr').value.trim();
    const arrivalDateStr = document.getElementById('hotel-arrival').value;
    const departureDateStr = document.getElementById('hotel-departure').value;
    const bedQty = document.getElementById('hotel-bed-qty').value;
    const bedType = document.getElementById('hotel-bed-type').value; // Double or Twin
    const hasExtraBed = document.getElementById('hotel-extra-bed').checked;

    // 2. Validation
    if ((guestSource === 'pnr' && !pnrInput) || !arrivalDateStr || !departureDateStr) {
        showToast(guestSource === 'pnr' ? 'Please fill in PNR and dates.' : 'Please fill in dates.', 'error');
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

    // 4. Fetch Client Names from PNR(s), or use manual client/count fields.
    const guestData = guestSource === 'manual' ? buildManualGuests() : buildPnrGuests(pnrInput);
    if (!guestData) return;

    let { guestNames, adultCount, childCount } = guestData;

    // Fallback if PNR not found (for manual testing)
    if (guestSource === 'pnr' && guestNames.length === 0) {
        showToast(`Warning: No passengers found for PNR ${pnrInput}. Using placeholder.`, 'info');
        guestNames = ["GUEST / NAME(Adult)"];
        adultCount = 1;
        childCount = 0;
    }

    // Generate Pax String (e.g., "2 Adult(s), 1 Child(ren)")
    const paxString = guestData.paxString || buildPaxString(adultCount, childCount);

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

/* ==========================================================
   HOTEL RESERVATION SYSTEM (DATABASE BACKED)
   ========================================================== */

/**
 * Initializes the hotel reservation system event listeners.
 */
export function initHotelReservationSystem() {
    // Buttons
    const newBtn = document.getElementById('newHotelResBtn');
    const cancelBtn = document.getElementById('cancelHotelResBtn');
    const form = document.getElementById('newHotelResForm');
    const searchBtn = document.getElementById('hotelResSearchBtn');
    const clearBtn = document.getElementById('hotelResClearBtn');
    const searchInput = document.getElementById('hotelResSearchText');
    const statusFilter = document.getElementById('hotelResStatusFilter');

    if (newBtn) newBtn.addEventListener('click', showNewHotelReservationForm);
    if (cancelBtn) cancelBtn.addEventListener('click', hideHotelReservationForm);
    
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveHotelReservation();
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            state.hotelPage = 1;
            renderHotelReservations();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (statusFilter) statusFilter.value = 'all';
            state.hotelPage = 1;
            renderHotelReservations();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                state.hotelPage = 1;
                renderHotelReservations();
            }
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            state.hotelPage = 1;
            renderHotelReservations();
        });
    }

    // Auto-calculate commission (Commission = Base Fare - Net Amount)
    const baseInput = document.getElementById('hotel_res_base_fare');
    const netInput = document.getElementById('hotel_res_net_amount');
    const commInput = document.getElementById('hotel_res_commission');

    if (baseInput && netInput && commInput) {
        const autoCalc = () => {
            const base = parseFloat(baseInput.value) || 0;
            const net = parseFloat(netInput.value) || 0;
            const sourceVal = document.querySelector('input[name="hotel_res_source"]:checked')?.value || 'owner';
            
            let calc = Math.max(0, net - base);
            if (sourceVal === 'owner') {
                calc = calc * 0.60;
            }
            commInput.value = calc;
        };
        baseInput.addEventListener('input', autoCalc);
        netInput.addEventListener('input', autoCalc);
        
        const sourceRadios = document.querySelectorAll('input[name="hotel_res_source"]');
        sourceRadios.forEach(r => r.addEventListener('change', autoCalc));
    }

    // Initialize Datepickers
    if (window.Datepicker) {
        const bookingDateEl = document.getElementById('hotel_res_booking_date');
        const checkinEl = document.getElementById('hotel_res_checkin');
        const checkoutEl = document.getElementById('hotel_res_checkout');
        const payDateEl = document.getElementById('hotel_res_payment_date');

        const opt = { format: 'dd/mm/yyyy', autohide: true, todayHighlight: true };
        if (bookingDateEl) new window.Datepicker(bookingDateEl, opt);
        if (checkinEl) new window.Datepicker(checkinEl, opt);
        if (checkoutEl) new window.Datepicker(checkoutEl, opt);
        if (payDateEl) new window.Datepicker(payDateEl, opt);
    }

    // Set up suggestions dropdown
    setupHotelSuggestions();
}

/**
 * Handles showing the New Hotel Reservation form.
 */
export function showNewHotelReservationForm() {
    const form = document.getElementById('newHotelResForm');
    const title = document.getElementById('hotelFormTitle');
    const formContainer = document.getElementById('hotel-form-container');
    const listContainer = document.getElementById('hotel-display-container');

    if (form) {
        form.reset();
        document.getElementById('hotel_res_id').value = '';
    }
    if (title) title.textContent = 'New Hotel Reservation';

    // Set default check-in (today) and check-out (tomorrow)
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const bookingDateEl = document.getElementById('hotel_res_booking_date');
    const checkinEl = document.getElementById('hotel_res_checkin');
    const checkoutEl = document.getElementById('hotel_res_checkout');

    if (bookingDateEl) bookingDateEl.value = formatDMY(today);
    if (checkinEl) checkinEl.value = formatDMY(today);
    if (checkoutEl) checkoutEl.value = formatDMY(tomorrow);

    if (listContainer) listContainer.style.display = 'none';
    if (formContainer) {
        formContainer.style.display = 'block';
        document.getElementById('hotel_res_client_name')?.focus();
    }
}

/**
 * Hides the reservation form and returns to list view.
 */
export function hideHotelReservationForm() {
    const formContainer = document.getElementById('hotel-form-container');
    const listContainer = document.getElementById('hotel-display-container');
    if (formContainer) formContainer.style.display = 'none';
    if (listContainer) listContainer.style.display = 'block';
}

/**
 * Sets up hotel name autocomplete suggestions and autofill country & city.
 */
function setupHotelSuggestions() {
    const input = document.getElementById('hotel_res_hotel_name');
    const box = document.getElementById('hotel_res_name_autosuggest');
    if (!input || !box) return;

    const render = () => {
        const query = input.value.trim().toLowerCase();
        if (!query) {
            box.hidden = true;
            return;
        }

        // Collect unique hotels from list of all reservations
        const uniqueHotels = [];
        const seen = new Set();
        state.allHotels.forEach(h => {
            const name = (h.hotel_name || '').trim();
            const key = name.toLowerCase();
            if (name && !seen.has(key)) {
                seen.add(key);
                uniqueHotels.push({
                    name: name,
                    country: h.country || '',
                    city: h.city || ''
                });
            }
        });

        const matches = uniqueHotels.filter(h => h.name.toLowerCase().includes(query));
        if (matches.length === 0) {
            box.hidden = true;
            return;
        }

        box.innerHTML = matches.map(h => `
            <div class="autosuggest-item" data-hotel-name="${escapeHtml(h.name)}" data-hotel-country="${escapeHtml(h.country)}" data-hotel-city="${escapeHtml(h.city)}" style="padding: 10px 15px; cursor: pointer;">
                <div style="font-weight: 600; font-size: 0.9rem;"><i class="fa-solid fa-hotel" style="color: #0d9488; margin-right: 5px;"></i> ${escapeHtml(h.name)}</div>
                <div style="font-size: 0.75rem; color: #666; margin-top: 2px;">${escapeHtml(h.city)}, ${escapeHtml(h.country)}</div>
            </div>
        `).join('');
        box.hidden = false;
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', render);

    // Close box on click outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !box.contains(e.target)) {
            box.hidden = true;
        }
    });

    box.addEventListener('click', (e) => {
        const item = e.target.closest('.autosuggest-item');
        if (item) {
            input.value = item.dataset.hotelName;
            document.getElementById('hotel_res_country').value = item.dataset.hotelCountry;
            document.getElementById('hotel_res_city').value = item.dataset.hotelCity;
            box.hidden = true;
            showToast(`Auto-filled details for ${item.dataset.hotelName}.`, 'info');
        }
    });
}

/**
 * Saves a hotel reservation to Firestore.
 */
async function saveHotelReservation() {
    if (state.isSubmitting) return;
    state.isSubmitting = true;

    const saveBtn = document.getElementById('saveHotelResBtn');
    setButtonLoading(saveBtn, true);

    try {
        const id = document.getElementById('hotel_res_id').value;
        const sourceVal = document.querySelector('input[name="hotel_res_source"]:checked')?.value || 'owner';
        const data = {
            client_name: document.getElementById('hotel_res_client_name').value.trim(),
            other_names: document.getElementById('hotel_res_other_names').value.trim(),
            hotel_name: document.getElementById('hotel_res_hotel_name').value.trim(),
            country: document.getElementById('hotel_res_country').value.trim(),
            city: document.getElementById('hotel_res_city').value.trim(),
            booking_date: document.getElementById('hotel_res_booking_date').value,
            checkin: document.getElementById('hotel_res_checkin').value,
            checkout: document.getElementById('hotel_res_checkout').value,
            booking_ref: document.getElementById('hotel_res_booking_ref').value.trim(),
            supplier: document.getElementById('hotel_res_supplier').value.trim(),
            base_fare: parseFloat(document.getElementById('hotel_res_base_fare').value) || 0,
            net_amount: parseFloat(document.getElementById('hotel_res_net_amount').value) || 0,
            commission: parseFloat(document.getElementById('hotel_res_commission').value) || 0,
            paid: document.getElementById('hotel_res_paid').value,
            payment_date: document.getElementById('hotel_res_payment_date').value,
            payment_method: document.getElementById('hotel_res_payment_method').value || '',
            notes: document.getElementById('hotel_res_notes').value.trim(),
            source: sourceVal
        };

        if (id) {
            await updateHotelReservation(id, data);
            showToast('Hotel reservation updated successfully.', 'success');
        } else {
            await addHotelReservation(data);
            showToast('Hotel reservation saved successfully.', 'success');
        }

        hideHotelReservationForm();
    } catch (error) {
        console.error(error);
        showToast('Failed to save hotel reservation.', 'error');
    } finally {
        state.isSubmitting = false;
        setButtonLoading(saveBtn, false);
    }
}

/**
 * Loads a reservation and populates the edit form.
 * @param {string} id The document ID.
 */
export function editHotelReservation(id) {
    const res = state.allHotels.find(h => h.id === id);
    if (!res) {
        showToast('Could not find reservation details.', 'error');
        return;
    }

    const title = document.getElementById('hotelFormTitle');
    const formContainer = document.getElementById('hotel-form-container');
    const listContainer = document.getElementById('hotel-display-container');

    if (title) title.textContent = 'Edit Hotel Reservation';
    
    document.getElementById('hotel_res_id').value = id;
    
    const isSelf = res.source === 'self';
    const ownerToggle = document.getElementById('hotel_source_owner');
    const selfToggle = document.getElementById('hotel_source_self');
    if (ownerToggle && selfToggle) {
        ownerToggle.checked = !isSelf;
        selfToggle.checked = isSelf;
        // Trigger change event to update any UI listeners
        (isSelf ? selfToggle : ownerToggle).dispatchEvent(new Event('change'));
    }

    document.getElementById('hotel_res_client_name').value = res.client_name || '';
    document.getElementById('hotel_res_other_names').value = res.other_names || '';
    document.getElementById('hotel_res_hotel_name').value = res.hotel_name || '';
    document.getElementById('hotel_res_country').value = res.country || '';
    document.getElementById('hotel_res_city').value = res.city || '';
    document.getElementById('hotel_res_booking_date').value = res.booking_date || '';
    document.getElementById('hotel_res_checkin').value = res.checkin || '';
    document.getElementById('hotel_res_checkout').value = res.checkout || '';
    document.getElementById('hotel_res_booking_ref').value = res.booking_ref || '';
    document.getElementById('hotel_res_supplier').value = res.supplier || '';
    document.getElementById('hotel_res_base_fare').value = res.base_fare || 0;
    document.getElementById('hotel_res_net_amount').value = res.net_amount || 0;
    document.getElementById('hotel_res_commission').value = res.commission || 0;
    document.getElementById('hotel_res_paid').value = res.paid || 'unpaid';
    document.getElementById('hotel_res_payment_date').value = res.payment_date || '';
    document.getElementById('hotel_res_payment_method').value = res.payment_method || '';
    document.getElementById('hotel_res_notes').value = res.notes || '';

    if (listContainer) listContainer.style.display = 'none';
    if (formContainer) formContainer.style.display = 'block';
}

/**
 * Deletes a reservation from the database.
 * @param {string} id The document ID.
 */
export async function deleteHotelReservationAction(id) {
    if (!confirm('Are you sure you want to delete this hotel reservation? This action cannot be undone.')) return;
    try {
        await deleteHotelReservation(id);
        showToast('Hotel reservation deleted successfully.', 'success');
    } catch (error) {
        console.error(error);
        showToast('Failed to delete reservation.', 'error');
    }
}

/**
 * Handles showing the detailed modal for a specific hotel reservation.
 * @param {string} id The document ID.
 */
export async function showHotelDetailsAction(id) {
    const res = state.allHotels.find(h => h.id === id);
    if (!res) {
        showToast('Could not find reservation details.', 'error');
        return;
    }
    const { showHotelDetails } = await import('./tickets.js');
    showHotelDetails(res);
}

/**
 * Renders the hotel reservations list and KPI summary cards.
 */
export function renderHotelReservations() {
    const tbody = document.getElementById('hotelResTableContainer');
    const kpisGrid = document.getElementById('hotelKpiGrid');
    const pagination = document.getElementById('hotelResPagination');
    if (!tbody) return;

    const searchInput = document.getElementById('hotelResSearchText')?.value.trim().toLowerCase() || '';
    const statusFilter = document.getElementById('hotelResStatusFilter')?.value || 'all';

    // 1. Filter Reservations
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filtered = state.allHotels.filter(res => {
        // Search filter
        const matchesSearch = 
            (res.client_name || '').toLowerCase().includes(searchInput) ||
            (res.other_names || '').toLowerCase().includes(searchInput) ||
            (res.hotel_name || '').toLowerCase().includes(searchInput) ||
            (res.city || '').toLowerCase().includes(searchInput) ||
            (res.country || '').toLowerCase().includes(searchInput) ||
            (res.booking_ref || '').toLowerCase().includes(searchInput) ||
            (res.supplier || '').toLowerCase().includes(searchInput);

        if (!matchesSearch) return false;

        // Status filter
        if (statusFilter === 'all') return true;
        if (statusFilter === 'paid') return res.paid === 'paid';
        if (statusFilter === 'unpaid') return res.paid === 'unpaid';
        if (statusFilter === 'partial') return res.paid === 'partial';
        if (statusFilter === 'active') {
            const checkin = parseDMY(res.checkin);
            const checkout = parseDMY(res.checkout);
            if (checkin && checkout) {
                checkin.setHours(0, 0, 0, 0);
                checkout.setHours(0, 0, 0, 0);
                return today >= checkin && today <= checkout;
            }
            return false;
        }
        return true;
    });

    state.filteredHotels = filtered;

    // 2. Render KPIs
    let totalBookings = filtered.length;
    let unpaidStays = filtered.filter(res => res.paid !== 'paid').length;
    let activeStaysCount = filtered.filter(res => {
        const checkin = parseDMY(res.checkin);
        const checkout = parseDMY(res.checkout);
        if (checkin && checkout) {
            checkin.setHours(0, 0, 0, 0);
            checkout.setHours(0, 0, 0, 0);
            return today >= checkin && today <= checkout;
        }
        return false;
    }).length;
    let totalComm = filtered.reduce((sum, res) => sum + (parseFloat(res.commission) || 0), 0);

    if (kpisGrid) {
        kpisGrid.innerHTML = `
            <div class="kpi-card">
                <div class="kpi-icon kpi-teal"><i class="fa-solid fa-list-check"></i></div>
                <div class="kpi-body">
                    <div class="kpi-label">Total Reservations</div>
                    <div class="kpi-value">${totalBookings}</div>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon kpi-coral"><i class="fa-solid fa-hourglass-half"></i></div>
                <div class="kpi-body">
                    <div class="kpi-label">Unpaid Stays</div>
                    <div class="kpi-value">${unpaidStays}</div>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon kpi-amber"><i class="fa-solid fa-clock"></i></div>
                <div class="kpi-body">
                    <div class="kpi-label">Active Stays</div>
                    <div class="kpi-value">${activeStaysCount}</div>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon kpi-green"><i class="fa-solid fa-coins"></i></div>
                <div class="kpi-body">
                    <div class="kpi-label">Total Commission</div>
                    <div class="kpi-value" style="font-size: 1.45rem;">${totalComm.toLocaleString()} MMK</div>
                </div>
            </div>
        `;
    }

    // 3. Render Table
    const totalPages = Math.ceil(filtered.length / state.rowsPerPage) || 1;
    if (state.hotelPage > totalPages) state.hotelPage = totalPages;

    const start = (state.hotelPage - 1) * state.rowsPerPage;
    const end = start + state.rowsPerPage;
    const paginated = filtered.slice(start, end);

    let rowsHtml = '';
    if (paginated.length === 0) {
        rowsHtml = `
            <tr>
                <td colspan="8" class="empty-row" style="text-align: center; padding: 2rem;">No hotel reservations found.</td>
            </tr>
        `;
    } else {
        paginated.forEach(res => {
            const bookingDateHtml = `
                <div style="font-weight: 600; color: var(--ink);">${formatNiceDate(res.booking_date || res.checkin)}</div>
            `;
            const guestCell = `
                <div style="font-weight: 700; color: var(--ink);">${escapeHtml(res.client_name)}</div>
                ${res.other_names ? `<div style="font-size: 0.76rem; color: var(--muted); margin-top: 2px;">${!isNaN(parseInt(res.other_names, 10)) ? `Total Guests (incl. Lead): ${escapeHtml(res.other_names)}` : `Guests: ${escapeHtml(res.other_names)}`}</div>` : ''}
            `;
            const hotelCell = `
                <div style="font-weight: 700; color: var(--ink);"><i class="fa-solid fa-hotel" style="color: #0d9488; margin-right: 4px; font-size: 0.8rem;"></i> ${escapeHtml(res.hotel_name)}</div>
                <div style="font-size: 0.76rem; color: var(--muted); margin-top: 2px;">${escapeHtml(res.city)}, ${escapeHtml(res.country)}</div>
            `;
            const dateCell = `
                <div style="font-weight: 600;">${formatNiceDate(res.checkin)}</div>
                <div style="font-size: 0.72rem; color: var(--muted); font-weight: 500; margin: 2px 0;">to</div>
                <div style="font-weight: 600;">${formatNiceDate(res.checkout)}</div>
            `;
            const costCell = `
                <div style="font-size: 0.78rem; color: var(--text-secondary);">Base: <strong>${(res.base_fare || 0).toLocaleString()}</strong></div>
                <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">Net: <strong>${(res.net_amount || 0).toLocaleString()}</strong></div>
            `;
            const statusBadge = `
                <span class="payment-badge payment-${res.paid}">${res.paid === 'paid' ? 'Paid' : res.paid === 'partial' ? 'Partial' : 'Unpaid'}</span>
                ${res.payment_method ? `<div style="font-size: 0.72rem; color: var(--muted); margin-top: 4px; font-weight: 600;">${escapeHtml(res.payment_method)}</div>` : ''}
            `;

            rowsHtml += `
                <tr data-id="${res.id}">
                    <td style="padding: 1rem 0.75rem; vertical-align: top;">${bookingDateHtml}</td>
                    <td style="padding: 1rem 0.75rem; vertical-align: top;">${guestCell}</td>
                    <td style="padding: 1rem 0.75rem; vertical-align: top;">${hotelCell}</td>
                    <td style="padding: 1rem 0.75rem; vertical-align: top; text-align: center;">${dateCell}</td>
                    <td style="padding: 1rem 0.75rem; vertical-align: top;">${costCell}</td>
                    <td style="padding: 1rem 0.75rem; vertical-align: top; font-weight: 700; color: #0d9488; text-align: right;">${(res.commission || 0).toLocaleString()} MMK</td>
                    <td style="padding: 1rem 0.75rem; vertical-align: top; text-align: center;">${statusBadge}</td>
                    <td style="padding: 1rem 0.75rem; vertical-align: top; text-align: center;" class="search-row-actions">
                        <div style="display: flex; gap: 0.25rem; justify-content: center;">
                            <button class="icon-btn" title="View Details" onclick="window.showHotelDetailsAction('${res.id}')"><i class="fa-solid fa-eye"></i></button>
                            <button class="icon-btn" title="Edit Reservation" onclick="window.editHotelReservation('${res.id}')"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button class="icon-btn btn-danger" title="Delete" onclick="window.deleteHotelReservationAction('${res.id}')"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });
    }

    tbody.innerHTML = `
        <table class="sell-table" style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="width: 12%; text-align: left;">Booking Date</th>
                    <th style="width: 18%; text-align: left;">Guest</th>
                    <th style="width: 23%; text-align: left;">Hotel</th>
                    <th style="width: 12%; text-align: center;">Stay Dates</th>
                    <th style="width: 13%; text-align: left;">Cost Breakdown</th>
                    <th style="width: 11%; text-align: right;">Commission</th>
                    <th style="width: 6%; text-align: center;">Payment</th>
                    <th style="width: 5%; text-align: center;">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;

    // 4. Render Pagination
    let pagHtml = '';
    if (totalPages > 1) {
        pagHtml += `<button class="btn-page" ${state.hotelPage === 1 ? 'disabled' : ''} onclick="window.setHotelPage(${state.hotelPage - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;
        for (let i = 1; i <= totalPages; i++) {
            pagHtml += `<button class="btn-page ${state.hotelPage === i ? 'active' : ''}" onclick="window.setHotelPage(${i})">${i}</button>`;
        }
        pagHtml += `<button class="btn-page" ${state.hotelPage === totalPages ? 'disabled' : ''} onclick="window.setHotelPage(${state.hotelPage + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;
    }
    if (pagination) pagination.innerHTML = pagHtml;
}

// Helpers

function parseDMY(str) {
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    return new Date(year, month, day);
}

function formatDMY(date) {
    if (!date) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function formatNiceDate(str) {
    const d = parseDMY(str);
    if (!d || isNaN(d)) return str || '—';
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Attach functions to window for onclick handlers
window.editHotelReservation = editHotelReservation;
window.deleteHotelReservationAction = deleteHotelReservationAction;
window.showHotelDetailsAction = showHotelDetailsAction;
window.setHotelPage = (page) => {
    state.hotelPage = page;
    renderHotelReservations();
};

