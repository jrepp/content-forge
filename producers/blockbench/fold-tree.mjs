// fold-tree: merge the base-shapes tree and the bespoke .bbmodel sources into ONE
// java_block project — the core content tree in a single .bbmodel scene. Each base
// shape and each bespoke model becomes a top-level GROUP; load_project opens the
// merged tree and export_models fans it out to one model per group in a single call.
//
//   node producers/blockbench/fold-tree.mjs
//
// Requires a running BLOCKBENCH_AUTOMATION instance (producer.cdpPort). The merge
// itself is deterministic Node JSON surgery (face.texture is a global index into
// textures[]; each bespoke's indices are offset and its texture ids renumbered);
// Blockbench is only used to load the merged tree and compile the per-group models.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';
import { cdpEval } from './cdp.mjs';
import { generatePngDataUrl } from './texture-gen.mjs';

const config = loadConfig();
const now = () => new Date().toISOString();
const sha = (b) => createHash('sha256').update(b).digest('hex');

const sourcesDir = join(repoRoot, 'producers', 'blockbench', 'sources');
const baseShapesPath = join(sourcesDir, 'base-shapes.bbmodel');
if (!existsSync(baseShapesPath)) { console.error('missing base-shapes.bbmodel — run author-tree.mjs first'); process.exit(1); }

// full group record shape, matching what base-shapes.bbmodel serializes
const groupDef = (name, uuid) => ({
	name, uuid, export: true, locked: false, scope: 0, selected: false,
	_static: { properties: {}, temp_data: {} }, origin: [8, 8, 8], rotation: [0, 0, 0],
	color: 0, children: [], reset: false, shade: true, mirror_uv: false,
	visibility: true, autouv: 0, isOpen: false, primary_selected: false,
});

// ---- build the merged tree from base-shapes + every bespoke source ----
const tree = JSON.parse(readFileSync(baseShapesPath, 'utf8'));
tree.name = 'tree';
if (tree.meta) tree.meta.model_identifier = 'tree';

const baseShapeNames = new Set((tree.groups || []).map((g) => g.name));

const bespokeFiles = readdirSync(sourcesDir)
	.filter((f) => f.endsWith('.bbmodel') && f !== 'base-shapes.bbmodel' && f !== 'tree.bbmodel')
	.sort();

for (const file of bespokeFiles) {
	const name = file.replace('.bbmodel', '');
	const b = JSON.parse(readFileSync(join(sourcesDir, file), 'utf8'));
	const texOffset = tree.textures.length;

	// append this model's textures, renumbering their id to the new global index
	(b.textures || []).forEach((t, i) => { t.id = String(texOffset + i); tree.textures.push(t); });

	// append its elements, offsetting every numeric face.texture index by texOffset
	for (const el of (b.elements || [])) {
		for (const face of Object.values(el.faces || {})) {
			if (typeof face.texture === 'number') face.texture += texOffset;
		}
		tree.elements.push(el);
	}

	// wrap the model's cubes under one exportable top-level group named after it
	const uuid = randomUUID();
	tree.groups.push(groupDef(name, uuid));
	tree.outliner.push({ uuid, isOpen: false, children: (b.elements || []).map((e) => e.uuid) });
}

// ---- bake a real, procedurally-generated texture into every tree texture ----
// The sources carry only 1x1 transparent placeholders, so the merged tree renders
// invisibly. Replace each placeholder's source with a deterministic 16x16 texture from
// the producer's generate lane (seeded by the texture name), so the folded tree — and
// every model/render fanned out of it — is born textured instead of blank.
const families = {};
for (const t of tree.textures) {
	const { dataUrl, size, family } = generatePngDataUrl(t.name);
	t.source = dataUrl;
	t.width = size;
	t.height = size;
	families[family] = (families[family] || 0) + 1;
}
console.log(`textured ${tree.textures.length} textures via generate lane (${Object.entries(families).map(([f, n]) => `${f}:${n}`).join(', ')})`);

const treeRel = 'producers/blockbench/sources/tree.bbmodel';
const treeStr = JSON.stringify(tree, null, 2) + '\n';
writeFileSync(join(repoRoot, treeRel), treeStr);
const treeSha = sha(treeStr);
console.log(`merged tree: ${baseShapeNames.size} base shapes + ${bespokeFiles.length} bespoke = ${tree.groups.length} groups, ${tree.elements.length} cubes, ${tree.textures.length} textures -> ${treeRel}`);

// ---- load the merged tree in Blockbench and fan it out to one model per group ----
const expression = `(async () => {
  const rt = window.AutomationRuntime; let _id = 0;
  const send = (m, p) => rt.send({ protocol_version: 1, id: ++_id, method: m, params: p });
  const lp = await send('load_project', { codec: 'project', content: ${JSON.stringify(treeStr)} });
  const em = await send('export_models', { codec: 'java_block' });
  return JSON.stringify({ load: lp.ok ? lp.result : (lp.error || lp), models: (em.result && em.result.models) || [], export_err: em.ok ? null : (em.error || em) });
})()`;

const out = JSON.parse(await cdpEval(expression, { port: config.cdpPort }));
if (out.export_err) { console.error('export_models failed:', JSON.stringify(out.export_err)); process.exit(1); }
if (!out.models.length) { console.error('export_models returned no models'); process.exit(1); }

// ---- write each model + record lineage (all pointing at the single tree source) ----
const libDir = join(repoRoot, 'producers', 'blockbench', 'base-shapes');
mkdirSync(libDir, { recursive: true });
const convPath = join(repoRoot, 'db', 'conversions.json');
let conversions = existsSync(convPath) ? JSON.parse(readFileSync(convPath, 'utf8')) : [];

let base = 0, bespoke = 0;
for (const m of out.models) {
	const model = m.content.endsWith('\n') ? m.content : m.content + '\n';
	const isBase = baseShapeNames.has(m.group);
	const target = isBase
		? `producers/blockbench/base-shapes/${m.group}.json`
		: `assets/minecraft/models/block/${m.group}.json`;
	const dest = isBase ? join(libDir, `${m.group}.json`) : join(config.outDir, target);
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, model);
	conversions = conversions.filter((c) => c.target !== target);
	conversions.push({ target, source: treeRel, codec: 'java_block', source_format: 'java_block', source_sha256: treeSha, target_sha256: sha(model), converted_at: now() });
	isBase ? base++ : bespoke++;
}
writeFileSync(convPath, JSON.stringify(conversions, null, 2) + '\n');
console.log(`exported ${out.models.length} models from the folded tree (${base} base -> producers/blockbench/base-shapes/, ${bespoke} bespoke -> ${config.outDir}/assets/minecraft/models/block/)`);
console.log(`lineage: all ${out.models.length} targets now trace to ${treeRel}`);
console.log('run: node scripts/db.mjs index   (to refresh the asset index)');
