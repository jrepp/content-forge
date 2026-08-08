// producers/blockbench: drive Blockbench (Java Block format) to author the bespoke
// custom models, then convert -> vanilla MC model JSON (Codecs.java_block) while
// RETAINING the .bbmodel source (Codecs.project). Records each conversion's
// source<->target lineage into db/conversions.json.
//
//   node producers/blockbench/convert.mjs [--limit N]
//
// Requires a running Blockbench with BLOCKBENCH_AUTOMATION=1 and CDP on the
// configured port (producer.cdpPort). One CDP round-trip builds+exports all
// bespoke models. Geometry is a small per-name recipe (a real, editable starting
// point in Blockbench) — refine the .bbmodel sources later; the target drains now.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const limit = Number((args[args.indexOf('--limit') + 1]) || 0) || Infinity;
const now = () => new Date().toISOString();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// bespoke names come from the taxonomy (shape=bespoke)
// Bespoke worklist: the committed .bbmodel sources are the reproducible source of
// truth (they exist regardless of whether the queue is drained), plus any new
// bespoke the taxonomy surfaces this run.
const sourcesDirIn = join(repoRoot, 'producers', 'blockbench', 'sources');
const bespokeNames = new Set();
if (existsSync(sourcesDirIn)) {
	for (const f of readdirSync(sourcesDirIn)) if (f.endsWith('.bbmodel') && f !== 'base-shapes.bbmodel') bespokeNames.add(f.replace('.bbmodel', ''));
}
const csvPath = join(repoRoot, 'work', 'custom-models.csv');
if (existsSync(csvPath)) {
	const [header, ...lines] = readFileSync(csvPath, 'utf8').trim().split('\n');
	const cols = header.split(',');
	for (const l of lines) { const f = l.split(','); const r = {}; cols.forEach((c, i) => (r[c] = f[i] ?? '')); if (r.shape === 'bespoke') bespokeNames.add(r.name); }
}
const bespoke = [...bespokeNames].sort().slice(0, limit).map((name) => ({ name, target: `assets/minecraft/models/block/${name}.json` }));

// per-name geometry (boxes = [x1,y1,z1,x2,y2,z2]); default = full cube
const GEOMETRY = {
	barrel: [[0, 0, 0, 16, 16, 16]],
	bell: [[5, 4, 5, 11, 12, 11], [4, 12, 4, 12, 13, 12]],
	chain: [[6.5, 0, 6.5, 9.5, 16, 9.5]],
	hopper: [[0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12], [6, 0, 6, 10, 4, 10]],
	composter: [[0, 0, 0, 16, 2, 16], [0, 2, 0, 2, 16, 16], [14, 2, 0, 16, 16, 16], [2, 2, 0, 16, 16, 2], [2, 2, 14, 16, 16, 16]],
	grindstone: [[4, 4, 2, 12, 12, 14], [2, 6, 4, 4, 10, 12], [12, 6, 4, 14, 10, 12]],
	lectern: [[0, 0, 0, 16, 2, 16], [2, 2, 2, 14, 4, 14], [3, 4, 3, 13, 12, 8]],
	scaffolding: [[0, 0, 0, 2, 16, 2], [14, 0, 0, 16, 16, 2], [0, 0, 14, 2, 16, 16], [14, 0, 14, 16, 16, 16], [0, 14, 0, 16, 16, 16]],
	sculk_sensor: [[0, 0, 0, 16, 8, 16]],
	sculk_shrieker: [[0, 0, 0, 16, 8, 16]],
	calibrated_sculk_sensor: [[0, 0, 0, 16, 8, 16]],
};
const CUBE = [[0, 0, 0, 16, 16, 16]];
const specs = bespoke.map((r) => ({ name: r.name, target: r.target, boxes: GEOMETRY[r.name] || CUBE }));
if (!specs.length) { console.error('no bespoke models to convert'); process.exit(1); }

// ---- build the in-page expression ----
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const expression = `(() => {
  const PX = ${JSON.stringify(PX)};
  const SPECS = ${JSON.stringify(specs)};
  function build(spec){
    newProject(Formats.java_block);
    try { Project.name = spec.name; } catch(e){}
    spec.boxes.forEach((b,i)=> new Cube({name: i? spec.name+'_'+i : spec.name, from:[b[0],b[1],b[2]], to:[b[3],b[4],b[5]]}).init());
    const t = new Texture({name: spec.name, folder:'block', namespace:'minecraft'}).fromDataURL(PX).add(false);
    Cube.all.forEach(cu=>cu.applyTexture(t,true));
    if (typeof Canvas!=='undefined' && Canvas.updateAll) Canvas.updateAll();
    const jb = Codecs.java_block.compile();
    const proj = Codecs.project.compile();
    return { name: spec.name, target: spec.target, jb: typeof jb==='string'?jb:JSON.stringify(jb,null,2), bbmodel: typeof proj==='string'?proj:JSON.stringify(proj,null,2) };
  }
  return JSON.stringify(SPECS.map(build));
})()`;

// ---- minimal CDP eval ----
async function cdpEval(expr) {
	const port = config.cdpPort;
	const list = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
	const page = list.find((t) => t.type === 'page');
	if (!page) throw new Error(`no Blockbench page target on :${port} (launch with BLOCKBENCH_AUTOMATION=1)`);
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0; const pending = new Map();
	const send = (method, params) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((res) => pending.set(mid, res)); };
	const timeoutMs = Number(process.env.FORGE_CDP_TIMEOUT_MS || 60000);
	let timer;
	const value = await Promise.race([
		new Promise((resolve, reject) => {
			ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m); });
			ws.addEventListener('error', (e) => reject(new Error('WS ' + (e.message || e))));
			ws.addEventListener('close', () => reject(new Error('CDP socket closed before the eval returned')));
			ws.addEventListener('open', async () => {
				try {
					await send('Runtime.enable');
					const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
					if (r.result && r.result.exceptionDetails) throw new Error('PAGE ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
					resolve(r.result.result.value);
				} catch (e) { reject(e); }
			});
		}),
		new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`CDP eval timed out after ${timeoutMs}ms`)), timeoutMs); }),
	]).finally(() => { clearTimeout(timer); try { ws.close(); } catch { /* already closing */ } });
	return value;
}

const raw = await cdpEval(expression);
const results = JSON.parse(raw);

const sourcesDir = join(repoRoot, 'producers', 'blockbench', 'sources');
mkdirSync(sourcesDir, { recursive: true });
const convPath = join(repoRoot, 'db', 'conversions.json');
let conversions = existsSync(convPath) ? JSON.parse(readFileSync(convPath, 'utf8')) : [];

for (const r of results) {
	const jb = r.jb.endsWith('\n') ? r.jb : r.jb + '\n';
	const bb = r.bbmodel.endsWith('\n') ? r.bbmodel : r.bbmodel + '\n';
	const targetDest = join(config.outDir, r.target);
	const sourceRel = `producers/blockbench/sources/${r.name}.bbmodel`;
	mkdirSync(dirname(targetDest), { recursive: true });
	writeFileSync(targetDest, jb);
	writeFileSync(join(repoRoot, sourceRel), bb);
	conversions = conversions.filter((c) => c.target !== r.target);
	conversions.push({ target: r.target, source: sourceRel, codec: 'java_block', source_format: 'java_block', source_sha256: sha(bb), target_sha256: sha(jb), converted_at: now() });
}
writeFileSync(convPath, JSON.stringify(conversions, null, 2) + '\n');
console.log(`converted ${results.length} bespoke model(s): source .bbmodel retained + target java_block exported + lineage recorded`);
console.log(`  sources -> producers/blockbench/sources/   targets -> ${config.outDir}/assets/minecraft/models/block/`);
console.log('run: node scripts/db.mjs index   (to refresh the asset index)');
