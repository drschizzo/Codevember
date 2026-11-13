#!/usr/bin/env python3
# Collecteur d'images de mise au point : écrit chaque corps POSTé dans un
# dossier, sous le nom (et le sous-dossier) donné par le chemin de l'URL. La page (en ?debug)
# envoie ses rendus par fetch('http://127.0.0.1:8099/<nom>.jpg', POST) : c'est
# le seul moyen fiable de voir l'image quand le panneau de navigateur est
# masqué (ses captures d'écran sont alors périmées).
#
#   python3 tools/sink.py <dossier> [port=8099]
import http.server, os, re, sys

out = sys.argv[1] if len(sys.argv) > 1 else 'captures'
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8099
os.makedirs(out, exist_ok=True)

class Sink(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        # (sous-dossiers permis : /avant/cocoon-010.png ; rien ne sort du dossier)
        parts = [re.sub(r'[^A-Za-z0-9._-]', '_', s).lstrip('.') for s in self.path.split('?')[0].strip('/').split('/')]
        name = os.path.join(*[s for s in parts if s]) if any(parts) else 'image.jpg'
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        os.makedirs(os.path.dirname(os.path.join(out, name)), exist_ok=True)
        with open(os.path.join(out, name), 'wb') as f:
            f.write(data)
        self.send_response(200); self.cors(); self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, *a):
        pass

print(f'collecteur sur 127.0.0.1:{port} -> {out}', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port), Sink).serve_forever()
