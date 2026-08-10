// producers/model: synthesize the blockstate lane. The consumer requests a
// blockstate JSON for every block it renders; this drains the whole
// `disposition == generate, kind == blockstates` slice of the queue.
//
//   node producers/model/blockstates.mjs [--dry]
//
// A blockstate maps block states -> models. We own one primary model per block
// (block/<name>, an authored base-shape approximation), so every blockstate here
// routes its states to that single model, adding orientation where a single model
// is geometrically valid (pillar axis, horizontal facing, stairs half). We emit
// MULTIPART, not `variants`: a multipart `apply` with no `when` renders in EVERY
// block state, and `when` conditions are subset-matched (AND of listed props,
// extra props ignored) — so we never have to enumerate a block's full property
// set (which lives in the consumer, not here) to stay valid.
//
// Self-completeness: a blockstate is useless if its model is missing. 668/966
// targets already have block/<name>; for the rest we instantiate the matching
// authored base shape (slab/stairs/door/…) bound to the block's own texture, so
// blockstate -> model -> texture all resolve inside out/ (reference-closure then
// closes any new texture gap). Unlike the older instantiate.mjs, we bind EVERY
// face texture slot the base shape uses (not just slot 0), so the model renders.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';

const config = loadConfig();
const dry = process.argv.slice(2).includes('--dry');
const outDir = config.outDir;

// ---- demand: the blockstate slice of the committed queue snapshot ----
const queuePath = join(repoRoot, 'work', 'queue.json');
if (!existsSync(queuePath)) { console.error('work/queue.json missing — run: node scripts/pull-queue.mjs'); process.exit(1); }
const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
const targets = queue.entries
	.filter((e) => e.disposition === 'generate' && e.kind === 'blockstates')
	.map((e) => ({ target: e.target, name: (e.target.split('/').pop() || '').replace('.json', '') }));
if (!targets.length) { console.log('blockstate lane empty — nothing to produce (queue already drained).'); process.exit(0); }

// ---- authored base-shape library (for missing primary models) ----
const libDir = join(repoRoot, 'producers', 'blockbench', 'base-shapes');
const lib = {};
if (existsSync(libDir)) for (const f of readdirSync(libDir).filter((n) => n.endsWith('.json'))) lib[f.replace('.json', '')] = JSON.parse(readFileSync(join(libDir, f), 'utf8'));

// Longest-suffix-first shape routing (mirrors producers/model/instantiate.mjs).
const SUFFIX_SHAPE = [
	['_slab', 'slab_bottom'], ['_stairs', 'stairs'],
	['_button', 'button'], ['_pressure_plate', 'pressure_plate'],
	['_fence_gate', 'fence_post'], ['_fence', 'fence_post'], ['_wall', 'wall_post'],
	['_carpet', 'carpet'], ['_stained_glass_pane', 'pane_post'], ['_glass_pane', 'pane_post'],
	['_trapdoor', 'trapdoor'], ['_door', 'door'],
	['_wall_torch', 'torch'], ['_torch', 'torch'], ['_end_rod', 'end_rod'], ['_ladder', 'ladder'],
	['_sapling', 'cross'], ['_fern', 'cross'], ['_stem', 'cross'],
	['_log', 'cube_column'], ['_wood', 'cube_column'], ['_hyphae', 'cube_column'],
];
const shapeFor = (name) => (SUFFIX_SHAPE.find(([suf]) => name.endsWith(suf)) || [null, 'cube_all'])[1];

// Instantiate a base shape for `name`, binding every face texture slot it uses
// (and particle) to the block's own texture so nothing renders as a dangling #ref.
function instantiateModel(shape, name) {
	const base = lib[shape] || lib.cube_all;
	const tex = `minecraft:block/${name}`;
	if (!base) return { credit: 'content-forge (blockstate lane: flat cube fallback)', textures: { 0: tex, particle: tex }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(['down', 'up', 'north', 'south', 'west', 'east'].map((d) => [d, { texture: '#0', cullface: d }])) }] };
	const model = JSON.parse(JSON.stringify(base));
	model.credit = `content-forge (blockstate lane: ${shape})`;
	const slots = new Set(['particle']);
	for (const el of model.elements || []) for (const face of Object.values(el.faces || {})) if (face && typeof face.texture === 'string' && face.texture.startsWith('#')) slots.add(face.texture.slice(1));
	model.textures = {};
	for (const s of slots) model.textures[s] = tex;
	delete model.format_version;
	return model;
}

// ---- blockstate shape per family ----
const FACING = [['north', 0], ['east', 90], ['south', 180], ['west', 270]];
const M = (name) => `minecraft:block/${name}`;
const singlePart = (model) => [{ apply: { model } }];
const facingParts = (model, extra = {}) => FACING.map(([f, y]) => ({ when: { facing: f }, apply: { model, ...(y ? { y } : {}), uvlock: true, ...extra } }));
const axisParts = (model) => [
	{ when: { axis: 'y' }, apply: { model } },
	{ when: { axis: 'x' }, apply: { model, x: 90, y: 90 } },
	{ when: { axis: 'z' }, apply: { model, x: 90 } },
];
const stairsParts = (model) => {
	const parts = [];
	for (const [f, y] of FACING) for (const [half, x] of [['bottom', 0], ['top', 180]]) parts.push({ when: { facing: f, half }, apply: { model, ...(x ? { x } : {}), ...(y ? { y } : {}), uvlock: true } });
	return parts;
};

// Build the multipart parts for a block, and any helper models it needs.
// Returns { parts, helpers: [{target, model}] }.
function buildBlockstate(name) {
	const model = M(name);
	if (/(?:_log|_wood|_hyphae)$/.test(name)) return { parts: axisParts(model), helpers: [] };
	if (name.endsWith('_stairs')) return { parts: stairsParts(model), helpers: [] };
	if (name.endsWith('_slab')) {
		const base = name.replace(/_slab$/, '');
		const hasFull = existsSync(join(outDir, 'assets', 'minecraft', 'models', 'block', `${base}.json`));
		const topTarget = `assets/minecraft/models/block/${name}_top.json`;
		const helpers = [{ target: topTarget, model: instantiateModel('slab_top', name) }];
		return {
			parts: [
				{ when: { type: 'bottom' }, apply: { model } },
				{ when: { type: 'top' }, apply: { model: `${model}_top` } },
				{ when: { type: 'double' }, apply: { model: hasFull ? M(base) : model } },
			],
			helpers,
		};
	}
	if (/(?:_door|_trapdoor|_fence_gate|_glazed_terracotta|_wall_torch)$/.test(name)) return { parts: facingParts(model), helpers: [] };
	// plain, planks, wool, ore, carpet, sapling, fence, wall, pane, button, torch,
	// candle, banner, coral, … — one model in every state (subset-safe).
	return { parts: singlePart(model), helpers: [] };
}

// ---- produce ----
const producersPath = join(outDir, '.producers.json');
let producers = existsSync(producersPath) ? JSON.parse(readFileSync(producersPath, 'utf8')) : {};
const write = (target, obj) => {
	if (dry) return;
	const dest = join(outDir, target);
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, JSON.stringify(obj, null, 2) + '\n');
};

let bsWritten = 0, modelsFilled = 0, helpersWritten = 0;
const byFamily = {};
const modelDir = join(outDir, 'assets', 'minecraft', 'models', 'block');
for (const { target, name } of targets) {
	// 1) ensure the primary model exists (real geometry for the whole selection set)
	const modelTarget = `assets/minecraft/models/block/${name}.json`;
	if (!existsSync(join(modelDir, `${name}.json`))) {
		const shape = shapeFor(name);
		write(modelTarget, instantiateModel(shape, name));
		producers[modelTarget] = { producer: 'blockstates', recipe: `base-shape:${shape}` };
		modelsFilled++;
	}
	// 2) build + write the blockstate (and any helper models it references)
	const { parts, helpers } = buildBlockstate(name);
	for (const h of helpers) {
		if (existsSync(join(outDir, h.target))) continue;
		write(h.target, h.model);
		producers[h.target] = { producer: 'blockstates', recipe: 'base-shape:slab_top' };
		helpersWritten++;
	}
	write(target, { multipart: parts });
	producers[target] = { producer: 'blockstates', recipe: `blockstate:${shapeFor(name)}` };
	bsWritten++;
	const fam = (SUFFIX_SHAPE.find(([suf]) => name.endsWith(suf)) || [null, 'plain'])[0]?.slice(1) || 'plain';
	byFamily[fam] = (byFamily[fam] || 0) + 1;
}
if (!dry) writeFileSync(producersPath, JSON.stringify(producers, null, 0) + '\n');

// ---- verify: every blockstate model ref resolves to a file in out/ ----
const bsDir = join(outDir, 'assets', 'minecraft', 'blockstates');
const dangling = [];
if (!dry) {
	for (const f of readdirSync(bsDir).filter((n) => n.endsWith('.json'))) {
		const doc = JSON.parse(readFileSync(join(bsDir, f), 'utf8'));
		const refs = new Set();
		const collect = (apply) => { const a = Array.isArray(apply) ? apply : [apply]; for (const x of a) if (x && x.model) refs.add(x.model); };
		for (const p of doc.multipart || []) collect(p.apply);
		for (const v of Object.values(doc.variants || {})) collect(v);
		for (const ref of refs) {
			const [ns, rest] = ref.includes(':') ? ref.split(':') : ['minecraft', ref];
			// a blockstate `apply.model` is a MODEL ref (block/x, item/x) -> under models/
			if (!existsSync(join(outDir, 'assets', ns, 'models', `${rest}.json`))) dangling.push(`${f} -> ${ref}`);
		}
	}
}

console.log(`blockstate lane ${dry ? '(dry) ' : ''}-> ${outDir}`);
console.log(`  blockstates written : ${bsWritten}`);
console.log(`  primary models filled: ${modelsFilled} (were missing; instantiated from base shapes)`);
console.log(`  slab-top helpers     : ${helpersWritten}`);
console.log('  by family:');
for (const [fam, c] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) console.log(`    ${fam.padEnd(18)} ${c}`);
if (!dry) {
	console.log(`  dangling blockstate model refs: ${dangling.length}${dangling.length ? ' -> ' + dangling.slice(0, 5).join(', ') : ' (blockstate lane self-complete)'}`);
	process.exit(dangling.length ? 1 : 0);
}
