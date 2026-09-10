// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareModel} from '../producers/model/semantics.mjs';
import {survivalModels} from '../producers/model/survival.mjs';
import {loadTextureCore} from '../producers/lib/texture-core.mjs';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {decodePNG} from '../producers/raster/png.mjs';

test('boundary culling does not remove rotated or inset faces', () => {
    const original = {elements:[{from:[0,0,0],to:[16,8,16],faces:{up:{texture:'#t'},down:{texture:'#t'},north:{texture:'#t'}}}]};
    const model = prepareModel(original);
    assert.equal(model.elements[0].faces.up.cullface, undefined);
    assert.equal(model.elements[0].faces.down.cullface, 'down');
    assert.equal(model.elements[0].faces.north.cullface, 'north');
    assert.equal(original.elements[0].faces.down.cullface, undefined);
    original.elements[0].rotation={axis:'y',angle:45};
    assert.equal(prepareModel(original).elements[0].faces.north.cullface, undefined);
});
test('zero area exported plant edge faces are removed', () => {
    const m=prepareModel({elements:[{from:[0,0,8],to:[16,16,8],faces:Object.fromEntries(['up','down','north','south','east','west'].map(n=>[n,{texture:'#t'}]))}]});
    assert.deepEqual(Object.keys(m.elements[0].faces),['north','south']);
});
test('survival states select one model and resolve all authored materials', async () => {
    const {models,states}=survivalModels();const {core}=await loadTextureCore();
    for(const [name,state] of states) for(const apply of Object.values(state.variants)) {
        assert.ok(models.has(apply.model.replace('minecraft:block/','')),name);
        assert.ok(!Array.isArray(apply),name);
    }
    assert.deepEqual(Object.keys(states.get('large_fern').variants),['half=lower','half=upper']);
    assert.deepEqual(Object.keys(states.get('spruce_log').variants),['axis=y','axis=x','axis=z']);
    for(const [name,model] of models) for(const ref of Object.values(model.textures)) {
        assert.ok(!ref.includes('planks'), name + ' has unexpected wood material');
        const family=/podzol_(?:side|top)$/.test(ref)?'dirt':core.classify(ref);
        assert.ok(!family.startsWith('generic'), ref);
    }
    for(const name of ['brown_mushroom','red_mushroom']) assert.ok(models.get(name).elements.every(e=>e.to[1]<=7));
});
test('foliage and fern generation retains cutouts and deterministic colors', async () => {
    const {core}=await loadTextureCore();
    for(const name of ['spruce_leaves','large_fern_bottom','large_fern_top']) {
        const spec={target:'block/'+name,seed:name,size:16};const a=core.generateTexture(spec),b=core.generateTexture(spec);
        assert.deepEqual(a.data,b.data);const alpha=Array.from(a.data).filter((_,i)=>i%4===3);
        assert.ok(alpha.includes(0),name);assert.ok(alpha.includes(255),name);
        assert.ok(alpha.every(v=>v===0||v===255),name);
    }
});

test('published pack replaces deterministically with non-emissive material companions', async () => {
    const {config}=await loadTextureCore();
    const temp=mkdtempSync(join(tmpdir(),'survival-pack-'));
    try {
        const configPath=join(temp,'forge.json');
        writeFileSync(configPath,JSON.stringify({producer:{root:config.producerRoot},out:join(temp,'out')}));
        const generate=()=>execFileSync(process.execPath,['scripts/survival-pack.mjs'],{
            cwd:config.repoRoot,env:{...process.env,FORGE_CONFIG:configPath},stdio:'pipe',
        });
        generate();
        const output=join(temp,'out-survival');
        const first=readFileSync(join(output,'provenance.json'),'utf8');
        generate();
        assert.equal(readFileSync(join(output,'provenance.json'),'utf8'),first);
        const {targets}=JSON.parse(first);
        const textures=targets.filter(t=>t.target.endsWith('.png')&&!/_[ns]\.png$/.test(t.target));
        assert.equal(textures.length,31);
        for(const target of targets) {
            assert.equal(createHash('sha256').update(readFileSync(join(output,target.target))).digest('hex'),target.sha256,target.target);
        }
        for(const texture of textures) {
            const material=decodePNG(readFileSync(join(output,texture.target.replace('.png','_s.png'))));
            for(let i=0;i<material.data.length;i+=4) {
                assert.equal(material.data[i+3],255,texture.target+' must not emit');
                assert.equal(material.data[i+2],texture.target.endsWith('/spruce_leaves.png')?96:0,texture.target+' transmission');
            }
            const normal=decodePNG(readFileSync(join(output,texture.target.replace('.png','_n.png'))));
            assert.deepEqual(Array.from(normal.data.slice(0,4)),[128,128,255,255]);
        }
    } finally {rmSync(temp,{recursive:true,force:true});}
});
