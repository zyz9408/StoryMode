import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from launcher import needs_build, npm_command, health, Launcher


class LauncherTests(unittest.TestCase):
    def test_missing_build_and_source_changes(self):
        with tempfile.TemporaryDirectory(prefix="storymode-launcher-") as directory:
            root = Path(directory)
            self.assertTrue(needs_build(root))
            (root / "dist").mkdir()
            (root / "src").mkdir()
            (root / "src/app.tsx").write_text("old", encoding="utf-8")
            time.sleep(.02)
            (root / "dist/index.html").write_text("built", encoding="utf-8")
            self.assertFalse(needs_build(root))
            time.sleep(.02)
            (root / "src/app.tsx").write_text("new", encoding="utf-8")
            self.assertTrue(needs_build(root))

    def test_npm_uses_node_without_cmd_window(self):
        import shutil
        node = shutil.which("node")
        command = npm_command(node, "run", "build")
        self.assertEqual(command[0], node)
        self.assertTrue(command[1].endswith("npm-cli.js"))
        self.assertEqual(command[2:], ["run", "build"])

    def test_unrelated_service_is_not_adopted(self):
        from io import BytesIO
        with patch("launcher.urllib.request.urlopen", return_value=BytesIO(json.dumps({"ok": True, "app": "other"}).encode())):
            self.assertIsNone(health())

    def test_window_widgets_construct(self):
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        with patch.object(Launcher, "probe"):
            app = Launcher(root)
            root.update_idletasks()
            self.assertEqual(app.start_button.cget("text"), "启动模拟器")
            self.assertIn("disabled", app.stop_button.state())
        root.destroy()

    def test_actual_start_health_and_graceful_stop(self):
        import os
        import socket
        import tkinter as tk
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        with tempfile.TemporaryDirectory(prefix="storymode-launcher-run-") as directory, patch("launcher.PORT", port), patch("launcher.URL", f"http://127.0.0.1:{port}"), patch.dict(os.environ, {"STORYMODE_DATA_DIR": directory}), patch("launcher.needs_build", return_value=False):
            root = tk.Tk()
            root.withdraw()
            with patch.object(Launcher, "probe"):
                app = Launcher(root)
            app.auto_open.set(False)
            try:
                app.start()
                until = time.monotonic() + 20
                while time.monotonic() < until and not app.connected:
                    root.update()
                    time.sleep(.05)
                self.assertTrue(app.connected, app.log.get("1.0", "end"))
                self.assertIsNone(app.process.poll())
                self.assertTrue((Path(directory) / "storymode.sqlite").is_file())
                app.stop()
                until = time.monotonic() + 15
                while time.monotonic() < until and (app.process.poll() is None or app.busy):
                    root.update()
                    time.sleep(.05)
                self.assertEqual(app.process.returncode, 0)
            finally:
                if app.process and app.process.poll() is None:
                    app.process.kill()
                    app.process.wait()
                root.destroy()


if __name__ == "__main__":
    unittest.main()
