// producers/model: synthesize the blockstate lane. The consumer requests a
// blockstate JSON for every block it renders; this drains the whole
// `disposition == generate, kind == blockstates` slice of the queue.
//
//   node producers/model/blockstates.mjs [--dry]
//
// A blockstate maps block states -> models. We own one primary model per block
// (block/<name>, an authored base-shape approximation) and route its states to that
// model plus a small library of helper models, choosing a pattern by name suffix:
//
//   pillar (axis)           _log / _wood / _hyphae
//   stairs                  facing × half × shape (straight + inner/outer corners)
//   slab                    bottom / top / double
//   connections (post+arm)  _fence, _wall, _glass_pane  (rotate a <name>_side arm)
//   door                    facing × open × hinge × half (panelled lower + cut-out upper)
//   trapdoor                closed slab (half) + open-against-wall (facing)
//   button / lever          face (floor/wall/ceiling) × facing
//   horizontal facing       _fence_gate, _glazed_terracotta, _wall_torch/_wall_sign/_wall_fan
//   single model            plain/planks/wool/ore/carpet/sapling/candle and, deliberately,
//                           standing banner/sign/head (their fine yaw is block-entity work)
//
// We emit MULTIPART, not `variants`: a multipart `apply` with no `when` renders in
// EVERY block state, and `when` conditions are subset-matched (AND of listed props,
// extra props ignored) — so we never have to enumerate a block's full property set
// (which lives in the consumer, not here) to stay valid. Where a property must be
// mutually exclusive (stairs `shape`, button `face`), EVERY part pins the full
// tuple so subset-matching never lets two parts double-draw. Helper geometry that
// isn't in the authored base-shape set lives in producers/model/shapes/.
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
// Durable blockstate-lane helper geometry (fence/wall arms, stair corners, sign,
// candle, lever). Kept OUT of base-shapes/ — that dir is regenerated from
// sources/base-shapes.bbmodel by author-tree/fold-tree and would clobber hand shapes.
const extraDir = join(repoRoot, 'producers', 'model', 'shapes');
if (existsSync(extraDir)) for (const f of readdirSync(extraDir).filter((n) => n.endsWith('.json'))) lib[f.replace('.json', '')] = JSON.parse(readFileSync(join(extraDir, f), 'utf8'));

// Longest-suffix-first shape routing (mirrors producers/model/instantiate.mjs).
const SUFFIX_SHAPE = [
	['_slab', 'slab_bottom'], ['_stairs', 'stairs'],
	['_button', 'button'], ['_lever', 'lever'], ['_pressure_plate', 'pressure_plate'],
	['_fence_gate', 'fence_post'], ['_fence', 'fence_post'], ['_wall', 'wall_post'],
	['_carpet', 'carpet'], ['_stained_glass_pane', 'pane_post'], ['_glass_pane', 'pane_post'],
	['_trapdoor', 'trapdoor'], ['_door', 'door'],
	['_wall_torch', 'torch'], ['_torch', 'torch'], ['_end_rod', 'end_rod'], ['_ladder', 'ladder'],
	['_sapling', 'cross'], ['_fern', 'cross'], ['_stem', 'cross'],
	['_log', 'cube_column'], ['_wood', 'cube_column'], ['_hyphae', 'cube_column'],
	// families with dedicated authored shapes
	['_wall_banner', 'banner'], ['_banner', 'banner'],
	['_hanging_sign', 'hanging_sign'], ['_wall_sign', 'sign'], ['_sign', 'sign'],
	['_candle', 'candle'],
	['_bed', 'bed'],
	['_wall_skull', 'head'], ['_skull', 'head'], ['_wall_head', 'head'], ['_head', 'head'],
	['_coral_wall_fan', 'coral_fan'], ['_wall_fan', 'coral_fan'], ['_coral_fan', 'coral_fan'],
	['candle_cake', 'candle_cake'],
];
// potted_* is a prefix family (potted_fern, potted_cactus, …) -> pot + plant.
const shapeFor = (name) => name.startsWith('potted_') ? 'potted_plant' : (SUFFIX_SHAPE.find(([suf]) => name.endsWith(suf)) || [null, 'cube_all'])[1];

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

// Instantiate a base shape for `name`, binding every face texture slot it uses
// (and particle) to the block's own texture so nothing renders as a dangling #ref.
function instantiateModel(shape, name) {
	const base = lib[shape] || lib.cube_all;
	const tex = `minecraft:block/${materialFor(name)}`;
	if (!base) return { credit: 'content-forge (blockstate lane: flat cube fallback)', textures: { 0: tex, particle: tex }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(['down', 'up', 'north', 'south', 'west', 'east'].map((d) => [d, { texture: '#0', cullface: d }])) }] };
	const model = JSON.parse(JSON.stringify(base));
	model.credit = `content-forge (blockstate lane: ${shape})`;
	const slots = new Set(['particle']);
	for (const el of model.elements || []) for (const face of Object.values(el.faces || {})) if (face && typeof face.texture === 'string' && face.texture.startsWith('#')) slots.add(face.texture.slice(1));
	model.textures = {};
	for (const s of slots) model.textures[s] = tex;
	delete model.format_version;
	delete model.groups; // Blockbench outliner metadata; Minecraft/Minosoft ignore it
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
const rot = (v) => (((v % 360) + 360) % 360);
// Stairs: facing × half × shape. EVERY part pins all three props so subset-matching
// stays mutually exclusive (a straight part can't also fire in an inner/outer state,
// and vice-versa) — otherwise corners would double-draw over the straight model.
// straight -> block/<name>; corners -> <name>_inner / <name>_outer helper models.
const STAIR_VARIANTS = [['straight', '', 0], ['outer_right', '_outer', 0], ['outer_left', '_outer', -90], ['inner_right', '_inner', 0], ['inner_left', '_inner', -90]];
const stairsParts = (model) => {
	const parts = [];
	for (const [f, fy] of FACING) for (const [half, x] of [['bottom', 0], ['top', 180]]) for (const [shape, suffix, dy] of STAIR_VARIANTS) {
		const y = rot(fy + dy);
		parts.push({ when: { facing: f, half, shape }, apply: { model: model + suffix, ...(x ? { x } : {}), ...(y ? { y } : {}), uvlock: true } });
	}
	return parts;
};
// Connection blocks (fence, wall): a center post that renders in every state, plus
// one <name>_side arm helper (pointing north) rotated to each connected neighbour.
// Subset-matched on the neighbour props — exactly the glass_pane pattern.
const connectionParts = (model, side) => [
	{ apply: { model } },
	{ when: { north: 'true' }, apply: { model: side } },
	{ when: { east: 'true' }, apply: { model: side, y: 90 } },
	{ when: { south: 'true' }, apply: { model: side, y: 180 } },
	{ when: { west: 'true' }, apply: { model: side, y: 270 } },
];
// Button / lever: mounted on a face (floor/wall/ceiling) and turned to a facing.
// Each part pins face+facing (both core props) so exactly one part fires per state.
const FACE_ROT = { floor: {}, ceiling: { x: 180 }, wall: { x: 90 } };
const faceParts = (model) => {
	const parts = [];
	for (const [face, base] of Object.entries(FACE_ROT)) for (const [f, y] of FACING) parts.push({ when: { face, facing: f }, apply: { model, ...base, ...(y ? { y } : {}), uvlock: true } });
	return parts;
};
// Door: pin every model-selecting property. The lower half is a recessed four-panel
// leaf with a latch opposite its hinge; the upper half is a rail-and-stile frame
// with two real openings. Open doors swing +90° from a left hinge and -90° from a
// right hinge. `powered` remains intentionally free because it only drives `open`.
const doorParts = (bottomLeft, bottomRight, top) => {
	const parts = [];
	for (const [f, y] of FACING) for (const open of ['false', 'true']) for (const hinge of ['left', 'right']) for (const half of ['lower', 'upper']) {
		const swing = open === 'true' ? (hinge === 'left' ? 90 : -90) : 0;
		const yy = rot(y + swing);
		const model = half === 'upper' ? top : (hinge === 'left' ? bottomLeft : bottomRight);
		parts.push({ when: { facing: f, open, hinge, half }, apply: { model, ...(yy ? { y: yy } : {}), uvlock: true } });
	}
	return parts;
};
// Trapdoor: a slab that lies at the bottom/top when closed and tips up against the
// facing wall when open. Pins half+open (closed) or facing+open (open) for exclusivity.
const trapdoorParts = (model) => {
	const parts = [
		{ when: { half: 'bottom', open: 'false' }, apply: { model } },
		{ when: { half: 'top', open: 'false' }, apply: { model, x: 180 } },
	];
	for (const [f, y] of FACING) parts.push({ when: { facing: f, open: 'true' }, apply: { model, x: 90, ...(y ? { y } : {}), uvlock: true } });
	return parts;
};

// Build the multipart parts for a block, and any helper models it needs.
// Returns { parts, helpers: [{target, model}] }.
function buildBlockstate(name) {
	const model = M(name);
	// Emit a helper model (<name><suffix>) from a base shape bound to this block's
	// texture, and return its ref for a part to point at.
	const helpers = [];
	const helper = (suffix, shape) => {
		helpers.push({ target: `assets/minecraft/models/block/${name}${suffix}.json`, model: instantiateModel(shape, name), recipe: `base-shape:${shape}` });
		return `${model}${suffix}`;
	};
	if (/(?:_log|_wood|_hyphae)$/.test(name)) return { parts: axisParts(model), helpers };
	if (name.endsWith('_stairs')) { helper('_inner', 'stairs_inner'); helper('_outer', 'stairs_outer'); return { parts: stairsParts(model), helpers }; }
	if (name.endsWith('_slab')) {
		// double slab = a full cube of the slab material. Emit a self-contained
		// <name>_double helper (cube_all bound to the block's texture) rather than
		// guessing the irregular vanilla full-block name (spruce_slab -> spruce_planks,
		// stone_slab -> stone, …), which the old base-name derivation got wrong.
		const top = helper('_top', 'slab_top');
		const double = helper('_double', 'cube_all');
		return {
			parts: [
				{ when: { type: 'bottom' }, apply: { model } },
				{ when: { type: 'top' }, apply: { model: top } },
				{ when: { type: 'double' }, apply: { model: double } },
			],
			helpers,
		};
	}
	// fence / wall: post + rotated side arm, subset-matched on the neighbour props.
	if (/_fence$/.test(name)) return { parts: connectionParts(model, helper('_side', 'fence_arm')), helpers };
	if (/_wall$/.test(name)) return { parts: connectionParts(model, helper('_side', 'wall_side')), helpers };
	// glass pane: identical connection pattern, its own arm shape.
	if (/_glass_pane$/.test(name)) return { parts: connectionParts(model, helper('_side', 'pane_side')), helpers };
	if (/_door$/.test(name)) {
		const bottomLeft = helper('_bottom_left', 'door_bottom_left');
		const bottomRight = helper('_bottom_right', 'door_bottom_right');
		const top = helper('_top', 'door_top');
		return { parts: doorParts(bottomLeft, bottomRight, top), helpers };
	}
	if (/_trapdoor$/.test(name)) return { parts: trapdoorParts(model), helpers };
	if (/(?:_button|_lever)$/.test(name)) return { parts: faceParts(model), helpers };
	// horizontal-facing families: fence gate, glazed terracotta, and the wall-mounted
	// variants (wall torch, wall sign, wall fan). Standing banners/signs/heads stay
	// single-part — their fine yaw is a block-entity concern, not a blockstate one.
	if (/(?:_fence_gate|_glazed_terracotta|_wall_torch|_wall_sign|_wall_fan|_coral_wall_fan)$/.test(name)) return { parts: facingParts(model), helpers };
	// plain, planks, wool, ore, carpet, sapling, pressure_plate, torch, candle, banner,
	// standing sign, head, coral, … — one model in every state (subset-safe).
	return { parts: singlePart(model), helpers };
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
		const existing = producers[h.target];
		const replaceable = !existsSync(join(outDir, h.target))
			|| existing?.producer === 'blockstates'
			|| (existing?.producer === 'blockbench' && existing?.recipe === 'base-shape:cube_all');
		if (!replaceable) continue;
		write(h.target, h.model);
		producers[h.target] = { producer: 'blockstates', recipe: h.recipe || 'base-shape:slab_top' };
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
const invalidFenceModels = [];
const invalidDoorModels = [];
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
	for (const { name } of targets.filter(({ name }) => /_fence$/.test(name))) {
		const expectedTexture = `minecraft:block/${materialFor(name)}`;
		for (const [suffix, requiredElements] of [['', ['fence_post_0']], ['_side', ['arm_top', 'arm_bottom']]]) {
			const modelName = `${name}${suffix}`;
			try {
				const model = JSON.parse(readFileSync(join(modelDir, `${modelName}.json`), 'utf8'));
				const elements = new Set((model.elements || []).map((element) => element.name));
				const textures = new Set(Object.values(model.textures || {}));
				if (!requiredElements.every((element) => elements.has(element)) || textures.size !== 1 || !textures.has(expectedTexture)) {
					invalidFenceModels.push(`${modelName} expected ${requiredElements.join('+')} on ${expectedTexture}`);
				}
			} catch (error) {
				invalidFenceModels.push(`${modelName} unreadable: ${error.message}`);
			}
		}
	}
	for (const { name } of targets.filter(({ name }) => /_door$/.test(name))) {
		const expectedTexture = `minecraft:block/${materialFor(name)}`;
		const blockstate = JSON.parse(readFileSync(join(bsDir, `${name}.json`), 'utf8'));
		const tuples = new Set((blockstate.multipart || []).map((part) => ['facing', 'open', 'hinge', 'half'].map((property) => part.when?.[property]).join('/')));
		if ((blockstate.multipart || []).length !== 32 || tuples.size !== 32) invalidDoorModels.push(`${name} expected 32 unique facing/open/hinge/half parts`);
		for (const [suffix, requiredElements] of [
			['_bottom_left', ['door_inset', 'hinge_stile', 'latch_stile', 'latch_left']],
			['_bottom_right', ['door_inset', 'hinge_stile', 'latch_stile', 'latch_right']],
			['_top', ['hinge_stile', 'latch_stile', 'top_rail', 'bottom_rail', 'window_mullion']],
		]) {
			const modelName = `${name}${suffix}`;
			try {
				const model = JSON.parse(readFileSync(join(modelDir, `${modelName}.json`), 'utf8'));
				const elements = new Set((model.elements || []).map((element) => element.name));
				const textures = new Set(Object.values(model.textures || {}));
				if (!requiredElements.every((element) => elements.has(element)) || textures.size !== 1 || !textures.has(expectedTexture)) {
					invalidDoorModels.push(`${modelName} expected ${requiredElements.join('+')} on ${expectedTexture}`);
				}
			} catch (error) {
				invalidDoorModels.push(`${modelName} unreadable: ${error.message}`);
			}
		}
	}
}

console.log(`blockstate lane ${dry ? '(dry) ' : ''}-> ${outDir}`);
console.log(`  blockstates written : ${bsWritten}`);
console.log(`  primary models filled: ${modelsFilled} (were missing; instantiated from base shapes)`);
console.log(`  helper models        : ${helpersWritten}`);
console.log('  by family:');
for (const [fam, c] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) console.log(`    ${fam.padEnd(18)} ${c}`);
if (!dry) {
	console.log(`  dangling blockstate model refs: ${dangling.length}${dangling.length ? ' -> ' + dangling.slice(0, 5).join(', ') : ' (blockstate lane self-complete)'}`);
	console.log(`  invalid fence models  : ${invalidFenceModels.length}${invalidFenceModels.length ? ' -> ' + invalidFenceModels.slice(0, 5).join(', ') : ' (posts, arms, and materials valid)'}`);
	console.log(`  invalid door models   : ${invalidDoorModels.length}${invalidDoorModels.length ? ' -> ' + invalidDoorModels.slice(0, 5).join(', ') : ' (halves, cut-outs, hinges, and materials valid)'}`);
	process.exit(dangling.length || invalidFenceModels.length || invalidDoorModels.length ? 1 : 0);
}
