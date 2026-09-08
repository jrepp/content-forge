// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
// Optional live acceptance against a dedicated headless Chrome CDP endpoint.
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const port=Number(process.env.REVIEW_CDP_PORT || 9334),base=process.env.REVIEW_BASE_URL || 'http://127.0.0.1:8766';
const page=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(t=>t.type==='page'&&t.url.startsWith(base));
if(!page)throw new Error('No review page in the dedicated browser');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let sequence=0;const pending=new Map();
ws.onmessage=event=>{const response=JSON.parse(event.data);if(response.id&&pending.has(response.id)){const {resolve,reject,timer}=pending.get(response.id);clearTimeout(timer);pending.delete(response.id);response.error?reject(new Error(JSON.stringify(response.error))):resolve(response.result);}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value;};
try {
    await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1200,deviceScaleFactor:1,mobile:false});
    for(const name of ['survival-stone','survival-plants','items-ingots']) {
        await send('Page.navigate',{url:`${base}/${name}.html`});
        let ready=false;for(let i=0;i<100;i++){ready=await evaluate('document.body?.dataset.ready === "true"');if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready,name+' ready');
        const counts=await evaluate('({cards:document.querySelectorAll(".card").length,rendered:document.querySelectorAll(".card[data-rendered=true]").length,errors:[...document.querySelectorAll(".error")].map(e=>e.textContent)})');
        assert.equal(counts.cards,name==='items-ingots'?2:6);assert.equal(counts.rendered,counts.cards,JSON.stringify(counts.errors));
        const before=await evaluate('document.querySelector("canvas").toDataURL()');
        await evaluate('document.querySelector("#view").value="back";document.querySelector("#view").dispatchEvent(new Event("change"));');
        assert.notEqual(await evaluate('document.querySelector("canvas").toDataURL()'),before,'camera changes rendered pixels');
        await evaluate('document.querySelector("#view").value="iso";document.querySelector("#view").dispatchEvent(new Event("change"));document.querySelector(".swatch").click();');
        assert.equal(await evaluate('document.querySelector("dialog").open'),true);await evaluate('document.querySelector("dialog").close()');
        await evaluate('const state=document.querySelector(".decision select");state.value="needs-work";state.dispatchEvent(new Event("change"));');
        assert.equal(await evaluate('document.querySelector(".card").dataset.decision'),'needs-work');
        const notes=await evaluate(`(async()=>{let blob;const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{blob=b;return create(b);};HTMLAnchorElement.prototype.click=()=>{};try{document.querySelector('#export').click();return JSON.parse(await blob.text());}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}})()`);
        assert.equal(notes.entries[0].status,'needs-work');assert.ok(notes.renderer.bundleSha256);assert.ok(notes.entries.every(e=>e.snapshot && e.dependencies.length));
        if(name==='items-ingots')assert.equal(await evaluate('document.querySelectorAll("details a[download]").length'),2,'editable source download for both items');
        const stateChanged=await evaluate(`(()=>{const select=[...document.querySelectorAll('select.state')].find(s=>s.options.length>1);if(!select)return null;const canvas=select.closest('.card').querySelector('canvas'),before=canvas.toDataURL();select.selectedIndex=1;select.dispatchEvent(new Event('change'));const changed=before!==canvas.toDataURL();select.selectedIndex=0;select.dispatchEvent(new Event('change'));return changed;})()`);
        if(name!=='items-ingots')assert.equal(stateChanged,true,'block state changes rendered pixels');
        await evaluate('const decision=document.querySelector(".decision select");decision.value="unreviewed";decision.dispatchEvent(new Event("change"));');
        mkdirSync('work/reviews',{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join('work/reviews',name+'.png'),Buffer.from(shot.data,'base64'));
        console.log(`${name}: ${counts.cards} models rendered, camera / states / texture inspector / review export pass`);
    }
} finally {ws.close();}
