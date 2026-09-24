#!/usr/bin/env bash
# LocalPhotoVault 便携包组装脚本
# 用法：bash scripts/pack.sh
#
# 关键：Next.js standalone 的输出追踪（.nft.json）会漏掉两类「动态 require」的依赖，
# 必须手工补齐，否则运行时页面/接口会 500（Cannot find module）：
#   1) node_modules/next/dist/compiled/next-server/*.runtime.prod.js
#   2) node_modules/.prisma/client/*（Prisma 生成客户端 + 查询引擎）
set -euo pipefail
export PATH="/c/Users/q2764/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$PROJ/pack-stage"
SRV="$STAGE/server"
NODE_EXE="${LPV_NODE_EXE:-C:/Users/q2764/.workbuddy/binaries/node/versions/22.22.2-3/node.exe}"
EXE_SRC="$PROJ/src-tauri/target/release/local-photo-vault.exe"

echo "==> 项目: $PROJ"
[ -d "$PROJ/.next/standalone" ] || { echo "缺少 .next/standalone，请先 npm run build"; exit 1; }
[ -f "$EXE_SRC" ] || { echo "缺少桌面壳 exe：$EXE_SRC"; exit 1; }

echo "==> 清理 $SRV"
rm -rf "$SRV"
mkdir -p "$SRV"

echo "==> 复制 standalone（server.js + 裁剪 node_modules + .next）"
cp -r "$PROJ/.next/standalone/." "$SRV/"

echo "==> 复制 .next/static（standalone 不含）"
mkdir -p "$SRV/.next/static"
cp -r "$PROJ/.next/static/." "$SRV/.next/static/"

echo "==> 复制 public"
mkdir -p "$SRV/public"
if [ -d "$PROJ/public" ]; then cp -r "$PROJ/public/." "$SRV/public/" 2>/dev/null || true; fi

echo "==> [补齐] .next/server（standalone 缺 pages/_document 等 chunk，会 500）"
mkdir -p "$SRV/.next/server"
cp -r "$PROJ/.next/server/." "$SRV/.next/server/"

echo "==> [补齐] Next 编译运行时 next-server/*.runtime.prod.js"
mkdir -p "$SRV/node_modules/next/dist/compiled/next-server"
cp -r "$PROJ/node_modules/next/dist/compiled/next-server/." "$SRV/node_modules/next/dist/compiled/next-server/"

echo "==> [补齐] Prisma 生成客户端 + 查询引擎"
mkdir -p "$SRV/node_modules/.prisma"
cp -r "$PROJ/node_modules/.prisma/client" "$SRV/node_modules/.prisma/"
rm -f "$SRV/node_modules/.prisma/client/"*.tmp* 2>/dev/null || true
mkdir -p "$SRV/node_modules/@prisma/client"
cp -r "$PROJ/node_modules/@prisma/client/." "$SRV/node_modules/@prisma/client/"

echo "==> [瘦身] 删除运行时用不到的文件（source map / dev 运行时 / 非 SQLite 引擎）"
# 1) next-server 的 *.map：source map，仅调试用，运行时从不读取（约 15MB）
find "$SRV/node_modules/next/dist/compiled/next-server" -name "*.map" -type f -delete 2>/dev/null || true
# 2) next-server 的 *.dev.js：server.js 顶部已强制 NODE_ENV=production，dev 运行时永不加载
rm -f "$SRV/node_modules/next/dist/compiled/next-server/"*.dev.js 2>/dev/null || true
# 3) Prisma 非 SQLite 的 wasm 查询引擎：本项目 datasource=sqlite，且走原生 library 引擎，wasm.js 不会被加载
rm -f "$SRV/node_modules/@prisma/client/runtime/query_engine_bg.mysql.wasm" 2>/dev/null || true
rm -f "$SRV/node_modules/@prisma/client/runtime/query_engine_bg.postgresql.wasm" 2>/dev/null || true
# 4) Prisma 代码生成器：仅 prisma generate 需要，运行时不加载
rm -rf "$SRV/node_modules/@prisma/client/generator-build" 2>/dev/null || true

echo "==> 复制运行时 node.exe"
cp "$NODE_EXE" "$SRV/node.exe"

echo "==> 生成 run.cmd"
cat > "$SRV/run.cmd" <<'EOF'
@echo off
cd /d "%~dp0"
set "NODE_OPTIONS="
set PORT=8787
set HOSTNAME=0.0.0.0
node.exe server.js
EOF

echo "==> 复制桌面壳 exe 与启动脚本"
cp "$EXE_SRC" "$STAGE/LocalPhotoVault.exe"
cp "$PROJ/packaging/启动LocalPhotoVault.bat" "$STAGE/启动LocalPhotoVault.bat"
cp "$PROJ/packaging/firewall-allow.cmd" "$STAGE/firewall-allow.cmd"
cp "$PROJ/packaging/网络诊断.bat" "$STAGE/网络诊断.bat"

echo "==> 自检：关键依赖是否齐全"
miss=0
for f in \
  "node_modules/.prisma/client/default.js" \
  "node_modules/.prisma/client/index.js" \
  "node_modules/.prisma/client/query_engine-windows.dll.node" \
  "node_modules/next/dist/compiled/next-server/app-route.runtime.prod.js" \
  "node_modules/next/dist/compiled/next-server/server.runtime.prod.js" \
  ".next/server/webpack-runtime.js" \
  ".next/server/pages/_document.js" \
  ".next/server/app/page.js" \
  "node.exe" "server.js" ".next/BUILD_ID"; do
  if [ -e "$SRV/$f" ]; then echo "   OK  $f"; else echo "  缺失 $f"; miss=$((miss+1)); fi
done

# .next/server/chunks 数量必须与项目一致（standalone 会漏 chunk）
src_chunks=$(ls -1 "$PROJ/.next/server/chunks/" 2>/dev/null | wc -l)
dst_chunks=$(ls -1 "$SRV/.next/server/chunks/" 2>/dev/null | wc -l)
if [ "$src_chunks" -eq "$dst_chunks" ]; then
  echo "   OK  .next/server/chunks 数量一致（$dst_chunks）"
else
  echo "  缺失 .next/server/chunks 数量不一致：项目 $src_chunks / 包内 $dst_chunks"
  miss=$((miss+1))
fi

[ "$miss" -eq 0 ] || { echo "!! 有 $miss 项缺失/不一致"; exit 1; }

echo "==> 自检：瘦身是否生效"
nsrv="$SRV/node_modules/next/dist/compiled/next-server"
map_n=$(find "$nsrv" -name "*.map" -type f 2>/dev/null | wc -l)
dev_n=$(find "$nsrv" -name "*.dev.js" -type f 2>/dev/null | wc -l)
[ "$map_n" -eq 0 ] && echo "   OK  next-server 无 .map 残留" || { echo "  残留 .map：$map_n"; miss=$((miss+1)); }
[ "$dev_n" -eq 0 ] && echo "   OK  next-server 无 .dev.js 残留" || { echo "  残留 .dev.js：$dev_n"; miss=$((miss+1)); }
[ -f "$nsrv/app-route.runtime.prod.js" ] && echo "   OK  prod 运行时保留" || { echo "  prod 运行时丢失"; miss=$((miss+1)); }
[ "$miss" -eq 0 ] || { echo "!! 瘦身自检失败"; exit 1; }

echo "==> 包体积：$(du -sh "$STAGE" 2>/dev/null | cut -f1)"
echo "==> 完成：$STAGE"
