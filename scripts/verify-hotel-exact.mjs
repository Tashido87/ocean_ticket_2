import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

const PORT = 8092;
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

    // Simulate authenticated session and switch to Hotel view
    await page.evaluate(async () => {
        const authContainer = document.getElementById('auth-container');
        const loading = document.getElementById('loading');
        const dashboardContent = document.getElementById('dashboard-content');
        const mainHeader = document.getElementById('main-header');
        const mainSidebar = document.getElementById('main-sidebar');
        const initialSplash = document.getElementById('initial-splash');
        const hotelView = document.getElementById('hotel-view');

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

        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'hotel');
        });

        if (hotelView) {
            hotelView.classList.add('active');
            hotelView.style.display = 'block';
        }

        const { state } = await import('./state.js');
        const hotelModule = await import('./hotel.js');

        state.allHotels = [
            {
                id: 'htl-1',
                client_name: 'Daw Hla Hla Win',
                other_names: '2',
                hotel_name: 'Grande Centre Point Hotel Terminal 21',
                country: 'Thailand',
                city: 'Bangkok',
                booking_date: '25/10/2026',
                checkin: '28/10/2026',
                checkout: '02/11/2026',
                booking_ref: 'HTL-BKK-88219',
                supplier: 'Agoda',
                base_fare: 1450000,
                net_amount: 1300000,
                commission: 150000,
                paid: 'paid',
                payment_date: '25/10/2026',
                payment_method: 'KBZ Pay',
                notes: 'High floor, non-smoking, king bed requested'
            },
            {
                id: 'htl-2',
                client_name: 'U Kyaw Myint',
                other_names: '3',
                hotel_name: 'Mandarin Oriental Bangkok',
                country: 'Thailand',
                city: 'Bangkok',
                booking_date: '26/10/2026',
                checkin: '29/10/2026',
                checkout: '03/11/2026',
                booking_ref: 'HTL-BKK-90432',
                supplier: 'Trip.com',
                base_fare: 3200000,
                net_amount: 2900000,
                commission: 300000,
                paid: 'unpaid',
                payment_date: '',
                payment_method: '',
                notes: 'River wing deluxe room'
            },
            {
                id: 'htl-3',
                client_name: 'Ko Thant Zin',
                other_names: '1',
                hotel_name: 'PARKROYAL COLLECTION Kuala Lumpur',
                country: 'Malaysia',
                city: 'Kuala Lumpur',
                booking_date: '27/10/2026',
                checkin: '30/10/2026',
                checkout: '04/11/2026',
                booking_ref: 'HTL-KUL-41029',
                supplier: 'Agoda',
                base_fare: 980000,
                net_amount: 880000,
                commission: 100000,
                paid: 'partial',
                payment_date: '27/10/2026',
                payment_method: 'Aya Pay',
                notes: 'Early check-in requested'
            }
        ];

        hotelModule.renderHotelReservations();
    });

    await page.waitForTimeout(600);

    // Save 1440x900 screenshot of hotel view
    const outName = process.argv[2] || 'hotel-exact-match-1440x900.png';
    const screenshotPath = path.join(ROOT, outName);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    const artifactDir = '/Users/tashido/.gemini/antigravity/brain/77e92fe5-aee9-43c1-ae67-c6f5b5b70a77';
    if (fs.existsSync(artifactDir)) {
        fs.copyFileSync(screenshotPath, path.join(artifactDir, outName));
    }

    // Now open New Reservation Form and take screenshot of form
    await page.evaluate(async () => {
        const hotelModule = await import('./hotel.js');
        hotelModule.showNewHotelReservationForm();
    });
    await page.waitForTimeout(300);

    const formScreenshotPath = path.join(ROOT, 'hotel-form-1440x900.png');
    await page.screenshot({ path: formScreenshotPath, fullPage: false });
    console.log(`Form screenshot saved to: ${formScreenshotPath}`);
    if (fs.existsSync(artifactDir)) {
        fs.copyFileSync(formScreenshotPath, path.join(artifactDir, 'hotel-form-1440x900.png'));
    }

    // Capture computed styles
    const styles = await page.evaluate(() => {
        const hv = document.getElementById('hotel-view');
        const hTitle = hv ? hv.querySelector('.table-header h3') : null;
        const kpiCard = hv ? hv.querySelector('.kpi-card') : null;
        const kpiVal = hv ? hv.querySelector('.kpi-value') : null;
        const newResBtn = document.getElementById('newHotelResBtn');
        const searchBtn = document.getElementById('hotelResSearchBtn');
        const searchInput = document.getElementById('hotelResSearchText');
        const tableHeader = hv ? hv.querySelector('.sell-table th') : null;
        const tableRow = hv ? hv.querySelector('.sell-table tbody tr') : null;

        function getInfo(el) {
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            // Check all rules matching el
            const matchingRules = [];
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules || []) {
                        if (rule.selectorText && el.matches(rule.selectorText)) {
                            matchingRules.push({
                                selector: rule.selectorText,
                                href: sheet.href,
                                cssText: rule.cssText
                            });
                        }
                    }
                } catch (e) {}
            }
            return {
                bg: cs.backgroundColor,
                color: cs.color,
                fontFamily: cs.fontFamily,
                fontSize: cs.fontSize,
                fontWeight: cs.fontWeight,
                border: cs.border,
                borderRadius: cs.borderRadius,
                padding: cs.padding,
                matchingRules: matchingRules.slice(-5)
            };
        }

        return {
            pageBg: window.getComputedStyle(document.body).backgroundColor,
            hotelTitle: getInfo(hTitle),
            kpiCard: getInfo(kpiCard),
            kpiVal: getInfo(kpiVal),
            newResBtn: getInfo(newResBtn),
            searchBtn: getInfo(searchBtn),
            searchInput: getInfo(searchInput),
            tableHeader: getInfo(tableHeader),
            tableRow: getInfo(tableRow)
        };
    });

    console.log('Hotel Computed Styles:', JSON.stringify(styles, null, 2));

    await browser.close();
    server.close();
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
