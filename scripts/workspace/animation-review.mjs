// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import {mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, renameSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {repoRoot} from '../config.mjs';
import {sha256} from '../asset-files.mjs';
import {WorkspaceStore} from './store.mjs';
import {WorkspaceSessions} from './sessions.mjs';
import {readEditorBuild} from './editor-build.mjs';
import {createWorkspaceServer} from './server.mjs';
import {launchChrome, until} from './chrome.mjs';
import {capabilities} from './families.mjs';
import {decodePNG, encodeAPNG} from '../../producers/raster/png.mjs';

export const reviewSettings = {
    width: 384, height: 384, fps: 12, maxSeconds: 10,
    camera: {projection: 'perspective', position: [80, 55, 110], target: [2, 19, 0], fov: 36},
};
const escapeHTML = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

export async function renderAnimationReview(store, {familyId = 'wizard', revision = store.head(familyId), editor = readEditorBuild(), output = join(repoRoot, 'work/reviews/animations'), onProgress = console.log} = {}) {
    const saved = store.revision(familyId, revision);
    const inputs = ['animation-review.mjs', 'animation-render.js', 'chrome.mjs', 'families.mjs', '../../producers/raster/png.mjs'].map(path => ({path, sha256: sha256(readFileSync(new URL(path, import.meta.url)))}));
    const rendererScript = readFileSync(new URL('./animation-render.js', import.meta.url));
    if (!capabilities(saved.family).animationReview) throw new Error('This family does not support animation review');
    const animations = JSON.parse(saved.source).animations;
    if (!Array.isArray(animations) || !animations.length || animations.length > 20 || animations.some(a => !Number.isFinite(a.length) || a.length <= 0 || a.length > reviewSettings.maxSeconds)) {
        throw new Error('Review requires 1–20 animations with lengths greater than zero and at most 10 seconds');
    }
    const temporary = mkdtempSync(join(tmpdir(), 'forge-animation-review-'));
    // Authentication and browser drafts live only in this disposable workspace.
    const renderStore = new WorkspaceStore({repoRoot: store.repoRoot, path: join(temporary, 'workspace.sqlite')});
    const sessions = new WorkspaceSessions(renderStore, editor);
    const login = sessions.login(sessions.invite({name: 'Animation renderer', role: 'author'}).token);
    const server = createWorkspaceServer(renderStore, {editor, authenticated: true});
    let chrome;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        chrome = await launchChrome(join(temporary, 'chrome'), base);
        const page = await chrome.page(p => p.url === base + '/');
        await page.send('Network.setCookie', {name: 'forge_login', value: login.secret, url: base, httpOnly: true, sameSite: 'Strict'});
        await page.send('Page.navigate', {url: `${base}/editor/${editor.id}/index.html`});
        await until(() => page.evaluate('typeof AutomationRuntime !== "undefined" && !!window.MediaPreview'), 'Blockbench renderer');
        const loaded = await page.evaluate(`AutomationRuntime.send({protocol_version:1,id:crypto.randomUUID(),method:'load_project',params:{codec:'project',name:${JSON.stringify(familyId)},content:${JSON.stringify(saved.source.toString())}}})`);
        if (!loaded.ok) throw new Error(JSON.stringify(loaded));
        await until(() => page.evaluate('Texture.all.every(t => t.img.complete && t.img.naturalWidth > 0 && !t.error)'), 'embedded textures');
        await page.evaluate(rendererScript.toString());
        const environment = await page.evaluate(`ForgeAnimationRender.setup(${JSON.stringify(reviewSettings)})`);
        if (environment.animations.length !== animations.length) throw new Error('Editor lost source animations');
        const files = new Map(), clips = [];
        for (const [index, animation] of environment.animations.entries()) {
            const count = Math.ceil(animation.length * reviewSettings.fps), frames = [], hashes = [];
            const name = `${String(index + 1).padStart(2, '0')}-${animation.name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60)}`;
            onProgress(`Rendering ${animation.name}: ${count} frames`);
            for (let frame = 0; frame < count; frame++) {
                const url = await page.evaluate(`ForgeAnimationRender.frame(${JSON.stringify(animation.uuid)}, ${frame / reviewSettings.fps})`);
                const png = Buffer.from(url.split(',')[1], 'base64'), decoded = decodePNG(png);
                if (decoded.width !== reviewSettings.width || decoded.height !== reviewSettings.height) throw new Error('Unexpected rendered frame dimensions');
                frames.push(decoded.data); hashes.push(sha256(decoded.data));
                if (frame === 0) files.set(`${name}-poster.png`, png);
            }
            files.set(`${name}.png`, encodeAPNG(reviewSettings.width, reviewSettings.height, frames, reviewSettings.fps));
            clips.push({...animation, frames: count, duration: count / reviewSettings.fps, path: `${name}.png`, poster: `${name}-poster.png`, frameSha256: hashes});
        }
        const manifest = {schema: 1, kind: 'blockbench-animation-review', familyId, revision, sourceSha256: saved.record.source.sha256,
            familySha256: saved.record.familySha256, provenanceSha256: saved.record.provenanceSha256, sourceRevision: saved.record, editorBuild: editor.id, generatorInputs: inputs,
            settings: reviewSettings, environment: {...environment, node: process.version, zlib: process.versions.zlib, platform: process.platform, arch: process.arch}, clips,
            limitations: ['Blockbench preview; consumer rendering and artistic approval are pending.', 'Texture flipbooks use editor frame stepping; interpolation is not simulated.']};
        files.set('source.bbmodel', saved.source);
        files.set('family.json', saved.familyBytes);
        files.set('provenance.json', saved.provenance);
        files.set('index.html', Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHTML(saved.family.title)} animation review</title><link rel="stylesheet" href="review.css"><h1>${escapeHTML(saved.family.title)}</h1><p>Saved source ${escapeHTML(revision)} · Blockbench preview · consumer validation and artistic approval pending.</p><p><a href="source.bbmodel">Editable source</a> · <a href="manifest.json">Build manifest</a></p><p>${manifest.limitations.map(escapeHTML).join(' ')}</p><main>${clips.map(clip => `<figure><a href="${clip.path}"><img src="${clip.path}" width="384" height="384" alt="${escapeHTML(clip.name)} animation"></a><figcaption>${escapeHTML(clip.name)} · ${clip.frames} frames · ${clip.duration}s · <a href="${clip.poster}">Static poster</a></figcaption></figure>`).join('')}</main></html>`));
        files.set('review.css', Buffer.from('body{background:#222831;color:#eee;font:16px system-ui;margin:2rem}a{color:#a9d6ff}p{overflow-wrap:anywhere}main{display:flex;flex-wrap:wrap}figure{margin:1rem}img{max-width:100%;height:auto;background:#333b48}figcaption{margin-top:.5rem}'));
        manifest.files = [...files].map(([path, bytes]) => ({path, sha256: sha256(bytes), bytes: bytes.length}));
        const id = sha256(Buffer.from(JSON.stringify(manifest)));
        const record = {id, ...manifest};
        store.recordAnimationReview(record, files);
        files.set('manifest.json', Buffer.from(JSON.stringify(record, null, 2) + '\n'));
        mkdirSync(output, {recursive: true});
        const target = join(output, id), staging = mkdtempSync(join(output, '.render-'));
        try {
            for (const [path, bytes] of files) writeFileSync(join(staging, path), bytes);
            if (existsSync(target)) {
                for (const [path, bytes] of files) if (!readFileSync(join(target, path)).equals(bytes)) throw new Error('Existing review artifact changed');
            } else renameSync(staging, target);
        } finally { rmSync(staging, {recursive: true, force: true}); }
        return {id, path: target, manifest};
    } finally {
        if (chrome) await chrome.close();
        await new Promise(resolve => server.close(resolve)); renderStore.close();
        rmSync(temporary, {recursive: true, force: true});
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
        if (!['--family', '--revision', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: workspace:animation-review -- [--family wizard] [--revision ID] [--output DIRECTORY]');
        options[{'--family':'familyId', '--revision':'revision', '--output':'output'}[args[i]]] = args[i + 1];
    }
    const store = new WorkspaceStore({repoRoot});
    try { const result = await renderAnimationReview(store, options); console.log(JSON.stringify({id: result.id, path: result.path}, null, 2)); }
    finally { store.close(); }
}
