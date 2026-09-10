// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256} from '../scripts/asset-files.mjs';
import {bundleReviews} from '../scripts/hosting-bundle.mjs';

function setup(t){
    const root=mkdtempSync(join(tmpdir(),'forge-bundle-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
    const input=join(root,'input'),output=join(root,'output'),sitePath=join(root,'site.json');mkdirSync(input);
    const html=Buffer.from('<html>review</html>');
    writeFileSync(sitePath,JSON.stringify({schema:1,title:'Review',sheets:['example']}));
    writeFileSync(join(input,'example.html'),html);
    writeFileSync(join(input,'example.json'),JSON.stringify({schema:1,id:'example',title:'Example',snapshot:'1'.repeat(64),sheetSha256:sha256(html),entries:[{id:'item'}]}));
    return {root,input,output,sitePath};
}
test('hosting bundle is deterministic and includes only selected review evidence',t=>{
    const paths=setup(t);writeFileSync(join(paths.input,'private.json'),'do not publish');
    const first=bundleReviews(paths),second=bundleReviews(paths);
    assert.equal(first.sha256,second.sha256);assert.equal(first.approval,'candidate');
    const listing=execFileSync('tar',['-tzf',first.artifact],{encoding:'utf8'}).trim().split('\n');
    assert.deepEqual(listing,['bundle.json','example.html','example.json','index.html']);
});
test('mismatched sheet bytes refuse publication and preserve the last bundle',t=>{
    const paths=setup(t),first=bundleReviews(paths),bytes=readFileSync(first.artifact);
    writeFileSync(join(paths.input,'example.html'),'changed');
    assert.throws(()=>bundleReviews(paths),/evidence mismatch/);
    assert.deepEqual(readFileSync(first.artifact),bytes);
});
test('a selected symlink cannot package a file outside the review root',t=>{
    const paths=setup(t),outside=join(paths.root,'private.html');writeFileSync(outside,'secret');
    rmSync(join(paths.input,'example.html'));symlinkSync(outside,join(paths.input,'example.html'));
    assert.throws(()=>bundleReviews(paths),/escapes root/);
});
