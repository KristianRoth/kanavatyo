# Development server: static files with caching disabled, so a normal reload always gets fresh JS modules.
import http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'Serving on http://localhost:{port}')
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
