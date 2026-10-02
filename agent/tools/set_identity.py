from .. import state as cv
from .base import Tool, params

FIELDS = {"name": "name", "title": "title", "email": "email", "address": "address", "link": "link"}


def _run(run, args):
    p = run.state["profile"]
    done = []
    for key, limit in FIELDS.items():
        if key in args and args[key] is not None:
            p[key] = cv.text(args[key], cv.LIMITS[limit])
            done.append(key)
    if "phones" in args and isinstance(args["phones"], list):
        p["phones"] = cv.normalize({"profile": {"phones": args["phones"]}})["profile"]["phones"]
        done.append("phones")
    if not done:
        return {"error": "Aucun champ fourni."}
    run.changes.append("identité")
    return {"ok": True, "profile": p}


TOOL = Tool(
    name="set_identity",
    description="Remplit ou corrige l'en-tête du CV. Ne passe que les champs à changer. phones remplace toute la liste (3 numéros maximum).",
    parameters=params(
        {
            "name": {"type": "string", "description": "Nom complet"},
            "title": {"type": "string", "description": "Profession ou domaine, ex. « Technicienne en réseaux et télécommunications »"},
            "email": {"type": "string"},
            "phones": {"type": "array", "items": {"type": "string"}, "description": "Numéros au format +243 81 234 5678"},
            "address": {"type": "string", "description": "Adresse, ex. « 12, av. Kasa-Vubu, Q/Matonge, C/Kalamu, Kinshasa »"},
            "link": {"type": "string", "description": "Un lien (LinkedIn, portfolio), facultatif"},
        }
    ),
    run=_run,
)
