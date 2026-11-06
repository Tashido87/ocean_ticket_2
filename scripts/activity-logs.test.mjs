import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../history.js', import.meta.url), 'utf8')
    .replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+/gm, '');

const context = {
    console,
    state: { history: [], logsPage: 1, rowsPerPage: 20 },
    getCurrentUserState: () => ({ uid: 'test-user-1', email: 'admin@oceantravel.com', displayName: 'Admin User' }),
    getHistory: async () => [],
    addHistory: async () => 'test-doc-id',
    showToast: () => {},
    escapeHtml: (str) => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
    setupGenericPagination: () => {}
};
vm.createContext(context);
vm.runInContext(source, context);

test('Activity Logs & Audit System', async (t) => {
    const { createAuditPayload, formatLogTimestamp, getActionBadgeHtml } = context;

    await t.test('createAuditPayload generates complete structured audit payload', () => {
        const ticket = {
            id: 't-123',
            name: 'AUNG MYO LWIN',
            booking_reference: '245149E6',
            route: 'Tachilek → Heho'
        };
        const payload = createAuditPayload(ticket, 'Updated commission and extra fare', {
            action: 'MODIFIED',
            financial: true,
            changes: [
                { field: 'commission', from: '20,000', to: '22,800' }
            ]
        });

        assert.equal(payload.name, 'AUNG MYO LWIN');
        assert.equal(payload.pnr, '245149E6');
        assert.equal(payload.ticketId, 't-123');
        assert.equal(payload.action, 'MODIFIED');
        assert.equal(payload.financial, true);
        assert.equal(payload.changes.length, 1);
        assert.equal(payload.user.displayName, 'Admin User');
        assert.equal(payload.user.email, 'admin@oceantravel.com');
        assert.ok(payload.isoDate, 'Payload should include isoDate');
        assert.ok(payload.date, 'Payload should include formatted date');
    });

    await t.test('getActionBadgeHtml formats badge classes and icons correctly', () => {
        assert.match(getActionBadgeHtml('CREATED'), /badge-created/);
        assert.match(getActionBadgeHtml('HOTEL_CREATED'), /badge-created/);
        assert.match(getActionBadgeHtml('VISA_CREATED'), /badge-created/);

        assert.match(getActionBadgeHtml('MODIFIED'), /badge-modified/);
        assert.match(getActionBadgeHtml('UPDATE'), /badge-modified/);
        assert.match(getActionBadgeHtml('GROUP_MODIFIED'), /badge-modified/);
        assert.match(getActionBadgeHtml('HOTEL_MODIFIED'), /badge-modified/);

        assert.match(getActionBadgeHtml('DELETED'), /badge-deleted/);
        assert.match(getActionBadgeHtml('HOTEL_DELETED'), /badge-deleted/);
        assert.match(getActionBadgeHtml('VISA_DELETED'), /badge-deleted/);

        assert.match(getActionBadgeHtml('CANCELED'), /badge-canceled/);

        assert.match(getActionBadgeHtml('FEE_ADDED'), /badge-financial/);
        assert.match(getActionBadgeHtml('DATE_CHANGE'), /badge-financial/);
        assert.match(getActionBadgeHtml('PAYMENT_UPDATE'), /badge-financial/);
    });

    await t.test('formatLogTimestamp formats ISO string and createdAt timestamp', () => {
        const entryIso = { isoDate: '2026-11-06T04:30:00.000Z' };
        const formattedIso = formatLogTimestamp(entryIso);
        assert.ok(formattedIso.includes('Nov-2026'), 'Should contain month and year');

        const mockFirestoreDate = new Date('2026-11-06T10:15:00.000Z');
        const entryFirestore = {
            createdAt: {
                toDate: () => mockFirestoreDate
            }
        };
        const formattedFs = formatLogTimestamp(entryFirestore);
        assert.ok(formattedFs.includes('Nov-2026'), 'Should format Firestore toDate() timestamp');
    });

    await t.test('sortHistoryNewestFirst sorts November 2026 ahead of May 2026 regardless of input order', () => {
        const { sortHistoryNewestFirst } = context;

        const mayItem = { date: '16-May-2026 07:47 PM', name: 'SAN AUNG' };
        const novItem = { date: '06-Nov-2026 11:20 AM', name: 'AYE AYE LATT' };
        const octItem = { date: '25-Oct-2026 07:22 AM', name: 'AYE AYE MYAT' };

        // Test with oldest first as input
        const sorted1 = sortHistoryNewestFirst([mayItem, octItem, novItem]);
        assert.equal(sorted1[0].name, 'AYE AYE LATT', 'Nov 2026 should be first');
        assert.equal(sorted1[1].name, 'AYE AYE MYAT', 'Oct 2026 should be second');
        assert.equal(sorted1[2].name, 'SAN AUNG', 'May 2026 should be last');

        // Test with newest first as input
        const sorted2 = sortHistoryNewestFirst([novItem, mayItem, octItem]);
        assert.equal(sorted2[0].name, 'AYE AYE LATT', 'Nov 2026 should remain first');
        assert.equal(sorted2[2].name, 'SAN AUNG', 'May 2026 should remain last');
    });

    await t.test('parseLegacyDetailsToChanges converts legacy strings into structured diff chips', () => {
        const { parseLegacyDetailsToChanges } = context;

        // 1. PAYMENT UPDATE string
        const p1 = parseLegacyDetailsToChanges('PAYMENT UPDATE: Paid via KBZ Pay on 09/10/2026');
        assert.equal(p1.changes.length, 3);
        assert.equal(p1.changes[0].field, 'payment');
        assert.equal(p1.changes[0].to, 'paid');
        assert.equal(p1.changes[1].field, 'payment method');
        assert.equal(p1.changes[1].to, 'KBZ Pay');
        assert.equal(p1.changes[2].field, 'paid date');
        assert.equal(p1.changes[2].to, '09/10/2026');

        // 2. DATE CHANGE FEE string
        const p2 = parseLegacyDetailsToChanges('DATE CHANGE FEE ADDED: Fee=90,000, Comm=0, Extra=0 (Unpaid)');
        assert.equal(p2.changes.length, 2);
        assert.equal(p2.changes[0].field, 'date change fee');
        assert.equal(p2.changes[0].to, '90,000 MMK');
        assert.equal(p2.changes[1].field, 'status');
        assert.equal(p2.changes[1].to, 'Unpaid');

        // 3. FINANCIAL & DATE UPDATE string
        const p3 = parseLegacyDetailsToChanges('FINANCIAL & DATE UPDATE: Travel Date: 11/10/2026 to 20/10/2026.');
        assert.equal(p3.changes.length, 1);
        assert.equal(p3.changes[0].field, 'Travel Date');
        assert.equal(p3.changes[0].from, '11/10/2026');
        assert.equal(p3.changes[0].to, '20/10/2026');

        // 4. Long format dates
        const p4 = parseLegacyDetailsToChanges('Travel Date: MON AUG 04 2025 00:00:00 GMT+0630 (MYANMAR TIME) to 03-Aug-2025');
        assert.equal(p4.changes.length, 1);
        assert.equal(p4.changes[0].from, '04-AUG-2025');
        assert.equal(p4.changes[0].to, '03-Aug-2025');

        // 5. CANCELED partial refund
        const p5 = parseLegacyDetailsToChanges('CANCELED: Partial. Refunded: 519,500 MMK via KBZ Pay (ID: 01003894030362904483). New Net Amount: 210,000');
        assert.equal(p5.changes.length, 2);
        assert.equal(p5.changes[0].field, 'refund');
        assert.ok(p5.changes[0].to.includes('519,500 MMK'));
        assert.equal(p5.changes[1].field, 'new net');
        assert.equal(p5.changes[1].to, '210,000');
    });
});
