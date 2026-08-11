// texture-gen: procedural texture source for the folded tree. Reuses the producer's
// portable, zero-DOM generator core (blockbench js/automation/texture_gen.js — the same
// core behind the `generate_texture` automation command and the in-app paint panel) so
// the textures baked into tree.bbmodel are byte-identical to what the app would produce.
//
// Node has no built-in PNG encoder, so we encode the generator's RGBA PixelBuffer to a
// PNG data URL via the shared dependency-free writer (png.mjs). level 9 keeps the output
// byte-for-byte with the historical baseline. Deterministic: the texture name is the seed,
// so re-folding reproduces the exact same bytes.
import { loadTextureCore } from '../lib/texture-core.mjs';
import { encodePNG } from '../raster/png.mjs';

const { core: { generateTexture, classify } } = await loadTextureCore();

/**
 * Procedurally generate a texture and return it as a PNG data URL plus its pixel size.
 * @param {string} name texture/group name — used as both the classify() target and the seed.
 * @param {{size?:number, family?:string}} [opts]
 * @returns {{ dataUrl:string, size:number, family:string }}
 */
export function generatePngDataUrl(name, opts = {}) {
	const size = opts.size && opts.size > 0 ? Math.floor(opts.size) : 16;
	const target = `assets/minecraft/textures/block/${name}.png`;
	const family = opts.family || classify(target);
	const buffer = generateTexture({ family: opts.family, target, name, seed: name, size });
	const png = encodePNG(buffer.width, buffer.height, buffer.data, { level: 9 });
	return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, size, family };
}
