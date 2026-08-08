# producers/blockbench

CDP-driven producer for **3D models / entities** — the Blockbench + automation path
(the wizard-style pipeline). This is where the drivers currently living in the
Blockbench checkout under `test/acceptance/` (`eval.mjs`, `shot.mjs`, the export
helpers) should migrate so production tooling lives with production, not in the
engine repo.

Planned entry point:

```js
// index.mjs
export async function produce(target, recipe) { /* drive Blockbench via CDP -> PNG/model into out/ */ }
```

Mechanics (from the Blockbench automation memory):
- Launch: `BLOCKBENCH_AUTOMATION=1 electron --remote-debugging-port=9223 --user-data-dir=/tmp/bb-forge .`
- Drive `window.AutomationRuntime.send({protocol_version:1,id,method,params})`.
- Screenshot / raster bake via CDP `Page.captureScreenshot`.

Not implemented yet (scaffold). Which families route here is defined in
`scripts/generate.mjs` (`BLOCKBENCH` set, currently empty).
