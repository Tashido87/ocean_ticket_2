export function selectPassengerTickets(allTickets, pnrs, selection, type, isPaid) {
    const wanted = new Set(pnrs.map(p => p.trim().toUpperCase()).filter(Boolean));
    const candidates = allTickets.filter(t => wanted.has(String(t.booking_reference || '').trim().toUpperCase()));
    const found = new Set(candidates.map(t => String(t.booking_reference).trim().toUpperCase()));
    const missing = [...wanted].filter(p => !found.has(p));
    if (missing.length) throw new Error(`PNRs not found: ${missing.join(', ')}`);
    if (!selection?.ids?.length) throw new Error('Select at least one passenger ticket.');
    if (new Set(selection.ids).size !== selection.ids.length) throw new Error('Duplicate ticket selection.');
    const tickets = selection.ids.map(id => {
        const matches = candidates.filter(t => String(t.id) === id);
        if (matches.length !== 1) throw new Error('Ticket selection changed. Reload the passenger list.');
        return matches[0];
    });
    if (tickets.some(t => !String(t.name || '').trim())) throw new Error('Selected tickets must have passenger names.');
    return tickets.map(t => {
        const adjustment = Number(selection.adjustments?.[String(t.id)] || 0);
        const total = Number(t.net_amount || 0) + Number(t.extra_fare || 0) + Number(t.sub_agent_fare || 0) + adjustment;
        if (!Number.isFinite(adjustment) || !Number.isFinite(total) || total < 0) throw new Error('Invalid ticket amount or adjustment.');
        if (type === 'Receipt' && adjustment !== 0) throw new Error('Receipt adjustments are not supported in passenger mode; use the recorded paid amount.');
        return { ...t, net_amount: Number(t.net_amount || 0), sub_agent_fare: Number(t.sub_agent_fare || 0), extra_fare: Number(t.extra_fare || 0) + adjustment, invoicePassengerSelection: true };
    });
}

export function receiptPaymentLabels(tickets, isPaid) {
    const paidCount = tickets.filter(isPaid).length;
    const allPaid = tickets.length > 0 && paidCount === tickets.length;
    return {
        // Receipt display is independent of the booking's recorded payment status.
        status: 'Paid',
        totalLabel: allPaid ? 'Amount Received' : 'Voucher Total'
    };
}
