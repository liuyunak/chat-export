# 聊天会话导出助手

把聊天 / Agent 工具的**分享会话**导出为 Markdown 文档，可选是否包含思考过程（如 DeepSeek R1 深度思考）。

当前各大工具逐渐收紧直接导出 Markdown 的能力，普遍只剩「分享链接」。本项目通过浏览器脚本直接读取分享页内容，导出为你自己可留存、可编辑的 `.md` 文件。

## 特性

- ✅ 油猴脚本形态，装上即用，无需后端
- ✅ 可选「是否包含思考过程」（默认包含）
- ✅ 导出为带 YAML frontmatter 的 Markdown（标题 / 平台 / 源链接 / 导出时间）
- ✅ 平台适配器架构，新增平台只需加一个文件（见 [docs/adapter-guide.md](docs/adapter-guide.md)）
- 🔧 内置「复制调试信息」，方便开发者校准新平台选择器

## 支持的平台

| 平台 | 状态 | 数据来源 |
| --- | --- | --- |
| DeepSeek | ✅ 可用 | 公开接口 `/api/v0/share/content` |
| WorkBuddy（CodeBuddy） | ✅ 可用 | 页面内嵌 `__PUBLISH_BOOTSTRAP__` → CDN 数据文件 |
| 豆包（Doubao） | ✅ 可用 | 页面 SSR 内嵌数据（`script[data-fn-name=mergeLoaderData]`） |
| Trae（TraeWork） | ✅ 可用 | 公开接口 `/api/remote/v1/share/{id}/messages`（含 agent 步骤与思考） |
| Kimi | ✅ 可用 | 公开接口 `GetChatShare`（blocks：text / think / search） |
| 腾讯元宝 | ✅ 可用 | 页面 SSR 内嵌 `__NEXT_DATA__`（speechesV2 段：text / think / searchGuid） |
| 智谱清言（ChatGLM） | ✅ 可用 | 页面内存提取（接口带 X-Sign 签名；vuex dataList：question + answerArray） |
| 秘塔 AI 搜索（Metaso） | ✅ 可用 | 公开接口 `/api/conversation/{id}/branched-messages`（含思考轨迹 + 去重后的引用来源） |
| 通义千问 | ➖ 不需要 | 官方原生支持导出，无需适配 |

> 通义千问全系列自带会话导出功能，无需本项目适配。

> 脚本运行在你已登录的浏览器里、自带登录态，这是它相对命令行工具的核心优势——理论上能覆盖需登录的平台，但每个平台「数据在哪个接口/字段」需真实页面确认后再写适配器。

## 长尾平台

以下平台有分享功能但尚未适配，欢迎按 [docs/adapter-guide.md](docs/adapter-guide.md) 的套路贡献适配器：文心一言、讯飞星火、秘塔 AI 搜索、扣子空间 等。贡献方式：打开分享页，把 DevTools Network 里返回会话数据的接口响应贴到 issue，或点脚本面板「复制调试信息」。

> 注意：判断"是否需要登录"不能只看 curl 结果（反爬会挡 curl 但不挡浏览器），要看页面真实渲染。

## 安装

### 方式一：油猴脚本（Tampermonkey）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（Edge / Chrome / 360 / QQ 浏览器 / Firefox 均可）。
2. 从 [Releases](../../releases) 下载 `chat-export.user.js`（或自行构建后取 `dist/chat-export.user.js`）。
3. Tampermonkey 面板 → 「添加新脚本」→ 粘贴脚本内容，保存。
4. 打开任一支持的分享链接，页面右上角出现「导出会话」面板即生效。

### 方式二：浏览器扩展（无需油猴）

1. 从 [Releases](../../releases) 下载 `chat-export-extension.zip` 并解压（或自行构建取 `dist/extension/`）。
2. 浏览器扩展管理页打开「开发者模式」→「加载已解压的扩展程序」→ 选择解压后的目录。
3. 需要较新内核（Chromium 111+，近两年的 Edge / Chrome / 360 极速 / QQ 浏览器均满足）。

## 使用

1. 打开分享链接（例如 `https://chat.deepseek.com/a/chat/s/...`）。
2. 在右上角面板勾选/取消「包含思考过程」。
3. 点「导出 Markdown」，下载 `.md` 文件。

## 开发

```bash
npm install              # 安装依赖
npm run dev              # 监听构建（改动自动重新打包）
npm run build            # 构建油猴脚本 dist/chat-export.user.js
npm run build:extension  # 构建 MV3 扩展 dist/extension/（+ zip）
npm run build:all        # 两者都构建
npm run typecheck        # 类型检查
npm run verify -- <platform> <id>   # 端到端验证某平台适配器
```

### 发布

```bash
# 1. 更新 package.json 版本号，然后：
git commit -am "release: v0.x.0"
git tag v0.x.0

# 2. 配置三仓 remote（首次）：
git remote add github  git@github.com:<you>/chat-export.git
git remote add gitee   git@gitee.com:<you>/chat-export.git
git remote add atomgit git@atomgit.com:<you>/chat-export.git

# 3. 推送三仓（推 v* 标签到 GitHub 会自动触发 CI 构建并发布 Release）
./scripts/sync-repos.sh v0.x.0

# 4. 等 CI 跑完后，把 Release 安装包同步到 Gitee / AtomGit（两家不会自动生成 Release）
node scripts/publish-release.mjs v0.x.0
```

### 目录结构

```
src/
├─ core/            # 框架无关的核心：类型、渲染、下载、调试工具
│  ├─ types.ts      # 统一中间格式（Conversation / Message / ThinkingBlock）
│  ├─ render.ts     # Conversation → Markdown
│  ├─ download.ts   # 触发 .md 下载
│  └─ debug.ts      # DOM 骨架调试输出
├─ adapters/        # 平台适配器（每个平台一个文件）
│  ├─ types.ts      # Adapter 接口
│  ├─ index.ts      # 适配器注册表
│  ├─ deepseek.ts   # DeepSeek 适配器
│  └─ _template.ts  # 适配器模板
├─ userscript/
│  └─ index.ts      # 油猴脚本入口 + 浮动面板 UI
└─ extension/
   └─ content.ts    # MV3 扩展入口（与油猴共用核心，world: MAIN）
extension/
└─ manifest.template.json  # MV3 manifest 模板（版本号构建时与 package.json 同步）
scripts/
├─ verify.ts              # 端到端验证脚本
├─ build-extension.mjs    # MV3 扩展构建
└─ sync-repos.sh          # 三仓推送
```

### 如何新增平台

见 [docs/adapter-guide.md](docs/adapter-guide.md)，复制模板、实现 `detect` + `extract`、注册即可。

## 已知限制

- DeepSeek 分享接口返回的正文里，联网搜索的引用以 `[reference:N]` 占位符形式存在（接口本身不返回引用原文链接）。这是 DeepSeek 分享数据本身的限制，导出会忠实保留这些标记。
- 附件（图片 / 文件）字段已预留映射，但尚未有真实样例校准，欢迎提 issue 附样例链接。

## 合规定位

本项目用于**导出你自己分享的会话**做本地留存。请勿用于绕过付费墙、批量抓取他人分享内容等违反各平台服务条款的行为。

## 许可证

[MIT](LICENSE)

## 仓库镜像

- GitHub（主仓）：https://github.com/liuyunak/chat-export
- Gitee（国内镜像）：https://gitee.com/ikeer_1_ligui880213/chat-export
- AtomGit（国内镜像）：https://atomgit.com/liuyunak/chat-export
