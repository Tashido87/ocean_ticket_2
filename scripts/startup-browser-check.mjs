import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const cssFiles = ['styles.css', 'landing.css', 'sell.css', 'apple-ui.css', 'sell-desktop-layout.css', 'pnr-detail.css', 'dashboard.css', 'page-harmony.css', 'service-colors.css', 'solid-ui.css'];
const index = await readFile(path.join(root, 'index.html'), 'utf8');
const main = await readFile(path.join(root, 'main.js'), 'utf8');
assert(!/glass-start|liquid-glass/.test(index + main));
assert(!/<script[^>]+src=["'][^"']*(jspdf|html2canvas|pdf\.min|tesseract)/i.test(index));
assert(!/^import .*from ['"].*(hotel\.js|airasia-converter|agoda-hotel-converter)/m.test(main));
const fixture = index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace('</body>', `<script>document.querySelector('#initial-splash')?.remove();document.body.className='material-theme';document.querySelectorAll('.view').forEach(e=>{e.style.display='block';e.classList.add('active')});document.querySelector('#dashboard-content').style.display='flex';</script></body>`);
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/empty') { res.end('<!doctype html><body><div id="hotel-view"></div><div id="services-view"></div></body>'); return; }
    if (url.pathname === '/new' || url.pathname === '/old') {
        res.end(url.pathname === '/old' ? fixture.replace('<link rel="stylesheet" href="app-styles.min.css?v=1">', cssFiles.map(f => `<link rel="stylesheet" href="/${f}">`).join('')) : fixture);
        return;
    }
    const allowed = [...cssFiles, 'app-styles.min.css', 'document-libraries.js'];
    if (!allowed.includes(url.pathname.slice(1))) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(path.join(root, url.pathname)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({ executablePath: '/Applications/Opera.app/Contents/MacOS/Opera', headless: true });
    const page = await browser.newPage();
    const requests = [];
    let failCanvas = true;
    await page.route('https://**/*', async route => {
        const url = route.request().url(); requests.push(url);
        let body = '';
        if (url.includes('jspdf.umd')) body = 'window.jspdf={jsPDF:function(){}};window.jspdf.jsPDF.API={}';
        else if (url.includes('autotable')) body = 'if(!window.jspdf)throw Error("order");window.jspdf.jsPDF.API.autoTable=function(){}';
        else if (url.includes('html2canvas')) { if (failCanvas) { failCanvas = false; await route.abort(); return; } body = 'window.html2canvas=function(){}'; }
        else if (url.includes('pdf.min')) body = 'window.pdfjsLib={}';
        else if (url.includes('tesseract')) body = 'window.Tesseract={}';
        await route.fulfill({ contentType: 'text/javascript', body });
    });
    await page.goto(`${base}/empty`);
    await page.evaluate(async () => { window.libs = await import('/document-libraries.js'); });
    assert.equal(requests.length, 0);
    await page.evaluate(() => Promise.all([window.libs.loadDocumentLibraries('table'), window.libs.loadDocumentLibraries('table', 'reader', 'ocr')]));
    assert.equal(requests.filter(u => u.includes('jspdf.umd')).length, 1);
    assert.equal(requests.filter(u => u.includes('autotable')).length, 1);
    assert.equal(await page.evaluate(() => window.libs.loadDocumentLibraries('canvas').then(() => false, () => true)), true);
    await page.evaluate(() => window.libs.loadDocumentLibraries('canvas'));
    assert.equal(requests.filter(u => u.includes('html2canvas')).length, 2);
    const snapshot = async (url, width, dark) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(url);
        await page.evaluate(dark => document.body.classList.toggle('dark-theme', dark), dark);
        return page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,button,input,select,.service-panel,.settings-card,.dashboard-panel,.booking-kpi-card,.sell-section')].map(el => {
            const s = getComputedStyle(el);
            return ['display','position','fontFamily','fontSize','color','backgroundColor','borderRadius','padding','gridTemplateColumns'].map(k => s[k]);
        }));
    };
    // External fonts are blocked in both cases, so comparisons are deterministic.
    for (const width of [1440, 390]) for (const dark of [false, true]) {
        const old = await snapshot(`${base}/old`, width, dark);
        const current = await snapshot(`${base}/new`, width, dark);
        assert.deepEqual(current, old, `CSS changed at ${width}px dark=${dark}`);
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => getComputedStyle(el).backdropFilter !== 'none').map(el => ({ tag: el.tagName, id: el.id, style: el.getAttribute('style'), filter: getComputedStyle(el).backdropFilter }))), []);
    }
    console.log('PASS: lazy document tools, retry, no glass startup, no backdrop filters and matching CSS (desktop/mobile, light/dark).');
} finally { await browser?.close(); server.close(); }
