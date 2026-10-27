"""A synthetic USD bundle with local references.

The real scene, ``C:\\Users\\JoshuaRetuta\\Documents\\USD FOLDER\\SOL10.usd``,
references four sibling stages under ``SubUSDs/``. That directory is absent
from the pilot machine, so the real stage opens with unresolved references
and cannot be used as a test fixture.

This module builds an equivalent bundle instead: a root stage that pulls in
a sibling stage through a *relative* reference, plus that sibling stage. The
bundle is self-contained, lives in the repository, and never depends on a
file outside it.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

#: The root stage inside the bundle, as a bundle-relative POSIX path.
ROOT_STAGE = "root.usda"

#: The sibling stage the root stage refers to, relative to the root stage.
DEPENDENCY = "SubUSDs/child.usda"

ROOT_STAGE_TEXT = """#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Z"
    subLayers = [
        @./SubUSDs/child.usda@
    ]
)

def Xform "World"
{
    def Xform "Child"
    {
        double3 xformOp:translate = (1, 2, 3)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
"""

DEPENDENCY_TEXT = """#usda 1.0
(
    defaultPrim = "Child"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "Child"
{
    double3 xformOp:translate = (1, 2, 3)
    uniform token[] xformOpOrder = ["xformOp:translate"]
}
"""


def write_bundle(path: Path) -> Path:
    """Write the bundle to ``path`` and return the path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(ROOT_STAGE, ROOT_STAGE_TEXT)
        archive.writestr(DEPENDENCY, DEPENDENCY_TEXT)
    return path


def bundle_bytes() -> bytes:
    """The same bundle, in memory, for tests that upload it in pieces."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(ROOT_STAGE, ROOT_STAGE_TEXT)
        archive.writestr(DEPENDENCY, DEPENDENCY_TEXT)
    return buffer.getvalue()
