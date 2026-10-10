"""Loads a recipe file as a module, inside Blender."""
import importlib.util
import os


def load(path):
    path = os.path.abspath(path)
    spec = importlib.util.spec_from_file_location("recipe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if not hasattr(module, "ITEM") or not isinstance(module.ITEM, dict):
        raise ValueError(f"{path} has no ITEM dict")

    if not callable(getattr(module, "build", None)):
        raise ValueError(f"{path} has no build(kit) function")

    for key in ("kind", "id", "model"):
        if not isinstance(module.ITEM.get(key), str) or not module.ITEM[key]:
            raise ValueError(f"{path}: ITEM[{key!r}] must be a non-empty string")

    return module
