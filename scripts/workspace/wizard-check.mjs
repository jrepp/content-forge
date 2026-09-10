// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {repoRoot} from '../config.mjs';
import {WorkspaceStore} from './store.mjs';
import {WorkspaceSessions} from './sessions.mjs';
import {readEditorBuild} from './editor-build.mjs';
import {createWorkspaceServer} from './server.mjs';
import {launchChrome, until} from './chrome.mjs';
import {renderAnimationReview} from './animation-review.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'forge-wizard-check-'));
const store = new WorkspaceStore({repoRoot, path: join(temporary, 'workspace.sqlite')});
const editor = readEditorBuild(), sessions = new WorkspaceSessions(store, editor);
const server = createWorkspaceServer(store, {editor, authenticated: true});
let chrome;
try {
    store.initialize({author: 'Wizard acceptance'});
    const baseRevision = store.head('wizard'), original = store.revision('wizard', baseRevision).source;
    const login = sessions.login(sessions.invite({name: 'Wizard acceptance', role: 'author'}).token);
    const session = sessions.launch(login.person, 'wizard', baseRevision);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    chrome = await launchChrome(join(temporary, 'chrome'), base);
    const page = await chrome.page(p => p.url === base + '/');
    await page.send('Network.setCookie', {name: 'forge_login', value: login.secret, url: base, httpOnly: true, sameSite: 'Strict'});
    await page.send('Page.navigate', {url: base + session.url});
    await until(() => page.evaluate('!!window.ForgeWorkspace'), 'wizard editor');
    assert.equal(await page.evaluate('Format.id'), 'free');
    assert.equal(await page.evaluate(`[...document.querySelectorAll('#forge-workspace-toolbar button')].find(b=>b.textContent==='Build review candidate').hidden`), true);
    const edit = await page.evaluate(`AutomationRuntime.send({protocol_version:1,id:crypto.randomUUID(),method:'set_node_transform',params:{uuid:Cube.all[0].uuid,to:[...Cube.all[0].to.slice(0,2),Cube.all[0].to[2]+1],snap:false}})`);
    assert.equal(edit.ok, true, JSON.stringify(edit));
    await page.evaluate(`[...document.querySelectorAll('#forge-workspace-toolbar button')].find(b=>b.textContent==='Save to content-forge').click()`);
    await until(() => page.evaluate('ForgeWorkspace.state.status.startsWith("Saved ")'), 'wizard source save');
    const revision = store.head('wizard'), saved = JSON.parse(store.revision('wizard', revision).source), expected = JSON.parse(original);
    mkdirSync(join(repoRoot, 'work/reviews'), {recursive: true});
    writeFileSync(join(repoRoot, 'work/reviews/wizard-saved-check.bbmodel'), JSON.stringify(saved, null, 2));
    assert.notEqual(revision, baseRevision);
    // Source-semantic retention is checked independently of editor UI counts.
    // Loading and editing may change selection, which is editor UI state.
    expected.animations.forEach((a, i) => { a.selected = saved.animations[i].selected; });
    expected.groups.forEach((g, i) => { g.primary_selected = saved.groups[i].primary_selected; });
    expected.elements[0].to[2] += 1;
    assert.deepEqual(saved, expected);
    const origin = await page.evaluate('performance.timeOrigin');
    await page.send('Page.reload');
    await until(() => page.evaluate(`performance.timeOrigin !== ${origin} && !!window.ForgeWorkspace`), 'wizard reopen');
    assert.equal(await page.evaluate('ForgeWorkspace.state.revision'), revision);
    assert.equal(await page.evaluate('Cube.all[0].to[2]'), expected.elements[0].to[2]);
    assert.equal(await page.evaluate('Animation.all.length'), 5);
    const review = await renderAnimationReview(store, {revision, editor});
    const repeated = await renderAnimationReview(store, {revision, editor});
    assert.equal(repeated.id, review.id, 'same pinned environment reproduces exact review bytes');
    assert.deepEqual(store.animationReviewFile(review.id, 'source.bbmodel'), store.revision('wizard', revision).source);
    assert.equal(store.catalog().find(f => f.id === 'wizard').animationReview.status, 'current');
    // Chrome independently decodes every APNG frame and verifies its timing.
    for (const clip of review.manifest.clips) {
        const decoded = await page.evaluate(`(async()=>{
            const data = await fetch('/api/animation-reviews/${review.id}/${clip.path}').then(r=>r.arrayBuffer());
            const decoder = new ImageDecoder({data, type:'image/png'}); await decoder.tracks.ready;
            const durations=[];for(let i=0;i<decoder.tracks.selectedTrack.frameCount;i++) {const {image}=await decoder.decode({frameIndex:i});durations.push(image.duration);image.close();}
            const count=decoder.tracks.selectedTrack.frameCount;decoder.close();return {count,durations};
        })()`);
        assert.equal(decoded.count, clip.frames);
        // Chrome rounds PNG rational delays to milliseconds.
        assert.ok(decoded.durations.every(duration => Math.abs(duration - 1e6 / review.manifest.settings.fps) < 1000), JSON.stringify(decoded));
        assert.ok(new Set(clip.frameSha256).size > 1, `${clip.name} must animate`);
    }
    await page.send('Page.navigate', {url: `${base}/api/animation-reviews/${review.id}/index.html`});
    await until(() => page.evaluate('document.images.length === 5 && [...document.images].every(i => i.complete && i.naturalWidth === 384)'), 'review sheet');
    const screenshot = await page.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});
    writeFileSync(join(repoRoot, 'work/reviews/wizard-animation-review.png'), Buffer.from(screenshot.data, 'base64'));
    writeFileSync(join(repoRoot, 'work/reviews/wizard-check.json'), JSON.stringify({schema: 1, editorBuild: editor.id, baseRevision, savedRevision: revision, review: review.id, clips: review.manifest.clips.map(c => ({name: c.name, frames: c.frames})), checks: ['rig, animations and texture settings retained', 'edit/save/reopen', 'repeat render identical', 'Chrome APNG decode and timing', 'review sheet']}, null, 2));
    console.log(`Wizard acceptance passed: ${review.path}`);
} finally {
    if (chrome) await chrome.close();
    await new Promise(resolve => server.close(resolve)); store.close();
    rmSync(temporary, {recursive: true, force: true});
}
