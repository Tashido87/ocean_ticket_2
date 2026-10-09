import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { selectPassengerTickets, receiptPaymentLabels } from '../invoice-selection.mjs';

const ticket = (id, name, pnr, departure, destination) => ({ id, name, booking_reference: pnr, departure, destination, departing_on: '2026-09-20', net_amount: 100, extra_fare: 10, sub_agent_fare: 5, paid: true, airline: id === 'a' ? 'MNA' : 'MAI' });
const tickets = [ticket('a', 'AYE AYE LATT', 'OUT', 'Yangon', 'Heho'), ticket('b', 'AYE AYE LATT', 'BACK', 'Heho', 'Yangon'), ticket('c', 'THAW ZIN BO', 'BACK', 'Heho', 'Yangon')];
const select = (ids, type = 'Invoice', adjustments = {}, data = tickets, pnrs = ['OUT', 'BACK']) => selectPassengerTickets(data, pnrs, { ids, adjustments }, type, t => t.paid === true);
test('selects only explicit record IDs across PNRs and airlines without mutation', () => {
    const before = JSON.stringify(tickets);
    const selected = select(['a', 'b'], 'Invoice', { a: -5 });
    assert.deepEqual(selected.map(t => t.id), ['a', 'b']);
    assert.equal(selected[0].extra_fare, 5);
    assert.notEqual(selected[0].airline, selected[1].airline);
    assert.equal(JSON.stringify(tickets), before);
});
test('rejects missing, duplicate, stale, and out-of-PNR selections', () => {
    for (const ids of [[], ['a', 'a'], ['missing']]) assert.throws(() => select(ids));
    assert.throws(() => select(['a'], 'Invoice', {}, tickets, ['BACK']));
    assert.throws(() => select(['a'], 'Invoice', {}, tickets, ['OUT', 'TYPO']), /PNRs not found/);
});
test('receipts allow unpaid tickets without changing recorded payment status', () => {
    assert.equal(select(['a', 'b'], 'Receipt').length, 2);
    const unpaid = [{ ...tickets[0], paid: false }];
    assert.equal(select(['a'], 'Receipt', {}, unpaid, ['OUT'])[0].paid, false);
    assert.equal(unpaid[0].paid, false);
    assert.throws(() => select(['a'], 'Receipt', { a: 10 }), /adjustments/);
});
test('receipt status displays Paid independently of recorded payment status', () => {
    const paid = t => t.paid === true;
    assert.deepEqual(receiptPaymentLabels([{ paid: false }], paid), { status: 'Paid', totalLabel: 'Voucher Total' });
    assert.deepEqual(receiptPaymentLabels([{ paid: true }, { paid: false }], paid), { status: 'Paid', totalLabel: 'Voucher Total' });
    assert.deepEqual(receiptPaymentLabels([{ paid: true }], paid), { status: 'Paid', totalLabel: 'Amount Received' });
});
test('rejects invalid totals and parses numeric database strings', () => {
    assert.throws(() => select(['a'], 'Invoice', { a: 'bad' }), /Invalid/);
    assert.throws(() => select(['a'], 'Invoice', { a: -200 }), /Invalid/);
    assert.equal(select(['a'], 'Invoice', {}, [{ ...tickets[0], net_amount: '100' }], ['OUT'])[0].net_amount, 100);
});
const source = readFileSync(new URL('../invoice.js', import.meta.url), 'utf8').replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const context = vm.createContext({ state: { allTickets: tickets }, formatDateToDMMMY: v => v, parseSheetDate: v => new Date(v), isFeeEntryRow: t => /\(fees\)$/i.test(t.name), selectPassengerTickets, receiptPaymentLabels, isTicketPaid: t => t.paid === true });
vm.runInContext(source, context);
test('legacy mixed-PNR policy remains blocked; passenger groups remain separate', () => {
    assert.equal(context.analyzeInvoiceScenario(['OUT', 'BACK']).code, 'SCENARIO_4');
    const groups = context.buildInvoiceGroups(select(['a', 'b', 'c']), 'separate');
    assert.equal(groups.length, 2);
    assert.equal(groups[0].tickets.length, 2);
    assert.equal(groups[1].tickets.length, 1);
    const items = context.buildInvoiceLineItems(groups[0].tickets, 'separate');
    assert.equal(items.length, 2);
    assert.match(items[0].description, /PNR: OUT/);
    assert.match(items[1].description, /PNR: BACK/);
});

test('date change fees calculate correct rate, amount and total on invoice line items', () => {
    const feeTicket = {
        id: 'fee1',
        name: 'THAW ZIN BO (Fees)',
        booking_reference: '245442EA',
        departure: 'Heho',
        destination: 'Tachilek',
        departing_on: '2026-10-19',
        net_amount: 0,
        extra_fare: 0,
        sub_agent_fare: 0,
        date_change: 10000,
        airline: 'ManYadanarpon',
        paid: true
    };
    const mainTicket = {
        id: 't1',
        name: 'THAW ZIN BO',
        booking_reference: '245442EA',
        departure: 'Heho',
        destination: 'Tachilek',
        departing_on: '2026-10-15',
        net_amount: 580000,
        extra_fare: 0,
        sub_agent_fare: 0,
        date_change: 0,
        airline: 'ManYadanarpon',
        paid: true
    };
    const items = context.buildInvoiceLineItems([mainTicket, feeTicket], 'separate');
    assert.equal(items.length, 2);
    assert.equal(items[0].rate, 580000);
    assert.equal(items[0].amount, 580000);
    assert.match(items[1].description, /^Date Change Fee: /);
    assert.equal(items[1].rate, 10000);
    assert.equal(items[1].amount, 10000);
    const data = context.buildInvoiceDocumentData({ pnrs: ['245442EA'], tickets: [mainTicket, feeTicket] }, 'Invoice', { key: 'magical_land', displayName: 'Magical Land', logoUrl: '' }, '2026-10-09', 0, 1, 'separate');
    assert.equal(data.totalAmount, 590000);
});
