<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Asset workspace: edit, save, review, and build

The workspace connects retained item families to the real Blockbench web editor,
immutable source revisions, candidate exports, shared review records, Minosoft
capture, and approved resource-pack builds. The first compatibility profile is
Minosoft with Minecraft 1.20.4 and the configured standalone content stack.

## Start and sign in

```sh
npm run workspace:init
npm run workspace:editor-build
npm run workspace                         # http://127.0.0.1:8767
```

The server prints a one-time author access token, valid for 15 minutes. Paste it
into the sign-in form. Login creates a 12-hour HttpOnly, same-site session.
Separate author/reviewer identities share the durable workspace database.
Create a reviewer invitation from another terminal:

```sh
node scripts/workspace.mjs invite --author "Reviewer name" --role reviewer
node scripts/workspace.mjs revoke-person --person PERSON_ID
```

Invitations are single-use and stored as hashes. Use a separate browser profile
for the reviewer during a two-person demonstration. Revoked identities lose
access to the catalog, downloads, editor actions, and review/build operations.
The operator manages invitations locally; this server binds only to loopback.
Public DNS, fleet deployment, and organization SSO are separate hosting work.

`workspace:init -- --author "Name"` overrides the importer's local Git name.
Repeated initialization preserves existing revisions. `workspace -- --port 8768`
selects a different port. Use the printed `127.0.0.1` address.

## Edit and save

Choose **Edit in Blockbench** on the ingot family. A dedicated tab opens the pinned
web build, verifies the retained source hash, and loads the exact revision into
an owned Blockbench project. Ordinary modeling tools, texture editing, display
settings, and Undo remain available.

**Save to content-forge** checkpoints the pending request in browser IndexedDB,
then sends the source bytes with their expected previous revision. A shared save
is acknowledged only after the SQLite transaction commits. Retry after a lost
response reuses the request ID. The original repository file is unchanged.

Two sessions may open the same base. The first save advances the current source;
a later stale save retains a conflict draft without replacing that source. Both
revisions remain downloadable from history. Open the current source in a fresh
editor session and merge the changes explicitly.

Browser checkpoints retain unsaved edits after Undo operations and every two
seconds, including display-setting changes. Reload restores the retained draft;
it does not claim the draft has been saved to the workspace. Browser storage
failures are shown in the editor toolbar. A pending shared save is checkpointed
before the request is sent. Keep the browser profile until these edits are saved.

The session binds the authenticated author, family, saved revision, pinned build,
browser instance, attachment generation, and active project UUID. A project
switch, wrong instance, revoked session, or stale attachment cannot save/export.
The workspace only accepts informational messages from its exact editor popup;
browser messages cannot execute arbitrary editor commands.

Source downloads and the manual file-upload form remain available. Sources must
use the family's `java_block` format, embed their PNG textures, and fit within
8 MiB. External texture dependencies need a future declared-dependency adapter.

## Export and review

Save edits, then choose **Build review candidate** in Blockbench. The extension
uses the real project, model-group, and texture codecs. It checks for edits during
export; the server also compares the compiled source to the saved revision.
The candidate retains source/family/toolchain identities, exact output hashes,
source downloads, and a portable model/texture review sheet. Repeated exports
verify identical artifacts rather than replacing an existing candidate.

In the workspace, open the candidate sheet and inspect the models, texture pixels,
and display transforms. A signed-in reviewer records findings against the exact
candidate snapshot and sheet hash. Findings persist in the shared database.
The review sheet's own downloadable notes remain a separate portable mechanism.

**Validate in Minosoft** starts a tracked capture job. It materializes the selected
candidate as the last content layer, composes the stack, verifies that every
candidate output is selected, refreshes consumer demand, and launches isolated
local item previews. The consumer's content fingerprint and screenshot hashes
must match the captured files. Every family member needs an image. The runner
checks for existing clients before launch and verifies cleanup after capture.
It uses Minosoft's Java 25 launcher and supported preview commands.
The consumer checkout must include the item-preview fixture mounting and camera
restoration fixes. A missing placement function fails the job; its execution
record must belong to the captured image. Captures include same-frame scene
diagnostics, and the bundle records launcher and fixture hashes.

The workspace displays job progress and any failure. It never converts a failed
capture into approval. An existing `evidence.json` bundle produced by this runner
can also be attached. The importer verifies exact candidate/source identity,
composition identity, member coverage, capture metadata, and image hashes, then
retains the evidence bytes. Review the linked Minosoft images before approval.

Only reviewer accounts can approve. Approval requires matching consumer evidence
and the current source revision; author accounts cannot grant approval. New source
revisions and later `needs-work` findings hold future builds. Historical findings
and completed builds remain intact.
Running Minosoft validation does not make a reviewer the candidate's export author.

## Approved pack selection

Select approved candidates and choose **Build selected approved pack**. The build
requires one current approved version per family, consistent consumer profiles,
non-overlapping output ownership, complete local model/texture dependencies,
matching evidence, and intact artifact bytes.

The downloadable resource-pack ZIP includes `pack.mcmeta`, assets, provenance,
retained source/lineage records, and `forge-lock.json`. The lock selects exact
source/candidate/approval/evidence/toolchain versions. Entries are ordered with
fixed ZIP timestamps and permissions; rebuilding the same selection must produce
identical bytes. This is an authored resource-pack selection for the declared
managed modpack profile, not a redistribution of the managed mod dependencies.

The existing global `npm run gate` / `release` pipeline remains separate. Workspace
builds do not mark unrelated assets approved or replace the global release
manifest. The ingot artwork still requires a real artistic review; automated
acceptance uses isolated test identities and explicitly labeled test approvals.

## Durable storage and editor pinning

`.forge-workspace/workspace.sqlite` holds source bytes, family/lineage snapshots,
accounts, editor sessions, jobs, candidates, reviews, evidence, and pack builds.
It is durable local state excluded from Git. Stop the server before copying the
entire `.forge-workspace/` directory for backup, or download retained artifacts.
Do not treat it as a regenerable report directory.

Each source records its parent, author, imported checkout hash, base Git commit,
and embedded texture hashes. The commit identifies the base, while the imported
bytes may include uncommitted changes. Draft saves never commit or overwrite the
checkout automatically.

The editor build copies the current Blockbench checkout, builds its web target in
staging, and retains a manifest-hashed static bundle and extension. It does not
replace the sibling repo's desktop build or modify its source. Runtime file hashes
are checked on serving; sessions retain the selected build identity. Restart the
workspace after deliberately building a new editor version. Existing sessions
bound to an unavailable old build are refused; their local drafts remain intact.

## Verification

```sh
npm test
npm run workspace:browser-check
npm run workspace:editor-check
FORGE_CONSUMER_CHECK=1 npm run workspace:editor-check
```

The unit suite covers source/asset integrity, two independent writers, stale and
retried editor saves, authentication/binding/revocation, exact review snapshots,
evidence rejection, approval gates, and deterministic ZIP builds. The browser
checks exercise actual UI uploads and the real hosted editor. `CHROME_BIN` can
select a Chrome executable outside the standard macOS application location.
The consumer option additionally runs real Minosoft previews and exercises a
clearly labeled test approval and pack build in an isolated database.

Diagnostic receipts and screenshots are under `work/reviews/`; consumer captures
and their logs are under `.forge-workspace/validation/`. These prove workflow
behavior, not artistic approval of the shipped ingots.
See the [five-item acceptance audit](workspace-acceptance.md) for the verified run
and its source, review, capture, and pack evidence.
