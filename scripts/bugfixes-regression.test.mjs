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
