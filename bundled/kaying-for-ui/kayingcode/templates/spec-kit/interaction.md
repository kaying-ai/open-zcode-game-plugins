# UI Interaction Logic

## Document Status

- status: draft
- version: 0.1
- owner:
- last_updated:

> Set `status` to `approved` before image generation, or have the user explicitly skip the planning gate. Page prompts must reference the main flows and states in this file.

## Global Interaction Principles

- Touch targets: primary buttons no smaller than the contract height; icons need adequate tap areas
- Feedback hierarchy: pressed state → result feedback → error hint
- Primary actions stronger than secondary; destructive actions require confirmation
- Motion: prefer short feedback; provide a static alternative when reduced motion is on
- Copy: short text; component assets are text-free by default, copy is overlaid at runtime

## Global Navigation

```text
[Describe bottom/side navigation structure and highlight rules]
```

| Entry | Target Page | Highlight Rule | Badge Rule |
|---|---|---|---|
| | | | |

## Global States

| State | Trigger | UI Behavior | Recovery |
|---|---|---|---|
| loading | | | |
| offline | | | |
| low-currency | | | |

---

## Per-Page Interaction

Copy the following template for each must-have page.

### `<screen-id>` (Page Name)

- Purpose:
- Entry from:
- Exit to:

#### Main Flow

```text
Enter → What is seen → Primary action → Success/Failure branch → Leave or stay
```

#### Controls & Behavior

| Control | Action | Precondition | Success Result | Failure/Empty State |
|---|---|---|---|---|
| | tap | | | |

#### State Machine

| State | Visible Content | Available Actions | Transition Condition |
|---|---|---|---|
| default | | | |
| | | | |

#### Modal / Confirmation

| Scenario | Copy Points | Confirm | Cancel |
|---|---|---|---|
| | | | |

#### Constraints vs. Visual Draft

- Info that must be visible on first screen:
- Regions that must not be covered:
- Primary action to emphasize in image generation:

---

## Cross-Page Flows (Examples)

1. Home → Gacha → Result → Home/Team
2. Home → Team → Battle → Results → Home
3. Shop purchase → Currency change → Inventory/Home feedback

## Verification

- [ ] Every must-have page has a main flow and at least one failure/empty state
- [ ] Navigation highlight and badge rules are actionable
- [ ] Destructive and payment-related actions have a confirmation path
- [ ] Page generation prompts can reference the primary actions and state names in this file
