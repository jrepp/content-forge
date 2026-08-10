// texture-sheet: emit a self-contained HTML contact sheet of every texture in
// out/, each cell showing the (upscaled, nearest-neighbor) texture + its name +
// origin, for automated (vision / browser-driven) review. Images are inlined as
// base64 data URIs so the sheet is one portable file that survives out/ being
// regenerated. Deterministic: cells sorted by category then name.
//
//   node scripts/texture-sheet.mjs [--out texture-review.html]
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadConfig, repoRoot } from './config.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const outFile = join(repoRoot, (args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : 'texture-review.html'));
const texRoot = join(config.outDir, 'assets', 'minecraft', 'textures');
if (!existsSync(texRoot)) { console.error(`no textures in out/ (${texRoot}) — run the producers first`); process.exit(1); }

// origin map: which textures content-forge produced vs borrowed real assets
const producersPath = join(config.outDir, '.producers.json');
const producers = existsSync(producersPath) ? JSON.parse(readFileSync(producersPath, 'utf8')) : {};

function walk(dir, acc = []) {
	for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, acc) : (n.endsWith('.png') && acc.push(p)); }
	return acc;
}

const files = walk(texRoot).sort();
const cells = files.map((abs) => {
	const rel = relative(texRoot, abs).replace(/\\/g, '/');        // e.g. block/acacia_planks.png
	const id = rel.replace(/\.png$/, '');                          // block/acacia_planks
	const category = id.includes('/') ? id.slice(0, id.indexOf('/')) : '(root)';
	const name = id.slice(id.lastIndexOf('/') + 1);
	const target = `assets/minecraft/textures/${rel}`;
	const prod = producers[target];
	const origin = prod ? (prod.producer === 'texture-gen' ? 'generated' : prod.producer) : 'borrowed';
	const recipe = prod ? prod.recipe : '';
	const data = readFileSync(abs).toString('base64');
	return { id, category, name, origin, recipe, data };
});

// group by category, deterministic order
const byCat = {};
for (const c of cells) (byCat[c.category] ??= []).push(c);
const categories = Object.keys(byCat).sort();
const genCount = cells.filter((c) => c.origin === 'generated').length;
const borrowedCount = cells.length - genCount;

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const cellHtml = (c) => `<figure class="cell" data-name="${esc(c.name)}" data-id="${esc(c.id)}" data-origin="${esc(c.origin)}">
<img alt="${esc(c.name)}" src="data:image/png;base64,${c.data}">
<figcaption><span class="nm">${esc(c.name)}</span><span class="og og-${esc(c.origin)}">${esc(c.origin)}</span></figcaption>
</figure>`;

const nav = categories.map((cat) => `<a href="#cat-${esc(cat)}">${esc(cat)} <b>${byCat[cat].length}</b></a>`).join('');
const sections = categories.map((cat) => {
	const items = byCat[cat].sort((a, b) => a.name.localeCompare(b.name));
	return `<section id="cat-${esc(cat)}"><h2>${esc(cat)} <small>${items.length}</small></h2><div class="grid">${items.map(cellHtml).join('')}</div></section>`;
}).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Texture review sheet — ${cells.length} textures</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.4 -apple-system, system-ui, sans-serif; }
header { position: sticky; top: 0; background: Canvas; border-bottom: 1px solid #8888; padding: 10px 16px; z-index: 2; }
header h1 { font-size: 15px; margin: 0 0 6px; }
.summary { color: #888; font-size: 12px; margin-bottom: 6px; }
nav { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; }
nav a { text-decoration: none; color: inherit; opacity: .8; } nav a:hover { opacity: 1; }
nav b { opacity: .55; font-weight: 600; }
section { padding: 4px 16px 20px; }
section h2 { font-size: 14px; border-bottom: 1px solid #8884; padding-bottom: 4px; position: sticky; top: 74px; background: Canvas; }
section h2 small { color: #888; font-weight: 400; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px; }
.cell { margin: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
.cell img { width: 64px; height: 64px; object-fit: contain; image-rendering: pixelated; background:
  conic-gradient(#0000 25%, #8882 0 50%, #0000 0 75%, #8882 0) 0 0 / 12px 12px; border: 1px solid #8883; border-radius: 3px; }
figcaption { margin-top: 4px; width: 100%; }
.nm { display: block; font-family: ui-monospace, Menlo, monospace; font-size: 10px; word-break: break-all; }
.og { display: inline-block; margin-top: 2px; font-size: 8px; padding: 1px 4px; border-radius: 3px; text-transform: uppercase; letter-spacing: .04em; }
.og-generated { background: #1a7f37; color: #fff; }
.og-borrowed { background: #57606a; color: #fff; }
</style></head><body>
<header>
<h1>Texture review sheet</h1>
<div class="summary"><b>${cells.length}</b> textures &middot; <b>${genCount}</b> generated (content-forge) &middot; <b>${borrowedCount}</b> borrowed &middot; ${categories.length} categories</div>
<nav>${nav}</nav>
</header>
${sections}
</body></html>`;

writeFileSync(outFile, html);
console.log(`wrote ${relative(repoRoot, outFile)} — ${cells.length} textures (${genCount} generated, ${borrowedCount} borrowed), ${categories.length} categories`);
for (const cat of categories) console.log(`  ${cat.padEnd(14)} ${byCat[cat].length}`);
