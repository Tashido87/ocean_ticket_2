import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Run the actual module without importing browser/Firebase dependencies or using a network.
const source = readFileSync(new URL('../settlement.js', import.meta.url), 'utf8');
const executable = source
    .replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export /gm, '');

const plain = value => JSON.parse(JSON.stringify(value));
const ticket = (id, overrides = {}) => ({
    id, name: `Client ${id}`, booking_reference: `PNR-${id}`,
    issued_date: '2026-08-01', net_amount: 110, date_change: 10,
    commission: 20, extra_fare: 25, sub_agent_fare: 15, ...overrides
});
const settlement = (id, allocations = [], amount_paid = 0) => ({
    id, allocations, amount_paid, settlement_date: '2026-08-10',
    payment_method: 'Cash', allocationMode: 'manual'
});
const allocation = (ticketId, amount) => ({ ticketId, amount });

function harness(tickets = [], settlements = []) {
    const state = {
        allTickets: tickets, allSettlements: settlements, allHotels: [],
        allAdjustments: [], allClosedPeriods: [], isSubmitting: false
    };
    const elements = new Map();
    const writes = [];
    const toasts = [];
    let checkboxes = [];
    let mode = 'manual';
    let html = '';
    const element = (value = '') => ({
        value, checked: false, disabled: false, textContent: '', dataset: {}, listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; }
    });
    const document = {
        getElementById: id => elements.get(id) || null,
        createElement: () => ({
            textContent: '',
            get innerHTML() {
                return this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
            }
        }),
        querySelector: selector => selector === 'input[name="allocMode"]:checked' ? { value: mode } : null,
        querySelectorAll: selector => {
            if (selector === '[data-alloc-ticket]') return checkboxes;
            if (selector === '[data-alloc-ticket]:checked') return checkboxes.filter(cb => cb.checked);
            return [];
        }
    };
    const context = vm.createContext({
        state, document, Date, console,
        parseSheetDate: value => value ? new Date(value) : new Date(0),
        parsePaymentMethod: value => ({ method: value || '', bank: '' }),
        formatPaymentMethod: method => method,
        formatDateToDDMMMYYYY: value => value,
        formatDateToDMMMY: value => value,
        openModal: markup => {
            html = markup;
            elements.clear();
            for (const match of markup.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], element());
            for (const match of markup.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
                elements.get(match[1]).value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || '';
            }
            elements.get('set_method').value = 'Cash';
            elements.get('set_status').value = 'Paid';
            mode = markup.match(/name="allocMode" value="([^"]+)" checked/)?.[1] || 'auto';
            checkboxes = Array.from(markup.matchAll(/<input\b[^>]*data-alloc-ticket="[^"]+"[^>]*>/g), match => {
                const cb = element();
                for (const [attribute, key] of [
                    ['ticket', 'allocTicket'], ['payable', 'allocPayable'],
                    ['pnr', 'allocPnr'], ['name', 'allocName']
                ]) cb.dataset[key] = match[0].match(new RegExp(`data-alloc-${attribute}="([^"]*)"`))[1];
                cb.checked = /\bchecked\b/.test(match[0]);
                return cb;
            });
        },
        closeModal() {},
        showToast: (message, type) => toasts.push({ message, type }),
        addSettlement: async payload => writes.push({ type: 'add', payload: plain(payload) }),
        updateSettlement: async (id, payload) => writes.push({ type: 'update', id, payload: plain(payload) }),
        getSettlements: async () => state.allSettlements,
        getClosedPeriods: async () => state.allClosedPeriods,
        getAdjustments: async () => state.allAdjustments
    });
    vm.runInContext(executable, context, { filename: 'settlement.js' });
    return {
        context, state, elements, writes, toasts,
        get html() { return html; },
        get checkboxes() { return checkboxes; },
        open(existing = null) { context.openNewSettlementModal(existing); },
        async submit({ amount = 100, allocationMode = 'manual', allowOver = false } = {}) {
            elements.get('set_amount').value = String(amount);
            elements.get('set_allow_over').checked = allowOver;
            mode = allocationMode;
            const button = element();
            await elements.get('settlementForm').listeners.submit({
                preventDefault() {}, target: { querySelector: () => button }
            });
            assert.equal(state.isSubmitting, false);
            assert.equal(button.disabled, false);
        }
    };
}

function amounts(allocations) {
    return plain(allocations).map(({ ticketId, amount }) => [ticketId, amount]);
}

test('auto allocations complete a partial ticket before moving to the next oldest ticket', () => {
    const older = ticket('older');
    const newer = ticket('newer', { issued_date: '2026-08-02' });
    const h = harness([newer, older], [
        settlement('first', [allocation('older', '20'), allocation('older', 10)], 30),
        settlement('second', [allocation('older', 10)], 10)
    ]);
    const before = plain(h.state);
    const result = h.context.buildAutoAllocations(90);
    assert.deepEqual(amounts(result), [['older', 60], ['newer', 30]]);
    assert.deepEqual(plain(result[0]), {
        ticketId: 'older', pnr: 'PNR-older', clientName: 'Client older',
        passengerName: 'Client older', amount: 60
    });
    assert.deepEqual(plain(h.state), before, 'building allocations must not mutate source records/order');
});

test('successive installments remain eligible until the full owner payable is allocated', () => {
    const h = harness([ticket('a')]);
    for (const [index, amount] of [30, 25, 45].entries()) {
        const allocations = h.context.buildAutoAllocations(amount);
        assert.deepEqual(amounts(allocations), [['a', amount]]);
        h.state.allSettlements.push(settlement(`s${index}`, allocations, amount));
        assert.equal(h.context.getTicketSettlementStatus(h.state.allTickets[0], {}).key,
            index === 2 ? 'paid_owner' : 'partial');
    }
    assert.deepEqual(amounts(h.context.buildAutoAllocations(100)), []);
});

test('auto eligibility excludes full/overallocated, self-purchased and nonpositive payable tickets', () => {
    const h = harness([
        ticket('full'), ticket('over'), ticket('self', { source: 'self' }),
        ticket('zero', { net_amount: 10 }), ticket('negative', { net_amount: 0 }), ticket('open')
    ], [settlement('s', [allocation('full', 100), allocation('over', 120)])]);
    assert.deepEqual(amounts(h.context.buildAutoAllocations(1000)), [['open', 100]]);
    assert.deepEqual(amounts(h.context.buildAutoAllocations(0)), []);
    assert.deepEqual(amounts(h.context.buildAutoAllocations(-20)), []);
});

test('auto edits exclude only the settlement being replaced', () => {
    const existing = settlement('editing', [allocation('a', 60)], 60);
    const h = harness([ticket('a')], [existing, settlement('other', [allocation('a', 40)], 40)]);
    assert.deepEqual(amounts(h.context.buildAutoAllocations(200)), []);
    assert.deepEqual(amounts(h.context.buildAutoAllocations(200, existing.id)), [['a', 60]]);
    assert.deepEqual(amounts(h.context.buildAutoAllocations(25, existing.id)), [['a', 25]]);
});

test('badges use summed explicit amounts, not allocation presence or aggregate payment', () => {
    const h = harness(['partial', 'full', 'over', 'zero'].map(id => ticket(id)), [
        settlement('s1', [allocation('partial', 20), allocation('full', '30'), allocation('zero', 0)], 1000),
        settlement('s2', [allocation('partial', 15), allocation('full', 70), allocation('over', 120)], 1000)
    ]);
    const summary = {};
    assert.deepEqual(h.state.allTickets.map(t => plain(h.context.getTicketSettlementStatus(t, summary))), [
        { key: 'partial', label: 'Partially Settled' },
        { key: 'paid_owner', label: 'Settled' },
        { key: 'paid_owner', label: 'Settled' },
        { key: 'unsettled', label: 'Unsettled' }
    ]);
});

test('legacy FIFO fallback and excluded/review badges remain unchanged', () => {
    const h = harness(['a', 'b', 'c'].map(id => ticket(id)), [
        { id: 'legacy', amount_paid: 150 }, { id: 'empty', allocations: null, amount_paid: 0 }
    ]);
    const summary = {};
    assert.deepEqual(h.state.allTickets.map(t => h.context.getTicketSettlementStatus(t, summary).key),
        ['paid_owner', 'partial', 'unsettled']);
    assert.equal(h.context.getTicketSettlementStatus(ticket('fee', { name: 'Client (Fees)' }), {}).key, 'excluded');
    assert.equal(h.context.getTicketSettlementStatus(ticket('refund', { remarks: 'Refunded' }), {}).key, 'excluded');
    assert.equal(h.context.getTicketSettlementStatus(ticket('review', { net_amount: 0 }), {}).key, 'review');
    assert.deepEqual(amounts(h.context.buildAutoAllocations(20)), [['a', 20]],
        'legacy aggregate payments must not become explicit allocations');
});

test('manual modal lists partial tickets with remaining payable in the checkbox, display and summary', () => {
    const h = harness([
        ticket('new', { issued_date: '2026-08-02' }), ticket('partial'), ticket('full'),
        ticket('over'), ticket('self', { source: 'self' }), ticket('zero', { net_amount: 10 })
    ], [settlement('s', [allocation('partial', 40), allocation('full', 100), allocation('over', 150)])]);
    h.open();
    assert.deepEqual(h.checkboxes.map(cb => [cb.dataset.allocTicket, cb.dataset.allocPayable]),
        [['partial', '60'], ['new', '100']]);
    assert.match(h.html, /<span class="num">MMK 60<\/span>/);
    h.checkboxes[0].checked = true;
    h.elements.get('set_amount').value = '80';
    h.context.updateAllocationSummary();
    assert.equal(h.elements.get('allocSelected').textContent, 'MMK 60');
    assert.equal(h.elements.get('allocAmount').textContent, 'MMK 80');
    assert.equal(h.elements.get('allocRemaining').textContent, 'MMK 20');
});

test('manual save pays only the remaining balance of a partially allocated ticket', async () => {
    const h = harness([ticket('a')], [settlement('previous', [allocation('a', 40)], 40)]);
    h.open();
    h.checkboxes[0].checked = true;
    await h.submit({ amount: 60 });
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].type, 'add');
    assert.deepEqual(amounts(h.writes[0].payload.allocations), [['a', 60]]);
    assert.equal(h.writes[0].payload.amount_paid, 60);
    assert.equal(h.toasts.at(-1).type, 'success');
});

test('manual payment-total validation still requires override, which cannot exceed ticket remaining payable', async () => {
    const h = harness([ticket('a')], [settlement('previous', [allocation('a', 40)], 40)]);
    h.open();
    h.checkboxes[0].checked = true;
    await h.submit({ amount: 50 });
    assert.equal(h.writes.length, 0);
    assert.match(h.toasts.at(-1).message, /Allocation \(MMK 60\) exceeds payment \(MMK 50\)/);
    assert.equal(h.toasts.at(-1).type, 'error');
    h.checkboxes[0].dataset.allocPayable = '100';
    await h.submit({ amount: 50, allowOver: true });
    assert.equal(h.writes.length, 1);
    assert.deepEqual(amounts(h.writes[0].payload.allocations), [['a', 60]]);
});

test('manual save rechecks current remaining payable when other allocations change after opening', async () => {
    const h = harness([ticket('a'), ticket('b')], [settlement('previous', [allocation('a', 40)], 40)]);
    h.open();
    h.checkboxes.forEach(cb => { cb.checked = true; });
    h.state.allSettlements.push(settlement('concurrent', [allocation('a', 20), allocation('b', 100)], 120));
    await h.submit({ amount: 200, allowOver: true });
    assert.deepEqual(amounts(h.writes[0].payload.allocations), [['a', 40]]);
});

for (const allocationMode of ['manual', 'auto']) {
    test(`${allocationMode} edit/save retains eligibility and does not double count its own allocations`, async () => {
        const existing = settlement('editing', [allocation('a', 60)], 60);
        existing.allocationMode = allocationMode;
        const h = harness([ticket('a')], [existing, settlement('other', [allocation('a', 40)], 40)]);
        h.open(existing);
        assert.equal(h.checkboxes.length, 1);
        assert.equal(h.checkboxes[0].checked, true);
        assert.equal(h.checkboxes[0].dataset.allocPayable, '60');
        assert.equal(h.elements.get('allocSelected').textContent, 'MMK 60');
        await h.submit({ amount: 60, allocationMode });
        assert.equal(h.writes.length, 1);
        assert.equal(h.writes[0].type, 'update');
        assert.equal(h.writes[0].id, existing.id);
        assert.deepEqual(amounts(h.writes[0].payload.allocations), [['a', 60]]);
    });
}

test('unallocated save remains unallocated and locked-period validation still prevents saving', async () => {
    const h = harness([ticket('a')]);
    h.open();
    await h.submit({ amount: 60, allocationMode: 'unallocated' });
    assert.deepEqual(h.writes[0].payload.allocations, []);
    h.elements.get('set_date').value = '2026-08-10';
    h.state.allClosedPeriods.push({ periodKey: '2026-08' });
    await h.submit({ amount: 60 });
    assert.equal(h.writes.length, 1);
    assert.match(h.toasts.at(-1).message, /locked month/);
});

test('allocation metadata does not alter opening balance, revenue, commission or paid-to-owner aggregates', () => {
    const h = harness([
        ticket('prior', { issued_date: '2026-07-01' }), ticket('current'),
        ticket('self', { source: 'self' })
    ], [
        { ...settlement('prior-payment', [], 30), settlement_date: '2026-07-10' },
        settlement('current-payment', [allocation('current', 10)], 40)
    ]);
    h.state.allHotels.push({ checkin: '2026-08-05', net_amount: 50, commission: 5 });
    h.state.allAdjustments.push({ adjustment_date: '2026-08-06', type: 'Owner Debit', amount: 7 });
    vm.runInContext("ui.period = 'custom'; ui.customStart = new Date(2026, 7, 1); ui.customEnd = new Date(2026, 7, 31);", h.context);
    const totals = () => {
        const s = h.context.getSettlementSummary();
        return Object.fromEntries(['opening', 'totalRevenue', 'ownerPayable', 'paidToOwner',
            'myCommission', 'extraProfit', 'adjustmentsTotal', 'remainingDue', 'closing'].map(key => [key, s[key]]));
    };
    const expected = {
        opening: 70, totalRevenue: 170, ownerPayable: 240, paidToOwner: 40,
        myCommission: 25, extraProfit: 25, adjustmentsTotal: 7, remainingDue: 182, closing: 182
    };
    assert.deepEqual(totals(), expected);
    h.state.allSettlements[1].allocations.push(allocation('current', 90));
    assert.deepEqual(totals(), expected);
});
