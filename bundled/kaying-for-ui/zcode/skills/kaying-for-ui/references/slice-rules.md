# Sprite Slicing Methods and 9-slice Rules

## Default sprite slicing methods

- Button, Frame, Popup, Panel, Progress: `9-slice`
- Card, Badge, Character, NPC, Decoration, Background: `full`
- Icon, Currency: `1:1`
- Repeatable textures: `tile`

See the repo `config/slice-rules.yaml` for defaults.

## 9-slice

```yaml
slice:
  type: 9-slice
  margins: [left, right, top, bottom]
```

Requirements:

- `left + right < width`
- `top + bottom < height`
- Corners and strokes must not enter the center stretch zone
- Text must not be baked into a stretchable backplate
- margins must be manually previewed at the actual target size

The built-in tool only stores and validates margins; it does not infer the stretch zone from pixels. Automatic 9-slice analysis is a roadmap capability.
