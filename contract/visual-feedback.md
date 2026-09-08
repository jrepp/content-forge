# Visual feedback contract

This is the return channel from the Minosoft consumer to the content-forge and
Blockbench producer lane. The queue contract says what is missing; this contract
says what rendered poorly after the generated content was used in a real scene.

```text
Blockbench recipe -> content-forge out/ -> Minosoft capture
       ^                                      |
       |                                      v
       +-- feedback plan <- review record <- screenshot + scene.json
```

## Evidence boundary

Minosoft owns scene construction, settling, rendering, and capture provenance.
content-forge accepts one of these read-only inputs:

- a `content preview` page manifest (`block-state-sculpture-capture`);
- a `*.capture-set.json` produced by `content preview`;
- a trajectory diagnostic directory containing `manifest.json` and `frame.png`;
- a Minosoft scene-review bundle with `scene.json` beside `frame.png`;
- a PNG with explicit texture targets.

The imported record stores the screenshot SHA-256, dimensions, capture metadata,
content fingerprint when available, reviewer note, issue tags, and exact texture
targets. Runtime screenshots remain Minosoft artifacts; they are not silently
copied or committed by content-forge.

For same-frame scene-review bundles, content-forge imports `scene.textures[].target`
directly. Those targets are resolved from the block/item models active in the
consumer, while block attribution remains explicitly classified as
`frustum-candidate` until Minosoft has a material-ID framebuffer. For block/model
preview manifests, content-forge follows the generated
blockstate -> model -> parent -> texture graph under `out/`. A whole-world scene
without `scene.json` cannot prove pixel ownership from the framebuffer alone, so
its importer requires explicit `--target` values.

## Review states

| State | Meaning | Release gate |
| --- | --- | --- |
| `open` | Consumer evidence identifies a material defect. | held |
| `candidate` | Producer bytes changed; a Minosoft recapture is required. | held |
| `verified` | A later consumer capture confirms the result. | clear |
| `dismissed` | Reviewer explicitly found the report inapplicable. | clear |

`candidate` is deliberately not equivalent to fixed. An isolated tile sheet can
prove byte and structural changes, but only the consumer recapture closes an
in-world contrast, repetition, scale, lighting, or material-confusion report.

## Commands

Import a normal Minosoft preview; texture dependencies are inferred:

```sh
npm run feedback -- ingest ../Minosoft/.run/previews/example.json \
  --issue repetition --issue material-confusion \
  --note "Cobble reads as a checkerboard beside snow" --severity high
```

Import a new world-scene diagnostic; texture candidates are read from
`scene.json`:

```sh
npm run feedback -- ingest ../Minosoft/.run/diagnostics/example \
  --issue low-shadow-readability --note "Dark materials collapse under the active shader"
```

Preview the inferred targets without changing review state:

```sh
npm run feedback -- inspect ../Minosoft/.run/diagnostics/example --json
```

Older diagnostic bundles without `scene.json` still accept explicit `--target`
arguments.

Feed active reports to the producer by recipe, then mark changed bytes as a
candidate:

```sh
npm run feedback -- plan --json
npm run feedback -- candidate FEEDBACK_ID --note "Raised spruce midtones and replaced cobble grid"
```

After Minosoft renders the candidate pack, attach the recapture and close it:

```sh
npm run feedback -- verify FEEDBACK_ID ../Minosoft/.run/previews/recapture.json \
  --note "Material identity and shadow readability pass in-world"
```

`npm run feedback -- check` validates durable records and detects changed local
evidence. Missing runtime screenshots are warnings because `.run/` remains
regenerable; a present screenshot whose bytes no longer match its recorded hash
is an error.

## Generator input

`feedback plan --json` is the stable adaptation surface. It groups active reports
by normalized recipe (`stone:ref-closure` becomes `stone`) and supplies states,
issue tags, feedback IDs, and exact targets. Generator automation may use the plan
to choose which deterministic recipes to revise, but it must not auto-verify its
own result. Verification belongs to a subsequent Minosoft capture.
