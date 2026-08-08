# Asset style standards (input location)

House style for generated content, enforced in the producer recipes
(`blockbench/js/automation/texture_gen.js`) and applied by the pipeline
(`content-forge/producers/`). Goal: every generated asset hits a **consistent
mark** — distinct identity + a shared depth cue + controlled contrast — so a
generated pack reads as *authored placeholder*, not noise.

## Format
- **16×16, RGBA, static** (no `.png.mcmeta`) for block/item textures.
- Deterministic: a texture is a pure function of its target name (seeded PRNG).

## Lighting convention (the shared cue)
- **Lit from the top-left.** Every full-tile texture gets a `bevel`: top + left
  edge lightened, bottom + right edge darkened. This single convention is what
  makes a flat 16² tile read as a surface with depth, and keeps the whole set
  coherent. (`OPS.bevel {light, dark}`.)

## Palette discipline
- Named families draw from fixed palettes: **DYES(16)**, **WOODS(11)**,
  **COPPER(4)**, **CORAL(10)** — never ad-hoc colors.
- **Distinct identity is mandatory.** No two blocks may render as the same tile.
  Generic blocks derive a **per-name hue** (`hueFromName`) at low, stone-like
  saturation (~0.13) with a small value jitter, so `andesite`, `basalt`,
  `cobblestone` are visibly different.
  - *Upgrade path (accuracy):* replace per-name hue with a **per-block tone table**
    (the Minosoft `blockTone` mapping) for physically-plausible colors. Hue-from-
    name guarantees *distinctness*; the tone table adds *correctness*.

## Contrast & texture
- Base tone + **noise ±12** (not ±7 — the flat/washed look came from too-low
  amplitude) + **dual speckle** (one darker `shade(-34) @5%`, one lighter
  `shade(+26) @3%`) for grain that reads without banding.
- Keep a **saturation floor** on grays: a faint hue beats dead neutral (dead gray
  reads as "missing").

## Per-family recipe (current bar)
| Family | Recipe |
| --- | --- |
| `generic_block` | per-name hue → fill → noise ±12 → dual speckle → **bevel** |
| `generic_item` | per-name hue → centered 10×10 rect → noise → **dark outline** |
| `wood` | palette bark → vertical `stripes` → dark band row → **bevel** |
| `banner` | dye fill → white emblem bar |
| `glass_pane` | tint `alpha_interior` + opaque frame |

## Consistency checklist (every asset must pass)
1. **Identity** — visibly distinct from its neighbors (hue/value/pattern).
2. **Depth cue** — carries the top-left bevel (full tiles) or a defining outline
   (items).
3. **Contrast** — grain visible at 1× without washing out; no dead-neutral gray.
4. **Determinism** — same target → same bytes.

## Raising the bar with Blockbench
The generator core is shared by the `generate_texture` automation command *and*
the paint-mode UI tool, so improving a recipe raises both the batch output and the
authoring defaults. The producer is now a full bridge (`new_project` /
`load_project` / `export_model` / `export_texture`), so the next tier is authored
exemplars: hand-refine a family's reference tile in Blockbench, `export_texture`
it as the golden sample, and tune the recipe to match — then the whole family
inherits the raised bar.
