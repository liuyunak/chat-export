import type { Conversation, Message, ThinkingBlock } from '../core/types';
import type { Adapter } from './types';

/**
 * Trae（TraeWork / 字节 AI 办公）分享页适配器。
 *
 * 分享链接：https://share.traecontent.cn/share/{shareId}?enter_from=pc
 * 无需登录态。数据来自同源公开接口（从页面 Network 观察得到）：
 *   GET /api/remote/v1/share/{id}                     -> 标题 / 作者 / 创建时间
 *   GET /api/remote/v1/share/{id}/messages?page_size=100[&page_token=]
 *                                                     -> data.items + next_page_token + has_more
 *
 * 消息结构（items[]）：
 *   role: "user" | "assistant"；created_at 为 ISO 字符串；message_index 排序。
 *   content 是 JSON 字符串：
 *     user:      [{"type":"text","text_content":"..."}]
 *     assistant: { task_id, messages: [ { type:"plan_item", plan_item:{
 *                    agent_display_name, reasoning_content,      // 思考过程
 *                    tool_call_info: { name, params, result }    // 工具步骤
 *                }}] }
 *   最终报告在 finish 工具的 tool_call_info.params.summary 里；
 *   其余工具步骤（如 WebSearch）以摘要形式保留。
 */

interface TraeShareInfo {
  code?: number;
  data?: {
    title?: string;
    creator_name?: string;
    created_at?: string;
    mode?: string;
    share_session_id?: string;
  };
}

interface TraeToolCall {
  name?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

interface TraePlanItem {
  agent_display_name?: string;
  reasoning_content?: string;
  tool_call_info?: TraeToolCall;
}

interface TraeItem {
  role?: string;
  content?: string;
  created_at?: string;
  message_index?: number;
  message_type?: string;
}

interface TraeMessagesResp {
  code?: number;
  data?: {
    items?: TraeItem[];
    next_page_token?: string;
    has_more?: boolean;
  };
}

export const traeAdapter: Adapter = {
  platform: 'trae',
  detect(url: string): boolean {
    return /share\.traecontent\.cn\/share\/[A-Za-z0-9_-]+/.test(url);
  },
  async extract(): Promise<Conversation> {
    const shareId = extractShareId(location.href);
    if (!shareId) throw new Error('无法从链接解析分享 ID');

    const share = (await getJson(`/api/remote/v1/share/${shareId}`)) as TraeShareInfo;
    if (share.code !== 0 || !share.data) throw new Error(`分享不存在或已失效（code=${share.code}）`);

    const items = await fetchAllMessages(shareId);
    return mapTraeData(shareId, location.href, share.data, items);
  },
};

function extractShareId(url: string): string | null {
  return url.match(/\/share\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

async function getJson(url: string): Promise<unknown> {
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status} ${url}`);
  return resp.json();
}

async function fetchAllMessages(shareId: string): Promise<TraeItem[]> {
  const all: TraeItem[] = [];
  let pageToken: string | undefined;
  // 有 next_page_token 就翻页，防御性上限 20 页
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ page_size: '100' });
    if (pageToken) q.set('page_token', pageToken);
    const resp = (await getJson(`/api/remote/v1/share/${shareId}/messages?${q}`)) as TraeMessagesResp;
    if (resp.code !== 0 || !resp.data) throw new Error(`消息接口异常（code=${resp.code}）`);
    all.push(...(resp.data.items ?? []));
    if (!resp.data.has_more || !resp.data.next_page_token) break;
    pageToken = resp.data.next_page_token;
  }
  return all.sort((a, b) => (a.message_index ?? 0) - (b.message_index ?? 0));
}

/** 纯函数：把 trae 接口数据映射为统一 Conversation（便于测试） */
export function mapTraeData(
  shareId: string,
  sourceUrl: string,
  shareInfo: NonNullable<TraeShareInfo['data']>,
  items: TraeItem[],
): Conversation {
  let agentName: string | undefined;
  const messages = items.map((it, idx) => {
    const m = toMessage(it, idx);
    if (!agentName) agentName = m.agentName;
    return m.message;
  });

  return {
    id: shareId,
    title: shareInfo.title?.trim() || '未命名会话',
    platform: 'trae',
    sourceUrl,
    model: agentName ?? 'TraeWork',
    createdAt: shareInfo.created_at ?? items[0]?.created_at,
    messages,
  };
}

function toMessage(
  it: TraeItem,
  idx: number,
): { message: Message; agentName?: string } {
  if (it.role === 'user') {
    return {
      message: {
        id: String(idx),
        role: 'user',
        content: userText(it.content),
        timestamp: it.created_at,
      },
    };
  }

  const thinking: ThinkingBlock[] = [];
  const toolNotes: string[] = [];
  let answer = '';
  let answerTool = '';
  let agentName: string | undefined;

  const plan = parsePlanItems(it.content);
  for (const p of plan) {
    if (!agentName && p.agent_display_name) agentName = p.agent_display_name;
    if (p.reasoning_content?.trim()) {
      thinking.push({ title: '深度思考', content: p.reasoning_content.trim() });
    }
    const tool = p.tool_call_info;
    if (!tool?.name) continue;
    const summary = typeof tool.params?.summary === 'string' ? tool.params.summary : undefined;
    if (summary && (!answer || summary.length > answer.length)) {
      // finish 步骤的 summary 即最终报告；若此前已有别的 summary 被当过答案，补一条备注
      if (answer && answerTool) toolNotes.push(`> 🔧 调用工具：\`${answerTool}\``);
      answer = summary;
      answerTool = tool.name;
      continue;
    }
    const query = typeof tool.params?.query === 'string' ? tool.params.query : undefined;
    toolNotes.push(query ? `> 🔧 调用工具：\`${tool.name}\`（${query}）` : `> 🔧 调用工具：\`${tool.name}\``);
  }

  return {
    agentName,
    message: {
      id: String(idx),
      role: 'assistant',
      // 按时间顺序：先工具步骤，后最终报告
      content: [toolNotes.join('\n\n'), answer].filter((s) => s.trim()).join('\n\n'),
      thinking,
      timestamp: it.created_at,
    },
  };
}

function parsePlanItems(content: string | undefined): TraePlanItem[] {
  if (!content) return [];
  try {
    const c = JSON.parse(content) as { messages?: { type?: string; plan_item?: TraePlanItem }[] };
    return (c.messages ?? []).map((m) => m.plan_item).filter((p): p is TraePlanItem => !!p);
  } catch {
    return [];
  }
}

function userText(content: string | undefined): string {
  if (!content) return '';
  try {
    const blocks = JSON.parse(content) as { type?: string; text_content?: string }[];
    return blocks
      .map((b) => b.text_content ?? '')
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return content;
  }
}
