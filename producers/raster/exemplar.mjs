// exemplar: the authored-exemplar / regression-baseline loop for the texture core.
//
//   node producers/raster/exemplar.mjs capture            # write golden tiles
//   node producers/raster/exemplar.mjs check [--threshold N]
//
// One canonical tile per family is generated from the Blockbench texture core and
// stored as a committed golden under producers/raster/exemplars/<family>.png. It
// serves two loops at once:
//
//   Regression baseline (Phase 4) — `check` regenerates each tile and scores it
//     against the committed golden; any drift above --threshold (default 0.5, i.e.
//     effectively byte-identical) fails. Guards recipe edits from silent changes.
//
//   Authored-exemplar tuning (Phase 2) — replace a golden with an AUTHORED tile
//     (Blockbench `export_texture`) or a real reference-pack texture of that family,
//     raise --threshold, and `check` reports the mean per-channel delta so the recipe
//     can be tuned to close the gap to authored quality. Any 8-bit PNG decodes
//     (png.mjs handles RGBA/RGB/gray + all filters), so goldens can come from anywhere.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';
import { encodePNG, decodePNG } from './png.mjs';

const config = loadConfig();
const corePath = join(config.producerRoot, 'js', 'automation', 'texture_gen.js');
if (!existsSync(corePath)) { console.error(`Blockbench generator core not found at ${corePath} (check producer.root in forge.config.json)`); process.exit(1); }
const { generateTexture, classify } = await import(pathToFileURL(corePath).href);

// One representative block/item per family — chosen to exercise the recipe's palette
// lookup and structure. `check` and `capture` both drive off this table.
const SAMPLES = [
	['generic_block', 'block/andesite'],
	['generic_item', 'item/apple'],
	['wood', 'block/oak_log'],
	['planks', 'block/spruce_planks'],
	['planks', 'block/dark_oak_stairs'], // wood-material routing + dark_oak > oak longest-match
	['leaves', 'block/birch_leaves'],
	['ore', 'block/diamond_ore'],
	['bricks', 'block/bricks'],
	['bricks', 'block/deepslate_bricks'], // stone-family brick tone
	['stone', 'block/stone'],
	['stone', 'block/granite'],
	['stone', 'block/polished_andesite'], // polished style + variant-tone longest-match
	['stone', 'block/cobblestone'],       // cobble style
	['stone', 'block/deepslate'],
	['stone', 'block/blackstone'],
	['stone', 'block/calcite'],
	['stone', 'block/red_sandstone'],
	['glass', 'block/lime_stained_glass'],
	['glass_pane', 'block/glass_pane'],
	['banner', 'block/red_banner'],
	['spawn_egg', 'item/pig_spawn_egg'],
	['log_top', 'block/oak_log_top'],
	['grass', 'block/grass_block_top'],
	['dirt', 'block/dirt'],
	['dirt', 'block/grass_block_side'], // topped-soil fringe
	['dirt', 'block/sand'],
	['coral', 'block/tube_coral_block'],
	['coral', 'block/fire_coral_fan'],     // transparent branches
	['crop', 'block/wheat'],
	['mushroom', 'block/red_mushroom_block'],
	['plant', 'block/dandelion'],          // flower bloom
	['plant', 'block/fern'],               // green blades
];

const exemplarDir = join(repoRoot, 'producers', 'raster', 'exemplars');
// Goldens are keyed by block name (not family), so a family can have several samples.
const goldenPath = (path) => join(exemplarDir, `${seedOf(path)}.png`);
const targetOf = (path) => `assets/minecraft/textures/${path}.png`;
const seedOf = (path) => (path.split('/').pop() || '');

// Generate a family's canonical tile as an RGBA buffer via the core.
function render(family, path) {
	const target = targetOf(path);
	const resolved = family || classify(target);
	return generateTexture({ family: resolved, target, seed: seedOf(path), size: 16 });
}

// Mean absolute per-channel error between two RGBA buffers (0 = identical, 255 = max).
function score(a, b) {
	if (a.width !== b.width || a.height !== b.height) return { mae: 255, size: `${a.width}x${a.height} vs ${b.width}x${b.height}` };
	let sum = 0;
	for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
	return { mae: sum / a.data.length };
}

const mode = process.argv[2];
const args = process.argv.slice(3);
const threshold = Number((args[args.indexOf('--threshold') + 1]) || 0) || 0.5;

if (mode === 'capture') {
	mkdirSync(exemplarDir, { recursive: true });
	let wrote = 0;
	for (const [family, path] of SAMPLES) {
		const buf = render(family, path);
		writeFileSync(goldenPath(path), encodePNG(buf.width, buf.height, buf.data));
		wrote++;
	}
	console.log(`captured ${wrote} exemplar tile(s) -> ${exemplarDir}`);
	process.exit(0);
}

if (mode === 'check') {
	let worst = 0, missing = 0, failed = 0;
	console.log(`family           sample                          MAE   status`);
	for (const [family, path] of SAMPLES) {
		const gp = goldenPath(path);
		if (!existsSync(gp)) { console.log(`${family.padEnd(16)} ${path.padEnd(30)}     -   NO GOLDEN (run: exemplar capture)`); missing++; continue; }
		const got = render(family, path);
		const golden = decodePNG(readFileSync(gp));
		const { mae, size } = score(golden, got);
		const ok = mae <= threshold && !size;
		if (mae > worst) worst = mae;
		if (!ok) failed++;
		console.log(`${family.padEnd(16)} ${path.padEnd(30)} ${mae.toFixed(2).padStart(6)}   ${size ? 'SIZE ' + size : ok ? 'ok' : 'DRIFT'}`);
	}
	console.log(`\nworst MAE ${worst.toFixed(2)} (threshold ${threshold})  ${missing ? missing + ' missing  ' : ''}${failed ? failed + ' over threshold' : 'all within threshold'}`);
	process.exit(failed || missing ? 1 : 0);
}

console.error('usage: exemplar.mjs capture | check [--threshold N]');
process.exit(2);
