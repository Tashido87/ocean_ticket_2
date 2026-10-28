import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../history.js', import.meta.url), 'utf8')
    .replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+/gm, '');

const context = { console };
vm.createContext(context);
vm.runInContext(source, context);

test('getCleanAuditNote deduplication rule', async (t) => {
    const { getCleanAuditNote } = context;

    await t.test('suppresses duplicate note when changes already represent all facts', () => {
        const details = 'PAYMENT UPDATE: Paid via KBZ Pay on 24/10/2026';
        const changes = [
            { field: 'paid', from: false, to: true },
            { field: 'payment_method', from: '—', to: 'KBZ Pay' },
            { field: 'paid_date', from: '—', to: '24/10/2026' }
        ];
        assert.equal(getCleanAuditNote(details, changes), null);
    });

    await t.test('suppresses note when details is only an action label plus punctuation', () => {
        assert.equal(getCleanAuditNote('FINANCIAL & DATE UPDATE: .', []), null);
        assert.equal(getCleanAuditNote('MODIFIED: ', []), null);
        assert.equal(getCleanAuditNote('PAYMENT UPDATE: .', [{ field: 'paid', from: false, to: true }]), null);
    });

    await t.test('keeps note when it adds genuinely new facts (e.g. reason)', () => {
        const details = 'FINANCIAL & DATE UPDATE: Net Amount: 1,000,000 -> 1,200,000. Reason: Client changed flight route';
        const changes = [
            { field: 'net_amount', from: 1000000, to: 1200000 }
        ];
        const res = getCleanAuditNote(details, changes);
        assert.ok(res !== null);
        assert.match(res, /Client changed flight route/);
    });

    await t.test('keeps plain text detail rows with real facts', () => {
        const details = 'DATE CHANGE FEE ADDED: Fee=20,000, Comm=0, Extra=0 (Paid)';
        assert.equal(getCleanAuditNote(details, []), details);
    });
});
