import type { Attachment, Conversation, Message, ThinkingBlock } from '../core/types';
import type { Adapter } from './types';

/**
 * DeepSeek 分享页适配器（基于公开接口，而非 DOM 抓取）。
 *
 * 分享链接有两种历史格式：
 *   - https://chat.deepseek.com/share/{shareId}
 *   - https://chat.deepseek.com/a/chat/s/{shareId}
 *
 * 数据接口（与分享页同源，脚本内 fetch 无 CORS 问题）：
 *   GET /api/v0/share/content?share_id={shareId}
 * 返回 biz_data.messages / biz_data.title / biz_data.model_type。
 * 每条消息的 content 是原始 Markdown，thinking_content 是思考过程。
 */

interface ShareFile {
  file_name?: string;
  file_url?: string;
  url?: string;
  name?: string;
  [key: string]: unknown;
}

interface ShareMessage {
  message_id: number;
  parent_id: number | null;
  role: string;
  content: string;
  thinking_content: string | null;
  inserted_at?: number;
  files?: ShareFile[];
}

export interface ShareData {
  title?: string;
  model_type?: string;
  messages: ShareMessage[];
}

interface ShareResponse {
  code: number;
  msg?: string;
  data?: {
    biz_code: number;
    biz_msg?: string;
    biz_data?: ShareData;
  };
}

export const deepseekAdapter: Adapter = {
  platform: 'deepseek',
  detect(url: string): boolean {
    return /chat\.deepseek\.com\/(share\/|a\/chat\/s\/)/.test(url);
  },
  async extract(): Promise<Conversation> {
    const shareId = extractShareId(location.href);
    if (!shareId) throw new Error('无法从链接解析出分享 ID');

    const resp = await fetch(`/api/v0/share/content?share_id=${encodeURIComponent(shareId)}`, {
      credentials: 'include',
    });
    if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status}`);

    const json = (await resp.json()) as ShareResponse;
    if (json.code !== 0 || json.data?.biz_code !== 0) {
      throw new Error(`分享不存在或已失效（biz_code=${json.data?.biz_code}）`);
    }
    return mapShareData(shareId, location.href, json.data!.biz_data!);
  },
};

function extractShareId(url: string): string | null {
  const m = url.match(/\/(?:share|a\/chat\/s)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** 纯函数：把接口返回的 biz_data 映射为统一 Conversation（便于测试与复用） */
export function mapShareData(shareId: string, sourceUrl: string, bd: ShareData): Conversation {
  return {
    id: shareId,
    title: deriveTitle(bd),
    platform: 'deepseek',
    sourceUrl,
    model: bd.model_type && bd.model_type !== 'default' ? bd.model_type : undefined,
    createdAt: bd.messages[0]?.inserted_at ? unixToIso(bd.messages[0].inserted_at) : undefined,
    messages: bd.messages.map(toMessage),
  };
}

function deriveTitle(bd: ShareData): string {
  const t = bd.title?.trim();
  if (t && t !== 'Shared Conversation') return t;
  // 分享标题通常是通用的，回退到首条用户消息，得到更有意义的标题
  const firstUser = bd.messages.find((m) => m.role === 'USER');
  const c = firstUser?.content?.trim().replace(/\s+/g, ' ');
  if (c) return c.length > 30 ? `${c.slice(0, 30)}…` : c;
  return t || '未命名会话';
}

function toMessage(m: ShareMessage): Message {
  const thinking: ThinkingBlock[] =
    m.thinking_content && m.thinking_content.trim()
      ? [{ title: '深度思考', content: m.thinking_content }]
      : [];
  return {
    id: String(m.message_id),
    role: m.role === 'USER' ? 'user' : m.role === 'ASSISTANT' ? 'assistant' : 'system',
    content: m.content ?? '',
    thinking,
    timestamp: m.inserted_at ? unixToIso(m.inserted_at) : undefined,
    attachments: (m.files ?? []).map(toAttachment).filter((a): a is Attachment => a !== null),
  };
}

function toAttachment(f: ShareFile): Attachment | null {
  const url = f.file_url ?? f.url;
  const name = f.file_name ?? f.name;
  if (!url && !name) return null;
  return { type: 'file', name, url };
}

function unixToIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}
