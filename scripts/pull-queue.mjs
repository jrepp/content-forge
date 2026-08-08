// pull-queue: snapshot Minosoft's content queue (the demand / input queue) into work/.
//
//   node scripts/pull-queue.mjs [--minosoft <repo>] [--stack standalone]
//
// The consumer DRIVES demand: run `./play.sh content queue --stack <stack> --json`
// in the Minosoft checkout first, then this copies the ranked, pattern-tagged export
// (.run/content-queues/<stack>.{csv,json}) into work/ for the producer to read.
//
// Skeleton: the copy is real; nothing here interprets the queue (that is generate.mjs).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

const minosoft = resolve(opt('--minosoft', process.env.MINOSOFT_ROOT || join(root, '..', 'Minosoft')));
const stack = opt('--stack', 'standalone');
const srcDir = join(minosoft, '.run', 'content-queues');

mkdirSync(join(root, 'work'), { recursive: true });
let pulled = 0;
for (const ext of ['csv', 'json']) {
  const src = join(srcDir, `${stack}.${ext}`);
  if (existsSync(src)) {
    copyFileSync(src, join(root, 'work', `queue.${ext}`));
    console.log(`pulled ${src} -> work/queue.${ext}`);
    pulled++;
  }
}
if (!pulled) {
  console.error(`No queue export found under ${srcDir}.`);
  console.error(`Run this first in the Minosoft checkout:`);
  console.error(`  ./play.sh content queue --stack ${stack} --json`);
  process.exit(1);
}
