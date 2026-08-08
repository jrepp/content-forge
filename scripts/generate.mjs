// generate: turn the pulled queue into produced assets under out/.
//
//   node scripts/generate.mjs [--only <family>] [--limit N] [--plan]
//
// Reads work/queue.csv (see contract/queue.md), filters actionable rows, groups by
// the `detail` pattern (family), and routes each group to a producer:
//   flat 16x16 families -> producers/raster
//   3D / entity families -> producers/blockbench
//
// Skeleton: this parses + plans and prints the routing. Producers are not wired yet,
// so with --plan it reports; without it, it exits non-zero on the first unimplemented
// family so the loop can't silently no-op.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const plan = args.includes('--plan');
const only = opt('--only', null);
const limit = Number(opt('--limit', '0')) || Infinity;

const csvPath = join(root, 'work', 'queue.csv');
if (!existsSync(csvPath)) { console.error('work/queue.csv missing — run: npm run pull-queue'); process.exit(1); }

// Which producer owns which family/pattern. Extend as producers come online.
const RASTER = new Set([
  'generic_block', 'generic_item', 'spawn_egg', 'banner', 'waxed_copper',
  'hanging_sign', 'wood', 'candle_cake', 'glass_pane', 'shulker_box', 'door',
  'potted_plant', 'bed', 'head', 'coral_fan', 'infested',
]);
const BLOCKBENCH = new Set([]); // 3D / entity families land here as they are defined.
const route = (family) => RASTER.has(family) ? 'raster' : BLOCKBENCH.has(family) ? 'blockbench' : 'unrouted';

// Minimal CSV parse (no embedded newlines in this export; commas are the only concern
// inside pipe-delimited list columns, which we don't split here).
const [header, ...rows] = readFileSync(csvPath, 'utf8').trim().split('\n');
const cols = header.split(',');
const idx = (name) => cols.indexOf(name);
const iDisp = idx('disposition'), iDetail = idx('detail'), iTarget = idx('target');

const groups = new Map(); // family -> targets[] (already in rank order)
let considered = 0;
for (const line of rows) {
  const f = line.split(',');
  if (f[iDisp] !== 'generate') continue;           // producer synthesizes `generate`; `select`/`resolved` skipped
  const family = f[iDetail];
  if (only && family !== only) continue;
  if (considered++ >= limit) break;
  (groups.get(family) ?? groups.set(family, []).get(family)).push(f[iTarget]);
}

const plans = [...groups.entries()]
  .map(([family, targets]) => ({ family, producer: route(family), count: targets.length }))
  .sort((a, b) => b.count - a.count);

console.log('generate plan (disposition=generate), by pattern:');
for (const p of plans) console.log(`  ${p.producer.padEnd(10)} ${p.family.padEnd(16)} ${p.count}`);

if (plan) process.exit(0);

const unimplemented = plans.filter((p) => p.producer !== 'raster' && p.producer !== 'blockbench');
console.error('\nProducers are not wired yet. Re-run with --plan to inspect, or implement:');
console.error('  producers/raster/index.mjs   render(target, recipe) -> RGBA PNG buffer');
console.error('  producers/blockbench/index.mjs  drive CDP export -> PNG/model');
if (unimplemented.length) console.error(`Unrouted families: ${unimplemented.map((p) => p.family).join(', ')}`);
process.exit(2);
