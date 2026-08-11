# Texture exemplar loop

The texture producer draws every generated tile from a small set of **family
recipes** in the Blockbench core (`js/automation/texture_gen.js`): `generic_block`,
`generic_item`, `wood`, `planks`, `leaves`, `ore`, `bricks`, `glass`, `glass_pane`,
`banner`, `spawn_egg`. Each family owns a palette + structure so, say, `oak_planks`
reads as boards and `diamond_ore` reads as ore rather than as a flat tinted swatch.

`producers/raster/exemplar.mjs` closes the quality loop around those recipes. One
canonical tile per family is committed as a **golden** under
`producers/raster/exemplars/<family>.png`, and the harness scores the live recipe
output against it (mean absolute per-channel error, `0` = identical, `255` = max).

## Two loops, one mechanism

**Regression baseline (Phase 4).** The goldens are the current recipe output.
`make exemplars-check` regenerates each tile and fails if any drifts past the
threshold (default `0.5`, i.e. effectively byte-identical). Run it after editing a
recipe: an intended change shows up as drift, you eyeball it, then `make exemplars`
re-captures to lock the new baseline. Because the core is seed-deterministic, a clean
checkout reproduces the goldens byte-for-byte.

**Authored-exemplar tuning (Phase 2).** To raise a family to authored quality,
replace its golden with an **authored reference**:

- a tile painted/exported from Blockbench (`export_texture`), or
- a real reference-pack texture of that family (Faithful, vanilla, …).

Then run `node producers/raster/exemplar.mjs check --threshold 999` to read the MAE
gap to the reference, tune the recipe (palette, ops, noise) to shrink it, and iterate.
`png.mjs` decodes any 8-bit PNG (RGBA / RGB / grayscale, all scanline filters), so the
reference can come from anywhere. When the recipe is close enough, re-capture to make
the tuned output the new committed baseline.

## Commands

```
make exemplars          # (re)capture the golden tiles from the current recipes
make exemplars-check     # score current recipes vs the goldens; non-zero exit on drift
node producers/raster/exemplar.mjs check --threshold 8   # tuning against an authored golden
```

The family → sample-block table lives at the top of `producers/raster/exemplar.mjs`;
add a row there when a new family recipe lands, then `make exemplars`.

## Relation to in-situ review

The goldens above check a texture **in isolation**. The composed, in-world look — a
block lit and viewed from an angle — is reviewed through the consumer: see
`../Minosoft/doc/design/capture-utility-trajectory.md` for the Minosoft capture-utility
loop that screenshots a placed block and feeds the image back into the asset index.
