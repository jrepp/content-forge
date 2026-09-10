// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, symlinkSync, readdirSync, existsSync, renameSync} from 'node:fs';
import {join, dirname, relative, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {repoRoot, loadConfig} from '../config.mjs';
import {sha256, containedPath} from '../asset-files.mjs';

function files(root, prefix = '') {
    return readdirSync(join(root, prefix), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
        const path = join(prefix, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Editor artifact cannot contain a symlink: ${path}`);
        return entry.isDirectory() ? files(root, path) : [path];
    });
}
export function readEditorBuild(root = join(repoRoot, '.forge-workspace/editor')) {
    const current = JSON.parse(readFileSync(join(root, 'current.json')));
    if (!/^[a-f0-9]{64}$/.test(current.id)) throw new Error('Invalid editor build');
    const path = join(root, current.id), manifest = JSON.parse(readFileSync(join(path, 'manifest.json')));
    if (sha256(Buffer.from(JSON.stringify(manifest))) !== current.id) throw new Error('Editor manifest changed');
    for (const entry of manifest.files) if (sha256(readFileSync(containedPath(path, entry.path))) !== entry.sha256) throw new Error(`Editor build changed: ${entry.path}`);
    return {id: current.id, path, manifest};
}
export function buildEditor({producerRoot = loadConfig().producerRoot, output = join(repoRoot, '.forge-workspace/editor')} = {}) {
    mkdirSync(output, {recursive: true});
    const staging = join(output, '.build-' + randomUUID()), source = join(staging, 'source'), artifact = join(staging, 'artifact');
    mkdirSync(source, {recursive: true}); mkdirSync(artifact);
    try {
        // Build a copy of the checked-out inputs. Never replace the desktop
        // bundle or user edits in the sibling Blockbench checkout.
        const tracked = execFileSync('git', ['ls-files', '-z'], {cwd: producerRoot, maxBuffer: 8 * 1024 * 1024}).toString().split('\0').filter(Boolean);
        const inputs = [];
        for (const path of tracked) {
            if (!existsSync(join(producerRoot, path))) continue;
            const bytes = readFileSync(join(producerRoot, path));
            inputs.push({path, sha256: sha256(bytes)});
            const target = containedPath(source, path); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, bytes);
        }
        symlinkSync(join(producerRoot, 'node_modules'), join(source, 'node_modules'), 'dir');
        execFileSync(process.execPath, ['build.js', '--target=web'], {cwd: source, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024});
        for (const name of ['css', 'assets', 'font', 'lib', 'dist']) if (existsSync(join(source, name))) cpSync(join(source, name), join(artifact, name), {recursive: true});
        for (const name of ['index.html', 'favicon.png', 'icon.png', 'icon_full.png', 'manifest.webmanifest', 'LICENSE.MD']) if (existsSync(join(source, name))) cpSync(join(source, name), join(artifact, name));
        rmSync(join(artifact, 'dist/bundle.js.map'), {force: true});
        const extension = readFileSync(new URL('./editor-extension.js', import.meta.url));
        writeFileSync(join(artifact, 'forge-extension.js'), extension);
        let html = readFileSync(join(artifact, 'index.html'), 'utf8');
        html = html.replace('<head>', '<head><script src="forge-bootstrap.js"></script>');
        html = html.replace('</body>', '<script src="forge-extension.js"></script></body>');
        writeFileSync(join(artifact, 'index.html'), html);
        writeFileSync(join(artifact, 'forge-bootstrap.js'), "localStorage.setItem('automation','on');\n");
        const manifest = {schema: 1, version: JSON.parse(readFileSync(join(source, 'package.json'))).version,
            baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: producerRoot, encoding: 'utf8'}).trim(),
            inputSha256: sha256(Buffer.from(JSON.stringify(inputs))), extensionSha256: sha256(extension),
            files: files(artifact).map(path => ({path, sha256: sha256(readFileSync(join(artifact, path)))}))};
        const id = sha256(Buffer.from(JSON.stringify(manifest)));
        writeFileSync(join(artifact, 'manifest.json'), JSON.stringify(manifest));
        if (!existsSync(join(output, id))) renameSync(artifact, join(output, id));
        writeFileSync(join(output, '.current-' + process.pid), JSON.stringify({id}));
        renameSync(join(output, '.current-' + process.pid), join(output, 'current.json'));
        return readEditorBuild(output);
    } finally { rmSync(staging, {recursive: true, force: true}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const built = buildEditor(); console.log(JSON.stringify({id: built.id, version: built.manifest.version, files: built.manifest.files.length}));
}
