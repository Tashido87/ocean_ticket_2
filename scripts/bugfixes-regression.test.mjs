import assert from 'node:assert/strict';
import test from 'node:test';

// Test 1: computeSingleRecordTotal & groupTicketsByAccount with sub_agent_fare
test('computeSingleRecordTotal includes sub_agent_fare for tickets and uses selling_price for hotels', () => {
    function computeSingleRecordTotal(t) {
        if (!t) return 0;
        if (t._isHotel) {
            return Number(t.selling_price || t.net_amount) || 0;
        }
        return (Number(t.net_amount) || 0) + (Number(t.extra_fare) || 0) + (Number(t.sub_agent_fare) || 0) + (Number(t.date_change) || 0);
    }

    const flightTicket = {
        net_amount: 100000,
        extra_fare: 5000,
        sub_agent_fare: 15000,
        date_change: 2000
    };
    assert.equal(computeSingleRecordTotal(flightTicket), 122000);

    const hotelRecord = {
        _isHotel: true,
        selling_price: 80000,
        net_amount: 70000
    };
    assert.equal(computeSingleRecordTotal(hotelRecord), 80000);
});

test('groupTicketsByAccount correctly aggregates sub_agent_fare and splitExact preserves integers', () => {
    const group = [
        { account_name: 'Agency A', sub_agent_fare: 10000, net_amount: 50000 },
        { account_name: 'Agency A', sub_agent_fare: 20000, net_amount: 50000 },
        { account_name: 'Agency A', sub_agent_fare: 5000, net_amount: 50000 }
    ];

    const sumField = (field) => group.reduce((sum, t) => sum + (Number(t[field]) || 0), 0);
    const totalSubAgent = sumField('sub_agent_fare');
    assert.equal(totalSubAgent, 35000);

    // splitExact algorithm from openEditGroupModal
    const splitExact = (total, count) => {
        const base = Math.floor(total / count);
        const remainder = total - base * count;
        return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
    };

    const shares = splitExact(totalSubAgent, group.length);
    assert.equal(shares.reduce((a, b) => a + b, 0), 35000);
    assert.deepEqual(shares, [11667, 11667, 11666]);
});

// Test 2: Hotel Reservation payment status helper
test('getHotelPaymentKey correctly differentiates unpaid, partial, and paid', () => {
    function getHotelPaymentKey(t) {
        if (!t) return 'unpaid';
        const raw = String(t.paid ?? t.payment_status ?? '').trim().toLowerCase();
        if (raw === 'paid' || raw === 'true') return 'paid';
        if (raw === 'partial' || raw === 'partially paid') return 'partial';
        return 'unpaid';
    }

    assert.equal(getHotelPaymentKey({ paid: 'unpaid' }), 'unpaid');
    assert.equal(getHotelPaymentKey({ paid: 'partial' }), 'partial');
    assert.equal(getHotelPaymentKey({ paid: 'paid' }), 'paid');
    assert.equal(getHotelPaymentKey({}), 'unpaid');
    assert.equal(getHotelPaymentKey({ payment_status: 'paid' }), 'paid');
});

// Test 3: Settlement excludes canceled/refunded tickets and avoids ReferenceError
test('settlement isExcluded excludes canceled/refunded tickets and self-purchased tickets', () => {
    function isCanceled(t) {
        const r = String(t?.remarks || '').toLowerCase();
        return r.includes('refund') || r.includes('cancel');
    }

    function isExcluded(t) {
        return t?.source === 'self' || isCanceled(t);
    }

    assert.equal(isExcluded({ source: 'self' }), true);
    assert.equal(isExcluded({ remarks: 'Canceled by customer' }), true);
    assert.equal(isExcluded({ remarks: 'Full refund requested' }), true);
    assert.equal(isExcluded({ remarks: 'Regular ticket', source: 'agent' }), false);
});

// Test 4: Partial Payment split logic preserves sub_agent_fare and balances
test('handlePartialPayment split calculates exact sub_agent_fare and net_amount shares', () => {
    const ticket = {
        id: 't-1',
        name: 'John Doe',
        booking_reference: 'PNR123',
        base_fare: 100000,
        net_amount: 100000,
        commission: 10000,
        extra_fare: 10000,
        sub_agent_fare: 20000,
        date_change: 0,
        remarks: 'Test ticket'
    };

    const ticketTotalAmt = (ticket.net_amount || 0) + (ticket.extra_fare || 0) + (ticket.sub_agent_fare || 0) + (ticket.date_change || 0);
    assert.equal(ticketTotalAmt, 130000);

    const payAmount = 65000;
    const payDate = '2026-10-18';
    const payMethod = 'KBZPay';

    const remainder = ticketTotalAmt - payAmount;
    const ratio = payAmount / ticketTotalAmt; // 0.5
    const part1_Base = Math.floor((ticket.base_fare || 0) * ratio);
    const part1_Comm = Math.floor((ticket.commission || 0) * ratio);
    const part2_Base = (ticket.base_fare || 0) - part1_Base;
    const part2_Comm = (ticket.commission || 0) - part1_Comm;

    const originalSubAgent = Number(ticket.sub_agent_fare) || 0;
    const part1_SubAgent = Math.floor(originalSubAgent * ratio);
    const part2_SubAgent = originalSubAgent - part1_SubAgent;
    const part1_Net = payAmount - part1_SubAgent;
    const part2_Net = remainder - part2_SubAgent;

    // Verify sub-agent fare integrity
    assert.equal(part1_SubAgent + part2_SubAgent, originalSubAgent);
    assert.equal(part1_SubAgent, 10000);
    assert.equal(part2_SubAgent, 10000);

    // Verify ticket 1 total
    const part1_Total = part1_Net + part1_SubAgent;
    assert.equal(part1_Total, payAmount);

    // Verify ticket 2 (balance) total
    const part2_Total = part2_Net + part2_SubAgent;
    assert.equal(part2_Total, remainder);

    // Total of both tickets equals original total debt
    assert.equal(part1_Total + part2_Total, ticketTotalAmt);
});

// Test 5: Customer Message templates (Concise formatting and NRC / Passport rules)
test('buildCustomerMessage formats concise booking message without redundant headers', async () => {
    const { buildCustomerMessage } = await import('../utils.js');
    const msg = buildCustomerMessage({
        mode: 'booking',
        lang: 'mm',
        pnr: '1STD1L',
        routeText: 'Yangon → Mandalay',
        travelDate: '22-Oct-2026',
        deadlineText: '19-Oct-2026 4:30 PM',
        passengers: [{ name: 'MS WIN MAR SEIN', extra: '9/MAYATA(N)062580' }]
    });

    assert.ok(msg.startsWith('PNR: 1STD1L (Yangon → Mandalay, 22-Oct-2026) အတွက် booking တင်ပြီးပါပြီခင်ဗျာ။'));
    assert.ok(!msg.includes('မင်္ဂလာပါ'));
    assert.ok(!msg.includes('Booking အချက်အလက်များ'));
    assert.ok(!msg.includes('• Booking Ref (PNR):'));
    assert.ok(msg.includes('• ခရီးစဉ် : Yangon → Mandalay'));
    assert.ok(msg.includes('• ခရီးသွားမည့်ရက် : 22-Oct-2026'));
    assert.ok(msg.includes('• ခရီးသည် :\n  • MS WIN MAR SEIN (9/MAYATA(N)062580)'));
    assert.ok(msg.includes('• Booking Deadline: 19-Oct-2026 4:30 PM'));
    assert.ok(msg.includes('Ocean Air Ticket ကို ရွေးချယ်အားပေးမှုအတွက် အထူးကျေးဇူးတင်ရှိပါသည်ခင်ဗျာ။ 💙'));
});

test('buildCustomerMessage formats domestic ticket with 2h checkin and NRC only', async () => {
    const { buildCustomerMessage } = await import('../utils.js');
    const msg = buildCustomerMessage({
        mode: 'ticket',
        lang: 'mm',
        pnr: '1STD1L',
        airline: 'MAI',
        departure: 'Yangon (RGN)',
        destination: 'Mandalay (MDL)',
        travelDate: '22-Oct-2026',
        passengers: ['WIN MAR SEIN']
    });

    assert.ok(msg.startsWith('PNR: 1STD1L (Yangon (RGN) → Mandalay (MDL), 22-Oct-2026) အတွက် လေယာဉ်လက်မှတ် ဖြတ်ပြီးပါပြီခင်ဗျာ။'));
    assert.ok(msg.includes('• လေကြောင်းလိုင်း : MAI'));
    assert.ok(msg.includes('• ခရီးစဉ် : Yangon (RGN) → Mandalay (MDL)'));
    assert.ok(msg.includes('• ခရီးသည် :\n  • WIN MAR SEIN'));
    assert.ok(msg.includes('အနည်းဆုံး (၂) နာရီကြိုတင်၍'));
    assert.ok(msg.includes('မှတ်ပုံတင် (NRC မူရင်း) တစ်ပါတည်း ယူဆောင်သွားပေးပါခင်ဗျာ။'));
    // Should NOT require passport for domestic flight
    assert.ok(!msg.includes('Passport မူရင်း'));
});

test('buildCustomerMessage formats international ticket with 3h checkin and BOTH NRC and Passport', async () => {
    const { buildCustomerMessage } = await import('../utils.js');
    const msg = buildCustomerMessage({
        mode: 'ticket',
        lang: 'mm',
        pnr: '2INTL9',
        airline: 'MAI',
        departure: 'Yangon (RGN)',
        destination: 'Bangkok (BKK)',
        travelDate: '25-Oct-2026',
        passengers: ['AUNG AUNG']
    });

    assert.ok(msg.includes('အနည်းဆုံး (၃) နာရီကြိုတင်၍'));
    // Must include BOTH NRC and Passport
    assert.ok(msg.includes('မှတ်ပုံတင် (NRC မူရင်း) နှင့် Passport မူရင်း'));
});

// Test 7: Round-Trip PNR Sectors and Route Display (1SSLF6, 1SS7YZ)
test('getPnrRouteDisplay and getPnrTravelDateDisplay display both sectors for round-trip PNRs', async () => {
    const { getPnrSectors, getPnrRouteDisplay, getPnrTravelDateDisplay, buildCustomerMessage } = await import('../utils.js');

    // Case A: 1SSLF6 (outbound then return in array)
    const tickets1SSLF6 = [
        {
            booking_reference: '1SSLF6',
            departure: 'Yangon (RGN)',
            destination: 'New Delhi (DEL)',
            departing_on: '22-Oct-2026',
            leg: 'outbound',
            trip_type: 'Round-Trip',
            name: 'U TIN MAUNG'
        },
        {
            booking_reference: '1SSLF6',
            departure: 'New Delhi (DEL)',
            destination: 'Yangon (RGN)',
            departing_on: '29-Oct-2026',
            leg: 'return',
            trip_type: 'Round-Trip',
            name: 'U TIN MAUNG'
        }
    ];

    const sectorsA = getPnrSectors(tickets1SSLF6);
    assert.equal(sectorsA.length, 2);
    assert.equal(sectorsA[0].departure, 'Yangon (RGN)');
    assert.equal(sectorsA[0].destination, 'New Delhi (DEL)');
    assert.equal(sectorsA[1].departure, 'New Delhi (DEL)');
    assert.equal(sectorsA[1].destination, 'Yangon (RGN)');

    const routeA = getPnrRouteDisplay(tickets1SSLF6);
    assert.equal(routeA, 'Yangon → New Delhi / New Delhi → Yangon');

    const travelDateA = getPnrTravelDateDisplay(tickets1SSLF6);
    assert.equal(travelDateA, '22-Oct-2026 / 29-Oct-2026');

    // Case B: 1SS7YZ (Firestore returned return leg first)
    const tickets1SS7YZ = [
        {
            booking_reference: '1SS7YZ',
            departure: 'New Delhi (DEL)',
            destination: 'Yangon (RGN)',
            departing_on: '29-Oct-2026',
            leg: 'return',
            trip_type: 'Round-Trip',
            name: 'DAW MYA MYA'
        },
        {
            booking_reference: '1SS7YZ',
            departure: 'Yangon (RGN)',
            destination: 'New Delhi (DEL)',
            departing_on: '22-Oct-2026',
            leg: 'outbound',
            trip_type: 'Round-Trip',
            name: 'DAW MYA MYA'
        }
    ];

    // Must sort outbound first chronologically
    const routeB = getPnrRouteDisplay(tickets1SS7YZ);
    assert.equal(routeB, 'Yangon → New Delhi / New Delhi → Yangon');

    const travelDateB = getPnrTravelDateDisplay(tickets1SS7YZ);
    assert.equal(travelDateB, '22-Oct-2026 / 29-Oct-2026');

    // Case C: Multi-passenger round-trip booking (2 pax = 4 ticket rows) deduplicates to 2 unique sectors
    const ticketsMultiPax = [
        ...tickets1SSLF6,
        {
            booking_reference: '1SSLF6',
            departure: 'Yangon (RGN)',
            destination: 'New Delhi (DEL)',
            departing_on: '22-Oct-2026',
            leg: 'outbound',
            trip_type: 'Round-Trip',
            name: 'DAW AUNG'
        },
        {
            booking_reference: '1SSLF6',
            departure: 'New Delhi (DEL)',
            destination: 'Yangon (RGN)',
            departing_on: '29-Oct-2026',
            leg: 'return',
            trip_type: 'Round-Trip',
            name: 'DAW AUNG'
        }
    ];
    assert.equal(getPnrRouteDisplay(ticketsMultiPax), 'Yangon → New Delhi / New Delhi → Yangon');

    // Case D: Single ticket row with Round-Trip and return_date
    const singleRowRoundTrip = [{
        booking_reference: '1SSXYZ',
        departure: 'Yangon',
        destination: 'Bangkok',
        departing_on: '15/11/2026',
        return_date: '20/11/2026',
        trip_type: 'Round-Trip'
    }];
    assert.equal(getPnrRouteDisplay(singleRowRoundTrip), 'Yangon → Bangkok / Bangkok → Yangon');
    assert.equal(getPnrTravelDateDisplay(singleRowRoundTrip), '15-Nov-2026 / 20-Nov-2026');

    // Case E: Customer message with round-trip route and travel dates
    const customerMsg = buildCustomerMessage({
        mode: 'ticket',
        lang: 'mm',
        pnr: '1SSLF6',
        airline: 'Air India',
        routeText: routeA,
        travelDate: travelDateA,
        legs: sectorsA,
        passengers: ['U TIN MAUNG']
    });
    assert.ok(customerMsg.includes('• ခရီးစဉ် : Yangon → New Delhi / New Delhi → Yangon'));
    assert.ok(customerMsg.includes('• ခရီးသွားမည့်ရက် : 22-Oct-2026 / 29-Oct-2026'));
    // International route check-in reminder
    assert.ok(customerMsg.includes('အနည်းဆုံး (၃) နာရီကြိုတင်၍'));
});


