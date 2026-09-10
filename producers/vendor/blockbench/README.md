<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Retained portable texture generator

`texture_gen.js` is the zero-DOM Blockbench generator used by content-forge's
raster producers. This exact source snapshot includes the survival material
changes already used to author the checked-in exemplars. The wrapper verifies
its SHA-256 against `provenance.json` before importing it. A fresh checkout can
run the producer tests without a sibling editor checkout.

The recorded Git commit identifies the original base; the snapshot includes
local changes and is not claimed to be available at that commit. The imported
file retains its copyright and GPL-3.0-or-later notice; `LICENSE.MD` contains the
license text. The sibling Blockbench checkout and its index were left intact.

To update, copy the reviewed portable generator from Blockbench, record its base
commit and exact snapshot SHA-256 in `provenance.json`, and run `npm test` plus
the relevant material review. Check the resulting exemplar/candidate changes
before accepting new art. Do not refresh this snapshot automatically during a
build. `FORGE_TEXTURE_CORE=/absolute/path/to/texture_gen.js` opts into a local
development generator; editor launch still uses `BLOCKBENCH_ROOT`.
