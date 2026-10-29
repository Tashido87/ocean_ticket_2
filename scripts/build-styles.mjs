import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';

export const files = [
    'styles.css',
    'landing.css',
    'sell.css',
    'apple-ui.css',
    'sell-desktop-layout.css',
    'pnr-detail.css',
    'dashboard.css',
    'page-harmony.css',
    'service-colors.css',
    'solid-ui.css',
    'settle-exact.css',
    'hotel-exact.css'
];

export const jsModules = [
    'agoda-hotel-converter.js',
    'airasia-converter.js',
    'auth.js',
    'booking.js',
    'china-airlines-converter.js',
    'china-airlines-parser.mjs',
    'clients.js',
    'config.js',
    'dashboard.js',
    'db.js',
    'document-libraries.js',
    'documents.js',
    'firebase-config.js',
    'history.js',
    'hotel.js',
    'invoice-selection.mjs',
    'invoice.js',
    'main.js',
    'manage.js',
    'passport-ocr.js',
    'passport-parser.mjs',
    'passport.js',
    'reports.js',
    'search.js',
    'settlement.js',
    'state.js',
    'tickets.js',
    'ui.js',
    'utils.js'
];

const corePrecacheModules = [
    'document-libraries.js',
    'main.js',
    'dashboard.js',
    'auth.js',
    'firebase-config.js',
    'utils.js',
    'state.js',
    'db.js',
    'ui.js',
    'tickets.js',
    'booking.js',
    'settlement.js',
    'clients.js',
    'reports.js',
    'search.js',
    'manage.js',
    'history.js',
    'hotel.js',
    'agoda-hotel-converter.js',
    'airasia-converter.js',
    'invoice.js',
    'invoice-selection.mjs',
    'documents.js',
    'config.js',
    'passport.js',
    'passport-ocr.js',
    'passport-parser.mjs',
    'china-airlines-converter.js',
    'china-airlines-parser.mjs'
];

function shortHash(content) {
    return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

// 1. Bundle & minify CSS
const sources = await Promise.all(files.map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
const input = sources.join('\n');
const result = await transform(input, { loader: 'css', minify: true, legalComments: 'eof' });
await writeFile(new URL('../app-styles.min.css', import.meta.url), result.code);
const cssHash = shortHash(result.code);

// 2. Compute content hashes for all JS/MJS modules
const moduleHashes = new Map();
const overallHasher = createHash('sha256').update(result.code);

for (const mod of jsModules) {
    const modContent = await readFile(new URL(`../${mod}`, import.meta.url), 'utf8');
    const hash = shortHash(modContent);
    moduleHashes.set(mod, hash);
    overallHasher.update(`${mod}:${hash}\n`);
}

// 3. Update index.html with CSS content hash, Import Map for all sub-modules, and main.js hash
const indexUrl = new URL('../index.html', import.meta.url);
let indexHtml = await readFile(indexUrl, 'utf8');

indexHtml = indexHtml.replace(
    /<link rel="stylesheet" href="app-styles\.min\.css(?:\?v=[^"]*)?">/,
    `<link rel="stylesheet" href="app-styles.min.css?v=${cssHash}">`
);

const importMapEntries = {};
for (const [mod, hash] of moduleHashes.entries()) {
    importMapEntries[`./${mod}`] = `./${mod}?v=${hash}`;
}
const importMapBlock = `<script type="importmap" id="app-importmap">\n${JSON.stringify({ imports: importMapEntries }, null, 2)}\n    </script>`;

if (/<script type="importmap" id="app-importmap">[\s\S]*?<\/script>/.test(indexHtml)) {
    indexHtml = indexHtml.replace(
        /<script type="importmap" id="app-importmap">[\s\S]*?<\/script>/,
        importMapBlock
    );
} else {
    indexHtml = indexHtml.replace(
        /<script src="main\.js(?:\?v=[^"]*)?" type="module"><\/script>/,
        `${importMapBlock}\n    <script src="main.js?v=${moduleHashes.get('main.js')}" type="module"></script>`
    );
}

indexHtml = indexHtml.replace(
    /<script src="main\.js(?:\?v=[^"]*)?" type="module"><\/script>/,
    `<script src="main.js?v=${moduleHashes.get('main.js')}" type="module"></script>`
);

await writeFile(indexUrl, indexHtml);

// 4. Update sw.js with overall build cache name and synchronized versioned CORE_ASSETS
overallHasher.update(indexHtml);
const buildHash = overallHasher.digest('hex').slice(0, 8);

const swUrl = new URL('../sw.js', import.meta.url);
let swContent = await readFile(swUrl, 'utf8');

const coreAssetsList = [
    './',
    './index.html',
    './manifest.json',
    './ocean-travel-logo.png',
    `./app-styles.min.css?v=${cssHash}`,
    './dashboard-exact.css?v=10',
    './settle-exact.css?v=2',
    './hotel-exact.css?v=1',
    ...corePrecacheModules.map(mod => `./${mod}?v=${moduleHashes.get(mod)}`)
];

swContent = swContent.replace(
    /const CACHE_NAME = '[^']+';/,
    `const CACHE_NAME = 'ocean-travel-${buildHash}';`
);

swContent = swContent.replace(
    /const CORE_ASSETS = \[[\s\S]*?\];/,
    `const CORE_ASSETS = [\n${coreAssetsList.map(item => `    '${item}'`).join(',\n')}\n];`
);

await writeFile(swUrl, swContent);

console.log(`CSS: ${Buffer.byteLength(input)} → ${Buffer.byteLength(result.code)} bytes; ${files.length} requests → 1. Source order preserved.`);
console.log(`Versioned ${jsModules.length} JS modules + CSS (v=${cssHash}) → SW cache 'ocean-travel-${buildHash}'.`);
