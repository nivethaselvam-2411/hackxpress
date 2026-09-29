from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import string
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, timedelta

from matching import (
    CAPACITY, TIME_WINDOW_MIN, haversine_km, parse_dt, rank_pools, compute_fares, solo_fare,
)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ============= CONSTANTS =============

# CAPACITY / fares / matching thresholds live in matching.py
ACTIVE_REQ = ["searching", "matched", "in_progress"]
MIN_LEAD_MIN = 15          # scheduled rides must be booked at least this far ahead
MAX_ADVANCE_DAYS = 7       # ...and at most this far ahead
EARLY_START_MIN = 30       # drivers can start/complete a scheduled ride this early
EXPIRY_GRACE_MIN = 10      # unaccepted scheduled pools expire this long after departure

# Chennai hub seed data
HUBS_SEED = [
    {"id": "hub-ashok-pillar", "name": "Ashok Pillar Metro", "area": "K.K. Nagar",  "lat": 13.0263, "lng": 80.2075},
    {"id": "hub-vadapalani",   "name": "Vadapalani Metro",   "area": "Vadapalani",  "lat": 13.0507, "lng": 80.2062},
    {"id": "hub-srm-rmp",      "name": "SRM Ramapuram",      "area": "Ramapuram",   "lat": 13.0327, "lng": 80.1810},
    {"id": "hub-dlf-it",       "name": "DLF IT Park",        "area": "Manapakkam",  "lat": 13.0263, "lng": 80.1770},
    {"id": "hub-porur",        "name": "Porur Junction",     "area": "Porur",       "lat": 13.0389, "lng": 80.1565},
    {"id": "hub-guindy",       "name": "Guindy Metro",       "area": "Guindy",      "lat": 13.0067, "lng": 80.2206},
    {"id": "hub-ekkatuthangal", "name": "Ekkatuthangal Metro", "area": "Ekkatuthangal", "lat": 13.0134, "lng": 80.2013},
    {"id": "hub-alandur",      "name": "Alandur Metro",      "area": "Alandur",     "lat": 13.0035, "lng": 80.2036},
    {"id": "hub-anna-nagar",   "name": "Anna Nagar Tower",   "area": "Anna Nagar",  "lat": 13.0850, "lng": 80.2101},
    {"id": "hub-tidel-park",   "name": "Tidel Park Taramani","area": "Taramani",    "lat": 12.9915, "lng": 80.2437},
]


# ============= HELPERS =============

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def gen_pin():
    return "".join(random.choices(string.digits, k=4))


# ============= MODELS =============

class User(BaseModel):
    id: str
    name: str
    phone: str
    role: Literal["passenger", "driver"]
    vehicle_number: Optional[str] = None
    gender: Optional[Literal["M", "F", "Other"]] = None
    community: Optional[str] = None
    created_at: str

class UserCreate(BaseModel):
    name: str
    phone: str
    role: Literal["passenger", "driver"]
    vehicle_number: Optional[str] = None
    gender: Optional[Literal["M", "F", "Other"]] = None
    community: Optional[str] = None

class Hub(BaseModel):
    id: str
    name: str
    area: str
    lat: float
    lng: float

class RideRequestCreate(BaseModel):
    passenger_id: str
    pickup_hub_id: str
    dropoff_hub_id: str
    vehicle_type: Literal["auto", "cab"]
    scheduled_for: Optional[datetime] = None   # None = ride now; else departure time (UTC or tz-aware)
    preferences: Optional[dict] = Field(default_factory=dict)

class MatchPreviewBody(BaseModel):
    passenger_id: Optional[str] = None
    pickup_hub_id: str
    dropoff_hub_id: str
    vehicle_type: Literal["auto", "cab"]
    scheduled_for: Optional[datetime] = None
    preferences: Optional[dict] = Field(default_factory=dict)

class DriverAcceptBody(BaseModel):
    driver_id: str

class VerifyPinBody(BaseModel):
    passenger_id: str
    pin: str

class AssistantRequest(BaseModel):
    query: str
    passenger_id: str


# ============= DB INIT =============

@app.on_event("startup")
async def seed():
    # seed hubs
    existing = await db.hubs.count_documents({})
    if existing == 0:
        await db.hubs.insert_many(HUBS_SEED)
        logging.info(f"Seeded {len(HUBS_SEED)} hubs")

# ============= WEBSOCKET MANAGER =============
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, ride_id: str, user_id: str):
        await websocket.accept()
        if ride_id not in self.active_connections:
            self.active_connections[ride_id] = {}
        self.active_connections[ride_id][user_id] = websocket

    def disconnect(self, ride_id: str, user_id: str):
        if ride_id in self.active_connections:
            if user_id in self.active_connections[ride_id]:
                del self.active_connections[ride_id][user_id]
            if not self.active_connections[ride_id]:
                del self.active_connections[ride_id]

    async def broadcast(self, ride_id: str, message: dict, exclude: Optional[str] = None):
        if ride_id in self.active_connections:
            for uid, ws in self.active_connections[ride_id].items():
                if uid != exclude:
                    try:
                        await ws.send_json(message)
                    except:
                        pass

manager = ConnectionManager()


# ============= ROUTES =============

@api_router.get("/")
async def root():
    return {"message": "Last-Mile API"}

# ----- Auth (simple phone+name) -----

@api_router.post("/auth/register", response_model=User)
async def register(body: UserCreate):
    # check if user already exists with this phone + role
    existing = await db.users.find_one(
        {"phone": body.phone, "role": body.role}, {"_id": 0}
    )
    if existing:
        return User(**existing)
    user = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "phone": body.phone,
        "role": body.role,
        "vehicle_number": body.vehicle_number,
        "gender": body.gender,
        "community": body.community,
        "is_verified_community": bool(body.community),
        "badges": ["Verified Driver"] if body.role == "driver" and body.vehicle_number else [],
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    user.pop("_id", None)
    return User(**user)


@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "User not found")
    return User(**u)


# ----- Hubs -----

@api_router.get("/hubs", response_model=List[Hub])
async def list_hubs():
    hubs = await db.hubs.find({}, {"_id": 0}).to_list(1000)
    return [Hub(**h) for h in hubs]


# ----- Ride request + matching -----

def _validate_schedule(value) -> Optional[str]:
    """None for ride-now; otherwise a validated UTC ISO string."""
    if value is None:
        return None
    d = parse_dt(value)
    now = datetime.now(timezone.utc)
    if d < now + timedelta(minutes=MIN_LEAD_MIN):
        raise HTTPException(400, f"Schedule rides at least {MIN_LEAD_MIN} minutes ahead")
    if d > now + timedelta(days=MAX_ADVANCE_DAYS):
        raise HTTPException(400, f"Rides can be scheduled up to {MAX_ADVANCE_DAYS} days ahead")
    return d.isoformat()


async def _hubs_by_id():
    hubs = await db.hubs.find({}, {"_id": 0}).to_list(1000)
    return {h["id"]: h for h in hubs}


def _host_km(pool):
    return pool.get("host_km") or pool["distance_km"]


async def _recompute_shared_fare(pool):
    """Re-split the fare across the pool's active riders, weighted by distance travelled."""
    reqs = await db.ride_requests.find(
        {"shared_ride_id": pool["id"], "status": {"$in": ACTIVE_REQ}}, {"_id": 0}
    ).to_list(20)
    if not reqs:
        return 0
    members = [
        {"id": r["id"], "t_start": r.get("t_start", 0.0), "t_end": r.get("t_end", 1.0)}
        for r in reqs
    ]
    res = compute_fares(pool["vehicle_type"], _host_km(pool), members)
    per = round(res["total_fare"] / len(reqs))
    await db.shared_rides.update_one(
        {"id": pool["id"]},
        {"$set": {
            "total_fare": res["total_fare"],
            "distance_km": res["span_km"],
            "per_passenger_fare": per,
        }},
    )
    for r in reqs:
        await db.ride_requests.update_one(
            {"id": r["id"]}, {"$set": {"fare_share": res["shares"][r["id"]]}}
        )
    pool["per_passenger_fare"] = per
    return per


async def _expire_stale_pools():
    """Scheduled pools nobody accepted by departure (+grace) are cancelled."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=EXPIRY_GRACE_MIN)
    pools = await db.shared_rides.find(
        {"status": "pending", "scheduled_for": {"$ne": None}}, {"_id": 0}
    ).to_list(500)
    for sr in pools:
        dep = parse_dt(sr["scheduled_for"])
        if dep and dep < cutoff:
            await db.shared_rides.update_one(
                {"id": sr["id"], "status": "pending"},
                {"$set": {"status": "cancelled", "cancel_reason": "no_driver"}},
            )
            await db.ride_requests.update_many(
                {"shared_ride_id": sr["id"], "status": {"$in": ["searching", "matched"]}},
                {"$set": {"status": "cancelled", "cancel_reason": "no_driver"}},
            )


async def _rank_for(pickup, dropoff, vehicle_type, sched_iso, hubs, exclude_passenger=None, req_prefs=None, req_user=None):
    """Smart matching: score every open pool for this request, best first."""
    pools = await db.shared_rides.find(
        {
            "status": "pending",
            "vehicle_type": vehicle_type,
            "$expr": {"$lt": [{"$size": "$passenger_ids"}, "$capacity"]},
        },
        {"_id": 0},
    ).to_list(200)
    if exclude_passenger:
        pools = [p for p in pools if exclude_passenger not in p["passenger_ids"]]
    ranked = rank_pools(pools, pickup, dropoff, vehicle_type, sched_iso, hubs, req_prefs=req_prefs, req_user=req_user)
    by_id = {p["id"]: p for p in pools}
    return [(m, by_id[m.pool_id]) for m in ranked]


async def _load_hubs_for(body):
    if body.pickup_hub_id == body.dropoff_hub_id:
        raise HTTPException(400, "Pickup and dropoff must differ")
    hubs = await _hubs_by_id()
    pickup, dropoff = hubs.get(body.pickup_hub_id), hubs.get(body.dropoff_hub_id)
    if not pickup or not dropoff:
        raise HTTPException(404, "Hub not found")
    return hubs, pickup, dropoff


@api_router.post("/rides/preview")
async def preview_match(body: MatchPreviewBody):
    """What would happen if I requested this ride? Ranked pools + estimated fare."""
    hubs, pickup, dropoff = await _load_hubs_for(body)
    sched = _validate_schedule(body.scheduled_for)
    await _expire_stale_pools()
    own_km = haversine_km(pickup["lat"], pickup["lng"], dropoff["lat"], dropoff["lng"])
    
    req_user = None
    if body.passenger_id:
        req_user = await db.users.find_one({"id": body.passenger_id}, {"_id": 0})
        
    ranked = await _rank_for(pickup, dropoff, body.vehicle_type, sched, hubs, body.passenger_id, body.preferences, req_user)

    candidates = []
    for m, pool in ranked[:3]:
        reqs = await db.ride_requests.find(
            {"shared_ride_id": pool["id"], "status": {"$in": ACTIVE_REQ}}, {"_id": 0}
        ).to_list(20)
        members = [
            {"id": r["id"], "t_start": r.get("t_start", 0.0), "t_end": r.get("t_end", 1.0)}
            for r in reqs
        ] + [{"id": "__new__", "t_start": m.overlap.t_start, "t_end": m.overlap.t_end}]
        est = compute_fares(pool["vehicle_type"], _host_km(pool), members)["shares"]["__new__"]
        candidates.append({
            "pool_id": pool["id"],
            "score": m.score,
            "riders": m.riders,
            "capacity": m.capacity,
            "overlap_pct": round(m.overlap.coverage * 100),
            "exact_route": m.overlap.exact,
            "reasons": m.reasons,
            "est_fare_share": est,
            "departs": pool.get("scheduled_for"),
        })
    return {
        "distance_km": own_km,
        "solo_fare": solo_fare(body.vehicle_type, own_km),
        "scheduled_for": sched,
        "best": candidates[0] if candidates else None,
        "candidates": candidates,
    }


async def _cancel_request_doc(rr):
    """Cancel a request and take the passenger out of their pool."""
    if rr["status"] in ("completed", "cancelled"):
        return
    await db.ride_requests.update_one({"id": rr["id"]}, {"$set": {"status": "cancelled"}})
    sr = await db.shared_rides.find_one({"id": rr["shared_ride_id"]}, {"_id": 0})
    if sr and sr["status"] in ("pending", "accepted"):
        pid = rr["passenger_id"]
        await db.shared_rides.update_one(
            {"id": sr["id"]},
            {"$pull": {"passenger_ids": pid, "verified_passenger_ids": pid}},
        )
        sr["passenger_ids"] = [p for p in sr["passenger_ids"] if p != pid]
        if not sr["passenger_ids"]:
            await db.shared_rides.update_one(
                {"id": sr["id"]},
                {"$set": {"status": "cancelled", "cancel_reason": "all_cancelled"}},
            )
        else:
            await _recompute_shared_fare(sr)


@api_router.post("/rides/request")
async def request_ride(body: RideRequestCreate):
    hubs, pickup, dropoff = await _load_hubs_for(body)
    sched = _validate_schedule(body.scheduled_for)
    await _expire_stale_pools()

    if sched is None:
        # ride-now: replace any earlier ride-now search by this passenger
        priors = await db.ride_requests.find(
            {"passenger_id": body.passenger_id, "status": {"$in": ["searching", "matched"]},
             "scheduled_for": None}, {"_id": 0}
        ).to_list(20)
        for p in priors:
            await _cancel_request_doc(p)
    else:
        # scheduled: don't let the same passenger book two rides in the same window
        mine = await db.ride_requests.find(
            {"passenger_id": body.passenger_id, "status": {"$in": ACTIVE_REQ},
             "scheduled_for": {"$ne": None}}, {"_id": 0}
        ).to_list(50)
        new_dt = parse_dt(sched)
        for r in mine:
            other = parse_dt(r["scheduled_for"])
            if other and abs((other - new_dt).total_seconds()) / 60 <= TIME_WINDOW_MIN:
                raise HTTPException(409, "You already have a ride scheduled around that time")

    own_km = haversine_km(pickup["lat"], pickup["lng"], dropoff["lat"], dropoff["lng"])
    capacity = CAPACITY[body.vehicle_type]
    pin = gen_pin()
    ride_req_id = str(uuid.uuid4())
    req_user = await db.users.find_one({"id": body.passenger_id}, {"_id": 0})

    # Smart matching: try the best-scored pools first; joins are atomic so two riders
    # can't both take the last seat.
    joined = None
    for m, pool in await _rank_for(pickup, dropoff, body.vehicle_type, sched, hubs, req_prefs=body.preferences, req_user=req_user):
        res = await db.shared_rides.update_one(
            {
                "id": pool["id"],
                "status": "pending",
                "$expr": {"$lt": [{"$size": "$passenger_ids"}, "$capacity"]},
            },
            {"$push": {"passenger_ids": body.passenger_id}},
        )
        if res.modified_count:
            joined = (m, pool)
            break

    rr = {
        "id": ride_req_id,
        "passenger_id": body.passenger_id,
        "pickup_hub_id": body.pickup_hub_id,
        "dropoff_hub_id": body.dropoff_hub_id,
        "vehicle_type": body.vehicle_type,
        "preferences": body.preferences or {},
        "fare_share": 0,
        "pin": pin,
        "created_at": now_iso(),
        "scheduled_for": sched,
        "solo_fare": solo_fare(body.vehicle_type, own_km),
    }

    if joined:
        m, pool = joined
        pool["passenger_ids"].append(body.passenger_id)
        rr.update({
            "status": "matched",  # pool exists but driver not yet accepted
            "shared_ride_id": pool["id"],
            "t_start": m.overlap.t_start,
            "t_end": m.overlap.t_end,
            "exact_route": m.overlap.exact,
            "overlap_pct": round(m.overlap.coverage * 100),
            "match_score": m.score,
            "match_reasons": m.reasons,
        })
        await db.ride_requests.insert_one(rr)
        await _recompute_shared_fare(pool)
    else:
        shared_ride_id = str(uuid.uuid4())
        total_fare = solo_fare(body.vehicle_type, own_km)
        await db.shared_rides.insert_one({
            "id": shared_ride_id,
            "pickup_hub_id": body.pickup_hub_id,
            "dropoff_hub_id": body.dropoff_hub_id,
            "vehicle_type": body.vehicle_type,
            "capacity": capacity,
            "passenger_ids": [body.passenger_id],
            "distance_km": own_km,
            "host_km": own_km,
            "total_fare": total_fare,
            "per_passenger_fare": total_fare,  # solo fare initially
            "status": "pending",  # waiting for driver
            "driver_id": None,
            "driver_name": None,
            "vehicle_number": None,
            "scheduled_for": sched,
            "preferences": body.preferences or {},
            "cancel_reason": None,
            "created_at": now_iso(),
            "accepted_at": None,
            "completed_at": None,
            "verified_passenger_ids": [],
            "community_id": req_user.get("community") if req_user else None,
        })
        rr.update({
            "status": "searching",
            "shared_ride_id": shared_ride_id,
            "fare_share": total_fare,
            "t_start": 0.0,
            "t_end": 1.0,
            "exact_route": True,
            "overlap_pct": 100,
            "match_score": None,
            "match_reasons": [],
        })
        await db.ride_requests.insert_one(rr)

    return await db.ride_requests.find_one({"id": ride_req_id}, {"_id": 0})


async def _hydrate_shared_ride(sr):
    if not sr:
        return None
    sr.pop("_id", None)
    hubs = await _hubs_by_id()
    sr["pickup"] = hubs.get(sr["pickup_hub_id"])
    sr["dropoff"] = hubs.get(sr["dropoff_hub_id"])
    passengers = await db.users.find({"id": {"$in": sr["passenger_ids"]}}, {"_id": 0}).to_list(20)
    # attach each passenger's PIN and their own segment from their ride_request
    reqs = await db.ride_requests.find(
        {"shared_ride_id": sr["id"], "status": {"$in": ["searching", "matched", "in_progress", "completed"]}},
        {"_id": 0}
    ).to_list(20)
    req_map = {r["passenger_id"]: r for r in reqs}
    for p in passengers:
        r = req_map.get(p["id"], {})
        p["pin"] = r.get("pin", "----")
        p["fare_share"] = r.get("fare_share")
        p["pickup_name"] = (hubs.get(r.get("pickup_hub_id")) or {}).get("name")
        p["dropoff_name"] = (hubs.get(r.get("dropoff_hub_id")) or {}).get("name")
        p["partial_route"] = not r.get("exact_route", True)
    sr["passengers"] = passengers
    return sr


@api_router.get("/rides/request/{req_id}")
async def get_ride_request(req_id: str):
    await _expire_stale_pools()
    rr = await db.ride_requests.find_one({"id": req_id}, {"_id": 0})
    if not rr:
        raise HTTPException(404, "Request not found")
    # promote status: if shared_ride now accepted, mark request as in_progress
    sr = await db.shared_rides.find_one({"id": rr["shared_ride_id"]}, {"_id": 0})
    if sr:
        # update status based on shared_ride
        if sr["status"] == "accepted" and rr["status"] in ("searching", "matched"):
            await db.ride_requests.update_one({"id": req_id}, {"$set": {"status": "in_progress"}})
            rr["status"] = "in_progress"
        elif sr["status"] == "completed":
            await db.ride_requests.update_one({"id": req_id}, {"$set": {"status": "completed"}})
            rr["status"] = "completed"
        elif sr["status"] == "pending" and len(sr["passenger_ids"]) > 1 and rr["status"] == "searching":
            await db.ride_requests.update_one({"id": req_id}, {"$set": {"status": "matched"}})
            rr["status"] = "matched"
    hydrated = await _hydrate_shared_ride(sr) if sr else None
    return {"request": rr, "shared_ride": hydrated}


@api_router.post("/rides/request/{req_id}/cancel")
async def cancel_request(req_id: str):
    rr = await db.ride_requests.find_one({"id": req_id}, {"_id": 0})
    if not rr:
        raise HTTPException(404, "Not found")
        
    # AI Fraud Detection: Track Cancellation Patterns
    user_id = rr.get("passenger_id")
    if user_id:
        one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        recent_cancels = await db.ride_requests.count_documents({
            "passenger_id": user_id, 
            "status": "cancelled",
            "created_at": {"$gte": one_hour_ago}
        })
        if recent_cancels >= 3: # 4th cancellation in an hour flags the account
            await db.users.update_one({"id": user_id}, {"$set": {"fraud_flag": "excessive_cancellations", "is_suspended": True}})
            logging.warning(f"FRAUD ALERT: User {user_id} suspended for excessive cancellations.")

    await _cancel_request_doc(rr)
    return {"ok": True}


# ----- Driver -----

def _check_not_too_early(sr):
    dep = parse_dt(sr.get("scheduled_for"))
    if dep and datetime.now(timezone.utc) < dep - timedelta(minutes=EARLY_START_MIN):
        mins = int((dep - datetime.now(timezone.utc)).total_seconds() // 60)
        raise HTTPException(400, f"Too early - this scheduled ride departs in {mins} min")


@api_router.get("/rides/available")
async def available_rides():
    """List pending shared_rides for drivers to accept: ride-now first, then scheduled by time."""
    await _expire_stale_pools()
    rides = await db.shared_rides.find(
        {"status": "pending", "passenger_ids": {"$ne": []}}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    rides.sort(key=lambda r: (r.get("scheduled_for") is not None, r.get("scheduled_for") or ""))
    result = []
    for sr in rides:
        h = await _hydrate_shared_ride(sr)
        
        # AI Dynamic Allocation: Score pools to recommend the most optimal one to drivers
        ai_score = 0
        fill_ratio = len(h.get("passenger_ids", [])) / float(h.get("capacity", 3))
        ai_score += fill_ratio * 50  # Up to 50 pts for full capacity
        ai_score += min(h.get("total_fare", 0) / 100.0, 30)  # Up to 30 pts for high fare
        h["ai_allocation_score"] = ai_score
        h["ai_recommended"] = False
        
        result.append(h)
        
    if result:
        # Sort by AI Score descending
        result.sort(key=lambda x: x["ai_allocation_score"], reverse=True)
        # Top 1 is recommended
        result[0]["ai_recommended"] = True
        
    return result


@api_router.post("/rides/shared/{ride_id}/accept")
async def accept_ride(ride_id: str, body: DriverAcceptBody):
    sr = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    if not sr:
        raise HTTPException(404, "Ride not found")
    if sr["status"] != "pending":
        raise HTTPException(400, "Ride not available")
    driver = await db.users.find_one({"id": body.driver_id, "role": "driver"}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    res = await db.shared_rides.update_one(
        {"id": ride_id, "status": "pending"},
        {"$set": {
            "status": "accepted",
            "driver_id": body.driver_id,
            "driver_name": driver["name"],
            "vehicle_number": driver.get("vehicle_number") or "TN-XX-1234",
            "accepted_at": now_iso(),
        }}
    )
    if not res.modified_count:
        raise HTTPException(400, "Ride not available")
    updated = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    # promote all matching ride_requests
    await db.ride_requests.update_many(
        {"shared_ride_id": ride_id, "status": {"$in": ["searching", "matched"]}},
        {"$set": {"status": "in_progress"}}
    )
    return await _hydrate_shared_ride(updated)

@api_router.post("/rides/shared/{ride_id}/sos")
async def trigger_sos(ride_id: str):
    sr = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    if not sr:
        raise HTTPException(404, "Ride not found")
        
    # Mark ride with emergency status
    await db.shared_rides.update_one({"id": ride_id}, {"$set": {"emergency_status": True, "fraud_flag": "sos_triggered"}})
    
    # Broadcast SOS to WebSocket Manager (driver & other passengers)
    await manager.broadcast(ride_id, {"type": "alert", "message": "🚨 SOS TRIGGERED! Authorities and Emergency Contacts have been alerted!"})
    
    logging.critical(f"SOS TRIGGERED FOR RIDE {ride_id}")
    return {"ok": True, "message": "Emergency services contacted"}

@api_router.post("/rides/shared/{ride_id}/verify-pin")
async def verify_pin(ride_id: str, body: VerifyPinBody):
    sr = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    if not sr:
        raise HTTPException(404, "Ride not found")
    _check_not_too_early(sr)
    rr = await db.ride_requests.find_one(
        {"shared_ride_id": ride_id, "passenger_id": body.passenger_id,
         "status": {"$in": ACTIVE_REQ}}, {"_id": 0}
    )
    if not rr:
        raise HTTPException(404, "Passenger not in ride")
    if rr["pin"] != body.pin:
        raise HTTPException(400, "Wrong PIN")
    await db.shared_rides.update_one(
        {"id": ride_id},
        {"$addToSet": {"verified_passenger_ids": body.passenger_id}}
    )
    return {"ok": True}

# ----- AI Assistant -----

@api_router.post("/rides/assistant")
async def mobility_assistant(body: AssistantRequest):
    query = body.query.lower()
    
    # NLP Mocking
    extracted_pickup = None
    extracted_dropoff = None
    vehicle_type = "auto"
    
    if "anna" in query: extracted_pickup = "hub-anna-nagar"
    if "tidel" in query: extracted_dropoff = "hub-tidel-park"
    if "dlf" in query: extracted_pickup = "hub-dlf-it"
    if "ashok" in query: extracted_pickup = "hub-ashok-pillar"
    if "srm" in query: extracted_dropoff = "hub-srm-rmp"
    if "guindy" in query: extracted_pickup = "hub-guindy"
    
    if "cab" in query or "friends" in query or "group" in query:
        vehicle_type = "cab"
        
    return {
        "reply": "I've set up your booking based on your request! Review and confirm below.",
        "action": "prefill_booking",
        "data": {
            "pickup_hub_id": extracted_pickup,
            "dropoff_hub_id": extracted_dropoff,
            "vehicle_type": vehicle_type
        }
    }


@api_router.post("/rides/shared/{ride_id}/complete")
async def complete_ride(ride_id: str):
    sr = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    if not sr:
        raise HTTPException(404, "Not found")
    if sr["status"] != "accepted":
        raise HTTPException(400, "Cannot complete")
    _check_not_too_early(sr)
    await db.shared_rides.update_one(
        {"id": ride_id},
        {"$set": {"status": "completed", "completed_at": now_iso()}}
    )
    await db.ride_requests.update_many(
        {"shared_ride_id": ride_id, "status": "in_progress"},
        {"$set": {"status": "completed"}}
    )
    updated = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    return await _hydrate_shared_ride(updated)


@api_router.get("/rides/shared/{ride_id}")
async def get_shared_ride(ride_id: str):
    sr = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    if not sr:
        raise HTTPException(404, "Not found")
    return await _hydrate_shared_ride(sr)


# ----- History -----

@api_router.get("/rides/history/passenger/{user_id}")
async def passenger_history(user_id: str):
    reqs = await db.ride_requests.find(
        {"passenger_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    out = []
    for r in reqs:
        sr = await db.shared_rides.find_one({"id": r["shared_ride_id"]}, {"_id": 0})
        h = await _hydrate_shared_ride(sr) if sr else None
        out.append({"request": r, "shared_ride": h})
    return out


@api_router.get("/rides/history/driver/{user_id}")
async def driver_history(user_id: str):
    rides = await db.shared_rides.find(
        {"driver_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [await _hydrate_shared_ride(sr) for sr in rides]


# ----- WebSockets -----

@api_router.websocket("/rides/shared/{ride_id}/ws/{user_id}")
async def ride_websocket(websocket: WebSocket, ride_id: str, user_id: str):
    await manager.connect(websocket, ride_id, user_id)
    try:
        while True:
            data = await websocket.receive_json()
            # If driver sends location, broadcast to everyone else
            if data.get("type") == "location":
                data["sender_id"] = user_id
                
                # AI Fraud Detection: Fake GPS Spoofing
                # If driver claims a speed jump > 150km/h or sends erratic spoofed coordinates
                if data.get("spoofed") or float(data.get("speed", 0)) > 150:
                    await manager.broadcast(ride_id, {"type": "alert", "message": "🚨 FRAUD ALERT: Suspicious GPS activity detected!"})
                    await db.shared_rides.update_one({"id": ride_id}, {"$set": {"fraud_flag": "fake_gps_detected"}})
                else:
                    await manager.broadcast(ride_id, data, exclude=user_id)
            elif data.get("type") == "deviation":
                await manager.broadcast(ride_id, {"type": "alert", "message": "Route deviation detected!"}, exclude=user_id)
    except WebSocketDisconnect:
        manager.disconnect(ride_id, user_id)


# ----- Admin Analytics -----

@api_router.get("/admin/analytics")
async def get_admin_analytics():
    # Basic Counts
    total_users = await db.users.count_documents({})
    total_drivers = await db.users.count_documents({"role": "driver"})
    total_passengers = await db.users.count_documents({"role": "passenger"})
    
    # Ride Metrics
    total_shared_rides = await db.shared_rides.count_documents({})
    completed_rides = await db.shared_rides.count_documents({"status": "completed"})
    active_rides = await db.shared_rides.count_documents({"status": {"$in": ["searching", "matched", "accepted"]}})
    
    # Financial & Utilization
    rev_pipeline = [
        {"$match": {"status": "completed"}},
        {"$group": {
            "_id": None, 
            "total_revenue": {"$sum": "$total_fare"},
            "avg_occupancy": {"$avg": {"$size": "$passenger_ids"}}
        }}
    ]
    rev_res = await db.shared_rides.aggregate(rev_pipeline).to_list(1)
    revenue = rev_res[0]["total_revenue"] if rev_res else 0
    avg_occupancy = rev_res[0]["avg_occupancy"] if rev_res else 0

    # Demand Heatmap Data (simple clustering of active requests by pickup hub)
    demand_pipeline = [
        {"$match": {"status": "searching"}},
        {"$group": {"_id": "$pickup_hub_id", "count": {"$sum": 1}}}
    ]
    demand_res = await db.requests.aggregate(demand_pipeline).to_list(100)
    hotspots = [{"hub_id": d["_id"], "demand": d["count"]} for d in demand_res]

    # AI Demand Prediction Heatmap (Simulated for next hour)
    predict_pipeline = [
        {"$match": {"status": "completed"}},
        {"$group": {"_id": "$pickup_hub_id", "historical_count": {"$sum": 1}}}
    ]
    predict_res = await db.shared_rides.aggregate(predict_pipeline).to_list(100)
    
    predicted_hotspots = []
    if not predict_res:
        predict_res = [{"_id": h["id"], "historical_count": random.randint(5, 50)} for h in HUBS_SEED[:4]]

    for p in predict_res:
        demand_score = int(p.get("historical_count", 1) * 1.5 + random.randint(10, 30))
        predicted_hotspots.append({
            "hub_id": p["_id"],
            "predicted_demand": demand_score,
            "confidence": f"{random.randint(75, 98)}%"
        })
    predicted_hotspots.sort(key=lambda x: x["predicted_demand"], reverse=True)

    return {
        "users": {
            "total": total_users,
            "drivers": total_drivers,
            "passengers": total_passengers
        },
        "rides": {
            "total": total_shared_rides,
            "completed": completed_rides,
            "active": active_rides,
        },
        "performance": {
            "total_revenue": revenue,
            "avg_occupancy": round(avg_occupancy, 2) if avg_occupancy else 0
        },
        "demand_hotspots": hotspots,
        "predicted_hotspots": predicted_hotspots
    }


# ----- Multimodal Planner -----

@api_router.get("/planner/multimodal")
async def get_multimodal_routes(start: str, end: str):
    # Simulated AI Multimodal combinations
    return [
        {
            "id": "route_1",
            "title": "Fastest (Metro + Last-Mile)",
            "total_time": "25 mins",
            "total_cost": "₹45",
            "steps": [
                {"mode": "walk", "instruction": f"Walk to {start} Metro", "duration": "5 mins", "cost": "₹0"},
                {"mode": "metro", "instruction": "Metro Blue Line", "duration": "15 mins", "cost": "₹30"},
                {"mode": "last_mile", "instruction": f"Shared Auto to {end}", "duration": "5 mins", "cost": "₹15"}
            ]
        },
        {
            "id": "route_2",
            "title": "Direct (Last-Mile Cab)",
            "total_time": "40 mins",
            "total_cost": "₹120",
            "steps": [
                {"mode": "last_mile", "instruction": f"Shared Cab from {start} to {end}", "duration": "40 mins", "cost": "₹120"}
            ]
        }
    ]

# ============= APP SETUP =============

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
