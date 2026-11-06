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
});
