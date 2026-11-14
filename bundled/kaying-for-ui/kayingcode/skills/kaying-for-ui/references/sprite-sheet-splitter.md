# Game UI Sprite Sheet Splitting and PNG Packaging

Slice the full sprite sheet produced during component breakdown further into standalone transparent PNGs and package them into a downloadable ZIP. Do not mistake "generating a component list" for "having completed pixel-level sprite slicing".

## Preconditions

Read:

- Approved component breakdown results
- `contracts/style-contract.yaml`
- `contracts/component-contract.yaml`
- `contracts/asset-manifest.yaml`
- `contracts/sprite-contract.yaml` (if present)

The input sprite sheet must be a real, existing image file. If there is only a prompt or a component list, finish component image generation first.

Final single-element PNGs must have all text removed, including titles, button copy, number labels, placeholder text, watermarks, and annotation numbers. Text is not part of the component artwork.

## Suitable inputs

- Sprite sheet with transparent background: prefer detection via the Alpha channel.
- Solid or near-solid background: sample the surrounding background color and remove it.
- Buttons, icons, cards, decorations, effects, and characters on the same image.

Not suitable for:

- Full UI pages where elements heavily occlude or stick to each other.
- Composite images with a complex scene background and no spacing between elements.
- Assets that require recovering occluded pixels.

In these cases, regenerate a component sprite sheet with spacing rather than forcing a cut.

## Input sprite sheet spec

When generating component images, prefer requiring:

- All elements complete, not touching, with whitespace on all sides.
- A uniform solid-color or transparent background.
- No text, numbering, watermarks, or annotation lines.
- Shadows must not cross onto adjacent components.
- Similar states arranged in a fixed order, but with no grid lines drawn.
- Do not split one component into multiple distant fragments.

## Automatic splitting

Run:

```bash
kui split <source.png> \
  --output-dir <project>/assets/sprites/<pack-id>/items \
  --zip <project>/packages/<pack-id>-png.zip \
  --mode auto \
  --prefix <pack-id>
```

Default behavior:

1. Detect via Alpha when the input has a transparent channel.
2. Sample the edge background color when the input is opaque.
3. Merge nearby pixel regions.
4. Filter out tiny noise.
5. Add safe margins around each element.
6. Export standalone transparent PNGs.
7. Generate `sprite-manifest.yaml`.
8. Generate a ZIP containing the manifest and all PNGs.

## Semantic mapping

Auto-detection sequence numbers cannot be final asset names. Prepare YAML ordered by detection sequence:

```yaml
items:
  - semantic_name: shop-buy-button-normal
    component_id: shop-buy-button
    category: button
    state: normal
    slice: {type: 9-slice, margins: [36, 36, 28, 28]}
```

Add when running:

```bash
--mapping mappings/shop-components.yaml
```

The tool uses `semantic_name` as the PNG filename and writes component ID, category, state, and slice into the manifest. Naming and sprite slicing methods follow the component skill's semantic naming conventions and the [slicing rules](slice-rules.md), respectively.

Automatic slicing does not detect or repair text. If the source sprite sheet still contains text, do one of the following before cutting:

1. Prefer regenerating a text-free sprite sheet.
2. If regeneration is impossible, mask-repair or content-fill the text areas and restore the backplate texture.
3. Recheck after repair; do not merely crop the text away leaving transparent holes, color blocks, or ghosting.

Never mark a slice containing text as approved.

## Parameter tuning

Elements split too finely:

```bash
--connect-gap 6
```

Multiple elements stuck into one:

```bash
--connect-gap 0
```

Background residue:

```bash
--mode background --background-tolerance 16
```

Light-colored components wrongly removed:

```bash
--background-tolerance 8
```

Small icons filtered out:

```bash
--min-area 16
```

More cropping whitespace needed:

```bash
--padding 8
```

When re-outputting, use `--force` explicitly; never silently overwrite an approved package.

## Project contract

Write the results into `contracts/sprite-contract.yaml`:

- Source sprite sheet and source page
- Detection mode and thresholds
- Output directory and ZIP path
- Single-element ID, path, source-image coordinates, size, and transparency status
- Manual check status

Register at least in `asset-manifest.yaml`:

- Original sprite sheet: `kind: sprite-sheet`
- Final archive: `kind: package`

Single-element details are managed by `sprite-contract.yaml` so a large component pack does not bloat the global manifest.

## Verification (by mode)

- `review`: manual item-by-item check (checklist below)
- `default`: automatic check of the same checklist; on a bad cut, re-cut first, and if it still fails, flag it in the summary; do not mark bad icons as approved

Check item by item after automatic slicing:

- Each file contains exactly one complete element.
- No element is clipped.
- Adjacent elements are not stuck together.
- Shadows, glows, and semi-transparent edges are intact.
- The background is transparent, with no white edges, color fringing, or dirty specks.
- No titles, button copy, number labels, watermarks, or text ghosting.
- Filenames, coordinates, and sizes match the manifest.
- The ZIP can be extracted and contains all PNGs and the manifest.

On a bad cut, first adjust the thresholds and regenerate; if still unresolved, record the manual crop box in `sprite-contract.yaml` and do not mark the wrong result as approved.

## File naming

```text
<pack-id>-001.png
<pack-id>-002.png
<pack-id>-003.png
...
<pack-id>-png.zip
```

Once component semantics are determined, rename to:

```text
button-primary-default.png
nav-home-selected.png
currency-gold.png
effect-crescent-glow.png
```

Update the manifest in sync after renaming; do not just change the filename.

## Done definition

- The original sprite sheet is traceable
- Every element is a standalone transparent PNG
- Auto-detected coordinates and actual sizes are recorded
- Manual verification passed (`default`: automatic verification passed and recorded)
- `review.text_free: true`
- The ZIP exists and can be extracted
- Final PNGs use semantic names and link to component IDs
- Project passes strict validation
- `quickstart.md` records how to extract and use it

To continue generating the Atlas and engine JSON, call `game-ui-asset-pipeline`.
