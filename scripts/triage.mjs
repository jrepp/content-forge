// triage: classify the consumer's `select` queue into resolution strategies and
// project coverage — visibility BEFORE building the synthesis/borrow engines.
//
//   node scripts/triage.mjs            # summary to stdout
//   node scripts/triage.mjs --json     # also write work/selection-plan.json
//
// Reads work/queue.json (see contract/queue.md). Each select entry is routed to
// the tool that would satisfy it:
//   candidate     -> pick a near candidate from a source pack (borrow resolver)
//   item_generated-> standard item model (item/generated) via the model engine
//   block:<type>  -> a block-type model template via the model engine
//   placeholder   -> the procedural texture generator (marked, replaceable)
//   unresolved    -> needs a candidate/borrow or a custom (Blockbench) model
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './config.mjs';

const queuePath = join(repoRoot, 'work', 'queue.json');
if (!existsSync(queuePath)) { console.error('work/queue.json missing — run: npm run pull-queue'); process.exit(1); }
const queue = JSON.parse(readFileSync(queuePath, 'utf8'));

// Prefer higher-fidelity sources when a select entry has multiple candidates.
const SOURCE_PRIORITY = ['faithful-32x', 'vanilla-evolved', 'open-assets-lib', 'gui-revision', 'voxelibre-base', 'managed-mod-assets'];
const candidateRank = (source) => { const i = SOURCE_PRIORITY.findIndex((p) => source.startsWith(p)); return i < 0 ? 999 : i; };

// Block-model suffix templates the (future) model engine can synthesize. Longest
// / most-specific suffixes first so `_button_pressed` wins over `_button`.
const BLOCK_TEMPLATES = [
	'button_pressed', 'button_inventory', 'button', 'pressure_plate_down', 'pressure_plate',
	'fence_gate_open', 'fence_gate', 'fence_inventory', 'fence_post', 'fence_side', 'fence',
	'wall_post', 'wall_side_tall', 'wall_side', 'wall_inventory', 'wall',
	'slab_top', 'slab', 'stairs_inner', 'stairs_outer', 'stairs',
	'trapdoor_bottom', 'trapdoor_top', 'trapdoor_open', 'trapdoor',
	'door_bottom_left', 'door_bottom_right', 'door_top_left', 'door_top_right',
	'leaves', 'log_horizontal', 'log', 'wood', 'hyphae', 'stem',
	'planks', 'sapling', 'wall_hanging_sign', 'hanging_sign', 'wall_sign', 'sign',
];
const baseName = (t) => (t.split('/').pop() || '').replace(/\.(json|png)$/, '');

// No-suffix block models default to the cube_all template, EXCEPT genuinely
// custom geometry (orientable blocks, plants, tile entities) which need a
// candidate/borrow or a Blockbench-authored model. Kept deliberately coarse —
// triage projects coverage; the per-entry plan is where edge cases get fixed.
const SPECIAL_BLOCK_SUFFIXES = ['_banner', '_wall_banner', '_candle', '_candle_cake', '_glazed_terracotta', '_head', '_bed', '_shulker_box', '_sign', '_hanging_sign', '_bud', '_amethyst_bud'];
const SPECIAL_BLOCK_NAMES = new Set([
	'air', 'barrier', 'light', 'structure_void', 'barrel', 'furnace', 'blast_furnace', 'smoker',
	'anvil', 'chipped_anvil', 'damaged_anvil', 'bell', 'hopper', 'cake', 'composter', 'campfire',
	'soul_campfire', 'lantern', 'soul_lantern', 'chain', 'lectern', 'grindstone', 'stonecutter',
	'brewing_stand', 'enchanting_table', 'conduit', 'beacon', 'dragon_egg', 'end_portal_frame',
	'flower_pot', 'chest', 'ender_chest', 'trapped_chest', 'jukebox', 'scaffolding', 'ladder',
	'lever', 'decorated_pot', 'big_dripleaf', 'small_dripleaf', 'azalea', 'flowering_azalea',
	'cactus', 'sugar_cane', 'vine', 'sniffer_egg', 'turtle_egg', 'frogspawn', 'pointed_dripstone',
	'amethyst_cluster', 'lightning_rod', 'respawn_anchor', 'spawner', 'jigsaw', 'observer',
	'dispenser', 'dropper', 'piston', 'sticky_piston', 'cauldron', 'water_cauldron', 'lava_cauldron',
	'powder_snow_cauldron', 'bee_nest', 'beehive', 'sculk_sensor', 'sculk_shrieker', 'calibrated_sculk_sensor',
]);
const isSpecialBlock = (name) => SPECIAL_BLOCK_NAMES.has(name) || SPECIAL_BLOCK_SUFFIXES.some((s) => name.endsWith(s));

/** @returns {{strategy:string, via?:string}} */
function classifySelect(entry) {
	if (entry.candidates && entry.candidates.length) {
		const best = [...entry.candidates].sort((a, b) => candidateRank(a.source) - candidateRank(b.source))[0];
		return { strategy: 'candidate', via: best.source };
	}
	if (entry.kind === 'models') {
		if (entry.target.includes('/models/item/')) return { strategy: 'item_generated' };
		if (entry.target.includes('/models/block/')) {
			const name = baseName(entry.target);
			const tpl = BLOCK_TEMPLATES.find((suffix) => name.endsWith(suffix));
			if (tpl) return { strategy: 'block', via: tpl };
			if (isSpecialBlock(name)) return { strategy: 'unresolved', via: 'block_custom' };
			return { strategy: 'block', via: 'cube_all' };
		}
		return { strategy: 'unresolved', via: 'model_other' };
	}
	if (entry.kind === 'textures' && (entry.detail === 'generic_block' || entry.detail === 'generic_item')) {
		return { strategy: 'placeholder', via: entry.detail };
	}
	return { strategy: 'unresolved', via: entry.detail || entry.kind };
}

const select = queue.entries.filter((e) => e.disposition === 'select');
const plan = select.map((e) => { const c = classifySelect(e); return { target: e.target, kind: e.kind, detail: e.detail, strategy: c.strategy, via: c.via }; });

// rollups
const count = (arr, keyFn) => arr.reduce((m, x) => { const k = keyFn(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const byStrategy = count(plan, (p) => p.strategy);
const blockByType = count(plan.filter((p) => p.strategy === 'block'), (p) => p.via);
const RESOLVABLE = new Set(['candidate', 'item_generated', 'block', 'placeholder']);
const resolvable = plan.filter((p) => RESOLVABLE.has(p.strategy)).length;
const unresolved = plan.length - resolvable;
const unresolvedVia = count(plan.filter((p) => !RESOLVABLE.has(p.strategy)), (p) => p.via);
const pct = (n) => ((100 * n) / plan.length).toFixed(1) + '%';

console.log(`Selection queue (fingerprint ${String(queue.fingerprint).slice(0, 12)}…)`);
console.log(`  select entries: ${plan.length}  (models ${plan.filter((p) => p.kind === 'models').length} / textures ${plan.filter((p) => p.kind === 'textures').length})`);
console.log(`  projected resolvable: ${resolvable} (${pct(resolvable)})   unresolved: ${unresolved} (${pct(unresolved)})`);
console.log('\n  by strategy (tool that would satisfy it):');
for (const [k, v] of Object.entries(byStrategy).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(14)} ${v}`);
console.log('\n  block templates:');
for (const [k, v] of Object.entries(blockByType).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(20)} ${v}`);
if (Object.keys(unresolvedVia).length) {
	console.log('\n  unresolved breakdown:');
	for (const [k, v] of Object.entries(unresolvedVia).sort((a, b) => b[1] - a[1])) console.log(`    ${String(k).padEnd(20)} ${v}`);
}

if (process.argv.includes('--json')) {
	mkdirSync(join(repoRoot, 'work'), { recursive: true });
	const out = {
		schema: 1, generatedAt: new Date().toISOString(), queueFingerprint: queue.fingerprint ?? null,
		totals: { select: plan.length, resolvable, unresolved }, byStrategy, blockByType, unresolvedVia, entries: plan,
	};
	writeFileSync(join(repoRoot, 'work', 'selection-plan.json'), JSON.stringify(out, null, 2) + '\n');
	console.log('\nwrote work/selection-plan.json');
}
