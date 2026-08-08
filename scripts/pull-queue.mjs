// pull-queue: snapshot Minosoft's content queue (the demand / input queue) into work/.
//
//   node scripts/pull-queue.mjs [--minosoft <repo>] [--stack <name>]
//
// The consumer DRIVES demand: run `./play.sh content queue --stack <stack> --json`
// in the Minosoft checkout first, then this copies the ranked, pattern-tagged export
// (.run/content-queues/<stack>.{csv,json}) into work/ for the producer to read.
//
// Paths come from forge.config.json (see scripts/config.mjs); CLI flags override.
// Skeleton: the copy is real; nothing here interprets the queue (that is generate.mjs).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, repoRoot } from './config.mjs';

const config = loadConfig();
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

const minosoft = opt('--minosoft', config.consumerRoot);
const stack = opt('--stack', config.stack);
const srcDir = join(minosoft, '.run', 'content-queues');

mkdirSync(join(repoRoot, 'work'), { recursive: true });
let pulled = 0;
for (const ext of ['csv', 'json']) {
  const src = join(srcDir, `${stack}.${ext}`);
  if (existsSync(src)) {
    copyFileSync(src, join(repoRoot, 'work', `queue.${ext}`));
    console.log(`pulled ${src} -> work/queue.${ext}`);
    pulled++;
  }
}
if (!pulled) {
  console.error(`No queue export found under ${srcDir}.`);
  console.error(`Run this first in the Minosoft checkout (${minosoft}):`);
  console.error(`  ./play.sh content queue --stack ${stack} --json`);
  process.exit(1);
}
