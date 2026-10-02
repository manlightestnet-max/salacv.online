"""Point d'entrée d'une requête : CV + message → CV modifié + réponse. Une requête = une exécution."""
from typing import Any, Callable, Dict, List, Optional

from . import prompt
from . import secrets as secrets_atom
from . import state as cv
from .config import Settings
from .llm import ProviderManager, call_llm
from .llm.client import LLMError
from .loop import ModelCall, run_loop
from .tools import available
from .tools.base import Run


def handle(payload: Dict[str, Any], call_model: Optional[ModelCall] = None, settings: Optional[Settings] = None) -> Dict[str, Any]:
    """payload = { state, message, history? }. call_model est injectable (tests sans réseau)."""
    settings = settings or Settings()
    message = str(payload.get("message") or "").strip()
    if not message:
        return {"ok": False, "status": 400, "error": "Message vide."}

    run = Run(state=cv.normalize(payload.get("state")))
    specs, tools = available()
    messages = prompt.build(run.state, message, payload.get("history") or [])

    secrets: List[str] = []
    if call_model is None:
        manager = ProviderManager.load()
        secrets = secrets_atom.collect(manager)
        call_model = lambda msgs, sp: call_llm(manager, msgs, sp, temperature=settings.temperature, timeout=settings.request_timeout)

    try:
        reply = run_loop(run, messages, specs, tools, call_model, settings.max_iterations)
    except LLMError as exc:
        print(f"[LLM] {secrets_atom.redact(str(exc), secrets)}", flush=True)
        return {"ok": False, "status": 503, "error": "L'assistant est indisponible pour le moment. Réessaie dans un instant."}

    return {
        "ok": True,
        "reply": secrets_atom.redact(reply, secrets),
        "state": cv.compact(run.state),
        "changes": sorted(set(run.changes)),
    }
