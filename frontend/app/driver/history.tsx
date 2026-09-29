import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, SHADOW } from "@/src/theme";
import { api, type SharedRide } from "@/src/api";
import { useUser } from "@/src/hooks/use-user";

export default function DriverHistory() {
  const { user } = useUser();
  const router = useRouter();
  const [rides, setRides] = useState<SharedRide[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try { setRides(await api.driverHistory(user.id)); } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const totalEarnings = rides
    .filter((r) => r.status === "completed")
    .reduce((s, r) => s + r.total_fare, 0);
  const completed = rides.filter((r) => r.status === "completed").length;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="driver-history-back-btn" onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Your Rides</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryLabel}>Total earnings</Text>
          <Text style={styles.summaryValue}>₹{totalEarnings}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryLabel}>Rides done</Text>
          <Text style={styles.summaryValue}>{completed}</Text>
        </View>
      </View>

      <FlatList
        data={rides}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.brandSecondary} />}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty} testID="driver-history-empty">
              <Ionicons name="clipboard-outline" size={40} color={COLORS.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No rides yet</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card} testID={`driver-history-${item.id}`}>
            <View style={styles.rowBetween}>
              <View style={styles.badge}>
                <Ionicons
                  name={item.vehicle_type === "auto" ? "bicycle" : "car"}
                  size={14}
                  color={COLORS.onBrandTertiary}
                />
                <Text style={styles.badgeTxt}>
                  {item.vehicle_type === "auto" ? "Auto" : "Cab"}
                </Text>
              </View>
              <Text
                style={[
                  styles.statusChip,
                  {
                    color:
                      item.status === "completed" ? COLORS.success
                      : item.status === "cancelled" ? COLORS.error
                      : COLORS.warning,
                  },
                ]}
              >
                {item.status.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.hubTxt} numberOfLines={1}>{item.pickup?.name}</Text>
            <View style={styles.arrowLine}>
              <Ionicons name="arrow-down" size={14} color={COLORS.onSurfaceTertiary} />
            </View>
            <Text style={styles.hubTxt} numberOfLines={1}>{item.dropoff?.name}</Text>
            <View style={[styles.rowBetween, { marginTop: SPACING.md }]}>
              <Text style={styles.meta}>
                {item.passenger_ids.length} rider{item.passenger_ids.length > 1 ? "s" : ""} · {item.distance_km} km
              </Text>
              <Text style={styles.fare}>₹{item.total_fare}</Text>
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
    height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  headerTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface },
  summary: {
    flexDirection: "row", backgroundColor: COLORS.brandSecondary, margin: SPACING.lg,
    borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: "center",
  },
  summaryBlock: { flex: 1 },
  summaryLabel: { color: "rgba(255,255,255,0.75)", fontSize: FS.sm, fontWeight: "600" },
  summaryValue: { color: "#fff", fontSize: FS.xxl, fontWeight: "800", marginTop: 2 },
  summaryDivider: { width: 1, height: 40, backgroundColor: "rgba(255,255,255,0.2)", marginHorizontal: SPACING.md },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brandTertiary, paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.pill },
  badgeTxt: { fontSize: FS.sm, color: COLORS.onBrandTertiary, fontWeight: "700" },
  statusChip: { fontSize: FS.sm, fontWeight: "800", letterSpacing: 0.5 },
  hubTxt: { fontSize: FS.lg, fontWeight: "600", color: COLORS.onSurface, marginTop: SPACING.md },
  arrowLine: { marginVertical: 4 },
  meta: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary },
  fare: { fontSize: FS.xl, fontWeight: "800", color: COLORS.onSurface },
  empty: { alignItems: "center", paddingTop: SPACING.xxxl, gap: SPACING.sm },
  emptyTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.sm },
});
