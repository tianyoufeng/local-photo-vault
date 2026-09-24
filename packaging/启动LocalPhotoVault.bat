@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title LocalPhotoVault

rem ============================================================
rem  LocalPhotoVault 启动器
rem  1) 清理占用 8787 的残留旧服务（避免连到旧版本/僵尸进程）
rem  2) 首次运行自动放行防火墙 8787（局域网手机访问需要）
rem  3) 启动桌面应用
rem ============================================================

echo [1/3] 清理可能残留的旧服务 ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
  tasklist /FI "PID eq %%p" /FO CSV /NH 2>nul | findstr /I "node.exe" >nul && (
    echo        结束残留进程 PID %%p
    taskkill /PID %%p /T /F >nul 2>&1
  )
)

echo [2/3] 检查局域网端口 8787 放行规则 ...
netsh advfirewall firewall show rule name="LocalPhotoVault LAN 8787" >nul 2>&1
if errorlevel 1 (
  echo        首次运行：正在放行防火墙端口 8787 ^(如弹出管理员确认，请点"是"^)
  powershell -NoProfile -Command "Start-Process -FilePath '%~dp0firewall-allow.cmd' -Verb RunAs -Wait -WindowStyle Hidden" >nul 2>&1
)

echo [3/3] 启动 LocalPhotoVault ...
start "" "%~dp0LocalPhotoVault.exe"
exit /b 0
