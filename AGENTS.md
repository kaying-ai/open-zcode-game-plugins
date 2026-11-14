# AGENTS.md — Agent 操作协议

> **本文件是给 AI Agent 的执行规范**，不是介绍文档。人类读者请看 [README.md](README.md)、[docs/INSTALL.md](docs/INSTALL.md)。
> 协议版本 `1.0`，与 `catalog.json` 的 `protocol.version` 一致；若两者不一致，以 `catalog.json` 为准。

## 0. 开始之前必须知道的事实

1. **唯一数据源**是 `catalog.json`（机器可读），不要用网页抓取 README 表格来推断插件信息。
   `https://raw.githubusercontent.com/kayingai/open-zcode-game-plugins/main/catalog.json`（部署后由 CI 写入真实地址，直接读 `catalog.json` 里的 `catalogUrl` 自检）。
2. 本仓库是**社区索引，非 ZCode 官方产物**，不隶属于 Z.AI / 智谱。不要向用户宣称插件经过官方审核。
3. **关键宿主限制**：KayingCode.localrun 等本地优先宿主拒绝远程 marketplace / CDN 插件包，插件只支持「内置 + 本地安装」。因此**禁止**把 GitHub URL 直接注册为市场源；必须先把内容落到本地目录，再注册为**本地源**。
4. 本仓库不提供可执行安装器、不托管官方 CDN 资源；`bundled/` 是少数插件的离线副本，其余插件本体在各自作者仓库。
5. 每个插件适用**自己的许可**（见条目的 `license`），不是本仓库的 Apache-2.0。

## 1. 能力 A：自主安装插件

### 输入

用户给出：目标宿主（`zcode` / `kayingcode`）、场景或关键词、以及是否允许写入宿主配置。信息不足时先询问，不要猜测宿主。

### 步骤

| # | 动作 | 要点 |
| --- | --- | --- |
| S1 | 拉取 `catalog.json` | HTTPS、`--fail`、设置超时；用有界缓存，不要永久缓存 |
| S2 | 筛选 | 按 `hosts` 包含目标宿主 → `category` / `keywords` → `description_i18n` 选语言；有多个候选时列出并让用户选 |
| S3 | 解析来源 | 读 `source.type` 与 `source.packages[host]`，按下表取包 |
| S4 | 落到本地稳定路径 | 建议 `<用户目录>/open-zcode-game-plugins/<name>/<version>/<host>/`；不要写进宿主内部状态目录 |
| S5 | 校验 | 运行 `verify-install.mjs`（见下），并核对 `name` / `version` / LICENSE / NOTICE |
| S6 | 注册为**本地源** | 三种方式见下；未经用户确认不要改宿主全局配置 |
| S7 | 安装启用并报告 | 输出插件名、版本、许可、本地路径、以及做了哪些配置改动 |

### S3 来源解析表

| `source.type` | 取包方式 | 必须校验 |
| --- | --- | --- |
| `bundled` | 内容已在本仓库：`git clone --depth 1 <cloneUrl>`，或下载 `<archiveUrl>` 解压，取 `source.packages[host].path` | 目录存在、`marketplace.json`、宿主 manifest、LICENSE/NOTICE |
| `git` | `git clone <source.repository>` 后 `git checkout <source.ref>`，取 `source.packages[host].path` | 同上；**优先固定 40 位 commit SHA**，tag/分支需向用户说明可变风险 |
| `zip` | 下载 `source.packages[host].url`，取包内 `path` 目录 | 先算 **SHA-256** 并与 `sha256` 比对，不一致立即中止并删除文件；再校验解压安全（拒绝绝对路径、`..`、软链接逃逸） |

命令模板（POSIX；Windows 用 `curl.exe` 与 `tar.exe`）：

```bash
CATALOG_URL="https://raw.githubusercontent.com/kayingai/open-zcode-game-plugins/main/catalog.json"
curl -fsSL --max-time 30 "$CATALOG_URL" -o catalog.json

# bundled：整仓快照（一次取回，无需访问第二个源）
git clone --depth 1 <cloneUrl> "$WORK/open-zcode-game-plugins"
# 或：curl -fsSL <archiveUrl> | tar -xz -C "$WORK"

# 复制目标包到稳定位置（以 zcode 为例）
mkdir -p "$DEST/kaying-for-ui/0.2.0"
cp -R "$WORK/open-zcode-game-plugins/bundled/kaying-for-ui/zcode" \
      "$DEST/kaying-for-ui/0.2.0/zcode"
```

### S5 确定性校验

`verify-install.mjs` 是单文件、零依赖，可单独下载使用：

```bash
curl -fsSL <rawBase>scripts/verify-install.mjs -o verify-install.mjs
node verify-install.mjs "$DEST/kaying-for-ui/0.2.0/zcode" \
  --name=kaying-for-ui --version=0.2.0 --host=zcode --json
```

退出码 `0` 才可继续；`1` 表示**不要安装**。它会检查 `marketplace.json`、宿主 `plugin.json` 的 name/version 一致性、LICENSE/NOTICE 是否随附、以及是否混入 `.git` / `node_modules`。

### S6 注册本地源的三种方式（按优先级）

1. 宿主提供插件管理 API / CLI 时，用其「新增本地目录」能力注册 S4 的**绝对路径**。
2. 宿主支持 `plugins.dirs` 等本地目录配置时，在**用户确认后**追加该路径（先备份原配置）。
3. 否则输出路径与操作指引，让用户在 GUI 的「插件市场 → 新增」中粘贴本地路径；Agent 不应伪造安装成功。

> 无论哪种方式，注册的都是**本地路径**；`https://` 开头的市场源在本地优先宿主中会被 adapter 拒绝。

### S7 报告格式

```
已安装：kaying-for-ui 0.2.0（MIT），宿主 zcode
本地路径：<绝对路径>
注册方式：本地市场源 / plugins.dirs / 需用户在 GUI 手动添加
校验：verify-install PASSED（n 项）
变更：<列出被修改的配置文件；若无则写「未修改宿主配置」>
注意：该插件为社区收录，非 ZCode 官方审核产物。
```

## 2. 能力 B：提交插件 PR

Agent 可以完全按此流程提交一个插件，无需人工改写文档。

1. `git clone` 本仓库（或 fork），新建分支 `plugin/<name>`。
2. `cp templates/plugin.example.json plugins/<name>.json`，**只修改这一个文件**。
3. 填写：`name`（= 文件名）、`version`、`displayName_i18n` / `description_i18n`（`zh-CN` + `en` 必填）、`category`、`hosts`、`author`、`license`（SPDX）、`repository`、`source`、`install`、`addedAt`。
4. `source.type` 选 `git`（推荐，公开仓库 + 固定 commit SHA）或 `zip`（必须带 `url` + `sha256`）；`bundled` 仅维护者使用，不要自行往 `bundled/` 塞文件。
5. `source.packages` 的键必须与 `hosts` **完全一致**；每个包给出 `path`、`marketplace`、`pluginManifest`。
6. 运行 `node scripts/validate.mjs`，修正所有报错；可再跑 `node scripts/build.mjs --dry-run` 预览 README 将新增的行。
7. **不要**手动编辑 `catalog.json`、README 的插件表格、`README.en.md`；合并后自动化会生成。
8. 提交：`git commit -m "plugin: add <name> @ <version>"`（更新用 `plugin: update <name> @ <version>`）。
9. 发起 PR，填写 [PR 模板](.github/pull_request_template.md) 的自查清单，说明插件来源、许可、支持宿主与验证方式。

一次 PR 只处理一个插件。完整评审标准见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [docs/PLUGIN_SPEC.md](docs/PLUGIN_SPEC.md)。

## 3. 硬性约束

**MUST**

- 所有下载走 HTTPS；优先不可变 commit SHA，其次不可变版本化 URL。
- 提供 `sha256` 时**必须**校验，失败即中止并丢弃文件。
- 安装前报告目标路径并取得确认；不覆盖同名已装插件，除非已备份且用户明确同意。
- 保留并随副本分发插件自带的 `LICENSE` / `NOTICE`；不改写许可文本。
- 注册为**本地源**；明确告知用户本仓库与插件都不是 ZCode 官方产物。

**MUST NOT**

- 不执行插件包内的安装脚本、Hook、下载的二进制或未经审阅的命令。
- 不把 GitHub / 任意远程 URL 注册为市场源，不绕过宿主的本地-only 限制。
- 不静默修改宿主全局配置、不提升权限、不关闭安全校验。
- 不抓取官方 CDN 资源、不镜像 `zai-org/zcode-plugins`、不冒用 ZCode 商标或官方名义。
- 不提交包含密钥、令牌、私有仓库地址或可执行二进制的条目。

## 4. 可直接复制给 Agent 的提示词

**安装**

```text
请读取 https://raw.githubusercontent.com/kayingai/open-zcode-game-plugins/main/catalog.json，
按 catalog.json 的 protocol 字段和仓库 AGENTS.md 执行：为宿主 <zcode|kayingcode> 挑选适合
「<游戏开发场景>」的插件，从 GitHub 取得内容并放到本地稳定目录，用 verify-install.mjs 校验，
再注册为本地市场源并安装。动手前先报告插件名、版本、许可和目标路径，等我确认；
不要注册远程 URL，不要执行插件自带脚本，不要覆盖已安装的同名插件。
```

**提交插件**

```text
请按仓库 AGENTS.md「能力 B」和 CONTRIBUTING.md，为插件 <仓库 URL> 提交一个新增 PR：
只新增 plugins/<name>.json，填好中英文说明、宿主、许可、固定 commit SHA 与包路径，
运行 node scripts/validate.mjs 直到通过，并用 node scripts/build.mjs --dry-run 预览 README 行。
不要修改 catalog.json 或 README 的插件表格。
```

## 5. 故障处理

| 现象 | 处理 |
| --- | --- |
| `catalog.json` 404 | 检查仓库地址与分支是否为 `main`；也可 `git clone` 后本地 `node scripts/build.mjs` 生成 |
| `catalogUrl` 与当前仓库不一致 | 以当前仓库为准，并向本仓库提 Issue |
| `verify-install` 版本不一致 | 停止安装；条目可能已过期，等待维护者更新 `plugins/*.json` |
| 宿主拒绝市场源 | 确认填的是**本地绝对路径**而非 `https://`；本地优先宿主不接受远程源 |
| sha256 不匹配 | 立即删除下载物，不要重试不同源绕过校验，报告给维护者 |
| 插件许可不在 SPDX 白名单 | 不要擅自改 `catalog.config.json`；提 Issue 申请扩充 |
