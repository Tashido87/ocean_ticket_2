import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';
export const files = ['styles.css', 'landing.css', 'sell.css', 'apple-ui.css', 'sell-desktop-layout.css', 'pnr-detail.css', 'dashboard.css', 'page-harmony.css', 'service-colors.css', 'solid-ui.css'];
const sources = await Promise.all(files.map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
const input = sources.join('\n');
const result = await transform(input, { loader: 'css', minify: true, legalComments: 'eof' });
await writeFile(new URL('../app-styles.min.css', import.meta.url), result.code);
console.log(`CSS: ${Buffer.byteLength(input)} → ${Buffer.byteLength(result.code)} bytes; ${files.length} requests → 1. Source order preserved.`);
