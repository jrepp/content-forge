// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, mkdirSync, readdirSync, existsSync, realpathSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sha256, containedPath} from '../asset-files.mjs';
import {validateFamily} from '../../producers/blockbench/item-family.mjs';

export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const jsonBytes = value => Buffer.from(JSON.stringify(value));
function requireValue(condition, message) { if (!condition) throw new Error(message); }

// This first revision lane accepts self-contained projects only. It never reads
// texture paths from an uploaded project or silently loses external dependencies.
export function inspectSource(bytes, codec) {
    requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_SOURCE_BYTES, 'Source must be 1 byte–8 MiB');
    const model = JSON.parse(bytes.toString('utf8'));
    requireValue(model?.meta?.model_format === codec && Array.isArray(model.elements) && Array.isArray(model.textures), 'Invalid Blockbench source or family codec');
    const dependencies = model.textures.map(texture => {
        const encoded = texture.source?.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/)?.[1];
        requireValue(encoded, 'Textures must be embedded PNGs; external dependencies are not supported yet');
        const data = Buffer.from(encoded, 'base64');
        requireValue(data.toString('base64') === encoded && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Invalid embedded PNG');
        return {uuid: texture.uuid ?? null, name: texture.name ?? null, sha256: sha256(data), bytes: data.length, storage: 'embedded'};
    });
    return {sha256: sha256(bytes), bytes: bytes.length, dependencies};
}

function localFile(root, target) {
    const path = containedPath(root, target);
    const rel = relative(realpathSync(root), realpathSync(path));
    requireValue(rel && !rel.startsWith('../') && rel !== '..', 'File escapes its root');
    return path;
}

export class WorkspaceStore {
    constructor({repoRoot, path = join(repoRoot, '.forge-workspace/workspace.sqlite')}) {
        this.repoRoot = repoRoot;
        mkdirSync(dirname(path), {recursive: true});
        this.db = new DatabaseSync(path);
        this.db.exec(`
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            CREATE TABLE IF NOT EXISTS revisions (
                id TEXT PRIMARY KEY, family_id TEXT NOT NULL,
                parent_id TEXT REFERENCES revisions(id), record TEXT NOT NULL,
                source BLOB NOT NULL, family BLOB NOT NULL, provenance BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, head TEXT NOT NULL REFERENCES revisions(id));
            CREATE TABLE IF NOT EXISTS saves (
                family_id TEXT NOT NULL REFERENCES families(id), request_id TEXT NOT NULL,
                input_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (family_id, request_id)
            );
            CREATE TRIGGER IF NOT EXISTS revisions_no_update BEFORE UPDATE ON revisions
                BEGIN SELECT RAISE(ABORT, 'Source revisions are immutable'); END;
            CREATE TRIGGER IF NOT EXISTS revisions_no_delete BEFORE DELETE ON revisions
                BEGIN SELECT RAISE(ABORT, 'Source revisions are immutable'); END;
        `);
    }
    close() { this.db.close(); }
    transaction(run) {
        this.db.exec('BEGIN IMMEDIATE');
        try { const result = run(); this.db.exec('COMMIT'); return result; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    head(id) {
        const row = this.db.prepare('SELECT head FROM families WHERE id = ?').get(id);
        requireValue(row, 'Unknown family');
        return row.head;
    }
    revision(familyId, id) {
        const row = this.db.prepare('SELECT * FROM revisions WHERE family_id = ? AND id = ?').get(familyId, id);
        requireValue(row, 'Unknown source revision for family');
        const record = JSON.parse(row.record);
        for (const [key, expected] of [['source', record.source.sha256], ['family', record.familySha256], ['provenance', record.provenanceSha256]]) {
            requireValue(sha256(row[key]) === expected, `Stored ${key} hash mismatch`);
        }
        const {id: recordId, ...identity} = record;
        requireValue(recordId === id && sha256(jsonBytes(identity)) === id, 'Revision identity mismatch');
        return {record, source: Buffer.from(row.source), family: JSON.parse(Buffer.from(row.family).toString()),
            familyBytes: Buffer.from(row.family), provenance: Buffer.from(row.provenance)};
    }
    insert({familyId, parent, source, familyBytes, provenance, author, baseCommit, checkoutSourceSha256, requestId}) {
        const family = JSON.parse(familyBytes);
        const identity = {schema: 1, familyId, parent, source: inspectSource(source, family.codec),
            familySha256: sha256(familyBytes), provenanceSha256: sha256(provenance), author,
            baseCommit, checkoutSourceSha256, createdAt: new Date().toISOString(), requestId};
        const id = sha256(jsonBytes(identity)), record = {id, ...identity};
        this.db.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, familyId, parent, JSON.stringify(record), source, familyBytes, provenance);
        return record;
    }
    initialize({author}) {
        requireValue(typeof author === 'string' && author.trim() && author.length <= 200, 'A local author name is required');
        const root = join(this.repoRoot, 'producers/blockbench/items');
        const paths = readdirSync(root, {withFileTypes: true}).filter(d => d.isDirectory())
            .map(d => join('producers/blockbench/items', d.name, 'family.json')).filter(p => existsSync(join(this.repoRoot, p))).sort();
        const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: this.repoRoot, encoding: 'utf8'}).trim();
        return this.transaction(() => paths.map(path => {
            const familyBytes = readFileSync(localFile(this.repoRoot, path)), family = JSON.parse(familyBytes);
            validateFamily(family);
            if (this.db.prepare('SELECT id FROM families WHERE id = ?').get(family.id)) return {family: family.id, status: 'existing', head: this.head(family.id)};
            const source = readFileSync(localFile(this.repoRoot, family.source));
            const provenance = readFileSync(localFile(this.repoRoot, join(dirname(family.source), 'source-provenance.json')));
            JSON.parse(provenance);
            const record = this.insert({familyId: family.id, parent: null, source, familyBytes, provenance,
                author: author.trim(), baseCommit, checkoutSourceSha256: sha256(source), requestId: randomUUID()});
            this.db.prepare('INSERT INTO families VALUES (?, ?)').run(family.id, record.id);
            return {family: family.id, status: 'imported', head: record.id};
        }));
    }
    save({familyId, expectedRevision, source, author, requestId}) {
        requireValue(typeof author === 'string' && author.trim() && author.length <= 200, 'A local author name is required');
        requireValue(typeof requestId === 'string' && /^[A-Za-z0-9-]{16,100}$/.test(requestId), 'A stable request ID is required');
        requireValue(Buffer.isBuffer(source) && source.length <= MAX_SOURCE_BYTES, 'Source exceeds 8 MiB');
        const inputHash = sha256(jsonBytes([expectedRevision, sha256(source), author.trim()]));
        return this.transaction(() => {
            const head = this.head(familyId);
            const previous = this.db.prepare('SELECT * FROM saves WHERE family_id = ? AND request_id = ?').get(familyId, requestId);
            if (previous) {
                requireValue(previous.input_hash === inputHash, 'Request ID was already used for different content');
                return JSON.parse(previous.result);
            }
            const base = this.revision(familyId, expectedRevision);
            const record = this.insert({familyId, parent: expectedRevision, source, familyBytes: base.familyBytes,
                provenance: base.provenance, author: author.trim(), baseCommit: base.record.baseCommit,
                checkoutSourceSha256: base.record.checkoutSourceSha256, requestId});
            const status = head === expectedRevision ? 'saved' : 'conflict';
            if (status === 'saved') this.db.prepare('UPDATE families SET head = ? WHERE id = ?').run(record.id, familyId);
            const result = {status, revision: record.id, head: status === 'saved' ? record.id : head};
            this.db.prepare('INSERT INTO saves VALUES (?, ?, ?, ?)').run(familyId, requestId, inputHash, JSON.stringify(result));
            return result;
        });
    }
    candidate(family, record) {
        const root = join(this.repoRoot, 'work/item-families', family.id);
        if (!existsSync(join(root, 'latest.json'))) return {status: 'none'};
        try {
            const latest = JSON.parse(readFileSync(localFile(root, 'latest.json')));
            requireValue(latest.family === family.id, 'Candidate family mismatch');
            const pack = localFile(join(root, 'exports'), relative(join(root, 'exports'), latest.pack));
            const provenance = JSON.parse(readFileSync(localFile(pack, 'provenance.json')));
            requireValue(provenance.family === family.id && provenance.sourceSha256 === latest.sourceSha256, 'Candidate provenance mismatch');
            const expected = family.members.flatMap(m => [m.target, m.texture]);
            requireValue(Array.isArray(provenance.targets) && provenance.targets.length === expected.length &&
                new Set(provenance.targets.map(t => t.target)).size === expected.length, 'Incomplete candidate manifest');
            for (const target of provenance.targets) {
                requireValue(expected.includes(target.target), 'Unexpected candidate target');
                requireValue(sha256(readFileSync(localFile(pack, target.target))) === target.sha256, 'Candidate file hash mismatch');
            }
            return {status: provenance.sourceSha256 === record.source.sha256 && provenance.familySha256 === record.familySha256 ? 'current' : 'stale',
                sourceSha256: provenance.sourceSha256, fingerprint: sha256(readFileSync(localFile(pack, 'provenance.json'))),
                path: relative(this.repoRoot, pack), models: family.members.length};
        } catch (error) { return {status: 'unavailable', issue: error.message}; }
    }
    catalog() {
        return this.db.prepare('SELECT * FROM families ORDER BY id').all().map(row => {
            const {record, family} = this.revision(row.id, row.head);
            let checkoutMatchesHead = false;
            try { checkoutMatchesHead = sha256(readFileSync(localFile(this.repoRoot, family.source))) === record.source.sha256; } catch {}
            const history = this.db.prepare('SELECT record FROM revisions WHERE family_id = ? ORDER BY rowid DESC').all(row.id).map(r => JSON.parse(r.record));
            const conflicts = this.db.prepare('SELECT result FROM saves WHERE family_id = ?').all(row.id)
                .map(r => JSON.parse(r.result)).filter(r => r.status === 'conflict').map(r => r.revision);
            return {id: row.id, title: family.title, description: family.approach, members: family.members.map(m => m.id),
                sourcePath: family.source, head: record, history, conflicts, checkoutMatchesHead, candidate: this.candidate(family, record)};
        });
    }
}
