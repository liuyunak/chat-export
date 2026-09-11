import type { Conversation, ExportOptions, Message } from './types';

/** 把字符串安全地写入 YAML 引号字符串 */
function yamlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function renderThinking(msg: Message, style: ExportOptions['thinkingStyle']): string {
  const thinking = msg.thinking ?? [];
  if (thinking.length === 0) return '';
  const content = thinking.map((t) => t.content).join('\n\n');
  switch (style) {
    case 'details':
      return `<details>\n<summary>思考过程</summary>\n\n${content}\n\n</details>`;
    case 'blockquote':
      return content
        .split('\n')
        .map((l) => (l.trim() ? `> ${l}` : '>'))
        .join('\n');
    case 'raw':
      return content;
    default:
      return `<details>\n<summary>思考过程</summary>\n\n${content}\n\n</details>`;
  }
}

function renderAttachments(msg: Message): string[] {
  const out: string[] = [];
  for (const a of msg.attachments ?? []) {
    const src = a.dataUrl ?? a.url ?? '';
    if (a.type === 'image') {
      out.push(`![${a.name ?? '图片'}](${src})`);
    } else if (a.type === 'file') {
      out.push(`📎 [${a.name ?? '附件'}](${src})`);
    } else if (a.type === 'link') {
      out.push(`[${a.name ?? src}](${src})`);
    }
  }
  return out;
}

export function renderMessage(msg: Message, opts: ExportOptions): string {
  const lines: string[] = [];
  const label = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : '系统';
  lines.push(`## ${label}`);
  lines.push('');

  if (opts.includeTimestamps && msg.timestamp) {
    lines.push(`*${msg.timestamp}*`);
    lines.push('');
  }

  if (opts.includeThinking && msg.thinking && msg.thinking.length > 0) {
    lines.push(renderThinking(msg, opts.thinkingStyle));
    lines.push('');
  }

  if (msg.content.trim()) {
    lines.push(msg.content);
    lines.push('');
  }

  lines.push(...renderAttachments(msg));
  return lines.join('\n');
}

export function renderMarkdown(conv: Conversation, opts: ExportOptions): string {
  const lines: string[] = [];

  if (opts.includeFrontmatter) {
    lines.push('---');
    lines.push(`title: ${yamlString(conv.title)}`);
    lines.push(`platform: ${conv.platform}`);
    lines.push(`source: ${conv.sourceUrl}`);
    if (conv.model) lines.push(`model: ${yamlString(conv.model)}`);
    if (conv.createdAt) lines.push(`created_at: ${yamlString(conv.createdAt)}`);
    lines.push(`exported_at: ${yamlString(new Date().toISOString())}`);
    lines.push(`include_thinking: ${opts.includeThinking}`);
    lines.push('---');
    lines.push('');
  }

  lines.push(`# ${conv.title}`);
  lines.push('');

  for (const msg of conv.messages) {
    lines.push(renderMessage(msg, opts));
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
