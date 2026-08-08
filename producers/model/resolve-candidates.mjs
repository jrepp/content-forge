// resolve-candidates: drain the select-with-candidate MODEL entries via borrow.
// These are item-form models of blocks (models/item/X ← near models/block/X) and
// empties (air). The borrow: an item model inherits its block model
// ({parent: minecraft:block/X}); air is an empty model. block/X is provided by our
// own flattened model lane, so the parent resolves inside the pack.
//
//   node producers/model/resolve-candidates.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadConfig, repoRoot } from '../../scripts/config.mjs';

const config = loadConfig();
const queuePath = join(repoRoot, 'work', 'queue.json');
if (!existsSync(queuePath)) { console.error('work/queue.json missing — run: npm run pull-queue'); process.exit(1); }
const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
const base = (t) => (t.split('/').pop() || '').replace('.json', '');
const toRef = (target) => target.replace(/^assets\/([^/]+)\/models\//, '$1:').replace(/\.json$/, ''); // -> ns:block/x

const selects = queue.entries.filter((e) => e.disposition === 'select' && e.kind === 'models');
const producersPath = join(config.outDir, '.producers.json');
let producers = existsSync(producersPath) ? JSON.parse(readFileSync(producersPath, 'utf8')) : {};

let written = 0, empties = 0, borrowed = 0, fell = 0;
for (const e of selects) {
	const name = base(e.target);
	let model;
	if (name === 'air' || e.detail === 'empty') { model = {}; empties++; }
	else if (e.candidates && e.candidates.length) {
		// prefer a candidate whose model we actually provide (a block/* model)
		const cand = e.candidates.find((c) => /\/models\/block\//.test(c.target)) || e.candidates[0];
		const parentRef = toRef(cand.target);
		const parentTarget = cand.target;
		model = existsSync(join(config.outDir, parentTarget))
			? { parent: `minecraft:${parentRef.split(':')[1]}` }
			: { parent: 'minecraft:item/generated', textures: { layer0: `minecraft:item/${name}` } };
		(existsSync(join(config.outDir, parentTarget)) ? (borrowed++) : (fell++));
	} else {
		model = { parent: 'minecraft:item/generated', textures: { layer0: `minecraft:item/${name}` } }; fell++;
	}
	const dest = join(config.outDir, e.target);
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, JSON.stringify(model, null, 2) + '\n');
	producers[e.target] = { producer: 'borrow-resolver', recipe: name === 'air' || e.detail === 'empty' ? 'empty' : 'item-inherits-block' };
	written++;
}
writeFileSync(producersPath, JSON.stringify(producers, null, 0) + '\n');
console.log(`resolved ${written} select models via borrow (${borrowed} inherit block model, ${empties} empty, ${fell} item/generated fallback)`);
