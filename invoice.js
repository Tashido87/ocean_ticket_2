/**
 * @fileoverview Handles invoice/receipt generation for PDF and image exports.
 * Supports shared invoice logic with switchable branding.
 */

import { formatDateToDMMMY, parseSheetDate, showToast, isFeeEntryRow } from './utils.js';
import { state } from './state.js';

const INVOICE_THEME = {
    accentHex: '#B91C1C',
    accentRgb: [185, 28, 28],
    accentSoftRgb: [254, 226, 226],
    accentBorderRgb: [252, 165, 165],
    textRgb: [60, 60, 60],
    mutedRgb: [107, 114, 128],
    lineRgb: [229, 231, 235]
};

const BRANDS = {
    ocean: {
        key: 'ocean',
        selectorLabel: 'Ocean',
        displayName: 'Ocean Travel',
        legalName: 'OCEAN TRAVEL',
        logoUrl: './ocean-travel-logo.png',
        documentCode: 'OC',
        addressLines: [
            'A3-1, Room 603, Myanma Gone Yi Housing,',
            'Upper Pansodan Street, Mingalar Taungnyunt Township, Yangon.'
        ],
        phones: ['09964403435', '09740862500'],
        email: 'oceanmobile.bmo@gmail.com',
        theme: {
            accentHex: '#B91C1C',
            accentRgb: [185, 28, 28],
            accentSoftRgb: [254, 226, 226],
            accentBorderRgb: [252, 165, 165],
            textRgb: [60, 60, 60],
            mutedRgb: [107, 114, 128],
            lineRgb: [229, 231, 235]
        }
    },
    magical_land: {
        key: 'magical_land',
        selectorLabel: 'Magical Land',
        displayName: 'Magical Land',
        legalName: 'MAGICAL LAND COMPANY LIMITED',
        logoUrl: './magical-land-logo.svg',
        documentCode: 'ML',
        addressLines: [
            'Room No. 1202, A-32, Myanma Gonyi Housing,',
            'Upper Pansodan St, Mingalar Taungnyunt Township, Yangon.'
        ],
        phones: ['09964026208'],
        email: 'magicalandticket@gmail.com',
        theme: {
            accentHex: '#1CB5AD',
            accentRgb: [28, 181, 173],
            accentSoftRgb: [232, 248, 247],
            accentBorderRgb: [190, 225, 223],
            textRgb: [46, 47, 56],
            mutedRgb: [107, 114, 128],
            lineRgb: [229, 231, 235]
        }
    }
};

const BANK_ACCOUNTS = [
    { bank: 'KBZ Pay', account: '09740862500', name: 'Aung Pyae Sone' },
    { bank: 'KBZ Special Account', account: '02051102000725501', name: 'Aung Pyae Sone' },
    { bank: 'KBZ Normal Account', account: '18230199926109801', name: 'Aung Pyae Sone' },
    { bank: 'AYA Pay', account: '09740862500', name: 'Aung Pyae Sone' },
    { bank: 'AYA Banking', account: '40039173610', name: 'Aung Pyae Sone' },
    { bank: 'CB Mobile Banking', account: '0042-6005-0001-2432', name: 'Aung Pyae Sone' }
];

function getBrandConfig(brandKey = 'ocean') {
    return BRANDS[brandKey] || BRANDS.ocean;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMoney(value) {
    const numeric = Number(value) || 0;
    return numeric.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

function formatQuantity(value) {
    const numeric = Number(value) || 0;
    return numeric.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

function formatCurrency(value) {
    return `MMK ${formatMoney(value)}`;
}

function resolveDocumentDate(dateStr) {
    if (!dateStr) return new Date();

    const parsed = parseSheetDate(dateStr);
    if (!isNaN(parsed.getTime()) && parsed.getTime() !== 0) {
        return parsed;
    }

    const fallback = new Date(dateStr);
    return isNaN(fallback.getTime()) ? new Date() : fallback;
}

function formatDisplayDate(dateLike) {
    const date = dateLike instanceof Date ? dateLike : resolveDocumentDate(dateLike);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(date.getDate()).padStart(2, '0');
    return `${day} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

function buildDocumentId(type, pnrs, brand, groupIndex = 0, groupCount = 1) {
    const prefix = type === 'Invoice' ? 'INV' : 'RCP';
    const reference = String(pnrs[0] || '00000')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .slice(0, 8) || '00000';
    const suffix = groupCount > 1 ? `-${groupIndex + 1}` : '';
    return `${brand.documentCode}-${prefix}-${reference}${suffix}`;
}

function fitWithinBox(width, height, maxWidth, maxHeight) {
    if (!width || !height) return { width: maxWidth, height: maxHeight };
    const scale = Math.min(maxWidth / width, maxHeight / height);
    return {
        width: width * scale,
        height: height * scale
    };
}

async function loadImageAsset(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve({
                    element: img,
                    dataUrl: canvas.toDataURL('image/png'),
                    width: canvas.width,
                    height: canvas.height
                });
            } catch (error) {
                console.warn(`Failed to rasterize logo from ${url}`, error);
                resolve({
                    element: img,
                    dataUrl: null,
                    width: img.naturalWidth || img.width,
                    height: img.naturalHeight || img.height
                });
            }
        };
        img.onerror = () => {
            console.warn(`Failed to load logo from ${url}`);
            resolve(null);
        };
        img.src = url;
    });
}

function loadHtml2Canvas() {
    return new Promise((resolve, reject) => {
        if (window.html2canvas) return resolve(window.html2canvas);

        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => resolve(window.html2canvas);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function getInvoiceCSS(theme = INVOICE_THEME) {
    const accentSoftHtml = `rgb(${theme.accentSoftRgb.join(',')})`;
    const accentBorderHtml = `rgb(${theme.accentBorderRgb.join(',')})`;
    const lineHtml = `rgb(${theme.lineRgb.join(',')})`;

    return `
        .invoice-container {
            width: 794px;
            min-height: 1123px;
            box-sizing: border-box;
            padding: 54px 52px 44px;
            background: #ffffff;
            color: #2e2f38;
            font-family: Arial, Helvetica, sans-serif;
            display: flex;
            flex-direction: column;
        }
        .inv-main {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .inv-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 28px;
        }
        .inv-brand {
            width: 250px;
        }
        .inv-brand img {
            display: block;
            width: 240px;
            max-height: 200px;
            object-fit: contain;
            object-position: left top;
        }
        .inv-company {
            max-width: 280px;
            margin-left: auto;
            text-align: right;
        }
        .inv-company h1 {
            margin: 0 0 8px;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.06em;
            color: #2e2f38;
            word-break: break-word;
        }
        .inv-company p {
            margin: 0 0 4px;
            font-size: 11px;
            color: #6b7280;
            line-height: 1.45;
        }
        .inv-divider {
            border-top: 1px solid #e5e7eb;
            margin: 18px 0 20px;
        }
        .inv-summary {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 250px;
            gap: 28px;
            margin-bottom: 16px;
        }
        .inv-label {
            margin: 0 0 10px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #6b7280;
        }
        .inv-client-name {
            margin: 0 0 8px;
            font-size: 18px;
            font-weight: 700;
            color: #2e2f38;
            word-break: break-word;
        }
        .inv-sub {
            margin: 0;
            font-size: 12px;
            color: #6b7280;
            line-height: 1.5;
        }
        .inv-doc-type {
            margin: 0 0 16px;
            font-size: 26px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            text-align: right;
            color: ${theme.accentHex};
        }
        .inv-detail-row {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            padding: 6px 0;
            font-size: 12px;
            color: #6b7280;
        }
        .inv-detail-row span:last-child {
            color: #2e2f38;
            font-weight: 600;
            text-align: right;
        }
        .inv-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 6px;
        }
        .inv-table th {
            padding: 8px 10px;
            background: ${accentSoftHtml};
            border-top: 1px solid ${accentBorderHtml};
            border-bottom: 1px solid ${accentBorderHtml};
            font-size: 11px;
            font-weight: 700;
            color: #2e2f38;
            text-align: left;
        }
        .inv-table td {
            padding: 10px;
            border-bottom: 1px solid #eceef1;
            font-size: 12px;
            color: #2e2f38;
            vertical-align: top;
        }
        .inv-table th.col-num,
        .inv-table td.col-num,
        .inv-table th.col-qty,
        .inv-table td.col-qty {
            text-align: center;
        }
        .inv-table th.col-rate,
        .inv-table td.col-rate,
        .inv-table th.col-amt,
        .inv-table td.col-amt {
            text-align: right;
        }
        .inv-table td.col-amt {
            font-weight: 700;
        }
        .inv-totals {
            width: 280px;
            margin-left: auto;
            margin-top: 16px;
        }
        .inv-total-row {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            padding: 7px 0;
            border-top: 1px solid ${lineHtml};
            font-size: 12px;
            color: #6b7280;
        }
        .inv-total-row span:last-child {
            color: #2e2f38;
            font-weight: 600;
        }
        .inv-total-row.balance {
            color: ${theme.accentHex};
            font-weight: 700;
        }
        .inv-total-row.balance span:last-child {
            color: ${theme.accentHex};
            font-weight: 700;
        }
        .inv-payment-area {
            margin-top: auto;
            padding-top: 34px;
        }
        .inv-note {
            margin: 0 0 14px;
            font-size: 12px;
            color: #2e2f38;
            line-height: 1.55;
        }
        .inv-payment-title {
            margin: 0 0 10px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: ${theme.accentHex};
        }
        .inv-account-name {
            margin: 0 0 12px;
            font-size: 11px;
            color: #000000;
        }
        .inv-bank-list {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px 34px;
            max-width: 520px;
        }
        .inv-bank-item {
            font-size: 11px;
            color: #000000;
            line-height: 1.45;
        }
        .inv-bank-item strong {
            display: block;
            font-weight: 700;
            color: ${theme.accentHex};
        }
    `;
}



function getOriginalTravelDate(pnr) {
    if (!state.history || !Array.isArray(state.history)) return null;
    const modifications = state.history.filter(h => h.pnr === pnr && h.details.includes('Travel Date:'));
    if (modifications.length > 0) {
        // Find the oldest record affecting Travel Date
        const oldestMod = modifications[modifications.length - 1]; 
        const match = oldestMod.details.match(/Travel Date:\s*(.+?)\s*to/);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

function formatClientNameDisplay(name) {
    if (!name) return '';
    return name.replace(/\s*\(\s*fees\s*\)\s*$/i, '').trim();
}

function buildInvoiceGroups(tickets, mode) {
    if (mode === 'separate') {
        const ticketsByName = {};
        tickets.forEach((ticket) => {
            const key = formatClientNameDisplay(ticket.name);
            if (!ticketsByName[key]) ticketsByName[key] = [];
            ticketsByName[key].push(ticket);
        });

        return Object.keys(ticketsByName).map((name) => ({
            clientName: name,
            tickets: ticketsByName[name],
            pnrs: [...new Set(ticketsByName[name].map((ticket) => ticket.booking_reference))]
        }));
    }

    const uniqueNames = [...new Set(tickets.map((ticket) => formatClientNameDisplay(ticket.name)))];
    return [{
        clientName: uniqueNames.join(', '),
        tickets,
        pnrs: [...new Set(tickets.map((ticket) => ticket.booking_reference))]
    }];
}

function buildInvoiceLineItems(groupTickets, mode) {
    const processTicket = (ticket) => {
        const isFee = isFeeEntryRow(ticket);
        const route = `${(ticket.departure || '').split(' ')[0]}-${(ticket.destination || '').split(' ')[0]}`;
        const airline = ticket.airline || '';
        const price = (ticket.net_amount || 0) + (ticket.extra_fare || 0);
        
        let displayDate = ticket.departing_on;
        let prefix = '';

        if (isFee) {
            prefix = 'Date Change Fee: ';
        } else {
            const hasFeeInGroup = groupTickets.some(t => t.booking_reference === ticket.booking_reference && isFeeEntryRow(t));
            if (hasFeeInGroup) {
                const oldDate = getOriginalTravelDate(ticket.booking_reference);
                if (oldDate) displayDate = oldDate;
            }
        }

        const dateStr = formatDateToDMMMY(displayDate);
        return {
            description: `${prefix}${route}, ${dateStr} (${airline})`,
            qty: 1,
            rate: price,
            amount: price,
            rawDate: displayDate,
            isFee: isFee
        };
    };

    if (mode === 'combined') {
        const itemMap = {};
        groupTickets.forEach((ticket) => {
            const processed = processTicket(ticket);
            const key = `${processed.description}|${processed.rate}`;
            if (!itemMap[key]) {
                itemMap[key] = { ...processed, qty: 0 };
            }
            itemMap[key].qty += 1;
            itemMap[key].amount = itemMap[key].qty * itemMap[key].rate;
        });

        return Object.values(itemMap)
            .sort((a, b) => {
                if (a.isFee !== b.isFee) return a.isFee ? 1 : -1;
                return parseSheetDate(a.rawDate) - parseSheetDate(b.rawDate);
            })
            .map((item, index) => {
                item.index = index + 1;
                return item;
            });
    }

    return groupTickets.map(ticket => processTicket(ticket)).sort((a, b) => {
        if (a.isFee !== b.isFee) return a.isFee ? 1 : -1;
        return parseSheetDate(a.rawDate) - parseSheetDate(b.rawDate);
    }).map((item, index) => {
        item.index = index + 1;
        return item;
    });
}

function buildInvoiceDocumentData(group, type, brand, dateStr, groupIndex, groupCount, mode, logoSrc = null) {
    const documentDate = resolveDocumentDate(dateStr);
    const lineItems = buildInvoiceLineItems(group.tickets, mode);
    const totalAmount = group.tickets.reduce(
        (sum, ticket) => sum + (ticket.net_amount || 0) + (ticket.extra_fare || 0),
        0
    );

    return {
        brand,
        type,
        group,
        lineItems,
        totalAmount,
        logoSrc: logoSrc || brand.logoUrl,
        formattedDate: formatDisplayDate(documentDate),
        documentId: buildDocumentId(type, group.pnrs, brand, groupIndex, groupCount),
        documentStatusLabel: type === 'Invoice' ? 'Terms' : 'Status',
        documentStatusValue: type === 'Invoice' ? 'Due on Receipt' : 'Paid',
        balanceLabel: type === 'Invoice' ? 'Balance Due' : 'Amount Received'
    };
}

function waitForImages(root) {
    const images = Array.from(root.querySelectorAll('img'));
    return Promise.all(
        images.map((img) => new Promise((resolve) => {
            if (img.complete) {
                resolve();
                return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
        }))
    );
}

function getAccountNameLine() {
    const uniqueNames = [...new Set(BANK_ACCOUNTS.map((bank) => bank.name).filter(Boolean))];
    return uniqueNames.length === 1 ? `Account Name - ${uniqueNames[0]}` : '';
}

function buildInvoiceHtml(data) {
    const { brand, type, group, lineItems, totalAmount, logoSrc, formattedDate, documentId, documentStatusLabel, documentStatusValue, balanceLabel } = data;

    const tableRows = lineItems.map((item) => `
        <tr>
            <td class="col-num">${item.index}</td>
            <td class="col-desc">${escapeHtml(item.description)}</td>
            <td class="col-qty">${formatQuantity(item.qty)}</td>
            <td class="col-rate">${formatMoney(item.rate)}</td>
            <td class="col-amt">${formatMoney(item.amount)}</td>
        </tr>
    `).join('');

    const bankItems = BANK_ACCOUNTS.map((bank) => `
        <div class="inv-bank-item">
            <strong>${escapeHtml(bank.bank)}</strong>
            <span>${escapeHtml(bank.account)} (${escapeHtml(bank.name)})</span>
        </div>
    `).join('');

    const accountNameLine = getAccountNameLine();

    return `
        <div class="invoice-container">
            <div class="inv-main">
                <div class="inv-top">
                    <div class="inv-brand">
                        <img src="${logoSrc}" alt="${escapeHtml(brand.displayName)} logo" />
                    </div>
                    <div class="inv-company">
                        <h1>${escapeHtml(brand.legalName)}</h1>
                        <p>${brand.addressLines.map(escapeHtml).join('<br>')}</p>
                        <p>${brand.phones.map(escapeHtml).join('<br>')}</p>
                        <p>${escapeHtml(brand.email)}</p>
                    </div>
                </div>

                <div class="inv-divider"></div>

                <div class="inv-summary">
                    <div>
                        <p class="inv-label">Bill To</p>
                        <p class="inv-client-name">${escapeHtml(group.clientName)}</p>
                        <p class="inv-sub">PNR: ${escapeHtml(group.pnrs.join(', '))}</p>
                    </div>
                    <div>
                        <p class="inv-doc-type">${escapeHtml(type)}</p>
                        <div class="inv-detail-row"><span>${escapeHtml(type)} #</span><span>${escapeHtml(documentId)}</span></div>
                        <div class="inv-detail-row"><span>${escapeHtml(type)} Date</span><span>${escapeHtml(formattedDate)}</span></div>
                        <div class="inv-detail-row"><span>${escapeHtml(documentStatusLabel)}</span><span>${escapeHtml(documentStatusValue)}</span></div>
                    </div>
                </div>

                <table class="inv-table">
                    <thead>
                        <tr>
                            <th class="col-num">#</th>
                            <th class="col-desc">Description</th>
                            <th class="col-qty">Qty</th>
                            <th class="col-rate">Rate</th>
                            <th class="col-amt">Amount</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>

                <div class="inv-totals">
                    <div class="inv-total-row"><span>Sub Total</span><span>${formatCurrency(totalAmount)}</span></div>
                    <div class="inv-total-row"><span>Total</span><span>${formatCurrency(totalAmount)}</span></div>
                    <div class="inv-total-row balance"><span>${escapeHtml(balanceLabel)}</span><span>${formatCurrency(totalAmount)}</span></div>
                </div>

                <div class="inv-payment-area">
                    <p class="inv-note">Thank you.</p>
                    <p class="inv-payment-title">Payment Methods</p>
                    ${accountNameLine ? `<p class="inv-account-name">${escapeHtml(accountNameLine)}</p>` : ''}
                    <div class="inv-bank-list">${bankItems}</div>
                </div>
            </div>
        </div>
    `;
}

function drawDetailRow(doc, label, value, x, y, maxWidth, theme = INVOICE_THEME) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...theme.mutedRgb);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...theme.textRgb);
    doc.text(doc.splitTextToSize(value, maxWidth), 195, y, { align: 'right' });
}

function renderPaymentSection(doc, startY, theme = INVOICE_THEME) {
    const pageHeight = doc.internal.pageSize.getHeight();
    const y = Math.min(startY, pageHeight - 44);
    const rightColumnX = 108;
    const accountNameLine = getAccountNameLine();

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...theme.textRgb);
    doc.text('Thank you.', 15, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...theme.accentRgb);
    doc.text('PAYMENT METHODS', 15, y + 12);

    let currentY = y + 18;
    if (accountNameLine) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.text(accountNameLine, 15, currentY);
        currentY += 6;
    }

    BANK_ACCOUNTS.forEach((bank, index) => {
        const x = index < 3 ? 15 : rightColumnX;
        const row = index < 3 ? index : index - 3;
        const lineY = currentY + (row * 10);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...theme.accentRgb);
        doc.text(bank.bank, x, lineY);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.text(`${bank.account} (${bank.name})`, x, lineY + 3.8);
    });
}

function renderInvoicePage(doc, data, logoAsset, theme = INVOICE_THEME) {
    const { brand, type, group, lineItems, totalAmount, formattedDate, documentId, documentStatusLabel, documentStatusValue, balanceLabel } = data;
    const pageHeight = doc.internal.pageSize.getHeight();

    let logoBottom = 30;
    if (logoAsset && logoAsset.dataUrl) {
        const fitted = fitWithinBox(logoAsset.width, logoAsset.height, 80, 50);
        doc.addImage(logoAsset.dataUrl, 'PNG', 15, 10, fitted.width, fitted.height);
        logoBottom = 10 + fitted.height;
    } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(...theme.textRgb);
        doc.text(brand.displayName, 15, 22);
        logoBottom = 24;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...theme.textRgb);
    doc.text(brand.legalName, 195, 18, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...theme.mutedRgb);
    const companyLines = [
        ...brand.addressLines,
        ...brand.phones,
        brand.email
    ];
    const splitCompanyLines = doc.splitTextToSize(companyLines.join('\n'), 74);
    doc.text(splitCompanyLines, 195, 23, { align: 'right' });
    const companyBottom = 23 + (splitCompanyLines.length * 3.8);

    const dividerY = Math.max(logoBottom, companyBottom) + 7;
    doc.setDrawColor(...theme.lineRgb);
    doc.setLineWidth(0.2);
    doc.line(15, dividerY, 195, dividerY);

    const billTopY = dividerY + 11;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...theme.mutedRgb);
    doc.text('BILL TO', 15, billTopY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...theme.textRgb);
    const splitClientName = doc.splitTextToSize(group.clientName, 92);
    doc.text(splitClientName, 15, billTopY + 7);

    const billBottomY = billTopY + 7 + (splitClientName.length * 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...theme.mutedRgb);
    const splitPnr = doc.splitTextToSize(`PNR: ${group.pnrs.join(', ')}`, 92);
    doc.text(splitPnr, 15, billBottomY + 6);
    const pnrBottomY = billBottomY + 6 + (splitPnr.length * 3.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...theme.accentRgb);
    doc.text(type.toUpperCase(), 195, billTopY + 1, { align: 'right' });

    drawDetailRow(doc, `${type} #`, documentId, 130, billTopY + 10, 54, theme);
    drawDetailRow(doc, `${type} Date`, formattedDate, 130, billTopY + 16, 54, theme);
    drawDetailRow(doc, documentStatusLabel, documentStatusValue, 130, billTopY + 22, 54, theme);
    const detailsBottomY = billTopY + 24;

    doc.autoTable({
        startY: Math.max(pnrBottomY, detailsBottomY) + 10,
        head: [['#', 'Description', 'Qty', 'Rate', 'Amount']],
        body: lineItems.map((item) => [
            item.index,
            item.description,
            formatQuantity(item.qty),
            formatMoney(item.rate),
            formatMoney(item.amount)
        ]),
        theme: 'grid',
        headStyles: {
            fillColor: theme.accentSoftRgb,
            textColor: theme.textRgb,
            fontStyle: 'bold',
            lineColor: theme.accentBorderRgb,
            lineWidth: 0.2
        },
        styles: {
            fontSize: 8.5,
            cellPadding: { top: 3.5, right: 3, bottom: 3.5, left: 3 },
            textColor: theme.textRgb,
            lineColor: theme.lineRgb,
            lineWidth: 0.15,
            valign: 'middle'
        },
        columnStyles: {
            0: { halign: 'center', cellWidth: 10 },
            1: { cellWidth: 'auto' },
            2: { halign: 'center', cellWidth: 18 },
            3: { halign: 'right', cellWidth: 30 },
            4: { halign: 'right', cellWidth: 34, fontStyle: 'bold' }
        },
        margin: { left: 15, right: 15 }
    });

    let totalsY = doc.lastAutoTable.finalY + 10;
    if (totalsY > pageHeight - 72) {
        doc.addPage();
        totalsY = 26;
    }

    const totalsX = 128;
    const totalsWidth = 67;
    const totalRows = [
        { label: 'Sub Total', value: formatCurrency(totalAmount), color: theme.mutedRgb },
        { label: 'Total', value: formatCurrency(totalAmount), color: theme.textRgb, bold: true },
        { label: balanceLabel, value: formatCurrency(totalAmount), color: theme.accentRgb, bold: true }
    ];

    totalRows.forEach((row, index) => {
        const rowY = totalsY + (index * 8);
        doc.setDrawColor(...theme.lineRgb);
        doc.line(totalsX, rowY, totalsX + totalsWidth, rowY);

        doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...row.color);
        doc.text(row.label, totalsX, rowY + 5);
        doc.text(row.value, totalsX + totalsWidth, rowY + 5, { align: 'right' });
    });

    const paymentStartY = totalsY + (totalRows.length * 8) + 18;
    if (paymentStartY > pageHeight - 44) {
        doc.addPage();
        renderPaymentSection(doc, 28, theme);
    } else {
        renderPaymentSection(doc, paymentStartY, theme);
    }
}

function normalizeClientName(name) {
    if (!name) return '';
    return name.toUpperCase()
        .replace(/\s+(MR|MRS|MS|MISS|MSTR)$/, '')
        .replace(/\s*\(.*?\)\s*/g, '')
        .replace(/[^A-Z0-9]/g, '')
        .trim();
}

function getRouteSignature(ticket) {
    const departure = (ticket.departure || '').split(' ')[0].trim().toUpperCase();
    const destination = (ticket.destination || '').split(' ')[0].trim().toUpperCase();
    const date = ticket.departing_on ? formatDateToDMMMY(ticket.departing_on) : '';
    return `${departure}-${destination}|${date}`;
}

export function analyzeInvoiceScenario(pnrList) {
    if (!pnrList || pnrList.length === 0) {
        return { type: 'ERROR', message: 'No PNRs provided.' };
    }

    const cleanPnrs = pnrList.map((pnr) => pnr.trim().toUpperCase()).filter(Boolean);
    const tickets = state.allTickets.filter((ticket) => cleanPnrs.includes(ticket.booking_reference));

    if (tickets.length === 0) {
        return { type: 'ERROR', message: 'No matching tickets found.' };
    }

    const uniquePnrs = [...new Set(tickets.map((ticket) => ticket.booking_reference))];
    const uniqueClients = [...new Set(tickets.map((ticket) => normalizeClientName(ticket.name)))];

    const clientRouteSets = {};
    tickets.forEach((ticket) => {
        const clientName = normalizeClientName(ticket.name);
        const routeSignature = getRouteSignature(ticket);
        if (!clientRouteSets[clientName]) clientRouteSets[clientName] = new Set();
        clientRouteSets[clientName].add(routeSignature);
    });

    const clientNames = Object.keys(clientRouteSets);
    let isSharedItinerary = true;

    if (clientNames.length > 1) {
        const firstSignature = Array.from(clientRouteSets[clientNames[0]]).sort().join('||');
        for (let index = 1; index < clientNames.length; index += 1) {
            const currentSignature = Array.from(clientRouteSets[clientNames[index]]).sort().join('||');
            if (currentSignature !== firstSignature) {
                isSharedItinerary = false;
                break;
            }
        }
    }

    if (uniquePnrs.length === 1) {
        if (uniqueClients.length > 1) {
            return isSharedItinerary
                ? { code: 'SCENARIO_1', type: 'CHOICE', canChoose: true }
                : { code: 'SCENARIO_1_MIXED', type: 'COMBINED', canChoose: false };
        }
        return { code: 'STANDARD', type: 'COMBINED', canChoose: false };
    }

    if (uniquePnrs.length > 1 && uniqueClients.length === 1) {
        return { code: 'SCENARIO_2', type: 'COMBINED', canChoose: false };
    }

    if (uniquePnrs.length > 1 && uniqueClients.length > 1) {
        if (isSharedItinerary) {
            return { code: 'SCENARIO_3', type: 'COMBINED', canChoose: false };
        }

        return {
            code: 'SCENARIO_4',
            type: 'ERROR',
            message: 'Cannot generate: Multiple PNRs and Clients have different routes or dates. Please generate separately.'
        };
    }

    return { code: 'DEFAULT', type: 'COMBINED', canChoose: false };
}

export async function generateInvoice(pnrList, type = 'Invoice', dateStr = null, forcedMode = 'auto', brandKey = 'ocean', adjustments = null) {
    const cleanPnrs = pnrList.map((pnr) => pnr.trim().toUpperCase()).filter(Boolean);
    let tickets = state.allTickets.filter((ticket) => cleanPnrs.includes(ticket.booking_reference));

    if (tickets.length === 0) {
        showToast('No tickets found.', 'error');
        return;
    }

    // Apply optional adjustments
    if (adjustments) {
        tickets = tickets.map(ticket => {
            const key = `${ticket.name}_${ticket.booking_reference}_${ticket.leg || 'outbound'}`;
            if (adjustments[key] !== undefined && adjustments[key] !== '') {
                return {
                    ...ticket,
                    extra_fare: (ticket.extra_fare || 0) + (Number(adjustments[key]) || 0)
                };
            }
            return ticket;
        });
    }

    let mode = forcedMode;
    if (mode === 'auto') {
        const scenario = analyzeInvoiceScenario(pnrList);
        if (scenario.type === 'ERROR') {
            showToast(scenario.message, 'error');
            return;
        }
        mode = scenario.canChoose ? 'separate' : 'combined';
    }

    const invoiceGroups = buildInvoiceGroups(tickets, mode);
    const brand = getBrandConfig(brandKey);
    const theme = brand.theme || INVOICE_THEME;
    const logoAsset = await loadImageAsset(brand.logoUrl);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    invoiceGroups.forEach((group, index) => {
        if (index > 0) doc.addPage();
        const data = buildInvoiceDocumentData(group, type, brand, dateStr, index, invoiceGroups.length, mode);
        renderInvoicePage(doc, data, logoAsset, theme);
    });

    const safeName = invoiceGroups[0].clientName.split(',')[0].replace(/[^a-z0-9]/gi, '_');
    const safeBrand = brand.displayName.replace(/[^a-z0-9]/gi, '_');
    doc.save(`${safeName}_${safeBrand}_${type}.pdf`);
}

export async function generateInvoiceImage(pnrList, type = 'Invoice', dateStr = null, forcedMode = 'auto', brandKey = 'ocean', adjustments = null) {
    try {
        await loadHtml2Canvas();
    } catch (error) {
        showToast('Could not load image generation library.', 'error');
        return;
    }

    const cleanPnrs = pnrList.map((pnr) => pnr.trim().toUpperCase()).filter(Boolean);
    let tickets = state.allTickets.filter((ticket) => cleanPnrs.includes(ticket.booking_reference));

    if (tickets.length === 0) {
        showToast('No tickets found.', 'error');
        return;
    }

    // Apply optional adjustments
    if (adjustments) {
        tickets = tickets.map(ticket => {
            const key = `${ticket.name}_${ticket.booking_reference}_${ticket.leg || 'outbound'}`;
            if (adjustments[key] !== undefined && adjustments[key] !== '') {
                return {
                    ...ticket,
                    extra_fare: (ticket.extra_fare || 0) + (Number(adjustments[key]) || 0)
                };
            }
            return ticket;
        });
    }

    let mode = forcedMode;
    if (mode === 'auto') {
        const scenario = analyzeInvoiceScenario(pnrList);
        if (scenario.type === 'ERROR') {
            showToast(scenario.message, 'error');
            return;
        }
        mode = scenario.canChoose ? 'separate' : 'combined';
    }

    const invoiceGroups = buildInvoiceGroups(tickets, mode);
    const brand = getBrandConfig(brandKey);
    const theme = brand.theme || INVOICE_THEME;
    const logoAsset = await loadImageAsset(brand.logoUrl);
    const logoSrc = logoAsset?.dataUrl || brand.logoUrl;

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '-9999px';
    container.style.left = '-9999px';

    const style = document.createElement('style');
    style.innerHTML = getInvoiceCSS(theme);
    document.head.appendChild(style);
    document.body.appendChild(container);

    for (let index = 0; index < invoiceGroups.length; index += 1) {
        const data = buildInvoiceDocumentData(
            invoiceGroups[index],
            type,
            brand,
            dateStr,
            index,
            invoiceGroups.length,
            mode,
            logoSrc
        );

        container.innerHTML = buildInvoiceHtml(data);
        await waitForImages(container);

        try {
            const invoiceNode = container.querySelector('.invoice-container');
            const canvas = await window.html2canvas(invoiceNode, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff'
            });

            const link = document.createElement('a');
            const safeName = data.group.clientName.split(',')[0].replace(/[^a-z0-9]/gi, '_');
            const safeBrand = brand.displayName.replace(/[^a-z0-9]/gi, '_');
            link.download = `${safeName}_${safeBrand}_${type}${invoiceGroups.length > 1 ? `-${index + 1}` : ''}.png`;
            link.href = canvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            await new Promise((resolve) => setTimeout(resolve, 400));
        } catch (error) {
            console.error(error);
            showToast('Failed to generate image.', 'error');
        }
    }

    document.body.removeChild(container);
    document.head.removeChild(style);
}
