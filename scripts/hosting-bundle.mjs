// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,renameSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha256} from './asset-files.mjs';
import {repoRoot} from './config.mjs';

const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

/** Package an explicit, byte-verified review set. This grants no art approval. */
export function bundleReviews({sitePath=join(repoRoot,'review/site.json'), input=join(repoRoot,'work/reviews'), output=join(repoRoot,'work/hosting')}={}) {
    const site=JSON.parse(readFileSync(sitePath,'utf8'));
    if(site.schema!==1 || typeof site.title!=='string' || !Array.isArray(site.sheets) || !site.sheets.length || site.sheets.length>12 || new Set(site.sheets).size!==site.sheets.length) throw new Error('Invalid bounded review site');
    const files=new Map(),sheets=[],root=realpathSync(input);
    const read=name=>{
        const path=realpathSync(join(root,name)),rel=relative(root,path);
        if(!rel || rel.startsWith('../') || isAbsolute(rel))throw new Error(`Review input escapes root: ${name}`);
        return readFileSync(path);
    };
    for(const id of site.sheets){
        if(typeof id!=='string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw new Error('Invalid sheet id');
        const html=read(id+'.html'),metadata=read(id+'.json'),evidence=JSON.parse(metadata);
        if(evidence.schema!==1 || evidence.id!==id || evidence.sheetSha256!==sha256(html) || !/^[0-9a-f]{64}$/.test(evidence.snapshot))throw new Error(`Sheet evidence mismatch: ${id}`);
        if(!Array.isArray(evidence.entries) || !evidence.entries.length || evidence.entries.length>12)throw new Error(`Invalid cohort: ${id}`);
        files.set(id+'.html',html);files.set(id+'.json',metadata);
        sheets.push({id,title:evidence.title || id,entries:evidence.entries.length,snapshot:evidence.snapshot,sheetSha256:evidence.sheetSha256});
    }
    const index=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(site.title)}</title><style>body{max-width:70rem;margin:3rem auto;padding:0 1.5rem;background:#171c21;color:#ebede8;font:18px/1.6 system-ui}a{color:#a7deaa}li{margin:1.5rem 0}small{display:block;color:#b8c2c9}</style><h1>${escape(site.title)}</h1><p>Small sets of candidate models and textures. Open a set, inspect its views, and export your review notes. These candidates have not been approved for game release.</p><ul>${sheets.map(s=>`<li><a href="${s.id}.html">${escape(s.title)}</a><small>${s.entries} entries &middot; <a href="${s.id}.json">Snapshot evidence</a></small></li>`).join('')}</ul><p>Notes remain in your browser until exported. Studio views still need matched in-game validation.</p></html>\n`;
    files.set('index.html',Buffer.from(index));
    const manifest={schema:1,kind:'content-forge-review-site',approval:'candidate',sheets,files:[...files].map(([path,bytes])=>({path,sha256:sha256(bytes),bytes:bytes.length}))};
    files.set('bundle.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
    mkdirSync(output,{recursive:true});
    const stage=mkdtempSync(join(tmpdir(),'content-forge-site-'));
    const pending=join(resolve(output),`.review-site-${process.pid}.tar.gz`);
    try {
        for(const [path,bytes] of files)writeFileSync(join(stage,path),bytes);
        // Python's standard archive library normalizes metadata on macOS/Linux.
        // Only the explicit staged files are included; no repository traversal.
        execFileSync('python3',['-c',`
import gzip, io, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
with open(sys.argv[2], 'wb') as raw:
    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for path in sorted(root.iterdir()):
                data = path.read_bytes()
                entry = tarfile.TarInfo(path.name)
                entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
                archive.addfile(entry, io.BytesIO(data))
`,stage,pending],{stdio:'pipe'});
        const bytes=readFileSync(pending),artifact=join(resolve(output),'review-site.tar.gz');
        renameSync(pending,artifact);
        const result={schema:1,artifact,sha256:sha256(bytes),bytes:bytes.length,sheets:sheets.length,entries:sheets.reduce((n,s)=>n+s.entries,0),approval:'candidate'};
        writeFileSync(join(output,'bundle-receipt.json'),JSON.stringify(result,null,2)+'\n');
        return result;
    } finally {rmSync(stage,{recursive:true,force:true});rmSync(pending,{force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(bundleReviews(),null,2));
