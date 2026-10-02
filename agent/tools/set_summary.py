from .. import state as cv
from .base import Tool, params


def _run(run, args):
    text = cv.text(args.get("text"), cv.LIMITS["summary"])
    if not text:
        return {"error": "Texte vide."}
    run.state["profile"]["summary"] = text
    run.changes.append("profil professionnel")
    return {"ok": True}


TOOL = Tool(
    name="set_summary",
    description="Écrit ou remplace le profil professionnel (2 à 4 phrases, un paragraphe par ligne).",
    parameters=params({"text": {"type": "string"}}, ["text"]),
    run=_run,
)
