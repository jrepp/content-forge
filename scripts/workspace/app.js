// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
};
const short = id => id.slice(0, 12);
let currentPerson = null, authRequired = false, editorBuild = null;
const selectedCandidates = new Set();
const editors = new Map();
window.addEventListener('message', event => {
    if (event.origin !== location.origin || !['forge:ready', 'forge:saved', 'forge:candidate'].includes(event.data?.type)) return;
    const editor = editors.get(event.data.session);
    if (!editor || event.source !== editor.window || (editor.instance && editor.instance !== event.data.instance)) return;
    editor.instance = event.data.instance;
    if (event.data.type !== 'forge:ready') load().catch(error => { document.querySelector('#loading').textContent = error.message; });
});
async function api(path, input) {
    const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)});
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Operation failed'); return result;
}
async function identity() {
    const info = await fetch('/api/identity').then(r => r.json());
    currentPerson = info.person; authRequired = info.authenticated; editorBuild = info.editor;
    const host = document.querySelector('#identity'); host.replaceChildren();
    if (currentPerson) {
        host.append(el('p', `${currentPerson.name} · ${currentPerson.role}`));
        const logout = el('button', 'Sign out'); logout.onclick = async () => { await api('/api/logout', {}); location.reload(); }; host.append(logout);
    } else if (authRequired) {
        const form = el('form'), label = el('label', 'Workspace access token'), input = el('input'), message = el('p');
        input.type = 'password'; input.required = true; input.autocomplete = 'off'; label.append(input);
        const button = el('button', 'Sign in'); button.type = 'submit';
        form.append(label, button, message);
        form.onsubmit = async event => { event.preventDefault(); try { await api('/api/login', {token: input.value}); await identity(); await load(); } catch (error) { message.textContent = error.message; } };
        host.append(el('p', 'Use the one-time access token provided by the workspace operator.'), form);
    }
}
function download(family, revision, kind, label) {
    const a = el('a', label);
    a.href = `/api/families/${family}/revisions/${revision}/${kind}`;
    return a;
}
function renderFamily(family) {
    const card = el('article');
    card.append(el('h2', family.title), el('p', family.description));
    const members = el('div', undefined, 'members');
    for (const member of family.members) members.append(el('span', member.replace('minecraft:', '').replaceAll('_', ' ')));
    card.append(members);
    const summary = el('div', undefined, 'summary'), source = el('section'), candidate = el('section');
    source.append(el('h3', 'Current source'), el('code', short(family.head.id)), el('p', `Saved by ${family.head.author} · ${new Date(family.head.createdAt).toLocaleString()}`),
        download(family.id, family.head.id, 'source', 'Download Blockbench source'));
    if (!family.checkoutMatchesHead) source.append(el('p', 'Workspace edits are saved separately from the repository source.', 'state'));
    const labels = {unsupported: 'Source editing available · consumer export pending', none: 'No candidate yet', current: 'Candidate matches this source', stale: 'Candidate uses an earlier source or family definition', unavailable: 'Candidate could not be verified'};
    candidate.append(el('h3', 'Latest candidate'), el('p', labels[family.candidate.status], 'state'));
    if (family.candidate.path) candidate.append(el('code', family.candidate.path));
    if (family.candidate.issue) candidate.append(el('p', family.candidate.issue, 'error'));
    summary.append(source, candidate); card.append(summary);
    if (family.animationReview) {
        const review = el('a', family.animationReview.status === 'current' ? 'Review animations' : 'Review animations from an earlier source');
        review.href = `/api/animation-reviews/${family.animationReview.id}/index.html`;
        card.append(review);
    }
    if (currentPerson?.role === 'author' && editorBuild) {
        const launch = el('button', 'Edit in Blockbench'), editorStatus = el('p');
        launch.onclick = async () => {
            const windowRef = window.open('about:blank', '_blank');
            if (!windowRef) { editorStatus.textContent = 'Allow a new tab to open the editor.'; return; }
            try {
                const session = await api(`/api/families/${family.id}/editor-sessions`, {revision: family.head.id});
                editors.set(session.id, {window: windowRef, instance: null}); windowRef.location = session.url;
                const revoke = el('button', 'Disconnect editor session');
                revoke.onclick = async () => { try { await api(`/api/editor-sessions/${session.id}/revoke`, {}); editorStatus.textContent = 'Session disconnected. Unsaved editor work remains available locally.'; revoke.remove(); } catch (error) { editorStatus.textContent = error.message; } };
                card.append(revoke); editorStatus.textContent = 'Editor opened with the selected source revision.';
            } catch (error) { windowRef.close(); editorStatus.textContent = error.message; }
        };
        card.append(launch, editorStatus);
    }

    const savePanel = el('details'), form = el('form'), message = el('p', '', 'message'); message.setAttribute('role', 'status');
    savePanel.append(el('summary', 'Save an edited source'), el('p', 'Download the current source, edit and save it in Blockbench, then upload the .bbmodel here. A competing save preserves your upload as a separate draft.'));
    const authorLabel = el('label', 'Your name'), author = el('input'); author.required = true; author.maxLength = 200; author.autocomplete = 'name';
    authorLabel.append(author);
    const fileLabel = el('label', 'Edited Blockbench source'), file = el('input'); file.type = 'file'; file.accept = '.bbmodel'; file.required = true; fileLabel.append(file);
    const button = el('button', 'Save source revision'); button.type = 'submit';
    form.append(authorLabel, fileLabel, el('p', `Based on revision ${short(family.head.id)}. Textures must be embedded in the source.`), button, message);
    let pending = null;
    const resetRequest = () => { pending = null; };
    file.addEventListener('change', resetRequest); author.addEventListener('input', resetRequest);
    form.addEventListener('submit', async event => {
        event.preventDefault(); button.disabled = true; file.disabled = true; author.disabled = true;
        try {
            const selected = file.files[0];
            if (!selected || selected.size > 8 * 1024 * 1024) throw new Error('Choose a .bbmodel of up to 8 MiB.');
            if (!pending) {
                const sourceBase64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(selected);
                });
                pending = {expectedRevision: family.head.id, sourceBase64, author: author.value, requestId: crypto.randomUUID()};
            }
            message.textContent = 'Saving source…';
            const response = await fetch(`/api/families/${family.id}/revisions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(pending)});
            const result = await response.json();
            if (!response.ok && result.status !== 'conflict') throw new Error(result.error || 'Save failed');
            const notice = result.status === 'conflict'
                ? `Another save arrived first. Your draft ${short(result.revision)} is preserved in revision history. Download both sources and merge your edits before saving again.`
                : `Saved revision ${short(result.revision)}. You can download and reopen it now.`;
            await load(notice);
        } catch (error) { message.textContent = `${error.message}\nYour file is still selected. Retry uses the same save request.`; }
        finally { button.disabled = false; file.disabled = false; author.disabled = false; }
    });
    savePanel.append(form); if (!currentPerson || currentPerson.role === 'author') card.append(savePanel);
    const history = el('details'), list = el('ol'); history.append(el('summary', `Revision history · ${family.history.length}`));
    for (const revision of family.history) {
        const item = el('li'), label = revision.id === family.head.id ? 'Current' : family.conflicts.includes(revision.id) ? 'Preserved conflict draft' : 'Previous revision';
        item.append(el('strong', `${label} · ${short(revision.id)}`), el('p', `${revision.author} · ${new Date(revision.createdAt).toLocaleString()}`));
        if (revision.parent) item.append(el('p', `Based on ${short(revision.parent)}`));
        const links = el('div', undefined, 'actions');
        for (const [kind, title] of [['source', 'Source'], ['family', 'Family definition'], ['provenance', 'Source lineage']]) links.append(download(family.id, revision.id, kind, title));
        item.append(links); list.append(item);
    }
    history.append(list); card.append(history); return card;
}
function renderCandidate(candidate) {
    const card = el('article'); card.append(el('h2', `${candidate.family} · candidate ${short(candidate.id)}`));
    const latest = candidate.reviews.at(-1);
    card.append(el('p', `${candidate.current ? 'Current source' : 'Earlier source revision'} · ${latest?.decision || 'Awaiting review'}`, 'state'));
    const sheet = el('a', 'Open model and texture review sheet'); sheet.href = `/api/candidates/${candidate.id}/artifacts/review.html`; sheet.target = '_blank'; card.append(sheet);
    for (const review of candidate.reviews) card.append(el('p', `${review.reviewer.name}: ${review.decision} — ${review.note}`));
    const evidenceList = el('div', undefined, 'actions');
    for (const evidence of candidate.evidence) for (const capture of evidence.captures) {
        const link = el('a', `Minosoft: ${capture.member.replace('minecraft:', '')}`); link.href = `/api/candidates/${candidate.id}/evidence/${evidence.id}/${capture.image}`; link.target = '_blank'; evidenceList.append(link);
    }
    card.append(evidenceList);
    const message = el('p', '', 'message'); message.setAttribute('role', 'status');
    if (currentPerson) {
        const captureButton = el('button', 'Validate in Minosoft');
        captureButton.onclick = async () => {
            captureButton.disabled = true;
            try {
                const job = await api(`/api/candidates/${candidate.id}/captures`, {}); message.textContent = 'Launching isolated Minosoft validation…';
                const timer = setInterval(async () => {
                    try {
                        const jobs = await fetch('/api/jobs').then(r => r.json()), current = jobs.jobs.find(j => j.id === job.id);
                        if (!current) return;
                        message.textContent = current.error || current.progress || current.status;
                        if (current.status !== 'running') { clearInterval(timer); captureButton.disabled = false; if (current.status === 'complete') await load('Minosoft evidence attached. Review the captured images before approving.'); }
                    } catch (error) { clearInterval(timer); captureButton.disabled = false; message.textContent = error.message; }
                }, 2000);
            } catch (error) { captureButton.disabled = false; message.textContent = error.message; }
        };
        card.append(captureButton);
        const attach = el('details'); attach.append(el('summary', 'Attach an existing Minosoft evidence bundle'));
        const input = el('input'); input.type = 'file'; input.accept = '.json';
        input.onchange = async () => { try { await api(`/api/candidates/${candidate.id}/evidence`, JSON.parse(await input.files[0].text())); await load('Evidence attached to the exact candidate.'); } catch (error) { message.textContent = error.message; } };
        attach.append(input); card.append(attach);
    }
    if (currentPerson?.role === 'reviewer') {
        const form = el('form'), decisionLabel = el('label', 'Review decision'), decision = el('select');
        for (const [value, text] of [['reviewed', 'Reviewed'], ['needs-work', 'Needs work'], ['approved', 'Approve with attached Minosoft evidence']]) {
            const option = el('option', text); option.value = value; decision.append(option);
        }
        decisionLabel.append(decision);
        const noteLabel = el('label', 'Findings'), note = el('textarea'); note.required = true; note.rows = 3; noteLabel.append(note);
        const submit = el('button', 'Record review'); submit.type = 'submit'; form.append(decisionLabel, noteLabel, submit);
        form.onsubmit = async event => {
            event.preventDefault(); submit.disabled = true;
            try { await api(`/api/candidates/${candidate.id}/reviews`, {snapshot: candidate.snapshot, sheetSha256: candidate.sheetSha256, decision: decision.value, note: note.value, evidence: candidate.evidence.map(e => e.id)}); await load('Review recorded for this exact snapshot.'); }
            catch (error) { message.textContent = error.message; submit.disabled = false; }
        };
        card.append(form);
    }
    if (candidate.current && latest?.decision === 'approved') {
        const label = el('label', 'Include in approved pack'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedCandidates.has(candidate.id);
        checkbox.onchange = () => checkbox.checked ? selectedCandidates.add(candidate.id) : selectedCandidates.delete(candidate.id); label.append(checkbox); card.append(label);
    }
    card.append(message); return card;
}
async function load(notice = '') {
    if (authRequired && !currentPerson) { document.querySelector('#loading').textContent = 'Sign in to open your workspace.'; document.querySelector('#families').replaceChildren(); return; }
    const response = await fetch('/api/catalog');
    if (!response.ok) throw new Error('Could not load the asset catalog');
    const data = await response.json();
    document.querySelector('#families').replaceChildren(...data.families.map(renderFamily));
    const candidates = await fetch('/api/candidates').then(r => r.json());
    if (candidates.candidates.length) {
        const root = document.querySelector('#families'); root.append(el('h2', 'Candidates and shared reviews'), ...candidates.candidates.map(renderCandidate));
        const build = el('button', 'Build selected approved pack'), message = el('p', '', 'message');
        build.onclick = async () => {
            build.disabled = true;
            try { const result = await api('/api/pack-builds', {selection: [...selectedCandidates]}); message.replaceChildren(el('span', `Pack ${short(result.id)} ready. `)); const link = el('a', 'Download ZIP'); link.href = `/api/pack-builds/${result.id}.zip`; message.append(link); }
            catch (error) { message.textContent = error.message; } finally { build.disabled = false; }
        };
        root.append(build, message);
    }
    document.querySelector('#loading').textContent = notice || (data.families.length ? `${data.families.length} retained asset family` : 'No families imported. Run npm run workspace:init to add the retained sources.');
}
identity().then(() => load()).catch(error => { document.querySelector('#loading').textContent = error.message; });
