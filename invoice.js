/**
 * @fileoverview Handles the generation of professional Invoices/Receipts.
 * Includes robust logic for grouping tickets, analyzing scenarios (Shared Itineraries), and PDF/Image generation.
 */

import { formatDateToDMMMY, showToast } from './utils.js';
import { state } from './state.js';

// --- COMPANY CONFIGURATION ---
const COMPANY = {
    name: "Ocean Ticket",
    address: "A3-1, Room 603, Myanma Gone Yi Housing,\nUpper Pansodan Street, Mingalar Taungnyunt Township, Yangon.",
    phones: ["09964403435", "09740862500"],
    email: "oceanmobile.bmo@gmail.com",
    logoUrl: "./logo.png" 
};

// --- BANK INFORMATION ---
const BANK_ACCOUNTS = [
    { bank: "KBZ Pay", account: "09740862500", name: "Aung Pyae Sone" },
    { bank: "KBZ Special Account", account: "02051102000725501", name: "Aung Pyae Sone" },
    { bank: "KBZ Normal Account", account: "18230199926109801", name: "Aung Pyae Sone" },
    { bank: "AYA Pay", account: "09740862500", name: "Aung Pyae Sone" },
    { bank: "AYA Banking", account: "40039173610", name: "Aung Pyae Sone" },
    { bank: "CB Mobile Banking", account: "0042-6005-0001-2432", name: "Aung Pyae Sone" }
];

/**
 * Loads an image from a URL and returns an HTMLImageElement or Data URL.
 */
const loadImage = (url) => {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = url;
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
            console.warn(`Failed to load logo from ${url}`);
            resolve(null);
        };
    });
};

/**
 * Dynamically loads html2canvas library if not already present.
 */
const loadHtml2Canvas = () => {
    return new Promise((resolve, reject) => {
        if (window.html2canvas) return resolve(window.html2canvas);
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => resolve(window.html2canvas);
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

/**
 * Returns the CSS styles for the HTML invoice.
 */
function getInvoiceCSS() {
    return `
        .invoice-container {
            width: 794px;
            min-height: 1123px;
            padding: 56px;
            background: #fff;
            color: #282828;
            font-family: 'Helvetica', 'Arial', sans-serif;
            position: relative;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
        }
        .inv-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
            padding-bottom: 20px;
            border-bottom: 1px solid #e6e6e6;
        }
        .inv-company { flex: 1; }
        .inv-company h1 {
            font-size: 29px; color: #f97316; margin: 0 0 10px 0;
            text-transform: uppercase; font-weight: bold; line-height: 1;
        }
        .inv-company p {
            margin: 4px 0; font-size: 12px; color: #646464; line-height: 1.4;
        }
        .inv-logo-sec {
            text-align: right; display: flex; flex-direction: column;
            align-items: flex-end; margin-left: 20px;
        }
        .inv-logo-sec img { width: 130px; height: auto; margin-bottom: 10px; }
        .inv-type {
            font-size: 26px; font-weight: bold; color: #c8c8c8; text-transform: uppercase;
        }
        .inv-meta-grid {
            display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 20px; margin-bottom: 30px;
        }
        .inv-section-title {
            font-size: 13px; color: #282828; font-weight: bold; margin: 0 0 8px 0; text-transform: uppercase;
        }
        .inv-client-name {
            font-size: 15px; font-weight: normal; color: #282828; margin: 0 0 4px 0;
        }
        .inv-sub { font-size: 12px; color: #646464; margin: 0; }
        .inv-details-row {
            display: flex; justify-content: space-between; font-size: 12px; color: #646464; margin-bottom: 6px;
        }
        .inv-details-val { text-align: right; }
        .inv-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        .inv-table th {
            background: #f5f5f5; padding: 8px 6px; text-align: left; font-size: 12px;
            font-weight: bold; color: #282828; border-bottom: 1px solid #dcdcdc;
        }
        .inv-table td {
            padding: 8px 6px; font-size: 12px; color: #282828;
            border-bottom: 1px solid #f0f0f0; vertical-align: middle;
        }
        .col-num { width: 8%; text-align: center; }
        .col-desc { width: 45%; }
        .col-qty { width: 10%; text-align: center; }
        .col-rate { width: 18%; text-align: right; }
        .col-amt { width: 19%; text-align: right; font-weight: bold; }
        .inv-total-sec {
            display: flex; justify-content: flex-end; margin-top: 10px; padding-top: 10px; border-top: 2px solid #e6e6e6;
        }
        .inv-total-row {
            display: flex; justify-content: space-between; width: 250px;
            font-size: 16px; font-weight: bold; color: #f97316;
        }
        .inv-footer { margin-top: auto; padding-top: 30px; }
        .inv-footer-line { border-top: 2px solid #f97316; margin-bottom: 15px; width: 40px; }
        .inv-footer h4 { font-size: 13px; margin: 0 0 10px 0; color: #282828; text-transform: uppercase; }
        .inv-banks { display: grid; grid-template-columns: 1fr 1fr; gap: 15px 40px; }
        .inv-bank-item { font-size: 11px; line-height: 1.4; }
        .inv-bank-item strong { display: block; color: #282828; font-weight: bold; }
        .inv-bank-item span { color: #646464; }
        .inv-thankyou { text-align: center; font-size: 11px; color: #999; margin-top: 30px; }
    `;
}

/**
 * Normalizes client names for comparison.
 * Removes titles (MR, MS, etc), suffixes, and extra spaces.
 */
function normalizeClientName(name) {
    if (!name) return '';
    return name.toUpperCase()
        .replace(/\s+(MR|MRS|MS|MISS|MSTR)$/, '') // Remove title at end
        .replace(/\s*\(.*?\)\s*/g, '') // Remove (Adult), (Child), (Fees)
        .replace(/[^A-Z0-9]/g, '') // Remove non-alphanumeric (like / or -) to compare raw letters
        .trim();
}

/**
 * Creates a unique signature for a route to compare itineraries.
 * Format: "DEP-DEST|YYYY-MM-DD"
 */
function getRouteSignature(ticket) {
    const dep = (ticket.departure || '').split(' ')[0].trim().toUpperCase();
    const dest = (ticket.destination || '').split(' ')[0].trim().toUpperCase();
    const date = ticket.departing_on ? formatDateToDMMMY(ticket.departing_on) : '';
    // Note: Price is NOT part of the route signature for grouping check
    return `${dep}-${dest}|${date}`;
}

/**
 * Analyzes the input PNRs to determine the scenario.
 * Updated to detect "Shared Itinerary Sets" rather than just single route.
 * @param {string[]} pnrList Array of PNR strings.
 * @returns {Object} { code, type, canChoose, message? }
 */
export function analyzeInvoiceScenario(pnrList) {
    if (!pnrList || pnrList.length === 0) return { type: 'ERROR', message: 'No PNRs provided.' };

    const cleanPnrs = pnrList.map(p => p.trim().toUpperCase()).filter(p => p);
    const tickets = state.allTickets.filter(t => cleanPnrs.includes(t.booking_reference));

    if (tickets.length === 0) return { type: 'ERROR', message: 'No matching tickets found.' };

    // --- 1. Identify Unique Attributes ---
    const uniquePnrs = [...new Set(tickets.map(t => t.booking_reference))];
    const uniqueClients = [...new Set(tickets.map(t => normalizeClientName(t.name)))];

    // --- 2. Check for Shared Itinerary Set ---
    // Group all route signatures by client
    const clientRouteSets = {};
    tickets.forEach(t => {
        const name = normalizeClientName(t.name);
        const sig = getRouteSignature(t);
        if (!clientRouteSets[name]) clientRouteSets[name] = new Set();
        clientRouteSets[name].add(sig);
    });

    // Verify if all clients have the exact same set of routes
    const clientNamesArr = Object.keys(clientRouteSets);
    let isSharedItinerary = true;
    
    if (clientNamesArr.length > 1) {
        // Create a sorted string representation of the first client's routes
        const firstSetSig = Array.from(clientRouteSets[clientNamesArr[0]]).sort().join('||');
        
        // Compare with every other client
        for (let i = 1; i < clientNamesArr.length; i++) {
            const thisSetSig = Array.from(clientRouteSets[clientNamesArr[i]]).sort().join('||');
            if (thisSetSig !== firstSetSig) {
                isSharedItinerary = false;
                break;
            }
        }
    }

    console.log(`Invoice Analysis: PNRs=${uniquePnrs.length}, Clients=${uniqueClients.length}, SharedItinerary=${isSharedItinerary}`);

    // --- 3. Evaluate Scenarios ---

    // SCENARIO 1: Single PNR, Multiple Clients
    if (uniquePnrs.length === 1) {
        if (uniqueClients.length > 1) {
            if (isSharedItinerary) {
                // Same PNR, Multiple Pax, Everyone flies same legs -> CHOICE
                return { code: 'SCENARIO_1', type: 'CHOICE', canChoose: true };
            } else {
                // Same PNR, Multiple Pax, but different legs? (Rare/Split) -> Force Combined safely
                return { code: 'SCENARIO_1_MIXED', type: 'COMBINED', canChoose: false };
            }
        } else {
            // Single PNR, Single Client -> Standard Combined
            return { code: 'STANDARD', type: 'COMBINED', canChoose: false };
        }
    }

    // SCENARIO 2: Multi PNR, Single Client -> Force Combined
    if (uniquePnrs.length > 1 && uniqueClients.length === 1) {
        return { code: 'SCENARIO_2', type: 'COMBINED', canChoose: false };
    }

    // SCENARIO 3 & 4: Multi PNR, Multi Client
    if (uniquePnrs.length > 1 && uniqueClients.length > 1) {
        if (isSharedItinerary) {
            // "same route with same date" (Shared Set) -> Combined
            return { code: 'SCENARIO_3', type: 'COMBINED', canChoose: false };
        } else {
            // "different route or different date" -> Error
            return { 
                code: 'SCENARIO_4', 
                type: 'ERROR', 
                message: 'Cannot generate: Multiple PNRs and Clients have different routes or dates. Please generate separately.' 
            };
        }
    }

    // Default Fallback
    return { code: 'DEFAULT', type: 'COMBINED', canChoose: false };
}


/**
 * Generates a PDF invoice/receipt based on the scenario mode.
 */
export async function generateInvoice(pnrList, type = 'Invoice', dateStr = null, forcedMode = 'auto') {
    const cleanPnrs = pnrList.map(p => p.trim().toUpperCase()).filter(p => p);
    const tickets = state.allTickets.filter(t => cleanPnrs.includes(t.booking_reference));

    if (tickets.length === 0) {
        showToast('No tickets found.', 'error');
        return;
    }

    // --- Determine Mode ---
    let mode = forcedMode;
    if (mode === 'auto') {
        const scenario = analyzeInvoiceScenario(pnrList);
        if (scenario.type === 'ERROR') {
            showToast(scenario.message, 'error');
            return;
        }
        if (scenario.canChoose) mode = 'separate'; 
        else mode = 'combined';
    }

    // --- Data Preparation ---
    let invoiceGroups = [];

    if (mode === 'separate') {
        // Group by Client Name (One invoice per client)
        const ticketsByName = {};
        tickets.forEach(t => {
            const key = t.name.trim(); // Use actual name for grouping
            if (!ticketsByName[key]) ticketsByName[key] = [];
            ticketsByName[key].push(t);
        });

        Object.keys(ticketsByName).forEach(name => {
            invoiceGroups.push({
                clientName: name,
                tickets: ticketsByName[name],
                pnrs: [...new Set(ticketsByName[name].map(t => t.booking_reference))]
            });
        });
    } else {
        // Combined Mode
        // "Bill to all the name" - Join unique names
        const uniqueNames = [...new Set(tickets.map(t => t.name.trim()))];
        const combinedName = uniqueNames.join(", ");
        const allPnrs = [...new Set(tickets.map(t => t.booking_reference))];

        invoiceGroups.push({
            clientName: combinedName,
            tickets: tickets,
            pnrs: allPnrs
        });
    }

    // --- PDF Generation ---
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const logo = await loadImage(COMPANY.logoUrl);

    // Colors
    const PRIMARY_COLOR = [249, 115, 22]; 
    const TEXT_COLOR = [40, 40, 40];
    const SUBTEXT_COLOR = [100, 100, 100];
    const TABLE_HEAD_BG = [245, 245, 245];
    const TABLE_BORDER_COLOR = [220, 220, 220];

    invoiceGroups.forEach((group, groupIndex) => {
        if (groupIndex > 0) doc.addPage();

        const { clientName, tickets: groupTickets, pnrs } = group;

        // --- Build Rows (Logic: Group by Price + Route + Airline) ---
        let tableBody = [];
        
        if (mode === 'combined') {
            const itemMap = {};
            groupTickets.forEach(t => {
                const routeSig = getRouteSignature(t); // DEP-DEST|DATE
                const airline = t.airline || '';
                const price = (t.net_amount || 0) + (t.extra_fare || 0);
                
                // Key: Distinction for grouping (Price must match)
                const key = `${routeSig}|${airline}|${price}`;
                
                if (!itemMap[key]) {
                    const [routing, date] = routeSig.split('|');
                    const desc = `${routing}, ${date} (${airline})`;
                    
                    itemMap[key] = {
                        description: desc,
                        price: price,
                        qty: 0,
                        rawDate: t.departing_on
                    };
                }
                itemMap[key].qty += 1;
            });

            // Sort by Date
            const items = Object.values(itemMap).sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate));

            tableBody = items.map((item, i) => [
                i + 1,
                item.description,
                item.qty,
                item.price.toLocaleString(),
                (item.price * item.qty).toLocaleString()
            ]);

        } else {
            // Separate Mode - List Individually
            tableBody = groupTickets.map((t, i) => {
                const route = `${t.departure.split(' ')[0]} - ${t.destination.split(' ')[0]}`;
                const date = formatDateToDMMMY(t.departing_on);
                const price = (t.net_amount || 0) + (t.extra_fare || 0);
                
                return [
                    i + 1,
                    `${route}, ${date} (${t.airline})`,
                    1,
                    price.toLocaleString(),
                    price.toLocaleString()
                ];
            });
        }

        const totalAmount = groupTickets.reduce((sum, t) => sum + (t.net_amount||0) + (t.extra_fare||0), 0);

        // --- Render PDF ---
        // Header
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.setTextColor(...PRIMARY_COLOR);
        doc.text(COMPANY.name.toUpperCase(), 15, 20);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...SUBTEXT_COLOR);
        const splitAddress = doc.splitTextToSize(COMPANY.address, 90);
        doc.text(splitAddress, 15, 30);
        
        let yPosAddress = 30 + (splitAddress.length * 4);
        doc.text(`Phone: ${COMPANY.phones.join(", ")}`, 15, yPosAddress);
        doc.text(`Email: ${COMPANY.email}`, 15, yPosAddress + 5);

        if (logo) doc.addImage(logo, 'PNG', 160, 10, 35, 35);
        
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(200, 200, 200);
        doc.text(type.toUpperCase(), 195, 55, { align: 'right' });

        doc.setDrawColor(230, 230, 230);
        doc.line(15, 60, 195, 60);

        // Meta Info
        let yPos = 70;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...TEXT_COLOR);
        doc.text("BILL TO:", 15, yPos);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        const splitClientName = doc.splitTextToSize(clientName, 90);
        doc.text(splitClientName, 15, yPos + 6);

        let metaHeight = (splitClientName.length * 5) + 5;
        doc.setFontSize(9);
        doc.setTextColor(...SUBTEXT_COLOR);
        const pnrString = `PNR: ${pnrs.join(", ")}`;
        const splitPnr = doc.splitTextToSize(pnrString, 90);
        doc.text(splitPnr, 15, yPos + 6 + metaHeight);

        // Details Column
        const dateObj = dateStr ? new Date(dateStr) : new Date();
        const formattedDate = formatDateToDMMMY(dateObj.toISOString());
        const dayStr = String(dateObj.getDate()).padStart(2,'0');
        const monthStr = String(dateObj.getMonth()+1).padStart(2,'0');
        const docIdPrefix = type === 'Invoice' ? 'INV' : 'RCP';
        const suffix = (mode === 'separate' && invoiceGroups.length > 1) ? `-${groupIndex + 1}` : '';
        const docId = `${docIdPrefix}-${pnrs[0]}-${dayStr}${monthStr}${suffix}`;

        doc.setFont("helvetica", "bold");
        doc.setTextColor(...TEXT_COLOR);
        doc.setFontSize(10);
        doc.text("DETAILS:", 130, yPos);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...SUBTEXT_COLOR);
        doc.text(`${type} ID:`, 130, yPos + 6);
        doc.text(docId, 195, yPos + 6, { align: 'right' });
        doc.text(`${type} Date:`, 130, yPos + 11);
        doc.text(formattedDate, 195, yPos + 11, { align: 'right' });

        // Table
        doc.autoTable({
            startY: yPos + 25 + (splitPnr.length * 4),
            head: [['#', 'Description', 'Qty', 'Rate', 'Amount']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: TABLE_HEAD_BG, textColor: TEXT_COLOR, fontStyle: 'bold', halign: 'left', lineWidth: 0.1, lineColor: TABLE_BORDER_COLOR },
            styles: { fontSize: 9, cellPadding: 4, textColor: TEXT_COLOR, valign: 'middle', lineWidth: 0.1, lineColor: TABLE_BORDER_COLOR, fillColor: [255, 255, 255] },
            alternateRowStyles: { fillColor: [250, 250, 250] },
            columnStyles: {
                0: { halign: 'center', cellWidth: 12 },
                1: { cellWidth: 'auto' },
                2: { halign: 'center', cellWidth: 15 },
                3: { halign: 'right', cellWidth: 35 },
                4: { halign: 'right', cellWidth: 40, fontStyle: 'bold' }
            },
            margin: { top: 15, left: 15, right: 15 }
        });

        // Total
        let finalY = doc.lastAutoTable.finalY + 5;
        doc.setDrawColor(200, 200, 200);
        doc.line(130, finalY, 195, finalY);
        finalY += 8;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(...PRIMARY_COLOR);
        doc.text("TOTAL:", 130, finalY);
        doc.text(`${totalAmount.toLocaleString()} MMK`, 195, finalY, { align: 'right' });

        // Sticky Footer
        const pageHeight = doc.internal.pageSize.height;
        const footerHeight = 60; 
        const footerStartY = pageHeight - footerHeight;
        if (finalY + 10 > footerStartY) doc.addPage();

        let currentY = footerStartY;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...TEXT_COLOR);
        doc.text("PAYMENT METHODS", 15, currentY);
        doc.setDrawColor(...PRIMARY_COLOR);
        doc.line(15, currentY + 2, 55, currentY + 2); 

        currentY += 8;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...SUBTEXT_COLOR);

        const col1X = 15;
        const col2X = 105;
        BANK_ACCOUNTS.forEach((bank, idx) => {
            const xPos = idx % 2 === 0 ? col1X : col2X;
            const rowOffset = Math.floor(idx / 2) * 12;
            doc.setFont("helvetica", "bold");
            doc.text(bank.bank, xPos, currentY + rowOffset);
            doc.setFont("helvetica", "normal");
            doc.text(`${bank.account} (${bank.name})`, xPos, currentY + rowOffset + 4);
        });

        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text("Thank you for choosing Ocean Ticket!", 105, pageHeight - 10, { align: 'center' });
    });

    const safeName = invoiceGroups[0].clientName.split(',')[0].replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeName}_${type}${invoiceGroups.length > 1 ? '_Combined' : ''}.pdf`;
    doc.save(filename);
}

/**
 * Generates PNG invoices/receipts.
 * Uses exact same grouping logic as PDF generator.
 */
export async function generateInvoiceImage(pnrList, type = 'Invoice', dateStr = null, forcedMode = 'auto') {
    try {
        await loadHtml2Canvas();
    } catch (e) {
        showToast("Could not load image generation library.", "error");
        return;
    }

    const cleanPnrs = pnrList.map(p => p.trim().toUpperCase()).filter(p => p);
    const tickets = state.allTickets.filter(t => cleanPnrs.includes(t.booking_reference));

    if (tickets.length === 0) {
        showToast('No tickets found.', 'error');
        return;
    }

    let mode = forcedMode;
    if (mode === 'auto') {
        const scenario = analyzeInvoiceScenario(pnrList);
        if (scenario.type === 'ERROR') {
            showToast(scenario.message, 'error');
            return;
        }
        if (scenario.canChoose) mode = 'separate'; 
        else mode = 'combined';
    }

    // --- Grouping ---
    let invoiceGroups = [];
    if (mode === 'separate') {
        const ticketsByName = {};
        tickets.forEach(t => {
            const key = t.name.trim();
            if (!ticketsByName[key]) ticketsByName[key] = [];
            ticketsByName[key].push(t);
        });
        Object.keys(ticketsByName).forEach(name => {
            invoiceGroups.push({
                clientName: name,
                tickets: ticketsByName[name],
                pnrs: [...new Set(ticketsByName[name].map(t => t.booking_reference))]
            });
        });
    } else {
        const uniqueNames = [...new Set(tickets.map(t => t.name.trim()))];
        invoiceGroups.push({
            clientName: uniqueNames.join(", "),
            tickets: tickets,
            pnrs: [...new Set(tickets.map(t => t.booking_reference))]
        });
    }

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '-9999px';
    container.style.left = '-9999px';
    const style = document.createElement('style');
    style.innerHTML = getInvoiceCSS();
    document.head.appendChild(style);
    document.body.appendChild(container);

    for (let i = 0; i < invoiceGroups.length; i++) {
        const group = invoiceGroups[i];
        const dateObj = dateStr ? new Date(dateStr) : new Date();
        const formattedDate = formatDateToDMMMY(dateObj.toISOString());
        const dayStr = String(dateObj.getDate()).padStart(2,'0');
        const monthStr = String(dateObj.getMonth()+1).padStart(2,'0');
        const docIdPrefix = type === 'Invoice' ? 'INV' : 'RCP';
        const suffix = (mode === 'separate' && invoiceGroups.length > 1) ? `-${i + 1}` : '';
        const docId = `${docIdPrefix}-${group.pnrs[0]}-${dayStr}${monthStr}${suffix}`;

        const totalAmount = group.tickets.reduce((sum, t) => sum + (t.net_amount||0) + (t.extra_fare||0), 0);

        // --- Build Rows ---
        let tableRows = '';
        if (mode === 'combined') {
            const itemMap = {};
            group.tickets.forEach(t => {
                const routeSig = getRouteSignature(t);
                const airline = t.airline || '';
                const price = (t.net_amount || 0) + (t.extra_fare || 0);
                const key = `${routeSig}|${airline}|${price}`;
                
                if (!itemMap[key]) {
                    const [routing, date] = routeSig.split('|');
                    itemMap[key] = { description: `${routing}, ${date} (${airline})`, price: price, qty: 0, rawDate: t.departing_on };
                }
                itemMap[key].qty += 1;
            });
            const items = Object.values(itemMap).sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate));
            tableRows = items.map((item, idx) => `
                <tr>
                    <td class="col-num">${idx + 1}</td>
                    <td class="col-desc">${item.description}</td>
                    <td class="col-qty">${item.qty}</td>
                    <td class="col-rate">${item.price.toLocaleString()}</td>
                    <td class="col-amt">${(item.price * item.qty).toLocaleString()}</td>
                </tr>
            `).join('');
        } else {
            tableRows = group.tickets.map((t, idx) => {
                const route = `${t.departure.split(' ')[0]} - ${t.destination.split(' ')[0]}`;
                const date = formatDateToDMMMY(t.departing_on);
                const price = (t.net_amount || 0) + (t.extra_fare || 0);
                return `<tr><td class="col-num">${idx+1}</td><td class="col-desc">${route}, ${date} (${t.airline})</td><td class="col-qty">1</td><td class="col-rate">${price.toLocaleString()}</td><td class="col-amt">${price.toLocaleString()}</td></tr>`;
            }).join('');
        }

        let banksHtml = '';
        BANK_ACCOUNTS.forEach(b => {
            banksHtml += `<div class="inv-bank-item"><strong>${b.bank}</strong><span>${b.account} (${b.name})</span></div>`;
        });

        const html = `
            <div class="invoice-container">
                <div class="inv-header">
                    <div class="inv-company">
                        <h1>${COMPANY.name}</h1>
                        <p>${COMPANY.address.replace(/\n/g, '<br>')}</p>
                        <p>Phone: ${COMPANY.phones.join(", ")}<br>Email: ${COMPANY.email}</p>
                    </div>
                    <div class="inv-logo-sec">
                        <img src="${COMPANY.logoUrl}" alt="Logo" />
                        <div class="inv-type">${type}</div>
                    </div>
                </div>
                <div class="inv-meta-grid">
                    <div class="inv-bill-to">
                        <h3 class="inv-section-title">BILL TO:</h3>
                        <p class="inv-client-name">${group.clientName}</p>
                        <p class="inv-sub">PNR: ${group.pnrs.join(", ")}</p>
                    </div>
                    <div class="inv-details">
                        <h3 class="inv-section-title">DETAILS:</h3>
                        <div class="inv-details-row"><span>${type} ID:</span><span class="inv-details-val">${docId}</span></div>
                        <div class="inv-details-row"><span>Date:</span><span class="inv-details-val">${formattedDate}</span></div>
                    </div>
                </div>
                <table class="inv-table">
                    <thead><tr><th class="col-num">#</th><th class="col-desc">Description</th><th class="col-qty">Qty</th><th class="col-rate">Rate</th><th class="col-amt">Amount</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
                <div class="inv-total-sec">
                    <div class="inv-total-row"><span>TOTAL:</span><span>${totalAmount.toLocaleString()} MMK</span></div>
                </div>
                <div class="inv-footer">
                    <div class="inv-footer-line"></div>
                    <h4>PAYMENT METHODS</h4>
                    <div class="inv-banks">${banksHtml}</div>
                    <div class="inv-thankyou">Thank you for choosing Ocean Ticket!</div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        try {
            const canvas = await html2canvas(container.querySelector('.invoice-container'), { scale: 2, useCORS: true });
            const link = document.createElement('a');
            const safeName = group.clientName.split(',')[0].replace(/[^a-z0-9]/gi, '_');
            link.download = `${safeName}_${type}${suffix}.png`;
            link.href = canvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            console.error(err);
            showToast("Failed to generate image.", "error");
        }
    }

    document.body.removeChild(container);
    document.head.removeChild(style);
}
