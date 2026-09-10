<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Retained gray wizard

[source.bbmodel](source.bbmodel) is an exact copy of the local
`blockbench-exports/wizard_gray.bbmodel`, selected as the newest of the three
wizard project exports. Open this file directly in Blockbench to edit it.
[source-provenance.json](source-provenance.json) records the initial source hash
and every embedded PNG's hash, dimensions and material settings.

The project uses Blockbench's `free` format and contains 40 elements, nine groups,
13 embedded PNG textures, and five looping animations: `idle`, `walk`, `look_at`,
`fidget`, and `work_table`. All PNGs were decoded and their dimensions verified
on import. The retained source is 51,509 bytes with SHA-256
`bcaba4dfe163913a50a1661180b551143bf8f2c8cc7ab426465ff434cde997da`.

Preserve the source's animation expressions, rig hierarchy, cube inflation,
material modes and texture playback settings when adding an exporter. The smoke
texture is a 16-frame vertical sheet at 8 fps; sparkle has 12 frames at 10 fps.
Both interpolate frames and use additive rendering. Orb, star and gem are
emissive. An export that drops these properties needs explicit fidelity findings.

The sibling Blockbench `test/acceptance/demo_wizard.js` is a related authoring
demo. It has not been verified to reproduce this saved version. The `.bbmodel`
is the editing authority; regenerating the demo must not overwrite it.
The imported project does not declare an author or license, so those provenance
fields remain unset.

The workspace discovers this directory's animated-entity [family.json](family.json).
It supports hosted editing, immutable saves, and automated [APNG review builds](../../../../docs/animation-review.md)
for all five animations. The review includes the exact saved source and a pinned
build manifest. Texture flipbooks currently use Blockbench frame stepping;
smooth interpolation remains a consumer fidelity check. This family has no
Minecraft item target. Consumer export and artistic review are still pending.
