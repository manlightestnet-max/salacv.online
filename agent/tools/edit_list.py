from .. import state as cv
from .base import Tool, params


def _run(run, args):
    section = args.get("section")
    if section not in cv.LISTS:
        return {"error": "section doit valoir skills ou hobbies."}
    mode = args.get("mode") or "add"
    items = [cv.text(i, cv.LIMITS["list_item"]) for i in (args.get("items") or []) if cv.text(i, cv.LIMITS["list_item"])]
    current = run.state[section]
    lower = lambda values: [v.lower() for v in values]
    if mode == "replace":
        current[:] = []
        mode = "add"
    if mode == "add":
        for i in items:
            if i.lower() not in lower(current) and len(current) < cv.MAX[section]:
                current.append(i)
    elif mode == "remove":
        drop = set(lower(items))
        current[:] = [v for v in current if v.lower() not in drop]
    else:
        return {"error": "mode doit valoir add, remove ou replace."}
    run.changes.append(cv.LISTS[section].lower())
    return {"ok": True, section: current}


TOOL = Tool(
    name="edit_list",
    description="Compétences & certifications (section=skills) ou loisirs (section=hobbies) : ajouter, retirer ou remplacer toute la liste. Éléments courts.",
    parameters=params(
        {
            "section": {"type": "string", "enum": ["skills", "hobbies"]},
            "mode": {"type": "string", "enum": ["add", "remove", "replace"]},
            "items": {"type": "array", "items": {"type": "string"}},
        },
        ["section", "items"],
    ),
    run=_run,
)
