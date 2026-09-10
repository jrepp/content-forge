<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Content quality and missing-content backlog

## Acceptance target

Minecraft quality or better in the same style, as requested on 2026-09-08.
Follow [the asset standard](asset-style-standards.md). Completion requires both
consumer coverage and reviewed fidelity; placeholders do not close quality work.

## Current evidence — 2026-09-08

Refreshed with Java 25 using Minosoft's
`./play.sh content queue --manifest standalone --csv --top 25 --json`, followed
by `npm run pull-queue` and `npm run triage -- --json`.

Queue fingerprint:
`a28e91c37b4b033eb700e0835efd78d8c5905aca7b928630c63c5b8698df3760`.
The six recorded audits cover 4,146 targets. There are 2,816 resolved and 1,330
actionable targets: 261 generate, 612 select with candidates, and 457 select
without candidates. Of the actionable targets, 1,306 are item models and 24 are
block models. This is audit-derived demand, not complete registry coverage or a
claim that every actionable target is absent from the composed game.

`npm run audit` checks 3,668 local assets in `out/`: no detected local JSON
reference or provenance errors, 267 placeholder-recipe texture flags, and 11
fence gates without open-state selectors. Of the actionable queue targets,
1,329 have no file in this local output. Higher composition layers can supply
assets; local absence and missing consumer content are distinct.

The survival overlay has 143 assets (plus `pack.mcmeta` in provenance), with no
detected local reference/provenance errors. Its 31 diffuse textures and focused
model/material tests are an existing candidate cohort, not a new visual approval.
One high-severity visual-feedback record remains at `candidate`.

The refreshed triage still projects 100% routability. That is not evidence of
fidelity: it proposes generic templates for custom content and may borrow a
placeholder from `loose-content`. The prior completion checklist and blanket
generated-asset approvals cannot establish the requested quality bar.

## Review workflow now available

[Item families and cohort review](item-family-review.md) implements small portable
model/texture sheets and a retained Blockbench source/export path. The iron/gold
ingot family is a two-item candidate proving edit retention and byte-stable
exports. Its art remains unapproved. Use these sheets to review the cohorts below;
keep final Minosoft validation separate.

## Ordered work cohorts

1. **Review and finish the survival material cohort.** Use the existing feedback
   for water transparency, cobble tiling, dark-stone separation, soil structure,
   and spruce bark/foliage. Review native-scale tiles, repeated terrain, native
   rendering, and Bliss at matched scene state. Repair source recipes only for
   confirmed defects; recapture before resolving feedback or approving assets.
2. **Repair fence-gate semantics and geometry.** `acacia_fence_gate` currently
   instantiates `fence_post`; all 11 wood gates omit open-state selection. Author
   a representative gate with closed/open and in-wall forms, correct facing,
   UV/material binding, and inventory presentation. Test its state matrix,
   review it against its neighboring fence, then extend across wood materials.
3. **Close foundational block-model demand.** The 12 select-without-candidate
   block models are `bedrock`, `block`, `crimson_nylium`, `cross`, `cube`,
   `cube_all`, `cube_column`, `lily_pad`, `netherrack`, `orientable`,
   `template_torch_wall`, and `warped_nylium`. Separate parameterized parent
   templates from actual blocks. Preserve display transforms, texture slots,
   tinting, orientation, and thin geometry. Do not generate textures named after
   abstract templates or route lily pads and torches to `cube_all`.
4. **Close item models by behavior, starting with reviewed survival blocks.**
   There are 445 select-without-candidate item models. For each cohort, resolve
   actual texture/parent dependencies against the composed stack, then verify
   inventory, dropped, and held views. Flat sprites, block items, handheld
   tools, layered/tinted items, and stateful items require separate treatment.
   Retain predicates and special rendering instead of blindly emitting
   `item/generated` for every item.
5. **Replace the remaining placeholder materials.** The local audit reports
   their exact target and recipe. Prioritize those visible in accepted gameplay
   scenes, establish a reviewed representative, and expand only once that
   representative meets the standard. Re-audit after each cohort.

## Repeatable checks and gate

```sh
npm run audit
npm run audit -- --pack out-survival --output work/survival-quality-audit.json
npm test
npm run gate
```

Reports under `work/` are regenerable local state. `audit` is limited to local
JSON references and provenance; PNG integrity, complete blockstate/geometry
semantics, composed dependencies, and visual fidelity need additional checks.
No new art was generated or visually accepted during this baseline audit.

`gate` and `release` now share current-file validation. The gate holds on missing
or altered assets/provenance, unmanifested files, local reference errors, incomplete gate state selectors, missing
current approval/preview hashes, and active feedback. Old reviews remain intact;
18 historical approvals need current hash/evidence records, while 3,650 other
local assets need approval. Deterministic outputs no longer auto-approve.
A held release does not replace the existing manifest. Publishing a development
candidate still does not constitute acceptance, and the running game was not
reloaded or altered for these checks.
