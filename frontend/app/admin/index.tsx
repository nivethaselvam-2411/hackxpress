import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, SHADOW } from "@/src/theme";

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL || "http://localhost:8000"}/api/admin/analytics`);
        const json = await res.json();
        setData(json);
      } catch (e) {
        console.log(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
    const t = setInterval(fetchAnalytics, 10000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={COLORS.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace("/")}>
          <Ionicons name="home" size={24} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Mobility Intelligence</Text>
        <Ionicons name="analytics" size={24} color={COLORS.brandPrimary} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.grid}>
          <StatCard title="Total Users" value={data?.users?.total || 0} icon="people" color={COLORS.brandPrimary} />
          <StatCard title="Active Rides" value={data?.rides?.active || 0} icon="car" color={COLORS.brandSecondary} />
          <StatCard title="Total Revenue" value={`₹${data?.performance?.total_revenue || 0}`} icon="cash" color={COLORS.success} />
          <StatCard title="Avg Occupancy" value={data?.performance?.avg_occupancy || 0} icon="pie-chart" color={COLORS.warning} />
        </View>

        <Text style={styles.sectionTitle}>Demand Hotspots</Text>
        {data?.demand_hotspots?.length > 0 ? (
          data.demand_hotspots.map((h: any, i: number) => (
            <View key={i} style={styles.card}>
              <View style={styles.row}>
                <Ionicons name="flame" size={24} color={COLORS.error} />
                <View style={{ flex: 1, marginLeft: SPACING.md }}>
                  <Text style={styles.cardTitle}>{h.hub_id}</Text>
                  <Text style={styles.cardSub}>{h.demand} active requests</Text>
                </View>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>No active demand hotspots.</Text>
        )}

        <Text style={[styles.sectionTitle, { color: COLORS.brandPrimary }]}>
          <Ionicons name="sparkles" size={20} /> AI Demand Prediction (Next Hour)
        </Text>
        {data?.predicted_hotspots?.length > 0 ? (
          data.predicted_hotspots.map((h: any, i: number) => (
            <View key={`pred-${i}`} style={[styles.card, { borderColor: COLORS.brandPrimary, borderWidth: 1 }]}>
              <View style={styles.row}>
                <Ionicons name="trending-up" size={24} color={COLORS.brandPrimary} />
                <View style={{ flex: 1, marginLeft: SPACING.md }}>
                  <Text style={styles.cardTitle}>{h.hub_id}</Text>
                  <Text style={styles.cardSub}>
                    Predicted: {h.predicted_demand} requests · {h.confidence} Confidence
                  </Text>
                </View>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>AI prediction model gathering data...</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ title, value, icon, color }: any) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.iconBg, { backgroundColor: color + "20" }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surfaceSecondary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    height: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  headerTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface },
  body: { padding: SPACING.lg, paddingBottom: SPACING.xxxl },
  sectionTitle: { fontSize: FS.xl, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.md, marginTop: SPACING.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md },
  statCard: {
    flex: 1, minWidth: "45%", backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, ...SHADOW.card,
  },
  iconBg: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: SPACING.md },
  statValue: { fontSize: FS.xxl, fontWeight: "800", color: COLORS.onSurface },
  statTitle: { fontSize: FS.sm, color: COLORS.onSurfaceSecondary, marginTop: 4, fontWeight: "600" },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.sm, ...SHADOW.card },
  row: { flexDirection: "row", alignItems: "center" },
  cardTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface },
  cardSub: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  empty: { fontSize: FS.base, color: COLORS.onSurfaceSecondary, fontStyle: "italic", marginTop: SPACING.sm },
});
