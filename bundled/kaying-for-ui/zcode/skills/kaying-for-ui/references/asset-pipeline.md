# Game UI Atlas and Engine Handoff

Convert approved semantic PNGs into an atlas and engine JSON. This skill does not perform pixel recognition, does not auto-guess semantics, and does not claim to generate native engine project files.

## Preconditions

- `sprite-contract.yaml` status is `approved` (or `default` passed quality checks this run and auto-closed)
- All PNGs use semantic names
- Every item links `component_id`, `state`, and `slice`
- `review.text_free: true`
- 9-slice margins:
  - `review`: manually previewed
  - `default`: fill defaults from `config/slice-rules.yaml`, log uncertain items in the final summary

## Sprite slicing methods

- `9-slice`: buttons, panels, popups, progress bars
- `full`: cards, characters, badges, backgrounds
- `1:1`: icons, currency
- `tile`: repeatable textures

9-slice margins format:

```yaml
slice:
  type: 9-slice
  margins: [left, right, top, bottom]
```

## Atlas

Read `contracts/atlas-contract.yaml` and run:

```bash
kui atlas specs/<project-id> --force
```

Built-in packer:

- Uses transparent PNGs
- Does not rotate assets
- Can pad to power-of-two sizes
- Saves region, pivot, state, component ID, and slice
- Generates Atlas PNG and JSON
- Updates the atlas contract to `packed`

Check after packing, then set the status to `approved` (`review`: manual check; `default`: auto-close after a passing self-check and log in `quickstart.md`).

## Engine JSON

Read `contracts/export-contract.yaml` and run:

```bash
kui export specs/<project-id> --force
```

Supports:

- Godot JSON: texture, region, patch margins
- Unity JSON: Sprite Multiple rect, pivot, border, pixels per unit
- Cocos JSON: frame rect, original size, cap insets
- Generic JSON: Atlas and sprite metadata
- Each engine folder ships a `README.md` (how an Agent auto-applies the UI on that platform, including "Agent quick start")
- Each engine folder ships `demo/` — a runnable reference implementation: fixed-template assembler + engine-language mirror of `ui-main.json`
  (godot: `main.gd`+`ui_data.gd`; unity: `KuiDemoBuilder.cs`+`KuiUIData.cs`;
  cocos: `ui-demo.ts`+`ui-data.ts`; generic: `main.js`+`ui-data.js`+`index.html`)
  + `README.md` (setup-run-verification guide). Assembles every screen; events only log with the `[kui-demo]` prefix;
  clickable controls bind the `pressed` state of the two-state (normal/pressed) (darken fallback when sprites are missing); for smoke test and integration reference, not the target project files
- **taptap-maker**: Atlas + theme/component/screen master manifest (`ui-main.json`), plus
  - `theme.lua` — maps to `UI.Theme` in `urhox-libs/UI`
  - `component-map.json` — kui components → UI Widget
  - `screens.json` — screen structure and Lua skeleton
  - `demo/` — runnable reference implementation: `main.lua` (fixed-template assembler) + `ui-data.lua` (Lua mirror of `ui-main.json`) + `README.md` (run steps); assembles every screen; events only log with the `[kui-demo]` prefix; for smoke test and integration reference, not the target project files
  - `README.md` — Maker integration steps

taptap-maker UI stack: Lua + Yoga layout + NanoVG rendering; `UI.Init` → build tree → `UI.SetRoot`; scaling `UI.Scale.DEFAULT`; interactive content uses `UI.SafeAreaView`.

These files are a deterministic handoff manifest. Native `.tres`, `.tscn`, Unity SpriteAtlas, Cocos project importers, and a full TapTap Maker game project are outside the built-in scope. `demo/` is a standalone reference implementation / smoke-test sample: when integrating into a real project the JSON manifest remains the single source of truth; never claim the demo is the target project files.

## Verification (by mode)

- `review`: manual verification
- `default`: automatic verification; anomalies are logged in the final summary

- Atlas has no overlap, clipping, or alpha contamination
- region matches source PNG dimensions
- 9-slice leaves a stretchable center
- All semantic names are unique
- Engine JSON references the same Atlas
- Never mark native project files as generated

## Done definition

- `atlas-contract.yaml` status is `approved`
- Atlas PNG and JSON exist
- `export-contract.yaml` status is `approved`
- Every target engine JSON exists and parses
- Project passes strict validation

## Web delivery (required)

```bash
kui web specs/<project-id> --force
```

Generates `exports/web/{manifest.json,tokens.css,README.md}` (README is the Agent auto-integration guide) plus root `result.html` (interactive preview) and `index.html` (asset and structure overview). Style templates are fixed in the plugin `templates/web/`.

## Open delivery preview (required)

When work is complete you must open the entry page `index.html`:

| Environment | Action |
|---|---|
| The current environment has a usable right / preview panel | Open `index.html` in the right panel; do not also launch the system browser |
| No panel, or cannot tell | Put a clickable link to `index.html` in the task summary and open it in the system browser (macOS `open`, Linux `xdg-open`, Windows `start`) |

The task summary always includes the absolute paths: `PREVIEW: …/index.html` and `PREVIEW_ALT: …/result.html`. See SKILL.md §7.
