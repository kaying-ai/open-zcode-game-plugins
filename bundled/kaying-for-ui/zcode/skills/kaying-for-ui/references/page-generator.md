# Game UI Single-Page Visual Generation

Complete only one page at a time, inherit the project contract, and do not render consecutive pages as unrelated style drafts.

## Preconditions

Read:

- The three planning docs must be completed by `game-ui-product-design`: `gdd.md`, `prd.md`, `interaction.md` (`status: approved`, or `quickstart.md` records a skipped planning gate)
- `spec.md` and `research.md`
- `contracts/style-contract.yaml`
- The target page's entry in `contracts/screen-contract.yaml`
- The approved baseline page and `asset-manifest.yaml`

If the three planning docs are missing or still `draft` and the user has not explicitly skipped them, stop image generation and call the first generation step `game-ui-product-design` instead.
If the style contract is still `draft`, you may generate exploration drafts, but assets must not be marked approved.

## Page steps

1. Confirm the page ID, purpose, primary action, states, and aspect ratio; check the page's main flow in `interaction.md`.
2. Establish information hierarchy: hero visual, primary action, resource status, navigation, secondary entry points.
3. Specify the top, middle, bottom, and floating areas concretely, not just generic layout names.
4. List buttons, cards, icons, characters, status bars, navigation, bubbles, and decorations.
5. Inject color values, material, light direction, corner radius, stroke, and font strategy from the style contract.
6. Produce a complete positive prompt and negative constraints.
7. When an image tool is available, actually generate images; otherwise keep the prompt and degrade.
8. Save the prompt and image, update the page contract and asset manifest.

## Prompt file

Save as `prompts/pages/<screen-id>.md`; the structure must be:

```markdown
# <page-name>

## Page positioning
## Visual constraints
## Layout and components
## States
## Image generation prompt
## Negative constraints
## Verification record
```

The positive prompt must include:

- Page name, game genre, platform, aspect ratio, and reference size
- Concrete content for the top, middle, bottom, and auxiliary areas
- Main character, scene, or core gameplay focus
- Colors, material, light source, corner radius, stroke, and icon language from the contract
- Clickable feel, information hierarchy, CJK text strategy, image quality
- The requirement to stay consistent with the approved baseline page

Negative constraints include at least:

- Garbled text, wrong text, trademarks, and unauthorized characters
- Deformed buttons, wrong perspective, stuck-together elements, subject occlusion
- Confused information hierarchy, over-complexity, low clarity
- Color tone, light direction, material, or corner radius that violates the contract

## Image generation

When an image tool is available:

1. Use the closest aspect ratio the tool supports.
2. Use `<screen-id>-v<number>.<ext>` as the filename.
3. Save the result to `assets/pages/`.
4. Record the real path, dimensions, status, and version source in the manifest.
5. When text in generated images is unreadable, do not pass verification; generate a text-free base or plan post-production typesetting.

When an image tool is unavailable:

- Do not create fake images
- `status: pending-generation`
- `approved: false`
- The prompt path must be valid

## Page approval

Only set `approved` to `true` when all of the following hold:

- The primary action is clear and the page purpose holds
- Aspect ratio, safe area, and navigation are reasonable
- The visual language in the contract is consistent
- Key states have corresponding treatments
- Text is readable, or post-production typesetting is explicitly adopted
- Approval source:
  - `review`: user confirmation, or the project verification rules clearly pass
  - `default`: all quality self-checks pass, and `quickstart.md` records `default-mode auto-closed stage-5 page <id>`

`review` keeps `approved: false` until the user confirms; `default` does not stop to ask the user.

## Outputs

- Page description and prompt file
- Actual visual draft or an explicit pending-generation status
- Updated `screen-contract.yaml`
- Updated `asset-manifest.yaml`
- Suggestions for subsequent component breakdown
