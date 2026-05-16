import React, { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { t } from "@/src/i18n";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const HERO_IMG =
  "https://images.unsplash.com/photo-1695654390723-479197a8c4a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwyfHxkZWxpdmVyeSUyMHNjb290ZXIlMjBuaWdodHxlbnwwfHx8fDE3Nzg5MzgyMzF8MA&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { setSession, user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const processSessionId = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      try {
        const r = await fetch(`${BACKEND_URL}/api/auth/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        await setSession(data.session_token, data.user);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        router.replace("/dashboard");
      } catch (e: any) {
        Alert.alert("Login failed", String(e?.message || e));
      } finally {
        setBusy(false);
      }
    },
    [setSession, router]
  );

  // Web: process session_id on mount from URL hash/query
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const url = typeof window !== "undefined" ? window.location.href : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const search = typeof window !== "undefined" ? window.location.search : "";
    let sid: string | null = null;
    if (hash) {
      const m = hash.match(/session_id=([^&]+)/);
      if (m) sid = decodeURIComponent(m[1]);
    }
    if (!sid && search) {
      const params = new URLSearchParams(search);
      sid = params.get("session_id");
    }
    if (sid) {
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {}
      processSessionId(sid);
    }
  }, [processSessionId]);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  const handleLogin = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    const redirectUrl =
      Platform.OS === "web"
        ? window.location.origin + "/login"
        : Linking.createURL("auth");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(
      redirectUrl
    )}`;

    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    setBusy(true);
    try {
      const res = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (res.type === "success" && res.url) {
        const url = res.url;
        let sid: string | null = null;
        const hashMatch = url.match(/#session_id=([^&]+)/);
        const qMatch = url.match(/[?&]session_id=([^&]+)/);
        if (hashMatch) sid = decodeURIComponent(hashMatch[1]);
        else if (qMatch) sid = decodeURIComponent(qMatch[1]);
        if (sid) await processSessionId(sid);
        else Alert.alert(t.loginFailed, "Nessuna sessione ricevuta");
      }
    } catch (e: any) {
      Alert.alert(t.loginFailed, String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <Image source={{ uri: HERO_IMG }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["rgba(0,0,0,0.3)", "rgba(0,0,0,0.8)", "#000"]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <View style={styles.logoBadge}>
            <Ionicons name="map" size={28} color={colors.brand} />
          </View>
          <Text style={styles.brand}>{t.brand}</Text>
          <Text style={styles.tagline}>{t.tagline}</Text>
        </View>

        <View style={styles.bottom}>
          <Text style={styles.title}>{t.welcome}</Text>
          <Text style={styles.subtitle}>{t.welcomeSub}</Text>

          <Pressable
            testID="google-login-button"
            style={({ pressed }) => [
              styles.cta,
              pressed && { opacity: 0.85 },
              busy && { opacity: 0.6 },
            ]}
            disabled={busy}
            onPress={handleLogin}
          >
            {busy ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={colors.onBrand} />
                <Text style={styles.ctaText}>{t.continueGoogle}</Text>
              </>
            )}
          </Pressable>

          <Text style={styles.legal}>{t.legal}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  safe: { flex: 1, justifyContent: "space-between", padding: spacing.xl },
  top: { paddingTop: spacing.xl },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  brand: { color: colors.onSurface, fontSize: 32, fontWeight: "800", letterSpacing: -0.5 },
  tagline: { color: colors.onSurfaceTertiary, fontSize: 14, marginTop: 4 },
  bottom: { gap: spacing.md, paddingBottom: spacing.lg },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 22 },
  cta: {
    marginTop: spacing.md,
    backgroundColor: colors.brand,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  ctaText: { color: colors.onBrand, fontSize: 16, fontWeight: "700" },
  legal: { color: colors.onSurfaceTertiary, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
});
