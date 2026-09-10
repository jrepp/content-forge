// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {get} from 'node:http';
import {WorkspaceStore} from '../scripts/workspace/store.mjs';
import {createWorkspaceServer} from '../scripts/workspace/server.mjs';
import {repoRoot} from '../scripts/config.mjs';
import {sha256} from '../scripts/asset-files.mjs';
import {WorkspaceSessions} from '../scripts/workspace/sessions.mjs';
import {WorkspaceWorkflow} from '../scripts/workspace/workflow.mjs';
import {encodePNG} from '../producers/raster/png.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'forge-workspace-test-'));
    const familyDir = join(root, 'producers/blockbench/items/ingots');
    mkdirSync(familyDir, {recursive: true});
    cpSync(join(repoRoot, 'producers/blockbench/items/ingots'), familyDir, {recursive: true});
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], {cwd: root});
    let store = new WorkspaceStore({repoRoot: root});
    store.initialize({author: 'Importer'});
    const base = store.head('ingots'), original = store.revision('ingots', base).source;
    t.after(() => { store.close(); rmSync(root, {recursive: true, force: true}); });
    return {root, base, original, get store() { return store; },
        reopen() { store.close(); store = new WorkspaceStore({repoRoot: root}); },
        edit(depth = 10) { const value = JSON.parse(original); value.elements[0].to[2] = depth; return Buffer.from(JSON.stringify(value)); },
        save(source, expectedRevision = base, requestId = randomUUID()) {
            return store.save({familyId: 'ingots', expectedRevision, source, requestId, author: 'Author'});
        }};
}

test('import retains exact source, family, embedded hashes, lineage and repository base; repeated init preserves drafts', t => {
    const f = fixture(t), initial = f.store.revision('ingots', f.base);
    assert.deepEqual(initial.source, readFileSync(join(f.root, initial.family.source)));
    assert.equal(initial.record.source.dependencies.length, 2);
    assert.match(initial.record.baseCommit, /^[a-f0-9]{40}$/);
    assert.equal(sha256(initial.provenance), initial.record.provenanceSha256);
    const saved = f.save(f.edit());
    assert.equal(f.store.initialize({author: 'Importer'})[0].status, 'existing');
    assert.equal(f.store.head('ingots'), saved.revision);
    assert.deepEqual(readFileSync(join(f.root, initial.family.source)), f.original);
    assert.equal(f.store.catalog()[0].checkoutMatchesHead, false);
});

test('stale saves keep both drafts and download exact bytes after reopening the durable store', t => {
    const f = fixture(t), a = f.edit(9), b = f.edit(11);
    const first = f.save(a), second = f.save(b);
    assert.equal(first.status, 'saved'); assert.equal(second.status, 'conflict');
    assert.equal(second.head, first.revision);
    f.reopen();
    assert.equal(f.store.head('ingots'), first.revision);
    assert.deepEqual(f.store.revision('ingots', first.revision).source, a);
    assert.deepEqual(f.store.revision('ingots', second.revision).source, b);
    assert.equal(f.store.revision('ingots', second.revision).record.parent, f.base);
    assert.deepEqual(f.store.catalog()[0].conflicts, [second.revision]);
    assert.equal(f.store.catalog()[0].history.length, 3);
});

test('retries after a lost acknowledgment return the original result without creating another revision', t => {
    const f = fixture(t), key = randomUUID(), bytes = f.edit();
    const result = f.save(bytes, f.base, key);
    f.reopen();
    assert.deepEqual(f.save(bytes, f.base, key), result);
    assert.throws(() => f.save(f.edit(13), f.base, key), /different content/);
    const conflictKey = randomUUID(), conflict = f.save(f.edit(14), f.base, conflictKey);
    assert.deepEqual(f.save(f.edit(14), f.base, conflictKey), conflict);
    assert.equal(f.store.catalog()[0].history.length, 3);
});

test('invalid sources, external textures and unknown bases cannot advance the source or leave partial revisions', t => {
    const f = fixture(t), external = JSON.parse(f.original); delete external.textures[0].source;
    for (const bytes of [Buffer.from('broken JSON'), Buffer.from('{}'), Buffer.from(JSON.stringify(external))]) assert.throws(() => f.save(bytes));
    assert.throws(() => f.save(f.original, '0'.repeat(64)), /Unknown source revision/);
    assert.equal(f.store.head('ingots'), f.base);
    assert.equal(f.store.catalog()[0].history.length, 1);
    assert.throws(() => f.store.db.prepare('UPDATE revisions SET source = ? WHERE id = ?').run(f.edit(), f.base), /immutable/);
    assert.throws(() => f.store.db.prepare('DELETE FROM revisions WHERE id = ?').run(f.base), /immutable/);
});

test('simultaneous writers in separate processes select one head and preserve the other source', async t => {
    const f = fixture(t);
    const module = new URL('../scripts/workspace/store.mjs', import.meta.url).href;
    const program = `import {WorkspaceStore} from ${JSON.stringify(module)};
        const [root, base, encoded, requestId] = process.argv.slice(1);
        const store = new WorkspaceStore({repoRoot:root});
        console.log(JSON.stringify(store.save({familyId:'ingots',expectedRevision:base,source:Buffer.from(encoded,'base64'),requestId,author:'Concurrent author'})));
        store.close();`;
    const edits = [f.edit(12), f.edit(15)];
    const results = await Promise.all(edits.map(bytes => promisify(execFile)(process.execPath,
        ['--input-type=module', '-e', program, f.root, f.base, bytes.toString('base64'), randomUUID()])));
    const saves = results.map(r => JSON.parse(r.stdout));
    assert.deepEqual(saves.map(s => s.status).sort(), ['conflict', 'saved']);
    assert.equal(f.store.head('ingots'), saves.find(s => s.status === 'saved').revision);
    for (let i = 0; i < saves.length; i++) assert.deepEqual(f.store.revision('ingots', saves[i].revision).source, edits[i]);
});

test('process interruption before commit leaves no acknowledged or partial revision', async t => {
    const f = fixture(t), module = new URL('../scripts/workspace/store.mjs', import.meta.url).href;
    const program = `import {WorkspaceStore} from ${JSON.stringify(module)};
        const [root, base] = process.argv.slice(1);
        const store = new WorkspaceStore({repoRoot:root}), source=store.revision('ingots',base).source;
        const insert=store.insert.bind(store);store.insert=(input)=>{insert(input);process.exit(23);};
        store.save({familyId:'ingots',expectedRevision:base,source,requestId:'interrupted-request',author:'Interrupted author'});`;
    await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', program, f.root, f.base]), e => e.code === 23);
    f.reopen();
    assert.equal(f.store.head('ingots'), f.base); assert.equal(f.store.catalog()[0].history.length, 1);
    assert.equal(f.save(f.edit()).status, 'saved');
});

test('candidate status follows source and family hashes and detects changed or escaped output', t => {
    const f = fixture(t), root = join(f.root, 'work/item-families/ingots'), pack = join(root, 'exports/candidate');
    const revision = f.store.revision('ingots', f.base), targets = [];
    for (const member of revision.family.members) for (const target of [member.target, member.texture]) {
        const path = join(pack, target); mkdirSync(join(path, '..'), {recursive: true}); writeFileSync(path, 'fixture bytes');
        targets.push({target, sha256: sha256(Buffer.from('fixture bytes'))});
    }
    const provenance = {family: 'ingots', sourceSha256: revision.record.source.sha256, familySha256: revision.record.familySha256, targets};
    writeFileSync(join(pack, 'provenance.json'), JSON.stringify(provenance));
    writeFileSync(join(root, 'latest.json'), JSON.stringify({family: 'ingots', sourceSha256: revision.record.source.sha256, pack}));
    assert.equal(f.store.catalog()[0].candidate.status, 'current');
    f.save(f.edit()); assert.equal(f.store.catalog()[0].candidate.status, 'stale');
    writeFileSync(join(pack, targets[0].target), 'changed'); assert.equal(f.store.catalog()[0].candidate.status, 'unavailable');
    rmSync(join(pack, targets[0].target)); symlinkSync(join(f.root, revision.family.source), join(pack, targets[0].target));
    assert.match(f.store.catalog()[0].candidate.issue, /escapes/);
});

test('HTTP catalog, exact revision downloads, conflicts, retries and local-origin protections', async t => {
    const f = fixture(t), server = createWorkspaceServer(f.store);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const catalog = await fetch(base + '/api/catalog').then(r => r.json());
    assert.equal(catalog.families[0].head.id, f.base);
    const original = await fetch(`${base}/api/families/ingots/revisions/${f.base}/source`);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), f.original);
    const input = {expectedRevision: f.base, sourceBase64: f.edit().toString('base64'), author: 'Browser author', requestId: randomUUID()};
    const post = (data, origin = base) => fetch(`${base}/api/families/ingots/revisions`, {method: 'POST',
        headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify(data)});
    assert.equal((await post(input, 'https://unrelated.example')).status, 403);
    const wrongHostStatus = await new Promise((resolve, reject) => get(base + '/api/catalog', {headers: {Host: 'unrelated.example'}},
        response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
    assert.equal(wrongHostStatus, 403);
    const response = await post(input); assert.equal(response.status, 201);
    const first = await response.json(); assert.deepEqual(await post(input).then(r => r.json()), first);
    const conflict = await post({...input, requestId: randomUUID(), sourceBase64: f.edit(14).toString('base64')});
    assert.equal(conflict.status, 409);
    const draft = await conflict.json();
    assert.deepEqual(Buffer.from(await fetch(`${base}/api/families/ingots/revisions/${draft.revision}/source`).then(r => r.arrayBuffer())), f.edit(14));
    assert.equal((await fetch(`${base}/api/families/wrong/revisions/${draft.revision}/source`)).status, 400);
    assert.equal((await fetch(base + '/.forge-workspace/workspace.sqlite')).status, 404);
    const page = await fetch(base); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await page.text(), /Asset families/);
});

test('authenticated editor sessions bind owner, build, instance, generation, project and opened revision', t => {
    const f = fixture(t), editor = {id: 'a'.repeat(64), manifest: {version: '5.1.6'}}, sessions = new WorkspaceSessions(f.store, editor);
    const invite = sessions.invite({name: 'Author', role: 'author'}), login = sessions.login(invite.token), person = login.person;
    assert.throws(() => sessions.login(invite.token), /invalid or expired/);
    assert.equal(sessions.authenticate(login.secret).id, person.id);
    const peer = sessions.login(sessions.invite({name: 'Peer', role: 'author'}).token).person;
    const reviewer = sessions.login(sessions.invite({name: 'Reviewer', role: 'reviewer'}).token).person;
    assert.throws(() => sessions.launch(reviewer, 'ingots', f.base), /Author access/);
    const launched = sessions.launch(person, 'ingots', f.base), instance = randomUUID();
    assert.throws(() => sessions.attach(peer, launched.id, {instance, build: editor.id}), /unavailable/);
    assert.throws(() => sessions.attach(person, launched.id, {instance, build: 'wrong'}), /Wrong editor/);
    const attached = sessions.attach(person, launched.id, {instance, build: editor.id}), project = randomUUID();
    assert.equal(attached.revision.source.sha256, sha256(f.original));
    assert.throws(() => sessions.attach(person, launched.id, {instance: randomUUID(), build: editor.id}), /Wrong editor/);
    const input = {instance, generation: attached.generation, project, sourceSha256: sha256(f.original)};
    sessions.ready(person, launched.id, input);
    assert.throws(() => sessions.bound(person, launched.id, {...input, project: randomUUID()}), /Wrong active/);
    const saved = sessions.save(person, launched.id, {...input, expectedRevision: f.base, sourceBase64: f.edit().toString('base64'), requestId: randomUUID()});
    assert.equal(saved.status, 'saved');
    const reattached = sessions.attach(person, launched.id, {instance, build: editor.id});
    assert.equal(reattached.revision.id, saved.revision);
    assert.throws(() => sessions.bound(person, launched.id, input), /generation/);
    sessions.revoke(person, launched.id);
    assert.throws(() => sessions.attach(person, launched.id, {instance, build: editor.id}), /revoked/);
    sessions.revokePerson(person.id); assert.throws(() => sessions.authenticate(login.secret), /revoked/);
});

test('two authenticated editor sessions preserve stale saves and reuse lost acknowledgments', t => {
    const f = fixture(t), editor = {id: 'a'.repeat(64), manifest: {}}, sessions = new WorkspaceSessions(f.store, editor);
    const person = sessions.login(sessions.invite({name: 'Author', role: 'author'}).token).person;
    const opened = [1, 2].map(() => {
        const launch = sessions.launch(person, 'ingots', f.base), instance = randomUUID();
        const attach = sessions.attach(person, launch.id, {instance, build: editor.id});
        const input = {instance, generation: attach.generation, project: randomUUID(), sourceSha256: sha256(f.original)};
        sessions.ready(person, launch.id, input); return {id: launch.id, input};
    });
    const requests = opened.map((session, i) => ({...session.input, expectedRevision: f.base, sourceBase64: f.edit(10 + i).toString('base64'), requestId: randomUUID()}));
    const a = sessions.save(person, opened[0].id, requests[0]), b = sessions.save(person, opened[1].id, requests[1]);
    assert.equal(a.status, 'saved'); assert.equal(b.status, 'conflict');
    assert.deepEqual(sessions.save(person, opened[0].id, requests[0]), a);
    assert.deepEqual(sessions.save(person, opened[1].id, requests[1]), b);
    assert.equal(f.store.head('ingots'), a.revision);
    assert.deepEqual(f.store.revision('ingots', b.revision).source, f.edit(11));
});

async function candidateFixture(t) {
    const f = fixture(t), editor = {id: 'a'.repeat(64), manifest: {version: '5.1.6', extensionSha256: 'b'.repeat(64)}};
    // Unit scope is artifact/review integrity. The separate editor acceptance
    // test exercises the real codecs and rendered review sheet.
    const sheetBuilder = async ({output}) => { writeFileSync(output, '<html>Unit review snapshot</html>'); writeFileSync(output.replace('.html', '.json'), JSON.stringify({snapshot: 'fixture-snapshot', entries: [{issues: []}]})); };
    const workflow = new WorkspaceWorkflow(f.store, editor, {sheetBuilder}), source = JSON.parse(f.original);
    const author = {id: 'test-author', name: 'Test author', role: 'author'}, reviewer = {id: 'test-reviewer', name: 'Test reviewer', role: 'reviewer'};
    const result = {version: editor.manifest.version, models: ['iron_ingot', 'gold_ingot'].map(group => ({group,
        content: JSON.stringify({textures: {all: `minecraft:item/${group}`}, elements: [{from: [0, 0, 7], to: [16, 16, 9], faces: {north: {uv: [0, 0, 16, 16], texture: '#all'}}}]})})),
        textures: source.textures.map(texture => ({name: texture.name, status: 'ok', content: texture.source.split(',')[1]}))};
    const session = {id: randomUUID(), family: 'ingots', build: editor.id, revision: f.base};
    const input = {revision: f.base, compiledSource: f.original.toString(), result};
    const candidate = await workflow.exportCandidate(author, session, input);
    const bundle = () => {
        const compositionFingerprint = 'c'.repeat(64), files = new Map();
        files.set('composition.json', Buffer.from(JSON.stringify({fingerprint: compositionFingerprint})));
        files.set('composition-provenance.json', Buffer.from(JSON.stringify({fingerprint: compositionFingerprint})));
        const captures = f.store.revision('ingots', f.base).family.members.map(member => {
            const image = `${member.group}.png`, metadata = `${member.group}.json`, png = encodePNG(64, 64, new Uint8Array(64 * 64 * 4).fill(255));
            files.set(image, png); files.set(metadata, Buffer.from(JSON.stringify({asset: member.id, target: member.target, kind: 'item', strict: true, contentFingerprint: compositionFingerprint, captures: [{sha256: sha256(png), placement: {function:'content_preview:show_item',executed:1}}]})));
            return {member: member.id, target: member.target, image, metadata};
        });
        const manifest = {schema: 1, kind: 'content-forge-minosoft-evidence', candidate: candidate.id, revision: candidate.revision, sourceSha256: candidate.sourceSha256,
            consumer: {name: 'Minosoft'}, profile: {consumer: 'Minosoft', minecraftVersion: '1.20.4', packFormat: 22, modpack: 'fixture'},
            compositionFingerprint, selectedTargets: candidate.outputs, captures, files: [...files].map(([path, value]) => ({path, sha256: sha256(value)}))};
        return {manifest, files: [...files].map(([path, value]) => ({path, base64: value.toString('base64')}))};
    };
    return {...f, workflow, author, reviewer, candidate, session, input, bundle};
}

test('candidate exports bind source and toolchain; repeated exports retain exact bytes and review identity', async t => {
    const f = await candidateFixture(t);
    const again = await f.workflow.exportCandidate(f.author, f.session, f.input);
    assert.equal(again.id, f.candidate.id); assert.equal(f.workflow.list().length, 1);
    assert.deepEqual(f.workflow.artifact(again.id, 'source.bbmodel'), f.original);
    await assert.rejects(f.workflow.exportCandidate(f.author, f.session, {...f.input, compiledSource: f.edit().toString()}), /differs from the saved/);
    assert.throws(() => f.workflow.review(f.reviewer, again.id, {snapshot: 'wrong', sheetSha256: again.sheetSha256, decision: 'reviewed', note: 'finding'}), /exact candidate sheet/);
    assert.throws(() => f.workflow.review(f.author, again.id, {}), /Reviewer access/);
    assert.throws(() => f.workflow.review({...f.author, role: 'reviewer'}, again.id, {snapshot: again.snapshot, sheetSha256: again.sheetSha256, decision: 'reviewed', note: 'Own export'}), /own export/);
});

test('approval requires exact consumer images and all family members; selected approved packs rebuild byte-identically', async t => {
    const f = await candidateFixture(t), c = f.candidate;
    const decision = {snapshot: c.snapshot, sheetSha256: c.sheetSha256, decision: 'approved', note: 'Synthetic test evidence only'};
    assert.throws(() => f.workflow.review(f.reviewer, c.id, decision), /in-game evidence/);
    assert.throws(() => f.workflow.buildPack(f.reviewer, [c.id]), /lacks current approval/);
    const bad = f.bundle(); bad.manifest.revision = '0'.repeat(64); assert.throws(() => f.workflow.attachEvidence(f.reviewer, c.id, bad), /mismatch/);
    const incomplete = f.bundle(); incomplete.manifest.captures.pop(); assert.throws(() => f.workflow.attachEvidence(f.reviewer, c.id, incomplete), /every member/);
    const altered = f.bundle(); altered.files[2].base64 = Buffer.from('changed').toString('base64'); assert.throws(() => f.workflow.attachEvidence(f.reviewer, c.id, altered), /hash mismatch/);
    const emptyPlacement = f.bundle(), metadataPath = emptyPlacement.manifest.captures[0].metadata;
    const metadataFile = emptyPlacement.files.find(file => file.path === metadataPath);
    const metadata = JSON.parse(Buffer.from(metadataFile.base64, 'base64'));
    metadata.captures[0].placement.executed = 0;
    const metadataBytes = Buffer.from(JSON.stringify(metadata));
    metadataFile.base64 = metadataBytes.toString('base64');
    emptyPlacement.manifest.files.find(file => file.path === metadataPath).sha256 = sha256(metadataBytes);
    assert.throws(() => f.workflow.attachEvidence(f.reviewer, c.id, emptyPlacement), /did not execute the item placement/);
    const evidence = f.workflow.attachEvidence(f.reviewer, c.id, f.bundle());
    // Running consumer validation does not make a teammate the export's author.
    f.store.db.prepare('INSERT INTO workspace_jobs VALUES (?, ?)').run(randomUUID(), JSON.stringify({kind: 'minosoft-capture', candidate: c.id, author: f.reviewer.id, status: 'complete'}));
    const approval = f.workflow.review(f.reviewer, c.id, {...decision, evidence: [evidence.id]});
    const pack = f.workflow.buildPack(f.reviewer, [c.id]), second = f.workflow.buildPack(f.reviewer, [c.id]);
    assert.equal(pack.archiveSha256, second.archiveSha256); assert.equal(pack.selected[0].approval, approval.id);
    assert.deepEqual(f.workflow.pack(pack.id).archive, f.workflow.pack(second.id).archive);
    f.workflow.review(f.reviewer, c.id, {...decision, decision: 'needs-work', note: 'New defect found'});
    assert.throws(() => f.workflow.buildPack(f.reviewer, [c.id]), /lacks current approval/);
    assert.equal(f.workflow.pack(pack.id).record.archiveSha256, pack.archiveSha256, 'historical builds remain immutable');
    f.save(f.edit()); assert.throws(() => f.workflow.review(f.reviewer, c.id, {...decision, evidence: [evidence.id]}), /newer source/);
});
