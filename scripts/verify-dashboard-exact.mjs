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

    // Navigate to page
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });

    // Simulate authenticated session and active dashboard view
    await page.evaluate(() => {
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
        if (homeView) homeView.classList.add('active');

        // Populate sample data for cards if empty
        const revVal = document.getElementById('monthly-revenue-value');
        if (revVal && revVal.textContent === '0') revVal.textContent = '12,450,000';
        const tktVal = document.getElementById('total-tickets-value');
        if (tktVal && tktVal.textContent === '0') tktVal.textContent = '48';
        const pftVal = document.getElementById('total-profit-value');
        if (pftVal && pftVal.textContent === '0') pftVal.textContent = '1,820,000';
        const ownVal = document.getElementById('owner-payable-value');
        if (ownVal && ownVal.textContent === '0') ownVal.textContent = '3,200,000';
        const slfVal = document.getElementById('self-profit-value');
        if (slfVal && slfVal.textContent === '0') slfVal.textContent = '650,000';

        const revTrend = document.getElementById('revenue-trend-wrapper');
        if (revTrend && !revTrend.innerHTML) revTrend.innerHTML = '<span class="trend-badge positive"><i class="fa-solid fa-arrow-trend-up"></i> +12%</span>';
        const tktTrend = document.getElementById('tickets-trend-wrapper');
        if (tktTrend && !tktTrend.innerHTML) tktTrend.innerHTML = '<span class="trend-badge positive"><i class="fa-solid fa-arrow-trend-up"></i> +4</span>';
        const pftTrend = document.getElementById('profit-trend-wrapper');
        if (pftTrend && !pftTrend.innerHTML) pftTrend.innerHTML = '<span class="trend-badge positive"><i class="fa-solid fa-arrow-trend-up"></i> +8.5%</span>';
        const ownTrend = document.getElementById('owner-payable-trend-wrapper');
        if (ownTrend && !ownTrend.innerHTML) ownTrend.innerHTML = '<span class="trend-badge negative"><i class="fa-solid fa-circle-exclamation"></i> outstanding</span>';
        const slfTrend = document.getElementById('self-profit-trend-wrapper');
        if (slfTrend && !slfTrend.innerHTML) slfTrend.innerHTML = '<span class="trend-badge positive"><i class="fa-solid fa-arrow-trend-up"></i> +15%</span>';

        // Update booking badge
        const badge = document.getElementById('sidebarBookingBadge');
        if (badge) {
            badge.textContent = '3';
            badge.style.display = 'inline-flex';
        }
    });

    // Wait a brief moment for styles/layout to settle
    await page.waitForTimeout(500);

    // Extract computed styles
    const styles = await page.evaluate(() => {
        const getStyles = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return {
                display: cs.display,
                width: cs.width,
                height: cs.height,
                background: cs.backgroundColor,
                color: cs.color,
                fontSize: cs.fontSize,
                fontWeight: cs.fontWeight,
                padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
                borderRadius: cs.borderRadius,
                borderColor: cs.borderColor,
                borderWidth: cs.borderWidth,
                boxShadow: cs.boxShadow,
                fontFamily: cs.fontFamily
            };
        };

        const gridStyles = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return {
                display: cs.display,
                gridTemplateColumns: cs.gridTemplateColumns,
                gap: cs.gap
            };
        };

        const sidebarMatched = [];
        const sidebarEl = document.querySelector('.sidebar');
        if (sidebarEl) {
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (rule.selectorText && sidebarEl.matches(rule.selectorText) && rule.style && rule.style.backgroundColor) {
                            sidebarMatched.push({ selector: rule.selectorText, bg: rule.style.backgroundColor });
                        }
                    }
                } catch(e) {}
            }
        }

        return {
            sidebar: getStyles('.sidebar'),
            appBody: getStyles('.app-body'),
            header: getStyles('.header'),
            pageTitle: getStyles('#home-view .dashboard-compact-title'),
            kpiCard: getStyles('#home-view .dashboard-kpis .info-card'),
            kpiLabel: getStyles('#home-view .dashboard-kpis .stat-head h3'),
            kpiValue: getStyles('#home-view .dashboard-kpis .main-value'),
            kpiGrid: gridStyles('#home-view .dashboard-kpis'),
            primaryRow: gridStyles('#home-view .dashboard-primary-row'),
            operationsRow: gridStyles('#home-view .dashboard-operations-row'),
            chartPanelHeader: getStyles('#booking-revenue-overview-box .panel-header h3'),
            travelPanelHeader: getStyles('#travel-schedule-box .panel-header h3'),
            unpaidPanelHeader: getStyles('#dashboard-unpaid-box .panel-header h3'),
            tasksPanelHeader: getStyles('#tasks-reminders-box .panel-header h3'),
            activeNavBtn: getStyles('.sidebar-nav .nav-btn.active'),
            bookingBadge: getStyles('.sidebar-badge.booking-badge'),
            newSaleBtn: getStyles('#home-view .dashboard-new-sale-btn'),
            periodControls: getStyles('#home-view .dashboard-period-controls'),
            periodBtnActive: getStyles('#home-view .dashboard-period-btn.active')
        };
    });

    console.log('--- COMPUTED STYLES ---');
    console.log(JSON.stringify(styles, null, 2));

    // Save screenshot
    const screenshotPath = path.join(ROOT, 'dashboard-exact-match-1440x900.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    // Also copy to artifacts directory
    const artifactDir = '/Users/tashido/.gemini/antigravity/brain/77e92fe5-aee9-43c1-ae67-c6f5b5b70a77';
    if (fs.existsSync(artifactDir)) {
        fs.copyFileSync(screenshotPath, path.join(artifactDir, 'dashboard-exact-match-1440x900.png'));
        console.log(`Screenshot copied to artifact dir: ${path.join(artifactDir, 'dashboard-exact-match-1440x900.png')}`);
    }

    await browser.close();
    server.close();
}

run().catch(err => {
    console.error('Error running verification:', err);
    process.exit(1);
});
