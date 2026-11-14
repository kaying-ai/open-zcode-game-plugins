# 贡献指南 / 提交插件

> 中文 · [English](CONTRIBUTING.en.md) · [字段规范](docs/PLUGIN_SPEC.md) · [Agent 协议](AGENTS.md)

本仓库采用 **Fork + Pull Request** 的提交方式，**一个 PR 只处理一个插件**。目录生成物由自动化维护，贡献者不要手动改。

## 1. 提交方式（明确版）

| 项目 | 约定 |
| --- | --- |
| 提交入口 | Fork 本仓库 → 在自己的 fork 上开分支 → 向本仓库 `main` 发 PR；**不接受直接 push 到 main** |
| 分支命名 | `plugin/<name>`（新增）、`plugin/<name>-update`（更新）、`docs/...`、`chore/...`（仓库维护） |
| 改动范围 | 新增/更新插件时**只改一个** `plugins/<name>.json`；不要改 `catalog.json`、README 的插件表格、`README.en.md` 的表格 |
| 提交信息 | `plugin: add <name> @ <version>` / `plugin: update <name> @ <version>` / `plugin: remove <name>` / `docs: ...` / `chore: ...` |
| 合并方式 | 维护者 **Squash merge**；合并后由自动化生成清单与 README（见第 5 节） |
| 签署 | 提交即表示你有权以条目中声明的许可提供该信息，且同意本仓库按 Apache-2.0 收录该索引条目；插件本体的权利与许可不变 |

> 想提交到 **ZCode 官方插件市场**请去 [zai-org/zcode-plugins](https://github.com/zai-org/zcode-plugins) 按其贡献指南提交；本仓库是非官方社区索引，两者互不等同。

### 标准样本（先照着看）

[`kaying-for-ui`](plugins/kaying-for-ui.json) 是首个内置插件，也是本仓库的**参考实现**：[`bundled/kaying-for-ui/`](bundled/kaying-for-ui/) 下同时提供 `zcode` / `kayingcode` 两个可离线安装的完整包，包含 `marketplace.json`、宿主 `plugin.json`、`LICENSE` / `NOTICE` 与全部技能文档。提交新插件前，建议先对照它的条目字段与包结构。插件内部的文档链接规范见 [字段规范](docs/PLUGIN_SPEC.md)。

## 2. 人类贡献者步骤

```bash
# 1) Fork 后克隆自己的 fork
git clone https://github.com/<you>/open-zcode-game-plugins.git
cd open-zcode-game-plugins
git remote add upstream https://github.com/kaying-ai/open-zcode-game-plugins.git
git switch -c plugin/my-game-plugin

# 2) 从模板创建唯一需要改的文件
cp templates/plugin.example.json plugins/my-game-plugin.json
#    按 docs/PLUGIN_SPEC.md 填写字段（中英文描述、宿主、SPDX 许可、固定来源）

# 3) 本地校验（零依赖，Node >= 18，无需 npm install）
node scripts/validate.mjs
node scripts/build.mjs --dry-run     # 预览 README 将新增的行，不写文件

# 4) 提交并发 PR
git add plugins/my-game-plugin.json
git commit -m "plugin: add my-game-plugin @ 1.0.0"
git push -u origin plugin/my-game-plugin
```

在 GitHub 上发起 PR，填完 [PR 模板](.github/pull_request_template.md) 的自查清单。

## 3. Agent 贡献者步骤（可直接照做）

1. 克隆仓库并新建分支 `plugin/<name>`。
2. **只创建** `plugins/<name>.json`，内容遵循 `templates/plugin.example.json` 与 `docs/PLUGIN_SPEC.md`。
3. `source.type` 用 `git`（公开仓库 + 40 位 commit SHA）或 `zip`（不可变 HTTPS URL + `sha256`）；不要用 `bundled`（仅维护者）。
4. `source.packages` 的键必须与 `hosts` 完全一致；每个包提供 `path`、`marketplace`、`pluginManifest`。
5. 运行 `node scripts/validate.mjs`，把报错修到 0；再运行 `node scripts/build.mjs --dry-run` 预览生成的行。
6. 提交信息 `plugin: add <name> @ <version>`，发起 PR 并填写模板。**不修改** `catalog.json`、两份 README 的表格、`catalog.config.json`。
7. 不要提交密钥、私有仓库地址、二进制或未经审阅的安装脚本。

给 Agent 的一句话指令见 [AGENTS.md 第 4 节](AGENTS.md)。

## 4. 自查清单（PR 模板会再问一遍）

- [ ] 插件面向游戏开发，且至少支持 `zcode` 或 `kayingcode` 之一。
- [ ] `name` = 文件名，全仓库无重名；`version` 为 SemVer。
- [ ] `description` 与 `description_i18n.zh-CN` / `.en` 齐全且语义一致。
- [ ] `license` 是插件**自身**的 SPDX 标识，且在 `catalog.config.json` 白名单内；包内附带 `LICENSE` / `NOTICE`。
- [ ] 包内文档的 Markdown 相对链接全部可解析（相对当前文件目录）；`references/` 内互相引用用同级链接。内置包由 `validate.mjs` 自动检查。
- [ ] `source.ref` 使用不可变 commit SHA（或 `zip` 提供 `url` + `sha256`）；所有 URL 为 HTTPS。
- [ ] `hosts` 与 `source.packages` 键一致；`marketplace.json` 与宿主 `plugin.json` 的 name/version 与条目一致。
- [ ] 已本地运行 `node scripts/validate.mjs` 并通过。
- [ ] 未手动编辑 `catalog.json` 或 README 插件表格。
- [ ] 理解本仓库为非 ZCode 官方产物，未在描述中冒用官方名义。

## 5. 合并后会自动发生什么（重要）

PR 合并到 `main` 后，`.github/workflows/update-catalog.yml` 自动执行：

1. 校验全部 `plugins/*.json`；
2. 重新生成 `catalog.json`（含正确的 GitHub raw / clone / archive URL，来自 `GITHUB_REPOSITORY`，**无需手工维护**）；
3. 把最新插件表注入 **`README.md`（中文）与 `README.en.md`（English）** 的 `<!-- PLUGINS:START -->` / `<!-- PLUGINS:END -->` 区间；
4. 若内容有变化，以 `chore(catalog): sync plugin list [skip ci]` 提交并推回 `main`。

因此**贡献者不需要、也不应该**手动改 README 或 `catalog.json`。`[skip ci]` 与 `GITHUB_TOKEN` 的默认行为共同防止工作流自触发循环。

PR 阶段由 `.github/workflows/pr-check.yml` 负责：运行 schema + 语义校验、预览将生成的 README 行（写入 Job Summary 供评审）、拒绝手改 `catalog.json` 或一次提交多个插件的 PR。

> 维护者注意事项：若 `main` 有分支保护，请允许 `github-actions[bot]` 推送，或在仓库 Settings → Actions 中授予 workflow `contents: write` 权限，否则第 4 步会被拒绝。

## 6. 评审标准

维护者从以下角度审核，不承诺固定时限：

| 维度 | 要求 |
| --- | --- |
| 相关性 | 确属游戏开发方向，功能描述具体 |
| 可安装 | 来源可访问、版本可固定、包结构可校验 |
| 合规 | 开源许可明确、声明文件齐全、不侵犯商标、不冒用官方 |
| 安全 | 无未声明的可执行脚本/二进制、无远程市场绕过、无凭据泄露 |
| 质量 | 中英文一致、字段规范、无重复收录 |

被拒绝的 PR 会给出具体原因，修正后可重新提交。

## 7. 更新与下架

- **更新版本**：只改对应条目的 `version`、`source.ref` / `url` + `sha256`、`updatedAt`，提交 `plugin: update <name> @ <version>`。
- **下架**：删除 `plugins/<name>.json`，在 PR 说明理由（失联、许可冲突、安全风险等）；自动化会同步从清单与两份 README 移除。
- **修正仓库自身文档/脚本**：走普通 PR，不受「一个 PR 一个插件」限制，但也不要把生成物的改动混进来（由 bot 统一处理）。

## 8. 行为约定

讨论请聚焦事实与可验证信息，尊重插件作者与上游项目。本仓库与 ZCode / Z.AI 无隶属关系，请勿在 Issue / PR 中以官方名义作出承诺。版权、商标与第三方声明见 [NOTICE](NOTICE)。
