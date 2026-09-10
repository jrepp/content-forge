# Content pipeline — trajectory to completion

> **2026-09-08: completion claims below are historical and superseded.**
> The refreshed queue has 1,330 actionable targets; deterministic generation
> no longer grants quality approval. Use the [current quality backlog](quality-backlog.md)
> and [asset standard](asset-style-standards.md) for new work.

The three-repo pipeline (`Blockbench` producer → `content-forge` orchestrator →
`Minosoft` consumer). This is the long-horizon plan: the completion goal, the
phases to reach it, and the **measurable closure** of each.

## Completion goal (North Star)

> The `standalone` content stack composes to **zero unresolved audit targets**;
> **every shipped asset** is provenance-complete (producer + recipe + source),
> **previewed**, **reviewed → approved** in the index, and **reproducible
> byte-for-byte** from a clean checkout. The pipeline runs as one idempotent loop:
> `audit → produce → compose → re-audit → preview → approve`.

Closure is reached when a single command drives that loop to a green terminal
state and re-running it changes nothing.

## Phase 0 — Foundations  ✅ done

Producer is a callable bridge (`new_project` · author · `export_model` /
`export_models` / `export_texture` · `load_project`); the generator core is shared
by the automation command and the paint UI. Orchestrator has
`pull-queue · triage · taxonomy · synth-models · synth-textures · convert ·
publish · db`. Consumer ingests `loose-content` via the git-ignored overlay,
composes, and previews (`content preview`, place-blocks + torches + underwater).

**Closure (met):** `content queue` drain `select 1922 → 36`; produced 1888 assets
with provenance + conversion lineage; preview lane live-validated on a display.

## Phase 1 — Coverage: drain to zero

- **Candidate / borrow resolver** — resolve the remaining 36 `select` entries
  (all have near candidates) by source priority + item↔block / block↔item
  borrows; materialize into `out/`.
- **Model-lane completeness** — the generated/flattened models reference textures
  and parents the audit never captured (~596 `Can not find asset …textures…` in a
  preview run). Emit those referenced textures (extend `synth-textures --all` to
  cover model-referenced targets) and any missing blockstates so the transitive
  graph is closed.

**Closure:** `content queue` reports `selectUnavailable = 0` **and** a `content
preview` run logs **zero** `Can not find asset …` (models + blockstates +
textures fully resolvable). No orphan references anywhere in the composed pack.

## Phase 2 — Fidelity: raise the bar to authored quality

- **Per-block tone table** — replace per-name hue with accurate block colors
  (Minosoft `blockTone`) so `andesite` is gray, not green; keep the bevel/contrast
  house style (`docs/asset-style-standards.md`).
- **Authored-exemplar loop** — refine a family's reference tile in Blockbench,
  `export_texture` it as the golden sample, tune the recipe to match; the family
  inherits the raised bar.
- **Asset-tree authoring** — author the bespoke models as ONE `.bbmodel` tree
  (groups = nodes, shared textures) and drive `export_models`; give the base
  shapes real geometry (replace flat-cube placeholders).

**Closure:** every family passes the style checklist; a curated cohort preview
sheet (one per family + the 17 bespoke) is signed off as "authored, not
placeholder"; no asset flagged `rejected` on fidelity in the index.

## Phase 3 — Review & governance: the approval gate

- **Preview → review loop** — batch-render every `published` asset via
  `content preview`, store the image path in the asset index, and review
  (`db approve|review|reject`).
- **Gate publish on approval** — `publish` (and/or compose) includes only
  `approved` assets; unreviewed/rejected are held back.

**Closure:** the shipped pack contains **only `approved` assets**; the index shows
**100 % of shipped targets reviewed** with an image and a decision; a "content
release" is a provenance-complete, approved, immutable set.

## Phase 4 — Reproducibility & CI: self-hosting

- **Determinism pins** — regeneration is byte-stable (seeded; fingerprints
  recorded); the asset index re-derives identically.
- **Regression baselines** — preview screenshots as baselines; `screenshot
  compare` gates visual regressions.
- **One-command loop in CI** — `audit → produce → compose → re-audit → preview →
  approve` runs headless/green and is idempotent.

**Closure:** a clean checkout reproduces the composed pack **byte-identically**;
CI is green; re-running the loop is a no-op (0 new/changed targets, 0 regressions).

## Historical completion checklist (superseded)

- [x] **Phase 1** — `content queue`: `selectUnavailable = 0` (only `block/air`, an
      irreducible empty model, remains `select`); `out/` self-complete —
      `reference-closure` reports **0 dangling** model texture refs. `resolved`
      2313 → **2673**.
- [x] **Phase 2** — per-block tone table gives accurate, distinct blocks; the
      automated **style checklist PASSES** (distinct identity · bevel depth cue ·
      contrast); no fidelity `rejected`.
- [x] **Phase 3** — release **GATE OPEN** (100 % reviewed, none rejected; 3868
      approved); `release` emits the approved-only manifest. Generated assets
      auto-approve by policy; authored (`.bbmodel` source) get human review.
- [x] **Phase 4** — `verify-determinism`: producers are **byte-identical across
      runs** (3869 files, same hash); `make loop` is idempotent; the gate stays
      OPEN across re-index. One-command loop in the `Makefile`.

**Closure verification** (all exit 0): `make verify` (determinism PASS) ·
`make gate` (OPEN) · `make release` (approved-only OK) · style checklist PASS ·
consumer `selectUnavailable = 0`.

The earlier pipeline was recorded as **complete** under the former policy: demand is satisfied (0 unavailable, self-complete
pack), quality is gated (100 % reviewed, style bar met), and the whole loop is
deterministic, idempotent, and driven by one command per repo.

## Running the loop (today → target)

```
# consumer: what's needed
Minosoft$ ./play.sh content queue --manifest standalone --json
# orchestrator: produce
content-forge$ npm run pull-queue && npm run triage -- --json && npm run taxonomy \
  && npm run synth-models && npm run synth-textures -- --all \
  && node producers/blockbench/convert.mjs && npm run publish && npm run db -- index
# consumer: compose + re-audit + preview
Minosoft$ ./play.sh content queue --manifest standalone --json   # drain
Minosoft$ ./play.sh content preview <asset> --output preview.png # review input
# governance (Phase 3): review → approve → gated publish
content-forge$ npm run db -- approve <target>
```

Target state wraps this in one idempotent `make` target per repo, chained by a
top-level runner.
