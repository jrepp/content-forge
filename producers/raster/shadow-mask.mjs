/*
 * Copyright (C) 2026 Jacob Repp
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const SHADOW_TARGET = 'assets/minecraft/textures/misc/shadow.png';

/** A black, soft alpha decal; misc/shadow must never use a block texture recipe. */
export function shadowMask() {
    const width = 64, height = 64;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const nx = (x + 0.5 - width / 2) / (width * 0.48);
        const ny = (y + 0.5 - height / 2) / (height * 0.48);
        const radius = nx * nx + ny * ny;
        data[(y * width + x) * 4 + 3] = radius >= 1 ? 0 : Math.round(255 * Math.exp(-3.4 * radius));
    }
    return { width, height, data };
}
