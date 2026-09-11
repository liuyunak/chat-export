export type Role = 'user' | 'assistant' | 'system';

/** 思考过程块（DeepSeek R1 深度思考等） */
export interface ThinkingBlock {
  /** 思考块的标题，例如「深度思考」 */
  title?: string;
  content: string;
}

export interface Attachment {
  type: 'image' | 'file' | 'link';
  name?: string;
  url?: string;
  /** 图片的内联数据（data URL），优先于 url 使用 */
  dataUrl?: string;
}

export interface Message {
  id: string;
  role: Role;
  /** 正文，已转为 Markdown 文本 */
  content: string;
  /** 思考过程，导出时可按开关决定是否包含 */
  thinking?: ThinkingBlock[];
  /** ISO 8601 时间戳 */
  timestamp?: string;
  attachments?: Attachment[];
}

export interface Conversation {
  id: string;
  title: string;
  /** 平台标识，如 deepseek / kimi / doubao */
  platform: string;
  /** 分享链接原始地址 */
  sourceUrl: string;
  /** 模型名（若能识别） */
  model?: string;
  /** 会话创建时间 */
  createdAt?: string;
  messages: Message[];
}

export interface ExportOptions {
  /** 是否包含思考过程 */
  includeThinking: boolean;
  /** 是否包含时间戳 */
  includeTimestamps: boolean;
  /** 是否输出 YAML frontmatter */
  includeFrontmatter: boolean;
  /** 思考过程的渲染方式 */
  thinkingStyle: 'details' | 'blockquote' | 'raw';
  /** 预留：是否把远程图片下载并内联为 base64（尚未实现） */
  downloadImages: boolean;
}

export const defaultExportOptions: ExportOptions = {
  includeThinking: true,
  includeTimestamps: true,
  includeFrontmatter: true,
  thinkingStyle: 'details',
  downloadImages: false,
};
