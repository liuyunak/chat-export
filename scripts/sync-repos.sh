#!/usr/bin/env bash
# 三仓推送：GitHub（主仓）+ Gitee + AtomGit（国内镜像）
#
# 首次使用前，先在三个平台创建空仓库，然后配置 remote（替换成你自己的地址）：
#   git remote add github  git@github.com:<you>/chat-export.git
#   git remote add gitee   git@gitee.com:<you>/chat-export.git
#   git remote add atomgit git@atomgit.com:<you>/chat-export.git
#
# 之后每次发布：
#   ./scripts/sync-repos.sh          # 推 main + tags 到三仓
#   ./scripts/sync-repos.sh v0.1.0   # 额外在 GitHub 上触发 Release（推标签即触发 CI）

set -e
cd "$(dirname "$0")/.."

TAG="$1"

for remote in github gitee atomgit; do
  if git remote get-url "$remote" >/dev/null 2>&1; then
    echo "==> 推送 $remote"
    git push "$remote" main --tags --follow-tags
  else
    echo "!! 未配置 remote: $remote（见脚本头部说明）"
  fi
done

if [ -n "$TAG" ]; then
  echo "==> 标签 $TAG 已推送；GitHub Actions 会自动构建并发布 Release"
  echo "    （Gitee/AtomGit 如需同步 Release，请在其平台设置里开启从 GitHub 同步，或手动上传 dist/ 产物）"
fi
