#!/usr/bin/env bash
# 启动「立绘语义标注器」：起本地静态服务并打开浏览器（仅需 Python 3 标准库）
#   ./start.sh                默认 8123，占用则自动往后找
#   ./start.sh --port 9000    指定端口
#   ./start.sh --no-browser   只起服务
set -euo pipefail
cd "$(dirname "$0")"
PY=""
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else
  echo "[错误] 未找到 Python 3，请安装后在 PATH 中可用。" >&2
  exit 1
fi
exec "$PY" serve.py "$@"