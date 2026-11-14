---
name: game-ui-design
description: Agent procedure — write GDD, PRD, and UI interaction logic (stage 1 only). Blocks all visual generation until approved or skip is logged (review mode) / quality-passed (default mode).
---

Run **stage 1 only** from `references/product-design.md`. Do not generate page images in this command.

## Procedure

0. **Start protocol** (`skills/kaying-for-ui/SKILL.md` §0): analyze → `PLAN` → choose `review` | `default`.
1. Ensure workspace: `kui init <project-id> --json` (skip if `specs/<project-id>/` exists).
2. Read `spec.md` `research.md` + user concept/refs.
3. Write:
   - `gdd.md` — positioning, core loop, system list, economy and progression
   - `prd.md` — P0/P1, information architecture, page scope, verification criteria
   - `interaction.md` — navigation, per-page main flows, control behavior, state machines, cross-page links
4. Set each file’s `Document Status / status`:
   - `review`: `draft` until the user approves.
   - `default`: run the cross-check quality pass, then set `approved` and log in `quickstart.md`.
5. If `spec.md` empty, fill the positioning / platform / aspect ratio / scope summary.

## Emit

```text
STAGE: 1 product-design
MODE: review|default
STATUS: done
INPUTS: …
OUTPUTS: specs/<id>/gdd.md, prd.md, interaction.md
GATE: review → user must set status=approved (or say skip and record it) | default → auto-closed
NEXT: review → wait_user: Please review gdd/prd/interaction and reply "approve" or "skip" | default → <next stage or deliver>
```

## Hard stops

- Do not call page generation while any of the three is `draft` (`review`) or quality check failed (`default`).
- Do not replace missing content with empty template titles and claim done.
- Only ask blocking questions (genre / platform / aspect ratio / scope); other blanks = explicit defaults.
- Never start before the mode gate is resolved.

Arguments: project-id or concept (required), genre (optional), platform and aspect ratio (optional), execution mode (optional).
