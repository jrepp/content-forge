// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig,repoRoot} from './config.mjs';
import {resolveCohort} from './review/resolve.mjs';
import {sha256,containedPath} from './asset-files.mjs';

export async function buildSheet({cohortPath,roots,output,config=loadConfig()}) {
    const manifest=JSON.parse(readFileSync(cohortPath,'utf8'));
    const reviews=JSON.parse(readFileSync(join(repoRoot,'db/reviews.json'),'utf8'));
    const feedback=JSON.parse(readFileSync(join(repoRoot,'db/visual-feedback.json'),'utf8')).entries;
    const cohort=resolveCohort(manifest,roots,{reviews,feedback});
    for(const entry of cohort.entries)for(const source of entry.sources){
        try {const bytes=readFileSync(containedPath(repoRoot,source.source));if(sha256(bytes)!==source.sha256)throw new Error('Source hash changed');source.data='data:application/json;base64,'+bytes.toString('base64');}
        catch(error){entry.issues.push(`Source unavailable: ${source.source}: ${error.message}`);}
    }
    const esbuild=await import(pathToFileURL(join(config.producerRoot,'node_modules/esbuild/lib/main.js')).href);
    const build=await esbuild.build({entryPoints:[join(repoRoot,'scripts/review/viewer.mjs')],bundle:true,write:false,minify:true,format:'iife',
        alias:{three:join(config.producerRoot,'node_modules/three/build/three.module.js')},legalComments:'inline'});
    const script=build.outputFiles[0].text.replaceAll('</script','<\\/script');
    const license=readFileSync(join(config.producerRoot,'node_modules/three/LICENSE'),'utf8');
    const threePackage=JSON.parse(readFileSync(join(config.producerRoot,'node_modules/three/package.json'),'utf8'));
    cohort.renderer={name:'content-forge studio',threeVersion:threePackage.version,bundleSha256:sha256(Buffer.from(script)),scope:'Geometry/texture inspection; not Minosoft rendering acceptance'};
    const data=JSON.stringify(cohort).replaceAll('<','\\u003c');
    const style=readFileSync(join(repoRoot,'scripts/review/sheet.css'),'utf8');
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Content review · ${manifest.id}</title><style>${style}</style></head><body>
<header><div class="eyebrow">CONTENT FORGE / COHORT REVIEW</div><h1 id="title"></h1><p id="description"></p><div class="toolbar"><span id="count"></span><label>View <select id="view"><option value="iso">Isometric</option><option value="front">Front</option><option value="back">Back</option><option value="side">Side</option><option value="top">Top</option></select></label><label>Display <select id="display"><option value="studio">Studio</option><option value="gui">Inventory transform</option><option value="firstperson_righthand">First person transform</option><option value="thirdperson_righthand">Third person transform</option></select></label><button id="export">Export review notes</button></div></header>
<p class="instructions">Drag a model to rotate. Select its state. Click a texture to inspect pixels and tiling. Studio previews need a separate in-game check.</p><main id="cards"></main><footer>Review notes do not grant release approval. Embedded assets preserve the reviewed snapshot.<details><summary>Renderer license</summary><pre>${license.replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre></details></footer>
<dialog><button aria-label="Close texture inspector">Close</button><div class="texture-detail"></div></dialog><script id="cohort-data" type="application/json">${data}</script><script>${script}</script></body></html>`;
    mkdirSync(dirname(output),{recursive:true});writeFileSync(output,html);
    const evidence={...cohort,sheetSha256:sha256(Buffer.from(html)),entries:cohort.entries.map(e=>({...e,sources:e.sources.map(({data,...s})=>s),textures:e.textures.map(({data,...t})=>t)}))};
    writeFileSync(output.replace(/\.html$/,'.json'),JSON.stringify(evidence,null,2)+'\n');
    return {output,entries:cohort.entries.length,issues:cohort.entries.filter(e=>e.issues.length).length,snapshot:cohort.snapshot};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
    const args=process.argv.slice(2),config=loadConfig();
    const opt=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
    const familyId=opt('--family',null);
    if(familyId && !/^[a-z0-9-]+$/.test(familyId))throw new Error('Invalid family id');
    const latest=familyId?JSON.parse(readFileSync(join(repoRoot,'work/item-families',familyId,'latest.json'),'utf8')):null;
    const cohortPath=resolve(opt('--cohort',latest?.cohort || 'review/cohorts/survival-stone.json'));
    const roots=[];for(let i=0;i<args.length;i++)if(args[i]==='--pack')roots.push(resolve(args[++i]));
    if(!roots.length){if(latest)roots.push(latest.pack);else roots.push(config.outDir,join(dirname(config.outDir),'out-survival'));}
    const id=JSON.parse(readFileSync(cohortPath,'utf8')).id;
    const output=resolve(opt('--out',`work/reviews/${id}.html`));
    if(!output.endsWith('.html'))throw new Error('--out must end in .html');
    console.log(JSON.stringify(await buildSheet({cohortPath,roots,output,config})));
}
