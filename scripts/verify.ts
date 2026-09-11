/**
 * 端到端验证脚本：拉取/解析真实分享数据 → 映射 → 渲染 Markdown。
 * 用法：
 *   npx tsx scripts/verify.ts deepseek <share_id>
 *   npx tsx scripts/verify.ts workbuddy <node_id>
 *   npx tsx scripts/verify.ts doubao <本地已保存的分享页 HTML 文件路径>
 * 产物：samples/{platform}-with-thinking.md / {platform}-no-thinking.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Conversation } from '../src/core/types';
import { defaultExportOptions } from '../src/core/types';
import { mapShareData as mapDeepSeek } from '../src/adapters/deepseek';
import { mapWBData } from '../src/adapters/workbuddy';
import { mapDoubaoShare } from '../src/adapters/doubao';
import { mapTraeData } from '../src/adapters/trae';
import { mapKimiShare } from '../src/adapters/kimi';
import { mapYuanbaoShare } from '../src/adapters/yuanbao';
import { mapChatglmData } from '../src/adapters/chatglm';
import { mapMetasoData } from '../src/adapters/metaso';
import { renderMarkdown } from '../src/core/render';

async function fetchJson(url: string, referer: string): Promise<unknown> {
  const resp = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', referer } });
  if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status} ${url}`);
  return resp.json();
}

async function getConversation(platform: string, arg: string): Promise<Conversation> {
  if (platform === 'deepseek') {
    const sourceUrl = `https://chat.deepseek.com/share/${arg}`;
    const json = (await fetchJson(
      `https://chat.deepseek.com/api/v0/share/content?share_id=${encodeURIComponent(arg)}`,
      sourceUrl,
    )) as { code: number; data?: { biz_code: number; biz_data: Parameters<typeof mapDeepSeek>[2] } };
    if (json.code !== 0 || json.data?.biz_code !== 0) {
      throw new Error(`分享不存在或已失效（biz_code=${json.data?.biz_code}）`);
    }
    return mapDeepSeek(arg, sourceUrl, json.data!.biz_data);
  }
  if (platform === 'workbuddy') {
    const sourceUrl = `https://www.workbuddy.link/p/${arg}`;
    const json = (await fetchJson(
      `https://workbuddy-space-static.codebuddy.work/page/${arg}/0/conversation-data.json`,
      sourceUrl,
    )) as Parameters<typeof mapWBData>[1];
    return mapWBData(sourceUrl, json);
  }
  if (platform === 'doubao') {
    // 豆包数据内嵌在 HTML，且线上页面对 curl 有反爬，故用本地已保存的 HTML 文件验证
    const html = readFileSync(arg, 'utf8');
    const htmlDecode = (s: string) =>
      s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const re = /data-fn-name="mergeLoaderData"\s+data-fn-args="([^"]*)"/g;
    for (const m of html.matchAll(re)) {
      let outer: unknown;
      try {
        outer = JSON.parse(htmlDecode(m[1]));
      } catch {
        continue;
      }
      const loaders = (outer as unknown[])[1];
      if (!Array.isArray(loaders)) continue;
      const share = (loaders as { key?: string; routerDataFnArgs?: string[] }[]).find((x) => x.key === 'shareInfo');
      const a = share?.routerDataFnArgs?.[0];
      if (typeof a === 'string') {
        const inner = JSON.parse(a) as Parameters<typeof mapDoubaoShare>[0];
        const shareId = inner?.data?.share_info?.share_id ?? 'unknown';
        return mapDoubaoShare(inner, `https://www.doubao.com/thread/${shareId}`);
      }
    }
    throw new Error('HTML 中未找到豆包分享数据');
  }
  if (platform === 'trae') {
    const base = 'https://share.traecontent.cn';
    const sourceUrl = `${base}/share/${arg}`;
    const share = (await fetchJson(`${base}/api/remote/v1/share/${arg}`, sourceUrl)) as {
      code: number;
      data: Parameters<typeof mapTraeData>[2];
    };
    if (share.code !== 0 || !share.data) throw new Error(`分享不存在或已失效（code=${share.code}）`);

    const items: Parameters<typeof mapTraeData>[3] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ page_size: '100' });
      if (pageToken) q.set('page_token', pageToken);
      const resp = (await fetchJson(
        `${base}/api/remote/v1/share/${arg}/messages?${q}`,
        sourceUrl,
      )) as {
        code: number;
        data: { items: Parameters<typeof mapTraeData>[3]; next_page_token?: string; has_more?: boolean };
      };
      if (resp.code !== 0 || !resp.data) throw new Error(`消息接口异常（code=${resp.code}）`);
      items.push(...resp.data.items);
      pageToken = resp.data.has_more ? resp.data.next_page_token : undefined;
    } while (pageToken);

    return mapTraeData(arg, sourceUrl, share.data, items);
  }
  if (platform === 'kimi') {
    const sourceUrl = `https://www.kimi.com/share/${arg}`;
    const resp = await fetch('https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/GetChatShare', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', referer: sourceUrl },
      body: JSON.stringify({ share_id: arg }),
    });
    if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status}`);
    const json = (await resp.json()) as { share?: Parameters<typeof mapKimiShare>[0] };
    if (!json.share) throw new Error('分享不存在或已失效');
    return mapKimiShare(json.share, sourceUrl);
  }
  if (platform === 'yuanbao') {
    const sourceUrl = `https://yb.tencent.com/s/${arg}`;
    const resp = await fetch(sourceUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0' },
    });
    if (!resp.ok) throw new Error(`页面请求失败：HTTP ${resp.status}`);
    const html = await resp.text();
    const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!m) throw new Error('HTML 中未找到 __NEXT_DATA__');
    const nextData = JSON.parse(m[1]) as {
      props?: { pageProps?: { fullChatShareData?: Parameters<typeof mapYuanbaoShare>[0] } };
    };
    const data = nextData.props?.pageProps?.fullChatShareData;
    if (!data?.chat) throw new Error('HTML 中未找到 fullChatShareData');
    return mapYuanbaoShare(data, sourceUrl);
  }
  if (platform === 'chatglm') {
    // 智谱清言数据在页面内存（接口带 X-Sign 签名），用导出的本地 JSON 验证
    const data = JSON.parse(readFileSync(arg, 'utf8')) as Parameters<typeof mapChatglmData>[0];
    return mapChatglmData(data, data.sourceUrl ?? 'https://chatglm.cn/share/unknown');
  }
  if (platform === 'metaso') {
    // argv: [node, tsx, metaso, conversationId, shareKey]
    const shareKey = process.argv[4];
    if (!shareKey) {
      throw new Error('用法: npx tsx scripts/verify.ts metaso <conversationId> <shareKey>');
    }
    const sourceUrl = `https://metaso.cn/chat/${arg}?shareType=15&ssi=${shareKey}`;
    const resp = await fetch(
      `https://metaso.cn/api/conversation/${arg}/branched-messages?shareKey=${encodeURIComponent(shareKey)}&shareType=15`,
      { headers: { 'user-agent': 'Mozilla/5.0', referer: sourceUrl } },
    );
    if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status}`);
    const json = (await resp.json()) as { errCode?: number; data?: Parameters<typeof mapMetasoData>[0] };
    if (json.errCode !== 0 || !json.data) throw new Error(`分享不存在或已失效（errCode=${json.errCode}）`);
    return mapMetasoData(json.data, sourceUrl);
  }
  throw new Error(`未知平台：${platform}`);
}

async function main(): Promise<void> {
  const [platform, id] = process.argv.slice(2);
  if (!platform || !id) {
    console.error('用法: npx tsx scripts/verify.ts <deepseek|workbuddy|doubao> <id 或 HTML 文件路径>');
    process.exit(1);
  }

  const conv = await getConversation(platform, id);
  const withThinking = renderMarkdown(conv, defaultExportOptions);
  const withoutThinking = renderMarkdown(conv, { ...defaultExportOptions, includeThinking: false });

  mkdirSync('samples', { recursive: true });
  writeFileSync(`samples/${platform}-with-thinking.md`, withThinking, 'utf8');
  writeFileSync(`samples/${platform}-no-thinking.md`, withoutThinking, 'utf8');

  console.log(`平台    : ${conv.platform}`);
  console.log(`标题    : ${conv.title}`);
  console.log(`消息数  : ${conv.messages.length}`);
  console.log(`含思考  : ${withThinking.length} 字 -> samples/${platform}-with-thinking.md`);
  console.log(`不含思考: ${withoutThinking.length} 字 -> samples/${platform}-no-thinking.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
