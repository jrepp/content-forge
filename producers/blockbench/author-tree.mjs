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
	// pane arm: extends from the pane_post center to the -Z (north) edge, so the
	// blockstate maps north=0 / east=90 / south=180 / west=270 (rotates 4x).
	pane_side: [[7, 0, 0, 9, 16, 7]],
	// standing banner cloth panel (thin, tall)
	banner: [[1, 1, 7.5, 15, 16, 8.5]],
	// hanging sign: board + two hanging bars
	hanging_sign: [[1, 0, 7, 15, 10, 9], [3, 10, 7.5, 4, 16, 8.5], [12, 10, 7.5, 13, 16, 8.5]],
	// bed: mattress body + four corner legs
	bed: [[0, 3, 0, 16, 9, 16], [0, 0, 0, 3, 3, 3], [13, 0, 0, 16, 3, 3], [0, 0, 13, 3, 3, 16], [13, 0, 13, 16, 3, 16]],
	// skull/head: 8x8x8 on the ground
	head: [[4, 0, 4, 12, 8, 12]],
	// coral fan: three thin blades radiating at 0/60/120 deg
	coral_fan: [[1, 0, 8, 15, 8, 8, 0], [1, 0, 8, 15, 8, 8, 60], [1, 0, 8, 15, 8, 8, 120]],
	// cake body + candle on top
	candle_cake: [[1, 0, 1, 15, 8, 15], [7, 8, 7, 9, 14, 9]],
	// flower pot + small cross plant above it
	potted_plant: [[5, 0, 5, 11, 6, 11], [5.5, 6, 8, 10.5, 13, 8, 45], [8, 6, 5.5, 8, 13, 10.5, 45]],
};

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVR42mNgGAWjYBSMAggAAAQQAAGvRYgsAAAAAElFTkSuQmCC';
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
      // Map face UVs to the 16x16 texture (0-16 texel space). New cubes default to
      // autouv=0 (manual), which leaves the [0,0,1,1] corner-pixel UV; autouv=1 makes
      // mapAutoUV project each face to its real size.
      cube.autouv = 1;
      if (!cube.box_uv && typeof cube.mapAutoUV === 'function') cube.mapAutoUV();
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
