<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Small survival authored content

Run `node scripts/survival-pack.mjs` to publish `out-survival/` beside the configured
`out/` directory. Run `node --test tests/survival.test.mjs` for geometry/state and
recipe checks. The producer imports the configured Blockbench texture core;
it does not depend on a running editor. Regeneration replaces the whole overlay
through a candidate/rollback boundary and emits hashes in `provenance.json`.

This is an explicit set of 24 terrain and vegetation blockstates, 26 models, and
31 diffuse textures (including water overlay), each with normal/specular companions.
The generated provenance is the authoritative count. The broad approximation
catalog in `out/` remains a lower-priority fallback, not an approved override.
Do not promote its entire contents above authored packs.

Minosoft's standalone stack mounts `survival-authored` after its bundled resource
packs and before explicit user overlay archives. Override its location with
`MINOSOFT_SURVIVAL_CONTENT` or `standalone.local.json`. After regeneration, compose
and relaunch the client so it mounts the new immutable content fingerprint.
Check every generated asset hash against its composed counterpart.

The overlay keeps diffuse and material maps together. Specular alpha 255 is the
LabPBR non-emissive sentinel; opaque materials have blue 0 and foliage blue 96.
Use Bliss `SSS_TYPE=3` (material maps) with this set. Bliss's default `SSS_TYPE=1`
ignores these authored values and applies strong scattering to mushrooms by
block ID, making brown caps appear bright yellow. Ordinary block light/emissive
sources remain controlled by the pack's `EMISSIVE_TYPE=1` setting.

Apply and verify the material profile with Minosoft's checked
`small-survival-authored-materials.json` acceptance scenario. This intentionally
persists the chosen shader setting in that trajectory. Compare native and Bliss
captures at matched pose/time/weather, including shader disable/enable and
reload, and restore transient capture controls afterwards. Capture artifacts
are diagnostic, not user-approved baselines. No automatic approval is granted.

Shared `prepareModel` cleanup adds culling only to unrotated boundary faces and
removes zero-area exported faces. Inset or rotated surfaces remain drawable.
The survival set provides state-aware log axes, snowy ground, and fern halves,
precolored foliage without double tinting, and small mushroom geometry. Raw
stone recipes avoid baked tile borders. Keep future fixes in these sources,
not the generated PNG/JSON files.
