"""Un outil = un atome : sa description pour le modèle et ce qu'il fait sur le CV.
Chaque fichier de ce dossier exporte `TOOL`."""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List


@dataclass
class Run:
    """État d'une exécution : le CV en cours de modification et le journal des changements."""

    state: Dict[str, Any]
    changes: List[str] = field(default_factory=list)
    flags: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: Dict[str, Any]
    run: Callable[[Run, Dict[str, Any]], Dict[str, Any]]

    def spec(self) -> Dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


def params(properties: Dict[str, Any] = None, required: list = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"type": "object", "properties": properties or {}}
    if required:
        out["required"] = required
    return out


SECTION = {"type": "string", "enum": ["education", "experiences"], "description": "education = formation & certifications, experiences = expérience professionnelle"}
