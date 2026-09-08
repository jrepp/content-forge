// instantiate: upgrade the produced block models to the Blockbench-authored base
// geometry. For each block model in out/ whose name matches a base shape, replace
// the flat-cube approximation with the authored shape's elements + display, its
// texture bound to the target's own texture. Real geometry (slab, stairs, fence,
// cross, …) for the selection set, sourced from producers/blockbench/base-shapes/.
//
//   node producers/model/instantiate.mjs   (run author-tree.mjs first)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';
import { prepareModel } from './semantics.mjs';

const config = loadConfig();
const libDir = join(repoRoot, 'producers', 'blockbench', 'base-shapes');
if (!existsSync(libDir)) { console.error('base-shape library missing — run: node producers/blockbench/author-tree.mjs'); process.exit(1); }

// Longest-suffix-first shape routing. Plain (no suffix) blocks -> cube_all.
const SUFFIX_SHAPE = [
	['_slab_top', 'slab_top'], ['_slab', 'slab_bottom'],
	['_stairs_inner', 'stairs_inner'], ['_stairs_outer', 'stairs_outer'],
	['_stairs', 'stairs'],
	['_button_inventory', 'button'], ['_button', 'button'],
	['_pressure_plate', 'pressure_plate'],
	['_fence_side', 'fence_arm'], ['_wall_side', 'wall_side'],
	['_fence_gate', 'fence_post'], ['_fence', 'fence_post'],
	['_wall', 'wall_post'],
	['_carpet', 'carpet'],
	['_pane_side', 'pane_side'],
	['_stained_glass_pane', 'pane_post'], ['_glass_pane', 'pane_post'],
	['_door_bottom_left', 'door_bottom_left'], ['_door_bottom_right', 'door_bottom_right'],
	['_door_top', 'door_top'],
	['_trapdoor', 'trapdoor'], ['_door', 'door'],
	['_wall_torch', 'torch'], ['_torch', 'torch'],
	['_ladder', 'ladder'], ['_end_rod', 'end_rod'],
	['_sapling', 'cross'], ['_fern', 'cross'],
	['_log', 'cube_column'], ['_wood', 'cube_column'], ['_stem', 'cross'], ['_hyphae', 'cube_column'],
	// families with dedicated authored shapes
	['_wall_banner', 'banner'], ['_banner', 'banner'],
	['_hanging_sign', 'hanging_sign'],
	['_bed', 'bed'],
	['_wall_skull', 'head'], ['_skull', 'head'], ['_wall_head', 'head'], ['_head', 'head'],
	['_coral_wall_fan', 'coral_fan'], ['_wall_fan', 'coral_fan'], ['_coral_fan', 'coral_fan'],
	['candle_cake', 'candle_cake'],
];
// potted_* is a prefix family (potted_fern, potted_cactus, …) -> pot + plant.
const shapeFor = (name) => name.startsWith('potted_') ? 'potted_plant' : (SUFFIX_SHAPE.find(([suf]) => name.endsWith(suf)) || [null, 'cube_all'])[1];

// Derived wood blocks reuse their family's plank material instead of inventing a
// texture per geometry helper (oak_fence_side, oak_stairs_inner, ...). Longest
// family names come first so dark_oak is not mistaken for oak.
const WOOD_FAMILIES = ['dark_oak', 'acacia', 'bamboo', 'birch', 'cherry', 'crimson', 'jungle', 'mangrove', 'oak', 'spruce', 'warped'];
const WOOD_DERIVED = /^(?:fence|fence_gate|stairs|slab|door|trapdoor|button|pressure_plate|sign|wall_sign|hanging_sign)$/;
function materialFor(name) {
	const base = name.replace(/_(?:inner|outer|side|top|double)$/, '');
	if (/^bamboo_mosaic_(?:stairs|slab)$/.test(base)) return 'bamboo_mosaic';
	for (const family of WOOD_FAMILIES) {
		const prefix = `${family}_`;
		if (base.startsWith(prefix) && WOOD_DERIVED.test(base.slice(prefix.length))) return `${family}_planks`;
	}
	return base;
}

const lib = {};
for (const f of readdirSync(libDir).filter((n) => n.endsWith('.json'))) {
	lib[n0(f)] = JSON.parse(readFileSync(join(libDir, f), 'utf8'));
}
// Blockstate-only helpers are durable hand-authored JSON rather than generated
// Blockbench exports. Load them into the same routing table so explicit helper
// routes cannot silently fall back to cube_all.
const helperDir = join(repoRoot, 'producers', 'model', 'shapes');
if (existsSync(helperDir)) {
	for (const f of readdirSync(helperDir).filter((n) => n.endsWith('.json'))) {
		lib[n0(f)] = JSON.parse(readFileSync(join(helperDir, f), 'utf8'));
	}
}
function n0(f) { return f.replace('.json', ''); }

// Instantiate a base shape for `name`: bind every texture ref to the target's own
// texture, keep the authored elements + display.
function instantiate(shape, name) {
	const base = lib[shape];
	if (!base) throw new Error(`Missing routed base shape: ${shape}`);
	const tex = `minecraft:block/${materialFor(name)}`;
	// End-grain: cube_column's `end` slot (log/stem top+bottom faces) binds to the
	// block's *_log_top texture; logs get real end grain instead of bark on the top.
	// wood/hyphae (all-bark) have no _log suffix, so `end` falls back to the side tex.
	const endTex = /_log$/.test(name) ? `minecraft:block/${name.replace(/_log$/, '_log_top')}` : tex;
	const model = JSON.parse(JSON.stringify(base));
	model.credit = 'content-forge (authored base shape: ' + shape + ')';
	// Bind EVERY texture slot the authored faces reference (each base shape uses its
	// own slot number, e.g. fence_post -> #5, button -> #8), not just #0 — otherwise
	// the model ships dangling #ref faces that render as missing texture.
	const slots = new Set(['particle']);
	for (const el of model.elements || []) for (const face of Object.values(el.faces || {})) if (face && typeof face.texture === 'string' && face.texture.startsWith('#')) slots.add(face.texture.slice(1));
	model.textures = {};
	for (const s of slots) model.textures[s] = (s === 'end') ? endTex : tex;
	delete model.format_version;
	delete model.groups; // Blockbench outliner metadata; Minecraft/Minosoft ignore it
	return prepareModel(model);
}

const producersPath = join(config.outDir, '.producers.json');
let producers = existsSync(producersPath) ? JSON.parse(readFileSync(producersPath, 'utf8')) : {};
// Never overwrite an individually hand-authored bespoke model (its own conversion).
const convPath = join(repoRoot, 'db', 'conversions.json');
const bespoke = new Set((existsSync(convPath) ? JSON.parse(readFileSync(convPath, 'utf8')) : []).map((c) => c.target));

const blockDir = join(config.outDir, 'assets', 'minecraft', 'models', 'block');
if (!existsSync(blockDir)) { console.error('no block models in out/ — run the model producers first'); process.exit(1); }
let upgraded = 0, keptBespoke = 0;
const byShape = {};
for (const f of readdirSync(blockDir).filter((n) => n.endsWith('.json'))) {
	const name = n0(f);
	if (bespoke.has(`assets/minecraft/models/block/${f}`)) { keptBespoke++; continue; }
	const shape = shapeFor(name);
	const model = instantiate(shape, name);
	writeFileSync(join(blockDir, f), JSON.stringify(model, null, 2) + '\n');
	const target = `assets/minecraft/models/block/${f}`;
	producers[target] = { producer: 'blockbench', recipe: `base-shape:${shape}` };
	byShape[shape] = (byShape[shape] || 0) + 1;
	upgraded++;
}
writeFileSync(producersPath, JSON.stringify(producers, null, 0) + '\n');
console.log(`instantiated ${upgraded} block model(s) from authored base shapes (kept ${keptBespoke} hand-authored bespoke):`);
for (const [s, c] of Object.entries(byShape).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(16)} ${c}`);
