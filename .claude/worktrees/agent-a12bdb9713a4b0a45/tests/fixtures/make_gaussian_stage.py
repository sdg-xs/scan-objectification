"""Deterministic OpenUSD Gaussian-splat fixtures for the ingest tests.

Every stage is generated on disk at test time; no binary USD file is
committed. Values are chosen so an ordering mistake cannot pass: the
degree-1 fixture uses distinct per-channel SH coefficients, and the
quaternion text order is (w, x, y, z) while OpenUSD reads quatf arrays
back in (x, y, z, w) memory order.
"""

from __future__ import annotations

from pathlib import Path

from pxr import Gf, Sdf, Usd, UsdGeom, Vt

GAUSSIAN_TYPE = "ParticleField3DGaussianSplat"
METERS_PER_UNIT = 0.01
WORLD_TRANSLATE = (10.0, 20.0, 30.0)
POSITIONS = [(0.0, 0.0, 0.0), (2.0, 1.0, 3.0)]
SCALES = [(0.1, 0.2, 0.3), (0.4, 0.5, 0.6)]
ORIENTATIONS = [(1.0, 0.0, 0.0, 0.0), (0.70710678, 0.0, 0.0, 0.70710678)]
OPACITIES = (0.25, 0.75)


def write_stage(directory: Path, text: str, name: str = "stage.usda") -> Path:
    """Write one stage file below ``directory`` and return the directory.

    Every ``write_*`` function returns the staged directory, ready for
    ``validate_stage(directory, name)``.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(text, encoding="utf-8")
    return directory


def degree_coefficients(degree: int, splats: int = 2) -> list[tuple[float, float, float]]:
    """Flat per-splat coefficient-major float3 values, distinct per channel."""
    if degree == 0:
        return [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]  # known red, then green
    return [tuple(100.0 * s + 10.0 * k + c + 1.0 for c in range(3))
            for s in range(splats) for k in range((degree + 1) ** 2)]


def _tuple_array(values) -> str:
    return "[" + ", ".join("(" + ", ".join(repr(float(v)) for v in tup) + ")"
                           for tup in values) + "]"


def _splat_attributes(positions=POSITIONS, scales=SCALES, orientations=ORIENTATIONS,
                      opacities=OPACITIES, degree=0, coefficients=None) -> str:
    coefficients = _tuple_array(degree_coefficients(degree) if coefficients is None
                                 else coefficients)
    quats = _tuple_array(orientations)  # same four-number tuple shape
    return "\n".join([
        f"        float3[] positions = {_tuple_array(positions)}",
        f"        float3[] scales = {_tuple_array(scales)}",
        f"        quatf[] orientations = {quats}",
        f"        float[] opacities = [{', '.join(str(o) for o in opacities)}]",
        f"        int radiance:sphericalHarmonicsDegree = {degree}",
        f"        float3[] radiance:sphericalHarmonicsCoefficients = {coefficients}",
    ])


def _stage_text(children: str, meters: float = METERS_PER_UNIT, up: str = "Z",
                translate=WORLD_TRANSLATE) -> str:
    return f"""#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = {meters}
    upAxis = "{up}"
)

def Xform "World"
{{
    double3 xformOp:translate = ({translate[0]}, {translate[1]}, {translate[2]})
    uniform token[] xformOpOrder = ["xformOp:translate"]

{children}
}}
"""


def _splat_prim_text(*, name="Splats", prim_type=GAUSSIAN_TYPE, degree=0,
                     positions=POSITIONS, scales=SCALES, orientations=ORIENTATIONS,
                     opacities=OPACITIES, coefficients=None, xform="") -> str:
    attributes = _splat_attributes(positions, scales, orientations, opacities, degree,
                                   coefficients)
    return f"""    def {prim_type} "{name}"
    {{
{xform}
{attributes}
    }}"""


def write_valid_stage(directory: Path, *, degree: int = 0, name: str = "stage.usda",
                      opacities=OPACITIES, orientations=ORIENTATIONS,
                      scales=SCALES, positions=POSITIONS,
                      coefficients=None) -> Path:
    return write_stage(directory, _stage_text(_splat_prim_text(
        degree=degree, opacities=opacities, orientations=orientations, scales=scales,
        positions=positions, coefficients=coefficients)), name=name)


def write_referenced_stage(directory: Path) -> Path:
    """A root stage that pulls the splat prim from a sibling layer by reference."""
    dependency = f"""#usda 1.0
(
    defaultPrim = "Splats"
)

def {GAUSSIAN_TYPE} "Splats"
{{
{_splat_attributes()}
}}
"""
    write_stage(directory, dependency, name="splats.usda")
    root = f"""#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = {METERS_PER_UNIT}
    upAxis = "Z"
)

def Xform "World"
{{
    double3 xformOp:translate = ({WORLD_TRANSLATE[0]}, {WORLD_TRANSLATE[1]}, {WORLD_TRANSLATE[2]})
    uniform token[] xformOpOrder = ["xformOp:translate"]

    def {GAUSSIAN_TYPE} "Splats" (
        references = @./splats.usda@</Splats>
    )
    {{
    }}
}}
"""
    return write_stage(directory, root, name="root.usda")


def write_mismatched_stage(directory: Path) -> Path:
    """One fewer opacity than splats."""
    return write_valid_stage(directory, opacities=(0.5,))


def write_nan_stage(directory: Path) -> Path:
    return write_valid_stage(directory, positions=[(0.0, 0.0, 0.0), (float("nan"), 1.0, 2.0)])


def write_empty_stage(directory: Path) -> Path:
    return write_valid_stage(directory, positions=[], scales=[], orientations=[],
                             opacities=[], coefficients=[])


def write_timed_stage(directory: Path) -> Path:
    """Positions with time samples, authored through the API (text cannot)."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    stage = Usd.Stage.CreateNew(str(directory / "stage.usda"))
    UsdGeom.SetStageUpAxis(stage, "Z")
    UsdGeom.SetStageMetersPerUnit(stage, METERS_PER_UNIT)
    world = UsdGeom.Xform.Define(stage, "/World")
    world.AddTranslateOp().Set(Gf.Vec3d(*WORLD_TRANSLATE))
    prim = stage.DefinePrim("/World/Splats", GAUSSIAN_TYPE)
    moving = prim.CreateAttribute("positions", Sdf.ValueTypeNames.Float3Array)
    moving.Set(POSITIONS, time=Usd.TimeCode(1.0))
    moving.Set([(9.0, 9.0, 9.0)] * 2, time=Usd.TimeCode(2.0))
    prim.CreateAttribute("scales", Sdf.ValueTypeNames.Float3Array).Set(SCALES)
    prim.CreateAttribute("orientations", Sdf.ValueTypeNames.QuatfArray).Set(
        Vt.QuatfArray([Gf.Quatf(w, Gf.Vec3f(x, y, z))
                       for w, x, y, z in ORIENTATIONS]))
    prim.CreateAttribute("opacities", Sdf.ValueTypeNames.FloatArray).Set(list(OPACITIES))
    prim.CreateAttribute("radiance:sphericalHarmonicsDegree",
                         Sdf.ValueTypeNames.Int).Set(0)
    prim.CreateAttribute("radiance:sphericalHarmonicsCoefficients",
                         Sdf.ValueTypeNames.Float3Array).Set(degree_coefficients(0))
    stage.Save()
    return directory


def _reference_stage_text(target: str) -> str:
    return f"""#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = {METERS_PER_UNIT}
    upAxis = "Z"
)

def Xform "World"
{{
    def {GAUSSIAN_TYPE} "Splats" (
        references = @{target}@
    )
    {{
    }}
}}
"""


def write_unresolved_reference_stage(directory: Path) -> Path:
    return write_stage(directory, _reference_stage_text("./missing.usda"))


def write_absolute_reference_stage(directory: Path) -> Path:
    return write_stage(directory, _reference_stage_text("C:/nemy-fixtures-absent.usda"))


def write_corrupt_reference_stage(directory: Path) -> Path:
    """A referenced layer that exists inside the root but cannot be parsed."""
    staged = write_stage(directory, _reference_stage_text("./corrupt.usda"))
    (staged / "corrupt.usda").write_bytes(b"\x00\x01\x02 not a layer at all")
    return staged


def write_mirrored_stage(directory: Path) -> Path:
    """A reflection: uniform, orthonormal, but determinant -1."""
    xform = '        double3 xformOp:scale = (-1, -1, -1)\n' \
            '        uniform token[] xformOpOrder = ["xformOp:scale"]'
    return write_stage(directory, _stage_text(_splat_prim_text(xform=xform)))


def write_nonuniform_scale_stage(directory: Path) -> Path:
    xform = '        double3 xformOp:scale = (1, 2, 1)\n' \
            '        uniform token[] xformOpOrder = ["xformOp:scale"]'
    return write_stage(directory, _stage_text(_splat_prim_text(xform=xform)))


def write_shear_stage(directory: Path) -> Path:
    xform = "        matrix4d xformOp:transform = ((1, 0, 0, 0), (0.5, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1))\n" \
            '        uniform token[] xformOpOrder = ["xformOp:transform"]'
    return write_stage(directory, _stage_text(_splat_prim_text(xform=xform)))


def write_unsupported_type_stage(directory: Path) -> Path:
    """A Points prim carrying the full splat attribute set."""
    return write_stage(directory, _stage_text(_splat_prim_text(prim_type="Points")))


def write_degree4_stage(directory: Path) -> Path:
    return write_stage(directory, _stage_text(_splat_prim_text(
        degree=4, coefficients=[(1.0, 0.0, 0.0), (0.0, 1.0, 0.0)])))
