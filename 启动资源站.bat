@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 我的资源站

set "NODE_EXE="
for /f "delims=" %%P in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%P"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo 未找到 Node.js，请先安装：https://nodejs.org/
  echo 安装后重新双击本文件即可。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次启动，正在安装依赖...
  where npm >nul 2>nul
  if errorlevel 1 (
    echo 未找到 npm，请安装 Node.js 后重试。
    pause
    exit /b 1
  )
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请确认已安装 Node.js 并联网后重试。
    pause
    exit /b 1
  )
)

echo 正在启动资源站...
"%NODE_EXE%" server\index.js
pause
