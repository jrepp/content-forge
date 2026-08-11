// producers/raster: generate PNG textures for the select-lane textures using the
// Blockbench generator CORE (js/automation/texture_gen.js), encode with the local
// dependency-free PNG writer, and export into the out/ tree.
//
//   node producers/raster/synth-textures.mjs [--limit N]
//   node producers/raster/synth-textures.mjs --all [--limit N]
//
// This literally makes Blockbench's generator the texture producer: the portable
// core is imported from the configured producer checkout, run in Node, and its
// RGBA buffers are written as PNGs. Placeholders are deterministic (seeded by the
// texture name) and marked in provenance so a real asset can replace them later.
//
// --all reads work/queue.json instead of work/selection-plan.json and writes a
// placeholder PNG for EVERY queued texture target (including resolved ones, which
// stay beneath higher-priority authored packs in the composed stack). The family
// is taken from the entry detail when it is already a generic family, otherwise
// generic_item for /item/ targets and generic_block otherwise.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';
import { encodePNG } from './png.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const limit = Number((args[args.indexOf('--limit') + 1]) || 0) || Infinity;
const all = args.includes('--all');

// Import the Blockbench generator core from the configured producer checkout.
const corePath = join(config.producerRoot, 'js', 'automation', 'texture_gen.js');
if (!existsSync(corePath)) { console.error(`Blockbench generator core not found at ${corePath} (check producer.root in forge.config.json)`); process.exit(1); }
const { generateTexture, classify, listFamilies } = await import(pathToFileURL(corePath).href);
const KNOWN_FAMILIES = new Set(listFamilies());

const sourcePath = all ? join(repoRoot, 'work', 'queue.json') : join(repoRoot, 'work', 'selection-plan.json');
if (!existsSync(sourcePath)) { console.error(`${sourcePath} missing — run: ${all ? 'npm run pull-queue && npm run triage -- --json' : 'npm run triage -- --json'}`); process.exit(1); }
const plan = JSON.parse(readFileSync(sourcePath, 'utf8'));

const base = (t) => (t.split('/').pop() || '').replace('.png', '');
// Route each target through the core's classify() so wood/planks/leaves/ore/bricks/
// glass/banner/spawn_egg render with real structure instead of a flat swatch. Honor a
// specific (non-generic) family from triage detail when it names a real recipe.
const familyFor = (e) => (e.detail && e.detail !== 'generic_block' && e.detail !== 'generic_item' && KNOWN_FAMILIES.has(e.detail)) ? e.detail : classify(e.target);
const textures = plan.entries
	.filter((e) => e.kind === 'textures' && (all || e.detail === 'generic_block' || e.detail === 'generic_item'))
	.slice(0, limit);

// Merge into the existing producer map (models may have written it already).
const producersPath = join(config.outDir, '.producers.json');
let producers = {};
if (existsSync(producersPath)) { try { producers = JSON.parse(readFileSync(producersPath, 'utf8')); } catch { /* ignore */ } }

let written = 0;
for (const e of textures) {
	const family = familyFor(e);
	// Pass target so the recipe resolves the real block name (oak_planks, not "planks").
	const buffer = generateTexture({ family, target: e.target, seed: base(e.target), size: 16 });
	const png = encodePNG(buffer.width, buffer.height, buffer.data);
	const dest = join(config.outDir, e.target);
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, png);
	producers[e.target] = { producer: 'texture-gen', recipe: family };
	written++;
}

mkdirSync(config.outDir, { recursive: true });
writeFileSync(producersPath, JSON.stringify(producers, null, 0) + '\n');
console.log(`generated ${written} texture(s)${all ? ' (--all)' : ''} -> ${config.outDir}`);
