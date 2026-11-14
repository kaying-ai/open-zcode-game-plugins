# Game Design · PRD · UI Interaction (First Generation Step)

**This skill is the first step of the full UI generation flow.** Before calling page image generation, style switching, or batch extension, you must complete this step and have the user approve the three documents. Without approval (and without an explicit user skip), you must not begin subsequent visual generation.

## Output files

Write into `specs/<project-id>/`:

| File | Name | Purpose |
|---|---|---|
| `gdd.md` | Game Design Document | Positioning, core loop, system list, economy and progression (planning layer) |
| `prd.md` | Product Requirements Document | P0/P1 requirements, information architecture, delivery scope, verification |
| `interaction.md` | UI Interaction Logic | Navigation, main flows, control behavior, state machines, cross-page links |

Template source: repo `templates/spec-kit/gdd.md`, `prd.md`, `interaction.md`. If the project is already initialized, edit the existing files directly; do not start parallel documents.

## When to use

- The **first step** of any full generation flow (default entry point)
- New UI project with only a concept and no visuals yet
- The user asks to "add planning / PRD / interaction before generation"
- Before extension or image generation, the three docs are missing, `draft`, or empty
- Gameplay or page scope changes require writing back requirements and interaction

## Inputs

Read first:

- `spec.md`, `research.md`, `plan.md`
- Existing `gdd.md` / `prd.md` / `interaction.md`
- If present: `contracts/screen-contract.yaml`

When information is insufficient: only ask blocking questions (genre, platform, core gameplay, launch page scope); give adjustable defaults for the rest and annotate them.

## Workflow

Copy and track (first complete the `SKILL.md` §0 start protocol: analyze → plan → choose mode):

```text
Progress:
- [ ] 0. Start protocol: task analysis + work plan + choose review/default
- [ ] 1. Confirm or initialize the project directory
- [ ] 2. Write/update gdd.md
- [ ] 3. Write/update prd.md
- [ ] 4. Write/update interaction.md
- [ ] 5. Cross-check the three docs for consistency
- [ ] 6. Handle the gate by mode (review: stop and wait for approval / default: auto-pass after self-check)
```

### 1. Project directory

If `specs/<project-id>/` does not exist:

```bash
kui init <project-id>
```

### 2. `gdd.md` (Game Design Document)

Must cover:

- One-line positioning, target users, selling points (≤3)
- Core loop table (return → preparation → gameplay → growth → monetization)
- System list and priority (`must-have` / `genre-specific` / `optional`)
- Resources and economy (planning-layer overview; do not pretend server-side formulas exist)
- Progression and progression axis, minimal worldbuilding set, risk constraints

Keep `Document Status / status` at `draft` first, then change to `approved` after the user approves.

### 3. `prd.md` (Product Requirements)

Must cover:

- Product goals and verifiable success metrics
- Non-goals (explicitly out of scope)
- P0 / P1 / P2 requirement table (each maps to a page or system)
- Information architecture and this iteration's page delivery scope
- Data dependencies, boundary exceptions, verification checklist

Every P0 must be carried by some later `screen-id`.

### 4. `interaction.md` (UI Interaction Logic)

Must cover:

- Global interaction principles, global navigation, global state
- Each must-have page: purpose, entry/exit, main flow, control table, state machine
- Cross-page links (at least core-loop related)
- "Constraints against the visual draft": must-show first-screen info, no-occlusion zones, primary action emphasis

State names should match the later `screen-contract.yaml` `states` where possible (e.g. `default` / `loading` / `incomplete` / `low-currency`).

### 5. Cross-check

- Screens in the `gdd` core loop ⊆ `prd` page scope
- `prd` P0 pages ⊆ `interaction` per-page sections
- Monetization/destructive operations have confirmation or failure paths in `interaction`
- The three docs do not contradict each other; empty templates must not be marked approved

### 6. Execution gate (by mode)

First confirm `MODE` (see `SKILL.md` §0).

**`review` (review mode) — must stop and wait for approval:**

```text
Current step: Step 1 · Planning and PRD / interaction logic (first generation step)
MODE: review
Completion state: draft, awaiting approval
Outputs of this step: gdd.md, prd.md, interaction.md
Please check: positioning and loop, P0 scope, per-page main flows and states
Optional actions: edit copy / add or remove systems / approve the three docs / explicitly skip the gate
Condition to proceed: all three docs have status approved, or quickstart.md records the skip reason
Copy-paste text for the next call:
Approve @specs/<project-id>/gdd.md, prd.md, interaction.md.
After approval proceed to Step 2: use game-ui-workflow to generate the baseline page prototype visual.
```

**Never** call `game-ui-page-generator` for official image generation before the user approves.  
When the user says "skip the planning gate": write the reason in `quickstart.md`; the three docs may stay draft, but must not be presented as approved.

**`default` (default mode) — auto-pass the gate after quality self-check:**

1. Run the §5 cross-check; if it fails, fix until it passes (or stop to ask the user due to blocking info).
2. Set the three docs' `Document Status / status` to `approved`.
3. Append to `quickstart.md` under `## Execution mode` / the gate log: `default-mode auto-closed stage-1 product-design: <reason for passing>`.
4. Do not stop to ask the user; continue with later stages (or deliver this step's outputs as requested).

Both modes forbid marking empty templates as `approved`.

## Approval actions

After the user approves:

1. Change the three docs' `Document Status / status` to `approved`
2. Update the corresponding `[product]` items in `tasks.md`
3. Check off the quality gate in `plan.md`
4. Suggest the next step: `game-ui-specification`, or (when the style is already approved) `game-ui-extension`

## Relationship to other skills

```text
Step 1  game-ui-product-design     ← first generation step (must do first)
Step 2+ game-ui-specification / prototype image generation / extension / …
         game-ui-page-generator     # requires Step 1's three docs approved
```

When the `game-ui-workflow` controller starts a full generation, it **must call this skill as Step 1**; do not skip straight to image generation.

## Done definition

- The three files exist at the project root with no `{{PROJECT_ID}}` placeholder
- Each contains `status: draft` or `approved`
- Content supports screen extension and single-page image generation (not an empty template)
- `review`: stopped at the approval gate, or recorded approval/skip per the user's instruction
- `default`: quality self-check passed, status is approved, `quickstart.md` has an auto-closed record
