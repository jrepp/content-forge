<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Asset quality standard

The target is Minecraft-quality content or better, in the same visual language.
A generated placeholder, a populated file path, and a deterministic recipe do
not satisfy that target. These requirements apply equally to hand-authored,
procedural, and borrowed assets.

## Visual acceptance

- Preserve recognizable block/item identity, silhouette, material palette, and
  pixel scale alongside the surrounding Minecraft-style assets. Use a named,
  versioned reference cohort for comparison. More noise or higher resolution
  does not by itself improve quality.
- Prefer deliberate pixel clusters and material structure: stone fractures,
  board spacing, end grain, metal edges, leaf masses. Avoid arbitrary name-based
  colors, speckled swatches, and identical tinted patterns across materials.
- Review tiles at native scale and repeated across a surface. Raw stone, dirt,
  and other continuous materials must not acquire a square grid from a universal
  edge bevel. Add borders only where the material calls for them.
- Preserve intentional opacity and cutouts, meaningful item silhouettes, and
  texture orientation across faces. Coordinate diffuse, normal, and specular
  channels so replacement materials do not inherit unintended emission.
- Geometry must match the block's function. Check relevant states, including
  open/closed, orientation, connection, growth, half, powered, and waterlogged
  presentation. A fence post cannot substitute for a gate; a cube cannot stand
  in for a plant or item merely because the consumer can load it.
- Match Minecraft's block scale, readable forms, and restrained shading. Check
  texture stretching, missing faces, z-fighting, culling, and inventory/held
  presentation as well as the placed block.

## Review unit and evidence

Work in small related cohorts. Start with one representative asset and review
its complete texture/model/state behavior before expanding across a family.
Reuse a reviewed material or shape where its semantics actually match.

Each cohort needs a texture sheet at native scale and enlarged with nearest
neighbor sampling, a repeated-surface view, a placed-block state matrix, and an
inventory/held-item view where applicable. Compare it with adjacent reference
assets at matched scale, pose, lighting, and presentation. Review native rendering
first, then the active shader pack. A shader must not conceal a base-content defect.

Technical checks cover parseability, dependency resolution, provenance hashes,
and focused semantic tests. Determinism and golden-image comparisons detect
regressions; neither is an artistic quality score. The local audit currently
checks JSON references and provenance, not complete PNG decoding, registry state
coverage, geometry validity, or the final composed scene.

A candidate is accepted only after an explicit visual decision on its current
bytes. `db approve TARGET --by REVIEWER --evidence PATH --note TEXT` records the
asset SHA-256 and the SHA-256 of the reviewed image or capture manifest. Evidence
must describe the reviewed asset/cohort and remain available. The gate verifies
those bytes; the reviewer is responsible for the substance of the comparison.
Historical decisions are retained but need current hashes and evidence before
release. Never update goldens merely to hide a regression.

Minosoft scene feedback stays open until a matching recapture verifies the fix.
Import captures using `npm run feedback -- ingest ...` and inspect them with
`feedback plan --json`. See [the feedback contract](../contract/visual-feedback.md).
