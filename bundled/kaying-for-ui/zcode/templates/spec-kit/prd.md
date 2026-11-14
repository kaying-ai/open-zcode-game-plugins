# Product Requirements Document (PRD)

## Document Status

- status: draft
- version: 0.1
- owner:
- last_updated:

> Set `status` to `approved` before image generation, or have the user explicitly skip the planning gate.

## Overview

- Project ID: `{{PROJECT_ID}}`
- Product goal:
- Success metrics (verifiable):
  1.
  2.
  3.
- Non-goals (explicitly out of scope):

## Users & Scenarios

| Role | Goal | Key Scenario |
|---|---|---|
| New player | | |
| Returning player | | |
| Paying player | | |

## Functional Requirements

List by priority. Every requirement must be carryable by a UI page or component.

### P0 (Must)

| ID | Requirement | Page/System | Verification Criteria |
|---|---|---|---|
| PRD-01 | | | |

### P1 (Important)

| ID | Requirement | Page/System | Verification Criteria |
|---|---|---|---|
| PRD-11 | | | |

### P2 (Optional)

| ID | Requirement | Page/System | Verification Criteria |
|---|---|---|---|
| PRD-21 | | | |

## Information Architecture

- Primary navigation:
- Secondary entries:
- Overlays/Full-screen modals:

## Page Delivery Scope (This Iteration)

| Page ID | Name | PRD Coverage | Image Generation Priority |
|---|---|---|---|
| | | | |

## Copy & Localization

- Default language:
- Copy principles (short, readable, no garbled placeholders):
- Image generation strategy: pages may use short text; component sprite sheets are text-free by default

## Data Dependencies (Client-Visible)

| Data | Page | Empty/Error State |
|---|---|---|
| wallet | | Insufficient balance hint |
| | | |

## Boundaries & Exceptions

- Network failure:
- Insufficient resources:
- Cooldown/Attempts exhausted:
- Tutorial interruption:

## Verification Checklist

- [ ] Every P0 requirement has a page or an explicit deferral note
- [ ] Every must-have page has a primary action and an empty state
- [ ] Monetization-related actions have a confirmation or feedback path
- [ ] Consistent with the `gdd.md` core loop
- [ ] No conflicts with the `interaction.md` state machine

## Revision History

| Version | Date | Change |
|---|---|---|
| 0.1 | | Initial draft |
