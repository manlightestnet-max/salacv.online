from .. import state as cv
from .base import SECTION, Tool, params


def _run(run, args):
    section = args.get("section")
    if section not in cv.TIMELINES:
        return {"error": "section doit valoir education ou experiences."}
    entry = cv.item(args)
    if not entry["title"]:
        return {"error": "title est obligatoire."}
    items = run.state[section]
    if len(items) >= cv.MAX["timeline"]:
        return {"error": "Trop de blocs dans cette section."}
    # Remplace le bloc vide que le formulaire crée par défaut au lieu d'en ajouter un.
    blank = next((i for i, it in enumerate(items) if not any(it.values())), None)
    if blank is None:
        items.append(entry)
        index = len(items) - 1
    else:
        items[blank] = entry
        index = blank
    run.changes.append(cv.TIMELINES[section].lower())
    return {"ok": True, "index": index}


TOOL = Tool(
    name="add_entry",
    description=(
        "Ajoute une formation/certification (section=education) ou une expérience (section=experiences). "
        "Format du CV : « période | titre — organisation », puis une ligne par détail. L'ordre chronologique est géré tout seul."
    ),
    parameters=params(
        {
            "section": SECTION,
            "period": {"type": "string", "description": "ex. « 2023 — 2026 », « Juin — Sept. 2025 », « 2024 — aujourd'hui »"},
            "title": {"type": "string", "description": "Diplôme, certification ou poste"},
            "org": {"type": "string", "description": "Établissement ou entreprise"},
            "details": {"type": "array", "items": {"type": "string"}, "description": "Une entrée par ligne : tâches, acquis (courts, verbes d'action)"},
        },
        ["section", "title"],
    ),
    run=_run,
)
