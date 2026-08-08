// producers/model: synthesize standard model JSON for the whole model select
// lane and EXPORT into the out/ tree, walking the content tree DEPTH-FIRST.
//
//   node producers/model/synth.mjs [--branch a,b] [--no-flatten] [--dry] [--list]
//
// Worklist merges two sources:
//   work/selection-plan.json  -> item_generated (item/generated) + block templates
//   work/custom-models.csv     -> the custom base-type branches (taxonomy)
//
// FLATTEN (default): block models are emitted SELF-CONTAINED — inlined `elements`
// + `display`, no dependency on a vanilla parent model file that may be missing
// from the pack. Builtins (item/generated, builtin/entity) stay as parent refs
// because their geometry is engine-hardcoded (and always resolves); item/generated
// is also emitted once so the item parent resolves inside the pack. --no-flatten
// falls back to thin `{parent, textures}` models.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry');
const flatten = !args.includes('--no-flatten');
const base = (t) => (t.split('/').pop() || '').replace('.json', '');
const bt = (name) => `minecraft:block/${name}`;
const it = (name) => `minecraft:item/${name}`;

// ---- thin (parent-referencing) synthesizers, keyed by `shape` ----
const SYNTH = {
	item_generated: (r) => ({ parent: 'minecraft:item/generated', textures: { layer0: it(r.name) } }),
	cube_all: (r) => ({ parent: 'minecraft:block/cube_all', textures: { all: bt(r.name) } }),
	planks: (r) => ({ parent: 'minecraft:block/cube_all', textures: { all: bt(r.name) } }),
	log: (r) => ({ parent: 'minecraft:block/cube_column', textures: { end: bt(r.name.replace(/_log.*$/, '_log_top')), side: bt(r.name) } }),
	wood: (r) => ({ parent: 'minecraft:block/cube_column', textures: { end: bt(r.name), side: bt(r.name) } }),
	hyphae: (r) => ({ parent: 'minecraft:block/cube_column', textures: { end: bt(r.name), side: bt(r.name) } }),
	stem: (r) => ({ parent: 'minecraft:block/cross', textures: { cross: bt(r.name) } }),
	leaves: (r) => ({ parent: 'minecraft:block/cube_all', textures: { all: bt(r.name) } }),
	sapling: (r) => ({ parent: 'minecraft:block/cross', textures: { cross: bt(r.name) } }),
	button: (r) => ({ parent: 'minecraft:block/button', textures: { texture: bt(r.name.replace(/_button.*$/, '') + '_planks') } }),
	pressure_plate: (r) => ({ parent: 'minecraft:block/pressure_plate_up', textures: { texture: bt(r.name.replace(/_pressure_plate.*$/, '') + '_planks') } }),
	fence: (r) => ({ parent: 'minecraft:block/fence_post', textures: { texture: bt(r.name.replace(/_fence.*$/, '') + '_planks') } }),
	fence_gate: (r) => ({ parent: 'minecraft:block/template_fence_gate', textures: { texture: bt(r.name.replace(/_fence_gate.*$/, '') + '_planks') } }),
	wall: (r) => ({ parent: 'minecraft:block/template_wall_post', textures: { wall: bt(r.name.replace(/_wall.*$/, '')) } }),
	sign: () => ({ parent: 'minecraft:builtin/entity' }),
	wall_sign: () => ({ parent: 'minecraft:builtin/entity' }),
	hanging_sign: () => ({ parent: 'minecraft:builtin/entity' }),
	wall_hanging_sign: () => ({ parent: 'minecraft:builtin/entity' }),
	entity_banner: (r) => ({ parent: 'minecraft:builtin/entity', textures: { particle: bt((r.dye || 'white') + '_wool') } }),
	entity_head: () => ({ parent: 'minecraft:builtin/entity' }),
	entity_chest: () => ({ parent: 'minecraft:builtin/entity' }),
	entity_misc: () => ({ parent: 'minecraft:builtin/entity' }),
	cube_orientable: (r) => r.name.endsWith('_glazed_terracotta')
		? { parent: 'minecraft:block/template_glazed_terracotta', textures: { pattern: bt(r.name) } }
		: { parent: 'minecraft:block/orientable', textures: { top: bt(r.name + '_top'), front: bt(r.name + '_front'), side: bt(r.name + '_side') } },
	cross_plant: (r) => ({ parent: 'minecraft:block/cross', textures: { cross: bt(r.name) } }),
	cube_inset: (r) => ({ parent: 'minecraft:block/cube_column', textures: { end: bt(r.name + '_top'), side: bt(r.name + '_side') } }),
	candle: (r) => ({ parent: 'minecraft:block/template_candle', textures: { all: bt(r.name), particle: bt(r.name) } }),
	candle_cake: (r) => ({ parent: 'minecraft:block/template_cake_with_candle', textures: { candle: bt(r.name.replace('_cake', '')), bottom: bt('cake_bottom'), side: bt('cake_side'), top: bt('cake_top') } }),
	cauldron: () => ({ parent: 'minecraft:block/cauldron' }),
	anvil: (r) => ({ parent: 'minecraft:block/anvil', textures: { top: bt(r.name + '_top') } }),
	campfire: (r) => ({ parent: 'minecraft:block/template_campfire', textures: { fire: bt(r.name + '_fire'), lit_log: bt('campfire_log_lit') } }),
	dripstone: () => ({ parent: 'minecraft:block/pointed_dripstone' }),
	builtin_none: () => ({}),
	bespoke: (r) => ({ parent: 'minecraft:block/cube_all', textures: { all: bt(r.name) } }),
};

// ---- flatten: self-contained geometry (inlined vanilla parent expansions) ----
const BLOCK_DISPLAY = {
	gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
	ground: { rotation: [0, 0, 0], translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
	fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
	thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
	thirdperson_lefthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
	firstperson_righthand: { rotation: [0, 45, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
	firstperson_lefthand: { rotation: [0, 225, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
};
const sixFaces = (tex) => ({
	down: { texture: tex, cullface: 'down' }, up: { texture: tex, cullface: 'up' },
	north: { texture: tex, cullface: 'north' }, south: { texture: tex, cullface: 'south' },
	west: { texture: tex, cullface: 'west' }, east: { texture: tex, cullface: 'east' },
});
const flatCube = (tex) => ({ credit: 'content-forge (flattened)', textures: { particle: tex }, display: BLOCK_DISPLAY, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: sixFaces(tex) }] });
const flatColumn = (end, side) => ({ credit: 'content-forge (flattened)', textures: { particle: side }, display: BLOCK_DISPLAY, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { down: { texture: end, cullface: 'down' }, up: { texture: end, cullface: 'up' }, north: { texture: side, cullface: 'north' }, south: { texture: side, cullface: 'south' }, west: { texture: side, cullface: 'west' }, east: { texture: side, cullface: 'east' } } }] });
const flatCross = (tex) => ({ credit: 'content-forge (flattened)', ambientocclusion: false, textures: { particle: tex }, elements: [
	{ from: [0.8, 0, 8], to: [15.2, 16, 8], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true }, shade: false, faces: { north: { uv: [0, 0, 16, 16], texture: tex }, south: { uv: [0, 0, 16, 16], texture: tex } } },
	{ from: [8, 0, 0.8], to: [8, 16, 15.2], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true }, shade: false, faces: { west: { uv: [0, 0, 16, 16], texture: tex }, east: { uv: [0, 0, 16, 16], texture: tex } } },
] });

// Block-geometry shapes -> a self-contained model. Anything not listed but still a
// block flattens to a plain textured cube (renders, no parent dependency).
const FLATTEN = {
	cube_all: (r) => flatCube(bt(r.name)), planks: (r) => flatCube(bt(r.name)), leaves: (r) => flatCube(bt(r.name)), bespoke: (r) => flatCube(bt(r.name)),
	wood: (r) => flatColumn(bt(r.name), bt(r.name)), hyphae: (r) => flatColumn(bt(r.name), bt(r.name)),
	log: (r) => flatColumn(bt(r.name.replace(/_log.*$/, '_log_top')), bt(r.name)),
	cube_inset: (r) => flatColumn(bt(r.name + '_top'), bt(r.name + '_side')),
	cross_plant: (r) => flatCross(bt(r.name)), sapling: (r) => flatCross(bt(r.name)), stem: (r) => flatCross(bt(r.name)),
};
// Shapes whose geometry is engine-hardcoded builtins (never flattened).
const BUILTIN_SHAPES = new Set(['item_generated', 'entity_banner', 'entity_head', 'entity_chest', 'entity_misc', 'sign', 'wall_sign', 'hanging_sign', 'wall_hanging_sign', 'builtin_none']);

function buildModel(shape, r) {
	if (flatten && !BUILTIN_SHAPES.has(shape)) return (FLATTEN[shape] || ((row) => flatCube(bt(row.name))))(r);
	return SYNTH[shape] ? SYNTH[shape](r) : null;
}

// The one item parent (references the builtin generator + item display), emitted
// under flatten so all item/generated children resolve inside the pack.
const ITEM_GENERATED_PARENT = {
	parent: 'builtin/generated',
	display: {
		ground: { rotation: [0, 0, 0], translation: [0, 2, 0], scale: [0.5, 0.5, 0.5] },
		head: { rotation: [0, 180, 0], translation: [0, 13, 7], scale: [1, 1, 1] },
		thirdperson_righthand: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] },
		thirdperson_lefthand: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] },
		firstperson_righthand: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
		firstperson_lefthand: { rotation: [0, 90, -25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
		fixed: { rotation: [0, 180, 0], translation: [0, 0, 0], scale: [1, 1, 1] },
		gui: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] },
	},
};

// ---- worklist: merge triage plan (trunks) + taxonomy csv (custom branches) ----
function loadWorklist() {
	const items = [];
	const planPath = join(repoRoot, 'work', 'selection-plan.json');
	if (existsSync(planPath)) {
		const plan = JSON.parse(readFileSync(planPath, 'utf8'));
		for (const e of plan.entries) {
			if (e.strategy === 'item_generated') items.push({ target: e.target, name: base(e.target), branch: 'item_generated', shape: 'item_generated' });
			else if (e.strategy === 'block') items.push({ target: e.target, name: base(e.target), branch: 'block_template', shape: e.via });
		}
	}
	const csvPath = join(repoRoot, 'work', 'custom-models.csv');
	if (existsSync(csvPath)) {
		const [header, ...lines] = readFileSync(csvPath, 'utf8').trim().split('\n');
		const cols = header.split(',');
		for (const line of lines) { const f = line.split(','); const r = {}; cols.forEach((c, i) => (r[c] = f[i] ?? '')); items.push({ target: r.target, name: r.name, branch: r.build, shape: r.shape, dye: r.dye, variant: r.variant }); }
	}
	return items;
}

const items = loadWorklist();
if (!items.length) { console.error('empty worklist — run: npm run triage -- --json && npm run taxonomy'); process.exit(1); }

const tree = {};
for (const it of items) ((tree[it.branch] ??= {})[it.shape] ??= []).push(it);
const BRANCH_ORDER = ['item_generated', 'block_template', 'builtin', 'entity_builtin', 'base_shape', 'parametric', 'variant_shape', 'custom'];
const orderedBranches = [...BRANCH_ORDER.filter((b) => tree[b]), ...Object.keys(tree).filter((b) => !BRANCH_ORDER.includes(b))];

if (args.includes('--list')) {
	for (const b of orderedBranches) console.log(`${b}: ${Object.entries(tree[b]).map(([s, r]) => `${s}(${r.length})`).join(', ')}`);
	process.exit(0);
}

const only = opt('--branch', '');
const branches = only ? only.split(',').map((s) => s.trim()) : orderedBranches;
const producers = {};
let written = 0, skipped = 0, sawItems = false;
console.log(`DFS model export ${dry ? '(dry) ' : ''}${flatten ? '[flattened] ' : '[thin] '}-> ${config.outDir}\n`);

for (const branch of branches) {
	if (!tree[branch]) continue;
	let bWritten = 0, bSkip = 0;
	for (const [shape, shapeItems] of Object.entries(tree[branch])) {
		for (const r of shapeItems) {
			const model = buildModel(shape, r);
			if (!model) { bSkip++; skipped++; continue; }
			if (shape === 'item_generated') sawItems = true;
			if (!dry) {
				const dest = join(config.outDir, r.target);
				mkdirSync(dirname(dest), { recursive: true });
				writeFileSync(dest, JSON.stringify(model, null, 2) + '\n');
				producers[r.target] = { producer: 'model-synth', recipe: shape + (flatten && !BUILTIN_SHAPES.has(shape) ? '-flat' : '') };
			}
			bWritten++; written++;
		}
	}
	console.log(`  ${branch.padEnd(16)} ${String(bWritten).padStart(4)} written${bSkip ? `, ${bSkip} skipped` : ''}   [${Object.keys(tree[branch]).join(', ')}]`);
}

// Emit the item parent so flattened items resolve inside the pack.
if (!dry && flatten && sawItems) {
	const parentTarget = 'assets/minecraft/models/item/generated.json';
	const dest = join(config.outDir, parentTarget);
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, JSON.stringify(ITEM_GENERATED_PARENT, null, 2) + '\n');
	producers[parentTarget] = { producer: 'model-synth', recipe: 'item_generated_parent' };
	written++;
	console.log(`  + item/generated parent (so flattened items self-resolve)`);
}

if (!dry) writeFileSync(join(config.outDir, '.producers.json'), JSON.stringify(producers, null, 0) + '\n');
console.log(`\n${dry ? 'would write' : 'wrote'} ${written} model(s)` + (skipped ? `, skipped ${skipped}` : ''));
