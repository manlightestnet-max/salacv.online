from .. import state as cv
from .base import SECTION, Tool, params


def _run(run, args):
    section = args.get("section")
    if section not in cv.TIMELINES:
        return {"error": "section doit valoir education ou experiences."}
    items = run.state[section]
    index = args.get("index")
    if not isinstance(index, int) or not 0 <= index < len(items):
        return {"error": f"index invalide : utilise un index donné par le CV actuel (0 à {len(items) - 1})."}
    merged = {**items[index], **{k: v for k, v in args.items() if k in ("period", "title", "org", "details") and v is not None}}
    items[index] = cv.item(merged)
    run.changes.append(cv.TIMELINES[section].lower())
    return {"ok": True, "entry": items[index]}


TOOL = Tool(
    name="update_entry",
    description="Modifie un bloc existant (index donné dans le CV actuel). Ne passe que les champs à changer ; details remplace toutes les lignes.",
    parameters=params(
        {
            "section": SECTION,
            "index": {"type": "integer"},
            "period": {"type": "string"},
            "title": {"type": "string"},
            "org": {"type": "string"},
            "details": {"type": "array", "items": {"type": "string"}},
        },
        ["section", "index"],
    ),
    run=_run,
)
