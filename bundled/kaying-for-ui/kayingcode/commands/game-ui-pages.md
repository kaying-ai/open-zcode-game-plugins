---
name: game-ui-pages
description: Agent procedure — generate game UI page visual(s) with prompt + image + manifest registration. Requires approved planning docs and style/screen contracts (or default-mode auto-close).
---

Run `references/page-generator.md` for `screen-id` list (one screen per emit).

## Preconditions (read before acting)

- Start protocol done (`SKILL.md` §0); `MODE` is `review` or `default`.
- `gdd.md` `prd.md` `interaction.md` all `approved`, OR `quickstart.md` logs an explicit skip / default-mode auto-close.
- `contracts/style-contract.yaml` exists (prefer `status: approved`; `default` may auto-close).
- `contracts/screen-contract.yaml` contains this `screen-id`.
- If any missing → emit `STATUS: blocked` with `NEXT: run /game-ui-design` (or fill contracts) and stop.

## Procedure

1. Load that screen’s brief/states from screen-contract + `interaction.md` + style-contract.
2. Write `prompts/pages/<screen-id>.md` (final prompt + negative constraints: garbled text, extra controls, style drift).
3. If image tool available: generate → move to `assets/pages/<screen-id>.<ext>`; else set `status: pending-generation` and keep prompt only.
4. Update `contracts/asset-manifest.yaml` (id, path, dimensions, status, source).
5. `kui validate specs/<project-id> --json` (warnings about draft style are OK while style is draft).
6. Gate:
   - `review`: set `approved: false` and wait.
   - `default`: quality-check (primary action / aspect ratio / style / states) → set `approved: true` → log in `quickstart.md`.

## Emit

```text
STAGE: 5 page <screen-id>
MODE: review|default
STATUS: done|blocked
INPUTS: …
OUTPUTS: prompts/pages/<screen-id>.md, assets/pages/…, asset-manifest.yaml
GATE: review → user approves this page | default → auto-closed
NEXT: review → wait_user: Please approve page <screen-id>, or point out what to change | default → next screen or /game-ui-components
```

## Never

- Process more than one page per emit in `review`. (`default` may loop planned screens; still emit once per screen.)
- Start component breakdown on an unapproved page (`review`) / non-quality-passed page (`default`).
- Claim success without a real image file or `pending-generation`.

Arguments: project-id (required), screen-id (required, `default` may pass all), execution mode (optional).
