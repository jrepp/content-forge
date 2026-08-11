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
const { generateTexture, classify } = await import(pathToFileURL(corePath).href);

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
const REF = /^(?:([a-z0-9_.-]+):)?((?:block|item|entity|environment|misc|particle|gui|painting|effect)\/[a-z0-9/._-]+)$/;
// Collect only TEXTURE references — the model's `textures` map values and face
// `texture` values — never `parent` (that is a MODEL ref) and never `#var` aliases.
function collectTextureRefs(model, out) {
	const consider = (v) => {
		if (typeof v !== 'string' || v.startsWith('#')) return;
		const m = v.match(REF);
		if (m) out.add(`${m[1] || 'minecraft'}:${m[2]}`);
	};
	if (model && model.textures && typeof model.textures === 'object') {
		for (const v of Object.values(model.textures)) consider(v);
	}
	if (model && Array.isArray(model.elements)) {
		for (const el of model.elements) {
			if (el && el.faces && typeof el.faces === 'object') {
				for (const face of Object.values(el.faces)) if (face && typeof face === 'object') consider(face.texture);
			}
		}
	}
}

const sep = join('a', 'b').slice(1, 2); // path separator, cross-platform
const modelFiles = walk(assetsDir, (p) => p.includes(`${sep}models${sep}`) && p.endsWith('.json'));
const refs = new Set();
for (const f of modelFiles) {
	try { collectTextureRefs(JSON.parse(readFileSync(f, 'utf8')), refs); } catch { /* skip unparseable */ }
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
	// generate a placeholder for a texture we own the gap of, routed through the
	// core's classify() (wood/planks/leaves/ore/… get real structure). Pass target
	// so the recipe resolves the real block name (oak_planks, not "planks").
	const name = (target.split('/').pop() || '').replace('.png', '');
	const family = classify(target);
	const buffer = generateTexture({ family, target, seed: name, size: 16 });
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
