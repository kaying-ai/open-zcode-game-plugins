# Open ZCode Game Plugins

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a>
</p>

面向 **ZCode** 与 **KayingCode** 的**游戏开发方向开源插件目录**。本仓库提供一份机器可读的插件清单（`catalog.json`）、收录规范、以及让 Agent 可以基于 GitHub 自主完成安装的协议；插件本体仍由各自作者维护。

> [!IMPORTANT]
> **本仓库不是 ZCode 官方项目，也不是 ZCode 官方插件市场**，与 Z.AI / 智谱及 ZCode 维护者没有隶属、授权、背书或合作关系。收录于此不等于被 ZCode 官方收录。详见 [NOTICE](NOTICE)。

> [!NOTE]
> 本仓库托管于 `kayingai/open-zcode-game-plugins`；清单里的 raw / clone / archive URL 由 `GITHUB_REPOSITORY`（或本地 `origin`）自动推导，无需手工维护。

| | |
| --- | --- |
| 协议 | [Apache-2.0](LICENSE)（插件本体适用各自许可） |
| 清单入口 | `https://raw.githubusercontent.com/kayingai/open-zcode-game-plugins/main/catalog.json` |
| 支持宿主 | `zcode` · `kayingcode` |
| 收录范围 | 游戏策划、UI、美术、引擎集成、内容关卡、音频、工程工具链 |
| 维护方式 | 社区 PR，一个 PR 一个插件；合并后自动生成清单与 README 表格 |

---

## 插件列表

> **标准样本**：内置的 `kaying-for-ui` 是本仓库的参考实现 —— [插件条目](plugins/kaying-for-ui.json) · [双宿主离线包](bundled/kaying-for-ui/) · [字段规范](docs/PLUGIN_SPEC.md)。新插件请对照它组织包结构，并保证文档内相对链接可解析。

<!-- PLUGINS:START -->
| 插件 | 分类 | 支持宿主 | 版本 | 许可 | 说明 |
| --- | --- | --- | --- | --- | --- |
| **[游戏界面设计UI设计-咖影](https://gitee.com/citiao/kaying-for-ui)** `kaying-for-ui` | 游戏 UI 与交互 | `zcode` · `kayingcode` | `0.2.0` | `MIT` | 游戏 UI 设计与交付全流程：从 GDD/PRD、风格契约、页面视觉到组件拆解、切图、图集打包与 Godot/Unity/Cocos 引擎 JSON 交付；零依赖 Node CLI，开箱即用。 |
<!-- PLUGINS:END -->

> 共 1 个插件。本表由 `scripts/build.mjs` 自动生成，请勿手动编辑。

## 使用方式

### 给 Agent 一句话（推荐）

把下面这段直接粘给 ZCode / KayingCode 里的 Agent 即可，它会自行读取清单、筛选、下载、校验并完成安装：

```text
请从 https://raw.githubusercontent.com/kayingai/open-zcode-game-plugins/main/catalog.json
读取插件目录，按我需要的宿主（zcode / kayingcode）和游戏开发场景筛选合适的插件，
然后依照该目录中的 protocol 字段与仓库 AGENTS.md 的协议，把它安装到本机并注册为「本地市场源」。
安装前告诉我插件名称、版本、许可和将要写入的本地路径；不要注册任何远程市场 URL，
不要执行插件自带的安装脚本，不要覆盖我已安装的同名插件。
```

Agent 遵循的是 **`github-to-local-source`** 协议：从 GitHub 取得内容 → 落到稳定的本地目录 → 在宿主中注册为**本地源** → 安装启用。这是必要的，因为 KayingCode.localrun 等本地优先宿主**禁止远程 marketplace / CDN 插件包**，直接把 GitHub URL 填进「新增市场」会被拒绝。

完整步骤、命令、校验与安全约束见：

- [AGENTS.md](AGENTS.md) — 给 Agent 的机器可读安装/提交协议
- [docs/INSTALL.md](docs/INSTALL.md) — 人类可读的安装与手动兜底
- [docs/PLUGIN_SPEC.md](docs/PLUGIN_SPEC.md) — 清单字段与收录规范

### 手工快速开始

```bash
git clone --depth 1 https://github.com/kayingai/open-zcode-game-plugins.git
cd open-zcode-game-plugins

# 查看内置插件（第一个插件已随仓库附带，无需联网取插件本体）
ls bundled/kaying-for-ui/zcode/marketplace.json
ls bundled/kaying-for-ui/kayingcode/marketplace.json

# 在宿主的「插件市场 → 新增」中填入本机绝对路径，例如：
#   ZCode       -> <repo>/bundled/kaying-for-ui/zcode
#   KayingCode  -> <repo>/bundled/kaying-for-ui/kayingcode
# 然后安装并启用 kaying-for-ui。
```

校验清单与生成物：

```bash
npm run validate   # 校验所有 plugins/*.json 及内置包完整性
npm run build      # 生成 catalog.json + 刷新中英 README 表格
npm run check      # CI 模式：生成物是否过期（只读）
```

> 所有脚本为零依赖 Node（>= 18），**无需 `npm install`**。

## 项目结构

```text
open-zcode-game-plugins/
├── LICENSE                  Apache-2.0 全文
├── NOTICE                   非官方声明、上游引用、第三方许可声明
├── README.md                中文主文档（默认）  ┐ 插件表由脚本注入
├── README.en.md             English            ┘
├── AGENTS.md                给 Agent 的安装 / 提交协议
├── catalog.config.json      仓库自描述配置（分类、宿主、SPDX 白名单）
├── catalog.json             【生成】机器可读插件总目录，Agent 的唯一入口
├── schema/
│   └── plugin.schema.json   插件条目 JSON Schema (2020-12)
├── plugins/
│   └── <name>.json          每插件一个条目 —— PR 只需要动这里
├── templates/
│   └── plugin.example.json  新插件条目模板
├── bundled/                 内置插件的离线副本（保留各自 LICENSE / NOTICE）
├── scripts/                 零依赖校验与生成脚本
├── docs/
│   ├── INSTALL.md           使用与安装说明
│   └── PLUGIN_SPEC.md       字段规范与收录标准
└── .github/
    ├── workflows/           PR 校验 + 合并后自动同步清单/README
    ├── pull_request_template.md
    └── ISSUE_TEMPLATE/
```

**边界**：本仓库维护的是「清单 + 规范 + 少量内置副本」，不镜像 ZCode 官方插件、不托管官方 CDN 资源、不提供远程市场服务。

## 提交插件

极简流程（完整版见 [CONTRIBUTING.md](CONTRIBUTING.md)）：

1. Fork 并新建分支 `plugin/<name>`。
2. 复制 `templates/plugin.example.json` 为 `plugins/<name>.json`，填写中英文说明、宿主、许可与固定版本来源。
3. 运行 `npm run validate`，按提示修正。
4. 提交：`git commit -m "plugin: add <name> @ <version>"`，发起 PR 并填写模板自查清单。
5. CI 自动校验并预览将生成的 README 行；维护者评审后合并。
6. **合并后自动化会重新生成 `catalog.json` 并同时更新中英文 README 的插件列表**，无需手动改 README。

收录标准：面向游戏开发、明确开源许可、至少支持一个目标宿主、版本可固定、来源为 HTTPS、中英文描述齐全、含可校验的清单文件。一个 PR 只处理一个插件；重复收录、无法安装、许可不明或含未声明可执行脚本的提交会被拒绝。

## 协议与声明

- 本仓库自身采用 [Apache License 2.0](LICENSE)。
- `bundled/` 下的插件**不适用**本仓库许可，各自保留原 `LICENSE` / `NOTICE`（如 `kaying-for-ui` 为 MIT）。
- 引用的上游项目：[ZCode](https://github.com/zai-org/ZCode)（Apache-2.0）、[zcode-plugins](https://github.com/zai-org/zcode-plugins)（Apache-2.0，官方插件市场）、[KayingCode](https://gitee.com/citiao/ZCode)（Apache-2.0，非官方衍生）。本仓库的清单字段参考了 `zcode-plugins` 公开的 `marketplace.json` 格式，但不是其镜像或替代品。
- 提交到 ZCode 官方市场请前往 [zai-org/zcode-plugins](https://github.com/zai-org/zcode-plugins)。

完整的版权、商标与第三方声明见 [NOTICE](NOTICE)。本仓库不对所列插件做安全审计或可用性担保。
