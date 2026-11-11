#!/usr/bin/env python3
# Collecteur d'images de mise au point : écrit chaque corps POSTé dans un
# dossier, sous le nom donné par le chemin de l'URL. La page (en ?debug)
# envoie ses rendus par fetch('http://127.0.0.1:8099/<nom>.jpg', POST) : c'est
# le seul moyen fiable de voir l'image quand le panneau de navigateur est
# masqué (ses captures d'écran sont alors périmées).
#
#   python3 tools/sink.py <dossier> [port=8099]
import http.server, os, sys

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
        name = os.path.basename(self.path.strip('/')) or 'image.jpg'
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        with open(os.path.join(out, name), 'wb') as f:
            f.write(data)
        self.send_response(200); self.cors(); self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, *a):
        pass

print(f'collecteur sur 127.0.0.1:{port} -> {out}', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port), Sink).serve_forever()
