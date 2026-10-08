import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
html = html.replace('</head>', '<script src="/background-settings.js"></script></head>');
html = html.replace('</body>', `<script>
document.body.className='material-theme';
document.querySelector('#initial-splash')?.remove();
document.querySelectorAll('.view').forEach(e=>{e.classList.remove('active');e.style.display='none'});
document.querySelector('#settings-view').style.display='block';
document.querySelector('#settings-view').classList.add('active');
document.querySelector('#main-header').style.display='flex';
document.querySelector('#main-sidebar').style.display='flex';
</script><script type="module" src="/liquid-glass-ui.js"></script></body>`);
const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (!/^\/(?:[\w-]+\.css|background-settings\.js|liquid-glass-ui\.js|vendor\/liquid-glass\.(?:js|css)|assets\/backgrounds\/duo-night\.jpg|ocean-travel-logo\.png)$/.test(pathname)) { res.writeHead(404); res.end(); return; }
    try {
        res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
        res.end(await readFile(path.join(root, pathname)));
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({ executablePath: '/Applications/Opera.app/Contents/MacOS/Opera', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.locator('html').getAttribute('data-background'), 'plain');
    await page.locator('input[value="duo-night"]').check();
    assert.equal(await page.locator('html').getAttribute('data-background'), 'duo-night');
    await page.waitForFunction(() => document.querySelector('#main-header .ocean-glass-wallpaper')?.complete);
    assert.equal(await page.locator('#app-wallpaper-backdrop').evaluate(el => getComputedStyle(el).display), 'block');
    assert.equal(await page.locator('#settings-view .page-header h2').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
    await page.screenshot({ path: '/tmp/ocean-wallpaper-light.png', fullPage: true });
    await page.reload();
    assert.equal(await page.locator('input[value="duo-night"]').isChecked(), true);
    await page.evaluate(() => document.body.classList.add('dark-theme'));
    await page.screenshot({ path: '/tmp/ocean-wallpaper-dark.png', fullPage: true });
    assert.equal(await page.locator('.settings-card').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(28, 28, 30)');
    await page.locator('input[value="plain"]').check();
    assert.equal(await page.locator('#app-wallpaper-backdrop').evaluate(el => getComputedStyle(el).display), 'none');
    await page.locator('input[value="duo-night"]').check();
    await page.locator('#reset-settings-btn').click();
    assert.equal(await page.locator('html').getAttribute('data-background'), 'plain');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('input[value="duo-night"]').check();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const privatePage = await browser.newPage();
    await privatePage.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }));
    await privatePage.route('https://**/*', route => route.abort());
    await privatePage.goto(`http://127.0.0.1:${server.address().port}`);
    await privatePage.locator('input[value="duo-night"]').check();
    assert.match(await privatePage.locator('#background-choice-status').textContent(), /Storage unavailable/);
    assert.deepEqual(errors, []);
    console.log('PASS: Opera wallpaper selection, persistence, glass image layer, text colors, dark mode, reset, mobile overflow, blocked-storage fallback.');
} finally { await browser?.close(); server.close(); }
