"""Réglages lus dans l'environnement. Aucune clé n'est jamais écrite dans le code ou le repo."""
import os
from dataclasses import dataclass, field
from typing import List

AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
IDENTITY_PATH = os.path.join(AGENT_DIR, "identity.md")
SKILLS_DIR = os.path.join(AGENT_DIR, "skills")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _list(name: str) -> List[str]:
    raw = os.environ.get(name, "")
    return [k.strip() for k in raw.replace("\n", ",").split(",") if k.strip()]


@dataclass
class Settings:
    max_iterations: int = field(default_factory=lambda: _int("AGENT_MAX_ITERATIONS", 8))
    temperature: float = 0.3
    # Serveur HTTP (agent/server.py)
    host: str = field(default_factory=lambda: os.environ.get("AGENT_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: _int("AGENT_PORT", 8787))
    workers: int = field(default_factory=lambda: _int("AGENT_WORKERS", 4))
    queue_limit: int = field(default_factory=lambda: _int("AGENT_QUEUE_LIMIT", 16))
    request_timeout: int = field(default_factory=lambda: _int("AGENT_TIMEOUT", 90))
    rate_per_minute: int = field(default_factory=lambda: _int("AGENT_RATE_PER_MINUTE", 6))
    allowed_origins: List[str] = field(default_factory=lambda: _list("AGENT_ALLOWED_ORIGINS"))
    # Jeton partagé avec le backend du site : seul un utilisateur connecté passe par lui.
    access_token: str = field(default_factory=lambda: os.environ.get("AGENT_ACCESS_TOKEN", ""))


def identity() -> str:
    with open(IDENTITY_PATH, "r", encoding="utf-8") as handle:
        return handle.read().strip()
