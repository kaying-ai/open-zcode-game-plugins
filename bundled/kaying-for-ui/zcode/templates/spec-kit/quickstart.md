# Project Reproduction & Verification

## Project

- Project ID: `{{PROJECT_ID}}`
- Current deliverable version:

## Execution Mode

- Current mode: `review` | `default`
- Selection time:
- Selected by: user instruction | startup gate
- Notes:

### Gate Log

(`review` records user approval/skip; `default` records auto-closed)

- 

## Inputs

- Design doc: `gdd.md`
- Product requirements: `prd.md`
- Interaction logic: `interaction.md`
- Requirements file: `spec.md`
- Research notes: `research.md`
- Visual contract: `contracts/style-contract.yaml`
- Screen contract: `contracts/screen-contract.yaml`
- Component contract: `contracts/component-contract.yaml`

## Reproduction Steps

1. Install the skills from the repo.
2. Open this project directory and have the Agent read `gdd.md`, `prd.md`, `interaction.md`, `spec.md`, and `contracts/`.
3. Confirm the three planning docs are `approved` (or skip recorded) before image generation.
4. Pick a page ID from `plan.md`.
5. Use the page skill to generate a visual draft and save it to `assets/pages/`.
6. After page approval, use the component skill and save to `assets/components/`.
7. When components are output as a sprite sheet, use the slicing skill to export single-element PNGs and a ZIP.
8. For development handoff, review 9-slice and generate Atlas and engine JSON.
9. Update the sprite, atlas, and export contracts and `asset-manifest.yaml`.

## Validation

```bash
kui validate specs/{{PROJECT_ID}}
```

## Manual Verification

- [ ] Design doc, PRD, and interaction logic approved and consistent with pages
- [ ] Aspect ratio and safe area correct
- [ ] Primary action clear and information hierarchy stable
- [ ] Colors, materials, lighting, strokes, and corner radii consistent
- [ ] Text legible, no garbled characters or wrong trademarks
- [ ] Components free of sticking, dirty edges, and unintended cropping
- [ ] Non-background components meet transparent-background requirements
- [ ] Sprite sheet slices free of cuts, sticking, or background residue
- [ ] PNG archive extracts and contains a manifest
- [ ] Atlas regions, 9-slice, and engine JSON consistent

## Known Limitations

- 
