// producers/model: synthesize standard model JSON for the selection tail and
// EXPORT it into the out/ tree, walking the base-type content tree DEPTH-FIRST.
//
//   node producers/model/synth.mjs --branch entity_builtin,base_shape [--dry]
//   node producers/model/synth.mjs --list
//
// Worklist = work/custom-models.csv (npm run taxonomy). Each row's `build`
// column is a tree branch and `shape` is the leaf synthesizer. A DFS descends
// branch -> shape -> model and writes out/assets/minecraft/models/block/<name>.json.
//
// Fidelity note: standard models reference vanilla parents (builtin/entity is a
// guaranteed builtin; block/* template parents must exist in the composed pack).
// This is the deterministic-JSON producer; the bespoke tail is Blockbench's.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry');

// ---- leaf synthesizers, keyed by taxonomy `shape` ----
const tex = (name) => `minecraft:block/${name}`;
const SYNTH = {
	// entity_builtin: geometry is a hardcoded entity renderer -> builtin/entity one-liner
	entity_banner: (r) => ({ parent: 'minecraft:builtin/entity', textures: { particle: tex(r.dye ? r.dye + '_wool' : 'white_wool') } }),
	entity_head: () => ({ parent: 'minecraft:builtin/entity' }),
	entity_chest: () => ({ parent: 'minecraft:builtin/entity' }),
	entity_misc: () => ({ parent: 'minecraft:builtin/entity' }),
	// base_shape: parent-referencing standard shapes
	cube_orientable: (r) => r.name.endsWith('_glazed_terracotta')
		? { parent: 'minecraft:block/template_glazed_terracotta', textures: { pattern: tex(r.name) } }
		: { parent: 'minecraft:block/orientable', textures: { top: tex(r.name + '_top'), front: tex(r.name + '_front'), side: tex(r.name + '_side') } },
	cross_plant: (r) => ({ parent: 'minecraft:block/cross', textures: { cross: tex(r.name) } }),
	cube_inset: (r) => ({ parent: 'minecraft:block/cube_column', textures: { end: tex(r.name + '_top'), side: tex(r.name + '_side') } }),
	// parametric
	candle: (r) => ({ parent: 'minecraft:block/template_candle', textures: { all: tex(r.name), particle: tex(r.name) } }),
	candle_cake: (r) => ({ parent: 'minecraft:block/template_cake_with_candle', textures: { candle: tex(r.name.replace('_cake', '')), bottom: tex('cake_bottom'), side: tex('cake_side'), top: tex('cake_top') } }),
	// variant_shape (best-effort parents)
	cauldron: (r) => ({ parent: 'minecraft:block/cauldron' }),
	anvil: (r) => ({ parent: 'minecraft:block/anvil', textures: { top: tex(r.name + '_top') } }),
	campfire: (r) => ({ parent: 'minecraft:block/template_campfire', textures: { fire: tex(r.name + '_fire'), lit_log: tex('campfire_log_lit') } }),
	dripstone: () => ({ parent: 'minecraft:block/pointed_dripstone' }),
	// builtin / bespoke
	builtin_none: () => ({}),
	bespoke: null, // custom -> Blockbench; skipped by the JSON producer
};

// ---- read worklist + group into the tree: build -> shape -> rows ----
const csvPath = join(repoRoot, 'work', 'custom-models.csv');
if (!existsSync(csvPath)) { console.error('work/custom-models.csv missing — run: npm run taxonomy'); process.exit(1); }
const [header, ...lines] = readFileSync(csvPath, 'utf8').trim().split('\n');
const cols = header.split(',');
const rows = lines.map((line) => { const f = line.split(','); const o = {}; cols.forEach((c, i) => (o[c] = f[i] ?? '')); return o; });

const tree = {};
for (const r of rows) ((tree[r.build] ??= {})[r.shape] ??= []).push(r);

if (args.includes('--list')) {
	console.log('branches (build) -> shapes:');
	for (const [branch, shapes] of Object.entries(tree)) console.log(`  ${branch}: ${Object.entries(shapes).map(([s, rs]) => `${s}(${rs.length})`).join(', ')}`);
	process.exit(0);
}

const branches = String(opt('--branch', 'entity_builtin')).split(',').map((s) => s.trim()).filter(Boolean);
let written = 0, skipped = 0;
console.log(`DFS export ${dry ? '(dry) ' : ''}into ${config.outDir}\n`);

for (const branch of branches) {                    // DFS: branch
	if (!tree[branch]) { console.log(`  ${branch}: (no rows)`); continue; }
	console.log(branch);
	for (const [shape, shapeRows] of Object.entries(tree[branch])) {   // DFS: shape
		const synth = SYNTH[shape];
		console.log(`  ${shape} [${shapeRows.length}]${synth ? '' : '  (custom — skipped)'}`);
		for (const r of shapeRows) {                                    // DFS: model leaf
			if (!synth) { skipped++; continue; }
			const model = synth(r);
			const dest = join(config.outDir, r.target);
			if (!dry) { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, JSON.stringify(model, null, 2) + '\n'); }
			written++;
			if (shapeRows.indexOf(r) < 2) console.log(`    ${r.name}.json  ${JSON.stringify(model).slice(0, 72)}`);
		}
		if (shapeRows.length > 2 && synth) console.log(`    … +${shapeRows.length - 2} more`);
	}
}
console.log(`\n${dry ? 'would write' : 'wrote'} ${written} model(s)` + (skipped ? `, skipped ${skipped} custom` : ''));
