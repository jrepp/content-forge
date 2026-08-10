# Blockstate patterns — the blockstate lane

Producer: `producers/model/blockstates.mjs` (`node producers/model/blockstates.mjs
[--dry]`). Drains the whole `disposition == generate, kind == blockstates` slice of
`work/queue.json` — one blockstate JSON per block the consumer renders. Output is a
gitignored build artifact under `out/assets/minecraft/blockstates/` (regenerated
deterministically; `out/**` is ignored). Self-check: the lane exits non-zero if any
`apply.model` ref doesn't resolve to a model file in `out/` ("blockstate lane
self-complete"). Companion to `model-base-types.md` (which owns the *models*; this
owns the *state → model* mapping).

## Core rule: MULTIPART, never `variants`

A multipart `apply` with no `when` renders in EVERY state; `when` is **subset-matched**
(AND of the listed props, extra props ignored). So we never enumerate a block's full
property set (that lives in the consumer). We pick a pattern by **name suffix**.

Where a property must be **mutually exclusive** (stairs `shape`, button `face`), the
subset rule would let a less-specific part *also* fire and double-draw — so for those,
**every part pins the full state tuple**. That makes multipart behave like `variants`
while staying tolerant of extra props the consumer may add.

## The pattern catalog

```
pattern              suffix / match                    parts            helper models
────────────────────────────────────────────────────────────────────────────────────
pillar (axis)        _log _wood _hyphae                axis x/y/z       —
stairs               _stairs                           facing×half×     <name>_inner,
                                                        shape (40)        <name>_outer
slab                 _slab                             type bottom/     <name>_top,
                                                        top/double        <name>_double
connections          _fence _wall _glass_pane          post + 4 arms    <name>_side
door                 _door                             facing×open (8)  —  (both halves
                                                                            share the panel)
trapdoor             _trapdoor                         half/open +      —
                                                        facing/open (6)
button / lever       _button _lever                    face×facing(12)  —
horizontal facing    _fence_gate _glazed_terracotta    facing (4)       —
                     _wall_torch _wall_sign _wall_fan
                     _coral_wall_fan
single model         everything else                   1                —
```

**Single-model on purpose** for standing `_banner` / `_sign` / `_head` / `_skull`:
their fine 0–15 yaw is a **block-entity** concern, not a blockstate one — the vanilla
blockstate for these is also a single variant. Don't "fix" them with rotation parts.

**Connections** (fence/wall/pane) are all the same shape: a center post that renders
unconditionally + one north-pointing `<name>_side` arm the multipart rotates to each
connected neighbour (`north/east/south/west == 'true'`). Add a new connection block by
routing its suffix here and giving it an arm shape.

**Doors** are reduced to `facing × open` (8 parts); both halves render the same
placeholder panel and the swing is a +90° yaw. Real hinge (left/right) + separate
upper/lower geometry is deliberately *not* modelled — placeholder-adequate, not vanilla.

## Helper geometry lives in `producers/model/shapes/`

Base shapes in `producers/blockbench/base-shapes/` are **regenerated** from
`sources/base-shapes.bbmodel` by `author-tree`/`fold-tree` — hand-authored JSON there
gets clobbered. Blockstate-lane-only helper shapes therefore live in a separate,
durable dir: `producers/model/shapes/*.json` (currently `fence_arm`, `wall_side`,
`stairs_inner`, `stairs_outer`, `sign`, `candle`, `lever`). `blockstates.mjs` merges
both dirs into its shape lib (extras win on name clash).

Shape file format is minimal: just `{ "elements": [ … ] }` with every face's
`texture` set to `"#0"`. `instantiateModel()` deep-clones the shape, binds every `#N`
slot (plus `particle`) to the block's own texture (`minecraft:block/<name>`), and
strips Blockbench-only `format_version`/`groups`. Orientation convention: author the
one arm/step pointing **north (−z)** so the multipart's `y` rotations line up.

## Extending

1. New suffix family → add a branch in `buildBlockstate()` returning `{ parts, helpers }`.
2. Need geometry the base shapes don't have → drop a `producers/model/shapes/<x>.json`
   and reference it via the `helper(suffix, shape)` closure (writes `<name><suffix>`
   and returns its model ref).
3. If the family needs an exclusive property → pin the full tuple in every `when`.
4. Run `--dry` (routing histogram, no writes), then the real run (must report
   `dangling blockstate model refs: 0`).

Live "does it actually render" is confirmed downstream in the Minosoft consumer's
compose → re-audit loop, not here.
