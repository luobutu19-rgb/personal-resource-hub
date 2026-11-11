#!/data/data/com.termux/files/usr/bin/bash
# Personal Resource Hub — Termux (Android 平板/手机) 一键安装脚本
# 用法：
#   bash scripts/termux-install.sh
# 说明：首次运行会安装 nodejs-lts 与 git，之后自动拉取项目并启动服务。

set -euo pipefail

APP_DIR="$HOME/personal-resource-hub"
REPO="https://github.com/luobutu19-rgb/personal-resource-hub.git"

echo "==> 1/4 安装 Node.js 与 git"
pkg update -y
pkg install -y nodejs-lts git

echo "==> 2/4 获取项目代码"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> 3/4 安装依赖"
npm install --omit=dev

echo "==> 4/4 启动服务（Ctrl+C 停止）"
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi
npm start
