// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {encodeAPNG, decodePNG} from '../producers/raster/png.mjs';

test('APNG preserves RGBA, static fallback, frame order, CRCs and rational timing', () => {
    const frames = [new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]), new Uint8Array([0, 0, 255, 128, 0, 255, 0, 255])];
    const png = encodeAPNG(2, 1, frames, 12);
    assert.deepEqual(png, encodeAPNG(2, 1, frames, 12));
    assert.deepEqual([...decodePNG(png).data], [...frames[0]]);
    const chunks = []; let sequence = 0, frame = 0;
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + length);
        let crc = 0xffffffff;
        for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        assert.equal(png.readUInt32BE(offset + 8 + length), (crc ^ 0xffffffff) >>> 0);
        chunks.push(type);
        if (type === 'acTL') { assert.equal(data.readUInt32BE(0), 2); assert.equal(data.readUInt32BE(4), 0); }
        if (type === 'fcTL') {
            assert.equal(data.readUInt32BE(0), sequence++);
            assert.equal(data.readUInt32BE(4), 2); assert.equal(data.readUInt32BE(8), 1);
            assert.equal(data.readUInt32BE(12), 0); assert.equal(data.readUInt32BE(16), 0);
            assert.equal(data.readUInt16BE(20), 1); assert.equal(data.readUInt16BE(22), 12);
            assert.equal(data[24], 0); assert.equal(data[25], 0);
        }
        if (type === 'fdAT') assert.equal(data.readUInt32BE(0), sequence++);
        if (type === 'IDAT' || type === 'fdAT') {
            const raw = inflateSync(type === 'IDAT' ? data : data.subarray(4));
            assert.deepEqual([...raw], [0, ...frames[frame++]]);
        }
        offset += length + 12;
    }
    assert.deepEqual(chunks, ['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
});

test('APNG rejects malformed and excessive allocations before encoding', () => {
    for (const args of [[0, 1, []], [1, 1, []], [1, 1, [new Uint8Array(3)]], [1, 1, [new Uint8Array(4)], 0],
        [1025, 1, []], [1024, 1024, Array(600).fill(new Uint8Array(4))]]) assert.throws(() => encodeAPNG(...args), /Invalid APNG/);
});
