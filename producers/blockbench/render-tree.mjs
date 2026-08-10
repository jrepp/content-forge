// render-tree: batch-render one PNG thumbnail per top-level group of the currently
// loaded tree.bbmodel, via automation/CDP. For each group it isolates visibility to
// that group's cubes, frames a fixed isometric camera, and captures an auto-cropped
// preview screenshot (Preview.screenshot's callback path is headless — no save dialog).
//
//   node producers/blockbench/render-tree.mjs [--size 128]
//
// Requires a running BLOCKBENCH_AUTOMATION instance with the tree project loaded
// (run fold-tree.mjs first). Renders land in renders/<group>.png.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';
import { cdpEval } from './cdp.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const size = Number((args[args.indexOf('--size') + 1]) || 0) || 128;

const expression = `(async () => {
  const SIZE = ${size};
  const prev = Preview.selected;
  prev.loadAnglePreset({ position: [30, 38, 30], target: [0, 8, 0], projection: 'perspective' });
  prev.controls.target.set(0, 8, 0);
  // the folded tree now carries real per-group textures (fold-tree bakes them in via the
  // generate lane), so faces render textured directly — no placeholder override needed.
  const groups = Outliner.root.filter(n => n.type === 'group');
  const membership = g => { const ids = new Set(); (function walk(n){ if (n.type === 'cube') ids.add(n.uuid); (n.children||[]).forEach(walk); })(g); return ids; };
  const shot = () => new Promise(res => prev.screenshot({ crop: true, width: SIZE, height: SIZE }, url => res(url)));
  const out = [];
  for (const g of groups) {
    const ids = membership(g);
    Cube.all.forEach(c => { c.visibility = ids.has(c.uuid); });
    Canvas.updateVisibility();
    prev.render();
    await new Promise(r => setTimeout(r, 30));
    out.push({ name: g.name, dataUrl: await shot() });
  }
  Cube.all.forEach(c => { c.visibility = true; });
  Canvas.updateVisibility();
  prev.render();
  return JSON.stringify(out);
})()`;

const renders = JSON.parse(await cdpEval(expression, { port: config.cdpPort, timeoutMs: 120000 }));

const dir = join(repoRoot, 'renders');
mkdirSync(dir, { recursive: true });
let wrote = 0, empty = 0;
for (const r of renders) {
	const b64 = (r.dataUrl || '').replace(/^data:image\/png;base64,/, '');
	if (!b64) { empty++; continue; }
	writeFileSync(join(dir, `${r.name}.png`), Buffer.from(b64, 'base64'));
	wrote++;
}
console.log(`rendered ${wrote} thumbnail(s) at ${size}x${size} -> renders/  ${empty ? `(${empty} empty)` : ''}`);
console.log(`groups: ${renders.map(r => r.name).join(', ')}`);
