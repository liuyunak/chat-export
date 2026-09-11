import type { Conversation, Message } from '../core/types';
import type { Adapter } from './types';

/**
 * 适配器模板：复制本文件重命名为 {platform}.ts 并修改。
 * 完成后在 src/adapters/index.ts 中注册。
 *
 * 步骤概览：
 *   1. 打开目标平台的分享页，用「复制调试信息」拿到 DOM 骨架；
 *   2. 确定消息容器 / 角色 / 正文 / 思考过程的选择器；
 *   3. 把 DOM 提取结果映射为统一的 Conversation / Message；
 *   4. 在 index.ts 注册，构建即可在对应页面生效。
 */
export const templateAdapter: Adapter = {
  platform: 'example',
  detect(url: string): boolean {
    // 例如：return url.includes('example.com') && url.includes('/share/');
    return false;
  },
  extract(): Conversation {
    return {
      id: '',
      title: extractTitle(),
      platform: 'example',
      sourceUrl: location.href,
      messages: extractMessages(),
    };
  },
};

function extractTitle(): string {
  // TODO: 从标题元素取，回退到 document.title
  return document.title.trim() || '未命名会话';
}

function extractMessages(): Message[] {
  // TODO: 遍历消息容器，逐条提取角色 / 正文 / 思考过程
  return [];
}
