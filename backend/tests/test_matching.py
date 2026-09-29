"""Unit tests for matching.py - pure logic, no server or database needed.

Run from backend/:  python -m pytest tests/test_matching.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from matching import (  # noqa: E402
    MATCH_THRESHOLD, compute_fares, rank_pools, route_overlap, score_pool,
    solo_fare, time_compatibility,
)

HUBS = {
    h["id"]: h
    for h in [
        {"id": "ashok", "lat": 13.0263, "lng": 80.2075},
        {"id": "srm", "lat": 13.0327, "lng": 80.1810},
        {"id": "porur", "lat": 13.0389, "lng": 80.1565},
        {"id": "tidel", "lat": 12.9915, "lng": 80.2437},
        {"id": "anna", "lat": 13.0850, "lng": 80.2101},
    ]
}
NOW = datetime(2026, 9, 29, 10, 0, tzinfo=timezone.utc)


def pool(**kw):
    base = {
        "id": "pool1", "vehicle_type": "cab", "status": "pending", "capacity": 4,
        "passenger_ids": ["a"], "pickup_hub_id": "ashok", "dropoff_hub_id": "porur",
        "scheduled_for": None, "created_at": NOW.isoformat(),
    }
    base.update(kw)
    return base


# ---------------- route overlap ----------------
def test_exact_route_is_full_overlap():
    ov = route_overlap(HUBS["ashok"], HUBS["porur"], HUBS["ashok"], HUBS["porur"])
    assert ov.exact and ov.coverage == 1.0 and (ov.t_start, ov.t_end) == (0.0, 1.0)


def test_sub_route_overlaps_partially():
    ov = route_overlap(HUBS["ashok"], HUBS["porur"], HUBS["srm"], HUBS["porur"])
    assert ov is not None and not ov.exact
    assert 0.5 < ov.t_start < 1.0 and ov.t_end == 1.0
    assert ov.coverage > 0.9


def test_opposite_direction_does_not_overlap():
    assert route_overlap(HUBS["ashok"], HUBS["porur"], HUBS["porur"], HUBS["ashok"]) is None


def test_far_off_route_does_not_overlap():
    assert route_overlap(HUBS["ashok"], HUBS["porur"], HUBS["anna"], HUBS["tidel"]) is None


# ---------------- time windows ----------------
def test_instant_only_pools_with_instant():
    assert time_compatibility(None, None) == 1.0
    assert time_compatibility(None, NOW + timedelta(hours=1)) is None
    assert time_compatibility(NOW + timedelta(hours=1), None) is None


def test_scheduled_window():
    t = NOW + timedelta(hours=2)
    assert time_compatibility(t, t) == 1.0
    assert 0.5 <= time_compatibility(t, t + timedelta(minutes=10)) < 1.0
    assert time_compatibility(t, t + timedelta(minutes=16)) is None


def test_naive_datetime_treated_as_utc():
    t = NOW + timedelta(hours=2)
    assert time_compatibility(t.replace(tzinfo=None).isoformat(), t) == 1.0


# ---------------- smart score ----------------
def test_exact_instant_match_clears_threshold():
    m = score_pool(pool(), HUBS["ashok"], HUBS["porur"], "cab", None, HUBS, NOW)
    assert m and m.score >= MATCH_THRESHOLD and m.overlap.exact


def test_wrong_vehicle_full_or_started_pools_are_ineligible():
    args = (HUBS["ashok"], HUBS["porur"], "cab", None, HUBS, NOW)
    assert score_pool(pool(vehicle_type="auto"), *args) is None
    assert score_pool(pool(passenger_ids=list("abcd")), *args) is None
    assert score_pool(pool(status="accepted"), *args) is None


def test_fuller_pool_ranks_above_emptier_pool():
    a = pool(id="emptier", passenger_ids=["a"])
    b = pool(id="fuller", passenger_ids=["a", "b", "c"])
    ranked = rank_pools([a, b], HUBS["ashok"], HUBS["porur"], "cab", None, HUBS, NOW)
    assert [m.pool_id for m in ranked] == ["fuller", "emptier"]


def test_same_route_pool_beats_longer_pool_for_partial_rider():
    longer = pool(id="longer")                                                # ashok -> porur
    same = pool(id="same", pickup_hub_id="srm", dropoff_hub_id="porur")       # srm -> porur
    ranked = rank_pools([longer, same], HUBS["srm"], HUBS["porur"], "cab", None, HUBS, NOW)
    assert {m.pool_id for m in ranked} == {"longer", "same"}   # both are valid options
    assert ranked[0].pool_id == "same"                          # exact route scores higher


# ---------------- fares ----------------
def test_identical_routes_split_evenly():
    res = compute_fares("auto", 6.0, [{"id": "a"}, {"id": "b"}, {"id": "c"}])
    assert res["total_fare"] == solo_fare("auto", 6.0)
    assert set(res["shares"].values()) == {round(res["total_fare"] / 3)}


def test_shorter_segment_pays_less_and_shares_sum_to_total():
    res = compute_fares("cab", 6.0, [
        {"id": "long", "t_start": 0.0, "t_end": 1.0},
        {"id": "short", "t_start": 0.5, "t_end": 1.0},
    ])
    assert res["shares"]["short"] < res["shares"]["long"]
    assert abs(sum(res["shares"].values()) - res["total_fare"]) <= 1


def test_vehicle_span_shrinks_when_host_leaves():
    only_partial = compute_fares("cab", 6.0, [{"id": "short", "t_start": 0.5, "t_end": 1.0}])
    assert only_partial["span_km"] == 3.0
    assert only_partial["shares"]["short"] == solo_fare("cab", 3.0)
