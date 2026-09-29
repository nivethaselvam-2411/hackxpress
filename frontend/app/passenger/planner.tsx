import React, { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Alert, SafeAreaView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import api, { MultimodalRoute } from "../../src/api";
import { COLORS, FS, SPACING, SHADOW, RADIUS } from "../../src/theme";
import styles from "./index.styles";

export default function Planner() {
  const router = useRouter();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [routes, setRoutes] = useState<MultimodalRoute[] | null>(null);
  const [loading, setLoading] = useState(false);

  const plan = async () => {
    if (!start.trim() || !end.trim()) {
      Alert.alert("Error", "Enter start and destination");
      return;
    }
    setLoading(true);
    try {
      const res = await api.getMultimodalRoutes(start, end);
      setRoutes(res);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (mode: string) => {
    if (mode === "walk") return "walk";
    if (mode === "metro") return "train";
    return "car";
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: SPACING.md, backgroundColor: COLORS.surface, ...SHADOW.card, zIndex: 10 }}>
        <Pressable onPress={() => router.replace("/passenger")}>
          <Ionicons name="chevron-back" size={26} color={COLORS.onSurface} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface, marginLeft: SPACING.sm }}>
          AI Route Planner
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.md }}>
        <View style={{ backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, ...SHADOW.card }}>
          <Text style={{ fontSize: FS.sm, fontWeight: "600", color: COLORS.onSurfaceSecondary, marginBottom: 4 }}>FROM</Text>
          <TextInput
            placeholder="e.g. My Home, Velachery"
            value={start}
            onChangeText={setStart}
            style={{ backgroundColor: COLORS.surfaceSecondary, padding: SPACING.sm, borderRadius: RADIUS.sm, fontSize: FS.base, marginBottom: SPACING.md }}
          />
          <Text style={{ fontSize: FS.sm, fontWeight: "600", color: COLORS.onSurfaceSecondary, marginBottom: 4 }}>TO</Text>
          <TextInput
            placeholder="e.g. DLF IT Park"
            value={end}
            onChangeText={setEnd}
            style={{ backgroundColor: COLORS.surfaceSecondary, padding: SPACING.sm, borderRadius: RADIUS.sm, fontSize: FS.base, marginBottom: SPACING.md }}
          />
          <Pressable
            onPress={plan}
            disabled={loading}
            style={{ backgroundColor: COLORS.brandPrimary, padding: SPACING.md, borderRadius: RADIUS.md, alignItems: "center" }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: FS.base }}>Plan Multimodal Route</Text>}
          </Pressable>
        </View>

        {routes && (
          <View style={{ marginTop: SPACING.xl }}>
            <Text style={{ fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface, marginBottom: SPACING.md }}>Recommended Routes</Text>
            {routes.map((route: MultimodalRoute) => (
              <View key={route.id} style={{ backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md, ...SHADOW.card }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: SPACING.sm }}>
                  <Text style={{ fontSize: FS.base, fontWeight: "700", color: COLORS.onSurface }}>{route.title}</Text>
                  <Text style={{ fontSize: FS.base, fontWeight: "700", color: COLORS.brandPrimary }}>{route.total_cost}</Text>
                </View>
                <Text style={{ fontSize: FS.sm, color: COLORS.onSurfaceSecondary, marginBottom: SPACING.md }}>Total Time: {route.total_time}</Text>
                
                {route.steps.map((step: MultimodalRoute["steps"][0], idx: number) => (
                  <View key={idx} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: SPACING.sm }}>
                    <View style={{ width: 32, alignItems: "center", marginRight: SPACING.sm }}>
                      <Ionicons name={getIcon(step.mode) as any} size={20} color={COLORS.brandPrimary} />
                      {idx < route.steps.length - 1 && <View style={{ width: 2, height: 20, backgroundColor: COLORS.brandPrimary, marginTop: 4 }} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: FS.sm, fontWeight: "600", color: COLORS.onSurface }}>{step.instruction}</Text>
                      <Text style={{ fontSize: FS.sm, color: COLORS.onSurfaceTertiary }}>{step.duration} • {step.cost}</Text>
                    </View>
                  </View>
                ))}
                
                <Pressable
                  style={{ marginTop: SPACING.md, backgroundColor: COLORS.brandSecondary, padding: SPACING.sm, borderRadius: RADIUS.sm, alignItems: "center" }}
                  onPress={() => {
                    Alert.alert("Selected", "In a full app, this would pre-fill your hubs and book the Last-Mile segment!");
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "600" }}>Select Route</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
