"""Fournisseurs OpenAI-compatibles et leurs clés API, en rotation.

Les fournisseurs (URL, modèles) sont décrits dans agent/providers.json, versionné et SANS clé.
Les clés viennent uniquement de l'environnement : pour un fournisseur "ollama", la variable
OLLAMA_API_KEYS (plusieurs clés séparées par des virgules) ou OLLAMA_API_KEY.
"""
import fcntl
import hashlib
import json
import os
from datetime import date
from typing import Any, Dict, List, Optional, Set

PROVIDERS_PATH = os.environ.get("AGENT_PROVIDERS_PATH") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "providers.json")


# Clés épuisées aujourd'hui, partagées entre les process du serveur : une clé en 429 n'est pas
# réessayée par chaque requête. Le fichier ne contient que des empreintes SHA-256, jamais les clés,
# et repart de zéro chaque jour.
STATUS_PATH = os.environ.get("AGENT_KEY_STATUS", "/tmp/salacv-agent-keys.json")


def fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _read_exhausted() -> Set[str]:
    try:
        with open(STATUS_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return set(data.get("exhausted", [])) if data.get("date") == date.today().isoformat() else set()
    except (OSError, ValueError):
        return set()


def _add_exhausted(fp: str) -> None:
    try:
        with open(STATUS_PATH, "a+", encoding="utf-8") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            handle.seek(0)
            try:
                data = json.loads(handle.read() or "{}")
            except ValueError:
                data = {}
            today = date.today().isoformat()
            done = set(data.get("exhausted", [])) if data.get("date") == today else set()
            done.add(fp)
            handle.seek(0)
            handle.truncate()
            json.dump({"date": today, "exhausted": sorted(done)}, handle)
    except OSError:
        pass  # sans fichier, la rotation marche quand même, requête par requête


class APIKey:
    def __init__(self, key: str):
        self.key = key.strip()
        self.exhausted = False

    def masked(self) -> str:
        return self.key[:4] + "…" + self.key[-3:] if len(self.key) > 10 else "***"

    def mark_exhausted(self) -> None:
        self.exhausted = True
        _add_exhausted(fingerprint(self.key))


def keys_from_env(name: str) -> List[str]:
    prefix = name.upper().replace("-", "_")
    raw = os.environ.get(f"{prefix}_API_KEYS") or os.environ.get(f"{prefix}_API_KEY") or ""
    return [k.strip() for k in raw.replace("\n", ",").split(",") if k.strip()]


class Provider:
    def __init__(self, data: Dict[str, Any]):
        self.name: str = data.get("name", "unnamed")
        self.type: str = data.get("type", "openai")
        self.base_url: str = data.get("baseUrl", "").rstrip("/")
        self.models: List[str] = data.get("models", [])
        self.default_model: Optional[str] = data.get("defaultModel") or (self.models[0] if self.models else None)
        self.api_keys: List[APIKey] = [APIKey(k) for k in keys_from_env(self.name)]

    def next_key(self) -> Optional[APIKey]:
        return next((k for k in self.api_keys if not k.exhausted), None)


class ProviderManager:
    """Fournisseurs ayant au moins une clé, le fournisseur par défaut en premier."""

    def __init__(self, providers: List[Provider]):
        self.providers = providers

    @classmethod
    def load(cls, path: str = PROVIDERS_PATH) -> "ProviderManager":
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        entries = sorted(data.get("providers", []), key=lambda p: not p.get("default"))
        manager = cls([p for p in (Provider(e) for e in entries) if p.api_keys])
        done = _read_exhausted()
        for provider in manager.providers:
            for key in provider.api_keys:
                key.exhausted = fingerprint(key.key) in done
        return manager

    def available(self) -> Optional[Provider]:
        return next((p for p in self.providers if p.next_key()), None)
