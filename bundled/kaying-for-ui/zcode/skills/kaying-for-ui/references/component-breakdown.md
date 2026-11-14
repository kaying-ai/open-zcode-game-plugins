# Game UI Component Breakdown

Output standalone assets or a component sprite sheet ready for auto-slicing, plus their contracts. Do not regenerate the full page.

## Precondition gate

Must read:

- `contracts/style-contract.yaml`
- `contracts/screen-contract.yaml`
- `contracts/component-contract.yaml`
- `contracts/asset-manifest.yaml`
- Approved page visuals (in `default`, pages that passed quality checks this run)

The source page's manifest entry must be `approved: true`. If not approved:

- `review`: stop the breakdown and state that page verification must be completed first.
- `default`: only auto-close and continue when the page was just generated this run and passed quality checks; otherwise still stop.

## Categories

- `background`: full scene base image, no text, buttons, navigation, or character occlusion
- `control`: primary button, secondary button, close, back, claim, navigation buttons
- `container`: cards, text boxes, popup backplates, currency bars, progress bars
- `icon`: resource, function, state, and navigation icons
- `character`: characters, NPCs, pets, avatars
- `decoration`: borders, corner marks, glows, bases, ribbons, and particles

## Breakdown steps

1. Decide full-set breakdown or a specified scope.
2. Establish component IDs, categories, purpose, reusability, size, states, and source-page relationships.
3. Distinguish page-specific components from cross-page base components.
4. Write one independently executable prompt file per component.
5. When an image tool is available, generate one at a time; do not arrange many components onto an asset board.
6. Check edges, alpha channel, cropping, light direction, and proportions.
7. Update the component contract and asset manifest.

## Sprite sheet mode

When the user later needs "sprite sheet splitting, single-element PNGs, ZIP packaging", you may first generate a component sprite sheet as an intermediate artifact:

- All elements complete, not touching, with clear spacing.
- Use a transparent background or a single solid-color background.
- No text, numbering, grid lines, watermarks, or annotation arrows.
- Shadows and glows must not bleed onto adjacent elements.
- Different states of the same component keep a fixed order and consistent outlines.

A sprite sheet is not the final sprite slicing. After generation you must call `game-ui-sprite-sheet-splitter` to export standalone PNGs and complete verification (`review`: manual; `default`: automatic).

Final filenames follow the [component semantic naming conventions](naming-conventions.md). `element-001.png` is allowed only as an intermediate detection result, not as approved delivery.

## Default rules

- Use a transparent background except for backgrounds.
- Buttons, cards, popups, and labels have no text by default; keep typographic whitespace.
- Icons keep the same viewpoint, light source, stroke, and small-size legibility.
- Characters are complete and unobstructed, posed for overlaying onto the original layout.
- Decorations may overlap, without an opaque rectangular base.
- Keep the source page's visual weight; do not make secondary buttons stronger than primary buttons.
- Fill in `slice` metadata for buttons, panels, popups, and progress bars; 9-slice margins: `review` manually preview and confirm, `default` use `config/slice-rules.yaml` defaults and flag uncertain items.

## Two-state (normal/pressed) hard rule for clickable controls

Any control that can be clicked — components with `category: control` (primary button, secondary button, close, back, claim, navigation, tabs), plus icons used as button entry points (marked `clickable: true` in the contract or grouped under control) — MUST produce **at least two states (normal/pressed)**, with none missing:

| State | File | Requirement |
|---|---|---|
| `default` | `<component-id>-default-v<number>.<ext>` | normal state |
| `pressed` | `<component-id>-pressed-v<number>.<ext>` | pressed state, must have a perceptible difference |
| `disabled` (optional) | `<component-id>-disabled-v<number>.<ext>` | grayed out, desaturated |

Default visual treatment for the `pressed` state (write it into the prompt; do not let the model improvise):

- Lower the subject brightness by 10–15%, or deepen the primary color by one step (equivalent to overlaying ~12% black).
- Optionally add one of: scale the whole thing to 0.96–0.98, or sink the content 2–4px (thinner bottom edge, weaker highlight).
- Outer outline, size, corner radius, light direction, and material must be exactly identical to `default` — change only brightness and micro-offset, not the shape.
- Strokes, shadows, and internal details must not disappear or deform.

Delivering a clickable control with only the `default` state counts as an incomplete breakdown; a later `kui validate` will flag control components missing `pressed` as errors.

## Single-component prompt file

Save as `prompts/components/<component-id>.md`:

```markdown
# <component-name>

## Source and purpose
## Size and states
## Contract fields to inherit
## Image generation prompt
## Negative constraints
## Verification record
```

The prompt must state clearly:

- "standalone game UI component asset"
- Component category, purpose, target size, and state
- Clickable controls must be described state by state: write one paragraph each for the `default` normal state and the `pressed` pressed state (darken amount, sink/scale, consistent outline); generated together or separately, but the outlines of both states must align
- Color tone, material, light direction, stroke, thickness, and corner radius
- Whether transparent, whether text-free, centered composition, and safe margins
- High definition, complete outline, suitable for compositing and development
- Do not generate a full page, no sticking to other components

## Special rules

### Background

No UI controls, text, buttons, navigation, or foreground characters; when extension is needed, require naturally continuous edges.

### Buttons and containers

Blank text zones, complete borders, real click feel; generate a separate file per state, do not composite states into one image. Clickable controls follow the "two-state (normal/pressed) hard rule for clickable controls": at least `default` + `pressed` two-state (normal/pressed), with `pressed` darkened/sunk to the quantified standard and no shape change.

### Icons

Legible at small sizes, no text, unified perspective; no backing plate unless the contract requires it. Purely decorative icons need only `default`; icons used as button entry points (`clickable: true`) add `pressed` per the two-state hard rule, with the same press treatment as buttons.

### Characters

Complete outline, unobstructed, transparent background; do not reproduce unauthorized protected characters.

## Verification

- File paths, component IDs, and source pages are traceable
- Transparency requirements for non-background components are correct
- No text, garbled characters, dirty edges, background residue, or accidental cropping
- Outlines are stable across states; visual differences match the contract
- Clickable controls have both states: `default` and `pressed` both exist, outlines align, the pressed-state difference is perceptible (darken or sink), not the same image copied twice
- Filenames use `<component-id>-<state>-v<number>.<ext>`
- Every asset is registered individually in the manifest

When tools are unavailable, keep the prompt, set the status to `pending-generation`, and do not fake transparent assets.
