import { findAdapter } from '../adapters';
import { renderMarkdown } from '../core/render';
import { downloadText, sanitizeFilename } from '../core/download';
import { defaultExportOptions, type ExportOptions } from '../core/types';
import { domSkeleton } from '../core/debug';

const PANEL_ID = 'chat-export-panel';

function injectStyles(): void {
  if (document.getElementById(`${PANEL_ID}-style`)) return;
  const style = document.createElement('style');
  style.id = `${PANEL_ID}-style`;
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      width: 240px;
      padding: 12px;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 6px 24px rgba(0,0,0,.18);
      font: 13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      color: #1f2328;
    }
    #${PANEL_ID} .cex-title { font-weight: 600; margin: 0 0 8px; font-size: 14px; }
    #${PANEL_ID} label { display: flex; align-items: center; gap: 6px; margin: 6px 0; cursor: pointer; }
    #${PANEL_ID} button {
      display: block; width: 100%; margin: 6px 0 0; padding: 8px;
      border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
    }
    #${PANEL_ID} .cex-primary { background: #4d6bfe; color: #fff; }
    #${PANEL_ID} .cex-secondary { background: #f0f2f5; color: #1f2328; }
    #${PANEL_ID} .cex-close {
      position: absolute; top: 6px; right: 8px; background: none; border: none;
      cursor: pointer; font-size: 14px; color: #666; width: auto; margin: 0; padding: 0 4px;
    }
    #${PANEL_ID} .cex-hint { font-size: 11px; color: #888; margin-top: 6px; }
  `;
  document.head.appendChild(style);
}

function toast(msg: string, ok = true): void {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = [
    'position: fixed', 'bottom: 24px', 'left: 50%', 'transform: translateX(-50%)',
    'padding: 10px 16px', 'border-radius: 8px', 'z-index: 2147483647',
    'font: 13px system-ui, "Microsoft YaHei", sans-serif', 'color: #fff',
    `background: ${ok ? '#2ea44f' : '#d1242f'}`,
  ].join(';');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function createPanel(platform: string): void {
  injectStyles();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;

  const title = document.createElement('div');
  title.className = 'cex-title';
  title.textContent = `导出会话（${platform}）`;

  const close = document.createElement('button');
  close.className = 'cex-close';
  close.textContent = '×';
  close.title = '关闭';
  close.addEventListener('click', () => panel.remove());

  const includeThinking = document.createElement('input');
  includeThinking.type = 'checkbox';
  includeThinking.checked = defaultExportOptions.includeThinking;
  const thinkingLabel = document.createElement('label');
  thinkingLabel.append(includeThinking, document.createTextNode('包含思考过程'));

  const exportBtn = document.createElement('button');
  exportBtn.className = 'cex-primary';
  exportBtn.textContent = '导出 Markdown';

  const debugBtn = document.createElement('button');
  debugBtn.className = 'cex-secondary';
  debugBtn.textContent = '复制调试信息';

  const hint = document.createElement('div');
  hint.className = 'cex-hint';
  hint.textContent = '仅用于导出你自己分享的会话';

  panel.append(title, close, thinkingLabel, exportBtn, debugBtn, hint);
  document.body.appendChild(panel);

  exportBtn.addEventListener('click', async () => {
    const adapter = findAdapter(location.href);
    if (!adapter) {
      toast('当前页面不是支持的分享页', false);
      return;
    }
    try {
      const conv = await adapter.extract();
      const opts: ExportOptions = { ...defaultExportOptions, includeThinking: includeThinking.checked };
      const md = renderMarkdown(conv, opts);
      const filename = `${sanitizeFilename(conv.title)}.md`;
      downloadText(filename, md);
      toast(`已导出：${filename}`);
    } catch (err) {
      console.error('[chat-export]', err);
      toast(`导出失败：${(err as Error).message}`, false);
    }
  });

  debugBtn.addEventListener('click', () => {
    const json = JSON.stringify(domSkeleton(), null, 2);
    navigator.clipboard.writeText(json).then(
      () => toast('调试信息已复制到剪贴板'),
      () => {
        console.log('[chat-export debug]\n', json);
        toast('已输出到控制台');
      },
    );
  });
}

function main(): void {
  const adapter = findAdapter(location.href);
  if (!adapter) return;
  createPanel(adapter.platform);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
