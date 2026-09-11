import type { Attachment, Conversation, Message, ThinkingBlock } from '../core/types';
import type { Adapter } from './types';

/**
 * Kimi（月之暗面）分享页适配器。
 *
 * 分享链接：https://www.kimi.com/share/{shareId}（旧域 kimi.moonshot.cn 同构）
 * 无需登录态。数据来自同源公开接口（gRPC-gateway JSON）：
 *   POST /apiv2/kimi.gateway.chat.v1.ChatService/GetChatShare
 *   body: {"share_id": "<shareId>"}
 * 返回 {share: {chat: {name}, messages: [...], creator, ...}}
 *
 * 消息结构（messages[]，数组即会话顺序，parentId/childrenMessageIds 可再校验）：
 *   role: "user" | "assistant"；createTime 为 ISO 字符串
 *   blocks: 块数组，每块形如 {id, <kind>: payload}，kind 靠「哪个键存在」判别
 *     text   {content}              正文（Markdown）
 *     think  {reasoning_content}    思考过程（K2/K3 深度思考）
 *     search {webPages:[{title,url}]} 联网搜索引用
 *     其余（img/file/OKC 卡片等）跳过，并在正文尾部汇总提示
 */

interface KimiWebPage {
  title?: string;
  url?: string;
}

interface KimiBlock {
  id?: string;
  text?: { content?: string };
  think?: { reasoning_content?: string };
  search?: { webPages?: KimiWebPage[] };
  [k: string]: unknown;
}

interface KimiMessage {
  id?: string;
  parentId?: string;
  childrenMessageIds?: string[];
  role?: string;
  blocks?: KimiBlock[];
  createTime?: string;
}

interface KimiShare {
  id?: string;
  chat?: { id?: string; name?: string };
  messages?: KimiMessage[];
}

interface KimiShareResponse {
  share?: KimiShare;
}

const API_PATH = '/apiv2/kimi.gateway.chat.v1.ChatService/GetChatShare';

export const kimiAdapter: Adapter = {
  platform: 'kimi',
  detect(url: string): boolean {
    return /(?:www\.kimi\.com|kimi\.moonshot\.cn)\/share\/[A-Za-z0-9]+/.test(url);
  },
  async extract(): Promise<Conversation> {
    const shareId = extractShareId(location.href);
    if (!shareId) throw new Error('无法从链接解析分享 ID');

    const resp = await fetch(API_PATH, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ share_id: shareId }),
    });
    if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status}`);

    const json = (await resp.json()) as KimiShareResponse;
    if (!json.share) throw new Error('分享不存在或已失效');
    return mapKimiShare(json.share, location.href);
  },
};

function extractShareId(url: string): string | null {
  return url.match(/\/share\/([A-Za-z0-9]+)/)?.[1] ?? null;
}

/** 纯函数：把 Kimi share 数据映射为统一 Conversation（便于测试） */
export function mapKimiShare(share: KimiShare, sourceUrl: string): Conversation {
  const messages = share.messages ?? [];
  return {
    id: share.id ?? extractShareId(sourceUrl) ?? 'unknown',
    title: share.chat?.name?.trim() || '未命名会话',
    platform: 'kimi',
    sourceUrl,
    createdAt: messages[0]?.createTime,
    messages: messages.map(toMessage),
  };
}

function toMessage(m: KimiMessage, idx: number): Message {
  const contentParts: string[] = [];
  const thinking: ThinkingBlock[] = [];
  const attachments: Attachment[] = [];
  const unknownKinds = new Map<string, number>();

  for (const b of m.blocks ?? []) {
    if (b.text?.content) {
      contentParts.push(b.text.content);
    } else if (b.think?.reasoning_content) {
      thinking.push({ title: '深度思考', content: b.think.reasoning_content });
    } else if (b.search) {
      const lines: string[] = ['> 🔍 **联网搜索**：'];
      for (const w of b.search.webPages ?? []) {
        if (w.title && w.url) lines.push(`> - [${w.title}](${w.url})`);
      }
      if (lines.length > 1) contentParts.push(lines.join('\n'));
    } else {
      const kind = Object.keys(b).find((k) => k !== 'id');
      if (kind) unknownKinds.set(kind, (unknownKinds.get(kind) ?? 0) + 1);
    }
  }

  if (unknownKinds.size > 0) {
    const summary = [...unknownKinds.entries()].map(([k, n]) => `${k}×${n}`).join(', ');
    contentParts.push(`> _（未导出的内容块：${summary}）_`);
  }

  return {
    id: m.id ?? String(idx),
    role: m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'system',
    content: contentParts.join('\n\n'),
    thinking,
    timestamp: m.createTime,
    attachments,
  };
}
