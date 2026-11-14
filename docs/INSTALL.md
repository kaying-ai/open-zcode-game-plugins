# 安装与使用指南

> 中文 · [English version of the repo README](../README.en.md) · [Agent 协议](../AGENTS.md) · [字段规范](PLUGIN_SPEC.md)

## 三种使用姿势

| 姿势 | 适合 | 说明 |
| --- | --- | --- |
| **A. 让 Agent 自主安装**（推荐） | 日常使用 | 把 README 或 AGENTS.md 里的提示词贴给 Agent，它按 `catalog.json` 的 `protocol` 完成筛选、取包、校验、注册 |
| **B. 手工注册本地源** | 想自己掌控 | 克隆本仓库 → 取插件包目录 → 在宿主「插件市场 → 新增」填本地绝对路径 |
| **C. 只读取清单** | 工具集成 | `curl` 获取 `catalog.json`，按 `hosts` / `category` 自行筛选 |

## 前置约束（务必先读）

ZCode 兼容宿主的本地优先形态（如 KayingCode.localrun）**只允许内置与本地安装**，adapter 会拒绝 `git://` / `http(s)://` 形式的远程 marketplace 与 CDN 插件包。所以：

```text
✅ GitHub → 本地目录 → 注册「本地源」→ 安装
❌ 把 https://github.com/... 直接填进「新增市场」
```

本仓库是**非官方**社区索引，不提供远程市场服务，也不代表 ZCode 官方审核。

## A. Agent 自主安装

把下面这段贴给宿主里的 Agent（把宿主与场景改成你的）：

```text
请从 https://raw.githubusercontent.com/kayingai/open-zcode-game-plugins/main/catalog.json
读取插件目录，为宿主 zcode 挑选适合「游戏 UI 设计」的插件，按 catalog.json 的 protocol
与仓库 AGENTS.md 从 GitHub 取回内容、用 verify-install.mjs 校验、注册为本地市场源并安装。
动手前报告插件名、版本、许可和目标路径并等我确认；不要注册远程 URL，不要执行插件自带脚本。
```

Agent 会执行的 7 步见 [AGENTS.md 第 1 节](../AGENTS.md)。关键点：

- 唯一数据源是 `catalog.json`，不是 README 表格；
- `source.type` 为 `bundled` / `git` / `zip` 时分别走内置副本、固定 commit 克隆、带 SHA-256 的压缩包；
- 校验脚本可单独下载：`curl -fsSL <rawBase>scripts/verify-install.mjs`；
- 校验通过后才注册为**本地**源，且不会静默修改宿主全局配置。

## B. 手工安装（以内置插件 kaying-for-ui 为例）

第一个插件已随仓库附带离线副本，无需访问第二个代码源。

```bash
# 1) 取仓库
git clone --depth 1 https://github.com/kayingai/open-zcode-game-plugins.git
cd open-zcode-game-plugins

# 2) 确认包完整（可选但推荐）
node scripts/verify-install.mjs bundled/kaying-for-ui/zcode \
  --name=kaying-for-ui --version=0.2.0 --host=zcode

# 3) 把包复制到一个不会随手删掉的稳定位置
#    POSIX 例：  ~/.local/share/open-zcode-game-plugins/kaying-for-ui/0.2.0/zcode
#    Windows 例： %LOCALAPPDATA%\open-zcode-game-plugins\kaying-for-ui\0.2.0\zcode
```

在宿主中：

1. 打开「插件市场 → 新增」（或等价入口）。
2. 填入**上一步的本地绝对路径**：
   - ZCode → `.../kaying-for-ui/0.2.0/zcode`（该目录含 `.zcode-plugin/plugin.json` 与 `marketplace.json`）
   - KayingCode → `.../kaying-for-ui/0.2.0/kayingcode`（含 `.kayingcode-plugin/plugin.json`）
3. 安装并启用 `kaying-for-ui`，按插件自带的 `README.md` / `SKILL.md` 使用。

> Windows 下 `curl` 建议用 `curl.exe`，`tar.exe` 位于 `C:\Windows\System32`。路径含空格时务必加引号。

### 校验脚本检查了什么

`node scripts/verify-install.mjs <包目录> --name=<id> --version=<v> --host=<host> --json`

- `marketplace.json` 可解析、声明了同名同版本的插件；
- 宿主的 `.zcode-plugin/plugin.json` / `.kayingcode-plugin/plugin.json` 存在且 name/version 一致；
- `LICENSE` 与 `NOTICE` 随副本存在（MIT 条款要求）；
- 至少提供 `skills/` / `commands/` / `agents/` 之一；
- 包内没有 `.git`、`node_modules` 等应排除目录。

退出码 `0` 才可安装；`1` 请停止并报告。

## C. 只读取清单（工具集成）

```bash
curl -fsSL --max-time 30 \
  https://raw.githubusercontent.com/kayingai/open-zcode-game-plugins/main/catalog.json \
  -o catalog.json

# 例：筛出支持 KayingCode 的游戏 UI 插件
node -e "const c=require('./catalog.json');console.log(c.plugins.filter(p=>p.hosts.includes('kayingcode')&&p.category==='game-ui').map(p=>p.name+'@'+p.version))"
```

`catalog.json` 顶层关键字段：`catalogUrl`、`rawBase`、`browseBase`、`cloneUrl`、`archiveUrl`、`protocol`、`count`、`plugins[]`。每个插件条目附带 `catalog.entryUrl`（原始条目 raw 地址）与 `source.packages[host].marketplaceUrl`，便于精确取用。

## 宿主差异速查

| 宿主 | 包目录标志 | 市场清单 | 远程源 |
| --- | --- | --- | --- |
| `zcode` | `.zcode-plugin/plugin.json` | `marketplace.json` | 以宿主版本为准，官方公开分发格式要求 zip + sha256 |
| `kayingcode` | `.kayingcode-plugin/plugin.json` | `marketplace.json` | localrun 明确禁止远程 marketplace / CDN 插件包 |

字段命名参考 [zai-org/zcode-plugins](https://github.com/zai-org/zcode-plugins) 公开的 `marketplace.json` 与[分发格式文档](https://github.com/zai-org/zcode-plugins/blob/main/docs/distribution_CN.md)：`description` 为英文兜底，`description_i18n` 提供 `zh-CN` / `en` 本地化；官方 zip 分发额外要求 `sha256` 且校验失败必须停止安装。本仓库的 `zip` 类型条目遵循同样的校验要求。

## 更新与卸载

- **更新**：条目 `version` 变化后，Agent 会取新版本到新的 `<version>/` 目录，校验通过再切换；旧目录保留便于回滚。不要原地覆盖。
- **卸载**：先在宿主中禁用并移除插件，再删除本地目录；若改过 `plugins.dirs` 等配置，记得移除对应路径。
- **清单新鲜度**：`catalog.json` 每次合并后由自动化重新生成。请设置**有界缓存**（例如 5–15 分钟），不要长期缓存。

## 安全提醒

- 插件可能包含自动执行的 Hook、MCP 服务、命令或本地程序；启用前自行审阅来源、脚本与权限。
- 只从 HTTPS 获取；固定不可变 commit SHA；提供 sha256 时必须校验。
- 不要执行插件自带的安装脚本，除非已完整审阅。
- 各插件适用**自己的许可**（如 `kaying-for-ui` 为 MIT），不是本仓库的 Apache-2.0；版权与第三方声明见 [NOTICE](../NOTICE)。
- 本仓库不对所列插件做安全审计、质量担保或可用性承诺。
