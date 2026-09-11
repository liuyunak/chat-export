import type { Adapter } from './types';
import { deepseekAdapter } from './deepseek';
import { workbuddyAdapter } from './workbuddy';
import { doubaoAdapter } from './doubao';
import { traeAdapter } from './trae';
import { kimiAdapter } from './kimi';
import { yuanbaoAdapter } from './yuanbao';
import { chatglmAdapter } from './chatglm';
import { metasoAdapter } from './metaso';

const adapters: Adapter[] = [
  deepseekAdapter,
  workbuddyAdapter,
  doubaoAdapter,
  traeAdapter,
  kimiAdapter,
  yuanbaoAdapter,
  chatglmAdapter,
  metasoAdapter,
];

/** 根据 URL 找到能处理当前页面的适配器 */
export function findAdapter(url: string): Adapter | undefined {
  return adapters.find((a) => a.detect(url));
}

export { deepseekAdapter } from './deepseek';
export { workbuddyAdapter } from './workbuddy';
export { doubaoAdapter } from './doubao';
export { traeAdapter } from './trae';
export { kimiAdapter } from './kimi';
export { yuanbaoAdapter } from './yuanbao';
export { chatglmAdapter } from './chatglm';
export { metasoAdapter } from './metaso';
export type { Adapter } from './types';
