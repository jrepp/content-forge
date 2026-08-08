# producers/raster

Deterministic 2D generator for **flat 16×16 block/item textures** — the bulk of the
consumer's open targets (`generic_block`, `spawn_egg`, `banner`, `wood`,
`glass_pane`, `door`, …).

Planned entry point:

```js
// index.mjs
export function render(target, recipe) { /* -> RGBA PNG Buffer (16×16) */ }
```

- Pure function of `target` + pinned recipe tables (`../../recipes/`).
- For byte-parity with Minosoft's built-in fallback generator, mirror its
  determinism contract (FNV-1a 64-bit → Java `Random` LCG, fixed palette/tone
  tables, `mix`/`shade`/`hsv`). Source of truth: the Minosoft evidence map
  `doc/agents/evidence/2026-08-08-asset-primitive-decomposition.md` and
  `util/play/GeneratedTextureLibrary.java`.

Not implemented yet (scaffold).
