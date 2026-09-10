// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import {spawn} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, label, attempts = 300) {
    for (let i = 0; i < attempts; i++) {
        try { const result = await check(); if (result) return result; }
        catch (error) {
            // Reload replaces the JS context between polling requests. Retry
            // only that transient CDP failure within the existing deadline.
            if (!/Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id/.test(error.message)) throw error;
        }
        await delay(100);
    }
    throw new Error(`Timed out: ${label}`);
}
export async function launchChrome(profile, url) {
    const child = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ['--headless=new', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url], {stdio: 'ignore'});
    let failure; const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', error => { failure = error; resolve(); }); });
    try { await until(() => { if (failure) throw failure; return existsSync(join(profile, 'DevToolsActivePort')); }, 'Chrome launch'); }
    catch (error) { child.kill(); await exited; throw error; }
    const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], sockets = [];
    async function page(match) {
        const target = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(p => p.type === 'page' && match(p)), 'browser page');
        const ws = new WebSocket(target.webSocketDebuggerUrl); sockets.push(ws);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        let sequence = 0; const pending = new Map();
        ws.onmessage = event => {
            const response = JSON.parse(event.data);
            if (response.method === 'Page.javascriptDialogOpening') { send('Page.handleJavaScriptDialog', {accept: true}).catch(() => {}); return; }
            const request = pending.get(response.id); if (!request) return;
            clearTimeout(request.timer); pending.delete(response.id);
            response.error ? request.reject(new Error(JSON.stringify(response.error))) : request.resolve(response.result);
        };
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
            pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, method, params}));
        });
        const evaluate = async expression => {
            const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true});
            if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        };
        await send('Page.enable');
        return {target, send, evaluate};
    }
    return {page, port, async close() { for (const socket of sockets) socket.close(); child.kill('SIGTERM'); await exited; }};
}
