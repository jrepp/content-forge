<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Five-item workspace acceptance

Verified 2026-09-09 on macOS using the real pinned Blockbench web editor,
separate author/reviewer browser profiles, and Minosoft with Java 25. This audit
covers the original catalog → editor → save → candidate/review → consumer/pack
goal described in [workspace architecture](workspace-architecture.md).

| Item | Implemented behavior | Verification |
| --- | --- | --- |
| 1. Catalog and immutable sources | Imported family/source/texture/provenance hashes, immutable revision bytes, parent and author identity, repository base, downloadable history, retained conflict drafts | `npm test`: import, restart, independent writers, interrupted transaction, stale save, exact downloads and candidate integrity checks |
| 2. Real hosted Blockbench | Family-page launch into a manifest-pinned web build; author, family, revision, browser instance, attachment generation and active project binding | `workspace:editor-check`: actual web editor and exact source open; HTTP wrong-instance and revoked-account refusal; session unit tests cover scope and generation |
| 3. Acknowledged save and recovery | Durable compare-and-save, idempotent retry, IndexedDB checkpoints and conflict retention | Real browser edit/reload recovery, lost save response followed by reload/retry without a duplicate revision, save/reopen, two real editors preserving the stale draft; `workspace:browser-check` also covers manual uploads and mobile layout |
| 4. Exact export and teammate review | Saved-source model/texture codec exports, editor/extension/exporter/renderer identities, retained artifacts, portable sheet and shared findings | Real exports repeat identically, match saved source bytes and edited geometry; both review cards render; separate reviewer records findings through the UI |
| 5. Consumer evidence and approved pack | Tracked Minosoft captures, exact composed outputs and image hashes, explicit evidence-bound reviewer approval, current approved selection, deterministic resource-pack ZIP | Full consumer/browser run captures both ingots, records a labeled test approval, selects/builds/downloads the ZIP, and verifies an identical rebuild; unit tests reject invalid evidence, self-approval, newer source and later negative review |

Commands passed:

```sh
npm test                                      # 40 tests
npm run workspace:browser-check
FORGE_CONSUMER_CHECK=1 npm run workspace:editor-check
# In the Minosoft checkout, using Java 25:
./gradlew :play-util:test --tests ContentPreviewTest
./play.sh status --json
```

The full editor command includes the ordinary editor acceptance checks. Its
two-editor case confirms the first save advances the head while the second
source is retained as a conflict and remains open in its editor. Its consumer
case uses the actual reviewer form and pack download route. The final Minosoft
status has no parent, server, client or external client process, and no open
server port.

## Retained run evidence

- [Hosted editor receipt](../work/reviews/hosted-editor-check.json)
- [Consumer, approval and pack receipt](../work/reviews/workspace-consumer-check.json)
- [Rendered candidate sheet screenshot](../work/reviews/workspace-candidate.png)
- [Acceptance resource-pack ZIP](../work/reviews/workspace-acceptance-pack.zip)

Verified candidate:
`b79677fe0e12188382b60215e0300e412e05f2c1b7e5bd5830cc7d08836812b3`.
Consumer bundle:
`.forge-workspace/validation/b79677fe0e12188382b60215e0300e412e05f2c1b7e5bd5830cc7d08836812b3/evidence.json`.
Evidence identity:
`012fd4235fbab81309bc3e5e92f599dd7ee74e50c229e5b89477d3455151692e`.
Test approval:
`2005b7df-8f12-4054-94ef-4f45b86f014d`.
Downloaded and independently checked ZIP SHA-256:
`38746e4ff035907ad7726d81260eab1a68d503fbc3ec4f513957ef81ce514c51`.

Both 1800×1000 consumer images were visually inspected. Iron and gold are
visible, and each image's same-frame scene metadata names the matching visible
item-display entity. Iron PNG SHA-256 is
`ca5422807b5c5dca16f1cf5c996cdf0de21a4fa2d88c5c4870cdb0391c985662`;
gold PNG SHA-256 is
`06ba0ebc4abdc4ca2d795114fa72f4edbc0d1e44ee193224fc65a70ed07b3ab7`.
An independent archive audit verified every file against `forge-lock.json`,
the selected approval/evidence records against the receipt, and the exact ZIP
entry set. Evidence file hashes and placement records were also rechecked.

These local diagnostic paths are ignored by Git and refreshed by later runs.
The durable implementation and reproduction commands are in the repository.
The Minosoft launcher/fixture changes are documented in its
`doc/agents/evidence/2026-09-09-workspace-item-preview.md`.

## Product boundary

The running workspace binds to `http://127.0.0.1:8767` with local invitations and
durable SQLite storage. Remote Artemis deployment and organization SSO remain
the separate [hosting trajectory](hosting.md). Animated wizard import is a
subsequent asset-format extension; this acceptance uses the retained ingot family.

The resource-pack ZIP selects authored assets for the declared Minecraft 1.20.4
managed modpack profile. It does not package the third-party mod JARs. All test
accounts, source edits and approval decisions were isolated from the real
workspace database. The shipped ingot artwork still needs human artistic review;
this acceptance does not approve or release it.
