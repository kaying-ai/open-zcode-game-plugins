# Game UI Design Tokens

`style-contract.yaml` is the single source of truth for global design tokens; do not build a parallel design system.

## Layers

1. Raw values: `colors`, `typography`, `geometry`, `effects`
2. Semantic aliases: `tokens.color`, `tokens.spacing`, `tokens.motion`
3. Component references: `style_dependencies` in `component-contract.yaml`

Example:

```yaml
colors:
  primary: "#58C36A"
  pressed: "#4AA459"        # primary color for the pressed state of clickable controls (primary darkened 12–15%)
tokens:
  color:
    action-primary: "#58C36A"
    action-primary-pressed: "#4AA459"
  spacing:
    sm: 8
    md: 16
  interaction:
    pressed-scale: 0.97     # press scale, 1 means no scaling
    pressed-dim: 0.86       # press brightness factor, 1 means unchanged
    pressed-offset-y: 2     # press sink in pixels (optional)
```

Rules:

- Token names use lowercase kebab-case.
- Page prompts reference semantic purpose, not just bare color values.
- Clickable controls must have a `pressed` semantic color or `tokens.interaction` darkening parameters; the exporter maps them to the engine's pressed state (e.g. `primaryPressed`).
- When switching styles, first change the global values and semantic aliases, then mark affected assets as `stale`.
- API tokens or access keys must be called "credentials" to avoid confusion with design tokens.
