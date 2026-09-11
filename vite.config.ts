import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/userscript/index.ts',
      userscript: {
        name: '聊天会话导出助手',
        namespace: 'chat-export-userscript',
        version: '0.1.0',
        description: '把分享会话导出为 Markdown，可选是否包含思考过程（DeepSeek/WorkBuddy/豆包/Trae/Kimi/元宝/智谱清言）',
        author: 'Chat Export Contributors',
        match: [
          'https://chat.deepseek.com/*',
          'https://*.workbuddy.link/*',
          'https://www.doubao.com/*',
          'https://share.traecontent.cn/*',
          'https://www.kimi.com/share/*',
          'https://kimi.moonshot.cn/share/*',
          'https://yb.tencent.com/s/*',
          'https://chatglm.cn/*',
        ],
        'run-at': 'document-idle',
        grant: [],
      },
      build: {
        fileName: 'chat-export.user.js',
      },
    }),
  ],
});
