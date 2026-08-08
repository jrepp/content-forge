# Contract: the handoff (producer → consumer assets)

content-forge publishes finished assets into `out/`, and Minosoft ingests them
through its **`loose-content`** source. The path is wired machine-locally so no
absolute path is ever committed to either app.

## `out/` layout — a resource-pack root

```
out/
  assets/
    <namespace>/            # usually minecraft
      textures/<path>.png   # each queue `target`, minus the leading assets/<ns>/
      ...
  provenance.json           # metadata (consumer ignores non-assets/ files)
```

- One PNG per satisfied queue `target`. Flat block/item textures are **16×16 RGBA**,
  static (no `.png.mcmeta`).
- `out/` is a `directory`-type source for Minosoft's composer: it is copied as an
  authored layer. Higher-priority authored packs still win; this fills the gaps.

## Wiring the consumer (once, per machine)

In the Minosoft checkout, copy the tracked example and point `loose-content` here:

```jsonc
// content-stacks/standalone.local.json   (git-ignored)
{
  "schema": 1,
  "overrides": {
    "loose-content": { "default": "/Users/you/d/content-forge/out", "optional": false }
  }
}
```

Minosoft applies the overlay automatically when it reads `standalone.json`
(`ContentStackManifest.applyLocalOverlay`). `MINOSOFT_CONTENT_DIRECTORIES` is
path-separator-splittable, so multiple handoff roots are allowed.

## provenance.json

Written by `scripts/publish.mjs`; lets a reviewer trace every emitted byte.

```jsonc
{
  "schema": 1,
  "producer": "content-forge",
  "generatedAt": "<ISO-8601>",
  "queueFingerprint": "<from Minosoft queue .json>",
  "targets": [
    {
      "target": "assets/minecraft/textures/block/bamboo.png",
      "family": "generic_block",      // the queue `detail` pattern
      "producer": "raster",           // raster | blockbench
      "recipe": "recipes/generic_block.json",
      "sha256": "<hex of the PNG bytes>"
    }
  ]
}
```

## Determinism

A produced target should be a pure function of its `target` path + pinned recipe
tables, so re-publishing is byte-identical and diffs stay meaningful. To achieve
byte-parity with Minosoft's built-in fallback generator, mirror its determinism
contract (FNV-1a 64-bit seed → Java `Random` LCG, fixed palette/tone tables, the
`mix`/`shade`/`hsv` color math) documented in the Minosoft evidence map
`doc/agents/evidence/2026-08-08-asset-primitive-decomposition.md`. Diverging is
fine — authored content wins during compose regardless — but then it is *authored*,
not a drop-in replacement for the generated layer.
