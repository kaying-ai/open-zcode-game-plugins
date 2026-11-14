# Game UI Spec

Output rules that page extension, image generation, component breakdown, and development can all read; do not merely describe "premium, consistent, beautiful".

## Inputs

Read first:

- `spec.md`: gameplay, platform, aspect ratio, scope, and verification criteria
- `research.md`: reference-image abstraction and copyright constraints
- `contracts/style-contract.yaml`: existing contract

When invoked standalone with no project directory, use the same field structure in the answer and suggest the user create a project.

## Workflow

1. Identify high-frequency operations and information priorities in the gameplay.
2. Extract the style language from reference images; do not reproduce specific characters, trademarks, or full pages.
3. Choose reference size, safe areas, and density suited to the target platform.
4. Define colors, fonts, geometry, material, light source, icon viewpoint, and states.
5. Update `style-contract.yaml`; unknown values must not be hidden behind "TBD" — give adjustable defaults.
6. Check that every rule can be referenced by page and component prompts.

Maintain global values and semantic aliases per the [design token spec](design-tokens.md); `style-contract.yaml` is the single source of truth — do not create a conflicting parallel token file.

## Required spec

### Platform and layout

- Target platform, orientation, aspect ratio, reference size
- Top, right, bottom, left safe areas
- Top status area, middle content area, bottom navigation, and floating entry points
- Notch screens, long text, portrait/landscape, or widescreen strategies

### Visual language

- Theme, mood, complexity, material
- Key light direction, shadow hardness, and highlight language
- Primary, secondary, accent, background, warning, reward, and disabled colors
- Contrast, saturation, and rarity color rules

### Typography

- Size and weight for titles, section headings, body, numbers, and buttons
- CJK legibility, stroke, drop shadow, and small-size limits
- Post-production typesetting strategy when generated text is unreliable

### Geometry and components

- Corner radius for small components, cards, and popups
- Stroke levels, button height, icon size
- Buttons, icons, cards, popups, progress bars, navigation, reward frames, currency bars
- Default, pressed, selected, disabled, loading, locked, claimed states

### Interaction

- Click, tab switch, popup, reward, quest, leaderboard, and purchase confirmation feedback
- Motion duration recommendations and reduced-motion option
- Network error, insufficient resources, cooldown, and expired states
- **Control two-state (normal/pressed) spec**: all clickable controls (buttons, clickable icons) must define `default` and `pressed` two-state (normal/pressed); the difference must be perceptible; the default `pressed` treatment is deepening the primary color by one step (~12–15% darken) plus a 2px sink or 0.96–0.98 scale, written into `colors.pressed` (semantic alias `action-primary-pressed`) and `tokens.interaction.pressed-scale`, for direct reference by page prompts, component prompts, and engine export (`primaryPressed` in theme.lua)

## Contract rules

- Use explicit color values or hue ranges; a color field must not just say "premium gold".
- Each component state has only one definition.
- All pages share light direction, material vocabulary, corner-radius levels, and icon viewpoint.
- If you modify an approved contract, mark dependent assets `stale`; do not silently overwrite.
- After review, set `status` to `approved` (`review`: wait for user approval; `default`: automatically set to approved after a passing quality self-check and log in `quickstart.md`).

## Outputs

1. A paragraph explaining how gameplay determines the visual rules.
2. Updated `contracts/style-contract.yaml`.
3. Key decisions and risks written into `research.md`.
4. Affected tasks written into `tasks.md`.

## Checks

- Values, ranges, states, and applicable scenarios are explicit
- Rules suit the target platform and touch targets
- Primary actions have stronger contrast than secondary actions
- The two-state (normal/pressed) for clickable controls has explicit color values and treatment parameters in the contract
- Text and numbers are readable on complex backgrounds
- Page and component prompts can reference contract fields directly
