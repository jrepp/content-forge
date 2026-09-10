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

## Shadow mask

`assets/minecraft/textures/misc/shadow.png` is a 64×64 black alpha decal.
The shared texture-core wrapper routes this exact target to `shadow-mask.mjs`,
including reference-closure and bulk generation. It must never use a generic
block recipe. Regenerate only this target, publish provenance, then recompose
the consumer stack:

```sh
node --test tests/shadow-mask.test.mjs
node producers/raster/synth-textures.mjs --all --target assets/minecraft/textures/misc/shadow.png
node scripts/publish.mjs
```
