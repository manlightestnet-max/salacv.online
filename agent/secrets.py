"""Secrets à ne jamais montrer au modèle ni renvoyer au client : masqués partout."""
from typing import Iterable, List

MASK = "***"
_MIN_LENGTH = 8


def collect(manager) -> List[str]:
    found = [k.key for p in getattr(manager, "providers", []) for k in p.api_keys]
    # Les plus longues d'abord : une clé ne doit pas être masquée à moitié par une autre.
    return sorted({s for s in found if len(s) >= _MIN_LENGTH}, key=len, reverse=True)


def redact(text: str, secrets: Iterable[str]) -> str:
    for secret in secrets:
        if secret in text:
            text = text.replace(secret, MASK)
    return text
