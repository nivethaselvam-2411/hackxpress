"""End-to-end backend tests for Last-Mile Shared Auto Matcher."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://auto-batch-pool.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# unique phones per run so idempotency test still hits the same record
RUN = uuid.uuid4().hex[:6]
P1_PHONE = f"98{RUN}01"
P2_PHONE = f"98{RUN}02"
D1_PHONE = f"90{RUN}01"

state = {}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------------- hubs ----------------
def test_hubs_returns_10(s):
    r = s.get(f"{API}/hubs")
    assert r.status_code == 200
    hubs = r.json()
    assert isinstance(hubs, list) and len(hubs) == 10
    assert all({"id", "name", "area", "lat", "lng"}.issubset(h) for h in hubs)
    state["hubs"] = hubs


# ---------------- auth (idempotent) ----------------
def test_register_passenger1(s):
    r = s.post(f"{API}/auth/register", json={"name": "TEST_Priya", "phone": P1_PHONE, "role": "passenger"})
    assert r.status_code == 200
    state["p1"] = r.json()
    assert state["p1"]["phone"] == P1_PHONE


def test_register_idempotent(s):
    r = s.post(f"{API}/auth/register", json={"name": "TEST_Priya2", "phone": P1_PHONE, "role": "passenger"})
    assert r.status_code == 200
    assert r.json()["id"] == state["p1"]["id"]


def test_register_passenger2_and_driver(s):
    r2 = s.post(f"{API}/auth/register", json={"name": "TEST_Arun", "phone": P2_PHONE, "role": "passenger"})
    assert r2.status_code == 200
    state["p2"] = r2.json()
    rd = s.post(f"{API}/auth/register", json={
        "name": "TEST_Raj", "phone": D1_PHONE, "role": "driver", "vehicle_number": "TN 09 AB 1234"
    })
    assert rd.status_code == 200
    state["driver"] = rd.json()
    assert state["driver"]["vehicle_number"] == "TN 09 AB 1234"


# ---------------- ride pooling ----------------
def test_first_request_creates_pending_pool(s):
    payload = {
        "passenger_id": state["p1"]["id"],
        "pickup_hub_id": "hub-ashok-pillar",
        "dropoff_hub_id": "hub-tidel-park",
        "vehicle_type": "auto",
    }
    r = s.post(f"{API}/rides/request", json=payload)
    assert r.status_code == 200, r.text
    rr = r.json()
    assert rr["status"] == "searching"
    assert rr["shared_ride_id"]
    state["req1"] = rr
    state["shared_id"] = rr["shared_ride_id"]
    solo_fare = rr["fare_share"]
    assert solo_fare > 0
    state["solo_fare"] = solo_fare


def test_second_request_joins_same_pool(s):
    payload = {
        "passenger_id": state["p2"]["id"],
        "pickup_hub_id": "hub-ashok-pillar",
        "dropoff_hub_id": "hub-tidel-park",
        "vehicle_type": "auto",
    }
    r = s.post(f"{API}/rides/request", json=payload)
    assert r.status_code == 200, r.text
    rr = r.json()
    state["req2"] = rr
    assert rr["shared_ride_id"] == state["shared_id"], "second request must join same pool"
    assert rr["status"] == "matched"
    # per-passenger fare recomputed => less than solo
    assert rr["fare_share"] < state["solo_fare"]


def test_available_lists_pending(s):
    r = s.get(f"{API}/rides/available")
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert state["shared_id"] in ids


# ---------------- driver accept ----------------
def test_driver_accepts(s):
    r = s.post(f"{API}/rides/shared/{state['shared_id']}/accept",
               json={"driver_id": state["driver"]["id"]})
    assert r.status_code == 200, r.text
    sr = r.json()
    assert sr["status"] == "accepted"
    assert sr["driver_name"] == state["driver"]["name"]
    assert sr["vehicle_number"] == "TN 09 AB 1234"


def test_request_status_in_progress_after_accept(s):
    r = s.get(f"{API}/rides/request/{state['req1']['id']}")
    assert r.status_code == 200
    data = r.json()
    assert data["request"]["status"] == "in_progress"
    # capture pin for verify test
    state["p1_pin"] = data["request"]["pin"]
    r2 = s.get(f"{API}/rides/request/{state['req2']['id']}")
    state["p2_pin"] = r2.json()["request"]["pin"]


# ---------------- PIN verify ----------------
def test_verify_pin_wrong(s):
    r = s.post(f"{API}/rides/shared/{state['shared_id']}/verify-pin",
               json={"passenger_id": state["p1"]["id"], "pin": "0000" if state["p1_pin"] != "0000" else "1111"})
    assert r.status_code == 400


def test_verify_pin_correct(s):
    r = s.post(f"{API}/rides/shared/{state['shared_id']}/verify-pin",
               json={"passenger_id": state["p1"]["id"], "pin": state["p1_pin"]})
    assert r.status_code == 200
    # confirm added to verified list
    sr = s.get(f"{API}/rides/shared/{state['shared_id']}").json()
    assert state["p1"]["id"] in sr["verified_passenger_ids"]


# ---------------- complete ----------------
def test_complete_ride(s):
    r = s.post(f"{API}/rides/shared/{state['shared_id']}/complete")
    assert r.status_code == 200
    sr = r.json()
    assert sr["status"] == "completed"
    # both requests now completed
    for rid in (state["req1"]["id"], state["req2"]["id"]):
        d = s.get(f"{API}/rides/request/{rid}").json()
        assert d["request"]["status"] == "completed"


# ---------------- history ----------------
def test_passenger_history(s):
    r = s.get(f"{API}/rides/history/passenger/{state['p1']['id']}")
    assert r.status_code == 200
    hist = r.json()
    assert any(h["request"]["id"] == state["req1"]["id"] and h["request"]["status"] == "completed" for h in hist)


def test_driver_history(s):
    r = s.get(f"{API}/rides/history/driver/{state['driver']['id']}")
    assert r.status_code == 200
    rides = r.json()
    assert any(x["id"] == state["shared_id"] and x["status"] == "completed" for x in rides)


# ---------------- smart matching preview / route overlap / scheduled rides ----------------
from datetime import datetime, timedelta, timezone  # noqa: E402


def _in(minutes):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


def test_preview_returns_solo_fare_and_candidates(s):
    r = s.post(f"{API}/rides/preview", json={
        "pickup_hub_id": "hub-guindy", "dropoff_hub_id": "hub-tidel-park", "vehicle_type": "auto",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["solo_fare"] > 0 and "candidates" in body


def test_schedule_validation(s):
    base = {"passenger_id": state["p1"]["id"], "pickup_hub_id": "hub-guindy",
            "dropoff_hub_id": "hub-tidel-park", "vehicle_type": "auto"}
    assert s.post(f"{API}/rides/request", json={**base, "scheduled_for": _in(2)}).status_code == 400
    assert s.post(f"{API}/rides/request", json={**base, "scheduled_for": _in(60 * 24 * 30)}).status_code == 400


def test_scheduled_rides_pool_only_within_window(s):
    base = {"pickup_hub_id": "hub-guindy", "dropoff_hub_id": "hub-tidel-park", "vehicle_type": "auto"}
    t = 24 * 60 * 2  # two days out keeps this test clear of other pools
    a = s.post(f"{API}/rides/request", json={**base, "passenger_id": state["p1"]["id"], "scheduled_for": _in(t)})
    b = s.post(f"{API}/rides/request", json={**base, "passenger_id": state["p2"]["id"], "scheduled_for": _in(t + 10)})
    c = s.post(f"{API}/rides/request", json={**base, "passenger_id": str(uuid.uuid4()), "scheduled_for": _in(t + 60)})
    assert a.status_code == b.status_code == c.status_code == 200, (a.text, b.text, c.text)
    assert a.json()["shared_ride_id"] == b.json()["shared_ride_id"]
    assert c.json()["shared_ride_id"] != a.json()["shared_ride_id"]
    assert a.json()["scheduled_for"]
    state["sched_req"] = a.json()


def test_duplicate_schedule_same_window_rejected(s):
    r = s.post(f"{API}/rides/request", json={
        "passenger_id": state["p1"]["id"], "pickup_hub_id": "hub-guindy",
        "dropoff_hub_id": "hub-tidel-park", "vehicle_type": "auto",
        "scheduled_for": _in(24 * 60 * 2 + 5),
    })
    assert r.status_code == 409


def test_scheduled_ride_cannot_start_early(s):
    sid = state["sched_req"]["shared_ride_id"]
    acc = s.post(f"{API}/rides/shared/{sid}/accept", json={"driver_id": state["driver"]["id"]})
    assert acc.status_code == 200, acc.text
    r = s.post(f"{API}/rides/shared/{sid}/complete")
    assert r.status_code == 400 and "early" in r.json()["detail"].lower()


def test_cancel_confirmed_scheduled_ride(s):
    rid = state["sched_req"]["id"]
    assert s.post(f"{API}/rides/request/{rid}/cancel").status_code == 200
    assert s.get(f"{API}/rides/request/{rid}").json()["request"]["status"] == "cancelled"
