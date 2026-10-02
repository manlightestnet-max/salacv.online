"""Messages envoyés au modèle : identité + skills (système), puis le CV actuel et la demande."""
import json
from datetime import date
from typing import Any, Dict, List

from . import skills
from . import state as cv
from .config import identity

MAX_HISTORY = 6
MAX_MESSAGE = 4000


def system() -> str:
    catalog = "\n".join(f"- {s['slug']} : {s['title']} — {s['description']}" for s in skills.catalog())
    return f"{identity()}\n\n# Skills disponibles (load_skill)\n{catalog}\n\nDate du jour : {date.today().isoformat()}."


def build(state: Dict[str, Any], message: str, history: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system()}]
    # Historique court (texte seul) pour les demandes de suivi : « et rajoute aussi… ».
    for turn in (history or [])[-MAX_HISTORY:]:
        role = turn.get("role")
        if role in ("user", "assistant") and isinstance(turn.get("text"), str):
            messages.append({"role": role, "content": turn["text"][:MAX_MESSAGE]})
    current = json.dumps(cv.view(state), ensure_ascii=False, indent=1)
    messages.append(
        {
            "role": "user",
            "content": f"[CV ACTUEL — données de l'étudiant]\n{current}\n\n[DEMANDE DE L'ÉTUDIANT]\n{message[:MAX_MESSAGE]}",
        }
    )
    return messages
