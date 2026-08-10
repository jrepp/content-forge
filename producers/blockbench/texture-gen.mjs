// texture-gen: procedural texture source for the folded tree. Reuses the producer's
// portable, zero-DOM generator core (blockbench js/automation/texture_gen.js — the same
// core behind the `generate_texture` automation command and the in-app paint panel) so
// the textures baked into tree.bbmodel are byte-identical to what the app would produce.
//
// Node has no built-in PNG encoder, so we encode the generator's RGBA PixelBuffer to a
// PNG data URL here with the built-in zlib (single IDAT, filter 0). Deterministic: the
// texture name is the seed, so re-folding reproduces the exact same bytes.
import zlib from 'node:zlib';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../scripts/config.mjs';

const config = loadConfig();
const genUrl = pathToFileURL(join(config.producerRoot, 'js', 'automation', 'texture_gen.js'));
const { generateTexture, classify } = await import(genUrl.href);

// ---- minimal RGBA -> PNG (single IDAT, no per-scanline filtering) ----
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
	return t;
})();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }
function chunk(type, data) {
	const t = Buffer.from(type, 'ascii');
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
	return Buffer.concat([len, t, data, crc]);
}
/** @param {{width:number,height:number,data:Uint8ClampedArray}} buf */
function rgbaToPng(buf) {
	const { width: w, height: h, data } = buf;
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
	const raw = Buffer.alloc(h * (w * 4 + 1));
	for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = data[y * w * 4 + x]; }
	const idat = zlib.deflateSync(raw, { level: 9 });
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

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
	return { dataUrl: `data:image/png;base64,${rgbaToPng(buffer).toString('base64')}`, size, family };
}
