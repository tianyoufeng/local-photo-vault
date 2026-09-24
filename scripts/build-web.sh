#!/usr/bin/env bash
# LocalPhotoVault Web 端构建（prisma generate + next build）
# 用法：bash scripts/build-web.sh
set -euo pipefail
export PATH="/c/Users/q2764/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${LPV_NODE:-C:/Users/q2764/.workbuddy/binaries/node/versions/22.22.2-3/node.exe}"
cd "$PROJ"

echo "==> prisma generate"
env -u NODE_OPTIONS CODEBUDDY_SAFE_DELETE_ENABLED=0 "$NODE" node_modules/prisma/build/index.js generate

echo "==> next build"
env -u NODE_OPTIONS CODEBUDDY_SAFE_DELETE_ENABLED=0 "$NODE" node_modules/next/dist/bin/next build

echo "==> 构建完成"
cat .next/BUILD_ID
