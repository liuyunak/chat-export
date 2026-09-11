# 如何编写一个平台适配器

适配器负责一件事：**把某个平台的分享页 DOM 提取出来，映射成统一的 `Conversation` 结构**。
渲染、下载、UI 都由核心库统一处理，适配器不需要关心。

## 一分钟概览

1. 复制 `src/adapters/_template.ts`，重命名为 `{platform}.ts`。
2. 实现 `detect(url)`：根据 URL 特征判断是否由本适配器处理。
3. 实现 `extract()`：从页面提取会话，返回 `Conversation`。
4. 在 `src/adapters/index.ts` 的 `adapters` 数组里注册。
5. 在 `vite.config.ts` 的 `userscript.match` 里加上对应域名的匹配规则。

## 数据来源优先级：接口 > 内嵌数据 > DOM

拿到一个平台后，**先找它的数据从哪来**，而不是一上来就抓 DOM。三种常见形态，按稳定性从高到低：

1. **公开接口**（最稳）：分享页由前端请求一个 JSON 接口。例如 DeepSeek：`GET /api/v0/share/content?share_id={id}`，返回体直接是原始 Markdown。同源时脚本里直接 `fetch`，无 CORS 问题。
2. **SSR 内嵌数据**（次稳）：服务端把数据直接写进 HTML，通常藏在一个 `<script data-fn-args="...">` 或 `window.__XXX__` 里。例如豆包（Doubao）：`<script data-fn-name="mergeLoaderData" data-fn-args='...'>`，`data-fn-args` 是双层 JSON（外层数组 → 找 `shareInfo` loader → 再 parse 内层），里面是 `message_snapshot.message_list`。脚本用 `document.querySelector('script[data-fn-name="mergeLoaderData"]').getAttribute('data-fn-args')` 读取（DOM 已把 `&quot;` 等实体解码，直接 `JSON.parse`）。
3. **DOM 渲染后抓取**（最不稳）：前两者都拿不到时，才读渲染后的 DOM（见「如何确定选择器」）。

找数据的办法：打开分享页 → 看 HTML 里有没有 `window.__` / `data-fn-args` / `<script type="application/json">`；或 DevTools → Network 找带 `share`/`content`/`detail` 的 XHR。把「取数 + 映射」拆成纯函数（参考 `deepseek.ts` 的 `mapShareData`、`doubao.ts` 的 `mapDoubaoShare`、`workbuddy.ts` 的 `mapWBData`），便于写测试与复用。

## 关键数据结构

见 `src/core/types.ts`。要点：

```ts
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;          // 正文，Markdown 文本
  thinking?: ThinkingBlock[]; // 思考过程，可多条
  timestamp?: string;        // ISO 8601
  attachments?: Attachment[];
}
```

`thinking` 单独存放，这样导出时「是否包含思考过程」的开关才能生效。

## 如何确定选择器

1. 打开目标平台的分享页。
2. 点脚本面板里的「复制调试信息」，得到页面 DOM 的简化骨架（标签 / id / class / 叶子文本）。
3. 在骨架里定位：
   - 会话标题元素；
   - 每一条消息的容器（以及如何区分 user / assistant）；
   - 思考过程的容器（通常是一个可折叠区域）。
4. 用 `document.querySelector` / `querySelectorAll` 提取并映射。

## 提取正文为 Markdown 的两种思路

- **优先**：如果页面的全局状态 / JSON 里保留了原始 Markdown（很多 SPA 会存），直接取原始文本最干净。
- **回退**：从渲染后的 HTML 反推。可以先取 `innerText`（保留换行），再做必要的转义；代码块、表格的高保真转换放到 v2 再完善。

## 注意事项

- 适配器运行在页面上下文里，**不要**发跨域请求（除非页面本身有公开接口且允许）。
- 只提取内容，不修改页面其它元素（脚本面板除外）。
- 优先用 `data-*` 属性或稳定语义，少用会随构建变化的哈希类名（如 CSS Modules 的类名）。
- 兼容分享页可能有的懒加载：如果消息是滚动加载的，先触发滚动到末尾再提取。

## 完成后

- 跑 `npm run typecheck` 确认类型无误。
- 跑 `npm run build` 产出 `dist/chat-export.user.js`。
- 提 PR 时附一张导出效果的 Markdown 预览截图。
