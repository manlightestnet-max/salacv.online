from .. import state as cv
from .base import Tool, params


def _run(run, args):
    langs = [cv.language(l) for l in (args.get("languages") or []) if isinstance(l, dict)]
    langs = [l for l in langs if l["name"]][: cv.MAX["languages"]]
    current = run.state["languages"] = [l for l in run.state["languages"] if l["name"]]
    if args.get("mode") == "replace":
        current[:] = langs
    else:
        for lang in langs:
            existing = next((c for c in current if c["name"].lower() == lang["name"].lower()), None)
            if existing:
                existing["level"] = lang["level"] or existing["level"]
            else:
                current.append(lang)
    run.changes.append("langues")
    return {"ok": True, "languages": current}


TOOL = Tool(
    name="set_languages",
    description=f"Ajoute ou met à jour des langues (mode=replace pour remplacer toute la liste). Niveaux : {', '.join(cv.LEVELS)}.",
    parameters=params(
        {
            "mode": {"type": "string", "enum": ["merge", "replace"]},
            "languages": {
                "type": "array",
                "items": {"type": "object", "properties": {"name": {"type": "string"}, "level": {"type": "string", "enum": cv.LEVELS}}, "required": ["name"]},
            },
        },
        ["languages"],
    ),
    run=_run,
)
