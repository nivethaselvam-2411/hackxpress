import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { getStoredUser } from "@/src/hooks/use-user";
import { COLORS } from "@/src/theme";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const u = await getStoredUser();
      if (!u) router.replace("/onboarding");
      else if (u.role === "passenger") router.replace("/passenger");
      else router.replace("/driver");
    })();
  }, []);

  return (
    <View style={styles.container} testID="splash-screen">
      <ActivityIndicator size="large" color={COLORS.brandPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface },
});
