// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
// Local pack reference/provenance audit. Missing local references can be provided
// by other composition layers; this is not a substitute for a consumer re-audit.
import {readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig, repoRoot} from './config.mjs';
import {sha256, containedPath} from './asset-files.mjs';

export function auditPack(root, queue = {entries:[]}) {
    const files = new Map(), models = new Map(), issues = [], qualityFlags = [];
    const add = (code, target, detail) => issues.push({code, target, detail});
    function walk(dir, prefix) {
        for (const entry of readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
            const target = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) walk(join(dir,entry.name), target);
            else if (entry.isFile()) files.set(target, readFileSync(join(dir,entry.name)));
            else add('unsupported-file',target,'Expected regular file or directory');
        }
    }
    if (existsSync(join(root,'assets'))) walk(join(root,'assets'),'assets');
    else add('missing-assets','assets','No asset tree');
    const parsed = new Map();
    for (const [target, bytes] of files) if (target.endsWith('.json')) {
        try {
            const value = JSON.parse(bytes.toString('utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
            parsed.set(target,value);
            if (target.includes('/models/')) models.set(target,value);
        } catch(error) {add('invalid-json',target,error.message);}
    }
    const builtin = new Set(['minecraft:builtin/generated','minecraft:builtin/entity']);
    function reference(target, ref, kind) {
        if (typeof ref !== 'string' || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(ref) || ref.split('/').includes('..')) {
            add('invalid-reference',target,String(ref)); return null;
        }
        const [ns,path] = ref.includes(':') ? ref.split(':') : ['minecraft',ref];
        if (kind === 'models' && builtin.has(`${ns}:${path}`)) return null;
        const dest = `assets/${ns}/${kind}/${path}.${kind === 'textures' ? 'png' : 'json'}`;
        if (!files.has(dest)) add('missing-local-reference',target,dest);
        return dest;
    }
    const cache = new Map();
    function inherit(target, chain = new Set()) {
        if (cache.has(target)) return cache.get(target);
        if (chain.has(target)) {add('parent-cycle',target,[...chain,target].join(' -> '));return {};}
        const m = models.get(target);
        if (!m) return {};
        chain = new Set([...chain,target]);
        const parent = m.parent ? reference(target,m.parent,'models') : null;
        const base = parent ? inherit(parent,chain) : {};
        const result = {...base,...m,textures:{...base.textures,...m.textures}};
        cache.set(target,result);return result;
    }
    for (const target of models.keys()) {
        const model = inherit(target);
        const texture = ref => {
            const visited = new Set();
            while (typeof ref === 'string' && ref.startsWith('#')) {
                if (visited.has(ref)) {add('texture-alias-cycle',target,ref);return;}
                visited.add(ref);ref = model.textures?.[ref.slice(1)];
            }
            // Unbound template variables are legal until instantiated by a child.
            if (ref === undefined) return;
            reference(target,ref,'textures');
        };
        for (const ref of Object.values(model.textures || {})) texture(ref);
        for (const element of model.elements || []) for (const face of Object.values(element.faces || {})) texture(face.texture);
        for (const override of model.overrides || []) reference(target,override.model,'models');
    }
    for (const [target,state] of parsed) if (target.includes('/blockstates/')) {
        const parts = state.multipart || [];
        const applies = [...Object.values(state.variants || {}),...parts.map(p=>p.apply)];
        if (!applies.length) add('empty-blockstate',target,'No variants or multipart applies');
        for (const apply of applies.flat()) reference(target,apply?.model,'models');
        if (target.endsWith('_fence_gate.json') && !JSON.stringify(state).includes('open')) {
            qualityFlags.push({target,code:'gate-state-incomplete',detail:'No open state selector; inspect gate geometry and in_wall behavior'});
        }
    }
    let provenance;
    try {provenance = JSON.parse(readFileSync(join(root,'provenance.json'),'utf8'));}
    catch(error) {add('invalid-provenance','provenance.json',error.message);}
    const covered = new Set();
    for (const entry of provenance?.targets || []) {
        if (covered.has(entry.target)) add('duplicate-provenance',entry.target,'Repeated target');
        covered.add(entry.target);
        try {
            const actual = sha256(readFileSync(containedPath(root,entry.target)));
            if (actual !== entry.sha256) add('stale-provenance',entry.target,'Hash differs from current file');
        } catch(error) {add('missing-provenance-target',entry.target,error.message);}
        if (!entry.producer || entry.producer === 'unknown' || !entry.recipe) add('missing-lineage',entry.target,'Producer and recipe required');
        if (/generic_|placeholder/.test(entry.recipe || '')) qualityFlags.push({target:entry.target,code:'placeholder-recipe',detail:entry.recipe});
    }
    for (const target of files.keys()) if (!covered.has(target)) add('untracked-asset',target,'Missing from provenance');
    const demand = (queue.entries || []).filter(e=>e.disposition !== 'resolved').map(e=>({
        target:e.target, kind:e.kind, detail:e.detail, disposition:e.disposition,
        consumers:e.consumers || [], localFile:files.has(e.target),
        candidates:(e.candidates || []).map(c=>({source:c.source,target:c.target,match:c.match})),
    }));
    const counts = rows => rows.reduce((acc,row)=>(acc[row.code]=(acc[row.code]||0)+1,acc),{});
    return {schema:1, pack:root, queueFingerprint:queue.fingerprint || null,
        scope:'Local references and provenance only; not a composed-pack or visual acceptance result',
        files:files.size, issueCounts:counts(issues), qualityFlagCounts:counts(qualityFlags),
        demandCounts:{actionable:demand.length,absentLocally:demand.filter(e=>!e.localFile).length},
        issues,qualityFlags,demand};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const args = process.argv.slice(2);
    const opt = (name,fallback) => {const i=args.indexOf(name);return i<0?fallback:args[i+1];};
    const root = resolve(opt('--pack',loadConfig().outDir));
    const queue = JSON.parse(readFileSync(join(repoRoot,'work/queue.json'),'utf8'));
    const report = auditPack(root,queue);
    const output = resolve(opt('--output',join(repoRoot,'work/quality-audit.json')));
    mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({...report,issues:undefined,qualityFlags:undefined,demand:undefined,output},null,2));
    process.exitCode = report.issues.length ? 1 : 0;
}
