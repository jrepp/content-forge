# content-forge — the one-command pipeline loop.
#   make all      pull demand → produce → publish → index
#   make gate     hold the release until 100% reviewed, none rejected
#   make release  emit the approved-only manifest
#   make verify   prove the producers are byte-stable (idempotent)
#   make loop     all + gate + release  (the full loop)
MINOSOFT ?= ../Minosoft
.PHONY: all queue produce convert publish index gate release verify loop clean

queue:
	node scripts/pull-queue.mjs
	node scripts/triage.mjs --json
	node scripts/model-taxonomy.mjs

produce:
	node producers/model/synth.mjs
	node producers/raster/synth-textures.mjs --all
	node producers/model/resolve-candidates.mjs
	node producers/raster/reference-closure.mjs

# Optional: re-author the bespoke tail through Blockbench (needs a running
# BLOCKBENCH_AUTOMATION instance). Deterministic reproducer = the committed
# .bbmodel sources under producers/blockbench/sources/.
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

all: queue produce publish index

loop: all gate release

clean:
	rm -rf "$(shell node --input-type=module -e "import('./scripts/config.mjs').then(m => console.log(m.loadConfig().outDir))")/assets"
