// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {evaluateQuality} from '../scripts/quality-gate.mjs';
import {sha256} from '../scripts/asset-files.mjs';
import {auditPack} from '../scripts/audit.mjs';

function fixture(t) {
    const root=mkdtempSync(join(tmpdir(),'forge-quality-'));
    t.after(()=>rmSync(root,{recursive:true,force:true}));
    const outDir=join(root,'out'), target='assets/minecraft/models/block/air.json';
    const write=(p,value)=>{const path=join(root,p);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));};
    write('out/'+target,{elements:[]});
    const hash=sha256(readFileSync(join(outDir,target)));
    write('preview.json',{capture:'fixture'});
    const review={status:'approved',by:'reviewer',sha256:hash,evidence:[{path:'preview.json',sha256:sha256(readFileSync(join(root,'preview.json')))}]};
    const entry={target,sha256:hash,producer:'authored',recipe:'test:empty'};
    write('out/provenance.json',{targets:[entry]});write('db/reviews.json',{[target]:review});write('db/visual-feedback.json',{entries:[]});
    return {root,outDir,target,write,review,entry,check:()=>evaluateQuality({outDir,repoRoot:root})};
}

test('current bytes and reviewed evidence open gate; byte changes invalidate approval',t=>{
    const f=fixture(t);assert.equal(f.check().open,true);
    f.write('out/'+f.target,{elements:[],credit:'changed'});
    const result=f.check();assert.equal(result.open,false);
    assert.ok(result.issues.some(i=>i.code==='stale-provenance'));
    assert.ok(result.issues.some(i=>i.code==='review-not-current'));
});

test('policy and legacy approvals do not satisfy visual review',t=>{
    const f=fixture(t);
    f.write('db/reviews.json',{[f.target]:{...f.review,by:'policy'}});
    assert.ok(f.check().issues.some(i=>i.code==='needs-approval'));
    f.write('db/reviews.json',{[f.target]:{status:'approved',by:'reviewer'}});
    assert.ok(f.check().issues.some(i=>i.code==='missing-preview'));
});

test('active feedback and changed preview evidence hold release',t=>{
    const f=fixture(t);f.write('db/visual-feedback.json',{entries:[{id:'scene',state:'candidate'}]});
    assert.ok(f.check().issues.some(i=>i.code==='active-visual-feedback'));
    f.write('preview.json',{capture:'different'});
    assert.ok(f.check().issues.some(i=>i.code==='preview-not-current'));
});

test('unmanifested assets and malformed durable records fail closed',t=>{
    const f=fixture(t);f.write('out/assets/minecraft/models/block/extra.json',{});
    assert.ok(f.check().issues.some(i=>i.code==='untracked-asset'));
    f.write('db/visual-feedback.json','broken json');
    assert.equal(f.check().open,false);
    f.write('out/provenance.json',{targets:[{...f.entry,target:'../outside.json'}]});
    assert.equal(f.check().open,false);
});

test('reference audit follows parent overrides, aliases, and blockstates',t=>{
    const f=fixture(t);
    f.write('out/assets/minecraft/models/block/template.json',{textures:{all:'minecraft:block/missing'},elements:[]});
    f.write('out/'+f.target,{parent:'minecraft:block/template',textures:{all:'#side',side:'minecraft:block/also_missing'}});
    f.write('out/assets/minecraft/blockstates/gate.json',{variants:{'':{model:'minecraft:block/not_here'}}});
    const result=auditPack(f.outDir);
    for (const suffix of ['missing.png','also_missing.png','not_here.json']) assert.ok(result.issues.some(i=>i.detail?.endsWith(suffix)),suffix);
});

test('reference cycles report issues without recursing indefinitely',t=>{
    const f=fixture(t);f.write('out/'+f.target,{parent:'minecraft:block/air',textures:{a:'#b',b:'#a'}});
    const result=auditPack(f.outDir);
    for(const code of ['parent-cycle','texture-alias-cycle']) assert.ok(result.issues.some(i=>i.code===code));
});

test('a held release does not replace the existing manifest',t=>{
    const f=fixture(t), original='{"release":"previous"}\n';
    // Exercise the CLI in an isolated repository with no SQLite index.
    f.write('out/provenance.json',{targets:[]});
    f.write('forge.json',{out:f.outDir});
    for (const name of ['release','quality-gate','audit','asset-files','config']) f.write(`scripts/${name}.mjs`,readFileSync(resolve(`scripts/${name}.mjs`),'utf8'));
    f.write('db/release-manifest.json',original);
    const manifest=join(f.root,'db/release-manifest.json');
    const before=readFileSync(manifest);
    const result=spawnSync(process.execPath,['scripts/release.mjs'],{cwd:f.root,env:{...process.env,FORGE_CONFIG:join(f.root,'forge.json')},encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    assert.deepEqual(readFileSync(manifest),before);
});

test('release CLI writes the reviewed current set without needing a database',t=>{
    const f=fixture(t);
    for (const name of ['release','quality-gate','audit','asset-files','config']) f.write(`scripts/${name}.mjs`,readFileSync(resolve(`scripts/${name}.mjs`),'utf8'));
    f.write('forge.json',{out:f.outDir});
    const result=spawnSync(process.execPath,['scripts/release.mjs'],{cwd:f.root,env:{...process.env,FORGE_CONFIG:join(f.root,'forge.json')},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(readFileSync(join(f.root,'db/release-manifest.json'),'utf8'));
    assert.equal(manifest.count,1);
    assert.equal(manifest.assets[0].target_sha256,f.entry.sha256);
});
