---
name: game-ui-components
description: Agent procedure — break a quality-passed page into components; if a sprite sheet exists, kui split into transparent PNGs + ZIP. No full-page redesign.
---

Run `references/component-breakdown.md`, then `references/sprite-sheet-splitter.md` when needed.

## Preconditions

- Start protocol done (`SKILL.md` §0); `MODE` is `review` or `default`.
- Source page is `approved: true` in `asset-manifest.yaml` (or `default` auto-closed this run).
- If not → `STATUS: blocked`, `NEXT: wait_user: Please approve page <screen-id> first`.

## Procedure

1. Update `contracts/component-contract.yaml` (id, states, size, category, source page).
   - **Two-state rule**: every clickable control (`category: control`, or icon with `clickable: true`) MUST declare at least `states: [default, pressed]`; write the pressed treatment (darken 10–15% + sink 2px or scale 0.96–0.98, identical outline) into the prompt.
2. Generate component assets one-by-one (transparent by default, no baked text) → `assets/components/` or one sprite sheet.
   - Generate **one file per state** for clickable controls: `<id>-default-*` and `<id>-pressed-*`. A clickable control with only a default-state asset is an incomplete breakdown.
3. Register every asset in `asset-manifest.yaml`.
4. If sprite sheet / board:
   ```bash
   kui split <sheet.png> --mapping <optional.yaml> --force --json
   ```
   - If `exit=1`, apply each `errors[].fix` (thresholds / mapping count mismatch).
   - Read `facts.item_count`, `facts.detected_mode`, `artifacts`.
5. Edge check (text residue, crop, glow, alpha):
   - `review`: **STOP** for human check.
   - `default`: auto-check; on pass set `review.text_free: true` / `approved: true` and log; on fail regenerate or flag in summary.

## Emit

```text
STAGE: 6–7 component|split <screen-id>
MODE: review|default
STATUS: done|blocked|failed
INPUTS: …
OUTPUTS: component-contract, assets/…, [items/, sprite-manifest.yaml, *.zip]
GATE: review → human edge review | default → auto-closed
NEXT: <kui atlas specs/<id> | review: wait_user: Check sprite slicing edges>
```

## Never

- Rebuild the whole page.
- Paste many components into one delivery image.
- Mark bad auto-crops as approved (either mode).

Arguments: project-id (required), screen-id (required), whether to split and package (optional), execution mode (optional).
