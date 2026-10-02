"""Le CV tel que le manipule le formulaire (même forme que app/state.js).

Tout ce qui vient du client ou du modèle passe par `normalize` : types, longueurs et
nombres d'éléments bornés, comme dans le DSL (src/dsl/schema.js).
"""
from typing import Any, Dict, List

LEVELS = ["Natif", "Courant", "Professionnel", "Intermédiaire", "Notions"]
TIMELINES = {"education": "Formation & certifications", "experiences": "Expérience professionnelle"}
LISTS = {"skills": "Compétences & certifications", "hobbies": "Loisirs"}

LIMITS = {
    "name": 80, "title": 120, "email": 120, "phone": 40, "address": 160, "link": 300, "summary": 1200,
    "period": 60, "item_title": 120, "org": 120, "detail": 400, "list_item": 120, "lang_name": 80, "lang_level": 40,
}
MAX = {"phones": 3, "timeline": 20, "details": 12, "skills": 40, "hobbies": 40, "languages": 20}


def text(value: Any, limit: int) -> str:
    return str(value if value is not None else "").strip()[:limit]


def _strings(values: Any, limit: int, count: int) -> List[str]:
    if isinstance(values, str):
        values = values.split("\n")
    if not isinstance(values, list):
        return []
    out = []
    for v in values:
        s = text(v, limit)
        if s and s.lower() not in (o.lower() for o in out):
            out.append(s)
    return out[:count]


def item(raw: Any) -> Dict[str, str]:
    raw = raw if isinstance(raw, dict) else {}
    details = raw.get("details", "")
    if isinstance(details, list):
        details = "\n".join(str(d) for d in details)
    return {
        "period": text(raw.get("period"), LIMITS["period"]),
        "title": text(raw.get("title"), LIMITS["item_title"]),
        "org": text(raw.get("org"), LIMITS["org"]),
        "details": "\n".join(_strings(details, LIMITS["detail"], MAX["details"])),
    }


def language(raw: Any) -> Dict[str, str]:
    raw = raw if isinstance(raw, dict) else {}
    return {"name": text(raw.get("name"), LIMITS["lang_name"]), "level": text(raw.get("level"), LIMITS["lang_level"])}


def empty() -> Dict[str, Any]:
    return normalize({})


def normalize(raw: Any) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    p = raw.get("profile") if isinstance(raw.get("profile"), dict) else {}
    return {
        "profile": {
            "name": text(p.get("name"), LIMITS["name"]),
            "title": text(p.get("title"), LIMITS["title"]),
            "email": text(p.get("email"), LIMITS["email"]),
            "phones": _strings(p.get("phones"), LIMITS["phone"], MAX["phones"]),
            "address": text(p.get("address"), LIMITS["address"]),
            "link": text(p.get("link"), LIMITS["link"]),
            "summary": text(p.get("summary"), LIMITS["summary"]),
        },
        "education": [item(i) for i in (raw.get("education") or [])][: MAX["timeline"]] if isinstance(raw.get("education"), list) else [],
        "experiences": [item(i) for i in (raw.get("experiences") or [])][: MAX["timeline"]] if isinstance(raw.get("experiences"), list) else [],
        "skills": _strings(raw.get("skills"), LIMITS["list_item"], MAX["skills"]),
        "languages": [language(l) for l in (raw.get("languages") or [])][: MAX["languages"]] if isinstance(raw.get("languages"), list) else [],
        "hobbies": _strings(raw.get("hobbies"), LIMITS["list_item"], MAX["hobbies"]),
    }


def view(state: Dict[str, Any]) -> Dict[str, Any]:
    """Le CV tel que le modèle le voit : blocs vides retirés, index explicites pour les modifier."""
    timeline = lambda key: [{"index": i, **{k: v for k, v in it.items() if v}} for i, it in enumerate(state[key]) if any(it.values())]
    return {
        "profile": {k: v for k, v in state["profile"].items() if v},
        "education": timeline("education"),
        "experiences": timeline("experiences"),
        "skills": state["skills"],
        "languages": [l for l in state["languages"] if l["name"]],
        "hobbies": state["hobbies"],
    }


def compact(state: Dict[str, Any]) -> Dict[str, Any]:
    """Retire les blocs entièrement vides (le formulaire en crée un par défaut)."""
    out = dict(state)
    for key in ("education", "experiences"):
        out[key] = [i for i in state[key] if any(i.values())]
    out["languages"] = [l for l in state["languages"] if l["name"]]
    return out
