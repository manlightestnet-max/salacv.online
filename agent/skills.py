"""Skills : dossiers de agent/skills contenant un skill.md avec un en-tête simple (title, description)."""
import os
from typing import Dict, List, Optional, Tuple

from .config import SKILLS_DIR


def _parse(path: str) -> Tuple[Dict[str, str], str]:
    with open(path, "r", encoding="utf-8") as handle:
        content = handle.read().replace("\r\n", "\n")
    if content.startswith("---\n"):
        parts = content.split("---\n", 2)
        if len(parts) == 3:
            meta = dict(line.split(":", 1) for line in parts[1].strip().splitlines() if ":" in line)
            return {k.strip(): v.strip() for k, v in meta.items()}, parts[2].strip()
    return {}, content.strip()


def _files() -> List[Tuple[str, str]]:
    if not os.path.isdir(SKILLS_DIR):
        return []
    return sorted((d, os.path.join(SKILLS_DIR, d, "skill.md")) for d in os.listdir(SKILLS_DIR) if os.path.isfile(os.path.join(SKILLS_DIR, d, "skill.md")))


def catalog() -> List[Dict[str, str]]:
    return [{"slug": slug, "title": _parse(path)[0].get("title", slug), "description": _parse(path)[0].get("description", "")} for slug, path in _files()]


def load(slug: str) -> Optional[str]:
    path = dict(_files()).get(slug)
    return _parse(path)[1] if path else None
