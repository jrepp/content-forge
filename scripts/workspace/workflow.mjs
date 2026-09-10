// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {sha256, containedPath} from '../asset-files.mjs';
import {capabilities} from './families.mjs';
import {exportFiles} from '../../producers/blockbench/item-family.mjs';
import {auditPack} from '../audit.mjs';
import {buildSheet} from '../review-sheet.mjs';
import {decodePNG} from '../../producers/raster/png.mjs';
import {execFileSync} from 'node:child_process';
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export class WorkspaceWorkflow {
    constructor(store, editor, {sheetBuilder = buildSheet} = {}) {
        this.store = store; this.db = store.db; this.editor = editor;
        this.sheetBuilder = sheetBuilder;
        this.exporterSha256 = sha256(bytes(['./workflow.mjs', './families.mjs', '../../producers/blockbench/item-family.mjs', '../../producers/model/semantics.mjs',
            '../review-sheet.mjs', '../review/viewer.mjs', '../review/resolve.mjs', '../review/sheet.css', '../asset-files.mjs']
            .map(path => ({path, sha256: sha256(readFileSync(new URL(path, import.meta.url)))}))));
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workspace_jobs (id TEXT PRIMARY KEY, record TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_candidates (id TEXT PRIMARY KEY, family TEXT NOT NULL REFERENCES families(id), revision TEXT NOT NULL REFERENCES revisions(id), record TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_artifacts (candidate TEXT NOT NULL REFERENCES workspace_candidates(id), path TEXT NOT NULL, hash TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (candidate, path));
            CREATE TABLE IF NOT EXISTS workspace_reviews (id TEXT PRIMARY KEY, candidate TEXT NOT NULL REFERENCES workspace_candidates(id), reviewer TEXT NOT NULL, record TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_evidence (id TEXT PRIMARY KEY, candidate TEXT NOT NULL REFERENCES workspace_candidates(id), record TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_evidence_files (evidence TEXT NOT NULL REFERENCES workspace_evidence(id), path TEXT NOT NULL, hash TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(evidence, path));
            CREATE TABLE IF NOT EXISTS workspace_pack_builds (id TEXT PRIMARY KEY, record TEXT NOT NULL, archive BLOB NOT NULL);
        `);
        for (const table of ['workspace_candidates', 'workspace_artifacts', 'workspace_reviews', 'workspace_evidence', 'workspace_evidence_files', 'workspace_pack_builds']) {
            for (const operation of ['UPDATE', 'DELETE']) this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'Workspace artifacts are immutable'); END;`);
        }
    }
    async exportCandidate(person, session, input) {
        requireValue(person.role === 'author', 'Author access is required');
        requireValue(this.editor && session.build === this.editor.id && input.result.version === this.editor.manifest.version, 'Export toolchain mismatch');
        const saved = this.store.revision(session.family, input.revision);
        requireValue(capabilities(saved.family).candidateExport, 'Consumer export is not available for this asset type');
        requireValue(typeof input.compiledSource === 'string' &&
            JSON.stringify(JSON.parse(input.compiledSource)) === JSON.stringify(JSON.parse(saved.source)), 'Export source differs from the saved revision; save the editor source first');
        const job = {id: randomUUID(), kind: 'export', family: session.family, revision: input.revision, sourceSha256: saved.record.source.sha256,
            session: session.id, author: person.id, toolchain: {editor: this.editor.id, extension: this.editor.manifest.extensionSha256, exporter: this.exporterSha256},
            status: 'running', startedAt: new Date().toISOString()};
        this.db.prepare('INSERT INTO workspace_jobs VALUES (?, ?)').run(job.id, JSON.stringify(job));
        const staging = mkdtempSync(join(tmpdir(), 'forge-candidate-'));
        try {
            const files = exportFiles(saved.family, input.result);
            for (const [path, content] of files) { if (path.endsWith('.png')) decodePNG(content); }
            const outputs = [...files].map(([path, content]) => ({path, sha256: sha256(content)})).sort((a, b) => a.path.localeCompare(b.path));
            const identity = {schema: 1, family: session.family, revision: input.revision, sourceSha256: saved.record.source.sha256,
                familySha256: saved.record.familySha256, toolchain: job.toolchain, outputs};
            const provenance = {schema: 1, producer: 'content-forge', family: session.family, revision: input.revision,
                source: saved.family.source, sourceSha256: saved.record.source.sha256, familySha256: saved.record.familySha256,
                blockbenchVersion: input.result.version, toolchain: job.toolchain,
                targets: outputs.map(output => ({target: output.path, sha256: output.sha256, producer: 'blockbench', recipe: `item-family:${session.family}`,
                    source: saved.family.source, source_sha256: saved.record.source.sha256,
                    group: saved.family.members.find(m => m.target === output.path || m.texture === output.path).group}))};
            files.set('provenance.json', bytes(provenance));
            const pack = join(staging, 'pack');
            for (const [path, content] of files) { const target = containedPath(pack, path); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, content); }
            const audit = auditPack(pack); requireValue(!audit.issues.length, 'Candidate dependency/provenance validation failed: ' + JSON.stringify(audit.issues));
            const cohort = {schema: 1, id: `items-${session.family}`, title: saved.family.title, description: saved.family.approach,
                entries: saved.family.members.map(member => ({id: member.id, kind: 'item', focus: 'Review material, silhouette, geometry, and inventory/held transforms.'}))};
            const cohortPath = join(staging, 'cohort.json'), output = join(staging, 'review.html'); writeFileSync(cohortPath, bytes(cohort));
            await this.sheetBuilder({cohortPath, roots: [pack], output, retainedSources: new Map([[`${saved.family.source}:${saved.record.source.sha256}`, saved.source]])});
            const evidence = JSON.parse(readFileSync(join(staging, 'review.json')));
            requireValue(evidence.entries.every(e => !e.issues.length), 'Review sheet has unresolved source or model dependencies');
            job.toolchain.renderer = evidence.renderer || {scope: 'injected test renderer'};
            const id = sha256(bytes(identity));
            files.set('review.html', readFileSync(output)); files.set('review.json', readFileSync(join(staging, 'review.json')));
            files.set('source.bbmodel', saved.source); files.set('family.json', saved.familyBytes); files.set('source-provenance.json', saved.provenance);
            const record = {id, ...identity, sheetSha256: sha256(files.get('review.html')), snapshot: evidence.snapshot,
                artifacts: [...files].map(([path, content]) => ({path, sha256: sha256(content)}))};
            this.store.transaction(() => {
                const existing = this.db.prepare('SELECT record FROM workspace_candidates WHERE id = ?').get(id);
                if (existing) {
                    requireValue(existing.record === JSON.stringify(record), 'Repeated candidate export changed its evidence');
                    for (const [path, content] of files) requireValue(this.artifact(id, path).equals(content), 'Repeated candidate bytes changed');
                } else {
                    this.db.prepare('INSERT INTO workspace_candidates VALUES (?, ?, ?, ?)').run(id, session.family, input.revision, JSON.stringify(record));
                    for (const [path, content] of files) this.db.prepare('INSERT INTO workspace_artifacts VALUES (?, ?, ?, ?)').run(id, path, sha256(content), content);
                }
                job.status = 'complete'; job.candidate = id; job.finishedAt = new Date().toISOString();
                this.db.prepare('UPDATE workspace_jobs SET record = ? WHERE id = ?').run(JSON.stringify(job), job.id);
            });
            return record;
        } catch (error) {
            job.status = 'failed'; job.error = error.message;
            this.db.prepare('UPDATE workspace_jobs SET record = ? WHERE id = ?').run(JSON.stringify(job), job.id); throw error;
        } finally { rmSync(staging, {recursive: true, force: true}); }
    }
    candidate(id) {
        const row = this.db.prepare('SELECT record FROM workspace_candidates WHERE id = ?').get(id);
        requireValue(row, 'Unknown candidate');
        const record = JSON.parse(row.record);
        const {id: recordId, sheetSha256, snapshot, artifacts, ...identity} = record;
        requireValue(recordId === sha256(bytes(identity)), 'Candidate identity changed');
        for (const entry of artifacts) requireValue(sha256(this.artifact(id, entry.path)) === entry.sha256, 'Candidate artifact hash mismatch');
        this.store.revision(record.family, record.revision);
        return record;
    }
    artifact(id, path) {
        const row = this.db.prepare('SELECT * FROM workspace_artifacts WHERE candidate = ? AND path = ?').get(id, path);
        requireValue(row && sha256(row.bytes) === row.hash, 'Candidate artifact is missing or changed'); return Buffer.from(row.bytes);
    }
    list() {
        return this.db.prepare('SELECT id FROM workspace_candidates ORDER BY rowid DESC').all().map(row => {
            const candidate = this.candidate(row.id);
            const reviews = this.db.prepare('SELECT record FROM workspace_reviews WHERE candidate = ? ORDER BY rowid').all(row.id).map(r => JSON.parse(r.record));
            const evidence = this.db.prepare('SELECT record FROM workspace_evidence WHERE candidate = ? ORDER BY rowid').all(row.id).map(r => JSON.parse(r.record));
            return {...candidate, current: this.store.head(candidate.family) === candidate.revision, reviews, evidence};
        });
    }
    review(person, id, input) {
        requireValue(person.role === 'reviewer', 'Reviewer access is required');
        const candidate = this.candidate(id);
        requireValue(input.snapshot === candidate.snapshot && input.sheetSha256 === candidate.sheetSha256, 'Review must name the exact candidate sheet');
        requireValue(['needs-work', 'reviewed', 'approved'].includes(input.decision) && typeof input.note === 'string' && input.note.trim(), 'A review decision and findings are required');
        requireValue(!this.db.prepare("SELECT record FROM workspace_jobs WHERE COALESCE(json_extract(record, '$.kind'), 'export') = 'export' AND json_extract(record, '$.candidate') = ? AND json_extract(record, '$.author') = ?").get(id, person.id), 'A candidate author cannot approve their own export');
        if (input.decision === 'approved') {
            requireValue(this.store.head(candidate.family) === candidate.revision, 'The family has a newer source revision');
            requireValue(Array.isArray(input.evidence) && input.evidence.length, 'Approval requires matching in-game evidence');
            for (const evidence of input.evidence) this.evidence(id, evidence);
        }
        const record = {id: randomUUID(), candidate: id, revision: candidate.revision, snapshot: candidate.snapshot, sheetSha256: candidate.sheetSha256,
            reviewer: {id: person.id, name: person.name}, decision: input.decision, note: input.note.trim(), evidence: input.evidence || [], createdAt: new Date().toISOString()};
        this.db.prepare('INSERT INTO workspace_reviews VALUES (?, ?, ?, ?)').run(record.id, id, person.id, JSON.stringify(record));
        return record;
    }
    evidence(candidateId, id) {
        const row = this.db.prepare('SELECT record FROM workspace_evidence WHERE candidate = ? AND id = ?').get(candidateId, id);
        requireValue(row, 'Evidence does not belong to this candidate');
        const record = JSON.parse(row.record);
        for (const file of record.files) {
            const stored = this.db.prepare('SELECT bytes FROM workspace_evidence_files WHERE evidence = ? AND path = ?').get(id, file.path);
            requireValue(stored && sha256(stored.bytes) === file.sha256, 'In-game evidence bytes are missing or changed');
        }
        return record;
    }
    attachEvidence(person, candidateId, bundle) {
        requireValue(['author', 'reviewer'].includes(person.role), 'Workspace access is required');
        const candidate = this.candidate(candidateId), {manifest, files} = bundle;
        requireValue(manifest?.schema === 1 && manifest.kind === 'content-forge-minosoft-evidence' && manifest.consumer?.name === 'Minosoft', 'Expected a Minosoft capture bundle');
        requireValue(manifest.candidate === candidateId && manifest.revision === candidate.revision && manifest.sourceSha256 === candidate.sourceSha256, 'Evidence source/candidate mismatch');
        requireValue(JSON.stringify(manifest.selectedTargets) === JSON.stringify(candidate.outputs), 'Evidence does not cover the exact candidate outputs');
        requireValue(manifest.profile?.consumer === 'Minosoft' && manifest.profile.minecraftVersion === '1.20.4' && manifest.profile.packFormat === 22, 'Unsupported consumer compatibility profile');
        requireValue(Array.isArray(files) && files.length > 0 && files.length <= 32 && Array.isArray(manifest.files), 'Invalid evidence files');
        const contents = new Map();
        for (const file of files) {
            containedPath('/evidence', file.path); requireValue(!contents.has(file.path) && typeof file.base64 === 'string', 'Duplicate or invalid evidence file');
            const data = Buffer.from(file.base64, 'base64'); requireValue(data.toString('base64') === file.base64, 'Invalid evidence encoding'); contents.set(file.path, data);
        }
        requireValue(contents.size === manifest.files.length && new Set(manifest.files.map(f => f.path)).size === contents.size, 'Incomplete evidence manifest');
        for (const file of manifest.files) requireValue(contents.has(file.path) && sha256(contents.get(file.path)) === file.sha256, 'Evidence file hash mismatch');
        const composition = JSON.parse(contents.get('composition.json')), provenance = JSON.parse(contents.get('composition-provenance.json'));
        requireValue(manifest.compositionFingerprint && composition.fingerprint === manifest.compositionFingerprint && provenance.fingerprint === composition.fingerprint, 'Composition identity mismatch');
        const family = this.store.revision(candidate.family, candidate.revision).family;
        requireValue(Array.isArray(manifest.captures) && manifest.captures.length === family.members.length && new Set(manifest.captures.map(c => c.member)).size === family.members.length, 'Capture every member of the family');
        for (const capture of manifest.captures) {
            const member = family.members.find(m => m.id === capture.member);
            requireValue(member && member.target === capture.target, 'Unexpected captured item');
            const metadata = JSON.parse(contents.get(capture.metadata));
            requireValue(metadata.asset === member.id && metadata.target === member.target && metadata.kind === 'item' && metadata.contentFingerprint === composition.fingerprint && metadata.strict === true && metadata.captures?.length, 'Capture metadata does not match the candidate composition');
            const frame = metadata.captures.find(frame => frame.sha256 === sha256(contents.get(capture.image)));
            requireValue(frame, 'Capture image does not match consumer metadata');
            requireValue(frame.placement?.function === 'content_preview:show_item' && frame.placement.executed > 0, 'Consumer did not execute the item placement function');
            const image = decodePNG(contents.get(capture.image)); requireValue(image.width >= 64 && image.height >= 64, 'In-game evidence must be a rendered capture');
        }
        const id = sha256(bytes(manifest)), record = {id, candidate: candidateId, revision: candidate.revision,
            profile: manifest.profile, consumer: manifest.consumer, compositionFingerprint: composition.fingerprint,
            captures: manifest.captures, files: manifest.files, attachedBy: {id: person.id, name: person.name}};
        this.store.transaction(() => {
            const existing = this.db.prepare('SELECT id FROM workspace_evidence WHERE id = ?').get(id);
            if (existing) { this.evidence(candidateId, id); return; }
            this.db.prepare('INSERT INTO workspace_evidence VALUES (?, ?, ?)').run(id, candidateId, JSON.stringify(record));
            for (const [path, content] of contents) this.db.prepare('INSERT INTO workspace_evidence_files VALUES (?, ?, ?, ?)').run(id, path, sha256(content), content);
        });
        return this.evidence(candidateId, id);
    }
    buildPack(person, selection) {
        requireValue(['author', 'reviewer'].includes(person.role), 'Workspace access is required');
        requireValue(Array.isArray(selection) && selection.length > 0 && selection.length <= 12 && new Set(selection).size === selection.length, 'Select 1–12 distinct approved candidates');
        const files = new Map(), selected = [], families = new Set(), provenanceTargets = []; let profile;
        for (const id of [...selection].sort()) {
            const candidate = this.candidate(id);
            requireValue(!families.has(candidate.family), 'Select one version of each family'); families.add(candidate.family);
            requireValue(this.store.head(candidate.family) === candidate.revision, 'Selected candidate has an unreviewed newer source');
            const latest = this.db.prepare('SELECT record FROM workspace_reviews WHERE candidate = ? ORDER BY rowid DESC LIMIT 1').get(id);
            const review = latest && JSON.parse(latest.record);
            requireValue(review?.decision === 'approved' && review.evidence.length, 'Selected candidate lacks current approval and consumer evidence');
            for (const evidenceId of review.evidence) {
                const evidence = this.evidence(id, evidenceId);
                if (profile) requireValue(JSON.stringify(profile) === JSON.stringify(evidence.profile), 'Selected candidates have incompatible consumer profiles');
                profile = evidence.profile;
            }
            for (const output of candidate.outputs) {
                const content = this.artifact(id, output.path);
                requireValue(!files.has(output.path), 'Selected families overlap output ownership'); files.set(output.path, content);
            }
            provenanceTargets.push(...JSON.parse(this.artifact(id, 'provenance.json')).targets);
            const source = this.store.revision(candidate.family, candidate.revision);
            files.set(`forge-sources/${candidate.family}.bbmodel`, source.source);
            files.set(`forge-sources/${candidate.family}.json`, source.familyBytes);
            files.set(`forge-sources/${candidate.family}-lineage.json`, source.provenance);
            selected.push({candidate: id, family: candidate.family, revision: candidate.revision, sourceSha256: candidate.sourceSha256,
                approval: review.id, reviewer: review.reviewer, evidence: review.evidence, toolchain: candidate.toolchain});
        }
        files.set('pack.mcmeta', bytes({pack: {pack_format: profile.packFormat, description: 'Content-forge approved asset selection'}}));
        files.set('provenance.json', bytes({schema: 1, producer: 'content-forge', targets: provenanceTargets}));
        files.set('NOTICE.md', Buffer.from('Content-forge authored assets and retained sources\nCopyright (C) 2026 Jacob Repp; GPL-3.0-or-later\nSee forge-sources/*-lineage.json for texture origins.\n'));
        const root = mkdtempSync(join(tmpdir(), 'forge-pack-check-'));
        try {
            for (const [path, content] of files) { const target = containedPath(root, path); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, content); }
            const audit = auditPack(root); requireValue(!audit.issues.length, 'Selected pack has unresolved dependencies or provenance: ' + JSON.stringify(audit.issues));
        } finally { rmSync(root, {recursive: true, force: true}); }
        const lock = {schema: 1, profile, selected, builderSha256: this.exporterSha256,
            files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({path, sha256: sha256(content)}))};
        const id = sha256(bytes(lock)); files.set('forge-lock.json', bytes(lock));
        const python = 'import sys,json,io,zipfile,base64\nf=json.load(sys.stdin);b=io.BytesIO()\nwith zipfile.ZipFile(b,"w",compression=zipfile.ZIP_STORED) as z:\n for p,v in sorted(f.items()):\n  i=zipfile.ZipInfo(p,date_time=(1980,1,1,0,0,0));i.create_system=3;i.external_attr=0o100644<<16;z.writestr(i,base64.b64decode(v))\nsys.stdout.buffer.write(b.getvalue())\n';
        const archive = execFileSync('python3', ['-c', python], {input: JSON.stringify(Object.fromEntries([...files].map(([path, content]) => [path, content.toString('base64')]))), maxBuffer: 64 * 1024 * 1024});
        const record = {id, ...lock, archiveSha256: sha256(archive), archiveBytes: archive.length};
        const existing = this.db.prepare('SELECT * FROM workspace_pack_builds WHERE id = ?').get(id);
        if (existing) requireValue(Buffer.from(existing.archive).equals(archive) && existing.record === JSON.stringify(record), 'Pack regeneration changed bytes');
        else this.db.prepare('INSERT INTO workspace_pack_builds VALUES (?, ?, ?)').run(id, JSON.stringify(record), archive);
        return record;
    }
    pack(id) {
        const row = this.db.prepare('SELECT * FROM workspace_pack_builds WHERE id = ?').get(id); requireValue(row, 'Unknown pack build');
        const record = JSON.parse(row.record); requireValue(sha256(row.archive) === record.archiveSha256, 'Pack archive changed');
        return {record, archive: Buffer.from(row.archive)};
    }
}
