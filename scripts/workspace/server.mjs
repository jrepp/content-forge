// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {MAX_SOURCE_BYTES} from './store.mjs';
import {WorkspaceSessions} from './sessions.mjs';
import {sha256, containedPath} from '../asset-files.mjs';
import {captureCandidate} from './minosoft.mjs';
import {randomUUID} from 'node:crypto';

const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
export function createWorkspaceServer(store, {editor = null, authenticated = false, workflow = null} = {}) {
    const sessions = new WorkspaceSessions(store, editor);
    let activeCapture = null, captureController = null;
    const server = createServer(async (req, res) => {
        const send = (status, body, type = 'application/json', headers = {}) => {
            res.writeHead(status, {'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", ...headers});
            res.end(type === 'application/json' ? JSON.stringify(body) : body);
        };
        try {
            const host = `127.0.0.1:${server.address().port}`;
            if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return send(403, {error: 'Use the local workspace origin'});
            const path = new URL(req.url, `http://${host}`).pathname;
            const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('forge_login='))?.slice(12);
            const identity = () => sessions.authenticate(cookie);
            const readJSON = async () => {
                if (req.headers.origin !== `http://${host}` || req.headers['content-type'] !== 'application/json') throw new Error('Operation requires same-origin JSON');
                const chunks = []; let size = 0;
                for await (const chunk of req) { size += chunk.length; if (size > 24 * 1024 * 1024) throw new Error('Request exceeds 24 MiB'); chunks.push(chunk); }
                return JSON.parse(Buffer.concat(chunks).toString('utf8'));
            };
            if (req.method === 'POST' && path === '/api/login') {
                const {person, secret} = sessions.login((await readJSON()).token);
                return send(200, {person}, 'application/json', {'Set-Cookie': `forge_login=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`});
            }
            if (req.method === 'GET' && path === '/api/identity') {
                try { return send(200, {person: identity(), authenticated, editor: editor?.id}); }
                catch { return send(200, {person: null, authenticated, editor: editor?.id}); }
            }
            if (req.method === 'POST' && path === '/api/logout') { await readJSON(); return send(200, {}, 'application/json', {'Set-Cookie': 'forge_login=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}); }
            if (req.method === 'GET' && staticFiles.has(path)) {
                const [file, type] = staticFiles.get(path);
                return send(200, readFileSync(new URL(file, import.meta.url)), type);
            }
            if (authenticated) { try { identity(); } catch (error) { return send(401, {error: error.message}); } }
            if (req.method === 'GET' && path.startsWith('/editor/')) {
                identity();
                if (!editor || !path.startsWith(`/editor/${editor.id}/`)) return send(404, {error: 'Unknown pinned editor build'});
                const target = decodeURIComponent(path.slice(`/editor/${editor.id}/`.length));
                const entry = editor.manifest.files.find(f => f.path === target);
                if (!entry) return send(404, {error: 'Unknown editor file'});
                const bytes = readFileSync(containedPath(editor.path, target));
                if (sha256(bytes) !== entry.sha256) throw new Error('Pinned editor file hash mismatch');
                const extension = target.split('.').at(-1);
                const type = {html:'text/html', js:'text/javascript', css:'text/css', png:'image/png', svg:'image/svg+xml', woff2:'font/woff2', woff:'font/woff', ttf:'font/ttf', json:'application/json'}[extension] || 'application/octet-stream';
                return send(200, bytes, type === 'application/json' ? 'text/plain' : type, {'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'"});
            }
            const launch = path.match(/^\/api\/families\/([a-z0-9-]+)\/editor-sessions$/);
            if (req.method === 'POST' && launch) { const input = await readJSON(); return send(201, sessions.launch(identity(), launch[1], input.revision)); }
            const operation = path.match(/^\/api\/editor-sessions\/([a-f0-9-]{36})\/(attach|ready|save|revoke|export)$/);
            if (req.method === 'POST' && operation) {
                const input = await readJSON(), person = identity();
                if (operation[2] === 'export') {
                    if (!workflow) throw new Error('Candidate export is not configured');
                    const session = sessions.bound(person, operation[1], input);
                    if (session.revision !== input.revision) throw new Error('Export must use the session saved revision');
                    return send(201, await workflow.exportCandidate(person, session, input));
                }
                const result = sessions[operation[2]](person, operation[1], input);
                return send(result.status === 'conflict' ? 409 : 200, result);
            }
            if (req.method === 'GET' && path === '/api/catalog') return send(200, {schema: 1, families: store.catalog()});
            const animationReview = path.match(/^\/api\/animation-reviews\/([a-f0-9]{64})\/([a-zA-Z0-9_.-]+)$/);
            if (req.method === 'GET' && animationReview) {
                const [, id, file] = animationReview;
                if (file === 'manifest.json') return send(200, store.animationReview(id));
                const type = file.endsWith('.png') ? 'image/png' : file === 'index.html' ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
                return send(200, store.animationReviewFile(id, file), type);
            }
            if (req.method === 'GET' && path === '/api/candidates') return send(200, {candidates: workflow ? workflow.list() : []});
            if (req.method === 'GET' && path === '/api/jobs') return send(200, {jobs: workflow ? store.db.prepare('SELECT record FROM workspace_jobs ORDER BY rowid DESC LIMIT 30').all().map(r => JSON.parse(r.record)) : []});
            const capture = path.match(/^\/api\/candidates\/([a-f0-9]{64})\/captures$/);
            if (req.method === 'POST' && capture && workflow) {
                const person = identity(); await readJSON();
                if (activeCapture) throw new Error('A Minosoft capture is already running');
                workflow.candidate(capture[1]);
                const job = {id: randomUUID(), kind: 'minosoft-capture', candidate: capture[1], author: person.id, status: 'running', progress: 'Preparing isolated consumer', startedAt: new Date().toISOString()};
                const update = () => store.db.prepare('UPDATE workspace_jobs SET record = ? WHERE id = ?').run(JSON.stringify(job), job.id);
                store.db.prepare('INSERT INTO workspace_jobs VALUES (?, ?)').run(job.id, JSON.stringify(job));
                captureController = new AbortController();
                activeCapture = captureCandidate(workflow, capture[1], {signal: captureController.signal, onProgress: progress => { job.progress = progress; update(); }})
                    .then(result => { sessions.person(person.id); const evidence = workflow.attachEvidence(person, capture[1], result.bundle); job.evidence = evidence.id; job.status = 'complete'; })
                    .catch(error => { job.status = 'failed'; job.error = error.message; })
                    .finally(() => { job.finishedAt = new Date().toISOString(); update(); activeCapture = null; captureController = null; });
                return send(202, job);
            }
            const attachEvidence = path.match(/^\/api\/candidates\/([a-f0-9]{64})\/evidence$/);
            if (req.method === 'POST' && attachEvidence && workflow) return send(201, workflow.attachEvidence(identity(), attachEvidence[1], await readJSON()));
            const evidenceFile = path.match(/^\/api\/candidates\/([a-f0-9]{64})\/evidence\/([a-f0-9]{64})\/(.+)$/);
            if (req.method === 'GET' && evidenceFile && workflow) {
                identity(); const evidence = workflow.evidence(evidenceFile[1], evidenceFile[2]), target = decodeURIComponent(evidenceFile[3]);
                if (!evidence.files.some(f => f.path === target)) throw new Error('Unknown evidence file');
                const content = store.db.prepare('SELECT bytes FROM workspace_evidence_files WHERE evidence = ? AND path = ?').get(evidence.id, target).bytes;
                return send(200, Buffer.from(content), target.endsWith('.png') ? 'image/png' : 'application/octet-stream');
            }
            if (req.method === 'POST' && path === '/api/pack-builds' && workflow) return send(201, workflow.buildPack(identity(), (await readJSON()).selection));
            if (req.method === 'GET' && path === '/api/pack-builds' && workflow) return send(200, {builds: store.db.prepare('SELECT record FROM workspace_pack_builds ORDER BY rowid DESC').all().map(r => JSON.parse(r.record))});
            const packDownload = path.match(/^\/api\/pack-builds\/([a-f0-9]{64})\.zip$/);
            if (req.method === 'GET' && packDownload && workflow) { identity(); const pack = workflow.pack(packDownload[1]); return send(200, pack.archive, 'application/zip', {'Content-Disposition': `attachment; filename="content-forge-${pack.record.id.slice(0,12)}.zip"`}); }
            const candidateArtifact = path.match(/^\/api\/candidates\/([a-f0-9]{64})\/artifacts\/(.+)$/);
            if (req.method === 'GET' && candidateArtifact && workflow) {
                identity(); workflow.candidate(candidateArtifact[1]);
                const target = decodeURIComponent(candidateArtifact[2]), content = workflow.artifact(candidateArtifact[1], target);
                if (target === 'review.html') return send(200, content, 'text/html', {'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none'; object-src 'none'"});
                return send(200, content, 'application/octet-stream', {'Content-Disposition': `attachment; filename="${target.split('/').at(-1).replaceAll('"', '')}"`});
            }
            const reviewCandidate = path.match(/^\/api\/candidates\/([a-f0-9]{64})\/reviews$/);
            if (req.method === 'POST' && reviewCandidate && workflow) return send(201, workflow.review(identity(), reviewCandidate[1], await readJSON()));
            const download = path.match(/^\/api\/families\/([a-z0-9-]+)\/revisions\/([a-f0-9]{64})\/(source|family|provenance)$/);
            if (req.method === 'GET' && download) {
                const [, id, revision, kind] = download, saved = store.revision(id, revision);
                const bytes = kind === 'family' ? saved.familyBytes : saved[kind];
                return send(200, bytes, 'application/octet-stream', {'Content-Disposition': `attachment; filename="${id}-${revision.slice(0, 12)}-${kind}.${kind === 'source' ? 'bbmodel' : 'json'}"`});
            }
            const save = path.match(/^\/api\/families\/([a-z0-9-]+)\/revisions$/);
            if (req.method === 'POST' && save) {
                if (req.headers.origin !== `http://${host}` || req.headers['content-type'] !== 'application/json') return send(403, {error: 'Save requires same-origin JSON'});
                const chunks = []; let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > MAX_SOURCE_BYTES * 4 / 3 + 4096) { send(413, {error: 'Source exceeds 8 MiB'}); req.resume(); return; }
                    chunks.push(chunk);
                }
                const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (typeof input.sourceBase64 !== 'string') throw new Error('Source bytes are required');
                const source = Buffer.from(input.sourceBase64, 'base64');
                if (source.toString('base64') !== input.sourceBase64) throw new Error('Invalid source encoding');
                const person = authenticated ? identity() : null;
                if (person && person.role !== 'author') throw new Error('Author access is required');
                const result = store.save({familyId: save[1], expectedRevision: input.expectedRevision, source, author: person?.name || input.author, requestId: input.requestId});
                return send(result.status === 'conflict' ? 409 : 201, result);
            }
            send(404, {error: 'Not found'});
        } catch (error) { send(400, {error: error.message}); }
    });
    server.shutdown = async () => { captureController?.abort(); await activeCapture; };
    return server;
}
