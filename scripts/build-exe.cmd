@echo off
rem LocalPhotoVault 桌面壳构建脚本（Windows / MSVC）
rem 用法：cmd /c scripts\build-exe.cmd
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo [build-exe] vcvars64.bat 调用失败
  exit /b 1
)
set "PATH=%USERPROFILE%\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin;%PATH%"
cd /d "%~dp0..\src-tauri"
echo [build-exe] cargo build --release ...
cargo build --release
if errorlevel 1 (
  echo [build-exe] 构建失败
  exit /b 1
)
echo [build-exe] 完成：target\release\local-photo-vault.exe
