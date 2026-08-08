# Contract: the input queue (consumer → producer demand)

**The consumer drives the needed content.** content-forge does not decide what to
make; Minosoft does, and exports it as a ranked, pattern-tagged queue. This is the
"input queue" — the input to *production*.

## Producing the queue (in the Minosoft checkout)

```sh
./play.sh content queue --stack standalone --json
# writes .run/content-queues/standalone.json  (full model, fingerprinted)
#    and .run/content-queues/standalone.csv   (ranked, one row per target)
```

`.run/` is regenerated runtime state and is never committed; content-forge takes a
snapshot into `work/queue.csv` via `scripts/pull-queue.mjs`.

## The pointers: general patterned content, ranked "next"

Every row already carries the two things a producer needs — **what pattern** and
**how soon**:

- **`detail`** — the *general pattern* (family) the target belongs to, from
  Minosoft's single classifier (`GeneratedTextureLibrary.family`). Examples:
  `generic_block`, `spawn_egg`, `banner`, `wood`, `glass_pane`, `door`,
  `candle_cake`, `shulker_box`, `bed`, `potted_plant`, `head`, `coral_fan`,
  `infested`, `generic_item`. (For non-textures, `detail` is `blockstate` / model
  kind.)
- **`disposition`** — `generate` (synthesize it), `select` (a real asset should be
  chosen; `candidateSources`/`candidateTargets` say from where), or `resolved`
  (already satisfied — skip).
- **`tier` + `priority`** — the ranking. The CSV is emitted in `top(...)` order, so
  reading top-down *is* "what's needed next."

### CSV columns

```
kind, resource, target, disposition, tier, priority, detail,
consumerCount, consumers, candidateSources, candidateTargets
```

`target` is the resource-pack-relative path the producer must fill, e.g.
`assets/minecraft/textures/block/bamboo.png`.

### JSON (full model)

`.json` adds top-level `fingerprint`, `counts` (`generate`/`select`/`resolved`/…),
and `selectionSources`. Pin the `fingerprint` to detect when demand changed.

## How the producer consumes it

1. Filter to actionable rows: `disposition == generate` (and optionally `select`
   where content-forge can author a better asset than the placeholder).
2. Group by **`detail`** (pattern) → route each group to a producer:
   flat 16×16 families → `producers/raster/`; 3D / entity families → 
   `producers/blockbench/`.
3. Walk each group in CSV (rank) order and emit `target` PNGs into `out/`.
4. Re-audit in Minosoft; produced targets drain as `resolved` and drop out of the
   next queue.

## The `select` lane (selection queue)

`disposition: select` means the consumer wants a *real* asset chosen from a
package, not a synthesized one — with `candidateSources`/`candidateTargets`
pointing at near matches when they exist. It is **~90% models** (item + block
`.json`), not textures. `npm run triage` classifies every select entry into the
tool that would satisfy it and projects coverage, writing `work/selection-plan.json`:

- `candidate` — pick a near candidate from a source pack (source priority
  faithful > vanilla-evolved > voxelibre), materialize it (borrow resolver).
- `item_generated` — standard `item/generated` model (the model engine).
- `block:<type>` — a block-type / `cube_all` model template (the model engine).
- `placeholder` — a marked, replaceable texture from the procedural generator.
- `unresolved` — genuinely custom geometry (barrels, furnaces, beds, plants…):
  a candidate/borrow or a **Blockbench-authored** model. This is where the
  Blockbench producer earns its place.

Standard models are deterministic JSON templates (`producers/model/`), not
Blockbench work; Blockbench is reserved for the custom `unresolved` tail.

## Consumer-side note

Minosoft already emits the pattern (`detail`) and ranking in this export, so no
consumer change is required to "have pointers for the patterned content needed
next." If a coarser, pattern-first summary is ever wanted (families + counts +
next-N representative targets), that is a small addition to `ContentSubmissionQueue`
on the consumer side, not a producer concern.
