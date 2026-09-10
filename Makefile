# content-forge — the one-command pipeline loop.
#   make all      pull demand → produce → publish → index
#   make gate     hold the release until 100% reviewed, none rejected
#   make release  emit the approved-only manifest
#   make verify   prove the producers are byte-stable (idempotent)
#   make loop     all + gate + release  (the full loop)
#   make exemplars       (re)capture the per-family golden tiles
#   make exemplars-check  score current recipes against the goldens (drift guard)
MINOSOFT ?= ../Minosoft
.PHONY: all queue produce convert publish index gate release verify loop clean exemplars exemplars-check feedback-check review review-split review-check

queue:
	node scripts/pull-queue.mjs
	node scripts/triage.mjs --json
	node scripts/model-taxonomy.mjs

produce:
	node producers/model/synth.mjs
	node producers/raster/synth-textures.mjs --all
	node producers/model/resolve-candidates.mjs
	node producers/model/blockstates.mjs
	node producers/raster/reference-closure.mjs

# Author the Blockbench asset set (needs a running BLOCKBENCH_AUTOMATION instance).
# Reproducible from the committed .bbmodel sources + the base-shape table. Order:
# convert (bespoke authored) -> author-tree (base shapes) -> instantiate (block
# models from authored geometry, keeping bespoke) -> re-close texture refs.
author:
	node producers/blockbench/convert.mjs
	node producers/blockbench/author-tree.mjs
	node producers/model/instantiate.mjs
	node producers/raster/reference-closure.mjs

convert:
	node producers/blockbench/convert.mjs

publish:
	node scripts/publish.mjs

index:
	node scripts/db.mjs index

gate:
	node scripts/db.mjs gate

release:
	node scripts/release.mjs

verify:
	node scripts/verify-determinism.mjs

review:
	node scripts/texture-sheet.mjs

review-split:
	node scripts/texture-sheet.mjs --split

review-check:
	node scripts/acceptance-review-split.mjs

exemplars:
	node producers/raster/exemplar.mjs capture

exemplars-check:
	node producers/raster/exemplar.mjs check

feedback-check:
	node scripts/visual-feedback.mjs check
	node scripts/visual-feedback.mjs plan

all: queue produce publish index

loop: all gate release

clean:
	rm -rf "$(shell node --input-type=module -e "import('./scripts/config.mjs').then(m => console.log(m.loadConfig().outDir))")/assets"
