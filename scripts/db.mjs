// db: SQLite index of the full asset set + workflow status + conversion lineage.
// Dependency-free (node:sqlite). The DB is a derived, regenerable index; durable
// human state lives in committed db/reviews.json and db/conversions.json, which
// `index` applies. So the queryable index is fast and rebuildable, while review/
// approval decisions and Blockbench source lineage stay in diffable text.
//
//   node scripts/db.mjs index                              rebuild from pipeline outputs
//   node scripts/db.mjs report                             status/kind/producer rollups
//   node scripts/db.mjs list [--status S] [--kind K] [--limit N]
//   node scripts/db.mjs approve <target> [--by NAME] [--note ...]
//   node scripts/db.mjs review  <target> [--by NAME] [--note ...]
//   node scripts/db.mjs reject  <target> [--by NAME] [--note ...]
//   node scripts/db.mjs set-status <target> <status> [--by NAME] [--note ...]
//   node scripts/db.mjs record-conversion <target> <source.bbmodel> [--codec java_block]
//
// Workflow status: missing -> synthesized -> published -> reviewed -> approved
//                  (| rejected).  'converted' marks a Blockbench-sourced target.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { repoRoot } from './config.mjs';

const DB_PATH = join(repoRoot, 'db', 'asset-index.db');
const REVIEWS = join(repoRoot, 'db', 'reviews.json');
const CONVERSIONS = join(repoRoot, 'db', 'conversions.json');
const now = () => new Date().toISOString();
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const sha256File = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null);
mkdirSync(join(repoRoot, 'db'), { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
  target TEXT PRIMARY KEY, namespace TEXT, kind TEXT, category TEXT, name TEXT,
  family TEXT, strategy TEXT, disposition TEXT,
  status TEXT NOT NULL DEFAULT 'missing',
  producer TEXT, recipe TEXT, format TEXT,
  source TEXT, source_sha256 TEXT, target_sha256 TEXT,
  reviewer TEXT, reviewed_at TEXT, note TEXT,
  queue_fingerprint TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS conversions (
  target TEXT PRIMARY KEY, source TEXT NOT NULL, codec TEXT, source_format TEXT,
  source_sha256 TEXT, target_sha256 TEXT, converted_at TEXT
);
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT, status TEXT, actor TEXT, note TEXT, at TEXT
);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
`;

function open() { const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA journal_mode=WAL;'); db.exec(SCHEMA); return db; }

function parseTarget(target) {
	const p = target.split('/');
	const namespace = p[1] || 'minecraft';
	const kind = p[2] || '';
	const rest = p.slice(3);
	const category = rest.length > 1 ? rest[0] : '';
	const name = rest.join('/').replace(/\.(json|png)$/, '');
	const ext = target.endsWith('.png') ? 'png' : 'json';
	const format = ext === 'png' ? 'png' : kind === 'models' ? 'mc_model_json' : kind === 'blockstates' ? 'mc_blockstate' : 'json';
	return { namespace, kind, category, name, format };
}

function cmdIndex() {
	const db = open();
	db.exec('DELETE FROM assets; DELETE FROM conversions;');
	const fp = readJson(join(repoRoot, 'work', 'queue.json'), {}).fingerprint || null;
	const upsert = db.prepare(`INSERT INTO assets (target,namespace,kind,category,name,family,strategy,disposition,status,producer,recipe,format,source,source_sha256,target_sha256,queue_fingerprint,updated_at)
		VALUES (@target,@namespace,@kind,@category,@name,@family,@strategy,@disposition,@status,@producer,@recipe,@format,@source,@source_sha256,@target_sha256,@queue_fingerprint,@updated_at)
		ON CONFLICT(target) DO UPDATE SET family=COALESCE(excluded.family,family), strategy=COALESCE(excluded.strategy,strategy),
		  disposition=COALESCE(excluded.disposition,disposition), status=excluded.status, producer=COALESCE(excluded.producer,producer),
		  recipe=COALESCE(excluded.recipe,recipe), format=COALESCE(excluded.format,format), source=COALESCE(excluded.source,source),
		  source_sha256=COALESCE(excluded.source_sha256,source_sha256), target_sha256=COALESCE(excluded.target_sha256,target_sha256), updated_at=excluded.updated_at`);
	const row = (o) => ({ target: o.target, namespace: null, kind: null, category: null, name: null, family: null, strategy: null, disposition: null, status: 'missing', producer: null, recipe: null, format: null, source: null, source_sha256: null, target_sha256: null, queue_fingerprint: fp, updated_at: now(), ...o });

	// 1. queue demand
	const queue = readJson(join(repoRoot, 'work', 'queue.json'), { entries: [] });
	for (const e of queue.entries || []) upsert.run(row({ target: e.target, ...parseTarget(e.target), family: e.detail || null, disposition: e.disposition, status: e.disposition === 'resolved' ? 'resolved' : 'missing' }));
	// 2. selection plan strategy
	const plan = readJson(join(repoRoot, 'work', 'selection-plan.json'), { entries: [] });
	for (const e of plan.entries || []) upsert.run(row({ target: e.target, ...parseTarget(e.target), family: e.detail || null, strategy: e.strategy }));
	// 3. what we produced (published pack)
	const prov = readJson(join(repoRoot, 'out', 'provenance.json'), { targets: [] });
	for (const t of prov.targets || []) upsert.run(row({ target: t.target, ...parseTarget(t.target), producer: t.producer, recipe: t.recipe, target_sha256: t.sha256, status: 'published' }));
	// 4. conversion lineage (Blockbench source -> target)
	const convRows = readJson(CONVERSIONS, []);
	const insConv = db.prepare(`INSERT INTO conversions (target,source,codec,source_format,source_sha256,target_sha256,converted_at)
		VALUES (?,?,?,?,?,?,?) ON CONFLICT(target) DO UPDATE SET source=excluded.source, codec=excluded.codec, source_sha256=excluded.source_sha256, target_sha256=excluded.target_sha256, converted_at=excluded.converted_at`);
	for (const c of convRows) {
		insConv.run(c.target, c.source, c.codec || 'java_block', c.source_format || 'java_block', c.source_sha256 || null, c.target_sha256 || null, c.converted_at || null);
		db.prepare('UPDATE assets SET source=?, source_sha256=?, producer=?, recipe=?, format=?, status=?, updated_at=? WHERE target=?')
			.run(c.source, c.source_sha256 || null, 'blockbench', c.codec || 'java_block', 'mc_model_json', 'published', now(), c.target);
	}
	// 5. human review decisions (durable) override status
	const reviews = readJson(REVIEWS, {});
	const histIns = db.prepare('INSERT INTO status_history (target,status,actor,note,at) VALUES (?,?,?,?,?)');
	for (const [target, r] of Object.entries(reviews)) {
		const res = db.prepare('UPDATE assets SET status=?, reviewer=?, reviewed_at=?, note=?, updated_at=? WHERE target=?').run(r.status, r.by || null, r.at || null, r.note || null, now(), target);
		if (res.changes) histIns.run(target, r.status, r.by || null, r.note || null, r.at || now());
	}
	const total = db.prepare('SELECT COUNT(*) c FROM assets').get().c;
	console.log(`indexed ${total} assets (fingerprint ${String(fp).slice(0, 12)}…), ${convRows.length} conversion(s), ${Object.keys(reviews).length} review(s)`);
	db.close();
}

function cmdReport() {
	const db = open();
	const table = (label, sql) => { console.log(`\n${label}:`); for (const r of db.prepare(sql).all()) console.log(`  ${String(r.k ?? '(none)').padEnd(16)} ${r.c}`); };
	console.log(`total assets: ${db.prepare('SELECT COUNT(*) c FROM assets').get().c}`);
	table('by status', 'SELECT status k, COUNT(*) c FROM assets GROUP BY status ORDER BY c DESC');
	table('by kind', 'SELECT kind k, COUNT(*) c FROM assets GROUP BY kind ORDER BY c DESC');
	table('by producer', 'SELECT producer k, COUNT(*) c FROM assets WHERE producer IS NOT NULL GROUP BY producer ORDER BY c DESC');
	console.log(`\nconversions (blockbench source -> target): ${db.prepare('SELECT COUNT(*) c FROM conversions').get().c}`);
	db.close();
}

function cmdList(args) {
	const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
	const where = [], params = [];
	if (opt('--status')) { where.push('status=?'); params.push(opt('--status')); }
	if (opt('--kind')) { where.push('kind=?'); params.push(opt('--kind')); }
	const limit = Number(opt('--limit') || 40);
	const db = open();
	const sql = `SELECT target,status,producer,recipe,source FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY target LIMIT ${limit}`;
	for (const r of db.prepare(sql).all(...params)) console.log(`  ${r.status.padEnd(11)} ${(r.producer || '-').padEnd(12)} ${r.target}${r.source ? '  <= ' + r.source : ''}`);
	db.close();
}

function setStatus(target, status, args) {
	const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
	const by = opt('--by') || process.env.USER || 'unknown';
	const note = opt('--note') || null;
	const at = now();
	// durable: reviews.json
	const reviews = readJson(REVIEWS, {});
	reviews[target] = { status, by, at, note };
	writeFileSync(REVIEWS, JSON.stringify(reviews, null, 2) + '\n');
	// live: DB
	const db = open();
	const res = db.prepare('UPDATE assets SET status=?, reviewer=?, reviewed_at=?, note=?, updated_at=? WHERE target=?').run(status, by, at, note, now(), target);
	db.prepare('INSERT INTO status_history (target,status,actor,note,at) VALUES (?,?,?,?,?)').run(target, status, by, note, at);
	db.close();
	console.log(`${res.changes ? 'set' : 'recorded (asset not yet indexed)'} ${target} -> ${status} by ${by}`);
}

function cmdRecordConversion(args) {
	const [target, source] = args;
	const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
	if (!target || !source) { console.error('usage: record-conversion <target> <source.bbmodel> [--codec java_block]'); process.exit(2); }
	const codec = opt('--codec') || 'java_block';
	const outTarget = join(repoRoot, 'out', target);
	const rec = { target, source, codec, source_format: opt('--source-format') || codec, source_sha256: sha256File(join(repoRoot, source)), target_sha256: sha256File(outTarget), converted_at: now() };
	const convs = readJson(CONVERSIONS, []).filter((c) => c.target !== target);
	convs.push(rec);
	writeFileSync(CONVERSIONS, JSON.stringify(convs, null, 2) + '\n');
	console.log(`recorded conversion: ${source} --${codec}--> ${target}`);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
	case 'index': cmdIndex(); break;
	case 'report': cmdReport(); break;
	case 'list': cmdList(rest); break;
	case 'approve': setStatus(rest[0], 'approved', rest); break;
	case 'review': setStatus(rest[0], 'reviewed', rest); break;
	case 'reject': setStatus(rest[0], 'rejected', rest); break;
	case 'set-status': setStatus(rest[0], rest[1], rest.slice(2)); break;
	case 'record-conversion': cmdRecordConversion(rest); break;
	default: console.error('commands: index | report | list | approve | review | reject | set-status | record-conversion'); process.exit(2);
}
