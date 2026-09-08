// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {sha256, containedPath} from '../asset-files.mjs';

export function resourceTarget(ref, kind) {
    if (typeof ref !== 'string' || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(ref) || ref.split('/').some(p=>p==='..'||p==='.')) throw new Error(`Invalid resource: ${ref}`);
    const [namespace,path] = ref.includes(':') ? ref.split(':') : ['minecraft',ref];
    return `assets/${namespace}/${kind}/${path}.${kind === 'textures' ? 'png' : 'json'}`;
}
export function matchesState(condition, properties) {
    if (!condition) return true;
    return Object.entries(condition).every(([key,value])=>{
        if (key === 'OR') return value.some(v=>matchesState(v,properties));
        if (key === 'AND') return value.every(v=>matchesState(v,properties));
        return String(value).split('|').includes(String(properties[key]));
    });
}
const variantProperties = key => Object.fromEntries(key ? key.split(',').map(pair=>pair.split('=')) : []);

export function resolveCohort(manifest, roots, {reviews={}, feedback=[]}={}) {
    if (manifest.schema !== 1 || !/^[a-z0-9-]+$/.test(manifest.id || '')) throw new Error('Cohort requires schema 1 and a lowercase id');
    if (!Array.isArray(manifest.entries) || manifest.entries.length < 1 || manifest.entries.length > 12) throw new Error('A cohort must contain 1–12 entries');
    if (new Set(manifest.entries.map(e=>e.id)).size !== manifest.entries.length) throw new Error('Duplicate cohort entry');
    const provenance=roots.map(root=>existsSync(join(root,'provenance.json'))?JSON.parse(readFileSync(join(root,'provenance.json'),'utf8')):{targets:[]});
    const entries = manifest.entries.map(spec=>{
        const dependencies = new Map(), textures = new Map(), issues = [], warnings = [];
        const read = (target, optional=false) => {
            for (let i=roots.length-1;i>=0;i--) {
                const path=containedPath(roots[i],target);
                if (!existsSync(path)) continue;
                const bytes=readFileSync(path);
                if (bytes.length > 8*1024*1024) throw new Error(`Asset exceeds 8 MiB: ${target}`);
                dependencies.set(target,{target,sha256:sha256(bytes),layer:i});
                if (dependencies.size > 256) throw new Error('Asset exceeds 256 dependencies');
                return bytes;
            }
            if (!optional) throw new Error(`Missing ${target}`);
            return null;
        };
        const json = target => JSON.parse(read(target).toString('utf8'));
        const inherit = (ref, seen=[]) => {
            if (seen.includes(ref) || seen.length >= 32) throw new Error(`Model parent cycle or depth: ${ref}`);
            if (['builtin/generated','minecraft:builtin/generated'].includes(ref)) return {builtin:'generated'};
            if (['builtin/entity','minecraft:builtin/entity'].includes(ref)) throw new Error('Special entity rendering requires a Minosoft capture');
            const model=json(resourceTarget(ref,'models'));
            const base=model.parent ? inherit(model.parent,[...seen,ref]) : {};
            return {...base,...model,textures:{...base.textures,...model.textures},display:{...base.display,...model.display}};
        };
        const loadTexture = ref => {
            const target=resourceTarget(ref,'textures');
            if (textures.has(target)) return target;
            const bytes=read(target);
            if (bytes.length<33 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw new Error(`Invalid PNG: ${target}`);
            const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
            if (!width || !height || width*height > 4194304) throw new Error(`Invalid or oversized texture: ${target}`);
            if (read(target+'.mcmeta',true)) warnings.push(`Animated texture shown as a static image: ${ref}`);
            textures.set(target,{target,width,height,sha256:sha256(bytes),data:'data:image/png;base64,'+bytes.toString('base64')});
            return target;
        };
        const resolveModel = apply => {
            const model=inherit(apply.model);
            if (apply.uvlock && (apply.x || apply.y)) throw new Error('Rotated UV-locked model requires a Minosoft capture');
            if (model.overrides?.length) warnings.push('Item predicates are not evaluated in this studio preview');
            const bind = ref => {
                const seen=new Set();
                while (typeof ref==='string' && ref.startsWith('#')) {
                    if (seen.has(ref)) throw new Error(`Texture alias cycle: ${ref}`);
                    seen.add(ref);ref=model.textures[ref.slice(1)];
                }
                if (!ref) throw new Error(`Unbound texture in ${apply.model}`);
                return loadTexture(ref);
            };
            if (!Array.isArray(model.elements) && model.builtin !== 'generated') {
                if (model.elements === undefined) return {...apply,elements:[],display:model.display};
                throw new Error('Invalid model elements');
            }
            if ((model.elements?.length || 0)>512) throw new Error('Model exceeds 512 elements');
            const elements=(model.elements || []).map(el=>{
                for (const xyz of [el.from,el.to,el.rotation?.origin || [0,0,0]]) if (!Array.isArray(xyz)||xyz.length!==3||xyz.some(n=>!Number.isFinite(n)||Math.abs(n)>1024)) throw new Error('Invalid model coordinates');
                if (el.rotation && (!['x','y','z'].includes(el.rotation.axis)||![-45,-22.5,0,22.5,45].includes(el.rotation.angle))) throw new Error('Unsupported element rotation');
                const faces=Object.fromEntries(Object.entries(el.faces || {}).map(([direction,face])=>{
                    if (!['north','south','east','west','up','down'].includes(direction)) throw new Error(`Invalid face ${direction}`);
                    if (face.uv && (!Array.isArray(face.uv)||face.uv.length!==4||face.uv.some(v=>!Number.isFinite(v)))) throw new Error('Invalid UV');
                    if (face.rotation && ![90,180,270].includes(face.rotation)) throw new Error('Invalid face rotation');
                    if (face.tintindex !== undefined) warnings.push('Biome/item tint requires an in-game check');
                    return [direction,{...face,texture:bind(face.texture)}];
                }));
                return {...el,faces};
            });
            const layers=model.builtin==='generated' ? Object.keys(model.textures).filter(k=>/^layer\d+$/.test(k)).sort().map(k=>bind(model.textures[k])) : [];
            if (layers.length) warnings.push('Generated item preview is flat; edge extrusion needs an in-game check');
            return {...apply,elements,layers,display:model.display};
        };
        let views=[];
        const modelSet=(apply,label)=>{
            const alternatives=Array.isArray(apply)?apply:[apply];
            return alternatives.map((a,i)=>({label:label+(alternatives.length>1?` · alternative ${i+1}`:''),models:[resolveModel(a)]}));
        };
        try {
            if (!['block','item','texture'].includes(spec.kind)) throw new Error(`Unsupported review kind: ${spec.kind}`);
            if (spec.kind==='texture') loadTexture(spec.id);
            else if (spec.kind==='item') views=modelSet({model:spec.model || spec.id.replace(':',':item/')},'Item');
            else {
                const state=json(resourceTarget(spec.id,'blockstates'));
                if (state.variants) {
                    if (spec.states) {
                        for (const requested of spec.states) {
                            const matches=Object.entries(state.variants).filter(([key])=>matchesState(variantProperties(key),requested.properties));
                            if (matches.length!==1) throw new Error(`Expected one model variant for ${requested.label}, found ${matches.length}`);
                            views.push(...modelSet(matches[0][1],requested.label));
                        }
                    } else for (const [key,apply] of Object.entries(state.variants)) views.push(...modelSet(apply,key || 'Default'));
                } else if (state.multipart) {
                    if (!spec.states?.length) throw new Error('Multipart review requires explicit state properties in the cohort');
                    for (const requested of spec.states) {
                        const applies=state.multipart.filter(p=>matchesState(p.when,requested.properties)).map(p=>p.apply);
                        if (!applies.length) throw new Error(`No parts for ${requested.label}`);
                        if (applies.some(Array.isArray)) throw new Error('Multipart random alternatives require an in-game capture');
                        views.push({label:requested.label,models:applies.map(resolveModel)});
                    }
                } else throw new Error('Blockstate has neither variants nor multipart');
            }
            if (views.length>32) throw new Error('More than 32 views; select explicit states for this cohort');
        } catch(error) {issues.push(error.message);views=[];}
        const deps=[...dependencies.values()].sort((a,b)=>a.target.localeCompare(b.target));
        const currentReviews=deps.filter(d=>reviews[d.target]?.status==='approved' && reviews[d.target].sha256===d.sha256).length;
        const activeFeedback=feedback.filter(f=>['open','candidate'].includes(f.state)&&f.targets?.some(t=>dependencies.has(t.target))).map(f=>({id:f.id,note:f.feedback?.note || ''}));
        const sources=[...new Map(deps.flatMap(d=>{const p=provenance[d.layer].targets?.find(t=>t.target===d.target);return p?.source ? [{source:p.source,sha256:p.source_sha256,group:p.group}] : [];}).map(s=>[s.source+':'+s.group,s])).values()];
        const snapshot=sha256(Buffer.from(JSON.stringify({spec,dependencies:deps,sources})));
        return {id:spec.id,name:spec.name || spec.id.split(':').at(-1).replaceAll('_',' '),kind:spec.kind,
            snapshot,sources,views,textures:[...textures.values()],dependencies:deps,issues,warnings:[...new Set(warnings)],activeFeedback,
            reviewSummary:`${currentReviews}/${deps.length} dependencies have current recorded approval`,focus:spec.focus || ''};
    });
    return {schema:1,id:manifest.id,title:manifest.title || manifest.id,description:manifest.description || '',
        snapshot:sha256(Buffer.from(JSON.stringify(entries.map(e=>e.snapshot)))),entries};
}
