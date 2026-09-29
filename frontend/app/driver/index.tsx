import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, IMAGES, SHADOW } from "@/src/theme";
import { api, type SharedRide } from "@/src/api";
import { formatDeparture, isDueSoon } from "@/src/schedule";
import { useUser, clearStoredUser } from "@/src/hooks/use-user";

export default function DriverHome() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const [online, setOnline] = useState(true);
  const [rides, setRides] = useState<SharedRide[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "now" | "scheduled">("all");
  const [upcoming, setUpcoming] = useState<SharedRide[]>([]);

  useEffect(() => {
    if (!userLoading && (!user || user.role !== "driver")) router.replace("/onboarding");
  }, [user, userLoading]);

  const load = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      const [avail, hist] = await Promise.all([
        api.availableRides(),
        api.driverHistory(user.id),
      ]);
      // accepted rides: the one departing now is "active"; later scheduled ones are "upcoming"
      const accepted = hist.filter((r) => r.status === "accepted");
      const active = accepted.find((r) => isDueSoon(r.scheduled_for));
      setActiveRideId(active?.id || null);
      setUpcoming(
        accepted
          .filter((r) => !isDueSoon(r.scheduled_for))
          .sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)))
      );
      setRides(avail);
    } catch {}
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
    if (!online) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [user, online, load]);

  const accept = async (rideId: string) => {
    if (!user) return;
    setAcceptingId(rideId);
    try {
      await api.acceptRide(rideId, user.id);
      router.push({ pathname: "/driver/active", params: { rideId } });
    } catch {}
    setAcceptingId(null);
  };

  const shown = rides.filter((r) =>
    filter === "all" ? true : filter === "scheduled" ? !!r.scheduled_for : !r.scheduled_for
  );

  const logout = async () => {
    await clearStoredUser();
    router.replace("/onboarding");
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>{user?.name || "Driver"}</Text>
          <Text style={styles.subline}>{user?.vehicle_number || ""}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: SPACING.sm, alignItems: "center" }}>
          <Pressable
            testID="online-toggle"
            onPress={() => setOnline((v) => !v)}
            style={[
              styles.onlineChip,
              { backgroundColor: online ? COLORS.success : COLORS.surfaceTertiary },
            ]}
          >
            <View
              style={[
                styles.onlineDot,
                { backgroundColor: online ? "#fff" : COLORS.onSurfaceTertiary },
              ]}
            />
            <Text
              style={[
                styles.onlineTxt,
                { color: online ? "#fff" : COLORS.onSurfaceSecondary },
              ]}
            >
              {online ? "Online" : "Offline"}
            </Text>
          </Pressable>
          <Pressable testID="driver-history-btn" onPress={() => router.push("/driver/history")} style={styles.iconBtn}>
            <Ionicons name="time-outline" size={20} color={COLORS.onSurface} />
          </Pressable>
          <Pressable testID="driver-logout-btn" onPress={logout} style={styles.iconBtn}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.onSurface} />
          </Pressable>
        </View>
      </View>

      {/* Active ride banner */}
      {activeRideId && (
        <Pressable
          testID="active-ride-banner"
          onPress={() => router.push({ pathname: "/driver/active", params: { rideId: activeRideId } })}
          style={styles.activeBanner}
        >
          <Ionicons name="navigate" size={20} color="#fff" />
          <Text style={styles.activeBannerTxt}>You have an active ride — tap to resume</Text>
          <Ionicons name="chevron-forward" size={20} color="#fff" />
        </Pressable>
      )}

      {/* Stats card */}
      <View style={styles.statsCard}>
        <Text style={styles.statsLabel}>Incoming shared rides</Text>
        <Text style={styles.statsValue}>{shown.length}</Text>
        <Text style={styles.statsFoot}>
          {online ? "Auto-refreshing every 4s" : "Go online to receive requests"}
        </Text>
      </View>

      <FlatList
        data={online ? shown : []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} tintColor={COLORS.brandSecondary} />
        }
        ListHeaderComponent={
          <View>
            {upcoming.length > 0 && (
              <View testID="upcoming-section" style={{ marginBottom: SPACING.md }}>
                <Text style={styles.sectionHead}>Your upcoming scheduled rides</Text>
                {upcoming.map((u) => (
                  <Pressable
                    key={u.id}
                    testID={`upcoming-${u.id}`}
                    onPress={() => router.push({ pathname: "/driver/active", params: { rideId: u.id } })}
                    style={styles.upCard}
                  >
                    <Ionicons name="calendar" size={18} color={COLORS.onBrandTertiary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.upTime}>{formatDeparture(u.scheduled_for)}</Text>
                      <Text style={styles.upRoute} numberOfLines={1}>
                        {u.pickup?.name} → {u.dropoff?.name} · {u.passenger_ids.length} rider
                        {u.passenger_ids.length === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <Text style={styles.upFare}>₹{u.total_fare}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.filterRow} testID="ride-filter">
              {(["all", "now", "scheduled"] as const).map((f) => (
                <Pressable
                  key={f}
                  testID={`filter-${f}`}
                  onPress={() => setFilter(f)}
                  style={[styles.filterChip, filter === f && styles.filterChipOn]}
                >
                  <Text style={[styles.filterTxt, filter === f && styles.filterTxtOn]}>
                    {f === "all" ? "All" : f === "now" ? "Ride now" : "Scheduled"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty} testID="driver-empty">
            <View style={styles.emptyImgWrap}>
              <Image source={IMAGES.driverEmpty} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={styles.emptyScrim} />
            </View>
            <Text style={styles.emptyTitle}>
              {online ? "Waiting for nearby hub requests" : "You are offline"}
            </Text>
            <Text style={styles.emptySub}>
              {online
                ? "New shared ride requests will appear here instantly."
                : "Toggle Online to start receiving rides."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.rideCard, item.ai_recommended && styles.rideCardRecommended]} testID={`ride-${item.id}`}>
            {item.ai_recommended && (
              <View style={styles.aiBadge}>
                <Ionicons name="sparkles" size={12} color="#fff" />
                <Text style={styles.aiBadgeTxt}>AI RECOMMENDED POOL</Text>
              </View>
            )}
            <View style={styles.rideTop}>
              <View style={styles.paxPill}>
                <Ionicons name="people" size={14} color={COLORS.onBrandSecondary} />
                <Text style={styles.paxPillTxt}>
                  {item.passenger_ids.length}/{item.capacity}
                </Text>
              </View>
              <View style={styles.badge}>
                <Ionicons
                  name={item.vehicle_type === "auto" ? "bicycle" : "car"}
                  size={13}
                  color={COLORS.onBrandTertiary}
                />
                <Text style={styles.badgeTxt}>
                  {item.vehicle_type === "auto" ? "Share Auto" : "Share Cab"}
                </Text>
              </View>
              <Text style={styles.distTxt}>{item.distance_km} km</Text>
            </View>

            {item.scheduled_for && (
              <View style={styles.schedBadge} testID={`scheduled-${item.id}`}>
                <Ionicons name="calendar" size={14} color={COLORS.onBrandTertiary} />
                <Text style={styles.schedBadgeTxt}>{formatDeparture(item.scheduled_for)}</Text>
              </View>
            )}

            <View style={styles.timeline}>
              <View style={styles.tlRow}>
                <View style={[styles.tlDot, { backgroundColor: COLORS.brandPrimary }]} />
                <Text style={styles.tlHub}>{item.pickup?.name}</Text>
              </View>
              <View style={styles.tlLine} />
              <View style={styles.tlRow}>
                <View style={[styles.tlDot, { backgroundColor: COLORS.brandSecondary }]} />
                <Text style={styles.tlHub}>{item.dropoff?.name}</Text>
              </View>
            </View>

            {item.passengers?.some((p) => p.partial_route) && (
              <View style={styles.segBox} testID={`segments-${item.id}`}>
                <Text style={styles.segHead}>Riders joining along the route</Text>
                {item.passengers
                  .filter((p) => p.partial_route)
                  .map((p) => (
                    <Text key={p.id} style={styles.segRow}>
                      {p.name}: {p.pickup_name} → {p.dropoff_name}
                    </Text>
                  ))}
              </View>
            )}

            <View style={styles.rideBottom}>
              <View>
                <Text style={styles.fareLabel}>You earn</Text>
                <Text style={styles.fareValue}>₹{item.total_fare}</Text>
              </View>
              <Pressable
                testID={`accept-ride-${item.id}`}
                disabled={acceptingId === item.id}
                onPress={() => accept(item.id)}
                style={styles.acceptBtn}
              >
                {acceptingId === item.id ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.acceptTxt}>Accept</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </>
                )}
              </Pressable>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surfaceSecondary },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: SPACING.lg, backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  hello: { fontSize: FS.xl, fontWeight: "800", color: COLORS.onSurface },
  subline: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2, letterSpacing: 1 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  onlineChip: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.pill,
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineTxt: { fontSize: FS.sm, fontWeight: "700" },
  activeBanner: {
    backgroundColor: COLORS.brandSecondary, marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    borderRadius: RADIUS.md, padding: SPACING.md, flexDirection: "row",
    alignItems: "center", gap: SPACING.sm,
  },
  activeBannerTxt: { color: "#fff", flex: 1, fontWeight: "700", fontSize: FS.base },
  statsCard: {
    backgroundColor: COLORS.surface, margin: SPACING.lg, padding: SPACING.lg,
    borderRadius: RADIUS.lg, ...SHADOW.card,
  },
  statsLabel: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, fontWeight: "600" },
  statsValue: { fontSize: 40, fontWeight: "800", color: COLORS.onSurface, marginVertical: 2 },
  statsFoot: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary },
  rideCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card },
  rideCardRecommended: { borderColor: COLORS.brandPrimary, borderWidth: 2 },
  aiBadge: {
    position: "absolute", top: -10, left: SPACING.lg, backgroundColor: COLORS.brandPrimary,
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: RADIUS.pill, zIndex: 2,
  },
  aiBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  rideTop: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginTop: 4 },
  paxPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brandSecondary, paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.pill },
  paxPillTxt: { color: "#fff", fontSize: FS.sm, fontWeight: "800" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brandTertiary, paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.pill },
  badgeTxt: { fontSize: FS.sm, color: COLORS.onBrandTertiary, fontWeight: "700" },
  distTxt: { marginLeft: "auto", fontSize: FS.sm, color: COLORS.onSurfaceTertiary, fontWeight: "600" },
  timeline: { marginVertical: SPACING.md },
  tlRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  tlDot: { width: 10, height: 10, borderRadius: 5 },
  tlHub: { fontSize: FS.lg, color: COLORS.onSurface, fontWeight: "600", flex: 1 },
  tlLine: { width: 2, height: 18, backgroundColor: COLORS.borderStrong, marginLeft: 4 },
  sectionHead: { fontSize: FS.base, fontWeight: "800", color: COLORS.onSurfaceSecondary, marginBottom: SPACING.sm },
  upCard: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md,
    borderRadius: RADIUS.md, backgroundColor: COLORS.brandTertiary, marginBottom: SPACING.sm,
  },
  upTime: { fontSize: FS.base, fontWeight: "800", color: COLORS.onBrandTertiary },
  upRoute: { fontSize: FS.sm, color: COLORS.onBrandTertiary, marginTop: 2 },
  upFare: { fontSize: FS.lg, fontWeight: "800", color: COLORS.onBrandTertiary },
  filterRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.md },
  filterChip: { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface },
  filterChipOn: { backgroundColor: COLORS.brandSecondary },
  filterTxt: { fontSize: FS.sm, fontWeight: "700", color: COLORS.onSurfaceSecondary },
  filterTxtOn: { color: "#fff" },
  schedBadge: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    marginTop: SPACING.md, paddingHorizontal: SPACING.sm, paddingVertical: 4,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.brandTertiary,
  },
  schedBadgeTxt: { fontSize: FS.sm, fontWeight: "700", color: COLORS.onBrandTertiary },
  segBox: { backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm },
  segHead: { fontSize: FS.sm, fontWeight: "800", color: COLORS.onSurfaceSecondary, marginBottom: 2 },
  segRow: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  rideBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: SPACING.sm },
  fareLabel: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary },
  fareValue: { fontSize: FS.xxl, fontWeight: "800", color: COLORS.onSurface },
  acceptBtn: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.xl, height: 46, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.brandSecondary,
  },
  acceptTxt: { color: "#fff", fontSize: FS.base, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: SPACING.lg },
  emptyImgWrap: { width: "100%", height: 180, borderRadius: RADIUS.lg, overflow: "hidden", marginBottom: SPACING.lg },
  emptyScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.35)" },
  emptyTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface, textAlign: "center" },
  emptySub: { fontSize: FS.base, color: COLORS.onSurfaceTertiary, textAlign: "center", marginTop: SPACING.sm, paddingHorizontal: SPACING.lg },
});
