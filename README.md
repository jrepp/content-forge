# content-forge

The content-production seam between the **producer** (Blockbench + automation, an
asset *engine*) and the **consumer** (Minosoft, a game *client*). Neither app owns
production logic, the work list, or the produced assets — this repo does.

```
Minosoft (consumer)              content-forge (producer / orchestrator)         Blockbench (engine)
──────────────────              ───────────────────────────────────────         ───────────────────
./play.sh content queue   ─►  1. pull-queue   work/queue.csv  (what's needed, ranked)
  = the input queue            2. generate ──────────────────────────────────►  drive automation (CDP)
  (consumer DRIVES demand)         per family/pattern, in priority order          export PNGs / models
standalone.local.json   ◄─    3. publish   →  out/  (resource pack + provenance.json)
  overlay → loose-content
content compose + re-audit ─►  (targets drain as `resolved`; repeat to zero)
```

**The consumer drives the needed content.** content-forge never guesses demand: it
pulls Minosoft's content queue, which lists the missing targets *ranked* and tagged
with their **general pattern** (family). See [`contract/queue.md`](contract/queue.md).

**The handoff lane is `loose-content`.** `publish` writes a resource-pack tree to
`out/`; Minosoft points its git-ignored `content-stacks/standalone.local.json`
overlay at it (`loose-content.default = <abs>/content-forge/out`). See
[`contract/handoff.md`](contract/handoff.md).

## Layout

| Path | Role |
| --- | --- |
| `contract/` | The two contracts: `queue.md` (consumer→producer demand), `handoff.md` (producer→consumer assets). |
| `work/` | Pulled queue snapshots (git-ignored runtime state). |
| `recipes/` | Per-target / per-family generation specs. |
| `producers/raster/` | 2D deterministic generator for flat 16×16 block/item textures. |
| `producers/blockbench/` | CDP drivers for 3D models / entities (the wizard-style path). |
| `scripts/` | `pull-queue` · `generate` · `publish`. |
| `out/` | The handoff resource pack the consumer ingests. |

## Status

Scaffold only — contracts and script skeletons. No working producer yet.
