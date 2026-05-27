/**
 * @fileoverview Manages the generation and exporting of PDF reports.
 */

import {
    state
} from './state.js';
import {
    showToast,
    parseSheetDate,
    formatDateToDMMMY
} from './utils.js';

/**
 * Toggles the disabled state of the "Private Report" button based on date input.
 */
export function togglePrivateReportButton() {
    const startDate = document.getElementById('searchStartDate').value;
    const endDate = document.getElementById('searchEndDate').value;
    const btn = document.getElementById('exportPrivateReportBtn');
    if (btn) {
        btn.disabled = !(startDate && endDate);
    }
}

export function exportSelectedToExcel() {
    const filtered = state.filteredTickets || [];
    if (filtered.length === 0) {
        showToast('No records found to export.', 'error');
        return;
    }

    let itemsToExport = [];

    // Flatten any grouped records if they are grouped
    filtered.forEach(item => {
        if (item._grouped) {
            if (Array.isArray(item.tickets)) {
                item.tickets.forEach(subItem => {
                    itemsToExport.push(subItem);
                });
            }
        } else {
            itemsToExport.push(item);
        }
    });

    if (itemsToExport.length === 0) {
        showToast('No valid records found for export.', 'error');
        return;
    }

    // Sort itemsToExport by date ascending (oldest first)
    itemsToExport.sort((a, b) => {
        const dateA = parseSheetDate(a.issued_date || a.checkin);
        const dateB = parseSheetDate(b.issued_date || b.checkin);
        
        if (dateA && dateB && !isNaN(dateA) && !isNaN(dateB)) {
            const diff = dateA - dateB;
            if (diff !== 0) return diff;
        }
        
        const getMs = (ts) => {
            if (!ts) return 0;
            if (typeof ts.toMillis === 'function') return ts.toMillis();
            if (ts.seconds) return ts.seconds * 1000;
            return 0;
        };
        return getMs(a.createdAt) - getMs(b.createdAt);
    });

    // Prepare CSV data
    const headers = ['Type', 'Date', 'Name', 'PNR / Booking Ref', 'Route / Location', 'Airline', 'Net Amount', 'Commission', 'Extra Fare', 'Date Change', 'Status/Remarks'];
    const rows = [headers];

    itemsToExport.forEach(item => {
        if (item._isHotel) {
            rows.push([
                'Hotel',
                item.checkin || item.issued_date || '',
                item.client_name || item.name || '',
                item.booking_ref || item.booking_reference || '',
                item.destination || `${item.hotel_name || ''} (${item.city || ''}, ${item.country || ''})`,
                '—',
                item.net_amount || 0,
                item.commission || 0,
                0,
                0,
                item.notes || item.remarks || ''
            ]);
        } else {
            rows.push([
                'Ticket',
                item.issued_date || '',
                item.name || '',
                item.booking_reference || '',
                `${(item.departure || '')} - ${(item.destination || '')}`,
                item.airline || '',
                item.net_amount || 0,
                item.commission || 0,
                item.extra_fare || 0,
                item.date_change || 0,
                item.remarks || ''
            ]);
        }
    });

    // Escape CSV values
    const csvContent = rows.map(e => e.map(val => {
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }).join(',')).join('\n');

    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const dateStr = formatDateToDMMMY(new Date()).replace(/ /g, '_');
    link.setAttribute('download', `ocean_records_export_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Successfully exported ${itemsToExport.length} records to Excel.`);
}

/**
 * Exports the Agent Report to a PDF file.
 */
export async function exportToPdf() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const exportType = document.querySelector('input[name="exportType"]:checked').value;
    const isMerged = document.getElementById('mergeToggle')?.checked;
    const exportConfirmModal = document.getElementById('exportConfirmModal');

    let ticketsToExport = [];
    let hotelsToExport = [];
    let startDate, endDate;
    let dateRangeString = '';

    if (exportType === 'filtered') {
        ticketsToExport = state.filteredTickets;
        hotelsToExport = state.filteredHotels || [];
    } else {
        const startDateStr = document.getElementById('exportStartDate').value;
        const endDateStr = document.getElementById('exportEndDate').value;
        startDate = parseSheetDate(startDateStr);
        endDate = parseSheetDate(endDateStr);

        if (!startDate || !endDate || isNaN(startDate) || isNaN(endDate)) {
            showToast('Please select a valid date range.', 'error');
            return;
        }
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        dateRangeString = `${formatDateToDMMMY(startDate)} to ${formatDateToDMMMY(endDate)}`;

        ticketsToExport = state.allTickets.filter(t => {
            const issuedDate = parseSheetDate(t.issued_date);
            return issuedDate >= startDate && issuedDate <= endDate && t.source !== 'self';
        });

        hotelsToExport = (state.allHotels || []).filter(h => {
            const checkinDate = parseSheetDate(h.checkin);
            return checkinDate >= startDate && checkinDate <= endDate && h.source !== 'self';
        });
    }

    // Ensure self-purchased tickets are excluded for Agent Report regardless of mode (canceled and fee entries are included)
    ticketsToExport = ticketsToExport.filter(t => t.source !== 'self');
    hotelsToExport = hotelsToExport.filter(h => h.source !== 'self');

    const itemsToExport = ticketsToExport.map(t => ({
        date: parseSheetDate(t.issued_date),
        dateStr: t.issued_date,
        type: 'ticket',
        name: t.name,
        pnr: t.booking_reference || '—',
        route: `${(t.departure||'').split('(')[0].trim()} - ${(t.destination||'').split('(')[0].trim()}`,
        net_amount: Number(t.net_amount || 0),
        date_change: Number(t.date_change || 0),
        commission: Number(t.commission || 0)
    }));

    const hotelItems = hotelsToExport.map(h => ({
        date: parseSheetDate(h.checkin),
        dateStr: h.checkin,
        type: 'hotel',
        name: (() => {
            const parsed = parseInt(h.other_names, 10);
            if (h.other_names) {
                return h.client_name + (!isNaN(parsed) ? (parsed > 1 ? ` (+${parsed - 1})` : '') : ` (${h.other_names})`);
            }
            return h.client_name;
        })(),
        pnr: h.booking_ref || '—',
        route: `Hotel: ${h.hotel_name} (${h.city}, ${h.country})`,
        net_amount: Number(h.net_amount || 0),
        date_change: 0,
        commission: Number(h.commission || 0)
    }));

    const combinedItems = [...itemsToExport, ...hotelItems].sort((a, b) => a.date - b.date);

    if (combinedItems.length === 0) {
        showToast('No records to export in the selected range.', 'info');
        exportConfirmModal.classList.remove('show');
        return;
    }

    ticketsToExport.sort((a, b) => parseSheetDate(a.issued_date) - parseSheetDate(b.issued_date));

    // --- Header ---
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Agent Report', 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const reportTypeStr = exportType === 'filtered' ? 'Filtered Results' : `Date Range: ${dateRangeString}`;
    doc.text(reportTypeStr, 105, 20, { align: 'center' });

    // --- Table ---
    let head, body, columnStyles;
    let totalNetAmount = 0, totalDateChange = 0, totalCommission = 0;

    if (isMerged && exportType === 'range') {
        head = [['No.', 'Issued Date', 'Name', 'PNR', 'Route', 'Pax', 'Net Amount', 'Date Change', 'Commission']];
        const mergedData = {};
        ticketsToExport.forEach(t => {
            const key = `${t.account_link}-${t.issued_date}`; // Group by social account and date
            if (!mergedData[key]) {
                mergedData[key] = { ...t, pax: 0, net_amount: 0, date_change: 0, commission: 0, names: new Set() };
            }
            mergedData[key].pax++;
            mergedData[key].net_amount += (t.net_amount || 0);
            mergedData[key].date_change += (t.date_change || 0);
            mergedData[key].commission += (t.commission || 0);
            mergedData[key].names.add(t.name);
        });

        hotelsToExport.forEach(h => {
            const key = `hotel-${h.id}`;
            mergedData[key] = {
                issued_date: h.checkin,
                names: new Set([(() => {
                    const parsed = parseInt(h.other_names, 10);
                    if (h.other_names) {
                        return h.client_name + (!isNaN(parsed) ? (parsed > 1 ? ` (+${parsed - 1})` : '') : ` (${h.other_names})`);
                    }
                    return h.client_name;
                })()]),
                booking_reference: h.booking_ref || '—',
                route: `Hotel: ${h.hotel_name} (${h.city}, ${h.country})`,
                pax: 1,
                net_amount: Number(h.net_amount || 0),
                date_change: 0,
                commission: Number(h.commission || 0),
                _isHotel: true
            };
        });

        const sortedMerged = Object.values(mergedData).sort((a, b) => parseSheetDate(a.issued_date) - parseSheetDate(b.issued_date));

        body = sortedMerged.map((t, index) => {
            const route = t._isHotel ? t.route : `${(t.departure||'').split('(')[0].trim()} - ${(t.destination||'').split('(')[0].trim()}`;
            const clientNames = [...t.names].join(', ');
            return [
                index + 1,
                formatDateToDMMMY(t.issued_date),
                clientNames,
                t.booking_reference,
                route,
                t.pax,
                t.net_amount.toLocaleString(),
                t.date_change.toLocaleString(),
                t.commission.toLocaleString()
            ];
        });

        totalNetAmount = sortedMerged.reduce((sum, t) => sum + t.net_amount, 0);
        totalDateChange = sortedMerged.reduce((sum, t) => sum + t.date_change, 0);
        totalCommission = sortedMerged.reduce((sum, t) => sum + t.commission, 0);

        body.push([
            { content: 'Total', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold' } },
            { content: totalNetAmount.toLocaleString(), styles: { fontStyle: 'bold', halign: 'right' } },
            { content: totalDateChange.toLocaleString(), styles: { fontStyle: 'bold', halign: 'right' } },
            { content: totalCommission.toLocaleString(), styles: { fontStyle: 'bold', halign: 'right' } }
        ]);
        columnStyles = { 5: { halign: 'center' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } };

    } else { // Default behavior if not merged or not a date range export
        head = [['No.', 'Issued Date', 'Name', 'PNR', 'Route', 'Net Amount', 'Date Change', 'Commission']];
        body = combinedItems.map((item, index) => {
            return [
                index + 1,
                formatDateToDMMMY(item.dateStr),
                item.name,
                item.pnr,
                item.route,
                item.net_amount.toLocaleString(),
                item.date_change > 0 ? item.date_change.toLocaleString() : '0',
                item.commission.toLocaleString()
            ];
        });

        totalNetAmount = combinedItems.reduce((sum, item) => sum + item.net_amount, 0);
        totalDateChange = combinedItems.reduce((sum, item) => sum + item.date_change, 0);
        totalCommission = combinedItems.reduce((sum, item) => sum + item.commission, 0);

        body.push([
            { content: 'Total', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
            { content: totalNetAmount.toLocaleString(), styles: { fontStyle: 'bold', halign: 'right' } },
            { content: totalDateChange.toLocaleString(), styles: { fontStyle: 'bold', halign: 'right' } },
            { content: totalCommission.toLocaleString(), styles: { fontStyle: 'bold', halign: 'right' } }
        ]);
        columnStyles = { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } };
    }

    doc.autoTable({
        head: head,
        body: body,
        startY: 25,
        theme: 'grid',
        headStyles: { fillColor: [44, 62, 80], fontSize: 8 },
        styles: { fontSize: 7, cellPadding: 1.5 },
        columnStyles: columnStyles
    });

    let finalY = doc.lastAutoTable.finalY;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageMargin = 15;

    if (finalY + 50 > pageHeight - pageMargin) {
        doc.addPage();
        finalY = pageMargin;
    } else {
        finalY += 10;
    }

    // This calculation now happens *before* the settlement section is built
    let grandTotal = totalNetAmount + totalDateChange;

    if (exportType === 'range') {
        
        // --- Previous Balance Calculation (Corrected Logic with Reset Date) ---
        
        // User requested a hard reset. As of Mar 1, 2026, the balance is 0.
        const RESET_DATE = new Date(2026, 2, 1); // 2 is for March in JS
        
        // 'startDate' is the first day of the reporting period (e.g., Nov 1).
        const reportStartDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        
        let previousEndOfMonthDue = 0;

        if (reportStartDate < RESET_DATE) {
            // --- OLD FLAWED LOGIC (to match old reports like October's) ---
            // This calculates carry-over by ONLY looking at the immediately preceding month.
            const firstDayOfCurrentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
            const lastDayOfPreviousMonth = new Date(firstDayOfCurrentMonth.getTime() - 1);
            const previousMonth = lastDayOfPreviousMonth.getMonth();
            const previousYear = lastDayOfPreviousMonth.getFullYear();

            const ticketsLastMonth = state.allTickets.filter(t => {
                const ticketDate = parseSheetDate(t.issued_date);
                return ticketDate.getMonth() === previousMonth && ticketDate.getFullYear() === previousYear && t.source !== 'self';
            });

            const revenueLastMonth = ticketsLastMonth.reduce((sum, t) => sum + (t.net_amount || 0) + (t.date_change || 0), 0);
            const commissionLastMonth = ticketsLastMonth.reduce((sum, t) => sum + (t.commission || 0), 0);

            const settlementsLastMonth = state.allSettlements.filter(s => {
                const settlementDate = parseSheetDate(s.settlement_date);
                return settlementDate.getMonth() === previousMonth && settlementDate.getFullYear() === previousYear;
            });
            const totalSettlementsLastMonth = settlementsLastMonth.reduce((sum, s) => sum + (s.amount_paid || 0), 0);
            previousEndOfMonthDue = revenueLastMonth - (commissionLastMonth + totalSettlementsLastMonth);
            // --- END OF OLD FLAWED LOGIC ---

        } else {
            // --- NEW CORRECT LOGIC (For Nov 1, 2025 and after) ---
            // This calculates the true running balance *since the last reset*.
            
            // We calculate all transactions from the RESET_DATE up to the start of the current report.
            // e.g., If report is for April (startDate = Apr 1), this finds balance from Mar 1 to Mar 31.
            const filterStartDate = RESET_DATE; // Start counting from Mar 1
            
            const ticketsBefore = state.allTickets.filter(t => {
                const ticketDate = parseSheetDate(t.issued_date);
                return ticketDate >= filterStartDate && ticketDate < startDate && t.source !== 'self';
            });
            const revenueBefore = ticketsBefore.reduce((sum, t) => sum + (t.net_amount || 0) + (t.date_change || 0), 0);
            const commissionBefore = ticketsBefore.reduce((sum, t) => sum + (t.commission || 0), 0);

            const adjustmentsBefore = state.allAdjustments.filter(a => {
                const adjDate = parseSheetDate(a.adjustment_date);
                return adjDate >= filterStartDate && adjDate < startDate;
            });
            const totalAdjustmentsBefore = adjustmentsBefore.reduce((sum, a) => {
                const amt = Number(a.amount || 0);
                if (a.type === 'Owner Debit' || a.type === 'Refund') return sum + amt;
                if (a.type === 'Owner Credit' || a.type === 'Correction') return sum - amt;
                return sum + amt;
            }, 0);

            const settlementsBefore = state.allSettlements.filter(s => {
                const settlementDate = parseSheetDate(s.settlement_date);
                return settlementDate >= filterStartDate && settlementDate < startDate;
            });
            const totalSettlementsBefore = settlementsBefore.reduce((sum, s) => sum + (s.amount_paid || 0), 0);
            
            // This is the true balance carried over since the last reset, including adjustments.
            previousEndOfMonthDue = revenueBefore + totalAdjustmentsBefore - (commissionBefore + totalSettlementsBefore);
        }

        // Add previous due to the grand total for this period
        grandTotal += previousEndOfMonthDue;

        // --- Settlement Table Generation ---
        const settlementsInRange = state.allSettlements.filter(s => {
            const settlementDate = parseSheetDate(s.settlement_date);
            return settlementDate >= startDate && settlementDate <= endDate;
        });
        const totalSettlements = settlementsInRange.reduce((sum, s) => sum + s.amount_paid, 0);

        const adjustmentsInRange = state.allAdjustments.filter(a => {
            const adjDate = parseSheetDate(a.adjustment_date);
            return adjDate >= startDate && adjDate <= endDate;
        });
        const totalAdjustments = adjustmentsInRange.reduce((sum, a) => {
            const amt = Number(a.amount || 0);
            if (a.type === 'Owner Debit' || a.type === 'Refund') return sum + amt;
            if (a.type === 'Owner Credit' || a.type === 'Correction') return sum - amt;
            return sum + amt;
        }, 0);

        const amountToPay = grandTotal - (totalCommission + totalSettlements) + totalAdjustments;

        let settlementBody = [
            [{ content: `Grand Total for ${dateRangeString}:`, styles: { fontStyle: 'bold' } }, { content: `${(totalNetAmount + totalDateChange).toLocaleString()} MMK`, styles: { halign: 'right', fontStyle: 'bold' } }],
            [{ content: `Carried Over from Previous Month:`, styles: { fontStyle: 'bold', textColor: [200, 0, 0] } }, { content: `${previousEndOfMonthDue.toLocaleString()} MMK`, styles: { halign: 'right', fontStyle: 'bold', textColor: [200, 0, 0] } }],
            [{ content: `Total Due (Including Previous Balance):`, styles: { fontStyle: 'bold' } }, { content: `${grandTotal.toLocaleString()} MMK`, styles: { halign: 'right', fontStyle: 'bold' } }],
            [{ content: `Commissions for ${dateRangeString}:`, styles: {} }, { content: `(${totalCommission.toLocaleString()}) MMK`, styles: { halign: 'right' } }],
        ];

        if(settlementsInRange.length > 0) {
            settlementsInRange.forEach(s => {
                const notes = s.notes ? `, ${s.notes}` : '';
                const settlementText = `Settlement (${s.settlement_date}, ${s.payment_method}${notes})`;
                settlementBody.push(
                     [{ content: settlementText, styles: {textColor: [100, 100, 100]} }, { content: `(${s.amount_paid.toLocaleString()}) MMK`, styles: { halign: 'right', textColor: [100, 100, 100] } }]
                );
            });
        } else {
             settlementBody.push(
                 [{ content: `No settlements made during ${dateRangeString}`, styles: {textColor: [150, 150, 150]} }, { content: `(0) MMK`, styles: { halign: 'right', textColor: [150, 150, 150] } }]
            );
        }

        if(adjustmentsInRange.length > 0) {
            adjustmentsInRange.forEach(a => {
                const notes = a.notes ? `, ${a.notes}` : '';
                const adjText = `Adjustment: ${a.type || 'Other'} (${a.adjustment_date}, ${a.reason || '—'}${notes})`;
                const amt = Number(a.amount || 0);
                const signed = (a.type === 'Owner Credit' || a.type === 'Correction') ? -amt : amt;
                const displayVal = signed >= 0 ? `${signed.toLocaleString()} MMK` : `(${Math.abs(signed).toLocaleString()}) MMK`;
                settlementBody.push(
                     [{ content: adjText, styles: {textColor: [100, 100, 100]} }, { content: displayVal, styles: { halign: 'right', textColor: [100, 100, 100] } }]
                );
            });
        }

        settlementBody.push(
             [{ content: 'Remaining Balance to Settle:', styles: { fontStyle: 'bold' } }, { content: `${amountToPay.toLocaleString()} MMK`, styles: { halign: 'right', fontStyle: 'bold' } }]
        );

        doc.autoTable({
            body: settlementBody,
            startY: finalY,
            theme: 'plain',
            styles: { fontSize: 10, cellPadding: 2 },
            columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right' } },
            tableWidth: 'auto',
            margin: { left: 14 },
            didDrawCell: (data) => {
                 if (data.row.index === settlementBody.length - 2) {
                    doc.setLineWidth(0.2);
                    doc.line(data.cell.x, data.cell.y + data.cell.height + 1, data.cell.x + 182, data.cell.y + data.cell.height + 1);
                }
            }
        });
    }

    doc.save(`agent_report_${new Date().toISOString().slice(0,10)}.pdf`);
    exportConfirmModal.classList.remove('show');
}

/**
 * Exports the Private financial summary report to a PDF file.
 */
export async function exportPrivateReportToPdf() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    const startDateStr = document.getElementById('searchStartDate').value;
    const endDateStr = document.getElementById('searchEndDate').value;

    if (!startDateStr || !endDateStr) {
        showToast('Please select a valid date range for the private report.', 'error');
        return;
    }

    const startDate = parseSheetDate(startDateStr);
    const endDate = parseSheetDate(endDateStr);

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const ticketsInMonth = state.allTickets.filter(t => {
        const issuedDate = parseSheetDate(t.issued_date);
        return issuedDate >= startDate && issuedDate <= endDate;
    });

    const hotelsInMonth = (state.allHotels || []).filter(h => {
        const checkinDate = parseSheetDate(h.checkin);
        return checkinDate >= startDate && checkinDate <= endDate;
    });

    if (ticketsInMonth.length === 0 && hotelsInMonth.length === 0) {
        showToast('No records to export in the selected month.', 'info');
        return;
    }

    const dateRangeString = `${formatDateToDMMMY(startDate)} to ${formatDateToDMMMY(endDate)}`;

    // --- Header ---
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Private Report', 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(dateRangeString, 105, 20, { align: 'center' });

    // --- Summary Section ---
    const ownerTickets = ticketsInMonth.filter(t => t.source !== 'self');
    const ownerHotels = hotelsInMonth.filter(h => h.source !== 'self');
    const selfTickets = ticketsInMonth.filter(t => t.source === 'self');
    const selfHotels = hotelsInMonth.filter(h => h.source === 'self');

    const totalTickets = ticketsInMonth.length;
    const totalHotels = hotelsInMonth.length;
    
    // Owner Financials
    const ticketRevenue = ownerTickets.reduce((sum, t) => sum + (t.net_amount || 0), 0);
    const hotelRevenue = ownerHotels.reduce((sum, h) => sum + (h.net_amount || 0), 0);
    const totalRevenue = ticketRevenue + hotelRevenue;

    const ticketCommission = ownerTickets.reduce((sum, t) => sum + (t.commission || 0), 0);
    const hotelCommission = ownerHotels.reduce((sum, h) => sum + (h.commission || 0), 0);
    const totalCommission = ticketCommission + hotelCommission;

    const totalExtraFare = ownerTickets.reduce((sum, t) => sum + (t.extra_fare || 0), 0);
    const summaryTotalProfit = totalCommission + totalExtraFare;
    
    // Self-Purchased Financials
    const selfTicketRevenue = selfTickets.reduce((sum, t) => sum + (Number(t.base_fare) || 0) + (Number(t.extra_fare) || 0), 0);
    const selfHotelRevenue = selfHotels.reduce((sum, h) => sum + (Number(h.base_fare) || 0), 0);
    const totalSelfRevenue = selfTicketRevenue + selfHotelRevenue;

    const selfTicketProfit = selfTickets.reduce((sum, t) => sum + (Number(t.base_fare) || 0) + (Number(t.extra_fare) || 0) - (Number(t.cost_price) || 0), 0);
    const selfHotelProfit = selfHotels.reduce((sum, h) => sum + (Number(h.base_fare) || 0) - (Number(h.net_amount) || 0), 0);
    const totalSelfProfit = selfTicketProfit + selfHotelProfit;

    const summaryBody = [
        ['Total Ticket Sales', `${totalTickets} tickets`],
        ['Total Hotel Bookings', `${totalHotels} bookings`],
        ['Total Revenue (Owner)', `${totalRevenue.toLocaleString()} MMK`],
        ['Total Commission (Owner)', `${totalCommission.toLocaleString()} MMK`],
        ['Total Extra Fare (Owner)', `${totalExtraFare.toLocaleString()} MMK`],
        ['Total Profit (Owner)', `${summaryTotalProfit.toLocaleString()} MMK`],
        ['Total Revenue (Self-Purchased)', `${totalSelfRevenue.toLocaleString()} MMK`],
        ['Total Profit (Self-Purchased)', `${totalSelfProfit.toLocaleString()} MMK`],
        ['Grand Total Profit', `${(summaryTotalProfit + totalSelfProfit).toLocaleString()} MMK`],
    ];
    doc.autoTable({
        body: summaryBody,
        startY: 25,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold', fillColor: [230, 247, 255] } },
    });

    let finalY = doc.lastAutoTable.finalY + 10;

    // --- Most Traveled Route ---
    const routeCounts = ticketsInMonth.reduce((acc, ticket) => {
        // FIX: Added || '' to prevent error on split()
        const route = `${(ticket.departure||'').split('(')[0].trim()} ➔ ${(ticket.destination||'').split('(')[0].trim()}`;
        acc[route] = (acc[route] || 0) + 1;
        return acc;
    }, {});

    let mostTraveledRoute = 'N/A';
    let maxCount = 0;
    for (const route in routeCounts) {
        if (routeCounts[route] > maxCount) {
            mostTraveledRoute = route;
            maxCount = routeCounts[route];
        }
    }
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Most Traveled Route:', 14, finalY);
    doc.setFont('helvetica', 'normal');
    doc.text(mostTraveledRoute, 55, finalY);
    finalY += 8;


    // --- Aggregate Data for New Tables ---
    const airlineFinancials = ticketsInMonth.reduce((acc, t) => {
        // FIX: Ensure airline name exists
        const airlineName = t.airline || 'Unknown';
        if (!acc[airlineName]) {
            acc[airlineName] = { net: 0, commission: 0, extra: 0 };
        }
        // FIX: Added || 0 for safety
        acc[airlineName].net += (t.net_amount || 0);
        acc[airlineName].commission += (t.commission || 0);
        acc[airlineName].extra += (t.extra_fare || 0);
        return acc;
    }, {});

    // --- Extra Fare Analysis Table ---
    const extraFareData = Object.entries(airlineFinancials)
        .map(([airline, data]) => ({
            airline,
            ...data,
            percentage: data.net > 0 ? ((data.extra / data.net) * 100).toFixed(2) : 0
        }))
        .sort((a, b) => b.percentage - a.percentage);

    const extraFareBody = extraFareData.map(a => [a.airline, a.extra.toLocaleString(), `${a.percentage}%`]);
    doc.autoTable({
        head: [['Airline', 'Total Extra Fare', 'Percentage of Net']],
        body: extraFareBody,
        startY: finalY,
        theme: 'grid',
        headStyles: { fillColor: [22, 160, 133], textColor: [255, 255, 255] },
    });
    finalY = doc.lastAutoTable.finalY + 10;

    // --- Commission Analysis Table ---
    const commissionData = Object.entries(airlineFinancials)
        .map(([airline, data]) => ({
            airline,
            ...data,
            percentage: data.net > 0 ? ((data.commission / data.net) * 100).toFixed(2) : 0
        }))
        .sort((a, b) => b.percentage - a.percentage);

    const commissionBody = commissionData.map(a => [a.airline, a.commission.toLocaleString(), `${a.percentage}%`]);
    doc.autoTable({
        head: [['Airline', 'Total Commission', 'Percentage of Net']],
        body: commissionBody,
        startY: finalY,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: [255, 255, 255] },
    });
    finalY = doc.lastAutoTable.finalY + 10;

    // --- Airline Ticket Analysis ---
    const airlineSales = ticketsInMonth.reduce((acc, ticket) => {
        const airlineName = ticket.airline || 'Unknown';
        acc[airlineName] = (acc[airlineName] || 0) + 1;
        return acc;
    }, {});
    const airlineData = Object.entries(airlineSales)
        .map(([airline, count]) => ({
            airline,
            count,
            percentage: ((count / totalTickets) * 100).toFixed(2)
        }))
        .sort((a, b) => b.count - a.count);

    const airlineBody = airlineData.map(a => [a.airline, a.count, `${a.percentage}%`]);

    doc.autoTable({
        head: [['Airline', 'Tickets Sold', 'Percentage']],
        body: airlineBody,
        startY: finalY,
        theme: 'grid',
        headStyles: { fillColor: [142, 68, 173], textColor: [255, 255, 255] },
    });

    finalY = doc.lastAutoTable.finalY + 10;

    // --- Social Media Analysis ---
    const socialMediaSales = ticketsInMonth.reduce((acc, ticket) => {
        const type = (ticket.account_type || 'Unknown').trim().toUpperCase();
        acc[type] = (acc[type] || 0) + 1;
        return acc;
    }, {});

    const socialMediaData = Object.entries(socialMediaSales)
        .map(([type, count]) => ({
            type,
            count,
            percentage: ((count / totalTickets) * 100).toFixed(2)
        }))
        .sort((a, b) => b.count - a.count);

    const socialMediaBody = socialMediaData.map(s => [s.type, s.count, `${s.percentage}%`]);

    doc.autoTable({
        head: [['Social Media Platform', 'Clients', 'Percentage']],
        body: socialMediaBody,
        startY: finalY,
        theme: 'grid',
        headStyles: { fillColor: [243, 156, 18], textColor: [255, 255, 255] },
    });

    // --- ADD NEW PAGE FOR MONTHLY COMPARISON ---
    doc.addPage();
    const currentYear = new Date().getFullYear();

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`Monthly Comparison (${currentYear})`, 105, 15, { align: 'center' });

    // --- Data Aggregation for Comparison ---
    const ticketsThisYear = state.allTickets.filter(t => {
        const ticketDate = parseSheetDate(t.issued_date);
        return ticketDate.getFullYear() === currentYear;
    });

    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthlyData = Array(12).fill(null).map((_, i) => ({
        month: months[i],
        revenue: 0,
        profit: 0,
        commission: 0,
        extraFare: 0,
        tickets: 0
    }));

    ticketsThisYear.forEach(t => {
        const dateObj = parseSheetDate(t.issued_date);
        // FIX: Ensure date is valid before accessing getMonth
        if (!dateObj || isNaN(dateObj)) return;
        
        const monthIndex = dateObj.getMonth();
        // FIX: Ensure monthIndex is valid
        if (monthIndex >= 0 && monthIndex < 12) {
            monthlyData[monthIndex].revenue += (t.net_amount || 0) + (t.date_change || 0);
            monthlyData[monthIndex].commission += (t.commission || 0);
            monthlyData[monthIndex].extraFare += (t.extra_fare || 0);
            let ticketProfit = (t.commission || 0) + (t.extra_fare || 0);
        if (t.source === 'self' && ticketProfit === 0) {
            ticketProfit = (Number(t.base_fare) || 0) + (Number(t.extra_fare) || 0) - (Number(t.cost_price) || 0);
        }
        monthlyData[monthIndex].profit += ticketProfit;
            monthlyData[monthIndex].tickets++;
        }
    });

    const hotelsThisYear = (state.allHotels || []).filter(h => {
        const checkinDate = parseSheetDate(h.checkin);
        return checkinDate && checkinDate.getFullYear() === currentYear;
    });

    hotelsThisYear.forEach(h => {
        const dateObj = parseSheetDate(h.checkin);
        if (!dateObj || isNaN(dateObj)) return;
        
        const monthIndex = dateObj.getMonth();
        if (monthIndex >= 0 && monthIndex < 12) {
            monthlyData[monthIndex].revenue += (h.net_amount || 0);
            monthlyData[monthIndex].commission += (h.commission || 0);
            monthlyData[monthIndex].profit += (h.commission || 0);
            monthlyData[monthIndex].tickets++;
        }
    });

    // --- Comparison Table ---
    const comparisonHead = [['Month', 'Total Tickets', 'Total Revenue', 'Total Commission', 'Total Extra Fare', 'Total Profit']];
    const comparisonBody = monthlyData
        .filter(m => m.tickets > 0) // Only show months with data
        .map(m => [
            m.month,
            m.tickets,
            m.revenue.toLocaleString(),
            m.commission.toLocaleString(),
            m.extraFare.toLocaleString(),
            m.profit.toLocaleString()
        ]);

    // Add totals row
    const totalRow = monthlyData.reduce((acc, m) => {
        acc.tickets += m.tickets;
        acc.revenue += m.revenue;
        acc.commission += m.commission;
        acc.extraFare += m.extraFare;
        acc.profit += m.profit;
        return acc;
    }, { tickets: 0, revenue: 0, commission: 0, extraFare: 0, profit: 0 });

    comparisonBody.push([
        { content: 'Total', styles: { fontStyle: 'bold' } },
        { content: totalRow.tickets, styles: { fontStyle: 'bold' } },
        { content: totalRow.revenue.toLocaleString(), styles: { fontStyle: 'bold' } },
        { content: totalRow.commission.toLocaleString(), styles: { fontStyle: 'bold' } },
        { content: totalRow.extraFare.toLocaleString(), styles: { fontStyle: 'bold' } },
        { content: totalRow.profit.toLocaleString(), styles: { fontStyle: 'bold' } },
    ]);

    doc.autoTable({
        head: comparisonHead,
        body: comparisonBody,
        startY: 25,
        theme: 'grid',
        headStyles: { fillColor: [44, 62, 80] },
        styles: { fontSize: 8 },
        columnStyles: {
            0: { fontStyle: 'bold' },
            1: { halign: 'right' },
            2: { halign: 'right' },
            3: { halign: 'right' },
            4: { halign: 'right' },
            5: { halign: 'right' },
        }
    });

    // --- Comparison Graph ---
    const chartCanvas = document.getElementById('comparisonChart');
    if (chartCanvas && state.charts.comparisonChart) {
        // Temporarily change chart colors for PDF export (white background)
        const originalColor = state.charts.comparisonChart.options.plugins.legend.labels.color;
        const legendOptions = state.charts.comparisonChart.options.plugins.legend;
        const scaleOptions = state.charts.comparisonChart.options.scales;

        if (legendOptions) legendOptions.labels.color = '#000';
        if (scaleOptions) {
            Object.values(scaleOptions).forEach(axis => {
                if (axis.ticks) axis.ticks.color = '#000';
                if (axis.title) axis.title.color = '#000';
            });
        }
        state.charts.comparisonChart.update('none'); // Update without animation

        const chartImage = chartCanvas.toDataURL('image/png', 1.0);

        // Revert chart colors back to original
        if (legendOptions) legendOptions.labels.color = originalColor;
        if (scaleOptions) {
             Object.values(scaleOptions).forEach(axis => {
                if (axis.ticks) axis.ticks.color = originalColor;
                if (axis.title) axis.title.color = originalColor;
            });
        }
        state.charts.comparisonChart.update('none');

        const imgProps = doc.getImageProperties(chartImage);
        const pdfWidth = doc.internal.pageSize.getWidth();
        const margin = 14;
        const imgWidth = pdfWidth - margin * 2;
        const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
        let chartY = doc.lastAutoTable.finalY + 10;

        // Check if there is enough space for the chart
        if (chartY + imgHeight > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            chartY = margin;
        }

        doc.addImage(chartImage, 'PNG', margin, chartY, imgWidth, imgHeight);
    }

    doc.save(`private_report_${new Date().toISOString().slice(0,10)}.pdf`);
}
