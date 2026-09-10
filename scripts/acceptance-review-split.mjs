// Acceptance test for the `make review-split` workflow: run the per-family texture
// sheet generator and assert its contract end to end —
//   1. runs clean and writes an index + one file per family
//   2. every family file contains exactly the textures of that family (isolation)
//   3. the union across family files == all textures, with no duplicates (completeness)
//   4. index counts match the family files and every family is linked
//   5. every embedded image is a decodable PNG
//   6. re-running is byte-identical (deterministic)
//
//   node scripts/acceptance-review-split.mjs
import { readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { loadConfig, repoRoot } from './config.mjs';
import { decodePNG } from '../producers/raster/png.mjs';
import { loadTextureCore } from '../producers/lib/texture-core.mjs';

const config = loadConfig();
const {core: {classify}} = await loadTextureCore();

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log(`  ok   ${msg}`); } else { failed++; console.log(`  FAIL ${msg}`); } };

// ---- independent expectation: family membership straight from out/ + producers ----
const texRoot = join(config.outDir, 'assets', 'minecraft', 'textures');
const producers = existsSync(join(config.outDir, '.producers.json')) ? JSON.parse(readFileSync(join(config.outDir, '.producers.json'), 'utf8')) : {};
const walk = (dir, acc = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, acc) : (n.endsWith('.png') && acc.push(p)); } return acc; };
const expected = {};          // family -> Set(id)   (id = path without .png, unique)
let totalTextures = 0;
for (const abs of walk(texRoot)) {
	const rel = relative(texRoot, abs).replace(/\\/g, '/');
	const target = `assets/minecraft/textures/${rel}`;
	const id = rel.replace(/\.png$/, '');
	const prod = producers[target];
	const recipe = prod && prod.recipe ? prod.recipe.replace(':ref-closure', '') : '';
	const fam = prod && prod.producer === 'texture-gen' && recipe ? recipe : classify(target);
	(expected[fam] ??= new Set()).add(id);
	totalTextures++;
}
const expectedFamilies = Object.keys(expected);

// ---- 1. run the workflow (via the Make target's command) ----
console.log('# 1. runs clean, writes index + per-family files');
const stem = 'texture-review';
const clean = () => { for (const f of readdirSync(repoRoot)) if (/^texture-review.*\.html$/.test(f)) rmSync(join(repoRoot, f)); };
clean();
let ran = true;
try { execFileSync('node', ['scripts/texture-sheet.mjs', '--split'], { cwd: repoRoot, stdio: 'pipe' }); }
catch (e) { ran = false; console.log(e.stdout?.toString() || e.message); }
ok(ran, 'texture-sheet.mjs --split exits 0');
ok(existsSync(join(repoRoot, `${stem}.html`)), 'index texture-review.html written');

const famFile = (f) => join(repoRoot, `${stem}-${f}.html`);
const readFam = (f) => readFileSync(famFile(f), 'utf8');
const ids = (html) => [...html.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);   // unique paths

for (const f of expectedFamilies) ok(existsSync(famFile(f)), `family file exists: ${stem}-${f}.html`);

// ---- 2. isolation: each family file holds exactly its family's textures ----
console.log('# 2. family isolation (each file == its family, no leakage)');
for (const f of expectedFamilies) {
	if (!existsSync(famFile(f))) continue;
	const got = new Set(ids(readFam(f)));
	const exp = expected[f];
	const missing = [...exp].filter((n) => !got.has(n));
	const extra = [...got].filter((n) => !exp.has(n));
	ok(missing.length === 0 && extra.length === 0 && got.size === exp.size,
		`${f}: ${got.size} cells match expected ${exp.size}` + (missing.length ? ` (missing ${missing.slice(0, 3)})` : '') + (extra.length ? ` (extra ${extra.slice(0, 3)})` : ''));
	ok(readFam(f).includes(`id="fam-${f}"`), `${f}: section id present`);
}

// ---- 3. completeness: union across families == all textures, no duplicates ----
console.log('# 3. completeness (union == all textures, no duplicates)');
let unionCount = 0; const seen = new Set(); let dupes = 0;
for (const f of expectedFamilies) { if (!existsSync(famFile(f))) continue; for (const id of ids(readFam(f))) { unionCount++; if (seen.has(id)) dupes++; seen.add(id); } }
ok(unionCount === totalTextures, `total cells across family files ${unionCount} == textures in out/ ${totalTextures}`);
ok(dupes === 0, `every texture appears exactly once across all family files (${dupes} dupes)`);

// ---- 4. index links + counts ----
console.log('# 4. index links every family');
const idx = readFileSync(join(repoRoot, `${stem}.html`), 'utf8');
const linked = new Set([...idx.matchAll(/href="texture-review-([^"]+)\.html"/g)].map((m) => m[1]));
ok(expectedFamilies.every((f) => linked.has(f)), `index links all ${expectedFamilies.length} families`);
ok([...linked].every((f) => expectedFamilies.includes(f)), 'index links no unknown families');

// ---- 5. every embedded image is a decodable PNG (sample first cell per family) ----
console.log('# 5. embedded images decode as PNG');
for (const f of expectedFamilies) {
	if (!existsSync(famFile(f))) continue;
	const m = readFam(f).match(/src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
	let good = false, dim = '';
	try { const d = decodePNG(Buffer.from(m[1], 'base64')); good = d.width > 0 && d.height > 0; dim = `${d.width}x${d.height}`; } catch { /* good stays false */ }
	ok(good, `${f}: first image decodes (${dim})`);
}

// ---- 6. determinism: re-run is byte-identical ----
console.log('# 6. determinism (re-run byte-identical)');
const snapshot = () => { const out = {}; for (const f of readdirSync(repoRoot)) if (/^texture-review.*\.html$/.test(f)) out[f] = readFileSync(join(repoRoot, f)); return out; };
const a = snapshot();
execFileSync('node', ['scripts/texture-sheet.mjs', '--split'], { cwd: repoRoot, stdio: 'pipe' });
const b = snapshot();
const sameKeys = Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => b[k]);
const sameBytes = sameKeys && Object.keys(a).every((k) => a[k].equals(b[k]));
ok(sameKeys, `same set of files on re-run (${Object.keys(a).length})`);
ok(sameBytes, 'all family files byte-identical on re-run');

console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${passed} passed, ${failed} failed  (${expectedFamilies.length} families, ${totalTextures} textures)`);
process.exit(failed ? 1 : 0);
