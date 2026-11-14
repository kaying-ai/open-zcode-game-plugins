# Game UI Extension

Select the necessary pages from gameplay and the player journey; do not pile in every common system by default.

## Inputs

Read `gdd.md`, `prd.md`, `interaction.md`, `spec.md`, `research.md`, `contracts/style-contract.yaml`, `plan.md`, and `contracts/screen-contract.yaml`. If the user gives only one image, first determine where it sits in the core loop. When the three planning docs are missing, call `game-ui-product-design` before extending screens.

Read [screen-taxonomy.md](screen-taxonomy.md) for a full taxonomy audit; ordinary extension does not need to load the entire taxonomy.

## Player journey

Check by applicable scope:

1. Launch and first entry: splash, login, announcement, server select, character creation, tutorial.
2. Core gameplay: lobby, quests, preparation, stages, battle HUD, pause, settlement.
3. Growth management: character, equipment, skills, ascension, inventory, codex, achievements.
4. Economy and monetization: shop, gacha, battle pass, subscription, exchange, ad rewards.
5. Live ops and return: sign-in, dailies, event hub, limited challenges, returner.
6. Social and competition: friends, guild, chat, mail, profile, leaderboard, seasons.
7. Strategy expression: formation, deck, presets, talents, cosmetics, housing.
8. Support and settings: settings, controls, accessibility, account, support, redeem codes.

Only select pages that serve the genre, platform, core loop, retention, and monetization model.

## Screen priority

- `must-have`: without it the core loop cannot complete or safe delivery is impossible.
- `genre-specific`: determined by gameplay, e.g. card formation or shooter loadout.
- `optional`: enhances retention, expression, or live ops, but does not block the first release.

## Per-page contract

Write into `screen-contract.yaml`:

- `id`: stable lowercase hyphenated ID
- `purpose`: the player problem it solves
- `entry_points`: where it is entered from
- `primary_actions`: the 1–3 most important actions
- `dependencies`: prerequisite pages or systems
- `layout`: top, middle, bottom, floating areas
- `components`: reusable and page-specific components
- `states`: default, loading, empty, locked, claimable, cooldown, error, etc.
- `edge_cases`: full inventory, expired event, offline, insufficient resources, etc.
- `data_needs`: currency, timers, level, inventory, social state, etc.

## Extension steps

1. Write out the core loop and the path from first entry to daily return.
2. Place the user's existing pages into the journey and find the real gaps.
3. Select pages and mark priorities; merge entry points with duplicate functions.
4. Complete the contract for each page, ensuring the primary action is recognizable within three seconds.
5. In `plan.md`, sort by dependency and value, not by page name.
6. Plan page generation batches: baseline page first, then highly reused system pages, then live-ops pages.

## Design constraints

- The lobby keeps only a limited set of high-priority entry points; secondary activities go into the event hub.
- High-frequency actions support one-tap claim, batch operations, filtering, presets, or jump-to-source.
- Shop, gacha, and leaderboard clearly show prices, probabilities, settlement times, and rules.
- The HUD does not cover the core gameplay area and adapts to the input method.
- Every page follows the style contract; extension changes functional emphasis, not the visual system.

## Outputs

- Screen route, generation batches, and dependencies in `plan.md`
- Complete `screen-contract.yaml`
- Tasks in `tasks.md` tagged by bucket as `[extension]` and `[page]`
- Gap, merge rationale, and risk summary

## Checks

- The path from first entry to repeat return is closed
- Settlement can return to growth or the next round
- No page is an island with no entry or no exit
- Key systems include empty, locked, error, and insufficient-resource states
- Page count matches the project phase

## Scope gate

- `review`: output the screen list, stop, and wait for the user to confirm scope before page generation.
- `default`: continue with the scope set in `plan.md`; only stop to ask the user when the scope itself is uncertain.
