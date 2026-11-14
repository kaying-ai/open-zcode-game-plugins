---
name: game-ui-export
description: Agent procedure — semantic rename, 9-slice registration, atlas pack, then Godot/Unity/Cocos/generic/taptap-maker handoff via kui atlas + kui export + kui validate.
---

Run `references/asset-pipeline.md` (naming: `references/naming-conventions.md`, slice: `config/slice-rules.yaml` + `references/slice-rules.md`).

## Preconditions

- Start protocol done (`SKILL.md` §0); `MODE` is `review` or `default`.
- Semantic PNGs or `kui split` output exist and are registered.
- Mapping/9-slice:
  - `review`: human-reviewed (else stop).
  - `default`: auto-fill from `config/slice-rules.yaml`; uncertain margins flagged in summary, not blocking.

## Procedure

1. Fill `mappings/` + `contracts/component-contract.yaml` slice fields (`full` | `1:1` | `tile` | `9-slice` + margins).
2. `kui atlas specs/<project-id> --force --json`
   - `exit=2` → fix contract paths (`errors[].fix`).
   - On success: artifacts = atlas PNG + atlas JSON; `next` points at `kui export`.
3. `kui export specs/<project-id> --force --json`
   - Writes `exports/{godot,unity,cocos,generic}/ui-main.json` **and** `README.md` (agent guide to auto-apply UI on that engine, incl. quick start) **and** `demo/` (runnable reference implementation: fixed-template assembler + engine-language mirror of `ui-main.json` + `README.md`; events only log with the `[kui-demo]` prefix; godot=`main.gd`/`ui_data.gd`, unity=`KuiDemoBuilder.cs`/`KuiUIData.cs`, cocos=`ui-demo.ts`/`ui-data.ts`, generic=`main.js`/`ui-data.js`/`index.html`; for smoke test, not the target project files).
   - `taptap-maker` target also writes `exports/taptap-maker/{theme.lua,component-map.json,screens.json,README.md}` + `demo/` (`main.lua` + `ui-data.lua` + `README.md`, same convention as above) (UrhoX UI handoff).
   - Failures: `native_project_files: true` is invalid — exporter only writes JSON handoff.
4. Update `contracts/atlas-contract.yaml` + `export-contract.yaml` (`status`, review fields).
   - `default`: set `review.complete: true` after quality pass; log in `quickstart.md`.
5. `kui web specs/<project-id> --force --json` — generate the Web delivery pack and preview pages (`exports/web/` + `result.html` + `index.html`).
6. (Optional, when the user requests it or the site is available) Deliver to the showcase site: `bun <plugin-root>/site/scripts/pack.mjs specs/<project-id> --json`
   - Package as a ZIP per the `kui-ui-package` convention into `site/inbox/` (see `site/CONVENTION.md`); the showcase site ingests it automatically; for an offline site use `--upload http://<host>:4310`.
   - On success it emits `ARTIFACT: <zip>` and `NEXT`; on failure (`E_PACK`) it does not block the main flow, only a WARN.
7. `kui validate specs/<project-id> --strict --json` must return `ok: true`.

## Emit

```text
STAGE: 8–9 atlas|export
MODE: review|default
STATUS: done|failed
INPUTS: …
OUTPUTS: assets/atlases/…, exports/**/*.json, exports/*/README.md, exports/taptap-maker/, exports/web/, result.html, index.html
GATE: none after validate exit 0
NEXT: deliver index.html — right/preview panel if available; else summary link + system browser
```

After validate exit 0, run SKILL.md §7 delivery on `index.html` before ending the task.

## Never

- Claim native engine project files were generated.
- `review`: approve atlas/export while `review.complete` is false and user asked for production handoff.
- `default`: ship while `kui validate` is exit 1 or quality checks failed.
- Ship with `kui validate` exit 1.

Arguments: project-id (required), target engine filter (optional: godot/unity/cocos/generic/taptap-maker), execution mode (optional).
