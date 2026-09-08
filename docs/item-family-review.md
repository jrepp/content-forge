<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Item families, retained sources, and small review sets

The working loop is **consumer demand → family → editable Blockbench source →
exported candidates → cohort review → Minosoft validation → explicit approval**.
Keep [the Minecraft-quality standard](asset-style-standards.md) throughout.

## Source tree and ownership

```text
producers/blockbench/items/
  ingots/
    family.json                 # member IDs, top-level groups, exact output paths
    source.bbmodel              # authoritative editable geometry, UVs, textures, display
    source-provenance.json      # initial texture origins and source hash
    NOTICE.md
review/cohorts/                  # named block/texture review cohorts
work/item-families/<family>/
  exports/<fingerprint>/         # immutable model/texture candidate pack + provenance
  cohort.json                   # review set derived from the family members
  latest.json                   # pointer to the most recent successful export
work/reviews/                   # portable HTML, evidence sidecars, diagnostic PNGs
```

`items:plan` reads the consumer's pulled queue and groups item-model demand by
behavior. Sets contain at most six members. Tools are grouped by tool type;
stateful, layered, armor, transport, and derived block items remain distinct.
Unclassified demand stays explicitly unclassified. Family routing is a proposal,
not permission to fill the remaining queue with generic sprites or cubes.

The first retained family contains iron and gold ingots. Its initial source uses
editable one-pixel-deep row extrusions of the existing Forge exemplar silhouettes.
The input images are embedded in the `.bbmodel`. They are initial candidates;
no new artistic quality or in-game fidelity approval is implied. Copper and
netherite ingots remain family demand until deliberately authored and reviewed.

## Blockbench automation

The pipeline uses the current checkout's protocol-v1 `load_project`,
`observe_project`, `add_group`, `add_cube`, `set_face_texture`, `set_uv`,
`export_model`, `export_models`, and `export_texture` operations. Geometry/UV
mutations follow the host's Undo and revision checks. Each export group maps to
one exact target; missing/duplicate groups and empty models reject publication.

Use an isolated automation-enabled Blockbench instance, with no active project.
The configured default CDP port may already belong to another service; this
validation used port 9333. For example, in the Blockbench checkout:

```sh
npm run build-electron
BLOCKBENCH_AUTOMATION=1 node_modules/.bin/electron \
  --user-data-dir=/tmp/content-forge-item-review-blockbench \
  --remote-debugging-port=9333 . --automation
```

The driver refuses to use an existing active project. It creates and operates on
its own project, checks that the active UUID stays bound, and closes that project
after success. Failure retains the project for diagnosis. Do not rerun by
silently discarding an unsaved tab.

Initial authoring is explicit and refuses to overwrite retained source:

```sh
npm run items:author -- path/to/new-family/family.json --port 9333
```

After initial authoring, open `source.bbmodel` in Blockbench, refine geometry,
textures, UVs, and display transforms, and save it. Members share the export
origin; isolate the group being edited in the Blockbench outliner. Export reads those saved bytes;
it never rebuilds the source from the seed recipe:

```sh
npm run items:export -- producers/blockbench/items/ingots/family.json --port 9333
npm run review:cohort -- --family ingots
```

Export identity includes the source, family definition, Blockbench version, and
exporter source digest. Repeating an identical export verifies the existing
candidate's bytes instead of replacing them. `provenance.json` ties every output
to the `.bbmodel` hash and group. Exported images come back through Blockbench's
texture export boundary. Candidate packs do not automatically enter `out/`, the
running client, or the approved release manifest.

Initial sprite authoring is intentionally limited to static binary-alpha 16×16
images and six members. Special rendering, item predicates, tint layers, and
bespoke models require their own authoring approach; do not force them into this
initializer. Hand edits to a retained source remain the normal refinement path.

## Review sheets

```sh
npm run review:cohort
npm run review:cohort -- --cohort review/cohorts/survival-plants.json
npm run review:cohort -- --family ingots
```

Open the resulting HTML directly, or serve the review directory locally:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory work/reviews
```

A custom cohort has schema 1, a lowercase `id`, title/description, and 1–12
entries with `id`, `kind` (`block`, `item`, `texture`), and a review `focus`.
The normal review unit is six. Multipart blocks require explicit `states` with
labels and property maps. Ordinary variants get individual selectable views.
Repeated `--pack PATH` inputs resolve assets in order, with the last layer winning;
use actual composed inputs when reviewing the consumer's selected assets.

Each portable HTML sheet embeds its model/texture snapshot and rendering code.
It offers model rotation, named views, state selection, saved PNG views, texture
inspection at native/enlarged/repeated scales, dependency hashes, available
`.bbmodel` downloads, and per-item decisions/notes. `Export review notes` downloads
a JSON record bound to the cohort, each item's source/asset hashes, and the
renderer build. Notes stay in the current page until exported; they are not
written into approval records automatically.

The renderer uses the Three.js dependency already installed with the configured
Blockbench checkout. The generated HTML embeds its MIT notice, version, and
bundle hash; no CDN or running editor is needed to open a completed sheet.

## Validation boundaries and evidence

Studio sheets inspect geometry and diffuse textures. They do not reproduce
Minosoft lighting, shaders, ambient occlusion, biome tint, entity rendering,
animated textures, generated-item edge extrusion, or item predicate selection.
Unsupported rotated UV-locked models and random multipart alternatives show an
explicit unavailable result. Missing dependencies stay visible as errors. Display
transforms are inspectable geometry transforms, not an actual hand or inventory.
Source model/texture changes invalidate snapshots; sheet notes are not release
approval. Use Minosoft's existing isolated `content preview` and state-sculpture
capture workflow for the final consumer check. No Minosoft renderer change was
needed for this first review/export slice.

Validation on 2026-09-08 used Blockbench 5.1.6 from the current checkout:

- Live protocol authoring retained one source tree and exported two item models
  and textures. Loading that retained source again produced byte-identical output.
- A separate copy changed one cuboid's depth; live export retained that edit,
  left source bytes unchanged, and repeated identically. The canonical source
  remained unchanged by the probe.
- `npm test` covers source dependency resolution, missing/cyclic inputs, explicit
  multipart states, cohort bounds, exact silhouette extrusion, retained geometry
  and display settings, and exhaustive bounded family partitioning.
- Dedicated headless Chrome rendered all 14 models across three sheets; camera,
  texture inspector, and decision controls passed. Run
  `npm run review:browser-check` with `REVIEW_CDP_PORT`/`REVIEW_BASE_URL` pointing
  at an isolated browser/server. PNGs under `work/reviews/` are diagnostic only.

The sheets expose unresolved artwork clearly: ingots currently read as outlined
rectangles; fern structure and mushroom proportions need deliberate art review.
Passing automation validates the workflow, not those artistic decisions.
