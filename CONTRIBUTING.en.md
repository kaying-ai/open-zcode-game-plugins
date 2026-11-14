# Contributing / Submitting a plugin

> [简体中文](CONTRIBUTING.md) · [Field spec](docs/PLUGIN_SPEC.md) · [Agent protocol](AGENTS.md)

This repository accepts contributions via **Fork + Pull Request**, **one plugin per PR**. Generated files are maintained by automation.

## Submission rules

| Item | Convention |
| --- | --- |
| Entry point | Fork → branch on your fork → PR to `main`. No direct pushes to `main`. |
| Branch | `plugin/<name>`, `plugin/<name>-update`, `docs/...`, `chore/...` |
| Scope | Only one `plugins/<name>.json`. Do **not** edit `catalog.json` or the generated README tables. |
| Commit message | `plugin: add <name> @ <version>` / `plugin: update <name> @ <version>` / `plugin: remove <name>` |
| Merge | Maintainers squash-merge; automation then regenerates the catalog and both READMEs. |
| License note | Your index entry is contributed under this repository's Apache-2.0; the plugin keeps its own license and ownership. |

To submit to the **official** ZCode marketplace, go to [zai-org/zcode-plugins](https://github.com/zai-org/zcode-plugins). This repository is an unofficial community catalog.

### Reference implementation

[`kaying-for-ui`](plugins/kaying-for-ui.json) is the first bundled plugin and this repository's **reference implementation**. [`bundled/kaying-for-ui/`](bundled/kaying-for-ui/) ships complete offline-installable `zcode` and `kayingcode` packages, each with `marketplace.json`, a host `plugin.json`, `LICENSE` / `NOTICE`, and the full skill documentation. Compare your entry and package layout against it before submitting. Documentation link rules are in the [field spec](docs/PLUGIN_SPEC.md).

## Steps

```bash
git clone https://github.com/<you>/open-zcode-game-plugins.git
cd open-zcode-game-plugins
git switch -c plugin/my-game-plugin
cp templates/plugin.example.json plugins/my-game-plugin.json

node scripts/validate.mjs          # schema + semantic checks
node scripts/build.mjs --dry-run   # preview the README row without writing

git add plugins/my-game-plugin.json
git commit -m "plugin: add my-game-plugin @ 1.0.0"
git push -u origin plugin/my-game-plugin
```

Then open a PR and complete the checklist template. Zero dependencies — Node >= 18 only, no `npm install`.

## Agent recipe

1. Create only `plugins/<name>.json` on branch `plugin/<name>`.
2. Use `source.type: git` with a 40-char commit SHA, or `zip` with an immutable HTTPS URL and `sha256`. Never use `bundled` (maintainers only).
3. `source.packages` keys must exactly match `hosts`; each package needs `path`, `marketplace`, `pluginManifest`.
4. Bilingual `description_i18n` (`zh-CN` + `en`), SPDX `license` from the allowlist, `addedAt`.
5. Run `node scripts/validate.mjs` until clean, then `node scripts/build.mjs --dry-run`.
6. Commit and open the PR. Do not touch `catalog.json`, the README tables, or `catalog.config.json`.

## Checklist

- [ ] Game-development focus; supports `zcode` and/or `kayingcode`.
- [ ] `name` equals the file name and is unique; `version` is SemVer; no duplicate listing.
- [ ] `description` and `description_i18n.zh-CN` / `.en` are present and consistent.
- [ ] `license` is the plugin's own SPDX id in the allowlist; `LICENSE` / `NOTICE` ship with the package.
- [ ] Markdown relative links inside the package resolve from the file that contains them; files in `references/` link to siblings. `validate.mjs` enforces this for bundled packages.
- [ ] Immutable `source.ref`, or `zip` with `url` + `sha256`; all URLs are HTTPS.
- [ ] `hosts` matches `source.packages`; marketplace and host manifest name/version match the entry.
- [ ] `node scripts/validate.mjs` passes locally.
- [ ] No hand-edits to `catalog.json` or README plugin tables.
- [ ] No claim of official ZCode affiliation.

## What happens after merge

`.github/workflows/update-catalog.yml` runs on `main`: validates all entries, regenerates `catalog.json` (with correct GitHub URLs derived from `GITHUB_REPOSITORY`), injects the plugin table into **both** `README.md` and `README.en.md`, and commits `chore(catalog): sync plugin list [skip ci]` if anything changed. `[skip ci]` plus the default `GITHUB_TOKEN` behavior prevents workflow loops.

On PRs, `.github/workflows/pr-check.yml` validates entries, previews the generated rows in the Job Summary, and rejects PRs that hand-edit `catalog.json` or add multiple plugins at once.

> Maintainers: if `main` is protected, allow `github-actions[bot]` to push or grant the workflow `contents: write`.

## Review criteria

Relevance to game development, installability (reachable, pinnable, verifiable), licensing clarity, safety (no undeclared scripts/binaries, no remote-marketplace bypass, no secrets), and metadata quality. Rejected PRs receive a concrete reason and may be resubmitted.

## Updates and removals

- Update: change only `version`, `source.ref` / `url` + `sha256`, `updatedAt` → `plugin: update <name> @ <version>`.
- Remove: delete the entry file with a reason; automation removes it from the catalog and both READMEs.

See [NOTICE](NOTICE) for copyright, trademark and third-party notices.
