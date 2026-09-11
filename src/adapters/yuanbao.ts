import type { Conversation, Message, ThinkingBlock } from '../core/types';
import type { Adapter } from './types';

/**
 * 腾讯元宝（Yuanbao）分享页适配器。
 *
 * 分享链接：https://yb.tencent.com/s/{shareId}
 * 无需登录态。数据由 Next.js SSR 内嵌在页面里：
 *   window.__NEXT_DATA__.props.pageProps.fullChatShareData
 * （curl 也能拿到原始 HTML，其中 <script id="__NEXT_DATA__"> 同样含该数据）
 *
 * 结构：
 *   chat.title / chat.modelId
 *   chat.convs[]（按 index 排序）：
 *     role.type: "user" | "agent"
 *     speech: 用户文本（agent 消息此字段为空）
 *     speechesV2[]: { content: [段数组] }，段按 type 判别：
 *       "think" / 含 thinkDeepInfo   深度思考（T1）
 *       "text"      {msg}            正文（Markdown，可含引用锚点）
 *       "searchGuid" {docs:[{title,url}]} 联网搜索引用
 *       step/page/progress/yuanqi_tool_call 等过程段跳过并汇总提示
 */

interface YBRole {
  type?: string;
  name?: string;
}

interface YBDoc {
  title?: string;
  url?: string;
  web_site_name?: string;
}

interface YBSegment {
  type?: string;
  msg?: string;
  thinkDeepInfo?: unknown;
  docs?: YBDoc[];
  content?: unknown;
  [k: string]: unknown;
}

interface YBSpeech {
  speechType?: string;
  content?: YBSegment[];
}

interface YBConv {
  role?: YBRole;
  speech?: string;
  speechesV2?: YBSpeech[];
  createTime?: number | string;
  index?: number;
}

interface YBShareData {
  id?: string;
  chat?: {
    title?: string;
    modelId?: string;
    convs?: YBConv[];
  };
}

export const yuanbaoAdapter: Adapter = {
  platform: 'yuanbao',
  detect(url: string): boolean {
    return /yb\.tencent\.com\/s\/[A-Za-z0-9]+/.test(url);
  },
  extract(): Conversation {
    const data = readShareData();
    if (!data?.chat) throw new Error('未找到 SSR 内嵌的分享数据（页面可能未加载完成或结构已变化）');
    return mapYuanbaoShare(data, location.href);
  },
};

function readShareData(): YBShareData | null {
  const nextData = (window as unknown as { __NEXT_DATA__?: { props?: { pageProps?: { fullChatShareData?: YBShareData } } } })
    .__NEXT_DATA__;
  return nextData?.props?.pageProps?.fullChatShareData ?? null;
}

/** 纯函数：把元宝分享数据映射为统一 Conversation（便于测试） */
export function mapYuanbaoShare(data: YBShareData, sourceUrl: string): Conversation {
  const chat = data.chat ?? {};
  const convs = (chat.convs ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return {
    id: data.id ?? sourceUrl.match(/\/s\/([A-Za-z0-9]+)/)?.[1] ?? 'unknown',
    title: chat.title?.trim() || '未命名会话',
    platform: 'yuanbao',
    sourceUrl,
    model: chat.modelId || undefined,
    createdAt: convs[0] ? toIso(convs[0].createTime) : undefined,
    messages: convs.map(toMessage),
  };
}

function toMessage(m: YBConv, idx: number): Message {
  const isUser = m.role?.type === 'user';
  const contentParts: string[] = [];
  const thinking: ThinkingBlock[] = [];
  const unknownKinds = new Map<string, number>();

  for (const sp of m.speechesV2 ?? []) {
    for (const seg of sp.content ?? []) {
      const type = seg.type ?? '';

      // 深度思考：type "think" 或携带 thinkDeepInfo（deep_think_box 为客户端合成段，兼容处理）
      const thinkRaw = seg.thinkDeepInfo ?? (type === 'think' ? seg : undefined);
      if (thinkRaw != null && type !== 'text') {
        const text = textOf(thinkRaw);
        if (text) thinking.push({ title: '深度思考', content: text });
        continue;
      }

      if (type === 'text' && seg.msg?.trim()) {
        contentParts.push(seg.msg);
      } else if (type === 'searchGuid' && seg.docs?.length) {
        const lines: string[] = ['> 🔍 **联网搜索**：'];
        for (const d of seg.docs) {
          if (d.title && d.url) lines.push(`> - [${d.title}](${d.url})`);
        }
        if (lines.length > 1) contentParts.push(lines.join('\n'));
      } else if (!isUser && type && !['text', 'searchGuid'].includes(type)) {
        unknownKinds.set(type, (unknownKinds.get(type) ?? 0) + 1);
      }
    }
  }

  if (unknownKinds.size > 0) {
    const summary = [...unknownKinds.entries()].map(([k, n]) => `${k}×${n}`).join(', ');
    contentParts.push(`> _（未导出的过程段：${summary}）_`);
  }

  // 用户消息正文兜底：speechesV2 没有可用文本段时使用 speech
  if (isUser && contentParts.length === 0 && m.speech?.trim()) {
    contentParts.push(m.speech);
  }

  return {
    id: String(m.index ?? idx),
    role: isUser ? 'user' : 'assistant',
    content: contentParts.join('\n\n'),
    thinking,
    timestamp: toIso(m.createTime),
  };
}

/** 从 thinkDeepInfo（字符串或对象）提取思考文本 */
function textOf(v: unknown, depth = 0): string | null {
  if (depth > 3 || v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => textOf(x, depth + 1)).filter(Boolean) as string[];
    return parts.length ? parts.join('\n') : null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const key of ['msg', 'content', 'text', 'reasoning_content']) {
      if (key in o) {
        const t = textOf(o[key], depth + 1);
        if (t) return t;
      }
    }
  }
  return null;
}

/** createTime 兼容毫秒/秒时间戳与 ISO 字符串 */
function toIso(v: number | string | undefined): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return toIso(Number(v));
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const ms = v > 1e12 ? v : v * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
