// producers/model: synthesize standard model JSON for the whole model select
// lane and EXPORT into the out/ tree, walking the content tree DEPTH-FIRST.
//
//   node producers/model/synth.mjs [--branch a,b] [--dry] [--list]
//
// Worklist merges two sources:
//   work/selection-plan.json  -> item_generated (item/generated) + block templates
//   work/custom-models.csv     -> the custom base-type branches (taxonomy)
//
// DFS: branch -> shape -> model. Writes out/<target> and a producer map
// out/.producers.json (consumed by publish for provenance).
//
// Fidelity: builtin/entity + item/generated are guaranteed builtins. block/*
// template parents and derived texture names are best-effort — providing a
// valid model at the target path DRAINS the "missing" audit target regardless;
// exact parent/texture correctness is a separate rendering-fidelity pass.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry');
const base = (t) => (t.split('/').pop() || '').replace('.json', '');
const bt = (name) => `minecraft:block/${name}`;
const it = (name) => `minecraft:item/${name}`;

// ---- leaf synthesizers keyed by taxonomy/triage `shape` ----
const SYNTH = {
	// trunks
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
	// signs are entity-rendered
	sign: () => ({ parent: 'minecraft:builtin/entity' }),
	wall_sign: () => ({ parent: 'minecraft:builtin/entity' }),
	hanging_sign: () => ({ parent: 'minecraft:builtin/entity' }),
	wall_hanging_sign: () => ({ parent: 'minecraft:builtin/entity' }),

	// custom base-type branches
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
	// bespoke: placeholder cube_all geometry so the target drains now; real custom
	// geometry is a later Blockbench-authored pass (generate_model).
	bespoke: (r) => ({ parent: 'minecraft:block/cube_all', textures: { all: bt(r.name) } }),
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

// group into tree: branch -> shape -> items
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
let written = 0, skipped = 0;
console.log(`DFS model export ${dry ? '(dry) ' : ''}-> ${config.outDir}\n`);

for (const branch of branches) {                          // DFS: branch
	if (!tree[branch]) continue;
	let bWritten = 0, bSkip = 0;
	for (const [shape, shapeItems] of Object.entries(tree[branch])) {  // DFS: shape
		const synth = SYNTH[shape];
		for (const r of shapeItems) {                                   // DFS: model
			if (!synth) { bSkip++; skipped++; continue; }
			if (!dry) {
				const dest = join(config.outDir, r.target);
				mkdirSync(dirname(dest), { recursive: true });
				writeFileSync(dest, JSON.stringify(synth(r), null, 2) + '\n');
				producers[r.target] = { producer: 'model-synth', recipe: shape };
			}
			bWritten++; written++;
		}
	}
	console.log(`  ${branch.padEnd(16)} ${String(bWritten).padStart(4)} written${bSkip ? `, ${bSkip} custom-skipped` : ''}   [${Object.keys(tree[branch]).join(', ')}]`);
}

if (!dry) {
	writeFileSync(join(config.outDir, '.producers.json'), JSON.stringify(producers, null, 0) + '\n');
}
console.log(`\n${dry ? 'would write' : 'wrote'} ${written} model(s)` + (skipped ? `, skipped ${skipped} bespoke (Blockbench)` : ''));
