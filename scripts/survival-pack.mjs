// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
// node scripts/survival-pack.mjs: regenerate an explicit authored overlay.
import {mkdirSync, writeFileSync, renameSync, existsSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {loadTextureCore, seedFromPath} from '../producers/lib/texture-core.mjs';
import {encodePNG} from '../producers/raster/png.mjs';
import {survivalModels} from '../producers/model/survival.mjs';
const {core, config} = await loadTextureCore();
const out = join(dirname(config.outDir), 'out-survival');
const pending = out + '.candidate-' + process.pid;
const previous = out + '.previous-' + process.pid;
mkdirSync(pending, {recursive: true});
const targets = [];
function write(target, data, recipe) {
    const bytes = typeof data === 'string' ? Buffer.from(data) : data;
    const path = join(pending, target); mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, bytes);
    targets.push({target, producer:'content-forge', recipe, sha256:createHash('sha256').update(bytes).digest('hex')});
}
const json = x => JSON.stringify(x, null, 2) + '\n';
try {
    const {models, states} = survivalModels(); const textures = new Set(['water_overlay']);
    for (const [name, model] of models) {
        write(`assets/minecraft/models/block/${name}.json`, json(model), 'survival:model');
        for (const ref of Object.values(model.textures)) textures.add(ref.replace('minecraft:block/',''));
    }
    for (const [name, state] of states) write(`assets/minecraft/blockstates/${name}.json`, json(state), 'survival:blockstate');
    for (const name of [...textures].sort()) {
        const target = `assets/minecraft/textures/block/${name}.png`;
        const family = /^(?:podzol_side|podzol_top)$/.test(name) ? 'dirt' : core.classify(target);
        if (family === 'generic_block' || family === 'generic_item') throw new Error(`No authored recipe for ${target}`);
        const buffer = core.generateTexture({family, target, seed:seedFromPath(target), size:16});
        write(target, encodePNG(buffer.width, buffer.height, buffer.data), 'blockbench:' + family);
        // Own all material channels, preventing stale lower-layer PBR sidecars
        // from giving a newly authored diffuse material unintended emission.
        for (const [suffix, rgba] of [['_n',[128,128,255,255]],['_s',[0,0,name === 'spruce_leaves' ? 96 : 0,255]]]) {
            const data = new Uint8Array(16*16*4); for(let i=0;i<data.length;i+=4)data.set(rgba,i);
            write(target.replace('.png',suffix+'.png'),encodePNG(16,16,data),name === 'spruce_leaves' && suffix === '_s' ? 'survival:foliage-transmission' : 'survival:neutral-material');
        }
    }
    write('pack.mcmeta',json({pack:{pack_format:22,description:'Content-forge small survival authored terrain'}}),'survival:pack');
    writeFileSync(join(pending,'provenance.json'),json({schema:1,producer:'content-forge',targets:targets.sort((a,b)=>a.target.localeCompare(b.target))}));
    if(existsSync(out))renameSync(out,previous);
    try {renameSync(pending,out);} catch(error) {if(existsSync(previous))renameSync(previous,out);throw error;}
    if(existsSync(previous))rmSync(previous,{recursive:true});
    console.log(JSON.stringify({output:out,targets:targets.length}));
} finally {if(existsSync(pending))rmSync(pending,{recursive:true});}
