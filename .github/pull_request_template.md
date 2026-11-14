## 变更类型 / Change type

- [ ] 新增插件 `plugin: add <name> @ <version>`
- [ ] 更新插件 `plugin: update <name> @ <version>`
- [ ] 下架插件 `plugin: remove <name>`
- [ ] 仓库维护（文档 / 脚本 / CI，不涉及插件条目）

> 一次 PR 只处理一个插件。仓库维护类 PR 可以不涉及 `plugins/*.json`。

## 插件信息 / Plugin

| 项目 | 填写 |
| --- | --- |
| 插件 ID（`plugins/<name>.json` 的文件名） | |
| 版本（SemVer） | |
| 支持宿主（`zcode` / `kayingcode`） | |
| 分类（`category`） | |
| 插件自身许可（SPDX） | |
| 插件源码仓库（HTTPS） | |
| 固定来源（`source.ref` 40 位 SHA，或 `zip` 的 url + sha256） | |
| 一句话用途（中文 / English） | |

## 自查清单 / Checklist

- [ ] 我只新增/修改了 **一个** `plugins/<name>.json`，没有改动其他插件条目。
- [ ] `name` 与文件名一致，仓库内无重名；`hosts` 与 `source.packages` 键完全一致。
- [ ] `description` 与 `description_i18n` 的 `zh-CN` / `en` 都已填写，语义一致、无模板占位值。
- [ ] `license` 是插件**自身**的 SPDX 标识，且在 `catalog.config.json` 白名单内；包内附带 `LICENSE` / `NOTICE`。
- [ ] 包内 Markdown 相对链接均可解析；`references/` 目录内的文档使用同级链接（不重复写 `references/`）。
- [ ] 来源为 HTTPS 且不可变：优先完整 commit SHA；`zip` 已提供小写 64 位 `sha256`；未使用 `latest`、私有仓库或本地路径。
- [ ] 包内 `marketplace.json` 与宿主 `plugin.json` 的 `name` / `version` 与条目一致；`path` 为安全相对路径。
- [ ] 插件面向游戏开发，可安装、可校验；未包含未声明的可执行安装脚本、二进制或凭据。
- [ ] 已本地运行 `node scripts/validate.mjs` 并通过（贴出输出或截图）。
- [ ] **没有**手动编辑 `catalog.json`、`README.md` / `README.en.md` 的插件表格；这些由合并后的自动化生成。
- [ ] 我理解本仓库是**非 ZCode 官方产物**，描述中没有冒用 ZCode / Z.AI 官方名义或商标。
- [ ] 若插件会启用 Hook / MCP / 命令，已在下方说明其行为与所需权限。

## 补充信息 / Notes

<!--
给 Agent 提交者的说明：
1. 只需创建/修改一个 plugins/<name>.json；不要运行 npm run build 后把生成物一起提交。
2. 运行 node scripts/validate.mjs 直到通过，并把结果贴在这里。
3. 可运行 node scripts/build.mjs --dry-run 预览将生成的 README 行，但不要提交它写出的内容。
4. 字段含义见 docs/PLUGIN_SPEC.md，完整提交流程见 CONTRIBUTING.md / AGENTS.md。
-->

插件功能、与已有条目的差异、权限/网络行为、验证方式、以及需要评审者特别关注的地方：

```
（填写）
```

## 自动化说明 / Automation

合并到 `main` 后，工作流会自动重新生成 `catalog.json` 并同时更新中英文 README 的插件列表，无需你手动补充。PR 阶段会运行校验并把将生成的 README 行预览写入 Job Summary。
