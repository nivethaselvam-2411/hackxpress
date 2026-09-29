import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, Linking, TextInput, ActivityIndicator, Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, SHADOW } from "@/src/theme";
import { api, type SharedRide } from "@/src/api";
import { formatDeparture } from "@/src/schedule";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useUser } from "@/src/hooks/use-user";

export default function DriverActive() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const router = useRouter();
  const { user } = useUser();
  const [sr, setSr] = useState<SharedRide | null>(null);
  const [pins, setPins] = useState<Record<string, string>>({});
  const [verifying, setVerifying] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    if (!rideId) return;
    try {
      const data = await api.sharedRide(String(rideId));
      setSr(data);
    } catch {}
  }, [rideId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  // Setup WebSocket for Live GPS
  useEffect(() => {
    if (!rideId || !user) return;
    
    // Connect to WebSocket
    const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "http://localhost:8000").replace("http", "ws");
    const socket = new WebSocket(`${base}/api/rides/shared/${rideId}/ws/${user.id}`);
    
    socket.onopen = () => {
      console.log("Driver WS connected");
    };
    
    ws.current = socket;
    
    // Mock sending GPS updates every 5 seconds
    const locInterval = setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN && sr?.pickup) {
        // Send a slight variation of the pickup location as a mock
        const lat = sr.pickup.lat + (Math.random() - 0.5) * 0.005;
        const lng = sr.pickup.lng + (Math.random() - 0.5) * 0.005;
        ws.current.send(JSON.stringify({ type: "location", lat, lng, speed: 30, heading: 90 }));
      }
    }, 5000);

    return () => {
      clearInterval(locInterval);
      socket.close();
    };
  }, [rideId, user?.id, sr?.pickup]);

  const simulateDeviation = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "deviation" }));
      Alert.alert("Simulated", "Route deviation alert sent to passengers");
    }
  };

  const verify = async (passengerId: string) => {
    const pin = (pins[passengerId] || "").trim();
    if (!sr || pin.length !== 4) {
      setErr("Enter 4-digit PIN");
      return;
    }
    setVerifying(passengerId);
    setErr(null);
    try {
      await api.verifyPin(sr.id, passengerId, pin);
      await load();
    } catch (e: any) {
      setErr(e.message || "Wrong PIN");
    }
    setVerifying(null);
  };

  const openMaps = () => {
    if (!sr?.dropoff) return;
    const { lat, lng, name } = sr.dropoff;
    const q = encodeURIComponent(`${name} @ ${lat},${lng}`);
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`).catch(() => {});
  };

  const complete = async () => {
    if (!sr) return;
    Alert.alert("Complete ride?", "All passengers dropped and fares collected?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Complete",
        onPress: async () => {
          setCompleting(true);
          try {
            await api.completeRide(sr.id);
            router.replace("/driver");
          } catch (e: any) {
            setErr(e.message || "Could not complete ride");
          }
          setCompleting(false);
        },
      },
    ]);
  };

  const simulateGPSFraud = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "location", lat: 0, lng: 0, speed: 180, spoofed: true }));
      Alert.alert("Fraud Simulated", "Sent spoofed GPS coordinates (180 km/h) to backend. Admin/Passengers will be alerted.");
    }
  };

  if (!sr) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={COLORS.brandSecondary} />
      </SafeAreaView>
    );
  }

  const verified = sr.verified_passenger_ids || [];
  const allVerified = verified.length === (sr.passengers?.length || 0);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="active-back-btn" onPress={() => router.replace("/driver")}>
          <Ionicons name="chevron-back" size={26} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Active Ride</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {sr.status === "cancelled" && (
          <View style={[styles.notice, { backgroundColor: COLORS.error }]} testID="ride-cancelled-banner">
            <Ionicons name="close-circle" size={20} color="#fff" />
            <Text style={styles.noticeTxt}>All passengers cancelled — this ride is closed.</Text>
          </View>
        )}
        {sr.scheduled_for && (
          <View style={styles.notice} testID="active-scheduled-banner">
            <Ionicons name="calendar" size={20} color={COLORS.onBrandTertiary} />
            <Text style={[styles.noticeTxt, { color: COLORS.onBrandTertiary }]}>
              Scheduled · {formatDeparture(sr.scheduled_for)}
            </Text>
          </View>
        )}
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: COLORS.brandPrimary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.smLabel}>PICKUP</Text>
              <Text style={styles.hubTxt}>{sr.pickup?.name}</Text>
            </View>
          </View>
          <View style={styles.tlLine} />
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: COLORS.brandSecondary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.smLabel}>DROP-OFF</Text>
              <Text style={styles.hubTxt}>{sr.dropoff?.name}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{sr.distance_km} km</Text>
            <Text style={styles.meta}>·</Text>
            <Text style={styles.meta}>
              {sr.passenger_ids.length}/{sr.capacity} riders
            </Text>
            <Text style={[styles.meta, { marginLeft: "auto", color: COLORS.brandPrimary, fontWeight: "800", fontSize: FS.lg }]}>
              ₹{sr.total_fare}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: SPACING.md, flexWrap: "wrap" }}>
          <Pressable testID="navigate-btn" onPress={openMaps} style={[styles.navBtn, { minWidth: "45%" }]}>
            <Ionicons name="navigate" size={20} color="#fff" />
            <Text style={styles.navBtnTxt}>Maps</Text>
          </Pressable>
          <Pressable testID="deviation-btn" onPress={simulateDeviation} style={[styles.navBtn, { minWidth: "45%", backgroundColor: COLORS.error }]}>
            <Ionicons name="warning" size={20} color="#fff" />
            <Text style={styles.navBtnTxt}>Deviate</Text>
          </Pressable>
          <Pressable testID="fraud-btn" onPress={simulateGPSFraud} style={[styles.navBtn, { minWidth: "100%", backgroundColor: COLORS.warning }]}>
            <Ionicons name="flash" size={20} color="#fff" />
            <Text style={styles.navBtnTxt}>Spoof GPS</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Passengers ({sr.passengers?.length || 0})</Text>

        {sr.passengers?.map((p) => {
          const isVerified = verified.includes(p.id);
          return (
            <View key={p.id} style={styles.paxCard} testID={`pax-${p.id}`}>
              <View style={styles.paxTop}>
                <View style={styles.paxAvatar}>
                  <Ionicons name="person" size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paxName}>{p.name}</Text>
                  <Text style={styles.paxPhone}>+91 {p.phone}</Text>
                  {p.partial_route && (
                    <Text style={styles.paxSeg} testID={`pax-seg-${p.id}`}>
                      {p.pickup_name} → {p.dropoff_name}
                    </Text>
                  )}
                </View>
                {isVerified ? (
                  <View style={styles.okBadge}>
                    <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
                    <Text style={styles.okTxt}>Boarded</Text>
                  </View>
                ) : (
                  <Pressable
                    testID={`call-pax-${p.id}`}
                    onPress={() => Linking.openURL(`tel:${p.phone}`).catch(() => {})}
                    style={styles.callBtn}
                  >
                    <Ionicons name="call" size={16} color={COLORS.brandSecondary} />
                  </Pressable>
                )}
              </View>
              {!isVerified && (
                <View style={styles.pinRow}>
                  <TextInput
                    testID={`pin-input-${p.id}`}
                    placeholder="4-digit PIN"
                    placeholderTextColor={COLORS.onSurfaceTertiary}
                    style={styles.pinInput}
                    keyboardType="number-pad"
                    maxLength={4}
                    value={pins[p.id] || ""}
                    onChangeText={(t) => setPins((prev) => ({ ...prev, [p.id]: t }))}
                  />
                  <Pressable
                    testID={`verify-pin-${p.id}`}
                    disabled={verifying === p.id}
                    onPress={() => verify(p.id)}
                    style={styles.verifyBtn}
                  >
                    {verifying === p.id ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.verifyTxt}>Verify</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
        {err && <Text testID="verify-error" style={styles.err}>{err}</Text>}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable
          testID="complete-ride-btn"
          disabled={completing}
          onPress={complete}
          style={[
            styles.completeBtn,
            { backgroundColor: allVerified ? COLORS.success : COLORS.brandSecondary },
          ]}
        >
          {completing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-done" size={20} color="#fff" />
              <Text style={styles.completeTxt}>Complete Hub Run</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surfaceSecondary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  headerTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface },
  body: { padding: SPACING.lg, paddingBottom: SPACING.xxxl },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, ...SHADOW.card },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  dot: { width: 12, height: 12, borderRadius: 6 },
  smLabel: { fontSize: 10, letterSpacing: 1, color: COLORS.onSurfaceTertiary, fontWeight: "700" },
  hubTxt: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface, marginTop: 2 },
  tlLine: { width: 2, height: 20, backgroundColor: COLORS.borderStrong, marginLeft: 5, marginVertical: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginTop: SPACING.md },
  meta: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, fontWeight: "600" },
  navBtn: {
    marginTop: SPACING.md, backgroundColor: COLORS.brandSecondary, height: 52,
    borderRadius: RADIUS.pill, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: SPACING.sm,
  },
  navBtnTxt: { color: "#fff", fontSize: FS.lg, fontWeight: "700" },
  section: { fontSize: FS.base, fontWeight: "800", color: COLORS.onSurfaceSecondary, marginTop: SPACING.xl, marginBottom: SPACING.md },
  paxCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOW.card },
  paxTop: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  paxAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.brandSecondary, alignItems: "center", justifyContent: "center" },
  paxName: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface },
  notice: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md,
    borderRadius: RADIUS.md, backgroundColor: COLORS.brandTertiary, marginBottom: SPACING.md,
  },
  noticeTxt: { flex: 1, fontSize: FS.base, fontWeight: "700", color: "#fff" },
  paxSeg: { fontSize: FS.sm, fontWeight: "700", color: COLORS.brandPrimary, marginTop: 2 },
  paxPhone: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  callBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  okBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  okTxt: { color: COLORS.success, fontWeight: "700", fontSize: FS.sm },
  pinRow: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md },
  pinInput: {
    flex: 1, backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, height: 46, fontSize: FS.lg, letterSpacing: 4,
    color: COLORS.onSurface, fontWeight: "700",
  },
  verifyBtn: {
    height: 46, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.md,
    backgroundColor: COLORS.brandPrimary, alignItems: "center", justifyContent: "center",
  },
  verifyTxt: { color: "#fff", fontWeight: "700", fontSize: FS.base },
  err: { color: COLORS.error, fontSize: FS.sm, marginTop: SPACING.sm, textAlign: "center" },
  bottomBar: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.divider },
  completeBtn: {
    height: 54, borderRadius: RADIUS.pill, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: SPACING.sm,
  },
  completeTxt: { color: "#fff", fontSize: FS.lg, fontWeight: "700" },
});
