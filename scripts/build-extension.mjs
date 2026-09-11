/**
 * 构建 MV3 扩展：dist/extension/（可直接「加载已解压的扩展程序」）
 * 可选：系统有 zip / PowerShell 时同时产出 dist/chat-export-extension.zip
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'dist', 'extension');

fs.mkdirSync(outDir, { recursive: true });

// 1. 打包内容脚本（与油猴同一入口逻辑）
await build({
  entryPoints: [path.join(root, 'src/extension/content.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['chrome111'],
  outfile: path.join(outDir, 'chat-export-content.js'),
  logLevel: 'info',
});

// 2. 生成 manifest（版本号与 package.json 同步，避免漂移）
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tpl = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.template.json'), 'utf8'));
tpl.version = pkg.version;
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(tpl, null, 2)}\n`);

// 3. 打 zip（尽力而为：有 zip 用 zip，Windows 回退 PowerShell）
const zipPath = path.join(root, 'dist', 'chat-export-extension.zip');
let zipped = false;
try {
  execSync(`cd "${outDir}" && zip -qr "${zipPath}" .`, { stdio: 'pipe' });
  zipped = true;
} catch {
  try {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'pipe' },
    );
    zipped = true;
  } catch {
    console.log('（未找到 zip / PowerShell，跳过打包，dist/extension/ 目录可直接侧载）');
  }
}

console.log(`✓ 扩展构建完成: dist/extension/ (v${pkg.version})${zipped ? ` + dist/chat-export-extension.zip` : ''}`);
