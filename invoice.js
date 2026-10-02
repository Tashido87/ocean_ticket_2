/**
 * @fileoverview Handles invoice/receipt generation for PDF and image exports.
 * Supports shared invoice logic with switchable branding.
 */

import { formatDateToDMMMY, parseSheetDate, showToast, isFeeEntryRow, isTicketPaid } from './utils.js';
import { selectPassengerTickets, receiptPaymentLabels } from './invoice-selection.mjs?v=2';
import { state } from './state.js';

const INVOICE_THEME = {
    accentHex: '#AA0F11',
    accentRgb: [170, 15, 17],
    accentSoftRgb: [247, 248, 249],
    accentBorderRgb: [226, 230, 234],
    secondaryHex: '#AA0F11',
    secondaryRgb: [170, 15, 17],
    charcoalHex: '#232323',
    charcoalRgb: [35, 35, 35],
    lightTintHex: '#F7F8F9',
    lightTintRgb: [247, 248, 249],
    mutedHex: '#5F6B78',
    mutedRgb: [95, 107, 120],
    lineHex: '#E2E6EA',
    lineRgb: [226, 230, 234]
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
            'A3-1, Room 603, Myanma Gone Yi Housing, Upper Pansodan Street, Mingalar Taungnyunt Township, Yangon'
        ],
        phones: ['09964403435', '09740862500'],
        email: 'oceantravel.mm@gmail.com',
        tagline: 'EXPLORE. DISCOVER. EXPERIENCE.',
        theme: {
            accentHex: '#AA0F11',
            accentRgb: [170, 15, 17],
            accentSoftRgb: [247, 248, 249],
            accentBorderRgb: [226, 230, 234],
            secondaryHex: '#AA0F11',
            secondaryRgb: [170, 15, 17],
            charcoalHex: '#232323',
            charcoalRgb: [35, 35, 35],
            lightTintHex: '#F7F8F9',
            lightTintRgb: [247, 248, 249],
            mutedHex: '#5F6B78',
            mutedRgb: [95, 107, 120],
            lineHex: '#E2E6EA',
            lineRgb: [226, 230, 234]
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
            'Room No. 1202, A-32, Myanma Gonyi Housing, Upper Pansodan St, Mingalar Taungnyunt Township, Yangon'
        ],
        phones: ['09964026208'],
        email: 'magicalandticket@gmail.com',
        tagline: 'MAGICAL LAND TRAVEL & TOUR',
        theme: {
            accentHex: '#4A357D',
            accentRgb: [74, 53, 125],
            accentSoftRgb: [245, 242, 252],
            accentBorderRgb: [221, 212, 244],
            secondaryHex: '#F0582C',
            secondaryRgb: [240, 88, 44],
            charcoalHex: '#232323',
            charcoalRgb: [35, 35, 35],
            lightTintHex: '#F7F8F9',
            lightTintRgb: [247, 248, 249],
            mutedHex: '#5F6B78',
            mutedRgb: [95, 107, 120],
            lineHex: '#E2E6EA',
            lineRgb: [226, 230, 234]
        }
    }
};

const BANK_CARDS = [
    {
        bank: 'KBZ',
        items: [
            { label: 'KBZ Pay', account: '09740862500' },
            { label: 'Special Account', account: '02051102000725501' },
            { label: 'Normal Account', account: '18230199926109801' }
        ]
    },
    {
        bank: 'AYA',
        items: [
            { label: 'AYA Pay', account: '09740862500' },
            { label: 'Banking', account: '40039173610' }
        ]
    },
    {
        bank: 'UAB Bank',
        items: [
            { label: 'UAB Pay', account: '09740862500' },
            { label: 'UAB Banking', account: '20010588572' }
        ]
    }
];

const BANK_ACCOUNTS = [
    { bank: 'KBZ Pay', account: '09740862500', name: 'Aung Pyae Sone' },
    { bank: 'KBZ Special Account', account: '02051102000725501', name: 'Aung Pyae Sone' },
    { bank: 'KBZ Normal Account', account: '18230199926109801', name: 'Aung Pyae Sone' },
    { bank: 'AYA Pay', account: '09740862500', name: 'Aung Pyae Sone' },
    { bank: 'AYA Banking', account: '40039173610', name: 'Aung Pyae Sone' },
    { bank: 'UAB Pay', account: '09740862500', name: 'Aung Pyae Sone' },
    { bank: 'UAB Banking', account: '20010588572', name: 'Aung Pyae Sone' }
];

const ACCOUNT_OWNER_NAME = 'Aung Pyae Sone';

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
    const primaryRed = theme.accentHex || '#AA0F11';
    const charcoal = theme.charcoalHex || '#232323';
    const lightTint = theme.lightTintHex || '#F7F8F9';
    const mutedGray = theme.mutedHex || '#5F6B78';
    const hairline = theme.lineHex || '#E2E6EA';

    return `
        .invoice-container {
            width: 794px;
            min-height: 1123px;
            box-sizing: border-box;
            padding: 44px 56px 40px;
            background: #ffffff;
            color: ${charcoal};
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
        }
        .inv-brand {
            width: 220px;
        }
        .inv-brand img {
            display: block;
            width: 200px;
            height: auto;
            object-fit: contain;
            object-position: left top;
        }
        .inv-top-right {
            text-align: right;
        }
        .inv-doc-type {
            margin: 0 0 4px;
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 0.04em;
            color: ${charcoal};
        }
        .inv-doc-id {
            margin: 0 0 3px;
            font-size: 13px;
            color: ${mutedGray};
        }
        .inv-doc-date {
            margin: 0;
            font-size: 13px;
            color: ${mutedGray};
        }
        .inv-company-lines {
            margin-top: 14px;
        }
        .inv-company-lines p {
            margin: 0 0 3px;
            font-size: 10.5px;
            color: ${mutedGray};
            line-height: 1.4;
        }
        .inv-header-rule {
            height: 2.5px;
            background: ${primaryRed};
            margin: 12px 0 18px;
            border: none;
        }
        .inv-billing-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 22px;
        }
        .inv-billed-label {
            font-size: 10px;
            font-weight: 700;
            color: ${primaryRed};
            margin-bottom: 4px;
            letter-spacing: 0.05em;
        }
        .inv-client-name {
            font-size: 18px;
            font-weight: 700;
            color: ${charcoal};
            margin-bottom: 4px;
        }
        .inv-pnr {
            font-size: 11.5px;
            color: ${charcoal};
        }
        .inv-meta-right {
            display: flex;
            flex-direction: column;
            gap: 5px;
            min-width: 200px;
        }
        .inv-meta-row {
            display: flex;
            justify-content: space-between;
            font-size: 11.5px;
        }
        .inv-meta-label {
            color: ${mutedGray};
        }
        .inv-meta-val {
            font-weight: 700;
            color: ${charcoal};
        }
        .inv-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
        }
        .inv-table th {
            padding: 8px 6px;
            border-bottom: 1px solid ${hairline};
            font-size: 10.5px;
            font-weight: 700;
            color: ${mutedGray};
        }
        .inv-table td {
            padding: 9px 6px;
            border-bottom: 1px solid ${hairline};
            font-size: 11.5px;
            color: ${charcoal};
        }
        .inv-table tr:nth-child(even) td {
            background: ${lightTint};
        }
        .inv-table th.col-desc, .inv-table td.col-desc { text-align: left; }
        .inv-table th.col-qty, .inv-table td.col-qty { text-align: center; }
        .inv-table th.col-rate, .inv-table td.col-rate { text-align: right; }
        .inv-table th.col-amt, .inv-table td.col-amt { text-align: right; font-weight: 700; }
        .inv-totals-section {
            width: 280px;
            margin-left: auto;
            margin-top: 4px;
            margin-bottom: 22px;
        }
        .inv-total-line {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: ${mutedGray};
            padding: 4px 0;
        }
        .inv-total-line.bold {
            color: ${charcoal};
            font-weight: 700;
        }
        .inv-balance-pill {
            background: ${primaryRed};
            border-radius: 6px;
            padding: 9px 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #ffffff;
            font-weight: 700;
            font-size: 13px;
            letter-spacing: 0.03em;
            margin-top: 8px;
        }
        .inv-thank-you {
            text-align: center;
            font-style: italic;
            font-size: 12.5px;
            color: ${mutedGray};
            margin-bottom: 20px;
        }
        .inv-payment-section {
            margin-bottom: auto;
        }
        .inv-payment-title {
            font-size: 12px;
            font-weight: 700;
            color: ${charcoal};
            letter-spacing: 0.04em;
            margin-bottom: 4px;
        }
        .inv-account-name {
            font-size: 13px;
            font-weight: 700;
            color: ${primaryRed};
            margin-bottom: 12px;
        }
        .inv-bank-cards {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 14px;
        }
        .inv-bank-card {
            background: ${lightTint};
            border: 1px solid ${hairline};
            border-radius: 6px;
            overflow: hidden;
        }
        .inv-bank-card-header {
            background: ${charcoal};
            color: #ffffff;
            font-weight: 700;
            font-size: 11.5px;
            padding: 6px 12px;
            border-bottom: 2px solid ${primaryRed};
        }
        .inv-bank-card-body {
            padding: 8px 12px 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .inv-bank-row {
            line-height: 1.35;
        }
        .inv-bank-label {
            font-size: 9.5px;
            color: ${mutedGray};
        }
        .inv-bank-acc {
            font-size: 11.5px;
            font-weight: 700;
            color: ${charcoal};
        }
        .inv-footer {
            margin-top: auto;
            text-align: center;
            padding-top: 24px;
        }
        .inv-footer-tagline {
            font-size: 11px;
            font-weight: 700;
            color: ${primaryRed};
            letter-spacing: 0.08em;
            margin-bottom: 5px;
        }
        .inv-footer-line {
            width: 70px;
            height: 1px;
            background: ${hairline};
            margin: 0 auto 6px;
        }
        .inv-footer-contact {
            font-size: 10px;
            color: ${mutedGray};
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
        const route = `${(ticket.departure || '').split(' ')[0]} – ${(ticket.destination || '').split(' ')[0]}`;
        const airline = ticket.airline || '';
        const price = (ticket.net_amount || 0) + (ticket.extra_fare || 0) + (ticket.sub_agent_fare || 0);
        
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
        const parts = [route, dateStr];
        if (airline) parts.push(airline);
        return {
            description: `${prefix}${parts.join(' · ')}${ticket.invoicePassengerSelection ? ` — PNR: ${ticket.booking_reference}` : ''}`,
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
    const receiptLabels = receiptPaymentLabels(group.tickets, isTicketPaid);
    const documentDate = resolveDocumentDate(dateStr);
    const lineItems = buildInvoiceLineItems(group.tickets, mode);
    const totalAmount = group.tickets.reduce(
        (sum, ticket) => sum + (ticket.net_amount || 0) + (ticket.extra_fare || 0) + (ticket.sub_agent_fare || 0),
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
        documentStatusValue: type === 'Invoice' ? 'Due on Receipt' : receiptLabels.status,
        balanceLabel: type === 'Invoice' ? 'Balance Due' : receiptLabels.totalLabel
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

function buildInvoiceHtml(data) {
    const { brand, type, group, lineItems, totalAmount, logoSrc, formattedDate, documentId, documentStatusLabel, documentStatusValue, balanceLabel } = data;

    const tableRows = lineItems.map((item) => `
        <tr>
            <td class="col-desc">${escapeHtml(item.description)}</td>
            <td class="col-qty">${formatQuantity(item.qty)}</td>
            <td class="col-rate">${formatMoney(item.rate)}</td>
            <td class="col-amt">${formatMoney(item.amount)}</td>
        </tr>
    `).join('');

    const bankCardsHtml = BANK_CARDS.map((card) => `
        <div class="inv-bank-card">
            <div class="inv-bank-card-header">${escapeHtml(card.bank)}</div>
            <div class="inv-bank-card-body">
                ${card.items.map((item) => `
                    <div class="inv-bank-row">
                        <div class="inv-bank-label">${escapeHtml(item.label)}</div>
                        <div class="inv-bank-acc">${escapeHtml(item.account)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    return `
        <div class="invoice-container">
            <div class="inv-main">
                <div class="inv-top">
                    <div class="inv-brand">
                        <img src="${logoSrc}" alt="${escapeHtml(brand.displayName)} logo" />
                    </div>
                    <div class="inv-top-right">
                        <h1 class="inv-doc-type">${escapeHtml(type.toUpperCase())}</h1>
                        <p class="inv-doc-id">${escapeHtml(documentId)}</p>
                        <p class="inv-doc-date">${escapeHtml(formattedDate)} · Due on Receipt</p>
                    </div>
                </div>

                <div class="inv-company-lines">
                    <p>${(brand.addressLines || []).map(escapeHtml).join('<br>')}</p>
                    <p>${[...(brand.phones || []), brand.email].filter(Boolean).map(escapeHtml).join(' · ')}</p>
                </div>

                <hr class="inv-header-rule" />

                <div class="inv-billing-row">
                    <div>
                        <div class="inv-billed-label">BILLED TO</div>
                        <div class="inv-client-name">${escapeHtml(group.clientName)}</div>
                        <div class="inv-pnr">PNR: ${escapeHtml(group.pnrs.join(', '))}</div>
                    </div>
                    <div class="inv-meta-right">
                        <div class="inv-meta-row"><span class="inv-meta-label">${escapeHtml(type)} Date</span><span class="inv-meta-val">${escapeHtml(formattedDate)}</span></div>
                        <div class="inv-meta-row"><span class="inv-meta-label">Terms</span><span class="inv-meta-val">Due on Receipt</span></div>
                        <div class="inv-meta-row"><span class="inv-meta-label">${escapeHtml(type)} #</span><span class="inv-meta-val">${escapeHtml(documentId)}</span></div>
                    </div>
                </div>

                <table class="inv-table">
                    <thead>
                        <tr>
                            <th class="col-desc">DESCRIPTION</th>
                            <th class="col-qty">QTY</th>
                            <th class="col-rate">RATE (MMK)</th>
                            <th class="col-amt">AMOUNT (MMK)</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>

                <div class="inv-totals-section">
                    <div class="inv-total-line"><span>Sub Total</span><span>${formatCurrency(totalAmount)}</span></div>
                    <div class="inv-total-line bold"><span>Total</span><span>${formatCurrency(totalAmount)}</span></div>
                    <div class="inv-balance-pill">
                        <span>${escapeHtml((balanceLabel || 'BALANCE DUE').toUpperCase())}</span>
                        <span>${formatCurrency(totalAmount)}</span>
                    </div>
                </div>

                <div class="inv-thank-you">Thank you for choosing ${escapeHtml(brand.displayName)}.</div>

                <div class="inv-payment-section">
                    <div class="inv-payment-title">PAYMENT METHODS</div>
                    <div class="inv-account-name">Account Name: ${ACCOUNT_OWNER_NAME.toUpperCase()}</div>
                    <div class="inv-bank-cards">
                        ${bankCardsHtml}
                    </div>
                </div>

                <div class="inv-footer">
                    <div class="inv-footer-tagline">${escapeHtml(brand.tagline || 'EXPLORE. DISCOVER. EXPERIENCE.')}</div>
                    <div class="inv-footer-line"></div>
                    <div class="inv-footer-contact">${escapeHtml((brand.legalName || brand.displayName).toUpperCase())} · ${escapeHtml(brand.email)} · ${(brand.phones || []).map(escapeHtml).join(' / ')}</div>
                </div>
            </div>
        </div>
    `;
}

function renderPaymentSection(doc, startY, theme = INVOICE_THEME, brand = BRANDS.ocean) {
    const primaryRed = theme.accentRgb || [170, 15, 17];
    const charcoal = theme.charcoalRgb || [35, 35, 35];
    const mutedGray = theme.mutedRgb || [95, 107, 120];
    const hairline = theme.lineRgb || [226, 230, 234];
    const lightTint = theme.lightTintRgb || [247, 248, 249];

    // 5. THANK-YOU
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...mutedGray);
    doc.text(`Thank you for choosing ${brand.displayName || 'Ocean Travel'}.`, 105, startY, { align: 'center' });

    // 6. PAYMENT METHODS
    const payY = startY + 9;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...charcoal);
    doc.text('PAYMENT METHODS', 15, payY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...primaryRed);
    doc.text(`Account Name: ${ACCOUNT_OWNER_NAME.toUpperCase()}`, 15, payY + 5.5);

    const cardW = 57;
    const cardGap = 4.5;
    const cardsY = payY + 9.5;
    const cardH = 37.5;

    BANK_CARDS.forEach((card, idx) => {
        const cx = 15 + idx * (cardW + cardGap);
        
        // Background and border
        doc.setFillColor(...lightTint);
        doc.setDrawColor(...hairline);
        doc.setLineWidth(0.2);
        doc.roundedRect(cx, cardsY, cardW, cardH, 2, 2, 'FD');
        
        // Charcoal header
        doc.setFillColor(...charcoal);
        doc.roundedRect(cx, cardsY, cardW, 6.5, 2, 2, 'F');
        doc.rect(cx, cardsY + 3.5, cardW, 3, 'F'); // square bottom corners
        
        // 1mm red underline
        doc.setFillColor(...primaryRed);
        doc.rect(cx, cardsY + 6.5, cardW, 1.0, 'F');
        
        // Header title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(255, 255, 255);
        doc.text(card.bank, cx + 5, cardsY + 4.8);
        
        // Rows
        let iy = cardsY + 11.5;
        card.items.forEach((item) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.8);
            doc.setTextColor(...mutedGray);
            doc.text(item.label, cx + 5, iy);
            
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.3);
            doc.setTextColor(...charcoal);
            doc.text(item.account, cx + 5, iy + 4.0);
            
            iy += 8.2;
        });
    });

    // 7. FOOTER
    const footerY = 278;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...primaryRed);
    doc.text(brand.tagline || 'EXPLORE. DISCOVER. EXPERIENCE.', 105, footerY, { align: 'center' });

    doc.setDrawColor(...hairline);
    doc.setLineWidth(0.3);
    doc.line(90, footerY + 2.8, 120, footerY + 2.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.3);
    doc.setTextColor(...mutedGray);
    const phonesStr = Array.isArray(brand.phones) ? brand.phones.join(' · ') : (brand.phones || '');
    const footerText = `${(brand.legalName || brand.displayName || 'OCEAN TRAVEL').toUpperCase()} · ${brand.email || ''} · ${phonesStr}`;
    doc.text(footerText, 105, footerY + 7.2, { align: 'center' });
}

function renderInvoicePage(doc, data, logoAsset, theme = INVOICE_THEME) {
    const { brand, type, group, lineItems, totalAmount, formattedDate, documentId, documentStatusLabel, documentStatusValue, balanceLabel } = data;
    const pageHeight = doc.internal.pageSize.getHeight();

    const primaryRed = theme.accentRgb || [170, 15, 17];
    const charcoal = theme.charcoalRgb || [35, 35, 35];
    const mutedGray = theme.mutedRgb || [95, 107, 120];
    const hairline = theme.lineRgb || [226, 230, 234];
    const lightTint = theme.lightTintRgb || [247, 248, 249];

    // 1. HEADER
    if (logoAsset && logoAsset.dataUrl) {
        const logoW = 54;
        const logoH = logoAsset.height ? logoW * (logoAsset.height / logoAsset.width) : 21;
        doc.addImage(logoAsset.dataUrl, 'PNG', 15, 14, logoW, logoH);
    } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(...primaryRed);
        doc.text(brand.displayName || 'OCEAN TRAVEL', 15, 22);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(...charcoal);
    doc.text(type.toUpperCase(), 195, 22, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(...mutedGray);
    doc.text(documentId, 195, 28, { align: 'right' });
    doc.text(`${formattedDate} · Due on Receipt`, 195, 33.5, { align: 'right' });

    doc.setFontSize(8.3);
    const addr = (brand.addressLines || []).join(', ');
    const phones = (brand.phones || []).join(' · ');
    doc.text(addr, 15, 40);
    doc.text(`${phones} · ${brand.email || ''}`, 15, 44.5);

    // Full width red rule 0.7mm thick
    doc.setDrawColor(...primaryRed);
    doc.setLineWidth(0.7);
    doc.line(15, 48, 195, 48);

    // 2. BILLING ROW
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...primaryRed);
    doc.text('BILLED TO', 15, 54.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14.5);
    doc.setTextColor(...charcoal);
    const splitClientName = doc.splitTextToSize(group.clientName, 100);
    doc.text(splitClientName, 15, 60.5);

    const clientBottom = 60.5 + ((splitClientName.length - 1) * 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...charcoal);
    doc.text(`PNR: ${group.pnrs.join(', ')}`, 15, clientBottom + 5.5);

    // Right details
    const rightLabelX = 142;
    doc.setFontSize(9);
    doc.setTextColor(...mutedGray);
    doc.text(`${type} Date`, rightLabelX, 54.5);
    doc.text('Terms', rightLabelX, 60.5);
    doc.text(`${type} #`, rightLabelX, 66);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...charcoal);
    doc.text(formattedDate, 195, 54.5, { align: 'right' });
    doc.text('Due on Receipt', 195, 60.5, { align: 'right' });
    doc.text(documentId, 195, 66, { align: 'right' });

    // 3. ITEMS TABLE
    const head = [['DESCRIPTION', 'QTY', 'RATE (MMK)', 'AMOUNT (MMK)']];
    const body = lineItems.map((item) => [
        item.description,
        formatQuantity(item.qty),
        formatMoney(item.rate),
        formatMoney(item.amount)
    ]);

    const tableStartY = Math.max(72, clientBottom + 12);

    doc.autoTable({
        startY: tableStartY,
        head: head,
        body: body,
        theme: 'plain',
        headStyles: {
            fillColor: [255, 255, 255],
            textColor: mutedGray,
            fontStyle: 'bold',
            fontSize: 8.5,
            cellPadding: { top: 2.8, bottom: 2.8, left: 2, right: 2 },
            lineWidth: { bottom: 0.2 },
            lineColor: hairline
        },
        styles: {
            fontSize: 9.3,
            textColor: charcoal,
            cellPadding: { top: 3.2, bottom: 3.2, left: 2, right: 2 },
            lineWidth: { bottom: 0.15 },
            lineColor: hairline
        },
        alternateRowStyles: {
            fillColor: lightTint
        },
        columnStyles: {
            0: { halign: 'left', cellWidth: 94 },
            1: { halign: 'center', cellWidth: 16 },
            2: { halign: 'right', cellWidth: 35 },
            3: { halign: 'right', cellWidth: 35, fontStyle: 'bold' }
        },
        margin: { left: 15, right: 15 }
    });

    const finalY = doc.lastAutoTable.finalY;

    // 4. TOTALS
    const totalsLabelX = 145;
    const totalsValX = 195;
    let curY = finalY + 6.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...mutedGray);
    doc.text('Sub Total', totalsLabelX, curY);
    doc.setTextColor(...charcoal);
    doc.text(formatCurrency(totalAmount), totalsValX, curY, { align: 'right' });

    curY += 5.5;
    doc.setTextColor(...mutedGray);
    doc.text('Total', totalsLabelX, curY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...charcoal);
    doc.text(formatCurrency(totalAmount), totalsValX, curY, { align: 'right' });

    curY += 4.5;
    // BALANCE DUE pill
    const pillX = 100;
    const pillW = 95;
    const pillH = 10;
    doc.setFillColor(...primaryRed);
    doc.roundedRect(pillX, curY, pillW, pillH, 2.2, 2.2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    const balancePillText = (balanceLabel || 'BALANCE DUE').toUpperCase();
    doc.text(balancePillText, pillX + 6, curY + 6.6);
    doc.text(formatCurrency(totalAmount), pillX + pillW - 6, curY + 6.6, { align: 'right' });

    const thankY = curY + pillH + 11;
    if (thankY + 75 > pageHeight) {
        doc.addPage();
        renderPaymentSection(doc, 25, theme, brand);
    } else {
        renderPaymentSection(doc, thankY, theme, brand);
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

export async function generateInvoice(pnrList, type = 'Invoice', dateStr = null, forcedMode = 'auto', brandKey = 'ocean', adjustments = null, selection = null) {
    const cleanPnrs = pnrList.map((pnr) => pnr.trim().toUpperCase()).filter(Boolean);
    let tickets = state.allTickets.filter((ticket) => cleanPnrs.includes(ticket.booking_reference));
    if (selection) {
        tickets = selectPassengerTickets(state.allTickets, pnrList, selection, type, isTicketPaid);
        forcedMode = 'separate';
        adjustments = null;
    }

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

export async function generateInvoiceImage(pnrList, type = 'Invoice', dateStr = null, forcedMode = 'auto', brandKey = 'ocean', adjustments = null, selection = null, isShare = false) {
    try {
        await loadHtml2Canvas();
    } catch (error) {
        showToast('Could not load image generation library.', 'error');
        if (selection) throw error;
        return;
    }

    const cleanPnrs = pnrList.map((pnr) => pnr.trim().toUpperCase()).filter(Boolean);
    let tickets = state.allTickets.filter((ticket) => cleanPnrs.includes(ticket.booking_reference));
    if (selection) {
        tickets = selectPassengerTickets(state.allTickets, pnrList, selection, type, isTicketPaid);
        forcedMode = 'separate';
        adjustments = null;
    }

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

            const safeName = data.group.clientName.split(',')[0].replace(/[^a-z0-9]/gi, '_');
            const safeBrand = brand.displayName.replace(/[^a-z0-9]/gi, '_');
            const filename = `${safeName}_${safeBrand}_${type}${invoiceGroups.length > 1 ? `-${index + 1}` : ''}.png`;

            // Always download the invoice image first
            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            await new Promise((resolve) => setTimeout(resolve, 300));

            if (isShare && navigator.share && navigator.canShare) {
                const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                if (blob) {
                    const file = new File([blob], filename, { type: 'image/png' });
                    if (navigator.canShare({ files: [file] })) {
                        try {
                            await navigator.share({
                                files: [file],
                                title: `${brand.displayName} - ${type}`,
                                text: `${type} for ${data.group.clientName}`
                            });
                            showToast('Invoice shared successfully!', 'success');
                        } catch (err) {
                            if (err.name !== 'AbortError') console.warn('Share error:', err);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(error);
            showToast('Failed to generate image.', 'error');
            if (selection) {
                container.remove();
                style.remove();
                throw error;
            }
        }
    }

    document.body.removeChild(container);
    document.head.removeChild(style);
}
