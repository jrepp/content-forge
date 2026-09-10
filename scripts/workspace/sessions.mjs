// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import {randomBytes, randomUUID} from 'node:crypto';
import {capabilities} from './families.mjs';
import {sha256} from '../asset-files.mjs';
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const token = () => randomBytes(32).toString('base64url');
const now = () => Date.now();
export class WorkspaceSessions {
    constructor(store, editor) {
        this.store = store; this.db = store.db; this.editor = editor;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workspace_people (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS workspace_invites (hash TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES workspace_people(id), expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_logins (hash TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES workspace_people(id), expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS editor_sessions (id TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES workspace_people(id), family TEXT NOT NULL REFERENCES families(id),
                revision TEXT NOT NULL REFERENCES revisions(id), build TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
                instance TEXT, generation TEXT, project TEXT, state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS editor_session_revisions (session TEXT NOT NULL REFERENCES editor_sessions(id), revision TEXT NOT NULL REFERENCES revisions(id), PRIMARY KEY (session, revision));
        `);
    }
    invite({name, role}) {
        requireValue(typeof name === 'string' && name.trim() && name.length <= 200, 'A person name is required');
        requireValue(['author', 'reviewer'].includes(role), 'Role must be author or reviewer');
        const id = randomUUID(), secret = token();
        this.store.transaction(() => {
            this.db.prepare('INSERT INTO workspace_people VALUES (?, ?, ?, 0)').run(id, name.trim(), role);
            this.db.prepare('INSERT INTO workspace_invites VALUES (?, ?, ?)').run(sha256(secret), id, now() + 15 * 60 * 1000);
        });
        return {id, name: name.trim(), role, token: secret, expiresInMinutes: 15};
    }
    login(secret) {
        requireValue(typeof secret === 'string', 'Enter an access token');
        return this.store.transaction(() => {
            const invite = this.db.prepare('SELECT * FROM workspace_invites WHERE hash = ?').get(sha256(secret));
            requireValue(invite && invite.expires > now(), 'Access token is invalid or expired');
            const person = this.person(invite.person), loginToken = token();
            this.db.prepare('DELETE FROM workspace_invites WHERE hash = ?').run(invite.hash);
            this.db.prepare('INSERT INTO workspace_logins VALUES (?, ?, ?)').run(sha256(loginToken), person.id, now() + 12 * 60 * 60 * 1000);
            return {person, secret: loginToken};
        });
    }
    person(id) {
        const person = this.db.prepare('SELECT * FROM workspace_people WHERE id = ?').get(id);
        requireValue(person && !person.revoked, 'Workspace access has been revoked'); return person;
    }
    authenticate(secret) {
        const login = this.db.prepare('SELECT * FROM workspace_logins WHERE hash = ?').get(sha256(secret || ''));
        requireValue(login && login.expires > now(), 'Sign in to the workspace'); return this.person(login.person);
    }
    revokePerson(id) { this.db.prepare('UPDATE workspace_people SET revoked = 1 WHERE id = ?').run(id); }
    launch(person, family, revision) {
        this.person(person.id); requireValue(person.role === 'author', 'Author access is required');
        requireValue(this.editor, 'Build the hosted editor with npm run workspace:editor-build');
        this.store.revision(family, revision);
        const id = randomUUID();
        this.store.transaction(() => {
            this.db.prepare('INSERT INTO editor_sessions (id, person, family, revision, build, expires, state) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(id, person.id, family, revision, this.editor.id, now() + 12 * 60 * 60 * 1000, 'launched');
            this.db.prepare('INSERT INTO editor_session_revisions VALUES (?, ?)').run(id, revision);
        });
        return {id, family, revision, build: this.editor.id, url: `/editor/${this.editor.id}/index.html?forgeSession=${id}`};
    }
    session(person, id) {
        this.person(person.id);
        const session = this.db.prepare('SELECT * FROM editor_sessions WHERE id = ?').get(id);
        requireValue(session && session.person === person.id && !session.revoked && session.expires > now(), 'Editor session is unavailable or revoked');
        requireValue(this.editor && session.build === this.editor.id, 'Editor session build is unavailable'); return session;
    }
    attach(person, id, {instance, build}) {
        requireValue(typeof instance === 'string' && /^[a-f0-9-]{36}$/.test(instance), 'Invalid editor instance');
        return this.store.transaction(() => {
            const session = this.session(person, id);
            requireValue(build === session.build && (!session.instance || session.instance === instance), 'Wrong editor instance or build');
            const generation = randomUUID();
            this.db.prepare("UPDATE editor_sessions SET instance = ?, generation = ?, project = NULL, state = 'opening' WHERE id = ?").run(instance, generation, id);
            const saved = this.store.revision(session.family, session.revision);
            return {protocol: 1, session: id, generation, family: saved.family, revision: saved.record,
                sourceBase64: saved.source.toString('base64'), build: this.editor.id, toolchain: this.editor.manifest,
                capabilities: capabilities(saved.family),
                methods: ['ready', 'save', ...(capabilities(saved.family).candidateExport ? ['export'] : []), 'revoke']};
        });
    }
    bound(person, id, input, ready = true) {
        const session = this.session(person, id);
        requireValue(input.instance === session.instance && input.generation === session.generation, 'Wrong editor instance or session generation');
        if (ready) requireValue(session.state === 'ready' && input.project === session.project, 'Wrong active editor project');
        return session;
    }
    ready(person, id, input) {
        const session = this.bound(person, id, input, false), saved = this.store.revision(session.family, session.revision);
        requireValue(input.sourceSha256 === saved.record.source.sha256 && typeof input.project === 'string' && /^[a-f0-9-]{36}$/.test(input.project), 'Loaded source or project identity mismatch');
        requireValue(session.state === 'opening', 'Session has already attached a project');
        this.db.prepare("UPDATE editor_sessions SET project = ?, state = 'ready' WHERE id = ?").run(input.project, id);
        return {status: 'ready', revision: session.revision};
    }
    save(person, id, input) {
        const session = this.bound(person, id, input);
        requireValue(this.db.prepare('SELECT revision FROM editor_session_revisions WHERE session = ? AND revision = ?').get(id, input.expectedRevision), 'Save is not based on a revision opened by this session');
        requireValue(typeof input.sourceBase64 === 'string', 'Source bytes are required');
        const source = Buffer.from(input.sourceBase64, 'base64');
        requireValue(source.toString('base64') === input.sourceBase64, 'Invalid source encoding');
        const result = this.store.save({familyId: session.family, expectedRevision: input.expectedRevision, source, author: person.name, requestId: input.requestId});
        // An interrupted acknowledgment is recoverable through store.save's
        // idempotent request record, including if this session update did not run.
        this.db.prepare('INSERT OR IGNORE INTO editor_session_revisions VALUES (?, ?)').run(id, result.revision);
        if (result.status === 'saved') this.db.prepare('UPDATE editor_sessions SET revision = ? WHERE id = ?').run(result.revision, id);
        return {...result, sourceSha256: sha256(source)};
    }
    revoke(person, id) { this.session(person, id); this.db.prepare('UPDATE editor_sessions SET revoked = 1 WHERE id = ?').run(id); return {status: 'revoked'}; }
}
