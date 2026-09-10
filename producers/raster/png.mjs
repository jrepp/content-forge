// Minimal dependency-free PNG encoder + decoder (8-bit) using node:zlib.
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const typeBuf = Buffer.from(type, 'latin1');
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Full-canvas APNG frames, including a static first-frame fallback.
// https://www.w3.org/TR/png-3/#apng-chunks
export function encodeAPNG(width, height, frames, fps = 12) {
	if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 1024) ||
		!Number.isInteger(fps) || fps < 1 || fps > 60 || !Array.isArray(frames) ||
		frames.length < 1 || frames.length > 600 || width * height * 4 * frames.length > 128 * 1024 * 1024 ||
		frames.some(frame => !(frame instanceof Uint8Array || frame instanceof Uint8ClampedArray) || frame.length !== width * height * 4)) {
		throw new Error('Invalid APNG dimensions, timing or RGBA frames (128 MiB maximum)');
	}
	const first = encodePNG(width, height, frames[0], {level: 9});
	const control = Buffer.alloc(8); control.writeUInt32BE(frames.length); // zero plays = loop forever
	const parts = [first.subarray(0, 33), chunk('acTL', control)];
	let sequence = 0;
	for (let i = 0; i < frames.length; i++) {
		const fc = Buffer.alloc(26);
		fc.writeUInt32BE(sequence++, 0); fc.writeUInt32BE(width, 4); fc.writeUInt32BE(height, 8);
		fc.writeUInt16BE(1, 20); fc.writeUInt16BE(fps, 22); // dispose NONE, blend SOURCE
		parts.push(chunk('fcTL', fc));
		const png = i === 0 ? first : encodePNG(width, height, frames[i], {level: 9});
		const data = png.subarray(41, 41 + png.readUInt32BE(33));
		if (i === 0) parts.push(chunk('IDAT', data));
		else {
			const seq = Buffer.alloc(4); seq.writeUInt32BE(sequence++);
			parts.push(chunk('fdAT', Buffer.concat([seq, data])));
		}
	}
	parts.push(chunk('IEND', Buffer.alloc(0)));
	return Buffer.concat(parts);
}

/**
 * Encode an RGBA pixel buffer as a PNG.
 * @param {number} width @param {number} height
 * @param {Uint8ClampedArray|Uint8Array|number[]} rgba length width*height*4
 * @param {{level?:number}} [opts] zlib deflate level (default: zlib's default; pass 9 for
 *   the smallest output / to match a byte-for-byte baseline)
 * @returns {Buffer}
 */
export function encodePNG(width, height, rgba, opts = {}) {
	const src = rgba instanceof Uint8Array ? rgba : Uint8Array.from(rgba);
	const stride = width * 4;
	// raw = per-scanline filter byte (0 = none) + row bytes
	const raw = Buffer.alloc(height * (1 + stride));
	for (let y = 0; y < height; y++) {
		const o = y * (1 + stride);
		raw[o] = 0;
		Buffer.from(src.buffer, src.byteOffset + y * stride, stride).copy(raw, o + 1);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 6;  // color type: RGBA
	// [10]=compression 0, [11]=filter 0, [12]=interlace 0 (already zeroed)
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const idat = opts.level != null ? deflateSync(raw, { level: opts.level }) : deflateSync(raw);
	return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Parse a PNG's IHDR width/height (for validation). @param {Buffer} buf */
export function readPngSize(buf) {
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

/** Paeth predictor (PNG filter type 4). */
function paeth(a, b, c) {
	const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode an 8-bit PNG to an RGBA pixel buffer. Handles color types 6 (RGBA),
 * 2 (RGB), and 0 (grayscale), with all five scanline filters. No interlacing
 * (Adam7) — sufficient for 16x16 texture tiles and our own encoder's output.
 * @param {Buffer} buf @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function decodePNG(buf) {
	if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
	const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
	const bitDepth = buf[24], colorType = buf[25], interlace = buf[28];
	if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
	if (interlace) throw new Error('interlaced PNG not supported');
	const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
	if (!channels) throw new Error(`unsupported color type ${colorType}`);

	// concat all IDAT chunks, then inflate
	const idat = [];
	let off = 8;
	while (off < buf.length) {
		const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
		if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
		if (type === 'IEND') break;
		off += 12 + len;
	}
	const raw = inflateSync(Buffer.concat(idat));

	const bpp = channels;                       // bytes per pixel (8-bit)
	const stride = width * bpp;
	const out = new Uint8ClampedArray(width * height * 4);
	const prev = new Uint8Array(stride);
	const cur = new Uint8Array(stride);
	let p = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[p++];
		for (let x = 0; x < stride; x++) {
			const rawB = raw[p++];
			const a = x >= bpp ? cur[x - bpp] : 0;   // left
			const b = prev[x];                        // up
			const c = x >= bpp ? prev[x - bpp] : 0;   // up-left
			let v = rawB;
			if (filter === 1) v = rawB + a;
			else if (filter === 2) v = rawB + b;
			else if (filter === 3) v = rawB + ((a + b) >> 1);
			else if (filter === 4) v = rawB + paeth(a, b, c);
			cur[x] = v & 0xff;
		}
		// expand this scanline into RGBA
		for (let x = 0; x < width; x++) {
			const s = x * bpp, d = (y * width + x) * 4;
			if (channels === 4) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3]; }
			else if (channels === 3) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = 255; }
			else { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = 255; }
		}
		prev.set(cur);
	}
	return { width, height, data: out };
}
