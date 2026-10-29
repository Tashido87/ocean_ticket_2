import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../search.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+/gm, '');

const context = {
    console,
    document: { createElement: () => ({ textContent: '', innerHTML: '' }) },
    window: { location: { hash: '' } },
    localStorage: { getItem: () => null, setItem: () => {} },
    state: { allClients: [], allTickets: [] },
    history: { pushState: () => {}, replaceState: () => {} }
};
vm.createContext(context);
vm.runInContext(source, context);

const { rankRecord, scoreTextField, qualityFromScore } = context;

test('Search Algorithm - Exact and Phrase Matching for Person Names', async (t) => {
    const query = 'than than win';

    const targetTicket = {
        name: 'THAN THAN WIN',
        booking_reference: 'X79ABC',
        account_name: 'GENERAL PUBLIC'
    };

    const targetTicketWithAdt = {
        name: 'THAN THAN WIN (ADT)',
        booking_reference: 'X79ABD',
        account_name: 'GENERAL PUBLIC'
    };

    const targetPrefix = {
        name: 'DAW THAN THAN WIN',
        booking_reference: 'X79ABE',
        account_name: 'GENERAL PUBLIC'
    };

    const unrelatedPartial = {
        name: 'MYAT THAN DAR AUNG',
        booking_reference: 'X79ABF',
        account_name: 'PHYO PHYO HTUN L WIN'
    };

    const unrelatedSingleThan = {
        name: 'THAN T ZIN TUN',
        booking_reference: 'X79ABG',
        account_name: 'GENERAL PUBLIC'
    };

    const rankExact = rankRecord(targetTicket, 'ticket', query);
    const rankAdt = rankRecord(targetTicketWithAdt, 'ticket', query);
    const rankDaw = rankRecord(targetPrefix, 'ticket', query);
    const rankUnrelated = rankRecord(unrelatedPartial, 'ticket', query);
    const rankSingle = rankRecord(unrelatedSingleThan, 'ticket', query);

    await t.test('exact name ranks in Best Matches with highest score', () => {
        assert.equal(rankExact.quality, 'best');
        assert.equal(rankExact.score, 1500);
    });

    await t.test('name with (ADT) ranks as exact match', () => {
        assert.equal(rankAdt.quality, 'best');
        assert.equal(rankAdt.score, 1500);
    });

    await t.test('name with honorific DAW ranks in Best Matches', () => {
        assert.equal(rankDaw.quality, 'best');
        assert.ok(rankDaw.score >= 1200);
    });

    await t.test('unrelated passenger with partial name and matching account does NOT qualify as Best Match', () => {
        assert.notEqual(rankUnrelated.quality, 'best');
        // Because "than than win" requires two THANs and one WIN,
        // and MYAT THAN DAR AUNG + PHYO PHYO HTUN L WIN only has one THAN,
        // it fails multiset match and receives only single token partial score (< 150)
        assert.equal(rankUnrelated.quality, 'none');
    });

    await t.test('passenger with single THAN does not qualify as Best Match for "than than win"', () => {
        assert.notEqual(rankSingle.quality, 'best');
    });
});

test('Search Algorithm - PNR code search', async (t) => {
    const ticket = {
        name: 'KYAW KYAW',
        booking_reference: 'BDUVUU'
    };

    const rankExact = rankRecord(ticket, 'ticket', 'BDUVUU');
    const rankLower = rankRecord(ticket, 'ticket', 'bduvuu');
    const rankPartial = rankRecord(ticket, 'ticket', 'BDUV');

    assert.equal(rankExact.score, 2000);
    assert.equal(rankExact.quality, 'best');

    assert.equal(rankLower.score, 2000);
    assert.equal(rankLower.quality, 'best');

    assert.equal(rankPartial.score, 1500);
    assert.equal(rankPartial.quality, 'best');
});

test('Search Algorithm - Phone number search', async (t) => {
    const client = {
        name: 'AUNG AUNG',
        phone: '09443123456'
    };

    const rankExact = rankRecord(client, 'client', '09443123456');
    const rankSuffix = rankRecord(client, 'client', '123456');

    assert.equal(rankExact.score, 1800);
    assert.equal(rankExact.quality, 'best');

    assert.equal(rankSuffix.score, 1200);
    assert.equal(rankSuffix.quality, 'best');
});

test('Search Algorithm - Account name search', async (t) => {
    const ticket = {
        name: 'AUNG AUNG',
        booking_reference: 'X79ABC',
        account_name: 'WIN TRAVEL & TOURS'
    };

    const rankFull = rankRecord(ticket, 'ticket', 'WIN TRAVEL');
    const rankExact = rankRecord(ticket, 'ticket', 'WIN TRAVEL & TOURS');

    assert.equal(rankFull.quality, 'best');
    assert.ok(rankFull.score >= 700);
    assert.equal(rankExact.quality, 'best');
    assert.ok(rankExact.score >= 900);
});

test('Search Algorithm - Single word name query', async (t) => {
    const ticketExact = { name: 'THAN', booking_reference: 'T1' };
    const ticketMultiWord = { name: 'THAN THAN WIN', booking_reference: 'T2' };
    const ticketContainsWord = { name: 'MYAT THAN DAR', booking_reference: 'T3' };
    const ticketInternalSubstring = { name: 'JONATHAN', booking_reference: 'T4' };

    const rankExact = rankRecord(ticketExact, 'ticket', 'THAN');
    const rankMultiWord = rankRecord(ticketMultiWord, 'ticket', 'THAN');
    const rankContainsWord = rankRecord(ticketContainsWord, 'ticket', 'THAN');
    const rankInternal = rankRecord(ticketInternalSubstring, 'ticket', 'THAN');

    assert.equal(rankExact.score, 1500);
    assert.equal(rankMultiWord.score, 1350); // starts with "THAN "
    assert.equal(rankContainsWord.score, 1250); // boundary match " THAN "
    assert.equal(rankInternal.score, 250); // internal substring
    assert.equal(rankInternal.quality, 'related');
});
