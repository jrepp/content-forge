# Model base types — the content tree

Generated view: `npm run taxonomy` (writes `work/custom-models.csv`, prints this
tree). This is the build spec for the model synthesis engine: build the small set
of **base shapes** below and most of the "custom" tail derives from them.

The `select` model tail that no template covered = **143 models**. Binned by the
shape you build once and reuse:

```
build strategy   base shape        models  how it's built
────────────────────────────────────────────────────────────────
builtin          builtin_none          4   empty / builtin (air, barrier, light, structure_void)
entity_builtin   entity_banner        32   {"parent":"builtin/entity"} one-liner (16 dyes × standing/wall)
entity_builtin   entity_head          11   {"parent":"builtin/entity"} (creeper/dragon/piglin/player/zombie × floor/wall)
entity_builtin   entity_chest          3   {"parent":"builtin/entity"} (chest, ender_chest, trapped_chest)
entity_builtin   entity_misc           2   {"parent":"builtin/entity"} (conduit, decorated_pot)
base_shape       cube_orientable      24   ONE facing-cube shape; textures/facing vary
                                            (16 glazed_terracotta + furnace/blast_furnace/smoker/
                                             jukebox/loom/stonecutter/beehive/bee_nest/piston…)
base_shape       cross_plant           7   ONE crossed-planes shape (azalea, vine, dripleaf, …)
base_shape       cube_inset            1   inset cube (cactus)
parametric       candle               16   one shape, param = candle count 1..4, dye texture
parametric       candle_cake          16   cake + single candle, dye texture
variant_shape    cauldron              4   one shape + fill state (empty/water/lava/powder_snow)
variant_shape    anvil                 3   one shape + damage (intact/chipped/damaged)
variant_shape    campfire              2   one shape + normal/soul
variant_shape    dripstone             1   thickness × direction states
custom           bespoke              17   genuinely unique -> author in Blockbench
```

**Acceleration:** build **~14 base/parametric shapes → 126 / 143 models**. Only
**17 are truly bespoke** (Blockbench-authored): the odd unique geometry
(barrel, bell, chain, composter, grindstone, hopper, lectern, lightning_rod,
scaffolding, sculk_sensor/shrieker, …). See `work/custom-models.csv` for the full
per-model binning (`name,target,shape,build,variant,dye,parent,note`).

## The tree (base types to build off)

```
model
├── builtin              (no geometry / builtin)            [4]
├── entity_builtin       parent = builtin/entity            [48]
│   ├── banner  (standing | wall)                            32
│   ├── head    (floor | wall)                               11
│   ├── chest                                                 3
│   └── misc    (conduit, decorated_pot)                      2
├── base_shape           one reusable parametric shape       [32]
│   ├── cube_orientable  facing cube; texture/facing params  24
│   ├── cross_plant      crossed planes                        7
│   └── cube_inset       inset cube                            1
├── parametric           one shape + a param + dye texture   [32]
│   ├── candle           count 1..4                           16
│   └── candle_cake      cake + candle                        16
├── variant_shape        one shape + state variants          [10]
│   ├── cauldron (fill) · anvil (damage) · campfire · dripstone
└── custom               bespoke — Blockbench                [17]
```

## Build order (by leverage)

1. **entity_builtin** (48) — near-free: emit `{"parent":"builtin/entity"}` (+ a
   particle texture where needed). Biggest instant win.
2. **cube_orientable** (24) — one facing-cube shape parameterized by textures.
3. **candle + candle_cake** (32) — two parametric shapes × 16 dyes.
4. **variant_shape** (10) + **cross_plant/cube_inset** (8) — small shape sets.
5. **custom** (17) — the only real Blockbench-authoring queue.

These base types are also where `generate_model` / a Blockbench producer plugs in
for the bespoke 17; everything above is deterministic JSON templating.
