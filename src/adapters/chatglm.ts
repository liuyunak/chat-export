import type { Conversation, Message, ThinkingBlock } from '../core/types';
import type { Adapter } from './types';

/**
 * 智谱清言（ChatGLM）分享页适配器。
 *
 * 分享链接两种形态（等价，会互相跳转）：
 *   https://chatglm.cn/share/{shareId}
 *   https://chatglm.cn/glmsShare?...&share_conversation_id={id}&share_id=...
 *
 * 数据接口 /chatglm/share-api/conversation/info/{id} 带 X-Sign 请求签名
 * （时间戳+nonce+sign 防重放），不直接复刻；分享页为 Vue3 + Vuex 应用，
 * 渲染后的完整会话数据就在内存 store 里：
 *   #app.__vue_app__.config.globalProperties.$store.state.Conversation.dataList
 *
 * dataList[] 每轮对话：
 *   question     用户提问
 *   answerArray[] 回答序列，按 answer_type 判别：
 *     "text"       {answer, model, citations, searchPages, thinkList}  正文与元数据
 *     "tool_calls"/"tool_result"  工具步骤（分享数据不含明细，汇总提示）
 *   thinkList    思考过程（本轮级；单条回答项上也有同名字段）
 */

interface CGAnswerItem {
  answer_type?: string;
  answer?: string;
  model?: string;
  thinkList?: unknown[];
  citations?: unknown[];
  searchPages?: unknown[];
  [k: string]: unknown;
}

interface CGDataListItem {
  question?: string;
  answerArray?: CGAnswerItem[];
  thinkList?: unknown[];
  date_text?: string;
}

interface CGStoreData {
  assistantInfo?: { name?: string };
  dataList?: CGDataListItem[];
}

const STORE_PATH_ERROR =
  '未找到智谱清言分享数据（store 路径变化或页面未加载完成）。请点「复制调试信息」并把结果贴到 issue。';

export const chatglmAdapter: Adapter = {
  platform: 'chatglm',
  detect(url: string): boolean {
    return /chatglm\.cn\/(share\/[A-Za-z0-9]+|glmsShare\?)/.test(url);
  },
  extract(): Conversation {
    const data = readStoreData();
    if (!data || !data.dataList?.length) throw new Error(STORE_PATH_ERROR);
    return mapChatglmData(data, location.href);
  },
};

function readStoreData(): CGStoreData | null {
  try {
    // __vue_app__ 是 Vue3 挂在根元素上的内部属性，需绕过类型
    const appEl = document.querySelector('#app') as (Element & { __vue_app__?: never }) | null;
    const app = appEl?.__vue_app__ as unknown as {
      config?: { globalProperties?: { $store?: { state?: { Conversation?: { dataList?: CGDataListItem[] } } } } };
    };
    const gp = app?.config?.globalProperties;
    const conv = gp?.$store?.state?.Conversation;
    if (!conv?.dataList) return null;
    const glms = (gp!.$store!.state as unknown as { Glms?: { assistantInfo?: { name?: string } } }).Glms;
    return { dataList: conv.dataList, assistantInfo: glms?.assistantInfo };
  } catch {
    return null;
  }
}

/** 纯函数：把智谱清言内存数据映射为统一 Conversation（便于测试） */
export function mapChatglmData(data: CGStoreData, sourceUrl: string): Conversation {
  const rounds = data.dataList ?? [];
  const messages: Message[] = [];
  let model: string | undefined;

  for (const [idx, round] of rounds.entries()) {
    if (round.question?.trim()) {
      messages.push({ id: `u${idx}`, role: 'user', content: round.question });
    }

    const contentParts: string[] = [];
    const thinking: ThinkingBlock[] = [];
    let toolStepCount = 0;

    // 思考：本轮级 thinkList + 各回答项自己的 thinkList
    collectThinking(round.thinkList, thinking);
    for (const a of round.answerArray ?? []) {
      if (a.answer_type === 'text') {
        if (a.answer?.trim()) contentParts.push(a.answer);
        if (!model && a.model) model = a.model;
        collectThinking(a.thinkList, thinking);
        renderRefs(a, contentParts);
      } else if (a.answer_type === 'tool_calls' || a.answer_type === 'tool_result') {
        toolStepCount++;
      } else if (a.answer_type) {
        contentParts.push(`> _（未导出的内容块：${a.answer_type}）_`);
      }
    }
    if (toolStepCount > 0) {
      contentParts.unshift(`> 🔧 含 ${toolStepCount} 个工具/搜索步骤（分享数据未含明细）`);
    }

    if (contentParts.length || thinking.length) {
      messages.push({ id: `a${idx}`, role: 'assistant', content: contentParts.join('\n\n'), thinking });
    }
  }

  const firstQ = rounds.find((r) => r.question?.trim())?.question?.trim();
  const title = firstQ ? (firstQ.length > 30 ? `${firstQ.slice(0, 30)}…` : firstQ) : `与 ${data.assistantInfo?.name || 'ChatGLM'} 的对话`;

  return {
    id: sourceUrl.match(/share_conversation_id=([A-Za-z0-9]+)/)?.[1]
      ?? sourceUrl.match(/\/share\/([A-Za-z0-9]+)/)?.[1]
      ?? 'unknown',
    title,
    platform: 'chatglm',
    sourceUrl,
    model,
    messages,
  };
}

function collectThinking(list: unknown[] | undefined, out: ThinkingBlock[]): void {
  for (const item of list ?? []) {
    const text = textOf(item);
    if (text) out.push({ title: '深度思考', content: text });
  }
}

function renderRefs(a: CGAnswerItem, out: string[]): void {
  const refs = [...(a.searchPages ?? []), ...(a.citations ?? [])];
  if (refs.length === 0) return;
  const lines: string[] = ['> 🔍 **引用来源**：'];
  for (const r of refs) {
    const o = r as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title : undefined;
    const url = typeof o.url === 'string' ? o.url : typeof o.link === 'string' ? o.link : undefined;
    if (title && url) lines.push(`> - [${title}](${url})`);
  }
  if (lines.length > 1) out.push(lines.join('\n'));
}

function textOf(v: unknown, depth = 0): string | null {
  if (depth > 3 || v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => textOf(x, depth + 1)).filter(Boolean) as string[];
    return parts.length ? parts.join('\n') : null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const key of ['content', 'reasoning_content', 'text', 'msg', 'think']) {
      if (key in o) {
        const t = textOf(o[key], depth + 1);
        if (t) return t;
      }
    }
  }
  return null;
}
