// publish: finalize out/ as a resource pack and write out/provenance.json.
//
//   node scripts/publish.mjs
//
// Skeleton: walks the PNGs already under out/assets, hashes each, and writes a
// provenance.json keyed by target (see contract/handoff.md). generate.mjs is
// responsible for putting the PNGs there; this only seals + describes them.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { loadConfig, repoRoot } from './config.mjs';

const config = loadConfig();
const outDir = config.outDir;
const assetsDir = join(outDir, 'assets');
mkdirSync(outDir, { recursive: true });

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.png') || name.endsWith('.json')) acc.push(p); // textures + model/blockstate JSON
  }
  return acc;
}

let queueFingerprint = null;
const queueJson = join(repoRoot, 'work', 'queue.json');
if (existsSync(queueJson)) {
  try { queueFingerprint = JSON.parse(readFileSync(queueJson, 'utf8')).fingerprint ?? null; } catch { /* ignore */ }
}

// Producers stamp what they made in out/.producers.json ({ target: {producer, recipe} }).
let producers = {};
const producersPath = join(outDir, '.producers.json');
if (existsSync(producersPath)) {
  try { producers = JSON.parse(readFileSync(producersPath, 'utf8')); } catch { /* ignore */ }
}

const targets = walk(assetsDir).sort().map((abs) => {
  const target = relative(outDir, abs).split('\\').join('/');
  const meta = producers[target] || {};
  return {
    target,
    producer: meta.producer || 'unknown',
    recipe: meta.recipe || null,
    sha256: createHash('sha256').update(readFileSync(abs)).digest('hex'),
  };
});

const provenance = {
  schema: 1,
  producer: 'content-forge',
  generatedAt: new Date().toISOString(),
  queueFingerprint,
  targets,
};
writeFileSync(join(outDir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(`wrote out/provenance.json — ${targets.length} target(s)` + (targets.length ? '' : ' (nothing produced yet; run generate)'));
