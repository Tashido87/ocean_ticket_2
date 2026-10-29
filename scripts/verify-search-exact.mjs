import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

const PORT = 8094;
const ROOT = process.cwd();

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
    let filePath = path.join(ROOT, req.url.split('?')[0]);
    if (filePath.endsWith('/') || filePath === ROOT) filePath = path.join(filePath, 'index.html');
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    });
});

async function run() {
    await new Promise(r => server.listen(PORT, r));
    console.log(`Server running at http://localhost:${PORT}`);

    const browser = await chromium.launch({
        executablePath: '/Applications/Opera.app/Contents/MacOS/Opera',
        headless: true
    });

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });

    // Populate state and switch to search view
    await page.evaluate(async () => {
        const authContainer = document.getElementById('auth-container');
        const loading = document.getElementById('loading');
        const dashboardContent = document.getElementById('dashboard-content');
        const mainHeader = document.getElementById('main-header');
        const mainSidebar = document.getElementById('main-sidebar');
        const initialSplash = document.getElementById('initial-splash');
        const searchView = document.getElementById('search-view');

        if (authContainer) authContainer.style.display = 'none';
        if (initialSplash) initialSplash.style.display = 'none';
        if (loading) loading.style.display = 'none';
        if (mainHeader) mainHeader.style.display = 'flex';
        if (mainSidebar) mainSidebar.style.display = 'flex';
        if (dashboardContent) dashboardContent.style.display = 'flex';

        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.style.display = 'none';
        });

        if (searchView) {
            searchView.classList.add('active');
            searchView.style.display = 'block';
        }

        const { state } = await import('./state.js');
        const { initSearchView, navigateToClient } = await import('./search.js');

        // Sample data exactly matching the reference state:
        state.allClients = [
            {
                client_key: 'client-1',
                name: 'THAN THAN WIN',
                phone: '09441234567',
                account_name: 'PHYO PHYO HTUN L WIN',
                account_type: 'Viber',
                last_issued: '26/10/2026',
                ticket_count: 2
            },
            {
                client_key: 'client-2',
                name: 'MYAT THAN DAR AUNG',
                phone: '09771234567',
                account_name: 'PHYO PHYO HTUN L WIN',
                account_type: 'Viber',
                last_issued: '24/10/2026',
                ticket_count: 4
            },
            {
                client_key: 'client-3',
                name: 'THAN T ZIN TUN',
                phone: '09881234567',
                account_name: 'PHYO PHYO HTUN L WIN',
                account_type: 'Viber',
                last_issued: '06/01/2026',
                ticket_count: 4
            },
            {
                client_key: 'client-4',
                name: 'AUNG MYINT THAN',
                phone: '09991234567',
                account_name: 'PHYO PHYO HTUN L WIN',
                account_type: 'Viber',
                last_issued: '06/12/2025',
                ticket_count: 1
            }
        ];

        state.allTickets = [
            {
                id: 't-1',
                name: 'THAN THAN WIN',
                booking_reference: '245BAB0A',
                airline: 'Air KBZ',
                account_name: 'PHYO PHYO HTUN L WIN',
                departure: 'Tachilek',
                destination: 'Mandalay',
                issued_date: '26/10/2026',
                sub_agent_fare: 10000,
                sub_agent_settled: false,
                payment: 'unpaid'
            },
            {
                id: 't-2',
                name: 'THAN THAN WIN (ADT)',
                booking_reference: 'NQRKQU',
                airline: 'Air KBZ',
                account_name: 'PHYO PHYO HTUN L WIN',
                departure: 'Mandalay',
                destination: 'Tachilek',
                issued_date: '26/10/2026',
                sub_agent_fare: 10000,
                sub_agent_settled: false,
                payment: 'unpaid'
            },
            {
                id: 't-3',
                name: 'DAW THAN THAN WIN',
                booking_reference: '24532A40',
                airline: 'Air KBZ',
                account_name: 'PHYO PHYO HTUN L WIN',
                departure: 'Tachilek',
                destination: 'Mandalay',
                issued_date: '24/10/2026',
                sub_agent_fare: 10000,
                sub_agent_settled: true,
                payment: 'paid'
            },
            {
                id: 't-4',
                name: 'MYAT THAN DAR AUNG',
                booking_reference: 'GRFMSB',
                airline: 'Air KBZ',
                account_name: 'PHYO PHYO HTUN L WIN',
                departure: 'Mandalay',
                destination: 'Tachilek',
                issued_date: '23/10/2026',
                sub_agent_fare: 10000,
                sub_agent_settled: true,
                payment: 'paid'
            },
            {
                id: 't-5',
                name: 'NAING NAING THAN T',
                booking_reference: '0127VZ',
                airline: 'Air KBZ',
                account_name: 'DAW AYE AYE LATT',
                departure: 'Yangon',
                destination: 'Tachilek',
                issued_date: '12/10/2026',
                sub_agent_fare: 0,
                payment: 'paid'
            },
            {
                id: 't-6',
                name: 'MYAT THAN DAR AUNG',
                booking_reference: '1SAPHJ',
                airline: 'Myanmar Airways International',
                account_name: 'PHYO PHYO HTUN L WIN',
                departure: 'Bangkok',
                destination: 'Yangon',
                issued_date: '23/09/2026',
                sub_agent_fare: 20000,
                sub_agent_settled: true,
                payment: 'paid'
            }
        ];

        window.location.hash = '#/search?q=than+than+win';
        initSearchView();
    });

    await page.waitForTimeout(600);

    // Take 1440x900 screenshot
    const out1440 = '/Users/tashido/.gemini/antigravity/brain/77e92fe5-aee9-43c1-ae67-c6f5b5b70a77/search-exact-match-1440x900.png';
    await page.screenshot({ path: out1440, fullPage: false });
    console.log(`Captured 1440x900 screenshot at: ${out1440}`);

    // Take narrow width screenshot (1100x900)
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.waitForTimeout(300);
    const out1100 = '/Users/tashido/.gemini/antigravity/brain/77e92fe5-aee9-43c1-ae67-c6f5b5b70a77/search-exact-narrow-1100x900.png';
    await page.screenshot({ path: out1100, fullPage: false });
    console.log(`Captured 1100x900 screenshot at: ${out1100}`);

    // DevTools Computed Style Inspection
    const computed = await page.evaluate(() => {
        const getStyles = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return {
                backgroundColor: cs.backgroundColor,
                color: cs.color,
                fontSize: cs.fontSize,
                fontWeight: cs.fontWeight,
                fontFamily: cs.fontFamily,
                borderRadius: cs.borderRadius,
                height: cs.height,
                padding: cs.padding,
                border: cs.border,
                boxShadow: cs.boxShadow
            };
        };

        return {
            pageBg: window.getComputedStyle(document.getElementById('search-view')).backgroundColor,
            title: getStyles('#searchViewHeader h2'),
            subtitle: getStyles('#searchSubtitle'),
            countSummary: getStyles('#searchCountSummary'),
            activeTab: getStyles('.search-type-tab.active'),
            inactiveTab: getStyles('.search-type-tab:not(.active)'),
            filterBar: getStyles('#searchFilterBar'),
            filterSelect: getStyles('#searchFilterBar select'),
            tableShell: getStyles('.search-table-shell'),
            tableHeader: getStyles('.search-results-table thead th'),
            tableRow: getStyles('.search-results-table tbody tr.search-row td'),
            sectionRow: getStyles('.search-section-row td'),
            clientName: getStyles('.search-results-table .strong-cell .cell-name-text'),
            pnrLink: getStyles('.clickable-pnr'),
            highlight: getStyles('.search-highlight'),
            subAgentTagStatusPaid: getStyles('.subagent-fare-badge.is-settled .subagent-tag-status'),
            subAgentTagStatusUnpaid: getStyles('.subagent-fare-badge.is-unsettled .subagent-tag-status'),
            paymentBadgePaid: getStyles('.payment-badge.payment-paid'),
            paymentBadgeUnpaid: getStyles('.payment-badge.payment-unpaid'),
            actionBtnSecondary: getStyles('.search-action-btn:not(.primary):not(.coral)'),
            actionBtnPrimary: getStyles('.search-action-btn.primary'),
            actionBtnCoral: getStyles('.search-action-btn.coral'),
            rowActionsWrap: window.getComputedStyle(document.querySelector('.search-row-actions') || document.body).flexWrap
        };
    });

    console.log('--- COMPUTED STYLES REPORT ---');
    console.log(JSON.stringify(computed, null, 2));

    // Audit the 4 display fixes
    const auditFixes = await page.evaluate(() => {
        // Fix 1: Check highlighting in account cell vs name cell
        const nameMarks = Array.from(document.querySelectorAll('.cell-name-text mark')).map(m => m.textContent);
        const accountMarks = Array.from(document.querySelectorAll('.account-cell mark')).map(m => m.textContent);

        // Fix 2: Check account hover title attribute
        const accountCell = document.querySelector('.account-cell');
        const hasAccountTitle = accountCell && accountCell.getAttribute('title') === 'PHYO PHYO HTUN L WIN';

        // Fix 3: Check horizontal scroll of table shell and page body
        const shell = document.querySelector('.search-table-shell');
        const shellScrollable = shell ? (shell.scrollWidth >= shell.clientWidth) : false;
        const bodyScrollable = document.body.scrollWidth > window.innerWidth;

        // Fix 4: Check Result Type dropdown is gone from filter bar
        const hasResultTypeSelect = Boolean(document.querySelector('#searchFilterBar select[data-filter="activeType"]'));
        const tabCount = document.querySelectorAll('.search-type-tab').length;

        // Status disambiguation wording:
        const subagentTags = Array.from(document.querySelectorAll('.subagent-tag-status')).map(el => el.textContent.trim());

        return {
            nameMarks,
            accountMarks,
            hasAccountTitle,
            shellScrollable,
            bodyScrollable,
            hasResultTypeSelect,
            tabCount,
            subagentTags
        };
    });

    console.log('--- AUDIT OF 4 DISPLAY FIXES ---');
    console.log(JSON.stringify(auditFixes, null, 2));

    await browser.close();
    server.close();
}

run().catch(err => {
    console.error('Execution error:', err);
    process.exit(1);
});
