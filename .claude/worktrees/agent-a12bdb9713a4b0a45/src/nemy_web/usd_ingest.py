"""OpenUSD validation, coordinate conversion, source indexing, and PLY.

Called by the ingest worker (Task 5), never by the API. The streaming rule
is one USD attribute in memory at a time: measured on the 6,366,784-splat
acceptance scene this keeps peak RSS at 466 MB instead of 733 MB. Each
attribute is normalized once to an on-disk array (numpy ``open_memmap``),
freed, and only then streamed into the PLY in chunks.
"""

from __future__ import annotations

import gc
import shutil
from itertools import product
from pathlib import Path

import numpy as np
from numpy.lib.format import open_memmap
from pxr import Ar, Sdf, Tf, Usd, UsdGeom

GAUSSIAN_TYPE_NAME = "ParticleField3DGaussianSplat"
REQUIRED_ATTRIBUTES = (
    "positions",
    "scales",
    "orientations",
    "opacities",
    "radiance:sphericalHarmonicsCoefficients",
    "radiance:sphericalHarmonicsDegree",
)
MAX_SH_DEGREE = 3
# 250,000 rows keep the chunk buffers near 60 MB against the 466 MB budget.
CHUNK_ROWS = 250_000
# The uniform-grid rule from the reference crop_tool.py:270-291.
GRID_SIZE = 64


class StageInvalid(ValueError):
    """Validation produced structured errors; the stage is rejected."""

    def __init__(self, errors: list[dict]):
        self.errors = errors
        super().__init__(errors[0]["code"] if errors else "invalid_stage")


def _error(code: str, message: str, prim_path: str | None = None) -> dict:
    error = {"code": code, "message": message}
    if prim_path is not None:
        error["primPath"] = prim_path
    return error


def _coefficients_per_splat(degree: int) -> int:
    return (degree + 1) ** 2


# --------------------------------------------------------------- validation


def _walk_spec_references(spec):
    for reference in list(spec.referenceList.explicitItems) + list(spec.referenceList.addedItems):
        if reference.assetPath:
            yield reference.assetPath
    for payload in list(spec.payloadList.explicitItems) + list(spec.payloadList.addedItems):
        if payload.assetPath:
            yield payload.assetPath
    for child in spec.nameChildren.values():
        yield from _walk_spec_references(child)


def _dependency_errors(stage: Usd.Stage, staged_root: Path) -> list[dict]:
    """Every composed layer and authored asset path must resolve inside the root."""
    errors: list[dict] = []
    resolver = Ar.GetResolver()
    for layer in stage.GetUsedLayers():
        if layer.anonymous or not layer.realPath:
            continue  # the stage session layer
        if not (Path(layer.realPath).is_file()
                and Path(layer.realPath).resolve().is_relative_to(staged_root)):
            errors.append(_error("external_asset",
                                 f"Composed layer {layer.identifier} is outside the staged bundle."))
        for sub_layer in layer.subLayerPaths:
            resolved = resolver.CreateIdentifier(sub_layer, Ar.ResolvedPath(layer.realPath))
            if not (resolved and Path(resolved).is_file()
                    and Path(resolved).resolve().is_relative_to(staged_root)):
                errors.append(_error("external_asset",
                                     f"Sub-layer {sub_layer} does not resolve inside the staged bundle."))
            else:
                errors.extend(_unparsable_layer_errors(resolved))
        for root_spec in layer.rootPrims:
            for asset_path in _walk_spec_references(root_spec):
                resolved = resolver.CreateIdentifier(asset_path, Ar.ResolvedPath(layer.realPath))
                if not (resolved and Path(resolved).is_file()
                        and Path(resolved).resolve().is_relative_to(staged_root)):
                    errors.append(_error("external_asset",
                                         f"Reference {asset_path} does not resolve inside the staged bundle."))
                else:
                    errors.extend(_unparsable_layer_errors(resolved))
    return errors


def _unparsable_layer_errors(resolved: str) -> list[dict]:
    """Stage.Open only warns about a corrupt referenced layer; force a parse."""
    try:
        Sdf.Layer.FindOrOpen(resolved)
    except Tf.ErrorException:
        return [_error("composition_error", f"Layer {resolved} could not be parsed.")]
    return []


def _column_vector_matrix(gf_matrix) -> np.ndarray:
    """A USD row-vector Matrix4d as a column-vector 4x4 (x' = M @ x)."""
    row_vector = np.asarray(gf_matrix, dtype=np.float64)
    matrix = np.eye(4)
    matrix[:3, :3] = row_vector[:3, :3].T
    matrix[:3, 3] = row_vector[3, :3]
    return matrix


def _transform_errors(prim: Usd.Prim) -> list[dict]:
    """Rigid transforms plus uniform scale are supported; shear is not."""
    gf = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
    linear = np.asarray(gf, dtype=np.float64)[:3, :3]
    lengths = np.linalg.norm(linear, axis=1)
    if not np.allclose(lengths, lengths[0], rtol=1e-5):
        return [_error("unsupported_transform",
                       "The prim transform has nonuniform scale.", str(prim.GetPath()))]
    rotation = linear / lengths[0]
    if not np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-5):
        return [_error("unsupported_transform",
                       "The prim transform has shear.", str(prim.GetPath()))]
    if np.linalg.det(linear) <= 0:
        return [_error("unsupported_transform",
                       "The prim transform mirrors the scene.", str(prim.GetPath()))]
    return []


def _prim_errors(prim: Usd.Prim) -> list[dict]:
    """One attribute in memory at a time: the acceptance gate is 466 MB."""
    path = str(prim.GetPath())
    for name in REQUIRED_ATTRIBUTES:
        if not prim.GetAttribute(name).IsAuthored():
            return [_error("missing_attribute", f"Required attribute {name} is not authored.", path)]
    for name in REQUIRED_ATTRIBUTES:
        if prim.GetAttribute(name).GetNumTimeSamples() > 0:
            return [_error("time_varying", f"Attribute {name} has time samples.", path)]

    positions = np.asarray(prim.GetAttribute("positions").Get(), dtype=np.float32)
    if not np.isfinite(positions).all():
        return [_error("nonfinite_data", "Attribute positions holds non-finite values.", path)]
    count = len(positions)
    del positions
    if count == 0:
        return [_error("no_splats", "The prim holds no particles.", path)]

    degree = int(prim.GetAttribute("radiance:sphericalHarmonicsDegree").Get())
    if degree < 0 or degree > MAX_SH_DEGREE:
        return [_error("unsupported_sh_degree", f"SH degree {degree} is unsupported.", path)]

    for name in ("scales", "opacities", "orientations"):
        values = np.asarray(prim.GetAttribute(name).Get(), dtype=np.float32)
        if not np.isfinite(values).all():
            return [_error("nonfinite_data", f"Attribute {name} holds non-finite values.", path)]
        if len(values) != count:
            return [_error("array_length_mismatch",
                           f"Attribute {name} has {len(values)} values for {count} splats.", path)]
        if name == "scales" and not (values > 0).all():
            return [_error("invalid_value", "Scales must be positive.", path)]
        if name == "opacities" and ((values < 0) | (values > 1)).any():
            return [_error("invalid_value", "Opacities must lie in [0, 1].", path)]
        if name == "orientations" and not (np.linalg.norm(values, axis=1) > 0).all():
            return [_error("invalid_value", "Orientations must have nonzero norm.", path)]
        del values

    sh = np.asarray(prim.GetAttribute("radiance:sphericalHarmonicsCoefficients").Get(),
                    dtype=np.float32)
    if not np.isfinite(sh).all():
        return [_error("nonfinite_data", "SH coefficients hold non-finite values.", path)]
    expected = count * _coefficients_per_splat(degree)
    if len(sh) != expected:
        return [_error("array_length_mismatch",
                       f"SH holds {len(sh)} coefficients for {count} splats at degree {degree}.", path)]
    del sh

    errors = _transform_errors(prim)
    if errors:
        return errors
    return []


def validate_stage(staged_root: Path, root_stage: str,
                   source_revision_id: str | None = None) -> list[dict]:
    """Prim records for the Gaussian prims, or structured errors (dicts with "code").

    Assets are checked first: composition that reached outside the staged
    bundle invalidates every prim-level answer.
    """
    staged_root = Path(staged_root).resolve()
    stage_path = staged_root / root_stage
    if not stage_path.resolve().is_relative_to(staged_root):
        return [_error("unsafe_root_stage", f"Root stage {root_stage} escapes the staged bundle.")]
    if not stage_path.is_file():
        return [_error("missing_root_stage", f"Root stage {root_stage} is not in the bundle.")]
    stage = Usd.Stage.Open(str(stage_path))
    dependency_errors = _dependency_errors(stage, staged_root)
    if dependency_errors:
        return dependency_errors

    up_axis = UsdGeom.GetStageUpAxis(stage)
    meters_per_unit = float(UsdGeom.GetStageMetersPerUnit(stage))
    prims = sorted((prim for prim in stage.Traverse()
                    if prim.GetTypeName() == GAUSSIAN_TYPE_NAME),
                   key=lambda prim: str(prim.GetPath()))
    errors: list[dict] = []
    for prim in stage.Traverse():
        if prim.GetTypeName() == GAUSSIAN_TYPE_NAME:
            continue
        if all(prim.GetAttribute(name).IsAuthored() for name in REQUIRED_ATTRIBUTES):
            errors.append(_error("unsupported_prim_type",
                                 f"Prim type {prim.GetTypeName()} carries splat attributes.", str(prim.GetPath())))
    if errors:
        return errors
    for prim in prims:
        errors.extend(_prim_errors(prim))
    if errors:
        return errors
    if not prims:
        return [_error("no_splats", "The stage holds no Gaussian splat prim.", "/")]

    records = []
    for prim in prims:
        record = {
            "sourcePrimPath": str(prim.GetPath()),
            "upAxis": up_axis,
            "metersPerUnit": meters_per_unit,
            "count": len(np.asarray(prim.GetAttribute("positions").Get(), dtype=np.float32)),
            "degree": int(prim.GetAttribute("radiance:sphericalHarmonicsDegree").Get()),
            "usdWorldFromPrimLocal": _column_vector_matrix(
                UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())),
        }
        if source_revision_id is not None:
            record["sourceRevisionId"] = source_revision_id
        records.append(record)
    return records


# --------------------------------------------------------------- coordinates


def web_from_usd_world(up_axis: str, meters_per_unit: float) -> np.ndarray:
    """USD world (meters via the scale, Z-up) to viewer Y-up meters, det(R) = +1.

    Z-up (x, y, z) maps to Y-up (x, z, -y); Y-up keeps the axes.
    """
    scale = float(meters_per_unit)
    if not np.isfinite(scale) or scale <= 0:
        raise ValueError(f"metersPerUnit must be positive, got {meters_per_unit!r}")
    matrix = np.eye(4)
    if up_axis == "Z":
        matrix[:3, :3] = scale * np.array([[1.0, 0.0, 0.0],
                                           [0.0, 0.0, 1.0],
                                           [0.0, -1.0, 0.0]])
    elif up_axis == "Y":
        matrix[:3, :3] = scale * np.eye(3)
    else:
        raise ValueError(f"unsupported up axis {up_axis!r}")
    return matrix


def matrix_column_major(matrix: np.ndarray) -> list[float]:
    """A 4x4 as the 16 column-major numbers Three.js/Spark consume."""
    return [float(value) for value in np.asarray(matrix, dtype=np.float64).T.reshape(-1)]


def logit_opacity(opacities: np.ndarray) -> np.ndarray:
    """logit(clamp(o, nextafter(0,1), nextafter(1,0))) so endpoints stay finite."""
    values = np.clip(np.asarray(opacities, dtype=np.float64),
                     float(np.nextafter(0.0, 1.0)), float(np.nextafter(1.0, 0.0)))
    return np.log(values / (1.0 - values)).astype(np.float32)


def log_scales(scales: np.ndarray) -> np.ndarray:
    return np.log(np.asarray(scales, dtype=np.float64)).astype(np.float32)


def normalized_rotations(orientations: np.ndarray) -> np.ndarray:
    """USD quatf arrays read back as (x, y, z, w); emit normalized (w, x, y, z)."""
    quats = np.asarray(orientations, dtype=np.float64).reshape(-1, 4)
    norms = np.linalg.norm(quats, axis=1, keepdims=True)
    wxyz = np.concatenate([quats[:, 3:4], quats[:, 0:3]], axis=1)
    return (wxyz / norms).astype(np.float32)


# -------------------------------------------------------------- source index


def build_source_index(positions: np.ndarray, output_dir: Path,
                       grid_size: int = GRID_SIZE) -> dict:
    """positions.npy + stable uint64 order.npy + cells.npz, per crop_tool.py:270-291.

    Bounds come from the actual grouped points: float32 cell arithmetic can
    round a point across an ideal grid edge, so cell bounds would exclude a hit.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    positions = np.asarray(positions, dtype=np.float32)
    count = len(positions)
    if count == 0:
        raise ValueError("The source index needs at least one position.")
    np.save(output_dir / "positions.npy", positions, allow_pickle=False)

    lower = positions.min(axis=0)
    upper = positions.max(axis=0)
    step = np.maximum((upper - lower) / grid_size, np.float32(1e-12))
    keys = np.empty(count, dtype=np.int32)
    for start in range(0, count, CHUNK_ROWS):
        stop = min(start + CHUNK_ROWS, count)
        cell = np.clip(((positions[start:stop] - lower) / step).astype(np.int64),
                       0, grid_size - 1)
        keys[start:stop] = (cell[:, 0] + grid_size * cell[:, 1]
                            + grid_size * grid_size * cell[:, 2])

    order = np.argsort(keys, kind="stable").astype(np.uint64)
    sorted_keys = keys[order]
    starts = np.concatenate([[0], np.flatnonzero(np.diff(sorted_keys)) + 1]).astype(np.uint64)
    ends = np.concatenate([starts[1:], [count]]).astype(np.uint64)

    block_lower = np.empty((len(starts), 3), dtype=np.float64)
    block_upper = np.empty_like(block_lower)
    for axis in range(3):
        values = positions[order, axis]  # one axis at a time: no second Nx3 copy
        block_lower[:, axis] = np.minimum.reduceat(values, starts.astype(np.intp))
        block_upper[:, axis] = np.maximum.reduceat(values, starts.astype(np.intp))
        del values

    np.save(output_dir / "order.npy", order, allow_pickle=False)
    np.savez(output_dir / "cells.npz", keys=sorted_keys.astype(np.uint64),
             starts=starts, ends=ends, lower=block_lower, upper=block_upper)
    return {"count": count, "gridSize": grid_size, "cells": len(starts),
            "lower": lower.tolist(), "upper": upper.tolist()}


# ------------------------------------------------------------------ PLY writer


def _ply_header(count: int, degree: int) -> bytes:
    rest_count = 3 * (_coefficients_per_splat(degree) - 1)
    properties = (["x", "y", "z"]
                  + [f"f_dc_{c}" for c in range(3)]
                  + [f"f_rest_{i}" for i in range(rest_count)]
                  + ["opacity", "scale_0", "scale_1", "scale_2",
                     "rot_0", "rot_1", "rot_2", "rot_3"])
    lines = ["ply", "format binary_little_endian 1.0", f"element vertex {count}"]
    lines += [f"property float {name}" for name in properties]
    lines.append("end_header")
    return ("\n".join(lines) + "\n").encode("ascii")


def write_ply(path: Path, positions, center, scales, orientations, opacities, sh,
              degree: int, chunk_rows: int = CHUNK_ROWS, progress=None) -> None:
    """Stream Graphdeco-ordered binary rows from array-likes (memmaps or ndarrays).

    ``sh`` keeps the USD layout (n, ncoeff, 3); each chunk is transposed to the
    channel-major f_rest order. Conversions run per chunk in float64.
    """
    count = len(positions)
    with open(path, "wb") as output:
        output.write(_ply_header(count, degree))
        row_floats = 3 + 3 + 3 * (_coefficients_per_splat(degree) - 1) + 1 + 3 + 4
        for start in range(0, count, chunk_rows):
            stop = min(start + chunk_rows, count)
            rows = stop - start
            block = np.empty((rows, row_floats), dtype=np.float32)
            block[:, 0:3] = (positions[start:stop].astype(np.float64) - center).astype(np.float32)
            chunk = np.asarray(sh[start:stop])  # (rows, ncoeff, 3)
            block[:, 3:6] = chunk[:, 0, :]
            if degree > 0:
                # f_rest[c][k] = sh[k][c]: transpose to (rows, 3, k) channel-major.
                rest = np.transpose(chunk[:, 1:, :], (0, 2, 1)).reshape(rows, -1)
                block[:, 6:6 + rest.shape[1]] = rest
            opacity_column = 6 + 3 * (_coefficients_per_splat(degree) - 1)
            block[:, opacity_column] = logit_opacity(opacities[start:stop])
            block[:, opacity_column + 1:opacity_column + 4] = log_scales(scales[start:stop])
            block[:, opacity_column + 4:opacity_column + 8] = normalized_rotations(
                orientations[start:stop])
            output.write(block.tobytes())
            if progress is not None:
                progress(stop, count)


# ------------------------------------------------------------------ conversion


def _load_attribute(prim: Usd.Prim, name: str) -> np.ndarray:
    """One USD attribute as a float32 numpy view; the Vt array dies with it."""
    return np.asarray(prim.GetAttribute(name).Get(), dtype=np.float32)


def _memmap_copy(directory: Path, name: str, values: np.ndarray) -> np.ndarray:
    """Copy a resident array to disk in chunks so RSS holds one array, not two."""
    target = open_memmap(directory / name, mode="w+", dtype=np.float32, shape=values.shape)
    try:
        for start in range(0, len(values), CHUNK_ROWS):
            stop = min(start + CHUNK_ROWS, len(values))
            target[start:stop] = values[start:stop]
            target.flush()
    except BaseException:
        # The exception's traceback keeps `target` alive past cleanup, and the
        # open mmap stops Windows from deleting the file. Close it here.
        target._mmap.close()
        raise
    return target


def _web_bounds(usd_from_local: np.ndarray, web: np.ndarray, lower, upper) -> tuple[np.ndarray, np.ndarray]:
    """Affine transforms map extremes to extremes, so transform the 8 corners."""
    corners = np.array(list(product((lower[0], upper[0]), (lower[1], upper[1]),
                                    (lower[2], upper[2]))), dtype=np.float64)
    combined = web @ usd_from_local
    points = corners @ combined[:3, :3].T + combined[:3, 3]
    return points.min(axis=0), points.max(axis=0)


def _release(*arrays) -> None:
    """Close numpy memmaps so Windows lets go of the files they back."""
    for array in arrays:
        mmap = getattr(array, "_mmap", None)
        if mmap is not None:
            mmap.close()


def _convert_prim(prim: Usd.Prim, record: dict, ordinal: int, output_dir: Path,
                  web: np.ndarray, project_id: str, chunk_rows: int,
                  progress) -> tuple[dict, list[Path]]:
    name = f"prim-{ordinal:03d}"
    ply_path = output_dir / f"{name}.ply"
    index_dir = output_dir / "source-index" / name
    raw_dir = output_dir / f"raw-{name}"
    created = [ply_path, index_dir, raw_dir]
    try:
        return _convert_prim_body(prim, record, name, ply_path, index_dir, raw_dir,
                                  web, project_id, chunk_rows, progress)
    except BaseException:
        gc.collect()  # drop arrays the frame above could not reach
        for path in created:
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
        raise


def _convert_prim_body(prim: Usd.Prim, record: dict, name: str, ply_path: Path,
                       index_dir: Path, raw_dir: Path, web: np.ndarray,
                       project_id: str, chunk_rows: int, progress) -> tuple[dict, list[Path]]:
    index_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    count = record["count"]
    degree = record["degree"]
    ncoeff = _coefficients_per_splat(degree)

    positions = _load_attribute(prim, "positions")
    center = positions.astype(np.float64).mean(axis=0)
    index = build_source_index(positions, index_dir)
    lower, upper = np.asarray(index["lower"]), np.asarray(index["upper"])
    del positions

    sh = _memmap_copy(raw_dir, "sh.npy",
                      _load_attribute(prim, "radiance:sphericalHarmonicsCoefficients")
                      .reshape(count, ncoeff, 3))
    scales = _memmap_copy(raw_dir, "scales.npy", _load_attribute(prim, "scales"))
    orientations = _memmap_copy(raw_dir, "orientations.npy",
                                _load_attribute(prim, "orientations").reshape(count, 4))
    opacities = _memmap_copy(raw_dir, "opacities.npy", _load_attribute(prim, "opacities"))
    position_map = open_memmap(index_dir / "positions.npy", mode="r")

    try:
        write_ply(ply_path, position_map, center, scales, orientations, opacities, sh,
                  degree, chunk_rows=chunk_rows, progress=progress)
    finally:
        _release(sh, scales, orientations, opacities, position_map)
    del sh, scales, orientations, opacities, position_map
    shutil.rmtree(raw_dir)

    bounds_min, bounds_max = _web_bounds(record["usdWorldFromPrimLocal"], web, lower, upper)
    centered = web @ record["usdWorldFromPrimLocal"]
    centered[:3, 3] += centered[:3, :3] @ center
    entry = {
        "sourcePrimPath": record["sourcePrimPath"],
        "count": count,
        "boundsWeb": {"min": bounds_min.tolist(), "max": bounds_max.tolist()},
        "webFromPrimLocalCentered": matrix_column_major(centered),
        "radUrl": f"/media/{project_id}/scene/{name}.rad",
        "sourceIndex": {
            "positions": f"source-index/{name}/positions.npy",
            "order": f"source-index/{name}/order.npy",
            "cells": f"source-index/{name}/cells.npz",
            "gridSize": index["gridSize"],
        },
    }
    return entry, [ply_path, index_dir, raw_dir]


def _project_placeholder() -> str:
    return "{projectId}"


def convert(staged_root: Path, root_stage: str, source_revision_id: str, output_dir: Path,
            project_id: str | None = None, chunk_rows: int = CHUNK_ROWS,
            progress=None) -> dict:
    """Validate, index, and write the per-prim PLYs; return the manifest dict.

    Creates ``prim-NNN.ply`` and ``source-index/prim-NNN/`` below ``output_dir``
    (an unpublished temporary directory). Any exception removes the created
    PLYs and index directories before propagating. ``project_id`` fills the
    media URL; the literal ``{projectId}`` placeholder is used when unknown.
    """
    records = validate_stage(staged_root, root_stage, source_revision_id)
    if any("code" in record for record in records):
        raise StageInvalid([record for record in records if "code" in record])
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stage = Usd.Stage.Open(str(Path(staged_root).resolve() / root_stage))
    web = web_from_usd_world(records[0]["upAxis"], records[0]["metersPerUnit"])
    created: list[Path] = []
    try:
        manifest_prims = []
        union_min = np.full(3, np.inf)
        union_max = np.full(3, -np.inf)
        for ordinal, record in enumerate(records):
            entry, paths = _convert_prim(stage.GetPrimAtPath(record["sourcePrimPath"]),
                                         record, ordinal, output_dir, web,
                                         project_id or _project_placeholder(),
                                         chunk_rows, progress)
            created.extend(paths)
            manifest_prims.append(entry)
            union_min = np.minimum(union_min, entry["boundsWeb"]["min"])
            union_max = np.maximum(union_max, entry["boundsWeb"]["max"])
        return {
            "schemaVersion": 1,
            "sourceRevisionId": source_revision_id,
            "stage": {"upAxis": records[0]["upAxis"],
                      "metersPerUnit": records[0]["metersPerUnit"]},
            "webFromUsdWorld": matrix_column_major(web),
            "boundsWeb": {"min": union_min.tolist(), "max": union_max.tolist()},
            "prims": manifest_prims,
        }
    except BaseException:
        for path in reversed(created):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
        raise
