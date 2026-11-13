# Serveur statique de développement sans cache (les modules ES sont sinon
# mis en cache par heuristique et les modifications ne sont pas rechargées).
#
#   python3 .claude/serve.py <port> <dossier>
#
# Servi depuis la racine du dépôt (dossier « . »), le site a la forme publiée :
# /cocoon/, /shared/… Servi depuis le dossier d'un projet, /shared/ est pris à
# la racine du dépôt : les imports relatifs des projets (../../shared/rng.js,
# que le navigateur borne à la racine du site) arrivent au même endroit.
import http.server, functools, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def translate_path(self, path):
        p = super().translate_path(path)
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if clean.startswith('/shared/') and not os.path.exists(p):
            return os.path.join(REPO, os.path.normpath(clean).lstrip('/'))
        return p

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = sys.argv[2] if len(sys.argv) > 2 else '.'
http.server.ThreadingHTTPServer(('', port), functools.partial(NoCache, directory=root)).serve_forever()
