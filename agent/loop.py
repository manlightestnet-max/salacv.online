"""Boucle de l'agent : le modèle appelle des outils jusqu'à final_answer (repris de l'agent Ivy)."""
import json
import re
from typing import Any, Callable, Dict, List

from .tools.base import Run, Tool

ModelCall = Callable[[List[Dict], List[Dict]], Dict]


def clean(text: str) -> str:
    """Retire les blocs <think>…</think> que certains modèles laissent dans le texte."""
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL)
    return text.replace("<think>", "").replace("</think>", "").strip()


# final_answer qui annonce un travail au lieu de le faire (« je vais remplir ton CV »). Certains
# modèles (gemma…) le prennent pour un message d'attente : refusé une fois, avec l'explication.
_PROMISE = re.compile(
    r"\b(?:je\s+(?:vais|m'en\s+vais)\s+(?:te\s+|t'|le\s+|la\s+|les\s+)?(?:faire|cr[ée]er|remplir|ajouter|modifier|mettre|pr[ée]parer|"
    r"r[ée]diger|corriger|reformuler|compl[ée]ter|m'en\s+occuper|m'occuper)"
    r"|je\s+(?:m'en\s+occupe|pr[ée]pare|m'y\s+mets)|un\s+instant|une\s+seconde|patiente[zr]?|c'est\s+en\s+cours)\b",
    re.IGNORECASE,
)


def announces_future_work(text: str) -> bool:
    return bool(_PROMISE.search(clean(text)))


def _args(call: Dict) -> Dict[str, Any]:
    try:
        parsed = json.loads(call["function"].get("arguments") or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _call_tool(run: Run, tools: Dict[str, Tool], name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    tool = tools.get(name)
    if not tool:
        return {"error": f"Outil inconnu : {name}"}
    try:
        return tool.run(run, args)
    except Exception as exc:  # un outil qui plante ne doit pas faire tomber la requête
        return {"error": f"Échec de {name} : {exc}"}


def run_loop(run: Run, messages: List[Dict], specs: List[Dict], tools: Dict[str, Tool], call_model: ModelCall, max_iterations: int = 8) -> str:
    """Exécute la boucle ; modifie run.state et renvoie le texte final pour l'étudiant."""
    for iteration in range(1, max_iterations + 1):
        choice = call_model(messages, specs)["choices"][0]["message"]
        calls = choice.get("tool_calls") or []
        content = clean(choice.get("content") or "")

        final = next((c for c in calls if c["function"]["name"] == "final_answer"), None)
        if final:
            text = _args(final).get("text", "")
            if not (announces_future_work(text) and not run.flags.get("promise_refused") and iteration < max_iterations):
                # Outils demandés dans le même tour que final_answer : exécutés avant de conclure,
                # sinon le CV ne contiendrait pas ce que la réponse annonce.
                for call in calls:
                    if call is not final and call["function"]["name"] != "final_answer":
                        _call_tool(run, tools, call["function"]["name"], _args(call))
                return clean(text)
            run.flags["promise_refused"] = True

        if not calls:
            if content:
                return content
            messages.append({"role": "assistant", "content": ""})
            messages.append({"role": "user", "content": "Rappel : modifie le CV avec tes outils, puis appelle final_answer."})
            continue

        messages.append({"role": "assistant", "content": choice.get("content"), "tool_calls": calls})
        for call in calls:
            name = call["function"]["name"]
            if name == "final_answer":
                result = {
                    "error": "final_answer REFUSÉ : ton texte annonce un travail pas encore fait. Fais-le MAINTENANT avec tes outils, "
                    "puis appelle final_answer avec le résultat."
                }
            else:
                result = _call_tool(run, tools, name, _args(call))
            messages.append({"role": "tool", "tool_call_id": call.get("id"), "content": json.dumps(result, ensure_ascii=False)})

    return "Je n'ai pas réussi à tout terminer. Vérifie ton CV et redemande-moi ce qui manque."
