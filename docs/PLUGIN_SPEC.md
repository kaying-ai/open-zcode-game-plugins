# 插件条目规范

> 一个插件 = `plugins/<name>.json` 一个文件。机器校验依据 [schema/plugin.schema.json](../schema/plugin.schema.json)（JSON Schema 2020-12），语义规则见 `scripts/validate.mjs`。
> 复制 [templates/plugin.example.json](../templates/plugin.example.json) 起步，运行 `node scripts/validate.mjs` 检查。
>
> **标准样本**：首个内置插件 [`kaying-for-ui`](../plugins/kaying-for-ui.json) 与 [`bundled/kaying-for-ui/`](../bundled/kaying-for-ui/) 是本仓库的参考实现。新插件请对照它的 manifest 字段、双宿主包结构（`marketplace.json` + 宿主 `plugin.json` + `LICENSE` / `NOTICE`）与文档组织方式。特别注意：`references/` 目录内的文档互相引用时要用**同级**相对链接（`foo.md`），不要再写一层 `references/foo.md` —— 相对路径以文件所在目录为基准。

## 1. 命名与文件

| 规则 | 说明 |
| --- | --- |
| 文件名 | `plugins/<name>.json`，必须与 `name` 字段完全一致 |
| `name` | `^[a-z0-9][a-z0-9._-]{1,63}$`，小写、稳定、发布后不改名 |
| 语言键 | `zh-CN` 与 `en`（对齐 ZCode 官方 `marketplace.json` 的 `_i18n` 约定） |
| 排序 | 生成时按 `name` 字典序；不要手动调整 README 表格顺序 |
| 生成物 | `catalog.json`、两份 README 的插件表格**一律由脚本生成**，PR 中不要改 |

## 2. 字段总表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `$schema` | string | 否 | `../schema/plugin.schema.json`，仅供编辑器补全 |
| `name` | string | ✅ | 插件唯一标识，等于文件名 |
| `version` | string | ✅ | SemVer（`1.2.3`，可带 `-rc.1` / `+build`） |
| `displayName` | string | 否 | 英文展示名；缺省回退 `name` |
| `displayName_i18n` | object | 否 | `{ "zh-CN": ..., "en": ... }` |
| `description` | string | ✅ | 英文一句话兜底（12–300 字），也是官方市场兼容字段 |
| `description_i18n` | object | ✅ | `zh-CN` + `en` 均必填，语义一致 |
| `category` | enum | ✅ | 见第 3 节 |
| `marketplaceCategory` | string | 否 | 导出到 ZCode 市场时的分类，默认 `游戏/3D` |
| `keywords` | string[] | 否 | ≤ 20 个，去重，用于 Agent 检索 |
| `hosts` | enum[] | ✅ | `zcode` / `kayingcode`，至少 1 个 |
| `author` | object | ✅ | `name` 必填，`url` 可选（https） |
| `license` | string | ✅ | **插件自身**的 SPDX 标识，须在 `catalog.config.json` 的 `spdxLicenses` 白名单内 |
| `repository` | string | ✅ | 插件源码仓库 https 地址 |
| `homepage` / `icon` | string | 否 | https 地址 |
| `examplePrompts` | string[] | 否 | ≤ 6 条，示例用法 |
| `source` | object | ✅ | 取包方式，见第 4 节 |
| `install` | object | 否 | `strategy` / `notes_i18n` / `requires` |
| `notes_i18n` | object | 否 | 维护者备注（中英） |
| `addedAt` | date | ✅ | `YYYY-MM-DD`，首次收录日 |
| `updatedAt` | date | 否 | 最近更新日，不得早于 `addedAt` |

**不要**出现的字段：未经审阅的安装命令、令牌、私钥、内网地址、非 https 链接、base64 二进制。

## 3. 分类 `category`

| 值 | 中文 | 适用范围 |
| --- | --- | --- |
| `game-design` | 策划与原型 | GDD/PRD、玩法原型、数值与关卡规划 |
| `game-ui` | 游戏 UI 与交互 | 界面设计、设计令牌、切图、图集、引擎 UI 交付 |
| `game-art` | 美术与资源 | 2D/3D 资产、贴图、动画、风格生成 |
| `game-engine` | 引擎集成 | Godot / Unity / Cocos / Unreal 工程对接 |
| `game-content` | 内容与关卡 | 关卡、剧情、本地化、配置表 |
| `game-audio` | 音频 | 音效、BGM、语音 |
| `game-tooling` | 工程工具链 | 构建、校验、打包、CI、诊断 |
| `other` | 其他 | 确实不属于以上，需在 PR 说明理由 |

分类在 `catalog.config.json` 中集中定义，可提 Issue 申请扩充。`marketplaceCategory` 默认 `游戏/3D`，与 [zai-org/zcode-plugins](https://github.com/zai-org/zcode-plugins) 的官方分类保持一致。

## 4. `source`：三种取包方式

所有方式都必须让 `source.packages` 的键与 `hosts` **完全一致**。每个包对象：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `path` | ✅ | 相对路径，禁止绝对路径 / `..` |
| `marketplace` | ✅ | 相对包目录的市场清单，通常 `marketplace.json` |
| `pluginManifest` | ✅ | 相对包目录，如 `.zcode-plugin/plugin.json` |
| `licenseFile` / `noticeFile` | 否 | 默认 `LICENSE` / `NOTICE` |
| `url` / `sha256` | `zip` 必填 | 不可变 HTTPS 压缩包地址 + 小写 64 位 SHA-256 |

### 4.1 `bundled`（仅维护者）

插件副本随本仓库分发，Agent 一次克隆即可安装，无需第二个源。

- `path` 必须位于 `bundled/<name>/` 下；`source.ref` 必须是上游 **40 位 commit SHA**。
- 校验器会实际读取目录，比对 `marketplace.json` 与宿主 `plugin.json` 的 `name` / `version`，并要求 `LICENSE` / `NOTICE` 存在。
- 副本必须保留原许可与声明，**不得**用本仓库的 Apache-2.0 覆盖。

### 4.2 `git`（推荐给外部贡献者）

```json
"source": {
  "type": "git",
  "repository": "https://github.com/you/your-plugin.git",
  "ref": "0123456789abcdef0123456789abcdef01234567",
  "packages": {
    "zcode": {
      "path": "platform/forZcode",
      "marketplace": "marketplace.json",
      "pluginManifest": ".zcode-plugin/plugin.json"
    }
  }
}
```

`ref` 强烈建议使用完整 commit SHA；tag / 分支可变，需在 PR 中说明理由。

### 4.3 `zip`（发布产物）

```json
"source": {
  "type": "zip",
  "packages": {
    "kayingcode": {
      "path": "your-plugin",
      "marketplace": "marketplace.json",
      "pluginManifest": ".kayingcode-plugin/plugin.json",
      "url": "https://github.com/you/your-plugin/releases/download/v1.0.0/your-plugin-kayingcode.zip",
      "sha256": "<64 位小写十六进制>"
    }
  }
}
```

对齐官方[公开分发格式](https://github.com/zai-org/zcode-plugins/blob/main/docs/distribution_CN.md)：`sha256` 必填，校验失败必须停止安装；同一版本的产物内容不可变。**不要**用 `latest` 这类可变 URL。

## 5. 收录标准

- ✅ 面向**游戏开发**，能让 Agent 在 ZCode / KayingCode 中完成具体工作。
- ✅ 随包带 `LICENSE` / `NOTICE`；内置（`bundled`）副本的 Markdown 相对链接全部可解析。
- ✅ 至少支持一个目标宿主，提供可校验的 `marketplace.json` 与宿主 `plugin.json`。
- ✅ 中英文描述齐全、版本可固定、来源为 HTTPS。
- ✅ 一个 PR 只提交或更新一个插件，重复收录会被拒绝。
- ❌ 许可不明、闭源、仅本地路径、指向私有仓库、含未声明的可执行安装脚本或二进制。
- ❌ 冒用 ZCode 官方名义、镜像官方插件、抓取官方 CDN 资源。
- ❌ 与已收录插件功能完全重叠且无差异说明。

## 6. 校验规则（`scripts/validate.mjs`）

1. JSON Schema 子集校验：`required` / `type` / `enum` / `pattern` / `additionalProperties: false` / 长度 / 日期格式 / `$ref`。
2. 文件名 = `name.json`；`name` 全局唯一。
3. `hosts` 与 `source.packages` 键集合相等。
4. `category` 在配置表中；`license` 在 SPDX 白名单中。
5. `bundled`：目录、市场清单、宿主清单、LICENSE/NOTICE 齐全，且 name/version 与条目一致；并扫描包内 Markdown 相对链接（相对当前文件目录解析，跳过代码块、外部 URL 与占位符）。
6. `git`：仓库地址与 `ref` 存在；`zip`：`url` + `sha256` 合法。
7. 所有 `path` 为安全相对路径；`updatedAt >= addedAt`；不残留模板占位值。

## 7. 版本维护

- 插件发新版本时，只改对应 `plugins/<name>.json` 的 `version`、`source.ref`（或 `url` + `sha256`）、`updatedAt`，提交信息用 `plugin: update <name> @ <version>`。
- 已发布版本的取包内容应视为不可变；若上游悄悄改了同一 tag 的内容，请改用 commit SHA。
- 下架插件：删除条目文件并在 PR 说明理由；自动化会从 `catalog.json` 与两份 README 中同步移除。
