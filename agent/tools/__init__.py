"""Registre : découvre les atomes de ce dossier."""
import importlib
import pkgutil
import os
from typing import Dict, List, Tuple

from .base import Tool

_DIR = os.path.dirname(os.path.abspath(__file__))


def all_tools() -> List[Tool]:
    tools = []
    for info in pkgutil.iter_modules([_DIR]):
        if info.name.startswith("_") or info.name == "base":
            continue
        tool = getattr(importlib.import_module(f"{__name__}.{info.name}"), "TOOL", None)
        if isinstance(tool, Tool):
            tools.append(tool)
    return sorted(tools, key=lambda t: (t.name != "final_answer", t.name))


def available() -> Tuple[List[Dict], Dict[str, Tool]]:
    tools = all_tools()
    return [t.spec() for t in tools], {t.name: t for t in tools}
