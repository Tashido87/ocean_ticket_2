import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

const PORT = 8098;
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

async function diagnose() {
    await new Promise(r => server.listen(PORT, r));

    const browser = await chromium.launch({
        executablePath: '/Applications/Opera.app/Contents/MacOS/Opera',
        headless: true
    });

    const page = await browser.newPage();
    const t0 = Date.now();
    const marks = {};

    page.on('console', msg => {
        const text = msg.text();
        const t = Date.now() - t0;
        if (text.includes('signed in') || text.includes('Firestore') || text.includes('warning') || text.includes('error')) {
            console.log(`[Console @ ${t}ms]`, text);
        }
    });

    // Inject timing markers before anything else runs
    await page.addInitScript(() => {
        window.__timing = {
            start: performance.now(),
            domInteractive: 0,
            domContentLoaded: 0,
            windowLoad: 0,
            splashRemoved: 0
        };
        document.addEventListener('readystatechange', () => {
            if (document.readyState === 'interactive') {
                window.__timing.domInteractive = performance.now();
            }
        });
        document.addEventListener('DOMContentLoaded', () => {
            window.__timing.domContentLoaded = performance.now();
        });
        window.addEventListener('load', () => {
            window.__timing.windowLoad = performance.now();
        });
        // Watch initial-splash removal
        const observer = new MutationObserver(() => {
            const s = document.getElementById('initial-splash');
            if (s && (s.style.display === 'none' || s.style.opacity === '0')) {
                if (!window.__timing.splashRemoved) {
                    window.__timing.splashRemoved = performance.now();
                }
            }
        });
        observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['style'] });
    });

    console.log("Loading page at http://localhost:" + PORT + "...");
    await page.goto(`http://localhost:${PORT}`);

    // Wait until splash is gone or max 10s
    await page.waitForFunction(() => {
        const s = document.getElementById('initial-splash');
        return !s || s.style.display === 'none';
    }, { timeout: 12000 }).catch(() => console.log("Splash wait timed out"));

    const timing = await page.evaluate(() => window.__timing);
    console.log("Internal page timings (ms from navigation):", timing);

    // Analyze network transfers
    const transferSummary = await page.evaluate(() => {
        const entries = performance.getEntriesByType('resource');
        let totalSize = 0;
        let cdnSize = 0;
        let localSize = 0;
        let cdnCount = 0;
        let localCount = 0;
        const domains = {};

        entries.forEach(e => {
            totalSize += e.transferSize || 0;
            const url = new URL(e.name);
            const domain = url.hostname;
            domains[domain] = domains[domain] || { count: 0, transferSize: 0, duration: 0 };
            domains[domain].count++;
            domains[domain].transferSize += e.transferSize || 0;
            domains[domain].duration = Math.max(domains[domain].duration, e.duration);

            if (domain === 'localhost') {
                localSize += e.transferSize || 0;
                localCount++;
            } else {
                cdnSize += e.transferSize || 0;
                cdnCount++;
            }
        });

        return {
            totalRequests: entries.length,
            totalTransferBytes: totalSize,
            domains
        };
    });

    console.log("Network Transfer Breakdown by Hostname:");
    console.table(transferSummary.domains);

    await browser.close();
    server.close();
}

diagnose();
