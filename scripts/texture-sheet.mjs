// texture-sheet: emit self-contained HTML contact sheet(s) of every texture in
// out/, grouped BY FAMILY (stone, wood, planks, coral, plant, ingot, gem, …) so a
// recipe can be reviewed against its whole cohort at a glance. Each cell shows the
// upscaled (nearest-neighbor) texture, its name, and origin (generated vs borrowed).
// Images are inlined as base64 so a sheet is one portable file that survives out/
// being regenerated. Deterministic: families in core order, cells sorted by name.
//
//   node scripts/texture-sheet.mjs                       # one sheet, family sections
//   node scripts/texture-sheet.mjs --split               # one file per family + index
//   node scripts/texture-sheet.mjs --family stone        # just the stone family
//   node scripts/texture-sheet.mjs --out review.html
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, repoRoot } from './config.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const outFile = join(repoRoot, opt('--out') || 'texture-review.html');
const split = args.includes('--split');
const onlyFamily = opt('--family');
const texRoot = join(config.outDir, 'assets', 'minecraft', 'textures');
if (!existsSync(texRoot)) { console.error(`no textures in out/ (${texRoot}) — run the producers first`); process.exit(1); }

// Import the Blockbench generator core to classify borrowed textures into the same
// families the recipes use (generated textures carry their family in the recipe).
const corePath = join(config.producerRoot, 'js', 'automation', 'texture_gen.js');
if (!existsSync(corePath)) { console.error(`generator core not found at ${corePath} (check producer.root)`); process.exit(1); }
const { classify, listFamilies } = await import(pathToFileURL(corePath).href);
const FAMILY_ORDER = listFamilies();
// Core order, but push the catch-all generic families to the end so the specific,
// review-worthy families come first.
const familyRank = (f) => { const i = FAMILY_ORDER.indexOf(f); return (f.startsWith('generic') ? 900 : 0) + (i < 0 ? FAMILY_ORDER.length : i); };

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
	const name = id.slice(id.lastIndexOf('/') + 1);
	const dir = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '(root)';
	const target = `assets/minecraft/textures/${rel}`;
	const prod = producers[target];
	const origin = prod ? (prod.producer === 'texture-gen' ? 'generated' : prod.producer) : 'borrowed';
	// Family: generated textures carry it in the recipe; borrowed ones are classified.
	const recipe = prod && prod.recipe ? prod.recipe.replace(':ref-closure', '') : '';
	const family = origin === 'generated' && recipe ? recipe : classify(target);
	const data = readFileSync(abs).toString('base64');
	return { id, name, dir, origin, family, data };
});

// group by family, core order then name
const byFam = {};
for (const c of cells) (byFam[c.family] ??= []).push(c);
let families = Object.keys(byFam).sort((a, b) => familyRank(a) - familyRank(b) || a.localeCompare(b));
if (onlyFamily) families = families.filter((f) => f === onlyFamily);
const genCount = cells.filter((c) => c.origin === 'generated').length;

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const cellHtml = (c) => `<figure class="cell" data-id="${esc(c.id)}" data-origin="${esc(c.origin)}" title="${esc(c.id)}">
<img alt="${esc(c.id)}" src="data:image/png;base64,${c.data}">
<figcaption><span class="nm">${esc(c.name)}</span>${c.dir !== 'block' ? `<span class="dir">${esc(c.dir)}</span>` : ''}<span class="og og-${esc(c.origin)}">${esc(c.origin)}</span></figcaption>
</figure>`;

const famCounts = (f) => { const l = byFam[f]; const g = l.filter((c) => c.origin === 'generated').length; return { total: l.length, gen: g, bor: l.length - g }; };
const gridFor = (f) => `<div class="grid">${byFam[f].slice().sort((a, b) => a.name.localeCompare(b.name)).map(cellHtml).join('')}</div>`;

const STYLE = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.4 -apple-system, system-ui, sans-serif; }
header { position: sticky; top: 0; background: Canvas; border-bottom: 1px solid #8888; padding: 10px 16px; z-index: 2; }
header h1 { font-size: 15px; margin: 0 0 6px; }
.summary { color: #888; font-size: 12px; margin-bottom: 6px; }
nav { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; }
nav a { text-decoration: none; color: inherit; opacity: .8; } nav a:hover { opacity: 1; }
nav b { opacity: .55; font-weight: 600; }
.filters { margin-top: 6px; font-size: 12px; }
.filters button { font: inherit; cursor: pointer; border: 1px solid #8886; background: #8881; color: inherit; border-radius: 4px; padding: 2px 8px; margin-right: 4px; }
.filters button.on { background: #1a7f37; color: #fff; border-color: #1a7f37; }
section { padding: 4px 16px 20px; }
section h2 { font-size: 14px; border-bottom: 1px solid #8884; padding-bottom: 4px; position: sticky; top: 92px; background: Canvas; }
section h2 small { color: #888; font-weight: 400; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px; }
.cell { margin: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
.cell img { width: 64px; height: 64px; object-fit: contain; image-rendering: pixelated; background:
  conic-gradient(#0000 25%, #8882 0 50%, #0000 0 75%, #8882 0) 0 0 / 12px 12px; border: 1px solid #8883; border-radius: 3px; }
figcaption { margin-top: 4px; width: 100%; }
.nm { display: block; font-family: ui-monospace, Menlo, monospace; font-size: 10px; word-break: break-all; }
.dir { display: inline-block; margin-top: 1px; font-size: 8px; color: #888; font-family: ui-monospace, Menlo, monospace; }
.og { display: inline-block; margin-top: 2px; font-size: 8px; padding: 1px 4px; border-radius: 3px; text-transform: uppercase; letter-spacing: .04em; }
.og-generated { background: #1a7f37; color: #fff; } .og-borrowed { background: #57606a; color: #fff; }
body.f-generated .cell[data-origin="borrowed"], body.f-borrowed .cell[data-origin="generated"] { display: none; }`;

const FILTER_JS = `<script>document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{document.body.className=b.dataset.f?'f-'+b.dataset.f:'';document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('on',x===b));});</script>`;
const filters = `<div class="filters">show:<button class="on" data-f="">all</button><button data-f="generated">generated only</button><button data-f="borrowed">borrowed only</button></div>`;
const page = (title, nav, sections) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>${STYLE}</style></head><body>
<header><h1>${esc(title)}</h1>
<div class="summary"><b>${cells.length}</b> textures &middot; <b>${genCount}</b> generated &middot; <b>${cells.length - genCount}</b> borrowed &middot; ${Object.keys(byFam).length} families</div>
<nav>${nav}</nav>${filters}</header>
${sections}${FILTER_JS}</body></html>`;

if (split) {
	// one file per family + an index that links to them
	const dir = dirname(outFile), stem = basename(outFile).replace(/\.html$/, '');
	const fileFor = (f) => `${stem}-${f}.html`;
	for (const f of families) {
		const { total, gen, bor } = famCounts(f);
		const nav = families.map((x) => `<a href="${esc(fileFor(x))}">${esc(x)} <b>${famCounts(x).total}</b></a>`).join('');
		const sec = `<section id="fam-${esc(f)}"><h2>${esc(f)} <small>${total} &middot; ${gen} generated &middot; ${bor} borrowed</small></h2>${gridFor(f)}</section>`;
		writeFileSync(join(dir, fileFor(f)), page(`Texture family — ${f}`, nav, sec));
	}
	const idxNav = families.map((f) => `<a href="${esc(fileFor(f))}">${esc(f)} <b>${famCounts(f).total}</b></a>`).join('');
	const idxCards = families.map((f) => { const c = famCounts(f); return `<section><h2><a href="${esc(fileFor(f))}" style="text-decoration:none;color:inherit">${esc(f)}</a> <small>${c.total} &middot; ${c.gen} generated &middot; ${c.bor} borrowed</small></h2></section>`; }).join('\n');
	writeFileSync(outFile, page('Texture families — index', idxNav, idxCards));
	console.log(`wrote ${relative(repoRoot, outFile)} + ${families.length} family sheet(s) (${cells.length} textures, ${genCount} generated)`);
	for (const f of families) console.log(`  ${f.padEnd(16)} ${String(famCounts(f).total).padStart(4)}  -> ${fileFor(f)}`);
} else {
	const nav = families.map((f) => `<a href="#fam-${esc(f)}">${esc(f)} <b>${byFam[f].length}</b></a>`).join('');
	const sections = families.map((f) => { const { total, gen, bor } = famCounts(f); return `<section id="fam-${esc(f)}"><h2>${esc(f)} <small>${total} &middot; ${gen} generated &middot; ${bor} borrowed</small></h2>${gridFor(f)}</section>`; }).join('\n');
	writeFileSync(outFile, page(onlyFamily ? `Texture family — ${onlyFamily}` : 'Texture review — by family', nav, sections));
	console.log(`wrote ${relative(repoRoot, outFile)} — ${cells.length} textures (${genCount} generated), ${families.length} families`);
	for (const f of families) console.log(`  ${f.padEnd(16)} ${String(byFam[f].length).padStart(4)}`);
}
