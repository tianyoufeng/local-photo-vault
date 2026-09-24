@echo off
rem 由 启动LocalPhotoVault.bat 以管理员身份调用：放行局域网端口 8787 入站
rem 已存在同名规则则跳过，可重复执行
netsh advfirewall firewall show rule name="LocalPhotoVault LAN 8787" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="LocalPhotoVault LAN 8787" dir=in action=allow protocol=TCP localport=8787 profile=any >nul
)
exit /b 0
