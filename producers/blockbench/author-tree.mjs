// author-tree: drive Blockbench to author a single java_block project holding the
// base geometry shapes the selection set needs (groups = shapes, real geometry),
// then export_models -> one model per shape. Retains the .bbmodel tree source and
// records lineage. These authored base shapes are the Blockbench-produced geometry
// for the selection set (higher fidelity than the flat-cube JSON approximations).
//
//   node producers/blockbench/author-tree.mjs
// Requires a running BLOCKBENCH_AUTOMATION instance (producer.cdpPort).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';
import { cdpEval } from './cdp.mjs';

const config = loadConfig();
const now = () => new Date().toISOString();
const sha = (b) => createHash('sha256').update(b).digest('hex');

// Base shapes: name -> boxes [x1,y1,z1,x2,y2,z2, (yaw)]. Real vanilla-ish geometry.
const SHAPES = {
	cube_all: [[0, 0, 0, 16, 16, 16]],
	cube_column: [[0, 0, 0, 16, 16, 16]],
	slab_bottom: [[0, 0, 0, 16, 8, 16]],
	slab_top: [[0, 8, 0, 16, 16, 16]],
	stairs: [[0, 0, 0, 16, 8, 16], [0, 8, 0, 16, 16, 8]],
	fence_post: [[6, 0, 6, 10, 16, 10]],
	fence_side: [[6, 0, 6, 10, 16, 10], [7, 12, 9, 9, 15, 16], [7, 6, 9, 9, 9, 16]],
	wall_post: [[4, 0, 4, 12, 16, 12]],
	button: [[5, 0, 6, 11, 2, 10]],
	pressure_plate: [[1, 0, 1, 15, 1, 15]],
	carpet: [[0, 0, 0, 16, 1, 16]],
	pane_post: [[7, 0, 7, 9, 16, 9]],
	door: [[0, 0, 0, 3, 16, 16]],
	trapdoor: [[0, 0, 0, 16, 3, 16]],
	torch: [[7, 0, 7, 9, 10, 9]],
	ladder: [[0, 0, 15.2, 16, 16, 15.2]],
	cross: [[0.8, 0, 8, 15.2, 16, 8, 45], [8, 0, 0.8, 8, 16, 15.2, 45]],
	end_rod: [[7, 0, 7, 9, 16, 9]],
};

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const expression = `(async () => {
  const rt = window.AutomationRuntime; let _id = 0;
  const send = (m, p) => rt.send({ protocol_version: 1, id: ++_id, method: m, params: p });
  await send('new_project', { format: 'java_block', name: 'base-shapes' });
  const SHAPES = ${JSON.stringify(SHAPES)};
  const PX = ${JSON.stringify(PX)};
  for (const [name, boxes] of Object.entries(SHAPES)) {
    await send('add_group', { name, parent: 'root' });
    const grp = Group.all.find(g => g.name === name);
    const tex = new Texture({ name, folder: 'block', namespace: 'minecraft' }).fromDataURL(PX).add(false);
    boxes.forEach((b, i) => {
      const cube = new Cube({ name: name + '_' + i, from: [b[0], b[1], b[2]], to: [b[3], b[4], b[5]] });
      if (b.length > 6) { cube.origin = [8, 8, 8]; cube.rotation = [0, b[6], 0]; }
      cube.addTo(grp).init();
      cube.applyTexture(tex, true);
    });
  }
  if (typeof Canvas !== 'undefined' && Canvas.updateAll) Canvas.updateAll();
  const bbmodel = Codecs.project.compile();
  const r = await send('export_models', { codec: 'java_block' });
  return JSON.stringify({ bbmodel: typeof bbmodel === 'string' ? bbmodel : JSON.stringify(bbmodel, null, 2), models: (r.result && r.result.models) || [] });
})()`;

const out = JSON.parse(await cdpEval(expression, { port: config.cdpPort }));

// retain the .bbmodel tree source
const sourceRel = 'producers/blockbench/sources/base-shapes.bbmodel';
const bb = out.bbmodel.endsWith('\n') ? out.bbmodel : out.bbmodel + '\n';
mkdirSync(join(repoRoot, 'producers', 'blockbench', 'sources'), { recursive: true });
writeFileSync(join(repoRoot, sourceRel), bb);

// write each base-shape model into a library the JSON producer can instantiate from
const libDir = join(repoRoot, 'producers', 'blockbench', 'base-shapes');
mkdirSync(libDir, { recursive: true });
const convPath = join(repoRoot, 'db', 'conversions.json');
let conversions = existsSync(convPath) ? JSON.parse(readFileSync(convPath, 'utf8')) : [];
let wrote = 0;
for (const m of out.models) {
	const model = m.content.endsWith('\n') ? m.content : m.content + '\n';
	const dest = join(libDir, `${m.group}.json`);
	writeFileSync(dest, model);
	const target = `producers/blockbench/base-shapes/${m.group}.json`;
	conversions = conversions.filter((c) => c.target !== target);
	conversions.push({ target, source: sourceRel, codec: 'java_block', source_format: 'java_block', source_sha256: sha(bb), target_sha256: sha(model), converted_at: now() });
	wrote++;
}
writeFileSync(convPath, JSON.stringify(conversions, null, 2) + '\n');
console.log(`authored ${wrote} base shape(s) in one .bbmodel tree -> producers/blockbench/base-shapes/ (source: ${sourceRel})`);
console.log(`shapes: ${out.models.map((m) => m.group).join(', ')}`);
