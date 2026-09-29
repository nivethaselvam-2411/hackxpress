import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, Modal, ActivityIndicator, FlatList, Switch, TextInput, Alert
} from "react-native";
import dayjs from "dayjs";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, IMAGES, SHADOW } from "@/src/theme";
import { api, type Hub, type MatchPreview } from "@/src/api";
import { dayOptions, slotsForDay, formatDeparture, MIN_LEAD_MIN } from "@/src/schedule";
import { useUser, clearStoredUser } from "@/src/hooks/use-user";

type VehicleType = "auto" | "cab";

export default function PassengerHome() {
  const router = useRouter();
  const { user, loading: userLoading, setUser } = useUser();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [pickup, setPickup] = useState<Hub | null>(null);
  const [dropoff, setDropoff] = useState<Hub | null>(null);
  const [vehicle, setVehicle] = useState<VehicleType>("auto");
  const [picker, setPicker] = useState<"pickup" | "dropoff" | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  
  // AI preferences
  const [quietRide, setQuietRide] = useState(false);
  const [femaleOnly, setFemaleOnly] = useState(false);
  
  // scheduled rides
  const [mode, setMode] = useState<"now" | "later">("now");
  const [when, setWhen] = useState<dayjs.Dayjs | null>(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [pickDay, setPickDay] = useState(0);
  // smart match preview
  const [preview, setPreview] = useState<MatchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewSeq = useRef(0);

  useEffect(() => {
    if (!userLoading && (!user || user.role !== "passenger")) router.replace("/onboarding");
  }, [user, userLoading]);

  useEffect(() => {
    api.hubs().then(setHubs).catch(() => {});
  }, []);

  const scheduledIso = mode === "later" && when ? when.toISOString() : null;
  const routeReady = !!pickup && !!dropoff && pickup.id !== dropoff.id;
  const canFind = routeReady && !!user && (mode === "now" || !!when);

  // Smart-match preview: which pools could this request join, and what would it cost?
  useEffect(() => {
    if (!routeReady || (mode === "later" && !when)) {
      setPreview(null);
      return;
    }
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.previewMatch({
          passenger_id: user?.id,
          pickup_hub_id: pickup!.id,
          dropoff_hub_id: dropoff!.id,
          vehicle_type: vehicle,
          scheduled_for: scheduledIso,
          preferences: { quiet_ride: quietRide, female_only: femaleOnly },
        });
        if (seq === previewSeq.current) setPreview(res);
      } catch {
        if (seq === previewSeq.current) setPreview(null);
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [pickup?.id, dropoff?.id, vehicle, scheduledIso, mode, user?.id, quietRide, femaleOnly]);

  const findRide = async () => {
    if (!canFind || !user) return;
    setErr(null);
    setRequesting(true);
    try {
      const rr = await api.requestRide({
        passenger_id: user.id,
        pickup_hub_id: pickup!.id,
        dropoff_hub_id: dropoff!.id,
        vehicle_type: vehicle,
        scheduled_for: scheduledIso,
        preferences: { quiet_ride: quietRide, female_only: femaleOnly },
      });
      router.push({ pathname: "/passenger/matching", params: { requestId: rr.id } });
    } catch (e: any) {
      setErr(e.message || "Failed");
    } finally {
      setRequesting(false);
    }
  };

  const logout = async () => {
    await clearStoredUser();
    router.replace("/onboarding");
  };

  const askAssistant = async () => {
    if (!aiQuery.trim() || !user) return;
    setAiLoading(true);
    try {
      const res = await api.mobilityAssistant(aiQuery, user.id);
      Alert.alert("AI Assistant", res.reply);
      if (res.action === "prefill_booking") {
        if (res.data.pickup_hub_id) {
          const hub = hubs.find(h => h.id === res.data.pickup_hub_id);
          if (hub) setPickup(hub);
        }
        if (res.data.dropoff_hub_id) {
          const hub = hubs.find(h => h.id === res.data.dropoff_hub_id);
          if (hub) setDropoff(hub);
        }
        if (res.data.vehicle_type) {
          setVehicle(res.data.vehicle_type);
        }
      }
      setAiQuery("");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="passenger-home">
      <View style={styles.hero}>
        <Image source={IMAGES.passengerBg} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["rgba(16,185,129,0.35)", "rgba(17,24,39,0.65)"]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={["top"]} style={styles.heroInner}>
          <View style={styles.topRow}>
            <View>
              <Text style={styles.hello}>Hi {user?.name?.split(" ")[0] || "there"} 👋</Text>
              <Text style={styles.subline}>Where are you headed?</Text>
            </View>
            <View style={{ flexDirection: "row", gap: SPACING.sm }}>
              <Pressable
                testID="passenger-history-btn"
                onPress={() => router.push("/passenger/history")}
                style={styles.iconBtn}
              >
                <Ionicons name="time-outline" size={20} color="#fff" />
              </Pressable>
              <Pressable testID="passenger-logout-btn" onPress={logout} style={styles.iconBtn}>
                <Ionicons name="log-out-outline" size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <ScrollView contentContainerStyle={styles.sheetInner} showsVerticalScrollIndicator={false}>
          
          <View style={{ marginBottom: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.brandSecondary + "20", borderRadius: RADIUS.md }}>
            <Text style={{ fontSize: FS.sm, fontWeight: "700", color: COLORS.brandSecondary, marginBottom: SPACING.sm }}>Ask AI Mobility Assistant</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TextInput
                style={{ flex: 1, backgroundColor: COLORS.surface, padding: SPACING.sm, borderRadius: RADIUS.sm, marginRight: SPACING.sm }}
                placeholder="e.g. Ride from DLF IT to Guindy"
                value={aiQuery}
                onChangeText={setAiQuery}
              />
              <Pressable onPress={askAssistant} disabled={aiLoading} style={{ backgroundColor: COLORS.brandSecondary, padding: SPACING.sm, borderRadius: RADIUS.sm }}>
                {aiLoading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
              </Pressable>
            </View>
          </View>

          <Pressable
            testID="planner-btn"
            onPress={() => router.push("/passenger/planner")}
            style={{ flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surfaceHighlight, padding: SPACING.sm, borderRadius: 8, marginBottom: SPACING.md }}
          >
            <Ionicons name="map" size={18} color={COLORS.brandPrimary} />
            <Text style={{ flex: 1, marginLeft: SPACING.sm, fontWeight: "600", color: COLORS.onSurface }}>AI Multimodal Route Planner</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.onSurfaceTertiary} />
          </Pressable>

          <Text style={styles.sectionTitle}>Choose your route</Text>

          <Pressable
            testID="pickup-selector"
            onPress={() => setPicker("pickup")}
            style={styles.hubRow}
          >
            <View style={[styles.hubDot, { backgroundColor: COLORS.brandPrimary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.hubLabel}>Pickup hub</Text>
              <Text style={styles.hubValue} numberOfLines={1}>
                {pickup ? pickup.name : "Select pickup"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            testID="dropoff-selector"
            onPress={() => setPicker("dropoff")}
            style={styles.hubRow}
          >
            <View style={[styles.hubDot, { backgroundColor: COLORS.brandSecondary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.hubLabel}>Drop-off hub</Text>
              <Text style={styles.hubValue} numberOfLines={1}>
                {dropoff ? dropoff.name : "Select drop-off"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
          </Pressable>

          <Text style={[styles.sectionTitle, { marginTop: SPACING.xl }]}>When</Text>
          <View style={styles.seg} testID="when-toggle">
            <Pressable
              testID="when-now"
              onPress={() => setMode("now")}
              style={[styles.segBtn, mode === "now" && styles.segBtnOn]}
            >
              <Ionicons name="flash" size={16} color={mode === "now" ? "#fff" : COLORS.onSurfaceSecondary} />
              <Text style={[styles.segTxt, mode === "now" && styles.segTxtOn]}>Ride now</Text>
            </Pressable>
            <Pressable
              testID="when-later"
              onPress={() => {
                setMode("later");
                if (!when) setSchedOpen(true);
              }}
              style={[styles.segBtn, mode === "later" && styles.segBtnOn]}
            >
              <Ionicons name="calendar" size={16} color={mode === "later" ? "#fff" : COLORS.onSurfaceSecondary} />
              <Text style={[styles.segTxt, mode === "later" && styles.segTxtOn]}>Schedule</Text>
            </Pressable>
          </View>
          {mode === "later" && (
            <Pressable testID="schedule-time-btn" onPress={() => setSchedOpen(true)} style={styles.whenRow}>
              <Ionicons name="time-outline" size={20} color={COLORS.brandPrimary} />
              <Text style={styles.whenTxt}>
                {when ? formatDeparture(when.toISOString()) : "Pick a departure time"}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
            </Pressable>
          )}

          <Text style={[styles.sectionTitle, { marginTop: SPACING.xl }]}>Vehicle preference</Text>
          <View style={styles.vehicleRow}>
            <VehicleChip
              active={vehicle === "auto"}
              onPress={() => setVehicle("auto")}
              icon="bicycle"
              title="Share Auto"
              sub="Up to 3 riders · ₹60 + ₹15/km"
              testID="vehicle-auto"
            />
            <VehicleChip
              active={vehicle === "cab"}
              onPress={() => setVehicle("cab")}
              icon="car"
              title="Share Cab"
              sub="Up to 4 riders · ₹100 + ₹22/km"
              testID="vehicle-cab"
            />
          </View>

          <Text style={[styles.sectionTitle, { marginTop: SPACING.md }]}>AI Smart Preferences</Text>
          <View style={{ gap: SPACING.sm, marginBottom: SPACING.md }}>
            <View style={styles.prefRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Quiet Ride</Text>
                <Text style={styles.prefSub}>Prefer a ride with minimal conversation</Text>
              </View>
              <Switch value={quietRide} onValueChange={setQuietRide} trackColor={{ true: COLORS.brandPrimary }} />
            </View>
            <View style={styles.prefRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Female Only</Text>
                <Text style={styles.prefSub}>Match with female riders only</Text>
              </View>
              <Switch value={femaleOnly} onValueChange={setFemaleOnly} trackColor={{ true: COLORS.brandPrimary }} />
            </View>
          </View>

          {routeReady && (mode === "now" || !!when) && (
            <SmartMatchCard preview={preview} loading={previewing} scheduled={mode === "later"} />
          )}

          {err && (
            <Text testID="passenger-home-error" style={styles.error}>
              {err}
            </Text>
          )}

          <Pressable
            testID="find-ride-btn"
            disabled={!canFind || requesting}
            onPress={findRide}
            style={[
              styles.cta,
              { backgroundColor: canFind ? COLORS.brandPrimary : COLORS.borderStrong },
            ]}
          >
            {requesting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="git-merge" size={20} color="#fff" />
                <Text style={styles.ctaTxt}>{mode === "later" ? "Schedule Shared Ride" : "Find Shared Ride"}</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.tinyFoot}>
            {mode === "later"
              ? `Riders leaving within 15 minutes of your time on the same route get pooled with you. Book at least ${MIN_LEAD_MIN} min ahead.`
              : "We'll pool you with other riders going the same way. Fare splits automatically."}
          </Text>
        </ScrollView>
      </View>

      <Modal
        visible={picker !== null}
        animationType="slide"
        onRequestClose={() => setPicker(null)}
        transparent
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPicker(null)} />
        <View style={styles.pickerSheet} testID="hub-picker">
          <View style={styles.sheetHandle} />
          <Text style={styles.pickerTitle}>
            {picker === "pickup" ? "Select pickup hub" : "Select drop-off hub"}
          </Text>
          <FlatList
            data={hubs}
            keyExtractor={(h) => h.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => {
              const disabled =
                (picker === "pickup" && dropoff?.id === item.id) ||
                (picker === "dropoff" && pickup?.id === item.id);
              return (
                <Pressable
                  testID={`hub-${item.id}`}
                  disabled={disabled}
                  onPress={() => {
                    if (picker === "pickup") setPickup(item);
                    else setDropoff(item);
                    setPicker(null);
                  }}
                  style={[styles.pickerRow, disabled && { opacity: 0.35 }]}
                >
                  <View style={styles.pickerIcon}>
                    <Ionicons name="location" size={18} color={COLORS.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerName}>{item.name}</Text>
                    <Text style={styles.pickerArea}>{item.area}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>

      <Modal visible={schedOpen} animationType="slide" onRequestClose={() => setSchedOpen(false)} transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setSchedOpen(false)} />
        <View style={styles.pickerSheet} testID="schedule-picker">
          <View style={styles.sheetHandle} />
          <Text style={styles.pickerTitle}>Pick departure time</Text>
          <View style={styles.dayRow}>
            {dayOptions().map((d, i) => (
              <Pressable
                key={i}
                testID={`day-${i}`}
                onPress={() => setPickDay(i)}
                style={[styles.dayChip, pickDay === i && styles.dayChipOn]}
              >
                <Text style={[styles.dayTxt, pickDay === i && styles.dayTxtOn]}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
          <FlatList
            data={slotsForDay(dayOptions()[pickDay].date)}
            keyExtractor={(t) => t.toISOString()}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={<Text style={styles.emptySlots}>No slots left on this day — try another.</Text>}
            renderItem={({ item }) => {
              const on = !!when && when.isSame(item);
              return (
                <Pressable
                  testID={`slot-${item.format("HHmm")}`}
                  onPress={() => {
                    setWhen(item);
                    setMode("later");
                    setSchedOpen(false);
                  }}
                  style={[styles.pickerRow, on && { backgroundColor: COLORS.brandTertiary }]}
                >
                  <Text style={styles.pickerName}>{item.format("h:mm A")}</Text>
                  {on && <Ionicons name="checkmark-circle" size={20} color={COLORS.brandPrimary} />}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

function SmartMatchCard({ preview, loading, scheduled }: { preview: MatchPreview | null; loading: boolean; scheduled: boolean }) {
  if (loading && !preview) {
    return (
      <View style={styles.smart} testID="smart-match-loading">
        <ActivityIndicator size="small" color={COLORS.brandPrimary} />
        <Text style={styles.smartSub}>Checking for riders on your route…</Text>
      </View>
    );
  }
  if (!preview) return null;
  const b = preview.best;
  if (!b) {
    return (
      <View style={styles.smart} testID="smart-match-none">
        <View style={styles.smartIcon}><Ionicons name="sparkles" size={18} color={COLORS.onBrandTertiary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.smartTitle}>You'll start the pool</Text>
          <Text style={styles.smartSub}>
            {scheduled
              ? "No one is booked near that time yet. Riders on your route will join you."
              : "No riders on your route right now. Fare drops as riders join."}
            {" "}Solo fare ₹{preview.solo_fare}.
          </Text>
        </View>
      </View>
    );
  }
  const save = Math.max(0, preview.solo_fare - b.est_fare_share);
  return (
    <View style={styles.smart} testID="smart-match-found">
      <View style={styles.smartIcon}><Ionicons name="sparkles" size={18} color={COLORS.onBrandTertiary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.smartTitle}>
          Smart match · {Math.round(b.score)}%
        </Text>
        <Text style={styles.smartSub}>
          {b.riders} rider{b.riders === 1 ? "" : "s"} already pooled
          {b.departs ? ` for ${formatDeparture(b.departs)}` : ""}
          {!b.exact_route ? ` · ${b.overlap_pct}% of your trip is on their route` : ""}
        </Text>
        <Text style={styles.smartFare}>
          Est. ₹{b.est_fare_share} <Text style={styles.smartStrike}>₹{preview.solo_fare}</Text>
          {save > 0 ? `  ·  save ₹${save}` : ""}
        </Text>
      </View>
    </View>
  );
}

function VehicleChip({ active, onPress, icon, title, sub, testID }: any) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[
        styles.vChip,
        active && { borderColor: COLORS.brandPrimary, backgroundColor: COLORS.brandTertiary },
      ]}
    >
      <View
        style={[
          styles.vIconWrap,
          { backgroundColor: active ? COLORS.brandPrimary : COLORS.surfaceSecondary },
        ]}
      >
        <Ionicons name={icon} size={20} color={active ? "#fff" : COLORS.onSurfaceSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.vTitle, active && { color: COLORS.onBrandTertiary }]}>{title}</Text>
        <Text style={styles.vSub}>{sub}</Text>
      </View>
      {active && <Ionicons name="checkmark-circle" size={22} color={COLORS.brandPrimary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  hero: { height: 260, backgroundColor: COLORS.brandSecondary, overflow: "hidden" },
  heroInner: { flex: 1, padding: SPACING.lg },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  hello: { color: "#fff", fontSize: FS.xxl, fontWeight: "800" },
  subline: { color: "rgba(255,255,255,0.85)", fontSize: FS.base, marginTop: 4 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
  },
  sheet: {
    flex: 1, backgroundColor: COLORS.surface, marginTop: -24,
    borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: SPACING.md,
  },
  sheetHandle: {
    width: 44, height: 5, borderRadius: 3, backgroundColor: COLORS.surfaceTertiary,
    alignSelf: "center", marginBottom: SPACING.md,
  },
  sheetInner: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  sectionTitle: { fontSize: FS.base, fontWeight: "700", color: COLORS.onSurfaceSecondary, marginBottom: SPACING.md },
  hubRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    paddingVertical: SPACING.md,
  },
  hubDot: { width: 12, height: 12, borderRadius: 6 },
  hubLabel: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginBottom: 2 },
  hubValue: { fontSize: FS.lg, color: COLORS.onSurface, fontWeight: "600" },
  divider: { height: 1, backgroundColor: COLORS.divider, marginLeft: 28 },
  vehicleRow: { gap: SPACING.md, marginBottom: SPACING.md },
  vChip: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md,
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  vIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  vTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface },
  vSub: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  prefRow: {
    flexDirection: "row", alignItems: "center", padding: SPACING.md,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  prefTitle: { fontSize: FS.base, fontWeight: "700", color: COLORS.onSurface },
  prefSub: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  cta: {
    marginTop: SPACING.lg, height: 54, borderRadius: RADIUS.pill,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    ...SHADOW.card,
  },
  ctaTxt: { color: "#fff", fontSize: FS.lg, fontWeight: "700" },
  error: { color: COLORS.error, fontSize: FS.sm, marginTop: SPACING.sm, textAlign: "center" },
  tinyFoot: { textAlign: "center", color: COLORS.onSurfaceTertiary, fontSize: FS.sm, marginTop: SPACING.md },
  seg: {
    flexDirection: "row", backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.pill, padding: 4,
  },
  segBtn: {
    flex: 1, height: 40, borderRadius: RADIUS.pill, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  segBtnOn: { backgroundColor: COLORS.brandSecondary },
  segTxt: { fontSize: FS.base, fontWeight: "700", color: COLORS.onSurfaceSecondary },
  segTxtOn: { color: "#fff" },
  whenRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: SPACING.md,
    padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.brandPrimary,
    backgroundColor: COLORS.brandTertiary,
  },
  whenTxt: { flex: 1, fontSize: FS.lg, fontWeight: "700", color: COLORS.onBrandTertiary },
  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, marginBottom: SPACING.md },
  dayChip: {
    paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceSecondary,
  },
  dayChipOn: { backgroundColor: COLORS.brandPrimary },
  dayTxt: { fontSize: FS.base, fontWeight: "700", color: COLORS.onSurfaceSecondary },
  dayTxtOn: { color: "#fff" },
  emptySlots: { textAlign: "center", color: COLORS.onSurfaceTertiary, marginTop: SPACING.xl },
  smart: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.md, marginTop: SPACING.md,
    padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSecondary,
  },
  smartIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  smartTitle: { fontSize: FS.base, fontWeight: "800", color: COLORS.onSurface },
  smartSub: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  smartFare: { fontSize: FS.lg, fontWeight: "800", color: COLORS.brandPrimary, marginTop: 6 },
  smartStrike: { color: COLORS.onSurfaceTertiary, textDecorationLine: "line-through", fontWeight: "600" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  pickerSheet: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: SPACING.lg, maxHeight: "70%", paddingTop: SPACING.md,
  },
  pickerTitle: { fontSize: FS.xl, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.md },
  pickerRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  pickerIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  pickerName: { fontSize: FS.lg, fontWeight: "600", color: COLORS.onSurface },
  pickerArea: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
});
