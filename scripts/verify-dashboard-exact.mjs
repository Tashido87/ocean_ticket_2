import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

const PORT = 8089;
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

    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => {
        consoleErrors.push(String(err));
    });

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });

    // Simulate authenticated session and invoke real renderDashboardData() with sample tickets
    await page.evaluate(async () => {
        const authContainer = document.getElementById('auth-container');
        const loading = document.getElementById('loading');
        const dashboardContent = document.getElementById('dashboard-content');
        const mainHeader = document.getElementById('main-header');
        const mainSidebar = document.getElementById('main-sidebar');
        const initialSplash = document.getElementById('initial-splash');
        const homeView = document.getElementById('home-view');

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
        if (homeView) {
            homeView.classList.add('active');
            homeView.style.display = 'block';
        }

        const { state } = await import('./state.js');
        const dash = await import('./dashboard.js');

        const now = new Date();
        const fmt = (d) => {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${String(d.getDate()).padStart(2, '0')}/${months[d.getMonth()]}/${d.getFullYear()}`;
        };
        const d1 = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 5));
        const d2 = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 3));
        const d3 = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 1));
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);
        const t1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const t2 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
        const t3 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5);

        state.allTickets = [
            {
                id: 't0',
                booking_reference: 'A1B2C3',
                name: 'HLA HLA MYINT (MRS)',
                departure: 'Yangon (RGN)',
                destination: 'Bangkok (BKK)',
                airline: 'MAI',
                issued_date: fmt(prevMonth),
                departing_on: fmt(prevMonth),
                base_fare: 2100000,
                net_amount: 1900000,
                commission: 200000,
                paid: true,
                account_name: 'Hla Hla Myint',
                remarks: ''
            },
            {
                id: 't1',
                booking_reference: 'X8K2LP',
                name: 'AUNG KYAW MOE (MR)',
                departure: 'Yangon (RGN)',
                destination: 'Bangkok (BKK)',
                airline: 'MAI',
                issued_date: fmt(d1),
                departing_on: fmt(t1),
                base_fare: 850000,
                net_amount: 760000,
                commission: 90000,
                paid: false,
                account_name: 'Aung Kyaw Moe',
                remarks: ''
            },
            {
                id: 't2',
                booking_reference: 'M4N9QR',
                name: 'SU SU WIN (MS)',
                departure: 'Mandalay (MDL)',
                destination: 'Chiang Mai (CNX)',
                airline: 'Myanmar National Airlines',
                issued_date: fmt(d2),
                departing_on: fmt(t2),
                base_fare: 720000,
                net_amount: 645000,
                commission: 75000,
                paid: false,
                account_name: 'Su Su Win',
                remarks: ''
            },
            {
                id: 't3',
                booking_reference: 'P7T4VW',
                name: 'THIDA AUNG (MRS)',
                departure: 'Yangon (RGN)',
                destination: 'Singapore (SIN)',
                airline: 'Singapore Airlines',
                issued_date: fmt(d3),
                departing_on: fmt(t3),
                base_fare: 1480000,
                net_amount: 1320000,
                commission: 160000,
                paid: true,
                account_name: 'Thida Aung',
                source: 'self',
                remarks: 'self-ticket'
            }
        ];
        state.allBookings = [
            {
                id: 'b1',
                pnr: 'H9L3KP',
                name: 'KYAW ZIN HEIN',
                departure: 'Yangon (RGN)',
                destination: 'Bangkok (DMK)',
                airline: 'Thai AirAsia',
                status: 'active',
                deadlineAt: new Date(now.getTime() - 3600 * 1000).toISOString()
            }
        ];

        dash.initializeDashboardSelectors();
        dash.renderDashboardData();
    });

    await page.waitForTimeout(600);

    // Extract computed styles for Section 7 Verification Checklist
    const report = await page.evaluate(() => {
        const cs = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const s = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
                width: s.width,
                height: s.height,
                backgroundColor: s.backgroundColor,
                color: s.color,
                fontFamily: s.fontFamily,
                fontSize: s.fontSize,
                fontWeight: s.fontWeight,
                letterSpacing: s.letterSpacing,
                textTransform: s.textTransform,
                borderRadius: s.borderRadius,
                padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
                border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
                boxShadow: s.boxShadow,
                overflow: s.overflow,
                rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
            };
        };

        const gridInfo = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const s = window.getComputedStyle(el);
            return {
                display: s.display,
                gridTemplateColumns: s.gridTemplateColumns,
                gap: s.gap
            };
        };

        // Check if any KPI trend pill is clipped by its parent card
        const kpiCards = [...document.querySelectorAll('#home-view .dashboard-kpis .info-card')];
        const trendClipChecks = kpiCards.map((card, idx) => {
            const cardRect = card.getBoundingClientRect();
            const trend = card.querySelector('.trend-badge');
            const spark = card.querySelector('.kpi-sparkline');
            const trendRect = trend ? trend.getBoundingClientRect() : null;
            const sparkRect = spark ? spark.getBoundingClientRect() : null;
            const clipped = trendRect
                ? (trendRect.bottom > cardRect.bottom + 1 || trendRect.right > cardRect.right + 1 || trendRect.left < cardRect.left - 1)
                : false;
            return {
                cardIndex: idx,
                cardOverflow: window.getComputedStyle(card).overflow,
                clipped,
                hasSparkline: Boolean(spark && sparkRect.width > 0)
            };
        });

        return {
            bodyBg: window.getComputedStyle(document.body).backgroundColor,
            appBodyBg: cs('.app-body')?.backgroundColor,
            mainContentBg: cs('.main-content')?.backgroundColor,
            homeViewBg: cs('#home-view')?.backgroundColor,
            sidebar: cs('.sidebar'),
            activeNav: cs('.sidebar-nav .nav-btn.active'),
            header: cs('.header'),
            pageTitle: cs('#home-view .dashboard-compact-title'),
            pageSubtitle: cs('#home-view .dashboard-compact-subtitle'),
            periodContainer: cs('#home-view .dashboard-period-controls'),
            activePeriodPill: cs('#home-view .dashboard-period-btn.active'),
            inactivePeriodPill: cs('#home-view .dashboard-period-btn:not(.active)'),
            newSaleBtn: cs('#home-view .dashboard-new-sale-btn'),
            dashboardContentGap: window.getComputedStyle(document.querySelector('#home-view #dashboard-content')).gap,
            kpiGrid: gridInfo('#home-view .dashboard-kpis'),
            kpiCard: cs('#home-view .dashboard-kpis .info-card'),
            kpiLabel: cs('#home-view .dashboard-kpis .stat-head h3'),
            kpiValue: cs('#home-view .dashboard-kpis .main-value'),
            kpiSuffix: cs('#home-view .dashboard-kpis .currency-label'),
            kpiSubText: cs('#home-view .dashboard-kpis .sub-value'),
            kpiTrendBadge: cs('#home-view .dashboard-kpis .trend-badge'),
            trendClipChecks,
            primaryRow: gridInfo('#home-view .dashboard-primary-row'),
            operationsRow: gridInfo('#home-view .dashboard-operations-row'),
            panelCard: cs('#home-view .dashboard-panel'),
            sectionTitle: cs('#home-view .panel-header h3'),
            upcomingDateChip: cs('#home-view .travel-date-chip'),
            upcomingAirlinePill: cs('#home-view .travel-progress small'),
            unpaidTotalValue: cs('#home-view .unpaid-summary-grid > div:first-child strong'),
            tableHeader: cs('#home-view .dashboard-mini-table thead th'),
            tableCell: cs('#home-view .dashboard-mini-table tbody td'),
            unpaidPnr: cs('#home-view #dashboardUnpaidTickets .clickable-pnr'),
            unpaidClient: cs('#home-view .unpaid-client-primary'),
            unpaidStatusPill: cs('#home-view .unpaid-status-pill'),
            deadlineCard: cs('#home-view .dashboard-auto-task'),
            deadlineStatus: cs('#home-view .dashboard-auto-task .dashboard-status'),
            chartColors: {
                revenueVar: window.getComputedStyle(document.body).getPropertyValue('--chart-revenue').trim(),
                profitVar: window.getComputedStyle(document.body).getPropertyValue('--chart-profit').trim()
            }
        };
    });

    console.log('--- SECTION 7 COMPUTED STYLES REPORT ---');
    console.log(JSON.stringify(report, null, 2));

    // Save 1440x900 screenshot
    const screenshotPath = path.join(ROOT, 'dashboard-exact-match-1440x900.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    const artifactDir = '/Users/tashido/.gemini/antigravity/brain/77e92fe5-aee9-43c1-ae67-c6f5b5b70a77';
    if (fs.existsSync(artifactDir)) {
        fs.copyFileSync(screenshotPath, path.join(artifactDir, 'dashboard-exact-match-1440x900.png'));
        console.log(`Screenshot copied to artifact dir: ${path.join(artifactDir, 'dashboard-exact-match-1440x900.png')}`);
    }

    // Check responsive widths for horizontal page overflow
    const viewports = [
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 }
    ];
    for (const vp of viewports) {
        await page.setViewportSize(vp);
        await page.waitForTimeout(150);
        const overflow = await page.evaluate(() => {
            return document.documentElement.scrollWidth > window.innerWidth;
        });
        console.log(`Viewport ${vp.width}x${vp.height} horizontal page overflow: ${overflow}`);
    }

    console.log(`Console errors count: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
        console.log('Console errors:', consoleErrors);
    }

    await browser.close();
    server.close();
}

run().catch(err => {
    console.error('Error running verification:', err);
    process.exit(1);
});
