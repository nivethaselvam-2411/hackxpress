# Last-Mile 🚗

**Share the ride. Split the fare.**
*Metro to college. Metro to tech park. Never solo.*

Last-Mile is a hub-based shared auto/cab matching app that pools commuters travelling the same fixed corridor into a single vehicle, splitting the fare automatically — solving the "last mile" gap between metro stations and nearby colleges, tech parks, and residential clusters.

---

## The Problem

Short last-mile trips (2–4 km from a metro station to a college or tech park) are expensive to book solo and inefficient to pool informally:

- Uber/Rapido offer **no fare pooling for autos** in India — it's always 1 rider, 1 vehicle, full fare
- Traditional "share auto" queues exist but have **no visibility** into who else is heading the same way, no fixed fare, no safety verification
- Riders either overpay for a solo auto or waste time waiting at an unregulated stand

Last-Mile fixes this for high-traffic, repetitive corridors where the same trip happens hundreds of times a day.

## How It Works

1. **Passenger** opens the app, selects a pickup hub and drop-off hub from a fixed list of known transit points, and chooses a vehicle type (Share Auto or Cab)
2. The app searches for other passengers requesting the **same hub-to-hub route** and pools them into one vehicle, up to capacity
3. Fare is split evenly and shown live as **"Your fare share"** while matching is in progress
4. **Driver** sees incoming shared ride requests with passenger count, route, and total earnings, and accepts with one tap
5. Driver navigates via a one-tap **Google Maps handoff**, verifies each passenger with a **4-digit PIN**, and marks the run complete once all passengers are dropped

## Core Innovation: Hub-Based Batch Pooling

Unlike Uber/Rapido's instant 1:1 dispatch, Last-Mile is built around **fixed corridors and pooled matching**:

- Requests for the same hub pair and vehicle type are grouped together, up to vehicle capacity (**Share Auto = 3 riders, Cab = 4 riders**)
- This maximizes vehicle occupancy and minimizes per-passenger cost, instead of surge-based dynamic pricing
- Because pickup/drop-off points are fixed, known public locations — not arbitrary street addresses — matching stays simple and safer by design

| | Uber / Rapido | Last-Mile |
|---|---|---|
| Matching | Instant 1:1, no pooling for autos | Batched, multi-passenger pooling |
| Pricing | Dynamic, surge-based | Fixed fare, split evenly, no surge |
| Routes | Anywhere in the city | Fixed high-traffic hub corridors |
| Vehicle occupancy | Often 1 passenger | Up to full capacity (3–4) |
| Backend cost | Enterprise infra | Fully serverless, free-tier Firebase |

## New: Smart Matching, Route Overlap & Scheduled Rides

- **AI Smart Matching** - instead of "same hub pair or nothing", every open pool is scored (route overlap, time fit, pool fill, wait time) and the best one above a threshold is joined. Passengers see a live **smart-match preview** with estimated fare and savings before booking, and the *why* behind their match afterwards.
- **Route Overlap** - a rider going SRM Ramapuram -> Porur can hop into a vehicle already running Ashok Pillar -> Porur, because their whole trip lies along that route. Riders board/alight at their own hubs and pay in proportion to the distance they travel; drivers see each rider's segment.
- **Scheduled Rides** - book 15 minutes to 7 days ahead. Riders leaving within 15 minutes of each other on the same route are pooled; drivers get a "Scheduled" filter plus an "Upcoming" list; unaccepted rides expire cleanly with a "No driver found" state.

Details: `memory/PRD.md`. Matching logic: `backend/matching.py`.

> Note: this README's Tech Stack / Data Model / Getting Started sections describe an earlier Flutter + Firebase design. The code in this repo is Expo (React Native) + FastAPI + MongoDB - see `memory/PRD.md`.

## Safety Features

- **Fixed, public pickup/drop-off hubs only** — no arbitrary street addresses
- **4-digit PIN verification** — passenger shows the driver a code before boarding to confirm they're getting into the correctly matched vehicle
- **Driver identity shown upfront** — name, phone number, and vehicle number visible to passengers before the ride starts
- **Direct call-out** — passengers and drivers can call each other directly from the active ride screen

## App Preview

**Passenger flow:** onboarding → select route → live matching with running fare share → confirmed ride
**Driver flow:** onboarding → incoming shared ride requests (auto-refreshing) → accept → active ride with passenger list, PIN verification, and Google Maps handoff

## Tech Stack

- **Frontend:** Flutter (separate apps for Passenger and Driver)
- **Backend:** Firebase — Firestore (data + realtime sync) and Anonymous Authentication
- **Matching engine:** Client-side Firestore transactions — no server, no Cloud Functions, no billing plan required. Fully serverless and free to run.

## Data Model

**Hubs:** `HUB_ASHOK_PILLAR`, `HUB_MIOT`, `HUB_DLF`, `HUB_SRM`
**Vehicle types:** `auto` (3 pax), `cab` (4 pax)

```
rideRequests
├── passengerId
├── passengerName
├── pickupHub
├── dropoffHub
├── vehiclePreference
├── timestamp
├── status          // "searching" → "matched"
└── matchedRideId

sharedRides
├── rideId
├── vehicleType
├── pickupHub
├── dropoffHub
├── status           // "pending" → "accepted" → "completed"
├── driverId
├── totalFare
└── passengers[]      // { name, passengerId, fareShare }
```

## Project Structure

```
last-mile/
├── firebase.json, .firebaserc, firestore.rules, firestore.indexes.json
├── functions/            # reserved for future server-side migration
├── passenger_app/        # Flutter passenger app
├── driver_app/           # Flutter driver app
└── SETUP.md
```

## Getting Started

```bash
# Passenger app
cd passenger_app
flutter pub get
flutter run

# Driver app
cd driver_app
flutter pub get
flutter run
```

Both apps connect to the shared Firebase project. Firestore rules and indexes are already deployed — no additional backend setup required.

## Impact

By pooling riders on predictable, high-volume corridors, Last-Mile reduces per-trip cost for passengers, increases per-trip earnings for drivers (multiple fares per run instead of one), and cuts the number of vehicles needed to move the same number of people — directly reducing congestion and emissions on short, repetitive routes.

## Team

- **Nithish** — Backend & integration
- **Nishal** — Passenger app
- **Nivetha** — Driver app
- **Santhana** — Infra & demo
