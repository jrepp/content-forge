// Shared plumbing for the texture-raster producers: load the Blockbench generator
// core from the configured producer checkout, resolve texture target paths / seeds,
// and read/write the out/.producers.json provenance map. Every raster producer
// (synth-textures, exemplar, reference-closure) and the tree folder (texture-gen)
// route through these helpers so the loading, path, and registry semantics stay
// consistent in one place.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../scripts/config.mjs';
import { SHADOW_TARGET, shadowMask } from '../raster/shadow-mask.mjs';

/**
 * Load config and dynamically import the Blockbench generator core (texture_gen.js).
 * Exits with a clear message if the core checkout is not where the config points.
 * @returns {Promise<{core:any, config:any}>}
 */
export async function loadTextureCore() {
	const config = loadConfig();
	const corePath = join(config.producerRoot, 'js', 'automation', 'texture_gen.js');
	if (!existsSync(corePath)) { console.error(`Blockbench generator core not found at ${corePath} (check producer.root in forge.config.json)`); process.exit(1); }
	const core = await import(pathToFileURL(corePath).href);
	return { core: {
		...core,
		classify: (target) => target === SHADOW_TARGET ? 'shadow_mask' : core.classify(target),
		listFamilies: () => [...core.listFamilies(), 'shadow_mask'],
		generateTexture: (request) => request.target === SHADOW_TARGET ? shadowMask() : core.generateTexture(request),
	}, config };
}

/** Seed / block name for a texture path or target: last path segment, `.png` stripped. */
export const seedFromPath = (path) => (String(path).split('/').pop() || '').replace(/\.png$/, '');

/** `block/oak_log` -> `assets/minecraft/textures/block/oak_log.png`. */
export const targetFromPath = (path) => `assets/minecraft/textures/${path}.png`;

/** `minecraft:block/oak_log` -> `assets/minecraft/textures/block/oak_log.png`. */
export const targetFromRef = (ref) => { const [ns, rest] = ref.split(':'); return `assets/${ns}/textures/${rest}.png`; };

/** Read the out/.producers.json provenance map (empty object if absent or unparseable). */
export function readProducers(outDir) {
	const p = join(outDir, '.producers.json');
	if (!existsSync(p)) return {};
	try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

/** Write the out/.producers.json provenance map (compact, newline-terminated). */
export function writeProducers(outDir, producers) {
	const p = join(outDir, '.producers.json');
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, JSON.stringify(producers, null, 0) + '\n');
}
