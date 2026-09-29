import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, SHADOW } from "@/src/theme";
import { api } from "@/src/api";
import { formatDeparture } from "@/src/schedule";
import { useUser } from "@/src/hooks/use-user";

export default function PassengerHistory() {
  const { user } = useUser();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api.passengerHistory(user.id);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="history-back-btn" onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Your Rides</Text>
        <View style={{ width: 26 }} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.request.id}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.brandPrimary} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty} testID="history-empty">
              <Ionicons name="time-outline" size={40} color={COLORS.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No rides yet</Text>
              <Text style={styles.emptySub}>Your shared rides will appear here.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const s = item.shared_ride;
          const r = item.request;
          const statusColor =
            r.status === "completed" ? COLORS.success
            : r.status === "cancelled" ? COLORS.error
            : COLORS.warning;
          const scheduled = !!r.scheduled_for;
          const label =
            r.status === "cancelled" && r.cancel_reason === "no_driver" ? "NO DRIVER"
            : scheduled && r.status === "in_progress" ? "CONFIRMED"
            : scheduled && (r.status === "searching" || r.status === "matched") ? "SCHEDULED"
            : r.status.toUpperCase();
          const open = ["searching", "matched", "in_progress"].includes(r.status);
          return (
            <Pressable
              style={styles.card}
              testID={`history-item-${r.id}`}
              disabled={!open}
              onPress={() => router.push({ pathname: "/passenger/matching", params: { requestId: r.id } })}
            >
              <View style={styles.rowBetween}>
                <View style={styles.badge}>
                  <Ionicons
                    name={r.vehicle_type === "auto" ? "bicycle" : "car"}
                    size={14}
                    color={COLORS.onBrandTertiary}
                  />
                  <Text style={styles.badgeTxt}>
                    {r.vehicle_type === "auto" ? "Auto" : "Cab"}
                  </Text>
                </View>
                <Text style={[styles.statusChip, { color: statusColor }]}>
                  {label}
                </Text>
              </View>
              {scheduled && (
                <View style={styles.schedRow} testID={`history-scheduled-${r.id}`}>
                  <Ionicons name="calendar" size={14} color={COLORS.onBrandTertiary} />
                  <Text style={styles.schedTxt}>{formatDeparture(r.scheduled_for)}</Text>
                </View>
              )}
              <View style={{ marginTop: SPACING.md }}>
                <Text style={styles.hubTxt} numberOfLines={1}>
                  {s?.pickup?.name || "—"}
                </Text>
                <View style={styles.arrowLine}>
                  <Ionicons name="arrow-down" size={14} color={COLORS.onSurfaceTertiary} />
                </View>
                <Text style={styles.hubTxt} numberOfLines={1}>
                  {s?.dropoff?.name || "—"}
                </Text>
              </View>
              <View style={[styles.rowBetween, { marginTop: SPACING.md }]}>
                <Text style={styles.meta}>
                  {s?.passenger_ids?.length || 1} rider{(s?.passenger_ids?.length || 1) > 1 ? "s" : ""}
                </Text>
                <Text style={styles.fare}>₹{r.fare_share}</Text>
              </View>
            </Pressable>
          );
        }}
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
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brandTertiary, paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.pill },
  badgeTxt: { fontSize: FS.sm, color: COLORS.onBrandTertiary, fontWeight: "700" },
  schedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: SPACING.sm },
  schedTxt: { fontSize: FS.sm, fontWeight: "700", color: COLORS.onBrandTertiary },
  statusChip: { fontSize: FS.sm, fontWeight: "700", letterSpacing: 0.5 },
  hubTxt: { fontSize: FS.lg, fontWeight: "600", color: COLORS.onSurface },
  arrowLine: { marginVertical: 4 },
  meta: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary },
  fare: { fontSize: FS.xl, fontWeight: "800", color: COLORS.brandPrimary },
  empty: { alignItems: "center", paddingTop: SPACING.xxxl, gap: SPACING.sm },
  emptyTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.sm },
  emptySub: { fontSize: FS.base, color: COLORS.onSurfaceTertiary },
});
