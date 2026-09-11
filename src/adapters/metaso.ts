import type { Conversation, Message, ThinkingBlock } from '../core/types';
import type { Adapter } from './types';

/**
 * 秘塔 AI 搜索（Metaso）分享页适配器。
 *
 * 分享链接两种形态（/s/ 会跳到 /chat/）：
 *   https://metaso.cn/s/{shareKey}
 *   https://metaso.cn/chat/{conversationId}?shareType=15&ssi={shareKey}
 *
 * 无需登录态。数据来自同源公开接口：
 *   GET /api/conversation/{id}/branched-messages?shareKey={key}&shareType={type}
 *
 * 返回 data.messageTree 是递归消息树，节点字段：
 *   role: "USER" | "ASSISTANT"；model（如 ds-v4）；totalCiteNum；citation[]
 *   USER:     content.text
 *   ASSISTANT: content.stages[].texts[]，按 type 判别：
 *     reasoning_content  思考过程（穿插「搜索到N条结果」等中间笔记）
 *     action             搜索动作（text 形如： 搜索 "关键词" ）
 *     text               最终回答（Markdown，含引用标记）
 *   citation[]: {title, link, source, display.refer_id}
 */

interface MsText {
  type?: string;
  text?: string;
  durationMillis?: number;
  extra?: unknown;
}

interface MsCite {
  title?: string;
  link?: string;
  source?: string;
  display?: { refer_id?: number };
}

interface MsStage {
  texts?: MsText[];
}

interface MsNode {
  id?: string;
  parentId?: string | null;
  role?: string;
  model?: string;
  createTime?: string;
  totalCiteNum?: number;
  content?: { text?: string; stages?: MsStage[] };
  citation?: MsCite[];
  children?: MsNode[];
}

interface MsData {
  title?: string;
  createTime?: string;
  messageTree?: MsNode[];
}

const GENERIC_TITLES = new Set(['新对话', '']);

export const metasoAdapter: Adapter = {
  platform: 'metaso',
  detect(url: string): boolean {
    return /metaso\.cn\/(s\/[A-Za-z0-9]+|chat\/\d+)/.test(url);
  },
  async extract(): Promise<Conversation> {
    const { conversationId, shareKey, shareType } = parseShareParams(location.href);
    if (!conversationId || !shareKey) {
      throw new Error('无法从链接解析分享参数（conversationId / shareKey）');
    }
    const q = new URLSearchParams({ shareKey, shareType: shareType ?? '15' });
    const resp = await fetch(`/api/conversation/${conversationId}/branched-messages?${q}`, {
      credentials: 'include',
    });
    if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status}`);
    const json = (await resp.json()) as { errCode?: number; data?: MsData };
    if (json.errCode !== 0 || !json.data) throw new Error(`分享不存在或已失效（errCode=${json.errCode}）`);
    return mapMetasoData(json.data, location.href);
  },
};

function parseShareParams(url: string): { conversationId: string | null; shareKey: string | null; shareType: string | null } {
  const conversationId = url.match(/\/chat\/(\d+)/)?.[1] ?? null;
  const q = new URL(url, 'https://metaso.cn').searchParams;
  const shareKey = q.get('ssi') ?? q.get('shareKey') ?? url.match(/\/s\/([A-Za-z0-9]+)/)?.[1] ?? null;
  return { conversationId, shareKey, shareType: q.get('shareType') };
}

/** 纯函数：把秘塔分享数据映射为统一 Conversation（便于测试） */
export function mapMetasoData(data: MsData, sourceUrl: string): Conversation {
  const messages: Message[] = [];
  let model: string | undefined;

  const walk = (nodes: MsNode[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (node.role === 'USER') {
        if (node.content?.text?.trim()) {
          messages.push({
            id: node.id ?? String(messages.length),
            role: 'user',
            content: node.content.text,
            timestamp: node.createTime,
          });
        }
      } else if (node.role === 'ASSISTANT') {
        if (!model && node.model) model = node.model;
        messages.push(toAssistant(node, messages.length));
      }
      walk(node.children);
    }
  };
  walk(data.messageTree);

  const firstUser = messages.find((m) => m.role === 'user')?.content.trim();
  const title =
    data.title && !GENERIC_TITLES.has(data.title.trim())
      ? data.title.trim()
      : firstUser
        ? firstUser.length > 30
          ? `${firstUser.slice(0, 30)}…`
          : firstUser
        : '未命名会话';

  return {
    id: sourceUrl.match(/\/chat\/(\d+)/)?.[1] ?? sourceUrl.match(/\/s\/([A-Za-z0-9]+)/)?.[1] ?? 'unknown',
    title,
    platform: 'metaso',
    sourceUrl,
    model,
    createdAt: data.createTime,
    messages,
  };
}

function toAssistant(node: MsNode, idx: number): Message {
  const thinkingParts: string[] = [];
  const contentParts: string[] = [];

  for (const stage of node.content?.stages ?? []) {
    for (const t of stage.texts ?? []) {
      if (t.type === 'reasoning_content' && t.text?.trim()) {
        thinkingParts.push(t.text.trim());
      } else if (t.type === 'action' && t.text?.trim()) {
        contentParts.push(`> 🔧 ${t.text.trim()}`);
      } else if (t.type === 'text' && t.text?.trim()) {
        contentParts.push(t.text);
      }
    }
  }

  // 引用来源列表（秘塔按"被引用点"返回 citation，同一来源会出现多次，按链接去重）
  const cites = node.citation ?? [];
  if (cites.length > 0) {
    const seen = new Set<string>();
    const uniq: MsCite[] = [];
    for (const c of cites) {
      const key = `${c.title ?? ''}|${c.link ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push(c);
      }
    }
    const total = node.totalCiteNum ?? uniq.length;
    const lines: string[] = [`> 📚 **来源**（共 ${total} 条引用，去重后 ${uniq.length} 条）：`];
    for (const c of uniq) {
      if (c.title && c.link) lines.push(`> - [${c.title}](${c.link})`);
    }
    if (lines.length > 1) contentParts.push(lines.join('\n'));
  } else if (node.totalCiteNum) {
    contentParts.push(`> 📚 引用来源共 ${node.totalCiteNum} 条（分享数据未含明细）`);
  }

  const thinking: ThinkingBlock[] =
    thinkingParts.length > 0 ? [{ title: '深度思考', content: thinkingParts.join('\n\n') }] : [];

  return {
    id: node.id ?? String(idx),
    role: 'assistant',
    content: contentParts.join('\n\n'),
    thinking,
    timestamp: node.createTime,
  };
}
