# 更新日志

## v1.0 修订（2026-09-24）—— 便携包与局域网访问修复

### 修复
- **便携包内页面/接口全部 500**：Next `output: standalone` 的依赖追踪（`.nft.json`）会漏掉「运行时才拼路径」的动态 require，导致 `Cannot find module '.prisma/client/default'` 与 `next/dist/compiled/next-server/app-route.runtime.prod.js`。打包时改为补齐：完整 `.prisma/client`（含查询引擎 DLL）、完整 `@prisma/client`、完整 `next-server/`、以及全量 `.next/server`（standalone 会漏 `chunks/*` 与 `pages/_document.js`）。
- **退出后 node 残留、下次启动复用旧版本服务**：旧壳只 spawn `cmd /C run.cmd` 且只杀 `cmd`，`node.exe` 继续占着 8787，下次启动被复用 → 即使重新打包也仍是 500。重写 Tauri 壳：直接 spawn `server\node.exe server.js`，退出时 `taskkill /PID <pid> /T /F` 杀整棵进程树，启动前先做健康握手。

### 新增
- **`/api/health` 健康握手**：返回 `{app, version, buildId, pid}`，壳启动前比对 `buildId`，一致则复用、不一致则先清旧进程再启动。
- **启动脚本自动放行防火墙**：`启动LocalPhotoVault.bat` 首次运行以 UAC 提权补一条**按端口 8787 放行**的规则（`profile=any`，与安装路径无关）。Windows 自动创建的「允许应用」规则是按 **exe 完整路径**放行的，换个目录就失效——端口级规则可避免这个坑。
- **`网络诊断.bat`**：一键列出本机 IP / 8787 监听状态 / 防火墙规则 / 网络位置 / 残留进程，并给出排查提示。
- 启动脚本会先清理占用 8787 的残留旧服务进程。

### 优化
- **局域网 IP 选取**：排除虚拟网卡（VMware/VirtualBox/Hyper-V/WSL/Docker/TAP/TUN/Tailscale/蓝牙等）与 `169.254.*`（APIPA），优先 `Wi-Fi/WLAN/以太网`。
- **便携包瘦身 185MB → 165MB**：删除 `next-server/*.map`（source map，15MB）、`*.dev.js`（`server.js` 已强制 `NODE_ENV=production`，dev 运行时永不加载）、Prisma 非 SQLite 的 wasm 引擎、Prisma 代码生成器。

### 验收
- 路由探针 **25/25 无 500**（页面 307/200、接口 401/405/200）
- 非破坏性功能测试 **9/9 通过**（健康检查、登录、分片上传 init/finalize、列表、详情、原图字节 SHA-256 一致、缩略图、清理）
- exe 端到端：本机 `127.0.0.1:8787` 与局域网 `10.172.240.196:8787` 的 `/api/health` 均 200；结束 exe 后 node 一并退出、8787 释放（无僵尸）

### 下一轮候选
- 首次运行时把「端口级防火墙规则」的 UAC 提权做成一次性的、带说明的引导（当前依赖 bat 弹窗，用户点「否」则局域网不可用）
- 便携包进一步瘦身（`node.exe` 87MB + libvips 18MB + Prisma 引擎 19MB 为硬成本，可评估 UPX 压缩或改用更小的运行时）
- 应用内自检页：直接展示 `/api/health`、当前局域网 IP 与二维码，减少外部脚本依赖
- next@14.2.15 安全补丁升级

## v1.0（2026-09-24）—— 首个完整版本

八阶段全部完成。桌面应用（Tauri 2 薄壳）+ 内嵌 Web 服务，手机浏览器局域网访问。

### 核心能力
- 原图无损管理：SHA-256 去重与校验，下载二进制一致（§1 宪法约束全程落实）
- 分片并发上传（3 路分片 × 2 路文件，服务端偏移随机写，乱序安全）
- 拖拽导入（复制/移动语义）、手机扫码上传、可选 UPLOAD_TOKEN（仅请求头）
- 六类筛选 + 相册/标签/评分/收藏 + 多选批量（含复制/移动到相册）
- 回收站 30 天软删除 + 惰性清理
- 全量备份 `.lpvbackup`（TAR + manifest + 全链路 SHA-256）、合并/覆盖两种恢复、恢复前自动回滚点、篡改拒收
- 30 天备份提醒（横幅 + 系统通知，可配置）

### 阶段八新增
- SQLite WAL + 复合索引 [takenAt,id]/[createdAt,id] + 游标分页无限滚动（万级流畅）
- 缩略图异步队列（并发 2，不阻塞上传）
- 结构化日志（JSONL，7 天轮转）
- 磁盘空间守护（默认 2GB 阈值，507 拒绝上传）
- README / Dockerfile / PM2 说明

### 最终验收
- 自动验证 21/21 通过（accept-final.js）
- 人工清单 5 项见 README「验收」节

### 下一轮候选
- 生产 sidecar 打包（`npm run tauri build` 产单 exe）与安装器
- next@14.2.15 安全补丁升级
- 回收站自动清理可配置天数
- 照片根目录迁移向导（复制型迁移）
- RAW 内嵌预览质量选项
