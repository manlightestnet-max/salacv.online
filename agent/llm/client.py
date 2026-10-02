"""Appel HTTP d'un fournisseur OpenAI-compatible, avec bascule de clé (puis de fournisseur) sur 429."""
import json
import urllib.error
import urllib.request
from typing import Dict, List

from .providers import ProviderManager

USER_AGENT = "salacv-agent/1.0"


class LLMError(RuntimeError):
    pass


def _post(url: str, payload: Dict, api_key: str, timeout: int) -> Dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}", "User-Agent": USER_AGENT, "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _is_rate_limit(code: int, detail: str) -> bool:
    d = detail.lower()
    return code == 429 or "rate limit" in d or "quota" in d or "resource_exhausted" in d


def call_llm(manager: ProviderManager, messages: List[Dict], tools: List[Dict], temperature: float = 0.3, timeout: int = 60) -> Dict:
    """Réponse au format OpenAI (choices[0].message). Lève LLMError si aucun fournisseur ne répond."""
    while True:
        provider = manager.available()
        if not provider:
            raise LLMError("aucun fournisseur disponible (clés absentes ou toutes épuisées)")
        key = provider.next_key()
        payload = {"model": provider.default_model, "messages": messages, "temperature": temperature}
        if tools:
            payload["tools"] = [{"type": "function", "function": t} for t in tools]
        try:
            return _post(f"{provider.base_url}/chat/completions", payload, key.key, timeout)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")[:500]
            if _is_rate_limit(exc.code, detail):
                print(f"[429] clé {key.masked()} de {provider.name} épuisée, clé suivante", flush=True)
                key.mark_exhausted()
                continue
            raise LLMError(f"{provider.name} a répondu {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise LLMError(f"{provider.name} injoignable ({getattr(exc, 'reason', exc)})") from exc
