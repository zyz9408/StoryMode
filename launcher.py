"""StoryMode desktop launcher. Standard library only; no console required on Windows."""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
PORT = 3210
URL = f"http://127.0.0.1:{PORT}"
NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def health(url: str | None = None) -> dict | None:
    try:
        with urllib.request.urlopen((url or URL) + "/api/health", timeout=1) as response:
            value = json.load(response)
            return value if value.get("app") == "storymode" else None
    except (OSError, ValueError, urllib.error.URLError):
        return None


def needs_build(root: Path = ROOT) -> bool:
    built = root / "dist" / "index.html"
    if not built.exists():
        return True
    stamp = built.stat().st_mtime
    sources = [root / "package.json", root / "package-lock.json", root / "index.html", root / "vite.config.ts", root / "tsconfig.json"]
    sources.extend((root / "src").rglob("*"))
    return any(p.is_file() and p.stat().st_mtime > stamp for p in sources)


def npm_command(node: str, *arguments: str) -> list[str]:
    candidates = [Path(node).parent / "node_modules/npm/bin/npm-cli.js"]
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if npm:
        candidates.append(Path(npm).parent / "node_modules/npm/bin/npm-cli.js")
        candidates.append(Path(npm).resolve().parent / "npm-cli.js")
    for path in candidates:
        if path.is_file():
            return [node, str(path), *arguments]
    raise RuntimeError("未找到 npm，请安装包含 npm 的完整 Node.js 24 或更新版本。")


class Launcher:
    def __init__(self, window: tk.Tk):
        self.window = window
        self.events: queue.Queue = queue.Queue()
        self.process: subprocess.Popen | None = None
        self.server_process = False
        self.busy = False
        self.connected = False
        self.closing = False
        self.cancel = threading.Event()
        window.title("异史 · 故事模拟器")
        window.geometry("760x580")
        window.minsize(630, 480)
        window.configure(bg="#f7f5ef")
        style = ttk.Style(window)
        style.theme_use("clam")
        style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=(16, 10))
        style.configure("Primary.TButton", foreground="#ffffff", background="#294d42")
        style.map("Primary.TButton", background=[("active", "#3b6153")])
        header = tk.Frame(window, bg="#eeeee5", padx=28, pady=23)
        header.pack(fill="x")
        tk.Label(header, text="异史", font=("Microsoft YaHei UI", 26), fg="#294d42", bg="#eeeee5").pack(anchor="w")
        tk.Label(header, text="STORYMODE  /  本地故事模拟器", font=("Microsoft YaHei UI", 10), fg="#81877b", bg="#eeeee5").pack(anchor="w", pady=(5, 0))
        content = tk.Frame(window, bg="#f7f5ef", padx=28, pady=20)
        content.pack(fill="both", expand=True)
        self.status = tk.StringVar(value="正在检查本地服务…")
        tk.Label(content, textvariable=self.status, font=("Microsoft YaHei UI", 12), fg="#294d42", bg="#f7f5ef").pack(anchor="w")
        tk.Label(content, text=URL, font=("Consolas", 11), fg="#81877b", bg="#f7f5ef").pack(anchor="w", pady=(8, 18))
        buttons = tk.Frame(content, bg="#f7f5ef")
        buttons.pack(fill="x")
        self.start_button = ttk.Button(buttons, text="启动模拟器", style="Primary.TButton", command=self.start)
        self.start_button.pack(side="left", padx=(0, 10))
        self.open_button = ttk.Button(buttons, text="打开网页", command=lambda: webbrowser.open(URL))
        self.open_button.pack(side="left", padx=(0, 10))
        self.stop_button = ttk.Button(buttons, text="停止服务", command=self.stop)
        self.stop_button.pack(side="left")
        self.rebuild = tk.BooleanVar(value=False)
        self.auto_open = tk.BooleanVar(value=True)
        opts = tk.Frame(content, bg="#f7f5ef")
        opts.pack(fill="x", pady=(15, 12))
        tk.Checkbutton(opts, text="启动后打开网页", variable=self.auto_open, bg="#f7f5ef", activebackground="#f7f5ef", font=("Microsoft YaHei UI", 10)).pack(side="left")
        tk.Checkbutton(opts, text="强制重新构建", variable=self.rebuild, bg="#f7f5ef", activebackground="#f7f5ef", font=("Microsoft YaHei UI", 10)).pack(side="left", padx=14)
        tk.Label(content, text="运行日志", bg="#f7f5ef", fg="#81877b", font=("Microsoft YaHei UI", 10)).pack(anchor="w", pady=(5, 8))
        self.log = scrolledtext.ScrolledText(content, height=12, bg="#fffdf7", fg="#324b3a", relief="flat", font=("Microsoft YaHei UI", 9), state="disabled", padx=12, pady=10)
        self.log.pack(fill="both", expand=True)
        tk.Label(content, text="首次启动自动安装依赖；源码更新后自动构建。密钥请在网页「模型连接」中配置。", font=("Microsoft YaHei UI", 9), fg="#81877b", bg="#f7f5ef", wraplength=680, justify="left").pack(anchor="w", pady=(12, 0))
        window.protocol("WM_DELETE_WINDOW", self.close)
        self.update_buttons()
        self.window.after(100, self.drain)
        self.probe()

    def post(self, kind: str, value=None):
        self.events.put((kind, value))

    def update_buttons(self):
        self.start_button.configure(state="disabled" if self.busy or self.connected else "normal")
        self.open_button.configure(state="normal" if self.connected else "disabled")
        owned = self.process is not None and self.process.poll() is None
        self.stop_button.configure(state="normal" if owned else "disabled")

    def drain(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "log":
                    self.log.configure(state="normal")
                    self.log.insert("end", value + "\n")
                    self.log.see("end")
                    self.log.configure(state="disabled")
                elif kind == "status":
                    self.status.set(value)
                elif kind == "done":
                    self.busy = False
                elif kind == "health":
                    self.connected = bool(value)
                    if not self.busy:
                        owned = self.process is not None and self.process.poll() is None
                        self.status.set("服务运行中" if owned and value else "已连接已有服务（关闭此窗口不会停止它）" if value else "服务未启动")
                elif kind == "open":
                    webbrowser.open(URL)
                elif kind == "closed":
                    self.window.destroy()
                    return
        except queue.Empty:
            pass
        self.update_buttons()
        self.window.after(100, self.drain)

    def probe(self):
        def check():
            self.post("health", health())
        threading.Thread(target=check, daemon=True).start()
        self.window.after(2500, self.probe)

    def spawn(self, command: list[str]) -> subprocess.Popen:
        process = subprocess.Popen(command, cwd=ROOT, env={**os.environ, "PORT": str(PORT)}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        self.process = process
        def read():
            with process.stdout:
                for line in process.stdout:
                    self.post("log", line.rstrip())
            process.wait()
            if process.stdin:
                process.stdin.close()
        threading.Thread(target=read, daemon=True).start()
        return process

    def run_step(self, command: list[str], label: str):
        if self.cancel.is_set():
            raise RuntimeError("启动已取消。")
        self.post("status", label)
        self.post("log", label)
        self.server_process = False
        code = self.spawn(command).wait()
        if self.cancel.is_set():
            raise RuntimeError("启动已取消。")
        if code != 0:
            raise RuntimeError(label + "失败，请查看上方日志。")

    def start(self):
        if self.busy:
            return
        self.busy = True
        self.cancel.clear()
        force = self.rebuild.get()
        auto = self.auto_open.get()
        self.update_buttons()
        def work():
            try:
                existing = health()
                if existing:
                    self.post("health", existing)
                    if auto:
                        self.post("open")
                    return
                node = shutil.which("node")
                if not node:
                    raise RuntimeError("未找到 Node.js，请安装 Node.js 24 或更新版本，然后重新打开启动器。")
                version = subprocess.check_output([node, "--version"], text=True, creationflags=NO_WINDOW).strip()
                if int(version.lstrip("v").split(".")[0]) < 24:
                    raise RuntimeError(f"当前 {version}；需要 Node.js 24 或更新版本。")
                install = not (ROOT / "node_modules").is_dir()
                lock = ROOT / "package-lock.json"
                installed = ROOT / "node_modules/.package-lock.json"
                install = install or (lock.is_file() and (not installed.is_file() or lock.stat().st_mtime > installed.stat().st_mtime))
                if install:
                    self.run_step(npm_command(node, "ci" if lock.exists() else "install"), "正在安装依赖…")
                if install or force or needs_build():
                    self.run_step(npm_command(node, "run", "build"), "正在构建网页…")
                if self.cancel.is_set():
                    return
                self.post("status", "正在启动本地服务…")
                self.server_process = True
                process = self.spawn([node, str(ROOT / "server/index.mjs")])
                for _ in range(80):
                    if self.cancel.is_set():
                        return
                    if process.poll() is not None:
                        raise RuntimeError("服务启动失败，请检查端口 3210 是否被其他程序占用。")
                    result = health()
                    if result:
                        self.post("health", result)
                        self.post("status", "服务运行中")
                        if auto:
                            self.post("open")
                        return
                    time.sleep(.25)
                self.cancel.set()
                self.terminate_owned()
                raise RuntimeError("启动超时；已停止本次启动的进程，请查看日志后重试。")
            except Exception as error:
                self.post("log", str(error))
                self.post("status", "未能启动，请查看日志")
            finally:
                self.post("done")
        threading.Thread(target=work, daemon=True).start()

    def terminate_owned(self):
        process = self.process
        if process is None or process.poll() is not None:
            return
        if self.server_process:
            try:
                process.stdin.write("shutdown\n")
                process.stdin.flush()
                process.wait(timeout=12)
                return
            except (OSError, subprocess.TimeoutExpired):
                pass
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    def stop(self, closing=False):
        self.cancel.set()
        self.busy = True
        self.post("status", "正在保存检查点并停止…")
        def work():
            self.terminate_owned()
            self.post("health", health())
            self.post("done")
            if closing:
                self.post("closed")
        threading.Thread(target=work, daemon=True).start()

    def close(self):
        if self.closing:
            return
        owned = self.process is not None and self.process.poll() is None
        if owned or self.busy:
            if not messagebox.askyesno("关闭启动器", "将停止本窗口启动的服务或构建任务。已完成章节和草稿会保留。确定关闭？", parent=self.window):
                return
            self.closing = True
            self.stop(closing=True)
        else:
            self.window.destroy()


def main():
    window = tk.Tk()
    Launcher(window)
    window.mainloop()


if __name__ == "__main__":
    main()
