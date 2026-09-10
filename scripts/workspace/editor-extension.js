// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
// Managed extension for the pinned Blockbench web build. No arbitrary commands
// are accepted through browser messages; the editor owns normal editing/Undo.
(async () => {
    const session = new URLSearchParams(location.search).get('forgeSession');
    if (!session) return;
    const build = location.pathname.split('/')[2], key = `forge-draft:${session}`;
    const instanceKey = `forge-instance:${session}`;
    const instance = sessionStorage.getItem(instanceKey) || crypto.randomUUID(); sessionStorage.setItem(instanceKey, instance);
    let attached, owned, revision, baseline, draftDB, pending = null, busy = false, sequence = 0;
    const toolbar = document.createElement('div'); toolbar.id = 'forge-workspace-toolbar';
    toolbar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:10000;background:#1b2839;color:#e6efff;display:flex;align-items:center;gap:12px;padding:10px 18px;border-top:1px solid #6380a4';
    const status = document.createElement('span'); status.style.flex = '1'; status.textContent = 'Connecting to content-forge…'; toolbar.append(status);
    const saveButton = document.createElement('button'); saveButton.textContent = 'Save to content-forge'; saveButton.disabled = true;
    const buildButton = document.createElement('button'); buildButton.textContent = 'Build review candidate'; buildButton.disabled = true;
    const returnButton = document.createElement('button'); returnButton.textContent = 'Return to workspace'; returnButton.onclick = () => window.open('/', '_blank');
    toolbar.append(saveButton, buildButton, returnButton); document.body.append(toolbar);
    const bytes = text => new TextEncoder().encode(text);
    const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('');
    const encode = text => { let binary = ''; for (const byte of bytes(text)) binary += String.fromCharCode(byte); return btoa(binary); };
    const decode = text => new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
    const binding = () => ({instance, generation: attached.generation, project: owned.uuid});
    const verifyProject = () => { if (Project !== owned || !owned) throw new Error('Switch back to the workspace-owned project before continuing.'); };
    async function api(method, input) {
        const response = await fetch(`/api/editor-sessions/${session}/${method}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)});
        const result = await response.json();
        if (!response.ok && result.status !== 'conflict') throw new Error(result.error || `${method} failed`);
        return result;
    }
    async function send(method, params = {}) {
        if (owned) verifyProject();
        const response = await AutomationRuntime.send({protocol_version: 1, id: `forge-${++sequence}`, method, params});
        if (!response.ok || response.result?.ok === false || ['error', 'unavailable', 'too_large'].includes(response.result?.status)) throw new Error(`${method}: ${JSON.stringify(response.error || response.result)}`);
        return response.result;
    }
    function draftOperation(mode, value) {
        return new Promise((resolve, reject) => {
            const transaction = draftDB.transaction('drafts', mode === 'read' ? 'readonly' : 'readwrite'), store = transaction.objectStore('drafts');
            const request = mode === 'read' ? store.get(key) : mode === 'remove' ? store.delete(key) : store.put(value, key);
            transaction.oncomplete = () => resolve(request.result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('Draft checkpoint interrupted'));
        });
    }
    async function retainDraft() {
        if (!owned || Project !== owned) return;
        const source = Codecs.project.compile();
        if (source !== baseline || pending) {
            await draftOperation('write', {source, revision, pending});
        }
    }
    async function exclusive(action) {
        if (busy) return; busy = true; saveButton.disabled = buildButton.disabled = true;
        try { verifyProject(); await action(); }
        catch (error) { status.textContent = error.message; try { await retainDraft(); } catch {} }
        finally { busy = false; saveButton.disabled = buildButton.disabled = false; }
    }
    async function save() {
        verifyProject();
        if (!pending) {
            const exported = await send('export_model', {codec: 'project', max_bytes: 8 * 1024 * 1024});
            pending = {expectedRevision: revision, sourceBase64: encode(exported.content), requestId: crypto.randomUUID()};
            await retainDraft();
        }
        status.textContent = 'Saving source revision…';
        const savedSource = decode(pending.sourceBase64), result = await api('save', {...binding(), ...pending});
        verifyProject();
        if (result.status === 'conflict') {
            pending = null; await retainDraft();
            status.textContent = `Conflict: your draft ${result.revision.slice(0, 12)} was preserved. Open the current revision from the workspace to merge edits.`;
            return result;
        }
        revision = result.revision; baseline = savedSource; pending = null;
        const currentSource = Codecs.project.compile();
        if (currentSource === baseline) { await draftOperation('remove'); localStorage.removeItem(key); owned.saved = true; }
        else await retainDraft();
        status.textContent = `Saved ${revision.slice(0, 12)}${currentSource === baseline ? '' : ' · newer edits remain unsaved'}`;
        window.opener?.postMessage({type: 'forge:saved', session, instance, revision}, location.origin);
        return result;
    }
    async function exportCandidate() {
        verifyProject();
        if (pending || Codecs.project.compile() !== baseline) throw new Error('Save the current edits before building a candidate.');
        status.textContent = 'Exporting the saved revision through Blockbench…';
        const observation = await send('observe_project');
        const models = await send('export_models', {codec: 'java_block', groups: attached.family.members.map(m => m.group), max_bytes: 8 * 1024 * 1024});
        const textures = [];
        for (const texture of Texture.all) textures.push(await send('export_texture', {uuid: texture.uuid, max_bytes: 1024 * 1024}));
        verifyProject();
        if ((await send('observe_project')).revision !== observation.revision || Codecs.project.compile() !== baseline) throw new Error('Source changed during export. Save and build again.');
        const result = await api('export', {...binding(), revision, compiledSource: baseline, requestId: crypto.randomUUID(), result: {models: models.models, textures, version: Blockbench.version}});
        status.textContent = `Candidate ${result.id.slice(0, 12)} is ready for review.`;
        window.opener?.postMessage({type: 'forge:candidate', session, instance, candidate: result.id}, location.origin);
        return result;
    }
    try {
        for (let i = 0; i < 300 && (!window.AutomationRuntime || !window.Blockbench?.setup_successful || !window.AutoBackup?.db); i++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!window.AutomationRuntime || !window.Blockbench?.setup_successful || !window.AutoBackup?.db) throw new Error('The pinned editor or its browser backup storage did not finish loading.');
        draftDB = await new Promise((resolve, reject) => {
            const request = indexedDB.open('forge_workspace_drafts', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('drafts');
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('Close the other workspace editor tab to upgrade draft storage.'));
        });
        if (ModelProject.all.length) throw new Error('The workspace requires a dedicated editor tab with no open project.');
        attached = await api('attach', {instance, build}); revision = attached.revision.id;
        const original = decode(attached.sourceBase64);
        if (await hash(bytes(original)) !== attached.revision.source.sha256) throw new Error('Source download hash mismatch');
        await send('load_project', {codec: 'project', name: attached.family.id, content: original}); owned = Project;
        baseline = Codecs.project.compile();
        const recovery = await draftOperation('read') || JSON.parse(localStorage.getItem(key) || 'null');
        if (recovery) {
            // This tab has just loaded the acknowledged base. Closing this
            // untouched project is safe; no user's existing tab is involved.
            await owned.close(true); owned = null;
            await send('load_project', {codec: 'project', name: attached.family.id, content: recovery.source}); owned = Project;
            revision = recovery.revision; pending = recovery.pending; owned.saved = false;
        }
        await api('ready', {...binding(), sourceSha256: attached.revision.source.sha256});
        const checkpoint = () => retainDraft().catch(error => { status.textContent = `Local draft recovery failed: ${error.message}`; });
        Blockbench.on('finished_edit', () => { checkpoint(); if (!busy) status.textContent = 'Unsaved workspace edits'; });
        window.addEventListener('beforeunload', checkpoint);
        // A heartbeat also retains non-Undo changes, including display settings.
        setInterval(checkpoint, 2000);
        saveButton.disabled = buildButton.disabled = false;
        status.textContent = recovery ? 'Recovered local edits. Save to acknowledge them in the workspace.' : `Opened ${attached.family.title} · ${revision.slice(0, 12)}`;
        saveButton.onclick = () => exclusive(save); buildButton.onclick = () => exclusive(exportCandidate);
        // Only informational replies go to the verified opener. Incoming
        // messages never execute editor commands or change session bindings.
        window.opener?.postMessage({type: 'forge:ready', session, instance, revision}, location.origin);
        window.ForgeWorkspace = {get state() { return {session, instance, revision, project: owned?.uuid, busy, status: status.textContent}; }};
    } catch (error) { status.textContent = error.message; }
})();
