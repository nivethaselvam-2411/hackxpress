# Last-Mile: Shared Auto Matcher — PRD

## Overview
Last-Mile is a two-role mobile app (React Native / Expo) that automatically pools passengers travelling the same fixed hub-to-hub route into a shared auto (3 seats) or shared cab (4 seats), splitting the fare equally.

## Roles
1. **Passenger** — request a shared ride between two fixed hubs, get pooled with others, view fare share, driver info, PIN.
2. **Driver** — see incoming pooled ride requests, accept a batch, verify passengers by PIN, complete the ride, view earnings.

## Tech
- Frontend: Expo + Expo Router + TypeScript, react-native-safe-area-context, expo-image, expo-linear-gradient
- Backend: FastAPI + Motor (MongoDB)
- Auth: Simple phone + name (no OTP, MVP style). User stored in AsyncStorage.

## Data model
- `users` — id, name, phone, role (passenger|driver), vehicle_number, created_at
- `hubs` — Chennai seed (Ashok Pillar Metro, Vadapalani, SRM Ramapuram, DLF IT Park, Porur, Guindy, Ekkatuthangal, Alandur, Anna Nagar, Tidel Park)
- `shared_rides` — id, hubs, vehicle_type, capacity, passenger_ids[], driver_id, driver_name, vehicle_number, total_fare, per_passenger_fare, distance_km (vehicle span), host_km, scheduled_for, cancel_reason, status (pending → accepted → completed / cancelled), verified_passenger_ids[]
- `ride_requests` — id, passenger_id, hubs, vehicle_type, shared_ride_id, fare_share, solo_fare, pin (4 digits), status (searching → matched → in_progress → completed / cancelled), scheduled_for, t_start/t_end (position along pool route), exact_route, overlap_pct, match_score, match_reasons, cancel_reason

## Matching algorithm (AI Smart Matching + Route Overlap)
Logic lives in `backend/matching.py` (pure Python, unit-tested in `backend/tests/test_matching.py`).

On request, every open pool (same vehicle type, status=pending, seat free) is scored 0-100:

| Factor | Weight | Meaning |
|---|---|---|
| Route overlap | 45% | how much of the rider's trip runs along the pool's route (detour-penalised) |
| Time fit | 25% | scheduled rides only: closeness of departure times |
| Pool fill | 20% | fuller pools are more likely to leave full |
| Pool age | 10% | pools that have waited longer are favoured |

The best pool scoring >= 55 is joined (atomic seat claim); otherwise a new pool is created. Each match stores `match_score` and human-readable `match_reasons`. `POST /api/rides/preview` runs the same ranking without committing, so the passenger app can show the match and estimated fare before booking.

### Route overlap
A pool's route is anchored by its first rider (host route A -> B). A rider p -> q can join if both hubs are within 1.5 km of the A -> B line, in the same direction, with >= 40% of their trip along it. They board/alight at their own hubs; the driver sees each rider's segment.

### Scheduled rides
`scheduled_for` (optional, UTC ISO) on a request. Book 15 min to 7 days ahead. Scheduled rides pool only with scheduled rides departing within +/-15 min; ride-now only pools with ride-now. A scheduled ride does not cancel the passenger's ride-now search, and one passenger can't book two rides within 15 min of each other. Unaccepted scheduled pools expire 10 min after departure (`cancel_reason: no_driver`). Drivers can accept early, but PIN verification / completion opens 30 min before departure. Passengers can cancel a confirmed scheduled ride (they leave the pool; fares recompute).

## Fares
Base + per-km (auto: 60 + 15/km, cab: 100 + 22/km). Distance via haversine of hub coordinates.
The vehicle's fare covers the span from the earliest pickup to the latest drop-off. It is split in proportion to the distance each rider travels, so a rider on a shorter segment pays less. When everyone shares the exact same route this is an even split. Each request also stores `solo_fare` so the app can show savings.

## Safety
- Fixed public hubs only
- 4-digit PIN each passenger shows the driver at boarding
- Share Trip (native share sheet) + SOS (tel:112)

## Endpoints
- POST /api/auth/register
- GET /api/hubs
- POST /api/rides/request   (optional `scheduled_for`)
- POST /api/rides/preview   (smart-match preview: ranked pools + estimated fare)
- GET /api/rides/request/{id} (polling)
- POST /api/rides/request/{id}/cancel
- GET /api/rides/available (driver)
- POST /api/rides/shared/{id}/accept
- POST /api/rides/shared/{id}/verify-pin
- POST /api/rides/shared/{id}/complete
- GET /api/rides/shared/{id}
- GET /api/rides/history/passenger/{id}
- GET /api/rides/history/driver/{id}
