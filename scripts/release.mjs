// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
// A held release preserves the previous manifest. Both entry points use the same gate.
import {writeFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig, repoRoot} from './config.mjs';
import {evaluateQuality} from './quality-gate.mjs';

const result = evaluateQuality({outDir:loadConfig().outDir, repoRoot});
if (!result.open) {
    console.error(`RELEASE HELD: ${result.issues.length} quality issue(s); run npm run gate for details.`);
    process.exitCode = 1;
} else {
    const manifest = {schema:1, generatedAt:new Date().toISOString(), count:result.assets.length, excludedRejected:0, pending:0, rejected:[], assets:result.assets};
    const path = join(repoRoot, 'db/release-manifest.json');
    const candidate = `${path}.candidate-${process.pid}`;
    writeFileSync(candidate, JSON.stringify(manifest) + '\n');
    renameSync(candidate, path);
    console.log(`RELEASE OK: ${result.assets.length} assets with current review and preview evidence.`);
}
