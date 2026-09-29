import { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, IMAGES, SHADOW } from "@/src/theme";
import { api } from "@/src/api";
import { useUser } from "@/src/hooks/use-user";

export default function Onboarding() {
  const router = useRouter();
  const { setUser } = useUser();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"passenger" | "driver">("passenger");
  const [vehicle, setVehicle] = useState("");
  const [community, setCommunity] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accent = role === "passenger" ? COLORS.brandPrimary : COLORS.brandSecondary;

  const submit = async () => {
    setErr(null);
    if (!name.trim() || phone.trim().length < 10) {
      setErr("Enter your name and a valid 10-digit phone");
      return;
    }
    if (role === "driver" && !vehicle.trim()) {
      setErr("Enter your vehicle number");
      return;
    }
    setLoading(true);
    try {
      const u = await api.register({
        name: name.trim(),
        phone: phone.trim(),
        role,
        vehicle_number: role === "driver" ? vehicle.trim().toUpperCase() : undefined,
        community: community.trim() ? community.trim() : undefined,
      });
      await setUser(u);
      router.replace(role === "passenger" ? "/passenger" : "/driver");
    } catch (e: any) {
      setErr(e.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="onboarding-screen">
      <View style={styles.hero}>
        <Image source={IMAGES.authHero} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["rgba(17,24,39,0.1)", "rgba(17,24,39,0.85)"]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={["top"]} style={styles.heroContent}>
          <View style={styles.logoRow}>
            <View style={[styles.logoDot, { backgroundColor: COLORS.brandPrimary }]} />
            <Text style={styles.logoText}>Last-Mile</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => router.replace("/admin")}>
              <Text style={styles.logoText}>Admin Login</Text>
            </Pressable>
          </View>
          <Text style={styles.heroTitle}>Share the ride.{"\n"}Split the fare.</Text>
          <Text style={styles.heroSub}>Metro to college. Metro to tech park. Never solo.</Text>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
            <Text style={styles.formTitle}>Continue as</Text>
            <View style={styles.roleRow}>
              <Pressable
                testID="role-passenger"
                onPress={() => setRole("passenger")}
                style={[
                  styles.roleChip,
                  role === "passenger" && { backgroundColor: COLORS.brandPrimary, borderColor: COLORS.brandPrimary },
                ]}
              >
                <Ionicons
                  name="person"
                  size={18}
                  color={role === "passenger" ? "#fff" : COLORS.onSurfaceSecondary}
                />
                <Text
                  style={[
                    styles.roleTxt,
                    role === "passenger" && { color: "#fff", fontWeight: "700" },
                  ]}
                >
                  Passenger
                </Text>
              </Pressable>
              <Pressable
                testID="role-driver"
                onPress={() => setRole("driver")}
                style={[
                  styles.roleChip,
                  role === "driver" && { backgroundColor: COLORS.brandSecondary, borderColor: COLORS.brandSecondary },
                ]}
              >
                <Ionicons
                  name="car-sport"
                  size={18}
                  color={role === "driver" ? "#fff" : COLORS.onSurfaceSecondary}
                />
                <Text
                  style={[
                    styles.roleTxt,
                    role === "driver" && { color: "#fff", fontWeight: "700" },
                  ]}
                >
                  Driver
                </Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Full name</Text>
            <TextInput
              testID="input-name"
              placeholder="e.g. Priya Kumar"
              placeholderTextColor={COLORS.onSurfaceTertiary}
              style={styles.input}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />

            <Text style={styles.label}>Phone number</Text>
            <TextInput
              testID="input-phone"
              placeholder="10-digit mobile"
              placeholderTextColor={COLORS.onSurfaceTertiary}
              style={styles.input}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              maxLength={10}
            />

            <Text style={styles.label}>Community / Org (Optional)</Text>
            <TextInput
              testID="input-community"
              placeholder="e.g. SRM University or DLF IT Park"
              placeholderTextColor={COLORS.onSurfaceTertiary}
              style={styles.input}
              value={community}
              onChangeText={setCommunity}
            />

            {role === "driver" && (
              <>
                <Text style={styles.label}>Vehicle number</Text>
                <TextInput
                  testID="input-vehicle"
                  placeholder="TN 09 AB 1234"
                  placeholderTextColor={COLORS.onSurfaceTertiary}
                  style={styles.input}
                  value={vehicle}
                  onChangeText={setVehicle}
                  autoCapitalize="characters"
                />
              </>
            )}

            {err && (
              <Text testID="onboarding-error" style={styles.error}>
                {err}
              </Text>
            )}

            <Pressable
              testID="onboarding-continue-btn"
              disabled={loading}
              onPress={submit}
              style={[styles.cta, { backgroundColor: accent }, loading && { opacity: 0.7 }]}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.ctaTxt}>
                    Continue as {role === "passenger" ? "Passenger" : "Driver"}
                  </Text>
                  <Ionicons name="arrow-forward" size={20} color="#fff" />
                </>
              )}
            </Pressable>

            <Text style={styles.foot}>
              By continuing you agree to Last-Mile's terms. Fixed-hub rides only.
            </Text>
          </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  hero: { height: 300, backgroundColor: COLORS.surfaceInverse, overflow: "hidden" },
  heroContent: { flex: 1, padding: SPACING.lg, justifyContent: "space-between" },
  logoRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  logoDot: { width: 10, height: 10, borderRadius: 5 },
  logoText: { color: "#fff", fontSize: FS.lg, fontWeight: "700", letterSpacing: 0.3 },
  heroTitle: { color: "#fff", fontSize: 30, fontWeight: "800", lineHeight: 36, marginBottom: 6 },
  heroSub: { color: "rgba(255,255,255,0.85)", fontSize: FS.base, marginBottom: SPACING.md },
  form: { padding: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xxl },
  formTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface, marginBottom: SPACING.md },
  roleRow: { flexDirection: "row", gap: SPACING.md, marginBottom: SPACING.lg },
  roleChip: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: SPACING.sm, paddingVertical: SPACING.md, borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.borderStrong, backgroundColor: COLORS.surface,
  },
  roleTxt: { fontSize: FS.base, color: COLORS.onSurfaceSecondary, fontWeight: "600" },
  label: { fontSize: FS.sm, color: COLORS.onSurfaceSecondary, marginBottom: 6, marginTop: SPACING.sm, fontWeight: "600" },
  input: {
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 14,
    fontSize: FS.lg, color: COLORS.onSurface,
  },
  error: { color: COLORS.error, marginTop: SPACING.sm, fontSize: FS.sm },
  cta: {
    marginTop: SPACING.xl, height: 54, borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: SPACING.sm,
    ...SHADOW.card,
  },
  ctaTxt: { color: "#fff", fontSize: FS.lg, fontWeight: "700" },
  foot: { textAlign: "center", color: COLORS.onSurfaceTertiary, fontSize: FS.sm, marginTop: SPACING.lg },
});
