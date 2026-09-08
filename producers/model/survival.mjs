// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
// Bounded authored terrain set. Geometry and textures publish together; the
// incomplete generic catalog remains a lower-priority compatibility fallback.
import { prepareModel } from './semantics.mjs';
const dirs = ['down', 'up', 'north', 'south', 'west', 'east'];
const tex = n => `minecraft:block/${n}`;
function box(from, to, texture, omit = []) {
    return {from, to, faces: Object.fromEntries(dirs.filter(d => !omit.includes(d)).map(d => [d, {texture, uv: [0, 0, 16, 16]}]))};
}
export function cube(name, top = name, bottom = name) {
    const e = box([0,0,0], [16,16,16], '#side');
    e.faces.up.texture = '#top'; e.faces.down.texture = '#bottom';
    return prepareModel({textures: {side: tex(name), top: tex(top), bottom: tex(bottom), particle: tex(name)}, elements: [e]});
}
export function cross(name) {
    // Double-sided planes, with no degenerate edge faces and no coincident
    // same-facing surfaces. Flat plant shading is intentional, not emission.
    return {ambientocclusion: false, textures: {plant: tex(name), particle: tex(name)}, elements: [
        {from: [0,0,8], to: [16,16,8], rotation: {origin: [8,8,8], axis: 'y', angle: 45}, shade: false,
         faces: {north: {texture: '#plant', uv: [0,0,16,16]}, south: {texture: '#plant', uv: [0,0,16,16]}}},
        {from: [8,0,0], to: [8,16,16], rotation: {origin: [8,8,8], axis: 'y', angle: 45}, shade: false,
         faces: {west: {texture: '#plant', uv: [0,0,16,16]}, east: {texture: '#plant', uv: [0,0,16,16]}}},
    ]};
}
function mushroom(name) {
    // A shallow cap and narrow stalk. Neither exports a full-block cube.
    return {textures: {cap: tex(name + '_block'), stem: tex('mushroom_stem'), particle: tex(name + '_block')}, elements: [
        box([6,0,6], [10,4,10], '#stem', ['up']),
        box([3,4,3], [13,7,13], '#cap'),
    ]};
}
export function survivalModels() {
    const models = new Map(); const states = new Map();
    const add = (name, model, state = {variants: {'': {model: tex(name)}}}) => {models.set(name, model); states.set(name, state);};
    for (const n of ['calcite','stone','gravel','coarse_dirt','dirt','blackstone','obsidian','cobblestone','snow_block','powder_snow','yellow_terracotta','red_sand','smooth_basalt','iron_ore','coal_ore']) add(n, cube(n));
    add('spruce_log', cube('spruce_log', 'spruce_log_top', 'spruce_log_top'), {variants: {
        'axis=y': {model: tex('spruce_log')}, 'axis=x': {model: tex('spruce_log'), x:90,y:90}, 'axis=z': {model:tex('spruce_log'),x:90},
    }});
    // The Blockbench foliage recipe is already colored. Do not apply a second
    // biome tint; the generic/Faithful grayscale path is a separate material.
    add('spruce_leaves', cube('spruce_leaves'));
    add('grass_block', cube('grass_block_side','grass_block_top','dirt'), {variants: {
        'snowy=false': {model: tex('grass_block')}, 'snowy=true': {model:tex('grass_block_snow')},
    }});
    models.set('grass_block_snow', cube('snow','snow','dirt'));
    add('podzol', cube('podzol_side','podzol_top','dirt'), {variants: {
        'snowy=false': {model: tex('podzol')}, 'snowy=true': {model:tex('grass_block_snow')},
    }});
    for (const n of ['fern','short_grass']) add(n, cross(n));
    add('large_fern', cross('large_fern_bottom'), {variants: {
        'half=lower': {model:tex('large_fern')}, 'half=upper': {model:tex('large_fern_top')},
    }});
    models.set('large_fern_top', cross('large_fern_top'));
    for (const n of ['brown_mushroom','red_mushroom']) add(n, mushroom(n));
    for (const model of models.values()) model.credit = 'content-forge: small survival terrain';
    return {models, states};
}
