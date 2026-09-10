# content-forge

The product direction is a team content workspace: asset families, generation,
retained sources, provenance, bounded reviews, and reproducible modpack builds.
Content-forge launches Blockbench as an editing and automation workspace for the
selected task. See the [workspace architecture](docs/workspace-architecture.md)
for ownership, the hosted editing loop, and the first integration milestone.
The [asset workspace](docs/local-workspace.md) provides a family catalog,
immutable source revisions, a pinned hosted Blockbench editor, shared reviews,
Minosoft capture, and reproducible approved resource-pack selections.

```sh
npm run workspace:init
npm run workspace:editor-build
npm run workspace                         # open http://127.0.0.1:8767
```

Hosting integration uses the public [Turbo Ogre SDK](https://github.com/turbo-ogre/sdk).
See [onboarding and review-site packaging](docs/hosting.md) for the current
artifact workflow and the remaining Artemis/auth deployment requirements.

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
Minosoft capture/review    ─►  4. feedback → recipe plan ─────────────────────►  adapt deterministic recipes
```

**The consumer drives the needed content.** content-forge never guesses demand: it
pulls Minosoft's content queue, which lists the missing targets *ranked* and tagged
with their **general pattern** (family). See [`contract/queue.md`](contract/queue.md).

**The handoff lane is `loose-content`.** `publish` writes a resource-pack tree to
`out/`; Minosoft points its git-ignored `content-stacks/standalone.local.json`
overlay at it (`loose-content.default = <abs>/content-forge/out`). See
[`contract/handoff.md`](contract/handoff.md).

**Rendered quality comes back through visual feedback.** Minosoft capture
manifests and scene diagnostics can be imported as recipe-addressable review
records. Open reports and producer candidates hold the release gate until a later
Minosoft recapture verifies them. See
[`contract/visual-feedback.md`](contract/visual-feedback.md).

## Configuration

Producer/consumer paths are machine-local. Copy the template and edit it:

```sh
cp forge.config.example.json forge.config.json   # git-ignored
npm run config                                    # print the resolved paths
```

```jsonc
{
  "schema": 1,
  "consumer": { "root": "../Minosoft", "stack": "standalone" },  // where demand comes from
  "producer": { "root": "../blockbench", "cdpPort": 9223 },        // the Blockbench engine
  "out": "out"                                                     // the loose-content handoff root
}
```

Relative paths resolve against the repo root. Every value has an env override:
`MINOSOFT_ROOT`, `FORGE_STACK`, `BLOCKBENCH_ROOT`, `BLOCKBENCH_CDP_PORT`,
`FORGE_CONFIG`. Precedence: **env > forge.config.json > sibling default**.

Raster generation uses the [retained texture core](producers/vendor/blockbench/README.md),
so `npm test` needs no sibling editor checkout. `FORGE_TEXTURE_CORE` explicitly
selects a development generator; `BLOCKBENCH_ROOT` selects the interactive editor.

## Layout

| Path | Role |
| --- | --- |
| `contract/` | Queue (consumer→producer demand), handoff (producer→consumer assets), and visual feedback (consumer→producer quality evidence). |
| `work/` | Pulled queue snapshots (git-ignored runtime state). |
| `recipes/` | Per-target / per-family generation specs. |
| `producers/raster/` | 2D deterministic generator for flat 16×16 block/item textures. |
| `producers/blockbench/` | CDP drivers for 3D models / entities (the wizard-style path). |
| `scripts/` | `pull-queue` · `triage` · `generate` · `publish` · `visual-feedback`. |
| `out/` | The handoff resource pack the consumer ingests. |

## Status

Production scripts and an authored survival overlay are implemented. Coverage and
visual quality remain open; see [the current backlog](docs/quality-backlog.md).
The [asset standard](docs/asset-style-standards.md) requires Minecraft-quality
content in the same style. Deterministic generation does not grant approval.

```sh
npm run audit                       # local references/provenance + quality flags
npm run audit -- --pack out-survival --output work/survival-quality-audit.json
npm test
npm run gate                        # current asset/review/evidence hashes + feedback
```

`audit` writes `work/quality-audit.json` with consumer demand, missing local files,
and issues. A clean local audit is not visual acceptance or composed-stack
closure. `gate` and `release` use the same current-file checks; neither trusts
historical auto-approval in the derived database. A held release preserves the
previous manifest. Candidate publication into `out/` is still a development step;
only a passing release manifest records an accepted set.

## Small review sets and editable item families

Start with [the cohort and source workflow](docs/item-family-review.md).
`npm run items:plan` groups current item demand into bounded review sets.
Retained `.bbmodel` sources live under `producers/blockbench/items/`; the current
Blockbench automation exports each named group into an immutable candidate pack.

```sh
npm run review:cohort
npm run review:cohort -- --cohort review/cohorts/survival-plants.json
npm run items:export -- producers/blockbench/items/ingots/family.json --port 9333
npm run review:cohort -- --family ingots
```

Sheets under `work/reviews/` are self-contained HTML with model rotation, block
states, texture/tiling inspection, source downloads, and review-note export.
They retain exact model/texture/source hashes. Review notes and studio previews
remain separate from release approval and Minosoft in-game acceptance.
