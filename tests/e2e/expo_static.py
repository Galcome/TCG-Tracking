"""Serve only the Expo export for local/CI browser tests, with SPA deep-link fallback."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EXPORT = Path(__file__).resolve().parents[2] / "app" / "dist-e2e"


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        target = Path(self.translate_path(self.path))
        if not target.is_file() and "." not in Path(self.path.split("?")[0]).name:
            self.path = "/index.html"
        return super().do_GET()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    if not (EXPORT / "index.html").is_file():
        raise SystemExit("Build app/dist-e2e before running the Expo test server")
    ThreadingHTTPServer(
        ("127.0.0.1", 5373), partial(Handler, directory=str(EXPORT))
    ).serve_forever()
