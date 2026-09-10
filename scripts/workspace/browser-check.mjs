// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {repoRoot} from '../config.mjs';
import {WorkspaceStore} from './store.mjs';
import {createWorkspaceServer} from './server.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'forge-workspace-browser-'));
const store = new WorkspaceStore({repoRoot, path: join(temporary, 'workspace.sqlite')});
const server = createWorkspaceServer(store);
let browser, browserExit, ws;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
    for (let i = 0; i < 100; i++) { const result = await check(); if (result) return result; await delay(100); }
    throw new Error(`Timed out: ${label}`);
}
try {
    store.initialize({author: 'Browser check'});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const profile = join(temporary, 'chrome');
    let launchError;
    browser = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, base], {stdio: 'ignore'});
    browserExit = new Promise(resolve => { browser.once('exit', resolve); browser.once('error', error => { launchError = error; resolve(); }); });
    await until(() => { if (launchError) throw launchError; return existsSync(join(profile, 'DevToolsActivePort')); }, 'Chrome launch');
    const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    const page = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(p => p.type === 'page'), 'browser page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0; const pending = new Map();
    ws.onmessage = event => {
        const response = JSON.parse(event.data), request = pending.get(response.id);
        if (!request) return;
        clearTimeout(request.timer); pending.delete(response.id);
        response.error ? request.reject(new Error(JSON.stringify(response.error))) : request.resolve(response.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
        pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, method, params}));
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    };
    await until(() => evaluate('document.querySelectorAll("article").length > 0'), 'catalog rendered');
    assert.match(await evaluate('document.body.textContent'), /Iron and gold ingots/);
    const initial = store.head('ingots'), original = store.revision('ingots', initial).source;
    const model = JSON.parse(original); model.elements[0].to[2] += 1;
    const edited = Buffer.from(JSON.stringify(model));
    const upload = async bytes => {
        await evaluate(`(() => {
            document.querySelector('details').open = true;
            const author = document.querySelector('input:not([type=file])'); author.value = 'Browser author'; author.dispatchEvent(new Event('input'));
            const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0))], 'ingots.bbmodel', {type:'application/json'}));
            const input = document.querySelector('input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change'));
        })()`);
    };
    await upload(edited);
    const competing = store.save({familyId: 'ingots', expectedRevision: initial, source: original, author: 'Other author', requestId: randomUUID()});
    await evaluate("document.querySelector('form').requestSubmit()");
    await until(() => evaluate('document.querySelector("#loading").textContent.includes("Another save arrived first")'), 'conflict notice');
    assert.equal(store.head('ingots'), competing.revision);
    assert.equal(store.catalog()[0].conflicts.length, 1);
    assert.match(await evaluate('document.body.textContent'), /Preserved conflict draft/);
    const draft = store.catalog()[0].conflicts[0];
    assert.deepEqual(store.revision('ingots', draft).source, edited);
    await upload(edited);
    // Lose the first acknowledgment after the server has committed it. A retry
    // from the real form must reuse the request ID rather than add another draft.
    await evaluate(`(() => { const originalFetch = window.fetch; let lost = false; window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (args[1]?.method === 'POST' && !lost) { lost = true; throw new Error('Simulated lost acknowledgment'); }
        return response;
    }; })()`);
    await evaluate("document.querySelector('form').requestSubmit()");
    await until(() => evaluate('document.querySelector(".message").textContent.includes("Simulated lost acknowledgment")'), 'retry state');
    const count = store.catalog()[0].history.length;
    await evaluate("document.querySelector('form').requestSubmit()");
    await until(() => evaluate('document.querySelector("#loading").textContent.startsWith("Saved revision")'), 'save acknowledged');
    assert.equal(store.catalog()[0].history.length, count);
    assert.deepEqual(store.revision('ingots', store.head('ingots')).source, edited);
    await send('Page.reload');
    await until(() => evaluate('document.querySelectorAll("article").length > 0'), 'catalog after reload');
    const downloaded = await evaluate("fetch(document.querySelector('article .summary a').href).then(r => r.text())");
    assert.deepEqual(Buffer.from(downloaded), edited);
    await send('Emulation.setDeviceMetricsOverride', {width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false});
    await evaluate("document.querySelectorAll('details')[1].open = true");
    mkdirSync(join(repoRoot, 'work/reviews'), {recursive: true});
    const shot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});
    writeFileSync(join(repoRoot, 'work/reviews/workspace.png'), Buffer.from(shot.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'mobile layout fits viewport');
    console.log('Workspace browser check passed: upload, conflict preservation, lost-ack retry, reload, exact download, and mobile layout.');
} finally {
    ws?.close();
    if (browser) { browser.kill('SIGTERM'); await browserExit; }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close();
    rmSync(temporary, {recursive: true, force: true});
}
