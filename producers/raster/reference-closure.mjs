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
import { encodePNG } from './png.mjs';
import { loadTextureCore, seedFromPath, targetFromRef, readProducers, writeProducers } from '../lib/texture-core.mjs';

const { core: { generateTexture, classify }, config } = await loadTextureCore();
const outDir = config.outDir;
const assetsDir = join(outDir, 'assets');

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

const producers = readProducers(outDir);

let generated = 0, present = 0;
const dangling = [];
for (const ref of refs) {
	const target = targetFromRef(ref);
	const dest = join(outDir, target);
	// Skip real/borrowed assets, but REGENERATE textures we own so a recipe or routing
	// change (generic -> copper, …) propagates without a manual clean. Owned = we wrote
	// it (producer texture-gen); anything else present is a higher-priority real asset.
	const owned = producers[target] && producers[target].producer === 'texture-gen';
	if (existsSync(dest) && !owned) { present++; continue; }
	// route through the core's classify() (wood/planks/leaves/ore/… get real structure).
	// Pass target so the recipe resolves the real block name (oak_planks, not "planks").
	const family = classify(target);
	const buffer = generateTexture({ family, target, seed: seedFromPath(target), size: 16 });
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, encodePNG(buffer.width, buffer.height, buffer.data));
	producers[target] = { producer: 'texture-gen', recipe: `${family}:ref-closure` };
	generated++;
}
writeProducers(outDir, producers);

// verify: every model ref now resolves to a file in out/
for (const ref of refs) if (!existsSync(join(outDir, targetFromRef(ref)))) dangling.push(ref);

console.log(`model refs: ${refs.size}  borrowed (kept): ${present}  generated/refreshed: ${generated}`);
console.log(`dangling model texture refs after closure: ${dangling.length}${dangling.length ? ' -> ' + dangling.slice(0, 5).join(', ') : ' (out/ is self-complete)'}`);
process.exit(dangling.length ? 1 : 0);
