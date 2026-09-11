import type { Attachment, Conversation, Message, ThinkingBlock } from '../core/types';
import type { Adapter } from './types';

/**
 * 豆包（Doubao）分享/线程页适配器。
 *
 * 分享链接：https://www.doubao.com/thread/{threadId}
 * 数据不在接口里（接口需登录态），而是由服务端以 SSR 形式内嵌在 HTML 的
 * <script data-fn-name="mergeLoaderData" data-fn-args="..."> 中（Modern.js 流式 SSR）。
 * 浏览器 DOM 解析后 getAttribute 已把 &quot; 等实体解码，直接 JSON.parse 即可。
 *
 * 数据路径：
 *   data-fn-args -> JSON.parse -> outer[1] (loaders 数组)
 *     -> 找 key === 'shareInfo' -> routerDataFnArgs[0] -> JSON.parse -> inner
 *       inner.data.share_info          标题 / bot 名
 *       inner.data.message_snapshot.message_list  消息数组
 *
 * 消息结构：
 *   user_type: 1=用户 2=豆包
 *   content: 又是 JSON 字符串，块数组，按 block_type 区分：
 *     10000 text_block               正文（Markdown）
 *     10025 search_query_result_block 联网搜索/引用
 *     10050 rich_media_block         富媒体（视频等）
 *     10052 attachment_block         用户附件（图片）
 *     10053 tips_block               AI 免责声明（跳过）
 *     10056 reference_block          深度思考（think_block）
 *   thinking_content: 消息级思考文本（深度思考时有值）
 *   create_time: Unix 秒
 */

interface DBTextBlock {
  text?: string;
}
interface DBSearchResult {
  text_card?: { title?: string; url?: string };
}
interface DBAttachment {
  image?: { url?: string; image_thumb?: { url?: string } };
}
interface DBBlock {
  block_type: number;
  block_id?: string;
  content?: {
    text_block?: DBTextBlock;
    search_query_result_block?: { summary?: string; results?: DBSearchResult[] };
    attachment_block?: { attachments?: DBAttachment[] };
    reference_block?: Record<string, unknown>;
    [k: string]: unknown;
  };
}
interface DBMessage {
  message_id?: string;
  user_type?: number;
  content?: string;
  thinking_content?: string;
  create_time?: number;
  index_in_conv?: string | number;
}
interface DBInner {
  data?: {
    share_info?: { share_name?: string; bot?: { name?: string } };
    message_snapshot?: { message_list?: DBMessage[] };
  };
}

export const doubaoAdapter: Adapter = {
  platform: 'doubao',
  detect(url: string): boolean {
    return /doubao\.com\/(thread|share\/doc)\/[A-Za-z0-9]/.test(url);
  },
  extract(): Conversation {
    const inner = readShareInner();
    if (!inner) throw new Error('未找到内嵌的分享数据（页面可能未加载完成或结构已变化）');
    return mapDoubaoShare(inner, location.href);
  },
};

function readShareInner(): DBInner | null {
  const scripts = document.querySelectorAll('script[data-fn-name="mergeLoaderData"]');
  for (const s of scripts) {
    const attr = s.getAttribute('data-fn-args');
    if (!attr) continue;
    let outer: unknown;
    try {
      outer = JSON.parse(attr);
    } catch {
      continue;
    }
    const loaders = (outer as unknown[])[1];
    if (!Array.isArray(loaders)) continue;
    const share = loaders.find((x) => (x as { key?: string }).key === 'shareInfo') as
      | { routerDataFnArgs?: string[] }
      | undefined;
    const arg = share?.routerDataFnArgs?.[0];
    if (typeof arg === 'string') {
      try {
        return JSON.parse(arg) as DBInner;
      } catch {
        /* 继续找下一个 */
      }
    }
  }
  return null;
}

/** 纯函数：把豆包 inner 数据映射为统一 Conversation（便于测试） */
export function mapDoubaoShare(inner: DBInner, sourceUrl: string): Conversation {
  const shareInfo = inner.data?.share_info;
  const list = (inner.data?.message_snapshot?.message_list ?? [])
    .slice()
    .sort((a, b) => num(a.index_in_conv) - num(b.index_in_conv));

  const threadId = sourceUrl.match(/\/(?:thread|share\/doc)\/([A-Za-z0-9]+)/)?.[1] ?? 'unknown';
  return {
    id: threadId,
    title: shareInfo?.share_name?.trim() || firstUserPreview(list),
    platform: 'doubao',
    sourceUrl,
    model: shareInfo?.bot?.name || undefined,
    createdAt: list[0]?.create_time ? unixToIso(list[0].create_time) : undefined,
    messages: list.map(toMessage),
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toMessage(m: DBMessage, idx: number): Message {
  let blocks: DBBlock[] = [];
  try {
    blocks = m.content ? (JSON.parse(m.content) as DBBlock[]) : [];
  } catch {
    blocks = [];
  }

  const contentParts: string[] = [];
  const thinking: ThinkingBlock[] = [];
  const attachments: Attachment[] = [];

  for (const b of blocks) {
    switch (b.block_type) {
      case 10000:
        if (b.content?.text_block?.text) contentParts.push(b.content.text_block.text);
        break;
      case 10025: {
        const s = b.content?.search_query_result_block;
        if (s) contentParts.push(renderSearch(s));
        break;
      }
      case 10052: {
        const atts = b.content?.attachment_block?.attachments ?? [];
        for (const a of atts) {
          const url = a?.image?.image_thumb?.url ?? a?.image?.url;
          if (url) attachments.push({ type: 'image', name: '图片', url });
        }
        break;
      }
      case 10050:
        contentParts.push('> 📎 此处含富媒体内容（视频等），Markdown 中省略原媒体。');
        break;
      case 10056: {
        const t = textOfObject(b.content?.reference_block);
        if (t) thinking.push({ title: '深度思考', content: t });
        break;
      }
      case 10053:
        break; // AI 免责声明，跳过
      default:
        contentParts.push(`> _[未识别块 block_type=${b.block_type}]_`);
    }
  }

  // 消息级思考（深度思考）优先于 10056 块
  if (m.thinking_content?.trim()) thinking.unshift({ title: '深度思考', content: m.thinking_content });

  return {
    id: m.message_id ?? String(idx),
    role: m.user_type === 1 ? 'user' : m.user_type === 2 ? 'assistant' : 'system',
    content: contentParts.join('\n\n'),
    thinking,
    timestamp: m.create_time ? unixToIso(m.create_time) : undefined,
    attachments,
  };
}

function renderSearch(s: { summary?: string; results?: DBSearchResult[] }): string {
  const lines: string[] = [];
  if (s.summary) lines.push(`> 🔍 **联网搜索**：${s.summary}`);
  for (const r of s.results ?? []) {
    const t = r.text_card?.title;
    const u = r.text_card?.url;
    if (t && u) lines.push(`> - [${t}](${u})`);
  }
  return lines.join('\n');
}

function textOfObject(o: Record<string, unknown> | undefined): string | null {
  if (!o) return null;
  const strs: string[] = [];
  const walk = (v: unknown, d: number): void => {
    if (d > 3 || v == null) return;
    if (typeof v === 'string') {
      if (v.trim()) strs.push(v);
      return;
    }
    if (typeof v === 'object') for (const x of Object.values(v as object)) walk(x, d + 1);
  };
  walk(o, 0);
  return strs.length ? strs.join('\n') : null;
}

function firstUserPreview(list: DBMessage[]): string {
  const first = list.find((m) => m.user_type === 1);
  try {
    const blocks = JSON.parse(first?.content ?? '[]') as DBBlock[];
    const t = blocks.find((b) => b.block_type === 10000)?.content?.text_block?.text?.trim();
    if (t) return (t.length > 30 ? t.slice(0, 30) + '…' : t);
  } catch {
    /* ignore */
  }
  return '未命名会话';
}

function unixToIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}
