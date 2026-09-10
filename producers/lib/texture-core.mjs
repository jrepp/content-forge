// Shared plumbing for the texture-raster producers: load the Blockbench generator
// core from the retained dependency snapshot, resolve texture target paths / seeds,
// and read/write the out/.producers.json provenance map. Every raster producer
// (synth-textures, exemplar, reference-closure) and the tree folder (texture-gen)
// route through these helpers so the loading, path, and registry semantics stay
// consistent in one place.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../scripts/config.mjs';
import { SHADOW_TARGET, shadowMask } from '../raster/shadow-mask.mjs';

/**
 * Load the hash-pinned portable generator. FORGE_TEXTURE_CORE explicitly selects
 * a development copy; the editor checkout is independent of this raster input.
 * @returns {Promise<{core:any, config:any}>}
 */
export async function loadTextureCore() {
	const config = loadConfig();
	const corePath = process.env.FORGE_TEXTURE_CORE ? resolve(process.env.FORGE_TEXTURE_CORE)
		: fileURLToPath(new URL('../vendor/blockbench/texture_gen.js', import.meta.url));
	if (!process.env.FORGE_TEXTURE_CORE) {
		const provenance = JSON.parse(readFileSync(new URL('../vendor/blockbench/provenance.json', import.meta.url)));
		const hash = createHash('sha256').update(readFileSync(corePath)).digest('hex');
		if (hash !== provenance.sha256) throw new Error('Retained texture generator hash mismatch');
	}
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
