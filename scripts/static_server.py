from __future__ import annotations

import http.server
import json
import os
import socketserver
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent / "public"
MONACO_ROOT = Path(__file__).resolve().parent.parent / "node_modules" / "monaco-editor" / "min" / "vs"
PORT = int(os.environ.get("PORT", "8080"))
STATE_DIR = Path(os.environ.get("QYOG_STATE_DIR", ROOT.parent / ".run"))


def build_id() -> str:
    configured = os.environ.get("QYOG_BUILD_ID")
    if configured:
        return configured
    try:
        return (STATE_DIR / "build-id").read_text(encoding="utf-8").strip() or "dev"
    except OSError:
        return "dev"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        request_path = urlsplit(self.path).path
        critical = request_path in {"/", "/index.html", "/service-worker.js", "/build-version.js"}
        self.send_header("Cache-Control", "no-store" if critical else "no-cache")
        if request_path == "/service-worker.js":
            self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def _serve_build_version(self, include_body: bool) -> bool:
        if urlsplit(self.path).path != "/build-version.js":
            return False
        payload = f"window.QYOG_BUILD_ID = {json.dumps(build_id())};\n".encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if include_body:
            self.wfile.write(payload)
        return True

    def do_GET(self):
        if self._serve_build_version(include_body=True):
            return
        super().do_GET()

    def do_HEAD(self):
        if self._serve_build_version(include_body=False):
            return
        super().do_HEAD()

    def send_head(self):
        if self.path.startswith("/vendor/monaco/vs/"):
            relative = self.path.removeprefix("/vendor/monaco/vs/").split("?", 1)[0]
            target = (MONACO_ROOT / relative).resolve()
            if MONACO_ROOT.resolve() in target.parents and target.is_file():
                self.path = "/" + str(target.relative_to(ROOT.parent))
                self.directory = str(ROOT.parent)
                response = super().send_head()
                self.directory = str(ROOT)
                return response
        path = self.translate_path(self.path)
        if not Path(path).exists():
            self.path = "/index.html"
            path = self.translate_path(self.path)
        range_header = self.headers.get("Range")
        if range_header and Path(path).is_file():
            try:
                unit, requested = range_header.split("=", 1)
                if unit.strip().lower() != "bytes" or "," in requested:
                    raise ValueError
                start_text, end_text = requested.strip().split("-", 1)
                size = Path(path).stat().st_size
                if start_text:
                    start = int(start_text)
                    end = int(end_text) if end_text else size - 1
                else:
                    suffix = int(end_text)
                    start = max(0, size - suffix)
                    end = size - 1
                if start < 0 or start >= size or end < start:
                    raise ValueError
                end = min(end, size - 1)
            except (TypeError, ValueError):
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{Path(path).stat().st_size}")
                self.end_headers()
                return None
            handle = open(path, "rb")
            handle.seek(start)
            self._range_remaining = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(self._range_remaining))
            self.send_header("Last-Modified", self.date_time_string(Path(path).stat().st_mtime))
            self.end_headers()
            return handle
        return super().send_head()

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_range_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        del self._range_remaining


class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    with ReusableTCPServer(("", PORT), Handler) as httpd:
        print(f"1StopQuantum frontend listening at http://localhost:{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
