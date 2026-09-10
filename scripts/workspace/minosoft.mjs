// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {loadConfig} from '../config.mjs';
import {sha256, containedPath} from '../asset-files.mjs';
const run = promisify(execFile);
export async function captureCandidate(workflow, candidateId, {consumerRoot = loadConfig().consumerRoot, output, onProgress = () => {}, signal} = {}) {
    const candidate = workflow.candidate(candidateId), saved = workflow.store.revision(candidate.family, candidate.revision);
    const root = output || join(workflow.store.repoRoot, '.forge-workspace/validation', candidateId);
    mkdirSync(root, {recursive: true});
    const pack = join(root, 'candidate-pack');
    for (const file of candidate.outputs) {
        const target = containedPath(pack, file.path); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, workflow.artifact(candidateId, file.path));
    }
    const name = `forge-${candidateId.slice(0, 16)}`, trajectory = `forge-review-${candidateId.slice(0, 12)}`;
    const command = async (args, label) => {
        onProgress(label);
        let result;
        try { result = await run(join(consumerRoot, 'play.sh'), args, {cwd: consumerRoot, env: {...process.env, MINOSOFT_TRAJECTORY: trajectory}, maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000, signal}); }
        catch (error) {
            writeFileSync(join(root, `${label}.stdout.log`), error.stdout || ''); writeFileSync(join(root, `${label}.stderr.log`), error.stderr || error.message);
            throw new Error(`Minosoft ${label} failed. Logs: ${root}\n${(error.stderr || error.message).slice(-4000)}`);
        }
        writeFileSync(join(root, `${label}.stdout.log`), result.stdout); writeFileSync(join(root, `${label}.stderr.log`), result.stderr);
        const lines = result.stdout.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith('{')) {
            try { return JSON.parse(lines.slice(i).join('\n')); } catch {}
        }
        throw new Error(`Minosoft ${label} did not emit a JSON result; see ${root}`);
    };
    // Observe existing runtime state before launching our isolated local client.
    const before = await command(['status', '--json'], 'status-before');
    if (before.parentPid || before.clientPid || before.externalClientPids?.length) throw new Error('A client is already running; keep this validation isolated by stopping it explicitly first.');
    const definition = JSON.parse(readFileSync(join(consumerRoot, 'content-stacks/standalone.json')));
    const overridePath = join(consumerRoot, 'content-stacks/standalone.local.json');
    let overrides = {}; try { overrides = JSON.parse(readFileSync(overridePath)).overrides || {}; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    definition.name = name;
    definition.sources = definition.sources.map(source => ({...source, ...overrides[source.label]}));
    definition.sources.push({type: 'directory', label: 'workspace-candidate', default: pack, optional: false});
    const manifestPath = join(root, 'stack.json'); writeFileSync(manifestPath, JSON.stringify(definition, null, 2));
    const composition = await command(['content', 'compose', '--manifest', manifestPath, '--json'], 'compose');
    for (const target of candidate.outputs) if (sha256(readFileSync(containedPath(composition.path, target.path))) !== target.sha256) throw new Error(`Composed stack does not select candidate bytes: ${target.path}`);
    await command(['content', 'queue', '--manifest', manifestPath, '--json'], 'queue');
    const files = new Map(), captures = [];
    files.set('stack.json', readFileSync(manifestPath));
    files.set('composition.json', Buffer.from(JSON.stringify(composition)));
    files.set('composition-provenance.json', readFileSync(join(composition.path, 'provenance.json')));
    for (const member of saved.family.members) {
        const imagePath = `${member.group}.png`, metadataPath = `${member.group}.json`;
        const response = await command(['content', 'preview', member.target, '--manifest', manifestPath, '--output', join(root, imagePath), '--settle', '30000', '--strict', '--json'], `preview-${member.group}`);
        if (response.contentFingerprint !== composition.fingerprint || response.target !== member.target || response.asset !== member.id) throw new Error('Consumer capture does not match the selected content stack and item');
        files.set(imagePath, readFileSync(join(root, imagePath))); files.set(metadataPath, Buffer.from(JSON.stringify(response)));
        captures.push({member: member.id, target: member.target, image: imagePath, metadata: metadataPath});
    }
    const after = await command(['status', '--json'], 'status-after');
    if (after.clientPid || after.parentPid || after.externalClientPids?.length) throw new Error('Validation client did not clean up');
    const consumerCommit = (await run('git', ['rev-parse', 'HEAD'], {cwd: consumerRoot})).stdout.trim();
    const manifest = {schema: 1, kind: 'content-forge-minosoft-evidence', candidate: candidateId, revision: candidate.revision,
        sourceSha256: candidate.sourceSha256, consumer: {name: 'Minosoft', baseCommit: consumerCommit, launcherSha256: sha256(readFileSync(join(consumerRoot, 'play.sh'))),
            launcherJarSha256: sha256(readFileSync(join(consumerRoot, 'util/play/build/install/play-util/lib/play-util.jar'))),
            previewFunctionSha256: sha256(readFileSync(join(consumerRoot, 'acceptance/datapacks/content-preview/data/content_preview/functions/show_item.mcfunction'))),
            cameraFunctionSha256: sha256(readFileSync(join(consumerRoot, 'acceptance/datapacks/content-preview/data/content_preview/functions/camera.mcfunction')))},
        profile: {consumer: 'Minosoft', minecraftVersion: '1.20.4', packFormat: 22, modpack: definition.managed_modpack || ''},
        compositionFingerprint: composition.fingerprint, selectedTargets: candidate.outputs, captures,
        files: [...files].map(([path, content]) => ({path, sha256: sha256(content)}))};
    const bundle = {manifest, files: [...files].map(([path, content]) => ({path, base64: content.toString('base64')}))};
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(bundle));
    return {bundle, path: join(root, 'evidence.json')};
}
