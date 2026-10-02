from .. import skills
from .base import Tool, params


def _run(run, args):
    content = skills.load(args.get("slug") or "")
    return {"slug": args.get("slug"), "content": content} if content else {"error": "Skill introuvable."}


TOOL = Tool(
    name="load_skill",
    description="Charge le contenu complet d'une skill listée dans tes instructions (par son slug), quand la demande y correspond.",
    parameters=params({"slug": {"type": "string"}}, ["slug"]),
    run=_run,
)
