#!/usr/bin/env node
/**
 * 把 GitHub Release 的产物同步到 Gitee 和 AtomGit（这两家的 Release 不会自动生成）。
 *
 * 前提：标签已推送且 GitHub CI 已完成（Actions 已构建出 Release 资产）。
 * 用法：node scripts/publish-release.mjs v0.2.0
 *
 * 流程：以 GitHub Release 资产为准 → 下载 → Gitee 建 Release + attach_files 上传
 *       → AtomGit 建 Release + upload_url 预签名 PUT 上传（x-obs-* 头必须原样回传）。
 * 依赖：git（凭据管理器已存三平台 token）、node 18+。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TAG = process.argv[2];
if (!TAG) {
  console.error('用法: node scripts/publish-release.mjs <tag>，如 v0.2.0');
  process.exit(1);
}

const GH_OWNER = 'liuyunak';
const GITEE_OWNER = 'ikeer_1_ligui880213';
const AG_OWNER = 'liuyunak';
const REPO = 'chat-export';

const NOTES = [
  '## 安装',
  '',
  '- **油猴脚本**：下载 `chat-export.user.js`，在 Tampermonkey 中新建脚本粘贴内容',
  '- **浏览器扩展**：下载 `chat-export-extension.zip` 解压，扩展管理页开启开发者模式后「加载已解压的扩展程序」',
  '',
  '支持平台与变更说明见 README。',
].join('\n');

const credential = (host) =>
  execSync(`git credential fill`, { input: `protocol=https\nhost=${host}\n\n`, encoding: 'utf8' })
    .split('\n')
    .find((l) => l.startsWith('password='))
    ?.slice('password='.length);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relsync-'));
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
process.on('exit', cleanup);

async function main() {
  // 1. 下载 GitHub Release 资产
  const ghToken = credential('github.com');
  console.log('==> 1/4 下载 GitHub Release 资产');
  const ghResp = await fetch(`https://api.github.com/repos/${GH_OWNER}/${REPO}/releases/tags/${TAG}`, {
    headers: { Authorization: `token ${ghToken}` },
  });
  const ghRel = await ghResp.json();
  if (!ghRel.assets?.length) {
    throw new Error('GitHub 上没有该 tag 的 Release 资产（CI 可能还没跑完，稍后再试）');
  }
  const files = [];
  for (const a of ghRel.assets) {
    const r = await fetch(a.url, {
      headers: { Authorization: `token ${ghToken}`, Accept: 'application/octet-stream' },
    });
    if (!r.ok) throw new Error(`下载 ${a.name} 失败: HTTP ${r.status}`);
    const p = path.join(tmp, a.name);
    fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
    files.push(p);
    console.log(`  ${a.name} (${a.size} bytes)`);
  }

  // 2. Gitee：建 Release + attach_files 上传
  console.log('==> 2/4 Gitee Release');
  const gt = credential('gitee.com');
  const gCreate = await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: gt,
      tag_name: TAG,
      target_commitish: 'main',
      name: TAG,
      body: NOTES,
      prerelease: false,
    }),
  });
  const gRel = await gCreate.json();
  if (!gCreate.ok && !/already exist/i.test(gRel.message ?? '')) {
    throw new Error(`Gitee 建 Release 失败: HTTP ${gCreate.status} ${JSON.stringify(gRel).slice(0, 200)}`);
  }
  // attach_files 需要数字 release id：新建时返回；已存在时按 tag 反查
  let gId = gRel.id;
  if (!gId) {
    const r = await fetch(
      `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${REPO}/releases/tags/${TAG}?access_token=${gt}`,
    );
    gId = (await r.json()).id;
  }
  console.log(`  release id: ${gId}`);
  for (const f of files) {
    const fd = new FormData();
    fd.append('access_token', gt);
    fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
    const r = await fetch(
      `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${REPO}/releases/${gId}/attach_files`,
      { method: 'POST', body: fd },
    );
    if (!r.ok) throw new Error(`Gitee 上传 ${path.basename(f)} 失败: HTTP ${r.status}`);
    console.log(`  ${path.basename(f)} ✓`);
  }

  // 3. AtomGit：建 Release + upload_url 预签名 PUT（x-obs-* 头原样回传，缺了附件不生效）
  console.log('==> 3/4 AtomGit Release');
  const at = credential('atomgit.com');
  const aH = { Authorization: `Bearer ${at}` };
  const aCreate = await fetch(`https://atomgit.com/api/v5/repos/${AG_OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { ...aH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: TAG,
      target_commitish: 'main',
      name: TAG,
      body: NOTES,
      prerelease: false,
    }),
  });
  if (!aCreate.ok) {
    const t = await aCreate.text();
    if (!/exist/i.test(t)) throw new Error(`AtomGit 建 Release 失败: HTTP ${aCreate.status} ${t.slice(0, 200)}`);
  }
  for (const f of files) {
    const name = path.basename(f);
    const up = await (
      await fetch(
        `https://atomgit.com/api/v5/repos/${AG_OWNER}/${REPO}/releases/${TAG}/upload_url?file_name=${encodeURIComponent(name)}`,
        { headers: aH },
      )
    ).json();
    if (!up.url) throw new Error(`AtomGit 取上传地址失败: ${JSON.stringify(up).slice(0, 200)}`);
    const r = await fetch(up.url, {
      method: 'PUT',
      headers: up.headers, // 含 x-obs-callback 等签名头，必须原样回传
      body: fs.readFileSync(f),
    });
    if (!r.ok) throw new Error(`AtomGit 上传 ${name} 失败: HTTP ${r.status}`);
    console.log(`  ${name} ✓`);
  }

  console.log(`==> 4/4 完成：${TAG} 已同步到 Gitee 与 AtomGit（含安装包）`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
