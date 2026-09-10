<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Animated source and APNG review

The wizard's `.bbmodel` is the editable authority. Importing, editing and building
previews never regenerate or overwrite the repository source. Workspace saves
retain complete source revisions, parent lineage and embedded texture hashes.
The original retained source remains at
[`producers/blockbench/entities/wizard/source.bbmodel`](../producers/blockbench/entities/wizard/source.bbmodel).

## Generate a review

```sh
npm run workspace:init
npm run workspace:editor-build
npm run workspace:animation-review -- --family wizard
npm run workspace
```

The build reads the current saved wizard revision. Use `--revision REVISION_ID`
to reproduce an earlier revision and `--output DIRECTORY` to choose the exported
bundle directory. The default export directory is `work/reviews/animations/ID/`.
The authenticated catalog links to **Review animations**. Refresh the catalog
after a CLI build. If the server predates this feature, restart it to load the
new routes and editor build; source revisions remain in the database.

Each build renders `idle`, `walk`, `look_at`, `fidget` and `work_table` into looping
APNGs, with static PNG posters and a portable HTML review sheet. The `.png`
extension allows static viewers to display the first frame. The original five
clips produce 36, 12, 48, 24 and 12 frames at 12 fps, respectively. Encoding follows
the [PNG animation specification](https://www.w3.org/TR/png-3/#apng-chunks), using
full RGBA frames with explicit replacement blending and infinite playback.

The renderer launches a disposable Chrome profile and authenticated temporary
workspace. It loads the exact saved bytes into the pinned Blockbench web build,
selects each animation independently, advances the timeline at fixed intervals,
and captures a fixed 384×384 camera view without editor gizmos. It does not use
the artist's open editor or create test accounts in the durable workspace.

## Retention and review identity

The manifest records the saved revision and lineage, exact source/family/provenance
hashes, editor build, generator input hashes, browser/renderer environment, camera,
frame timing, pixel hashes and output hashes. The bundle contains the exact
source, family and provenance files used to render it. Its ID hashes the manifest.
Animation reviews and all their files are retained immutably in the workspace
database; the exported directory is a convenient copy. Downloads verify hashes.
Saving a newer source marks the old review as stale and retains its original inputs.
Back up `.forge-workspace/` as described in the [workspace guide](local-workspace.md).

Repeated renders are checked for identical bytes in the same pinned environment.
Browser or graphics changes can produce different pixels and therefore a new
review ID; cross-platform byte identity is not assumed. Animation lengths must
be positive and no more than ten seconds, with at most twenty clips per source.
Lengths that fall between frame intervals round up to the next interval.

## Validation and remaining work

```sh
npm test
npm run workspace:wizard-check
```

The browser check opens the real wizard, changes one cube, saves and reopens it,
and compares rig hierarchy, groups, geometry, animations and textures against the
original source. Only the intended edit and editor selection state may differ.
It then renders twice, checks identical review IDs, independently decodes every
APNG frame with Chrome, checks frame timing and motion, and loads the review sheet.
Tests use an isolated database. Receipts and screenshots go under `work/reviews/`.
CI builds a web editor from the pinned public Blockbench commit and uploads these
review bundles as the `wizard-animation-review` artifact on PRs and main pushes.

These images show Blockbench rendering. Texture flipbooks are sampled with its
frame-stepping API; smooth interpolation is not simulated. The source's interpolation,
additive and emissive settings remain intact for the future consumer adapter.
APNG creation does not constitute Minosoft validation or artistic approval and
does not add the wizard to an approved resource pack. The next slice is an
explicit animated-entity export contract and consumer checks for rig motion,
texture timing, transparency, emissive materials and frame interpolation.
