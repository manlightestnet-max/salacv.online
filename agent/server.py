"""Serveur HTTP de l'agent, pour le VPS : un pool de process sert N étudiants en parallèle.

    POST /v1/agent   { state, message, history? }  →  { ok, reply, state, changes }
    GET  /health

Le navigateur n'appelle pas ce serveur directement : le backend du site vérifie que
l'utilisateur est connecté, puis relaie la requête avec le jeton AGENT_ACCESS_TOKEN et
l'identifiant de l'utilisateur (en-tête X-User-Id, utilisé pour la limite de débit).

Lancement : python -m agent.server   (variables : voir agent/README.md)
"""
import hmac
import json
import os
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import Settings
from .run import handle

MAX_BODY = 64 * 1024
settings = Settings()
DEV = os.environ.get("AGENT_DEV") == "1"


class RateLimiter:
    """Fenêtre glissante d'une minute par utilisateur."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, who: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[who]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return False
            q.append(now)
            return True


limiter = RateLimiter(settings.rate_per_minute)
in_flight = threading.BoundedSemaphore(settings.workers + settings.queue_limit)
pool: ProcessPoolExecutor = None  # créé dans main() : un process par worker


class Handler(BaseHTTPRequestHandler):
    server_version = "salacv-agent"

    def log_message(self, fmt, *args):  # journal court, sans corps de requête (données personnelles)
        print(f"{self.address_string()} {fmt % args}", flush=True)

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin in settings.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Id")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _send(self, status: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True})
        self._send(404, {"ok": False, "error": "Introuvable."})

    def _authorized(self) -> bool:
        if not settings.access_token:
            return DEV  # sans jeton configuré, seul le mode développement est accepté
        given = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        return hmac.compare_digest(given, settings.access_token)

    def do_POST(self):
        if self.path != "/v1/agent":
            return self._send(404, {"ok": False, "error": "Introuvable."})
        if not self._authorized():
            return self._send(401, {"ok": False, "error": "Non autorisé."})
        who = self.headers.get("X-User-Id") or self.client_address[0]
        if not limiter.allow(who):
            return self._send(429, {"ok": False, "error": "Trop de demandes. Attends une minute."})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._send(413, {"ok": False, "error": "Requête trop grande."})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._send(400, {"ok": False, "error": "JSON invalide."})
        if not isinstance(payload, dict):
            return self._send(400, {"ok": False, "error": "JSON invalide."})
        if not in_flight.acquire(blocking=False):
            return self._send(503, {"ok": False, "error": "L'assistant est très demandé. Réessaie dans un instant."})
        try:
            result = pool.submit(handle, payload).result(timeout=settings.request_timeout + 15)
        except FutureTimeout:
            return self._send(504, {"ok": False, "error": "L'assistant a mis trop de temps. Réessaie."})
        except Exception as exc:
            print(f"[ERREUR] {type(exc).__name__}", flush=True)
            return self._send(500, {"ok": False, "error": "Erreur interne."})
        finally:
            in_flight.release()
        self._send(result.pop("status", 200 if result.get("ok") else 502), result)


def main():
    global pool
    pool = ProcessPoolExecutor(max_workers=settings.workers)
    server = ThreadingHTTPServer((settings.host, settings.port), Handler)
    print(f"salacv-agent sur http://{settings.host}:{settings.port} ({settings.workers} process)", flush=True)
    try:
        server.serve_forever()
    finally:
        pool.shutdown(cancel_futures=True)


if __name__ == "__main__":
    main()
