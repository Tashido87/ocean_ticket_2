import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vendor/liquid-glass.css"><link rel="stylesheet" href="/liquid-glass-ui.css">
<style>body{font:14px system-ui;background:#f4f7f8;color:#17333b;margin:24px}header{position:relative;padding:20px;border-radius:16px}main{max-width:900px;margin:auto}.dashboard-period-controls{padding:10px;border-radius:12px;margin:20px 0;display:flex;gap:10px}button,input{font:inherit;padding:12px;border:1px solid #ccd9dc;border-radius:10px;background:white;color:#17333b}#sellForm{display:grid;grid-template-columns:1fr 300px;gap:20px}#section-payment{padding:20px;border-radius:16px}.trip-ticket-header{position:relative;padding:30px;border-radius:16px;color:white;margin-top:24px}.dark-theme{background:#111827;color:white}@media(max-width:600px){#sellForm{display:block}input{max-width:70%}}</style>
<body class="material-theme"><main><header id="main-header"><input placeholder="Search client or PNR"><button id="search">Search</button></header>
<section id="home-view"><div class="dashboard-period-controls"><button>This Month</button><button>Today</button><button>Custom</button></div></section>
<form id="sellForm"><div><h2>Booking details</h2><input placeholder="Passenger name"></div><section id="section-payment"><h3>Payment & Review</h3><p>Total: 996,000 MMK</p><button type="button" id="submit">Submit Ticket</button></section></form>
<div class="pnr-detail-dialog"><div class="trip-ticket-header">Yangon (RGN) → Bangkok (BKK) <button id="close">Close</button></div></div></main>
<script>window.clicks=0;document.querySelector('#submit').onclick=()=>window.clicks++;document.querySelector('#close').onclick=()=>document.querySelector('.pnr-detail-dialog').remove()</script>
<script type="module" src="/liquid-glass-ui.js"></script>`;
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const allowed = ['/liquid-glass-ui.js', '/liquid-glass-ui.css', '/vendor/liquid-glass.js', '/vendor/liquid-glass.css'];
    if (!allowed.includes(url.pathname)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(path.join(root, url.pathname)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({ executablePath: process.env.GLASS_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelectorAll('.ocean-glass-host').length === 4);
    await page.waitForTimeout(9000);
    await page.locator('#submit').click();
    assert.equal(await page.evaluate(() => window.clicks), 1);
    assert.equal(await page.locator('#section-payment').evaluate(el => getComputedStyle(el).position), 'relative');
    console.log('GPU render status:', await page.evaluate(() => ({ gpu: !!navigator.gpu, ready: document.querySelectorAll('.ocean-glass-ready').length, layers: document.querySelectorAll('.ocean-glass-layer').length })));
    await page.screenshot({ path: '/tmp/ocean-glass-preview.png', fullPage: true });
    await page.locator('#close').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.pnr-detail-dialog').count(), 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.ocean-glass-layer').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.ocean-glass-layer').count(), 0);
    await page.locator('#submit').click();
    assert.equal(await page.evaluate(() => window.clicks), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => document.body.classList.add('dark-theme'));
    assert.match(await page.locator('#section-payment').evaluate(el => getComputedStyle(el).backgroundImage), /30, 41, 59/);
    assert.deepEqual(errors, []);
    const fallback = await browser.newPage();
    await fallback.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await fallback.goto(`http://127.0.0.1:${server.address().port}`);
    await fallback.waitForFunction(() => document.querySelectorAll('.ocean-glass-host').length === 4);
    assert.equal(await fallback.locator('.ocean-glass-layer').count(), 0);
    await fallback.locator('#submit').click();
    assert.equal(await fallback.evaluate(() => window.clicks), 1);
    await fallback.close();
    console.log('PASS: controls, popup removal, reduced-motion fallback, mobile overflow, dark mode, no uncaught errors.');
} finally {
    await browser?.close();
    server.close();
}
