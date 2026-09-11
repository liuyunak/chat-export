import type { Message, ThinkingBlock } from '../core/types';
import type { Conversation } from '../core/types';
import type { Adapter } from './types';

/**
 * WorkBuddy（CodeBuddy 工作台）分享页适配器。
 *
 * 分享链接：https://www.workbuddy.link/p/{nodeId}
 * 页面在 <head> 内嵌 window.__PUBLISH_BOOTSTRAP__，其中给出托管在 CDN 上的
 * 数据文件 conversation-data.json 的基址：
 *   {artifact.url}conversation-data.json
 * 该 CDN 对 www.workbuddy.link 源放开了 CORS，脚本可直接 fetch。
 *
 * 数据结构：messages[]，每条 messageType = user/assistant，content 是块数组：
 *   - {type:'reasoning', text}   思考过程
 *   - {type:'text', text}        正文（Markdown）
 *   - {type:'tool-call', tool}   工具调用（保留为摘要）
 */

interface WBBlock {
  type: string;
  text?: string;
  tool?: unknown;
}

interface WBMessage {
  id: string;
  messageType: string;
  content: WBBlock[];
  createTime?: number;
}

export interface WBData {
  name?: string;
  assistantName?: string;
  messages: WBMessage[];
}

interface PublishBootstrap {
  nodeId: string;
  artifact?: { url?: string };
}

export const workbuddyAdapter: Adapter = {
  platform: 'workbuddy',
  detect(url: string): boolean {
    return /workbuddy\.link\/p\//.test(url);
  },
  async extract(): Promise<Conversation> {
    const data = await loadData();
    return mapWBData(location.href, data);
  },
};

async function loadData(): Promise<WBData> {
  // 优先读页面内嵌的 bootstrap 拿到数据基址，最稳妥
  const bootstrap = readBootstrap();
  const base = bootstrap?.artifact?.url;
  if (base) {
    const resp = await fetch(join(base, 'conversation-data.json'), { credentials: 'omit' });
    if (resp.ok) return (await resp.json()) as WBData;
  }

  // 兜底：从 URL 的 nodeId 推基址（静态目录约定）
  const nodeId = extractNodeId(location.href);
  if (!nodeId) throw new Error('无法解析分享 ID');
  const host = location.host.replace(/^www\./, '').replace(/^workbuddy\.link$/, '');
  void host;
  const fallbackBase = `https://workbuddy-space-static.codebuddy.work/page/${nodeId}/0/`;
  const resp = await fetch(join(fallbackBase, 'conversation-data.json'), { credentials: 'omit' });
  if (!resp.ok) throw new Error(`数据请求失败：HTTP ${resp.status}`);
  return (await resp.json()) as WBData;
}

function readBootstrap(): PublishBootstrap | null {
  const scripts = Array.from(document.querySelectorAll('script'));
  for (const s of scripts) {
    const t = s.textContent ?? '';
    const i = t.indexOf('__PUBLISH_BOOTSTRAP__');
    if (i < 0) continue;
    const start = t.indexOf('{', i);
    const end = t.lastIndexOf('}');
    if (start < 0 || end < 0) continue;
    try {
      return JSON.parse(t.slice(start, end + 1)) as PublishBootstrap;
    } catch {
      /* 忽略解析失败 */
    }
  }
  return null;
}

function extractNodeId(url: string): string | null {
  const m = url.match(/\/p\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function join(base: string, file: string): string {
  return base.endsWith('/') ? base + file : `${base}/${file}`;
}

/** 纯函数：把 workbuddy 数据映射为统一 Conversation（便于测试） */
export function mapWBData(sourceUrl: string, d: WBData): Conversation {
  const nodeId = extractNodeId(sourceUrl) ?? 'unknown';
  return {
    id: nodeId,
    title: d.name?.trim() || '未命名会话',
    platform: 'workbuddy',
    sourceUrl,
    createdAt: d.messages[0]?.createTime ? new Date(d.messages[0].createTime).toISOString() : undefined,
    messages: d.messages.map(toMessage),
  };
}

function toMessage(m: WBMessage): Message {
  const thinking: ThinkingBlock[] = [];
  const contentParts: string[] = [];

  for (const b of m.content) {
    if (b.type === 'reasoning' && b.text?.trim()) {
      thinking.push({ content: b.text });
    } else if (b.type === 'text' && b.text?.trim()) {
      contentParts.push(b.text);
    } else if (b.type === 'tool-call') {
      const name = toolName(b.tool);
      if (name) contentParts.push(`> 🔧 调用工具：\`${name}\``);
    }
  }

  return {
    id: m.id,
    role: m.messageType === 'user' ? 'user' : 'assistant',
    content: contentParts.join('\n\n'),
    thinking,
    timestamp: m.createTime ? new Date(m.createTime).toISOString() : undefined,
  };
}

function toolName(tool: unknown): string | null {
  if (!tool || typeof tool !== 'object') return null;
  const t = tool as Record<string, unknown>;
  const n = t.name ?? t.tool_name ?? t.toolName ?? t.type;
  return typeof n === 'string' ? n : null;
}
