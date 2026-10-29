import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

const PORT = 8097;
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

    const browser = await chromium.launch({
        executablePath: '/Applications/Opera.app/Contents/MacOS/Opera',
        headless: true
    });

    const page = await browser.newPage();
    const t0 = Date.now();
    const timeline = [];

    page.on('console', msg => {
        timeline.push({ type: 'console', time: Date.now() - t0, text: msg.text() });
    });

    page.on('request', req => {
        timeline.push({ type: 'request', time: Date.now() - t0, url: req.url() });
    });

    page.on('requestfinished', req => {
        timeline.push({ type: 'finished', time: Date.now() - t0, url: req.url() });
    });

    page.on('requestfailed', req => {
        timeline.push({ type: 'failed', time: Date.now() - t0, url: req.url(), error: req.failure()?.errorText });
    });

    console.log("Navigating to http://localhost:" + PORT + "...");
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
    console.log(`Page 'load' event fired at ${Date.now() - t0}ms`);

    // Wait until networkidle or 5 seconds
    try {
        await page.waitForLoadState('networkidle', { timeout: 8000 });
        console.log(`Network idle at ${Date.now() - t0}ms`);
    } catch(e) {
        console.log(`Network did not idle within 8s`);
    }

    const splashStatus = await page.evaluate(() => {
        const s = document.getElementById('initial-splash');
        return {
            exists: !!s,
            display: s?.style.display,
            opacity: s?.style.opacity,
            visibility: s ? window.getComputedStyle(s).visibility : null
        };
    });
    console.log("Splash status:", splashStatus);

    const perfEntries = await page.evaluate(() => {
        return performance.getEntriesByType('navigation').map(n => ({
            domContentLoaded: n.domContentLoadedEventEnd - n.startTime,
            loadComplete: n.loadEventEnd - n.startTime,
            responseEnd: n.responseEnd - n.startTime
        }));
    });
    console.log("Navigation timing:", perfEntries);

    const resources = await page.evaluate(() => {
        return performance.getEntriesByType('resource').map(r => ({
            name: r.name,
            duration: Math.round(r.duration),
            transferSize: r.transferSize,
            initiatorType: r.initiatorType
        })).sort((a,b) => b.duration - a.duration).slice(0, 15);
    });
    console.log("Slowest 15 resources:", resources);

    console.log("Total timeline events:", timeline.length);
    console.log("First 20 timeline events:");
    timeline.slice(0, 20).forEach(e => console.log(`${e.time}ms [${e.type}] ${e.url ? e.url.slice(0, 80) : e.text}`));

    await browser.close();
    server.close();
}

run();
