import type { Conversation } from '../core/types';

/**
 * 平台适配器接口。
 * 每个平台实现一个文件，放进 src/adapters/ 并注册到 index.ts。
 * 编写步骤见 docs/adapter-guide.md。
 */
export interface Adapter {
  /** 平台标识，写入导出文件的 frontmatter */
  platform: string;
  /** 根据当前 URL 判断是否由本适配器处理 */
  detect(url: string): boolean;
  /** 从当前页面提取会话；同步或异步均可 */
  extract(): Conversation | Promise<Conversation>;
}
