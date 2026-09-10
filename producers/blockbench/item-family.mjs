// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadConfig,repoRoot} from '../../scripts/config.mjs';
import {sha256,containedPath} from '../../scripts/asset-files.mjs';
import {decodePNG} from '../raster/png.mjs';
import {auditPack} from '../../scripts/audit.mjs';
import {prepareModel} from '../model/semantics.mjs';
import {cdpEval} from './cdp.mjs';

export function spriteSpans({width,height,data}) {
    if(width!==16 || height!==16 || data.length!==1024)throw new Error('Initial family authoring requires a static 16×16 texture');
    const spans=[];
    for(let y=0;y<16;y++)for(let x=0;x<16;) {
        const alpha=data[(y*16+x)*4+3];if(alpha!==0&&alpha!==255)throw new Error('Partial alpha needs a dedicated model approach');
        if(!alpha){x++;continue;}
        const start=x;while(x<16 && data[(y*16+x)*4+3]===255)x++;
        spans.push({from:[start,15-y,7.5],to:[x,16-y,8.5],uv:{south:[start,y,x,y+1],north:[x,y,start,y+1],
            east:[x-1,y,x,y+1],west:[start,y,start+1,y+1],up:[start,y,x,y+1],down:[start,y,x,y+1]}});
    }
    if(!spans.length)throw new Error('Empty silhouette');return spans;
}
export function validateFamily(family) {
    if(family.schema!==1||family.codec!=='java_block'||!/^[a-z0-9-]+$/.test(family.id||''))throw new Error('Invalid family identity/codec');
    if(!Array.isArray(family.members)||!family.members.length||family.members.length>6)throw new Error('Initial families contain 1–6 items');
    for(const key of ['id','group','target','texture'])if(new Set(family.members.map(m=>m[key])).size!==family.members.length)throw new Error(`Duplicate family ${key}`);
    for(const member of family.members){
        if(!/^[a-z0-9_]+$/.test(member.group))throw new Error('Invalid export group');
        const [namespace,name]=member.id.split(':');
        if(!namespace||!name||member.target!==`assets/${namespace}/models/item/${name}.json`||member.texture!==`assets/${namespace}/textures/item/${name}.png`)throw new Error('Item identity must match export paths');
        for(const target of [member.target,member.texture,member.seed])containedPath(repoRoot,target);
    }
    if(!family.source?.endsWith('.bbmodel'))throw new Error('Family requires retained .bbmodel source');containedPath(repoRoot,family.source);
}
export function runtimeExpression(operation,payload) {
    return `(${async function(operation,payload){
        const runtime=window.AutomationRuntime;if(!runtime)throw new Error('Blockbench automation is unavailable');
        if(typeof Project==='object'&&Project)throw new Error('Use an isolated Blockbench window with no active project');
        let sequence=0,owned=null,revision,finished=false;
        const send=async(method,params={})=>{
            if(owned && (!Project || Project.uuid!==owned.uuid))throw new Error('Active project changed during family operation');
            const mutating=['add_group','add_cube','set_face_texture','set_uv'].includes(method);
            const response=await runtime.send({protocol_version:1,id:'family-'+Date.now()+'-'+(++sequence),method,params:{...params,...(mutating&&revision?{expected_revision:revision}:{})}});
            if(!response.ok || response.result?.ok===false || ['error','unavailable','too_large'].includes(response.result?.status))throw new Error(method+': '+JSON.stringify(response.error || response.result));
            if(response.result?.revision)revision=response.result.revision;
            return response.result;
        };
        try {
            await send('load_project',{codec:'project',name:payload.family.id,content:payload.source});owned=Project;
            const observation=await send('observe_project');revision=observation.revision;
            if(operation==='author')for(const member of payload.members){
                const group=(await send('add_group',{name:member.group,parent:'root'})).effects.created[0];
                for(const [i,span] of member.spans.entries()){
                    const cube=(await send('add_cube',{name:member.group+'_row_'+i,parent:group,from:span.from,to:span.to,snap:false})).effects.created[0];
                    await send('set_face_texture',{uuid:cube,texture:member.uuid});
                    for(const [face,uv] of Object.entries(span.uv))await send('set_uv',{uuid:cube,face,uv});
                }
            }
            const source=await send('export_model',{codec:'project',max_bytes:8*1024*1024});
            const models=await send('export_models',{codec:'java_block',groups:payload.family.members.map(m=>m.group),max_bytes:8*1024*1024});
            const textures=[];
            for(const texture of Texture.all){const exported=await send('export_texture',{uuid:texture.uuid,max_bytes:1024*1024});textures.push({...exported,folder:texture.folder,namespace:texture.namespace});}
            finished=true;return JSON.stringify({source:source.content,models:models.models,textures,version:Blockbench.version});
        } finally {
            // Only the project created by this operation is eligible for cleanup.
            // On failure retain it for diagnosis; never discard another active tab.
            if(finished && Project===owned)await owned.close(true);
        }
    }.toString()})(${JSON.stringify(operation)},${JSON.stringify(payload)})`;
}
export function exportFiles(family,result) {
    if(!Array.isArray(result.models)||result.models.length!==family.members.length)throw new Error('Incomplete model export');
    const files=new Map();
    for(const member of family.members){
        const matches=result.models.filter(m=>m.group===member.group);if(matches.length!==1)throw new Error(`Missing or duplicate group ${member.group}`);
        const model=prepareModel(JSON.parse(matches[0].content));if(!model.elements?.length)throw new Error(`Empty model ${member.group}`);
        files.set(member.target,Buffer.from(JSON.stringify(model,null,2)+'\n'));
        const textures=result.textures.filter(t=>t.name.replace(/\.png$/,'')===member.group);
        if(textures.length!==1 || textures[0].status!=='ok')throw new Error(`Missing texture ${member.group}`);
        files.set(member.texture,Buffer.from(textures[0].content,'base64'));
    }
    return files;
}
export async function runFamily(operation,familyPath,{port=loadConfig().cdpPort,output}={}) {
    const familyBytes=readFileSync(familyPath),family=JSON.parse(familyBytes);validateFamily(family);
    const sourcePath=containedPath(repoRoot,family.source);let source,members=[],seeds=[];
    if(operation==='author'){
        if(existsSync(sourcePath))throw new Error('Retained source already exists. Edit it in Blockbench; use export to preserve authored changes.');
        const textures=[];
        for(const member of family.members){
            const bytes=readFileSync(containedPath(repoRoot,member.seed)),pixels=decodePNG(bytes),uuid=randomUUID();
            members.push({...member,uuid,spans:spriteSpans(pixels)});seeds.push({path:member.seed,sha256:sha256(bytes)});
            textures.push({uuid,id:String(textures.length),name:member.group,folder:'item',namespace:member.id.split(':')[0],width:16,height:16,uv_width:16,uv_height:16,source:'data:image/png;base64,'+bytes.toString('base64')});
        }
        source=JSON.stringify({meta:{format_version:'5.0',model_format:'java_block',box_uv:false},name:family.id,credit:'Copyright (C) 2026 Jacob Repp; GPL-3.0-or-later',resolution:{width:16,height:16},elements:[],outliner:[],textures,display:family.display});
    } else if(operation==='export')source=readFileSync(sourcePath,'utf8');
    else throw new Error('Operation must be author or export');
    const result=JSON.parse(await cdpEval(runtimeExpression(operation,{family,source,members}),{port,timeoutMs:120000}));
    const files=exportFiles(family,result);
    if(operation==='author'){
        const saved=result.source+'\n';mkdirSync(dirname(sourcePath),{recursive:true});writeFileSync(sourcePath,saved,{flag:'wx'});source=saved;
        writeFileSync(join(dirname(sourcePath),'source-provenance.json'),JSON.stringify({schema:1,author:'Jacob Repp',license:'GPL-3.0-or-later',blockbenchVersion:result.version,source:family.source,initialSourceSha256:sha256(Buffer.from(saved)),seeds},null,2)+'\n');
    } else if(sha256(readFileSync(sourcePath))!==sha256(Buffer.from(source)))throw new Error('Source changed during export; refusing publication');
    const digest=sha256(Buffer.from(source));
    const exporterSha256=sha256(readFileSync(new URL(import.meta.url)));
    const exportId=sha256(Buffer.from(JSON.stringify([digest,sha256(familyBytes),result.version,exporterSha256]))).slice(0,16);
    const pack=resolve(output || join(repoRoot,'work/item-families',family.id,'exports',exportId));
    // New immutable candidate directory. Re-export verifies byte identity.
    const provenance={schema:1,producer:'content-forge',family:family.id,familySha256:sha256(familyBytes),source:family.source,sourceSha256:digest,blockbenchVersion:result.version,exporterSha256,targets:[]};
    for(const [target,bytes] of files){provenance.targets.push({target,producer:'blockbench',recipe:'item-family:'+family.id,source:family.source,source_sha256:digest,group:family.members.find(m=>m.target===target||m.texture===target).group,sha256:sha256(bytes)});}
    files.set('provenance.json',Buffer.from(JSON.stringify(provenance,null,2)+'\n'));
    if(existsSync(pack))for(const [target,bytes] of files){if(!readFileSync(containedPath(pack,target)).equals(bytes))throw new Error(`Export differs from retained candidate: ${target}`);}
    else {
        const pending=pack+'.candidate-'+process.pid;mkdirSync(pending,{recursive:true});
        for(const [target,bytes] of files){const path=containedPath(pending,target);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
        const audit=auditPack(pending);if(audit.issues.length)throw new Error('Candidate validation failed: '+JSON.stringify(audit.issues.slice(0,5)));
        mkdirSync(dirname(pack),{recursive:true});renameSync(pending,pack);
    }
    const cohort={schema:1,id:'items-'+family.id,title:family.title,description:family.approach,entries:family.members.map(m=>({id:m.id,kind:'item',focus:'Review silhouette, material identity, thickness, and inventory/held transforms.'}))};
    const cohortPath=join(repoRoot,'work/item-families',family.id,'cohort.json');mkdirSync(dirname(cohortPath),{recursive:true});writeFileSync(cohortPath,JSON.stringify(cohort,null,2)+'\n');
    const summary={schema:1,family:family.id,source:family.source,sourceSha256:digest,pack,cohort:cohortPath,models:family.members.length};
    writeFileSync(join(dirname(cohortPath),'latest.json'),JSON.stringify(summary,null,2)+'\n');return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
    const [operation,familyPath,...args]=process.argv.slice(2);if(!familyPath)throw new Error('Usage: item-family.mjs author|export FAMILY.json [--port N]');
    const i=args.indexOf('--port');console.log(JSON.stringify(await runFamily(operation,resolve(familyPath),i<0?{}:{port:Number(args[i+1])})));
}
