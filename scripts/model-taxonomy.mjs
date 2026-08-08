// model-taxonomy: bin the "custom" (unresolved) block models into shared BASE
// SHAPES, so a few reusable shapes accelerate most of the tail. Writes
// work/custom-models.csv and prints the base-type content tree.
//
//   node scripts/model-taxonomy.mjs
//
// build_strategy tiers (cheapest first):
//   builtin         no geometry (air/barrier/light) — empty/builtin model
//   entity_builtin  render is a hardcoded entity — model is a builtin/entity one-liner
//   base_shape      derive from ONE reusable parametric shape (textures/facing vary)
//   parametric      a bespoke-but-parameterized family (e.g. candle count 1..4)
//   variant_shape   one base shape + a small set of state variants (fill/damage)
//   custom          genuinely bespoke geometry — author in Blockbench
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './config.mjs';

const planPath = join(repoRoot, 'work', 'selection-plan.json');
if (!existsSync(planPath)) { console.error('work/selection-plan.json missing — run: npm run triage -- --json'); process.exit(1); }
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const custom = plan.entries.filter((e) => e.strategy === 'unresolved' && e.via === 'block_custom');

const strip = (name, suffix) => name.slice(0, -suffix.length);
const ORIENTABLE = new Set(['furnace', 'blast_furnace', 'smoker', 'dispenser', 'dropper', 'jukebox', 'loom', 'stonecutter', 'beehive', 'bee_nest', 'piston', 'sticky_piston', 'piston_head']);
const CHESTS = new Set(['chest', 'ender_chest', 'trapped_chest']);
const CROSS = new Set(['azalea', 'flowering_azalea', 'vine', 'big_dripleaf', 'small_dripleaf', 'sugar_cane', 'fern', 'sniffer_egg', 'turtle_egg', 'frogspawn']);
const BUILTIN_NONE = new Set(['air', 'barrier', 'light', 'structure_void']);

/** @returns {{shape:string, build:string, variant:string, dye:string, parent:string, note:string}} */
function bin(name) {
	const R = (shape, build, o = {}) => ({ shape, build, variant: o.variant || '', dye: o.dye || '', parent: o.parent || '', note: o.note || '' });
	if (BUILTIN_NONE.has(name)) return R('builtin_none', 'builtin', { parent: '(none)', note: 'no geometry' });

	// entity_builtin: geometry is a hardcoded entity renderer; the model is a one-liner
	if (name.endsWith('_wall_banner')) return R('entity_banner', 'entity_builtin', { variant: 'wall', dye: strip(name, '_wall_banner'), parent: 'builtin/entity' });
	if (name.endsWith('_banner')) return R('entity_banner', 'entity_builtin', { variant: 'standing', dye: strip(name, '_banner'), parent: 'builtin/entity' });
	if (name.endsWith('_wall_head') || name.endsWith('_wall_skull')) return R('entity_head', 'entity_builtin', { variant: 'wall', parent: 'builtin/entity' });
	if (name.endsWith('_head') || name.endsWith('_skull')) return R('entity_head', 'entity_builtin', { variant: 'floor', parent: 'builtin/entity' });
	if (CHESTS.has(name)) return R('entity_chest', 'entity_builtin', { parent: 'builtin/entity' });
	if (name === 'conduit' || name === 'decorated_pot') return R('entity_misc', 'entity_builtin', { parent: 'builtin/entity' });

	// parametric families (one templated shape, a dye + a small param)
	if (name.endsWith('_candle_cake') || name === 'candle_cake') return R('candle_cake', 'parametric', { dye: name === 'candle_cake' ? 'plain' : strip(name, '_candle_cake'), note: 'cake + 1 candle' });
	if (name.endsWith('_candle') || name === 'candle') return R('candle', 'parametric', { dye: name === 'candle' ? 'plain' : strip(name, '_candle'), note: '1..4 candles' });

	// base_shape: ONE reusable parametric shape covers many (textures/facing vary)
	if (name.endsWith('_glazed_terracotta')) return R('cube_orientable', 'base_shape', { dye: strip(name, '_glazed_terracotta'), parent: 'block/cube (facing)', note: 'glazed pattern' });
	if (ORIENTABLE.has(name)) return R('cube_orientable', 'base_shape', { parent: 'block/orientable', note: 'front-facing' });
	if (CROSS.has(name)) return R('cross_plant', 'base_shape', { parent: 'block/cross', note: 'planar' });
	if (name === 'cactus') return R('cube_inset', 'base_shape', { parent: 'block/cactus' });

	// variant_shape: one base + a few state variants
	if (name.endsWith('cauldron')) return R('cauldron', 'variant_shape', { variant: name === 'cauldron' ? 'empty' : strip(name, '_cauldron'), note: 'fill level' });
	if (name.endsWith('anvil')) return R('anvil', 'variant_shape', { variant: name === 'anvil' ? 'intact' : strip(name, '_anvil'), note: 'damage' });
	if (name.endsWith('campfire')) return R('campfire', 'variant_shape', { variant: name === 'campfire' ? 'normal' : strip(name, '_campfire') });
	if (name === 'pointed_dripstone') return R('dripstone', 'variant_shape', { note: 'thickness × direction' });

	// custom: genuinely bespoke geometry -> Blockbench
	return R('bespoke', 'custom', { note: 'unique geometry' });
}

const rows = custom.map((e) => {
	const name = (e.target.split('/').pop() || '').replace('.json', '');
	const b = bin(name);
	return { name, target: e.target, ...b };
});

// ---- CSV ----
const cols = ['name', 'target', 'shape', 'build', 'variant', 'dye', 'parent', 'note'];
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
mkdirSync(join(repoRoot, 'work'), { recursive: true });
writeFileSync(join(repoRoot, 'work', 'custom-models.csv'), csv);

// ---- content tree ----
const byBuild = {};
const byShape = {};
for (const r of rows) {
	(byBuild[r.build] ??= []).push(r);
	(byShape[r.shape] ??= { build: r.build, items: [] }).items.push(r.name);
}
const BUILD_ORDER = ['builtin', 'entity_builtin', 'base_shape', 'parametric', 'variant_shape', 'custom'];
const acceleratedBuilds = new Set(['builtin', 'entity_builtin', 'base_shape', 'parametric', 'variant_shape']);

console.log(`Custom model taxonomy — ${rows.length} models\n`);
console.log('build strategy   shape             models  example');
console.log('─'.repeat(64));
for (const build of BUILD_ORDER) {
	const shapes = Object.entries(byShape).filter(([, v]) => v.build === build).sort((a, b) => b[1].items.length - a[1].items.length);
	for (const [shape, v] of shapes) {
		console.log(`${build.padEnd(16)} ${shape.padEnd(17)} ${String(v.items.length).padStart(4)}   ${v.items[0]}`);
	}
}
const accelerated = rows.filter((r) => acceleratedBuilds.has(r.build)).length;
const baseShapeUnits = Object.entries(byShape).filter(([, v]) => acceleratedBuilds.has(v.build)).length;
const bespoke = rows.length - accelerated;
console.log('─'.repeat(64));
console.log(`\nAcceleration: build ~${baseShapeUnits} base/parametric shapes  ->  covers ${accelerated}/${rows.length} models`);
console.log(`Truly bespoke (Blockbench-authored): ${bespoke}`);
console.log('\nwrote work/custom-models.csv');
