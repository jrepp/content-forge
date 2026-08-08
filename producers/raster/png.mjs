// Minimal dependency-free PNG encoder (8-bit RGBA) using node:zlib.
import { deflateSync } from 'node:zlib';

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

/**
 * Encode an RGBA pixel buffer as a PNG.
 * @param {number} width @param {number} height
 * @param {Uint8ClampedArray|Uint8Array|number[]} rgba length width*height*4
 * @returns {Buffer}
 */
export function encodePNG(width, height, rgba) {
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
	return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Parse a PNG's IHDR width/height (for validation). @param {Buffer} buf */
export function readPngSize(buf) {
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}
