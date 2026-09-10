// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {execFileSync} from 'node:child_process';
import {repoRoot} from './config.mjs';
import {WorkspaceStore} from './workspace/store.mjs';
import {createWorkspaceServer} from './workspace/server.mjs';
import {readEditorBuild} from './workspace/editor-build.mjs';
import {WorkspaceSessions} from './workspace/sessions.mjs';
import {WorkspaceWorkflow} from './workspace/workflow.mjs';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

const [command = 'serve', ...args] = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing ${name} value`);
    return args[i + 1];
};
const allowed = new Set(['--port', '--author', '--role', '--person']);
for (let i = 0; i < args.length; i += 2) if (!allowed.has(args[i])) throw new Error(`Unknown option ${args[i]}`);
if (!['init', 'catalog', 'serve', 'invite', 'revoke-person'].includes(command)) throw new Error('Usage: workspace.mjs init|catalog|serve|invite|revoke-person [--author NAME] [--port N]');
const store = new WorkspaceStore({repoRoot});
if (command === 'serve') {
    const port = Number(option('--port', '8767'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) { store.close(); throw new Error('Invalid port'); }
    const editor = existsSync(join(repoRoot, '.forge-workspace/editor/current.json')) ? readEditorBuild() : null;
    const sessions = new WorkspaceSessions(store, editor);
    const invitation = sessions.invite({name: option('--author', null) || execFileSync('git', ['config', 'user.name'], {cwd: repoRoot, encoding: 'utf8'}).trim(), role: 'author'});
    const workflow = new WorkspaceWorkflow(store, editor);
    const server = createWorkspaceServer(store, {editor, authenticated: true, workflow});
    server.on('error', error => { console.error(error.message); store.close(); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Content-forge workspace: http://127.0.0.1:${port}\nSign in with this one-time author token (15 minutes): ${invitation.token}\n${store.catalog().length} families. ${editor ? 'Pinned web editor ready.' : 'Run npm run workspace:editor-build to prepare Blockbench.'}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await server.shutdown(); store.close(); }));
} else {
    try {
        const sessions = new WorkspaceSessions(store, null);
        const result = command === 'catalog' ? store.catalog() : command === 'invite' ? sessions.invite({name: option('--author', ''), role: option('--role', 'reviewer')})
            : command === 'revoke-person' ? sessions.revokePerson(option('--person', '')) : store.initialize({author: option('--author', null) ||
            execFileSync('git', ['config', 'user.name'], {cwd: repoRoot, encoding: 'utf8'}).trim()});
        console.log(JSON.stringify(result, null, 2));
    } finally { store.close(); }
}
