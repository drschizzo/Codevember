# Serveur statique de développement sans cache (les modules ES sont sinon
# mis en cache par heuristique et les modifications ne sont pas rechargées).
import http.server, functools, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = sys.argv[2] if len(sys.argv) > 2 else '.'
http.server.ThreadingHTTPServer(('', port), functools.partial(NoCache, directory=root)).serve_forever()
