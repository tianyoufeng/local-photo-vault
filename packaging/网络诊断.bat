@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title LocalPhotoVault 网络诊断

echo ============================================================
echo   LocalPhotoVault 局域网访问 · 诊断
echo ============================================================
echo.

echo [1] 本机 IPv4 地址（手机要访问「WLAN / 无线局域网」那一条）
ipconfig | findstr /R /C:"IPv4"
echo.

echo [2] 8787 端口监听状态（应能看到 LISTENING）
netstat -ano | findstr ":8787"
if errorlevel 1 echo     !! 8787 未在监听：请先双击「启动LocalPhotoVault.bat」
echo.

echo [3] 防火墙放行规则（端口级，与安装路径无关）
netsh advfirewall firewall show rule name="LocalPhotoVault LAN 8787" >nul 2>&1
if errorlevel 1 (
  echo     !! 未找到放行规则 —— 双击「启动LocalPhotoVault.bat」会自动添加（需在 UAC 弹窗点「是」）
) else (
  echo     OK 放行规则已存在
)
echo.

echo [4] 当前网络位置
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory | Format-Table -AutoSize"
echo.

echo [5] 是否残留旧服务进程
tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH 2>nul | findstr /I "node.exe" && echo     (上面这些 node.exe 属于本应用；双击启动脚本会自动清理 8787 上的残留)
echo.

echo ============================================================
echo   手机请用浏览器打开： http://^<第[1]步里 WLAN 的 IP^>:8787
echo.
echo   仍打不开时按顺序排查：
echo     1. 手机与电脑必须在同一个 Wi-Fi（手机流量、访客网络都不行）
echo     2. 路由器「AP 隔离 / 客户端隔离」要关闭（校园网/公共 Wi-Fi 常默认开启）
echo     3. 若电脑连的是手机热点：部分机型会禁止热点主机访问已连接设备，
echo        此时改用「电脑与手机同连一个家用路由器」，或改用 Tailscale（见使用说明第 7 节）
echo     4. 第[3]步若提示「未找到放行规则」，务必重跑启动脚本并在 UAC 点「是」
echo ============================================================
pause
