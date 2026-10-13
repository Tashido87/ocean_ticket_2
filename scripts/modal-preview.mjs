// Isolated browser regression fixture: actual modal code/CSS, no auth or database.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const ui = await readFile(new URL('../ui.js', import.meta.url), 'utf8');
const code = ui.slice(ui.indexOf('let lastFocusedElementBeforeModal'), ui.indexOf('export function showConfirmModal')).replaceAll('export function ', 'function ');
const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app-styles.min.css"></head><body class="material-theme"><main id="manage-view" class="active" style="padding:24px"><h1>Manage regression preview — no customer data</h1><button id="payment" class="btn btn-primary">Payment</button><button id="navigate" class="btn btn-secondary">Navigate after closing</button><p id="result">Ready</p></main><div id="modal" class="modal"><div class="modal-content"><div id="modalBody"></div></div></div><script src="/fixture.js"></script></body></html>`;
const handlers = `
document.getElementById('payment').onclick=()=>{openModal('<h2>Payment</h2><button id="partial" class="btn btn-primary">Partial payment</button>');document.getElementById('partial').onclick=()=>{openModal('<h2>Partial payment</h2><button id="cancel" class="btn btn-secondary">Cancel</button>');document.getElementById('cancel').onclick=closeModal;}};
document.getElementById('navigate').onclick=()=>{document.getElementById('result').textContent='PASS: background clickable after nested modal';};
if(location.search.includes('dark'))document.body.classList.add('dark-theme');
`;
createServer(async (req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(code + handlers); }
    else if (req.url === '/app-styles.min.css') { res.setHeader('Content-Type', 'text/css'); res.end(await readFile(new URL('../app-styles.min.css', import.meta.url))); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(page); }
}).listen(8877, '127.0.0.1', () => console.log('Isolated modal preview: http://127.0.0.1:8877'));
