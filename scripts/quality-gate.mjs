// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
// Evaluate durable records and current bytes, never a potentially stale SQLite index.
import {readFileSync, existsSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256, containedPath} from './asset-files.mjs';
import {auditPack} from './audit.mjs';


export function evaluateQuality({outDir, repoRoot}) {
    const issues = [], assets = [];
    try {
        const audit = auditPack(outDir);
        issues.push(...audit.issues, ...audit.qualityFlags.filter(flag=>flag.code === 'gate-state-incomplete'));
    }
    catch (error) {issues.push({code:'invalid-pack', detail:error.message});}
    const read = (path, fallback) => {
        try {return JSON.parse(readFileSync(path, 'utf8'));}
        catch (error) {issues.push({code:'unreadable-record', target:path, detail:error.message});return fallback;}
    };
    const provenance = read(resolve(outDir, 'provenance.json'), {});
    const reviews = read(resolve(repoRoot, 'db/reviews.json'), {});
    const feedback = read(resolve(repoRoot, 'db/visual-feedback.json'), {});
    const targets = provenance?.targets;
    if (!Array.isArray(targets) || targets.length === 0) issues.push({code:'empty-provenance'});
    if (!Array.isArray(feedback?.entries)) issues.push({code:'invalid-feedback'});
    for (const entry of Array.isArray(feedback?.entries) ? feedback.entries : []) {
        if (!['verified','dismissed'].includes(entry?.state)) issues.push({code:'active-visual-feedback', target:entry?.id});
    }
    const seen = new Set();
    for (const entry of Array.isArray(targets) ? targets : []) {
        const target = entry?.target;
        const fail = (code, detail) => issues.push({code, target, ...(detail ? {detail} : {})});
        try {
            if (seen.has(target)) {fail('duplicate-provenance');continue;}
            seen.add(target);
            const bytes = readFileSync(containedPath(outDir, target));
            const hash = sha256(bytes);
            if (entry.sha256 !== hash) fail('stale-provenance');
            if (!entry.producer || entry.producer === 'unknown' || !entry.recipe) fail('missing-lineage');
            if (target.endsWith('.json') || target.endsWith('.mcmeta')) JSON.parse(bytes.toString('utf8'));
            // Pack metadata is verified above, but visual approval applies to assets.
            if (!target.startsWith('assets/')) continue;
            const review = reviews?.[target];
            if (review?.status !== 'approved' || !review.by || review.by === 'policy') fail('needs-approval');
            else {
                if (review.sha256 !== hash) fail('review-not-current');
                if (!Array.isArray(review.evidence) || !review.evidence.length) fail('missing-preview');
                else for (const evidence of review.evidence) {
                    const path = resolve(repoRoot, evidence.path || '');
                    if (!existsSync(path) || !statSync(path).isFile() || evidence.sha256 !== sha256(readFileSync(path))) {
                        fail('preview-not-current', evidence.path);
                    }
                }
            }
            assets.push({target, producer:entry.producer, recipe:entry.recipe, target_sha256:hash});
        } catch (error) {fail('invalid-asset', error.message);}
    }
    return {schema:1, open:issues.length === 0, assets, issues};
}
