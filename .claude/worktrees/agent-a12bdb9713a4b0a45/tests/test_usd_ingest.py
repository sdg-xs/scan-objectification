"""Task 4: USD validation, coordinate conversion, source index, and PLY."""

from __future__ import annotations

import numpy as np
import pytest

from nemy_web import usd_ingest
from tests.fixtures import make_gaussian_stage as fixtures


def read_ply(path):
    """Parse a little-endian binary PLY into (rows, property names)."""
    with open(path, "rb") as handle:
        assert handle.readline().strip() == b"ply"
        assert handle.readline().strip() == b"format binary_little_endian 1.0"
        properties: list[str] = []
        count = 0
        while True:
            line = handle.readline().strip()
            if line == b"end_header":
                break
            parts = line.split()
            if parts[0] == b"element":
                count = int(parts[2])
            elif parts[0] == b"property":
                properties.append(parts[2].decode())
        rows = np.fromfile(handle, dtype="<f4", count=count * len(properties))
    return rows.reshape(count, len(properties)), properties


# ---------------------------------------------------------------- validation


def test_a_valid_stage_returns_one_deterministic_record(tmp_path):
    staged = fixtures.write_valid_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda", source_revision_id="rev-1")
    assert len(records) == 1
    record = records[0]
    assert record["sourcePrimPath"] == "/World/Splats"
    assert record["upAxis"] == "Z"
    assert record["metersPerUnit"] == fixtures.METERS_PER_UNIT
    assert record["count"] == 2
    assert record["degree"] == 0
    assert record["sourceRevisionId"] == "rev-1"
    matrix = np.asarray(record["usdWorldFromPrimLocal"], dtype=float)
    assert np.allclose(matrix[:3, 3], fixtures.WORLD_TRANSLATE)
    assert np.allclose(matrix[:3, :3], np.eye(3))


def test_a_local_referenced_layer_composes_into_the_record(tmp_path):
    staged = fixtures.write_referenced_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "root.usda", source_revision_id="rev-1")
    assert [r["sourcePrimPath"] for r in records] == ["/World/Splats"]
    assert records[0]["count"] == 2
    assert np.allclose(np.asarray(records[0]["usdWorldFromPrimLocal"])[:3, 3],
                       fixtures.WORLD_TRANSLATE)


def test_mismatched_array_lengths_are_rejected(tmp_path):
    staged = fixtures.write_mismatched_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["array_length_mismatch"]


def test_nan_values_are_rejected(tmp_path):
    staged = fixtures.write_nan_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["nonfinite_data"]


def test_zero_particles_are_rejected(tmp_path):
    staged = fixtures.write_empty_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["no_splats"]


def test_time_samples_are_rejected(tmp_path):
    staged = fixtures.write_timed_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["time_varying"]


def test_unresolved_references_are_rejected(tmp_path):
    staged = fixtures.write_unresolved_reference_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["external_asset"]


def test_absolute_external_references_are_rejected(tmp_path):
    staged = fixtures.write_absolute_reference_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["external_asset"]


def test_nonuniform_scale_is_an_unsupported_transform(tmp_path):
    staged = fixtures.write_nonuniform_scale_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["unsupported_transform"]


def test_shear_is_an_unsupported_transform(tmp_path):
    staged = fixtures.write_shear_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["unsupported_transform"]


def test_a_mirrored_transform_is_an_unsupported_transform(tmp_path):
    staged = fixtures.write_mirrored_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["unsupported_transform"]


def test_a_corrupt_referenced_layer_is_a_composition_error(tmp_path):
    staged = fixtures.write_corrupt_reference_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["composition_error"]


def test_a_root_stage_that_escapes_the_bundle_is_rejected(tmp_path):
    staged = fixtures.write_valid_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "../outside.usda")
    assert [r["code"] for r in records] == ["unsafe_root_stage"]


def test_an_unsupported_prim_type_is_rejected(tmp_path):
    staged = fixtures.write_unsupported_type_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["unsupported_prim_type"]


def test_an_unsupported_sh_degree_is_rejected(tmp_path):
    staged = fixtures.write_degree4_stage(tmp_path / "staged")
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["unsupported_sh_degree"]


def test_nonpositive_scales_are_rejected(tmp_path):
    staged = fixtures.write_valid_stage(
        tmp_path / "staged", scales=[(0.0, 0.2, 0.3), (0.4, 0.5, 0.6)])
    records = usd_ingest.validate_stage(staged, "stage.usda")
    assert [r["code"] for r in records] == ["invalid_value"]


# --------------------------------------------------------------- coordinates


def test_web_from_usd_world_maps_z_up_to_y_up_and_round_trips():
    matrix = usd_ingest.web_from_usd_world("Z", 0.01)
    rotation = matrix[:3, :3] / 0.01
    assert round(float(np.linalg.det(rotation)), 9) == 1.0
    point = np.array([579502.33, 6633706.91, 187.05])
    web = matrix[:3, :3] @ point + matrix[:3, 3]
    assert np.allclose(web, np.array([point[0], point[2], -point[1]]) * 0.01)
    inverse = np.linalg.inv(matrix)
    back = inverse[:3, :3] @ web + inverse[:3, 3]
    assert np.allclose(back, point, atol=1e-5)


def test_web_from_usd_world_keeps_y_up_axes():
    matrix = usd_ingest.web_from_usd_world("Y", 0.5)
    assert np.allclose(matrix[:3, :3], 0.5 * np.eye(3))
    with pytest.raises(ValueError):
        usd_ingest.web_from_usd_world("X", 1.0)


def test_manifest_matrices_are_column_major():
    translation = np.eye(4)
    translation[:3, 3] = (1.0, 2.0, 3.0)
    flat = usd_ingest.matrix_column_major(translation)
    assert len(flat) == 16
    assert flat[12:15] == [1.0, 2.0, 3.0]
    assert flat[0] == 1.0 and flat[5] == 1.0 and flat[10] == 1.0 and flat[15] == 1.0


# -------------------------------------------------------------- source index


def test_source_index_is_a_lossless_stable_permutation(tmp_path):
    rng = np.random.default_rng(7)
    positions = rng.uniform(0.0, 1.0, (500, 3)).astype(np.float32)
    positions[10] = positions[11]  # one cell with two points, to pin stability
    index_dir = tmp_path / "index"
    index = usd_ingest.build_source_index(positions, index_dir)
    assert index["gridSize"] == 64
    assert index["count"] == 500
    assert np.array_equal(np.load(index_dir / "positions.npy"), positions)

    order = np.load(index_dir / "order.npy")
    assert order.dtype == np.uint64
    assert sorted(order.tolist()) == list(range(500))

    # The crop_tool.py rule, recomputed independently.
    lower, upper = positions.min(axis=0), positions.max(axis=0)
    step = np.maximum((upper - lower) / 64, 1e-12)
    cell = np.clip(((positions - lower) / step).astype(np.int64), 0, 63)
    keys = cell[:, 0] + 64 * cell[:, 1] + 4096 * cell[:, 2]
    assert np.array_equal(order.astype(np.int64), np.argsort(keys, kind="stable"))

    cells = np.load(index_dir / "cells.npz")
    starts, ends = cells["starts"], cells["ends"]
    assert len(starts) == len(np.unique(keys))
    # A stable sort keeps equal keys in original order: each block ascends.
    for start, end in zip(starts.tolist(), ends.tolist()):
        assert np.all(np.diff(order[start:end].astype(np.int64)) > 0)
    # Bounds come from the actual grouped points, exactly.
    for number, (start, end) in enumerate(zip(starts.tolist(), ends.tolist())):
        block = positions[order[start:end].astype(np.int64)]
        assert np.array_equal(block.min(axis=0), cells["lower"][number])
        assert np.array_equal(block.max(axis=0), cells["upper"][number])

    # A box query never excludes a brute-force hit.
    box_min = lower + 0.3 * (upper - lower)
    box_max = lower + 0.7 * (upper - lower)
    brute = np.flatnonzero(((positions >= box_min) & (positions <= box_max)).all(axis=1))
    overlapping = ~((cells["upper"] < box_min).any(axis=1) | (cells["lower"] > box_max).any(axis=1))
    candidates = np.concatenate([order[starts[i]:ends[i]] for i in np.flatnonzero(overlapping)])
    assert set(brute.tolist()) <= set(candidates.tolist())


# -------------------------------------------------------- conversion and PLY


def test_convert_writes_the_manifest_and_recentered_ply_rows(tmp_path):
    staged = fixtures.write_valid_stage(tmp_path / "staged")
    out = tmp_path / "out"
    manifest = usd_ingest.convert(staged, "stage.usda", "rev-1", out, project_id="p-1")

    assert manifest["schemaVersion"] == 1
    assert manifest["sourceRevisionId"] == "rev-1"
    assert manifest["stage"] == {"upAxis": "Z", "metersPerUnit": fixtures.METERS_PER_UNIT}
    web = usd_ingest.web_from_usd_world("Z", fixtures.METERS_PER_UNIT)
    assert manifest["webFromUsdWorld"] == usd_ingest.matrix_column_major(web)
    assert len(manifest["prims"]) == 1
    prim = manifest["prims"][0]
    assert prim["sourcePrimPath"] == "/World/Splats"
    assert prim["count"] == 2
    assert prim["radUrl"] == "/media/p-1/scene/prim-000.rad"
    assert prim["sourceIndex"]["gridSize"] == 64
    for name in ("positions.npy", "order.npy", "cells.npz"):
        assert (out / "source-index" / "prim-000" / name).is_file()
    assert (out / "prim-000.ply").is_file()

    rows, properties = read_ply(out / "prim-000.ply")
    assert properties == ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2",
                          "opacity", "scale_0", "scale_1", "scale_2",
                          "rot_0", "rot_1", "rot_2", "rot_3"]
    center = np.mean(fixtures.POSITIONS, axis=0)
    assert np.allclose(rows[0, :3], np.subtract(fixtures.POSITIONS[0], center), atol=1e-6)
    assert np.allclose(rows[1, :3], np.subtract(fixtures.POSITIONS[1], center), atol=1e-6)
    assert np.allclose(rows[0, 3:6], (1.0, 0.0, 0.0), atol=1e-6)  # red
    assert np.allclose(rows[1, 3:6], (0.0, 1.0, 0.0), atol=1e-6)  # green
    assert np.allclose(rows[:, 6], usd_ingest.logit_opacity(np.asarray(fixtures.OPACITIES)))
    assert np.allclose(rows[0, 7:10], np.log(fixtures.SCALES[0]), atol=1e-6)
    assert np.allclose(rows[1, 7:10], np.log(fixtures.SCALES[1]), atol=1e-6)
    assert np.allclose(rows[0, 10:14], (1.0, 0.0, 0.0, 0.0), atol=1e-6)
    assert np.allclose(rows[1, 10:14], fixtures.ORIENTATIONS[1], atol=1e-5)

    # The per-prim matrix maps the stored recentered row back into web space.
    matrix = np.asarray(prim["webFromPrimLocalCentered"], dtype=float).reshape(4, 4, order="F")
    for row, expected in zip(rows[:, :3],
                             ((0.10, 0.30, -0.20), (0.12, 0.33, -0.21))):
        point = matrix[:3, :3] @ row + matrix[:3, 3]
        assert np.allclose(point, expected, atol=1e-5)
    assert np.allclose(prim["boundsWeb"]["min"], (0.10, 0.30, -0.21), atol=1e-6)
    assert np.allclose(prim["boundsWeb"]["max"], (0.12, 0.33, -0.20), atol=1e-6)
    assert manifest["boundsWeb"] == prim["boundsWeb"]


def test_convert_transposes_degree1_sh_channel_major(tmp_path):
    staged = fixtures.write_valid_stage(tmp_path / "staged", degree=1)
    out = tmp_path / "out"
    manifest = usd_ingest.convert(staged, "stage.usda", "rev-1", out)
    rows, properties = read_ply(out / "prim-000.ply")
    assert properties[3:15] == [f"f_dc_{c}" for c in range(3)] + [f"f_rest_{i}" for i in range(9)]
    assert np.allclose(rows[0, 3:6], (1.0, 2.0, 3.0), atol=1e-6)
    assert np.allclose(rows[0, 6:15], (11.0, 21.0, 31.0, 12.0, 22.0, 32.0, 13.0, 23.0, 33.0), atol=1e-5)
    assert np.allclose(rows[1, 3:6], (101.0, 102.0, 103.0), atol=1e-4)
    assert np.allclose(rows[1, 6:15],
                       (111.0, 121.0, 131.0, 112.0, 122.0, 132.0, 113.0, 123.0, 133.0), atol=1e-3)
    assert manifest["prims"][0]["count"] == 2


def test_convert_clamps_opacity_endpoints(tmp_path):
    staged = fixtures.write_valid_stage(tmp_path / "staged", opacities=(0.0, 1.0))
    out = tmp_path / "out"
    usd_ingest.convert(staged, "stage.usda", "rev-1", out)
    rows, _ = read_ply(out / "prim-000.ply")
    assert np.isfinite(rows[:, 6]).all()
    assert rows[0, 6] < -100.0
    # logit(nextafter(1, 0)) is the largest finite logit (~36.7 in float32).
    assert rows[1, 6] > 30.0
    clamped = usd_ingest.logit_opacity(np.array([0.0, 1.0]))
    assert np.array_equal(
        clamped, usd_ingest.logit_opacity(np.array([np.nextafter(0.0, 1.0),
                                                    np.nextafter(1.0, 0.0)])))


def test_convert_normalizes_nonunit_quaternions(tmp_path):
    staged = fixtures.write_valid_stage(
        tmp_path / "staged", orientations=[(0.0, 0.0, 0.0, 2.0), (1.0, 0.0, 0.0, 0.0)])
    out = tmp_path / "out"
    usd_ingest.convert(staged, "stage.usda", "rev-1", out)
    rows, _ = read_ply(out / "prim-000.ply")
    assert np.allclose(rows[0, 10:14], (0.0, 0.0, 0.0, 1.0), atol=1e-6)
    assert np.allclose(rows[1, 10:14], (1.0, 0.0, 0.0, 0.0), atol=1e-6)


def test_convert_reports_progress_between_chunks(tmp_path):
    staged = fixtures.write_valid_stage(tmp_path / "staged")
    calls: list[tuple[int, int]] = []
    usd_ingest.convert(tmp_path / "staged", "stage.usda", "rev-1", tmp_path / "out",
                       chunk_rows=1, progress=lambda done, total: calls.append((done, total)))
    assert calls[-1] == (2, 2)
    assert (2, 2) in calls


def test_convert_removes_the_ply_and_index_directory_on_failure(tmp_path, monkeypatch):
    staged = fixtures.write_valid_stage(tmp_path / "staged")
    out = tmp_path / "out"

    def explode(*args, **kwargs):
        raise RuntimeError("conversion failed")

    monkeypatch.setattr(usd_ingest, "write_ply", explode)
    with pytest.raises(RuntimeError):
        usd_ingest.convert(staged, "stage.usda", "rev-1", out)
    assert not (out / "prim-000.ply").exists()
    assert not (out / "source-index" / "prim-000").exists()
    assert not (out / "raw-prim-000").exists()


def test_convert_raises_structured_validation_errors(tmp_path):
    staged = fixtures.write_nan_stage(tmp_path / "staged")
    with pytest.raises(usd_ingest.StageInvalid) as excinfo:
        usd_ingest.convert(staged, "stage.usda", "rev-1", tmp_path / "out")
    assert [e["code"] for e in excinfo.value.errors] == ["nonfinite_data"]
