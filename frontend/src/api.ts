const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = `${BASE}/api${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export type User = {
  id: string;
  name: string;
  phone: string;
  role: "passenger" | "driver";
  vehicle_number?: string | null;
  gender?: "M" | "F" | "Other" | null;
  community?: string | null;
  created_at: string;
};

export type Hub = { id: string; name: string; area: string; lat: number; lng: number };

export type SharedRide = {
  id: string;
  pickup_hub_id: string;
  dropoff_hub_id: string;
  vehicle_type: "auto" | "cab";
  capacity: number;
  passenger_ids: string[];
  distance_km: number;
  total_fare: number;
  per_passenger_fare: number;
  status: "pending" | "accepted" | "completed" | "cancelled";
  driver_id: string | null;
  driver_name: string | null;
  vehicle_number: string | null;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  verified_passenger_ids: string[];
  scheduled_for?: string | null;      // ISO departure time; null/absent = ride now
  cancel_reason?: string | null;      // "no_driver" | "all_cancelled"
  ai_recommended?: boolean;           // True if AI dynamic allocation recommends this pool
  pickup?: Hub;
  dropoff?: Hub;
  passengers?: (User & {
    pin: string;
    fare_share?: number | null;
    pickup_name?: string | null;      // this rider's own boarding hub
    dropoff_name?: string | null;     // this rider's own drop hub
    partial_route?: boolean;          // true if they ride only part of the pool route
  })[];
};

export type RideRequest = {
  id: string;
  passenger_id: string;
  pickup_hub_id: string;
  dropoff_hub_id: string;
  vehicle_type: "auto" | "cab";
  status: "searching" | "matched" | "in_progress" | "completed" | "cancelled";
  shared_ride_id: string;
  fare_share: number;
  pin: string;
  created_at: string;
  cancel_reason?: string | null;
  scheduled_for?: string | null;
  solo_fare?: number;                 // what this rider would pay travelling alone
  exact_route?: boolean;
  overlap_pct?: number;               // % of their trip along the pool route
  match_score?: number | null;        // smart-match score 0-100 (null = they started the pool)
  match_reasons?: string[];
};

export type MatchCandidate = {
  pool_id: string;
  score: number;
  riders: number;
  capacity: number;
  overlap_pct: number;
  exact_route: boolean;
  reasons: string[];
  est_fare_share: number;
  departs: string | null;
};

export type MatchPreview = {
  distance_km: number;
  solo_fare: number;
  scheduled_for: string | null;
  best: MatchCandidate | null;
  candidates: MatchCandidate[];
};

export const api = {
  register: (b: { name: string; phone: string; role: "passenger" | "driver"; vehicle_number?: string; gender?: "M" | "F" | "Other" }) =>
    req<User>("/auth/register", { method: "POST", body: JSON.stringify(b) }),
  getUser: (id: string) => req<User>(`/users/${id}`),
  hubs: () => req<Hub[]>("/hubs"),
  requestRide: (b: {
    passenger_id: string;
    pickup_hub_id: string;
    dropoff_hub_id: string;
    vehicle_type: "auto" | "cab";
    scheduled_for?: string | null;    // ISO string; omit for ride-now
    preferences?: { quiet_ride?: boolean; female_only?: boolean };
  }) => req<RideRequest>("/rides/request", { method: "POST", body: JSON.stringify(b) }),
  previewMatch: (b: {
    passenger_id?: string;
    pickup_hub_id: string;
    dropoff_hub_id: string;
    vehicle_type: "auto" | "cab";
    scheduled_for?: string | null;
    preferences?: { quiet_ride?: boolean; female_only?: boolean };
  }) => req<MatchPreview>("/rides/preview", { method: "POST", body: JSON.stringify(b) }),
  getRequest: (id: string) =>
    req<{ request: RideRequest; shared_ride: SharedRide | null }>(`/rides/request/${id}`),
  cancelRequest: (id: string) => req(`/rides/request/${id}/cancel`, { method: "POST" }),
  availableRides: () => req<SharedRide[]>("/rides/available"),
  acceptRide: (rideId: string, driverId: string) =>
    req<SharedRide>(`/rides/shared/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driver_id: driverId }),
    }),
  verifyPin: (rideId: string, passenger_id: string, pin: string) =>
    req(`/rides/shared/${rideId}/verify-pin`, {
      method: "POST",
      body: JSON.stringify({ passenger_id, pin }),
    }),
  completeRide: (rideId: string) =>
    req<SharedRide>(`/rides/shared/${rideId}/complete`, { method: "POST" }),
  triggerSOS: (rideId: string) =>
    req(`/rides/shared/${rideId}/sos`, { method: "POST" }),
  sharedRide: (id: string) => req<SharedRide>(`/rides/shared/${id}`),
  passengerHistory: (id: string) =>
    req<{ request: RideRequest; shared_ride: SharedRide | null }[]>(`/rides/history/passenger/${id}`),
  driverHistory: (id: string) => req<SharedRide[]>(`/rides/history/driver/${id}`),
  getMultimodalRoutes: (start: string, end: string) =>
    req<MultimodalRoute[]>(`/planner/multimodal?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  mobilityAssistant: (query: string, passenger_id: string) =>
    req<{ reply: string; action: string; data: any }>("/rides/assistant", {
      method: "POST",
      body: JSON.stringify({ query, passenger_id }),
    }),
};

export type MultimodalRoute = {
  id: string;
  title: string;
  total_time: string;
  total_cost: string;
  steps: {
    mode: "walk" | "metro" | "last_mile";
    instruction: string;
    duration: string;
    cost: string;
  }[];
};
