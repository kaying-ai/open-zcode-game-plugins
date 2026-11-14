# Component Semantic Naming Conventions

The repo uses lowercase kebab-case throughout; do not use `button1.png` or non-semantic sequence numbers as final delivery names.

## Format

```text
<scope>-<component>-<variant>-<state>.png
```

Examples:

```text
shop-buy-button-normal.png
shop-buy-button-hover.png
shop-buy-button-pressed.png
shop-category-tab-active.png
shop-currency-coin-default.png
shop-sale-badge-default.png
```

## Rules

- `scope`: page or system, e.g. `shop`, `battle`, `inventory`.
- `component`: component responsibility, e.g. `buy-button`, `product-card`.
- `variant`: material, tier, or semantic variant; may be omitted when absent.
- `state`: `default`, `normal`, `hover`, `pressed`, `disabled`, `active`, etc.
- All states of the same component must share `component_id`.
- Sprite sheet auto-detection sequence numbers are for intermediate results only; approval requires conversion to semantic names via mapping.

Naming does not use underscores, to stay consistent with the kebab-case rules of project IDs and contract IDs.
