// release: emit the approved-only release manifest + report; hold on pending/rejected.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './config.mjs';
const db = new DatabaseSync(join(repoRoot, 'db', 'asset-index.db'));
const approved = db.prepare("SELECT target,producer,recipe,target_sha256 FROM assets WHERE status='approved' ORDER BY target").all();
const rejected = db.prepare("SELECT target FROM assets WHERE status='rejected'").all().map(r => r.target);
const pending = db.prepare("SELECT COUNT(*) c FROM assets WHERE status='published'").get().c;
const manifest = { schema: 1, generatedAt: new Date().toISOString(), count: approved.length, excludedRejected: rejected.length, pending, rejected, assets: approved };
writeFileSync(join(repoRoot, 'db', 'release-manifest.json'), JSON.stringify(manifest, null, 0) + '\n');
const held = pending > 0 || rejected.length > 0;
console.log(`release: ${approved.length} approved asset(s)` + (rejected.length ? `, ${rejected.length} rejected excluded` : '') + (pending ? `, ${pending} PENDING` : ''));
console.log(held ? 'RELEASE HELD (review incomplete)' : 'RELEASE OK (only approved, none pending/rejected) -> db/release-manifest.json');
process.exit(held ? 1 : 0);
