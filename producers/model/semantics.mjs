// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
// Shared cleanup for authored geometry, before it becomes a Minecraft model.
const AXIS = {west: 0, east: 0, down: 1, up: 1, north: 2, south: 2};
const POSITIVE = new Set(['east', 'up', 'south']);

export function prepareModel(model) {
    const result = structuredClone(model);
    for (const element of result.elements || []) {
        const extent = element.to.map((v, i) => v - element.from[i]);
        for (const [direction, face] of Object.entries(element.faces || {})) {
            const axis = AXIS[direction];
            if (axis === undefined) throw new Error(`Unknown face direction: ${direction}`);
            // Flat crossed plants exported by Blockbench also contain four zero-area
            // edge faces. They have no drawable surface or well-defined tangent.
            if (extent.some((v, i) => i !== axis && v === 0)) {
                delete element.faces[direction];
                continue;
            }
            if (!element.rotation || element.rotation.angle === 0) {
                const boundary = POSITIVE.has(direction) ? element.to[axis] : element.from[axis];
                if (boundary === (POSITIVE.has(direction) ? 16 : 0)) face.cullface = direction;
            }
        }
    }
    delete result.format_version;
    delete result.groups;
    return result;
}
