// reference-closure: make out/ self-complete. Scan every generated model for the
// textures it references and generate a placeholder PNG for any that does not yet
// exist in out/. This closes the transitive gap the audit never captured (our
// synthesized models introduce texture refs the base game never had, e.g.
// block/acacia_button). Placeholders sit at the bottom of the composed stack, so
// higher-priority authored packs still win where they provide the real texture.
//
//   node producers/raster/reference-closure.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';
import { encodePNG } from './png.mjs';

const config = loadConfig();
const outDir = config.outDir;
const assetsDir = join(outDir, 'assets');
const corePath = join(config.producerRoot, 'js', 'automation', 'texture_gen.js');
if (!existsSync(corePath)) { console.error(`generator core not found at ${corePath}`); process.exit(1); }
const { generateTexture } = await import(pathToFileURL(corePath).href);

function walk(dir, filter, acc = []) {
	if (!existsSync(dir)) return acc;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, filter, acc);
		else if (filter(p)) acc.push(p);
	}
	return acc;
}

// A texture reference looks like `minecraft:block/x`, `block/x`, `minecraft:item/x`.
const REF = /^(?:([a-z0-9_.-]+):)?((?:block|item|entity|environment|misc|models|gui)\/[a-z0-9/._-]+)$/;
function collectRefs(node, out) {
	if (typeof node === 'string') { const m = node.match(REF); if (m) out.add(`${m[1] || 'minecraft'}:${m[2]}`); return; }
	if (Array.isArray(node)) { for (const v of node) collectRefs(v, out); return; }
	if (node && typeof node === 'object') { for (const v of Object.values(node)) collectRefs(v, out); }
}

const modelFiles = walk(join(assetsDir), (p) => p.includes(`${'/models/'}`) && p.endsWith('.json'));
const refs = new Set();
for (const f of modelFiles) {
	try { collectRefs(JSON.parse(readFileSync(f, 'utf8')), refs); } catch { /* skip unparseable */ }
}

// resolve a ref to its texture target path under out/
const targetOf = (ref) => { const [ns, rest] = ref.split(':'); return `assets/${ns}/textures/${rest}.png`; };

const producersPath = join(outDir, '.producers.json');
let producers = existsSync(producersPath) ? JSON.parse(readFileSync(producersPath, 'utf8')) : {};

let generated = 0, present = 0;
const dangling = [];
for (const ref of refs) {
	const target = targetOf(ref);
	const dest = join(outDir, target);
	if (existsSync(dest)) { present++; continue; }
	// generate a placeholder for a texture we own the gap of
	const name = (target.split('/').pop() || '').replace('.png', '');
	const family = target.includes('/item/') ? 'generic_item' : 'generic_block';
	const buffer = generateTexture({ family, seed: name, size: 16 });
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, encodePNG(buffer.width, buffer.height, buffer.data));
	producers[target] = { producer: 'texture-gen', recipe: `${family}:ref-closure` };
	generated++;
}
writeFileSync(producersPath, JSON.stringify(producers, null, 0) + '\n');

// verify: every model ref now resolves to a file in out/
for (const ref of refs) if (!existsSync(join(outDir, targetOf(ref)))) dangling.push(ref);

console.log(`model refs: ${refs.size}  already present: ${present}  generated placeholders: ${generated}`);
console.log(`dangling model texture refs after closure: ${dangling.length}${dangling.length ? ' -> ' + dangling.slice(0, 5).join(', ') : ' (out/ is self-complete)'}`);
process.exit(dangling.length ? 1 : 0);
