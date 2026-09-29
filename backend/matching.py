"""Pure matching logic for Last-Mile (no DB / no web framework imports).

Three pieces live here so they can be unit-tested without Mongo:

* Route overlap  - can a rider going p -> q hop into a pool whose host route is A -> B?
* Smart matching - a multi-factor score that ranks candidate pools for a request.
* Fare split     - distance-weighted split so riders on a shorter segment pay less.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Dict, List, Optional

# ---------------------------------------------------------------- constants

CAPACITY = {"auto": 3, "cab": 4}
BASE_FARE = {"auto": 60, "cab": 100}
PER_KM = {"auto": 15, "cab": 22}

DETOUR_LIMIT_KM = 1.5        # max distance of a rider's hub from the pool's route line
MIN_COVERAGE = 0.4           # rider must share at least 40% of their trip with the pool
TIME_WINDOW_MIN = 15         # scheduled rides pool only if departures are within +/- this
MATCH_THRESHOLD = 55         # minimum smart score (0-100) to join an existing pool

# weights of the smart score (sum to 1.0)
W_OVERLAP, W_TIME, W_FILL, W_AGE, W_PREF = 0.40, 0.20, 0.20, 0.10, 0.10
AGE_FULL_CREDIT_SECS = 120   # pools waiting this long get full "age" credit


# ---------------------------------------------------------------- geometry

def haversine_km(a_lat, a_lng, b_lat, b_lng) -> float:
    R = 6371
    dlat = radians(b_lat - a_lat)
    dlng = radians(b_lng - a_lng)
    x = sin(dlat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(dlng / 2) ** 2
    return round(2 * R * asin(sqrt(x)), 2)


def _xy(hub: dict, ref_lat: float):
    """Local flat-earth projection in km - accurate enough at city scale."""
    return (hub["lng"] * 111.32 * cos(radians(ref_lat)), hub["lat"] * 110.57)


@dataclass
class Overlap:
    exact: bool
    t_start: float      # where the rider boards, as a fraction (0-1) of the host route
    t_end: float        # where the rider alights
    coverage: float     # share of the rider's own trip that rides along the pool route (0-1)
    detour_km: float    # worst distance of the rider's hubs from the pool route line
    own_km: float       # length of the rider's segment along the pool route


def route_overlap(host_pickup: dict, host_dropoff: dict,
                  pickup: dict, dropoff: dict) -> Optional[Overlap]:
    """Return how a rider p -> q fits along a host route A -> B, or None if it does not.

    A rider fits when both of their hubs sit close to the A -> B line, in the same
    direction of travel, with the pickup before the drop-off.
    """
    host_len = haversine_km(host_pickup["lat"], host_pickup["lng"],
                            host_dropoff["lat"], host_dropoff["lng"])
    if host_pickup["id"] == pickup["id"] and host_dropoff["id"] == dropoff["id"]:
        return Overlap(True, 0.0, 1.0, 1.0, 0.0, host_len)
    if host_len == 0:
        return None

    ref = host_pickup["lat"]
    ax, ay = _xy(host_pickup, ref)
    bx, by = _xy(host_dropoff, ref)
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy

    def project(hub):
        px, py = _xy(hub, ref)
        t = ((px - ax) * dx + (py - ay) * dy) / seg2
        tc = max(0.0, min(1.0, t))
        cx, cy = ax + tc * dx, ay + tc * dy
        dist = sqrt((px - cx) ** 2 + (py - cy) ** 2)
        return t, dist

    t_p, d_p = project(pickup)
    t_q, d_q = project(dropoff)
    detour = max(d_p, d_q)
    if detour > DETOUR_LIMIT_KM:
        return None
    t_p, t_q = max(0.0, min(1.0, t_p)), max(0.0, min(1.0, t_q))
    if t_q - t_p < 0.05:            # wrong direction, or barely any shared distance
        return None

    own_km = (t_q - t_p) * host_len
    rider_len = haversine_km(pickup["lat"], pickup["lng"], dropoff["lat"], dropoff["lng"])
    coverage = min(1.0, own_km / rider_len) if rider_len > 0 else 0.0
    if coverage < MIN_COVERAGE:
        return None
    return Overlap(False, round(t_p, 4), round(t_q, 4), round(coverage, 3),
                   round(detour, 2), round(own_km, 2))


# ---------------------------------------------------------------- time

def parse_dt(value) -> Optional[datetime]:
    """Parse an ISO string / datetime into an aware UTC datetime (naive -> UTC)."""
    if value is None or value == "":
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def time_compatibility(pool_departure, req_departure) -> Optional[float]:
    """1.0 = perfectly compatible, None = must not be pooled together.

    Instant rides only pool with instant rides; scheduled rides only pool with
    scheduled rides departing within TIME_WINDOW_MIN of each other.
    """
    pd, rd = parse_dt(pool_departure), parse_dt(req_departure)
    if pd is None and rd is None:
        return 1.0
    if pd is None or rd is None:
        return None
    diff_min = abs((pd - rd).total_seconds()) / 60
    if diff_min > TIME_WINDOW_MIN:
        return None
    return 1.0 - 0.5 * (diff_min / TIME_WINDOW_MIN)   # 1.0 at same time -> 0.5 at edge


# ---------------------------------------------------------------- smart score

@dataclass
class Match:
    pool_id: str
    score: float
    overlap: Overlap
    riders: int
    capacity: int
    reasons: List[str] = field(default_factory=list)


def score_pool(pool: dict, pickup: dict, dropoff: dict, vehicle_type: str,
               req_departure, hubs: Dict[str, dict], now: Optional[datetime] = None,
               req_prefs: Optional[dict] = None, req_user: Optional[dict] = None
               ) -> Optional[Match]:
    """Score one pending pool for a request. None means the pool is ineligible.

    pool needs: id, vehicle_type, status, capacity, passenger_ids, pickup_hub_id,
    dropoff_hub_id, scheduled_for (or None), created_at (iso).
    """
    if pool.get("status") != "pending" or pool.get("vehicle_type") != vehicle_type:
        return None
    riders = len(pool.get("passenger_ids", []))
    capacity = pool.get("capacity") or CAPACITY[vehicle_type]
    if riders >= capacity:
        return None

    t_score = time_compatibility(pool.get("scheduled_for"), req_departure)
    if t_score is None:
        return None
    host_p, host_d = hubs.get(pool["pickup_hub_id"]), hubs.get(pool["dropoff_hub_id"])
    if not host_p or not host_d:
        return None
    ov = route_overlap(host_p, host_d, pickup, dropoff)
    if ov is None:
        return None

    now = now or datetime.now(timezone.utc)
    created = parse_dt(pool.get("created_at")) or now
    age = max(0.0, (now - created).total_seconds())

    # Constraints (Hard Rejects)
    req_prefs = req_prefs or {}
    pool_prefs = pool.get("preferences") or {}
    req_female_only = req_prefs.get("female_only", False)
    pool_female_only = pool_prefs.get("female_only", False)
    
    req_gender = (req_user or {}).get("gender", "Unknown")
    
    # If pool is female only, requester must be female
    if pool_female_only and req_gender != "F":
        return None
    # If requester wants female only, pool must be female only (or empty)
    if req_female_only and not pool_female_only:
        return None

    # Verified Community constraint
    req_community = (req_user or {}).get("community")
    pool_community = pool.get("community_id")
    if pool_community and pool_community != req_community:
        return None # Cannot join a community pool that isn't yours
    if req_community and pool_community and req_community == pool_community:
        # Boost score significantly for being in the same community
        pass # We will handle this in pref_score or total

    # Preference Scoring (Soft Constraints)
    pref_score = 1.0
    if req_prefs.get("quiet_ride") and not pool_prefs.get("quiet_ride"):
        pref_score = 0.0
    elif not req_prefs.get("quiet_ride") and pool_prefs.get("quiet_ride"):
        pref_score = 0.5 # Slight penalty for non-quiet joining quiet

    overlap_score = ov.coverage * (1 - 0.4 * min(ov.detour_km / DETOUR_LIMIT_KM, 1.0))
    fill_score = (riders + 1) / capacity
    age_score = min(age / AGE_FULL_CREDIT_SECS, 1.0)
    total = 100 * (W_OVERLAP * overlap_score + W_TIME * t_score
                   + W_FILL * fill_score + W_AGE * age_score + W_PREF * pref_score)

    reasons = []
    if ov.exact:
        reasons.append("Same route as this pool")
    elif ov.coverage >= 0.98:
        reasons.append("Your whole trip is along this pool's route")
    else:
        reasons.append(f"{round(ov.coverage * 100)}% of your trip is along this pool's route")
    if parse_dt(req_departure) is not None:
        reasons.append("Departs within your time window")
    if req_prefs.get("quiet_ride") and pool_prefs.get("quiet_ride"):
        reasons.append("Matches your quiet ride preference")
    if req_female_only and pool_female_only:
        reasons.append("Female-only pool")
    if req_community and pool_community and req_community == pool_community:
        reasons.append(f"Verified {req_community} Community Pool")
        
    reasons.append(f"{riders} rider{'s' if riders != 1 else ''} already pooled "
                   f"({riders + 1}/{capacity} with you)")

    return Match(pool["id"], round(total, 1), ov, riders, capacity, reasons)


def rank_pools(pools: List[dict], pickup: dict, dropoff: dict, vehicle_type: str,
               req_departure, hubs: Dict[str, dict], now: Optional[datetime] = None,
               req_prefs: Optional[dict] = None, req_user: Optional[dict] = None
               ) -> List[Match]:
    """All eligible pools scoring at least MATCH_THRESHOLD, best first."""
    out = []
    for p in pools:
        m = score_pool(p, pickup, dropoff, vehicle_type, req_departure, hubs, now, req_prefs, req_user)
        if m and m.score >= MATCH_THRESHOLD:
            out.append((m, p.get("created_at") or ""))
    out.sort(key=lambda x: (-x[0].score, x[1]))      # tie-break: oldest pool first
    return [m for m, _ in out]


# ---------------------------------------------------------------- fares

def solo_fare(vehicle_type: str, km: float) -> int:
    return round(BASE_FARE[vehicle_type] + PER_KM[vehicle_type] * km)


def compute_fares(vehicle_type: str, host_len_km: float, members: List[dict]) -> dict:
    """Split the vehicle's fare across riders in proportion to distance travelled.

    members: [{"id", "t_start", "t_end"}] with t values relative to the host route.
    The vehicle runs from the earliest pickup to the latest drop-off, so that span
    (not the full host route) sets the total. With everyone on the exact same route
    this reduces to the original even split.
    """
    if not members:
        return {"total_fare": 0, "span_km": 0.0, "shares": {}}
    t0 = min(m.get("t_start", 0.0) for m in members)
    t1 = max(m.get("t_end", 1.0) for m in members)
    span_km = round((t1 - t0) * host_len_km, 2)
    total = solo_fare(vehicle_type, span_km)
    weights = {m["id"]: max(m.get("t_end", 1.0) - m.get("t_start", 0.0), 1e-6) for m in members}
    wsum = sum(weights.values())
    shares = {i: round(total * w / wsum) for i, w in weights.items()}
    return {"total_fare": total, "span_km": span_km, "shares": shares}
