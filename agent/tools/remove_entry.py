from .. import state as cv
from .base import SECTION, Tool, params


def _run(run, args):
    section = args.get("section")
    if section not in cv.TIMELINES:
        return {"error": "section doit valoir education ou experiences."}
    items = run.state[section]
    index = args.get("index")
    if not isinstance(index, int) or not 0 <= index < len(items):
        return {"error": "index invalide."}
    removed = items.pop(index)
    run.changes.append(cv.TIMELINES[section].lower())
    return {"ok": True, "removed": removed.get("title", ""), "info": "Les index suivants ont diminué de 1."}


TOOL = Tool(
    name="remove_entry",
    description="Supprime un bloc de formation ou d'expérience, uniquement si l'étudiant le demande.",
    parameters=params({"section": SECTION, "index": {"type": "integer"}}, ["section", "index"]),
    run=_run,
)
