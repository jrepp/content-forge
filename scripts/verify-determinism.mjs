// verify-determinism: prove the pure (JS) producers are byte-stable. Hash the
// out/ asset tree, re-run the deterministic producers, re-hash, and assert the
// tree is identical. (The Blockbench-converted bespoke models are left untouched;
// their .bbmodel sources are the committed reproducer.)
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { loadConfig, repoRoot } from './config.mjs';

const config = loadConfig();
const assets = join(config.outDir, 'assets');

function treeHash(dir) {
	const files = [];
	const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
	if (existsSync(dir)) walk(dir);
	files.sort();
	const h = createHash('sha256');
	for (const f of files) { h.update(relative(config.outDir, f)); h.update(readFileSync(f)); }
	return { hash: h.digest('hex'), count: files.length };
}

const run = (rel, args = []) => execFileSync('node', [join(repoRoot, rel), ...args], { stdio: 'ignore' });

// Producer purity: run the deterministic producers twice on the same inputs and
// require byte-identical trees. (synth-models no-ops when the model worklist is
// drained; the texture lane + reference-closure carry the real worklist.)
const producers = () => {
	run('producers/model/synth.mjs');
	run('producers/raster/synth-textures.mjs', ['--all']);
	run('producers/model/resolve-candidates.mjs');
	run('producers/model/blockstates.mjs');
	run('producers/raster/reference-closure.mjs');
};
producers();
const a = treeHash(assets);
producers();
const b = treeHash(assets);

const stable = a.hash === b.hash && a.count === b.count;
console.log(`determinism: pass A ${a.count} files ${a.hash.slice(0, 12)}…  pass B ${b.count} files ${b.hash.slice(0, 12)}…`);
console.log(stable ? 'DETERMINISTIC — the producers are byte-identical across runs (idempotent)' : 'NON-DETERMINISTIC — output changed on re-run');
process.exit(stable ? 0 : 1);
