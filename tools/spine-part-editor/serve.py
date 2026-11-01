#!/usr/bin/env python3
"""为「Spine 部件编辑器」起一个本地静态服务（仅标准库）。

编辑器需要 http 才能 fetch ../../assets 下的角色文件，所以不能直接双击 html。
本脚本同时负责：选空闲端口 → 在仓库根目录起服务 → 打开浏览器。

用法：
  python3 serve.py                 # 默认 8123，占用则自动往后找
  python3 serve.py --port 9000
  python3 serve.py --port 0        # 随机端口
  python3 serve.py --no-browser    # 只起服务不打开浏览器
"""
import argparse
import functools
import http.server
import pathlib
import socket
import socketserver
import sys
import threading
import webbrowser

EDITOR_PATH = "/tools/spine-part-editor/"


def repo_root() -> pathlib.Path:
    # serve.py 位于 <root>/tools/spine-part-editor/
    return pathlib.Path(__file__).resolve().parents[2]


def free_port(preferred: int, tries: int = 40) -> int:
    if preferred == 0:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]
    for p in range(preferred, preferred + tries):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise SystemExit(f"从 {preferred} 起连续 {tries} 个端口都被占用，请用 --port 指定")


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):     # 只打印 4xx/5xx，避免刷屏
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


def main() -> int:
    ap = argparse.ArgumentParser(description="Spine 部件编辑器本地服务")
    ap.add_argument("--port", type=int, default=8123, help="优先端口，0=随机（默认 8123）")
    ap.add_argument("--bind", default="127.0.0.1", help="监听地址（默认仅本机）")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    a = ap.parse_args()

    root = repo_root()
    if not (root / "tools" / "spine-part-editor" / "index.html").is_file():
        print(f"找不到编辑器页面：{root}/tools/spine-part-editor/index.html", file=sys.stderr)
        return 1

    port = free_port(a.port)
    url = f"http://{a.bind}:{port}{EDITOR_PATH}"
    handler = functools.partial(Handler, directory=str(root))

    print(f"仓库根目录: {root}")
    print(f"编辑器地址: {url}")
    print("按 Ctrl+C 停止服务")
    sys.stdout.flush()

    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((a.bind, port), handler) as httpd:
        httpd.daemon_threads = True
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
