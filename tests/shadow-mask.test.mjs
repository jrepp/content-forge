/*
 * Copyright (C) 2026 Jacob Repp
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowMask, SHADOW_TARGET } from '../producers/raster/shadow-mask.mjs';
import { loadTextureCore } from '../producers/lib/texture-core.mjs';

test('shadow mask has black RGB, transparent borders and symmetric soft alpha', () => {
    const { width, height, data } = shadowMask();
    const alpha = (x, y) => data[(y * width + x) * 4 + 3];
    assert.ok(alpha(width / 2, height / 2) > 250);
    assert.ok(alpha(width / 4, height / 2) > 0);
    assert.ok(alpha(width / 4, height / 2) < alpha(width / 2, height / 2));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        assert.deepEqual([...data.slice(index, index + 3)], [0, 0, 0]);
        assert.equal(alpha(x, y), alpha(width - 1 - x, y));
        assert.equal(alpha(x, y), alpha(x, height - 1 - y));
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) assert.equal(alpha(x, y), 0);
    }
});

test('shared raster producer overrides generic block routing only for the exact shadow target', async () => {
    const { core } = await loadTextureCore();
    assert.equal(core.classify(SHADOW_TARGET), 'shadow_mask');
    assert.deepEqual(core.generateTexture({ family: 'generic_block', target: SHADOW_TARGET }), shadowMask());
    assert.notEqual(core.classify('assets/minecraft/textures/block/oak_log.png'), 'shadow_mask');
});
