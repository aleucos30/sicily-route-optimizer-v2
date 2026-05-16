import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet, View, Text, Pressable, ScrollView, Switch,
  ActivityIndicator, RefreshControl, Platform, Alert, Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import BottomSheet, { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import MapView from "@/src/components/MapView";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, ITALY_CENTER } from "@/src/theme";
import { t } from "@/src/i18n";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Delivery = {
  id: string;
  address: string;
  lat: number;
  lon: number;
  recipient?: string | null;
  notes?: string | null;
  in_ztl: boolean;
  status: string;
  order_index?: number;
};

type ZtlPoint = { latitude: number; longitude: number };

type RouteResult = {
  order: { id: string; address: string; lat: number; lon: number; in_ztl: boolean }[];
  polyline: number[][];
  distance_km: number;
  duration_min: number;
  start: { lat: number; lon: number };
};

export default function Dashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, token, logout, updateProfile, refresh } = useAuth();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [ztl, setZtl] = useState<ZtlPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [myPos, setMyPos] = useState<{ lat: number; lon: number } | null>(null);

  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["30%", "55%", "90%"], []);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    try {
      const [dRes, zRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/deliveries`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${BACKEND_URL}/api/ztl/polygon`),
      ]);
      if (dRes.ok) setDeliveries(await dRes.json());
      if (zRes.ok) {
        const j = await zRes.json();
        setZtl(j.polygon || []);
      }
    } catch (e) {
      console.warn("fetchAll", e);
    }
  }, [token]);

  const requestLocation = useCallback(async (): Promise<{ lat: number; lon: number } | null> => {
    if (Platform.OS === "web") {
      // Try browser geolocation
      try {
        return await new Promise((resolve) => {
          if (typeof navigator === "undefined" || !navigator.geolocation) {
            resolve(null);
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 8000 }
          );
        });
      } catch {
        return null;
      }
    }
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      if (!canAskAgain) {
        Alert.alert(t.locationPermissionTitle, t.locationPermissionMsg, [
          { text: t.cancel, style: "cancel" },
          { text: t.openSettings, onPress: () => Linking.openSettings() },
        ]);
      }
      return null;
    }
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: loc.coords.latitude, lon: loc.coords.longitude };
    } catch {
      return null;
    }
  }, []);

  const pingLocation = useCallback(async () => {
    if (!token) return;
    const pos = await requestLocation();
    if (!pos) return;
    setMyPos(pos);
    try {
      await fetch(`${BACKEND_URL}/api/location/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: pos.lat, lon: pos.lon }),
      });
    } catch {}
  }, [token, requestLocation]);

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!user.role) {
      router.replace("/onboarding");
      return;
    }
    (async () => {
      setLoading(true);
      await fetchAll();
      setLoading(false);
    })();
    // Initial location ping for employees & private
    pingLocation();
    // Periodic ping every 60s
    const id = setInterval(pingLocation, 60000);
    return () => clearInterval(id);
  }, [user, fetchAll, router, pingLocation]);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchAll(), pingLocation(), refresh()]);
    setRefreshing(false);
  };

  const setVehicle = async (size: "small" | "medium" | "large") => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    await updateProfile({ vehicle_size: size });
  };

  const toggleZtl = async (v: boolean) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    await updateProfile({ ztl_pass: v });
  };

  const onDelete = async (id: string) => {
    if (!token) return;
    await fetch(`${BACKEND_URL}/api/deliveries/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setDeliveries((d) => d.filter((x) => x.id !== id));
  };

  const onToggleDone = async (item: Delivery) => {
    if (!token) return;
    const next = item.status === "done" ? "pending" : "done";
    const r = await fetch(`${BACKEND_URL}/api/deliveries/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: next }),
    });
    if (r.ok) {
      const updated = await r.json();
      setDeliveries((arr) => arr.map((x) => (x.id === item.id ? updated : x)));
    }
  };

  const handleOptimize = async () => {
    if (!token) return;
    const pending = deliveries.filter((d) => d.status !== "done");
    if (pending.length === 0) {
      Alert.alert(t.optimizeRoute, t.noPendingStops);
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOptimizing(true);
    let start = myPos;
    if (!start) start = await requestLocation();
    if (!start) {
      setOptimizing(false);
      Alert.alert(t.locationPermissionTitle, t.locationPermissionMsg);
      return;
    }
    try {
      const r = await fetch(`${BACKEND_URL}/api/route/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ start_lat: start.lat, start_lon: start.lon }),
      });
      if (r.ok) {
        const data: RouteResult = await r.json();
        setRoute(data);
        // refresh deliveries to get new order
        await fetchAll();
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert(t.optimizeRoute, await r.text());
      }
    } catch (e: any) {
      Alert.alert(t.optimizeRoute, String(e?.message || e));
    } finally {
      setOptimizing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t.logout, t.logoutConfirm, [
      { text: t.cancel, style: "cancel" },
      { text: t.logout, style: "destructive", onPress: () => logout() },
    ]);
  };

  const vehicle = user?.vehicle_size || "medium";
  const ztlPass = user?.ztl_pass || false;

  const markers = useMemo(() => {
    const out: any[] = [];
    deliveries.forEach((d, i) => {
      const ordered = (d.order_index ?? i + 1);
      out.push({
        id: d.id,
        lat: d.lat,
        lon: d.lon,
        label: d.address,
        color: d.in_ztl && !ztlPass ? "red" : "orange",
        badge: ordered,
      });
    });
    if (myPos) {
      out.push({ id: "_me_", lat: myPos.lat, lon: myPos.lon, label: "Tu sei qui", color: "green" });
    }
    return out;
  }, [deliveries, ztlPass, myPos]);

  // Center map: if we have my pos -> me; else first delivery; else Italy center
  const mapCenter = useMemo(() => {
    if (myPos) return { latitude: myPos.lat, longitude: myPos.lon };
    if (deliveries[0]) return { latitude: deliveries[0].lat, longitude: deliveries[0].lon };
    return ITALY_CENTER;
  }, [myPos, deliveries]);

  const mapZoom = useMemo(() => {
    if (myPos || deliveries.length) return 12;
    return 6;
  }, [myPos, deliveries.length]);

  return (
    <View style={styles.root}>
      {/* Map area */}
      <View style={styles.mapWrap}>
        <MapView
          center={mapCenter}
          zoom={mapZoom}
          markers={markers}
          polygon={ztl}
          polyline={route?.polyline || []}
        />

        {/* Top sticky chrome */}
        <SafeAreaView edges={["top"]} style={styles.topBarSafe} pointerEvents="box-none">
          <View style={styles.topBar} testID="chip-row">
            <View style={styles.headerLeft}>
              <View style={styles.brandDot} />
              <Text style={styles.brandText}>{t.brand}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {route ? (
                <Pressable
                  testID="clear-route-btn"
                  onPress={() => setRoute(null)}
                  style={[styles.iconBtn, { width: "auto", paddingHorizontal: 12, flexDirection: "row", gap: 6 }]}
                >
                  <Ionicons name="close-circle" size={16} color={colors.error} />
                  <Text style={{ color: colors.onSurface, fontSize: 12, fontWeight: "600" }}>{t.clearRoute}</Text>
                </Pressable>
              ) : null}
              <Pressable
                testID="logout-button"
                onPress={handleLogout}
                style={styles.iconBtn}
                hitSlop={10}
              >
                <Ionicons name="log-out-outline" size={18} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRowContent}
            style={styles.chipRow}
          >
            {(["small", "medium", "large"] as const).map((s) => {
              const active = vehicle === s;
              const label = s === "small" ? t.vehicleSmall : s === "medium" ? t.vehicleMedium : t.vehicleLarge;
              return (
                <Pressable
                  testID={`vehicle-chip-${s}`}
                  key={s}
                  onPress={() => setVehicle(s)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Ionicons
                    name={s === "small" ? "bicycle" : s === "medium" ? "car-sport" : "bus"}
                    size={14}
                    color={active ? colors.onBrand : colors.onSurfaceSecondary}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                </Pressable>
              );
            })}

            <View style={styles.chipDivider} />

            <View style={[styles.chip, ztlPass && styles.chipZtlActive]} testID="ztl-toggle-chip">
              <Ionicons
                name={ztlPass ? "shield-checkmark" : "shield-outline"}
                size={14}
                color={ztlPass ? "#fff" : colors.onSurfaceSecondary}
              />
              <Text style={[styles.chipText, ztlPass && { color: "#fff" }]}>{t.ztlPass}</Text>
              <Switch
                testID="ztl-toggle"
                value={ztlPass}
                onValueChange={toggleZtl}
                trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
                thumbColor="#fff"
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </ScrollView>
        </SafeAreaView>

        {/* Route info banner */}
        {route ? (
          <View style={[styles.routeBanner, { top: insets.top + 110 }]} testID="route-banner">
            <Ionicons name="navigate-circle" size={20} color={colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeTitle}>{t.routeReady}</Text>
              <Text style={styles.routeSub}>
                {route.distance_km} {t.kmTotal} · {route.duration_min} {t.minEstimated}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Bottom sheet */}
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.sheetHandle}
      >
        {/* Persistent FAB cluster - sticks to sheet's top edge, always visible */}
        <View pointerEvents="box-none" style={styles.fabCluster}>
          <Pressable
            testID="optimize-route-fab"
            onPress={handleOptimize}
            disabled={optimizing}
            style={({ pressed }) => [
              styles.fabSecondary,
              optimizing && { opacity: 0.6 },
              pressed && { opacity: 0.85 },
            ]}
          >
            {optimizing ? (
              <ActivityIndicator color={colors.brand} size="small" />
            ) : (
              <Ionicons name="navigate" size={22} color={colors.brand} />
            )}
          </Pressable>

          <Pressable
            testID="add-stop-fab"
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/add-stop");
            }}
            style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={28} color={colors.onBrand} />
          </Pressable>
        </View>
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.sheetTitle}>{t.todayDeliveries}</Text>
            {user?.company?.name ? (
              <Text style={styles.sheetCompany}>{user.company.name}</Text>
            ) : null}
          </View>
          <Text style={styles.sheetCount}>
            {deliveries.filter((d) => d.status !== "done").length} {t.pending}
          </Text>
        </View>
        {loading ? (
          <View style={{ padding: spacing.xl, alignItems: "center" }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : deliveries.length === 0 ? (
          <View style={styles.emptyWrap} testID="empty-deliveries">
            <Ionicons name="map-outline" size={42} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>{t.noDeliveries}</Text>
            <Text style={styles.emptyText}>{t.noDeliveriesSub}</Text>
          </View>
        ) : (
          <BottomSheetFlatList
            data={deliveries}
            keyExtractor={(d) => d.id}
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
            }
            renderItem={({ item, index }) => (
              <DeliveryCard
                item={item}
                index={index}
                ztlPass={ztlPass}
                onToggleDone={() => onToggleDone(item)}
                onDelete={() => onDelete(item.id)}
              />
            )}
          />
        )}
      </BottomSheet>
    </View>
  );
}

function DeliveryCard({
  item, index, ztlPass, onToggleDone, onDelete,
}: {
  item: Delivery; index: number; ztlPass: boolean;
  onToggleDone: () => void; onDelete: () => void;
}) {
  const ztlWarn = item.in_ztl && !ztlPass;
  const done = item.status === "done";
  return (
    <View style={[styles.card, done && { opacity: 0.55 }]} testID={`delivery-card-${item.id}`}>
      <View style={styles.cardIndex}>
        <Text style={styles.cardIndexText}>{item.order_index ?? index + 1}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardAddr, done && { textDecorationLine: "line-through" }]} numberOfLines={2}>
          {item.address}
        </Text>
        {item.recipient ? (
          <Text style={styles.cardRecipient} numberOfLines={1}>{item.recipient}</Text>
        ) : null}
        <View style={styles.cardTags}>
          {ztlWarn ? (
            <View style={[styles.tag, styles.tagDanger]} testID={`ztl-warning-${item.id}`}>
              <Ionicons name="warning" size={11} color="#fff" />
              <Text style={styles.tagDangerText}>{t.ztlNoPass}</Text>
            </View>
          ) : item.in_ztl ? (
            <View style={[styles.tag, styles.tagInfo]}>
              <Ionicons name="shield-checkmark" size={11} color={colors.brand} />
              <Text style={styles.tagInfoText}>{t.ztlPassActive}</Text>
            </View>
          ) : (
            <View style={[styles.tag, styles.tagOk]}>
              <Ionicons name="checkmark-circle" size={11} color={colors.success} />
              <Text style={styles.tagOkText}>{t.outsideZtl}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Pressable testID={`done-btn-${item.id}`} onPress={onToggleDone} style={styles.cardBtn}>
          <Ionicons
            name={done ? "arrow-undo" : "checkmark-done"}
            size={18}
            color={done ? colors.onSurfaceSecondary : colors.success}
          />
        </Pressable>
        <Pressable testID={`delete-btn-${item.id}`} onPress={onDelete} style={styles.cardBtn}>
          <Ionicons name="trash-outline" size={16} color={colors.error} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  mapWrap: { flex: 1, backgroundColor: colors.surface },

  topBarSafe: { position: "absolute", top: 0, left: 0, right: 0 },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  brandText: { color: colors.onSurface, fontWeight: "800", fontSize: 16, letterSpacing: 0.3 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "rgba(17,17,17,0.85)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },

  chipRow: { height: 56 },
  chipRowContent: {
    paddingHorizontal: spacing.lg, alignItems: "center",
    gap: spacing.sm, height: 56,
  },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    height: 36, paddingHorizontal: 12, borderRadius: radius.pill,
    backgroundColor: "rgba(17,17,17,0.9)",
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipZtlActive: { backgroundColor: colors.success, borderColor: colors.success },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.onBrand },
  chipDivider: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 4 },

  routeBanner: {
    position: "absolute", left: spacing.lg, right: spacing.lg,
    backgroundColor: "rgba(17,17,17,0.96)",
    borderRadius: radius.md, padding: spacing.md,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 1, borderColor: colors.brand,
  },
  routeTitle: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  routeSub: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },

  fabCluster: {
    position: "absolute", right: spacing.lg, top: -72, gap: 12, alignItems: "center",
    zIndex: 100,
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
    elevation: 8,
  },
  fabSecondary: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2, borderColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },

  sheetBg: { backgroundColor: colors.surfaceSecondary },
  sheetHandle: { backgroundColor: colors.borderStrong, width: 44 },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  sheetTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "700" },
  sheetCompany: { color: colors.brand, fontSize: 12, marginTop: 2, fontWeight: "600" },
  sheetCount: { color: colors.brand, fontSize: 13, fontWeight: "600" },

  emptyWrap: { alignItems: "center", padding: spacing.xl, gap: 8 },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700", marginTop: 8 },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: "center" },

  card: {
    flexDirection: "row", backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
    alignItems: "center", gap: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  cardIndex: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  cardIndexText: { color: colors.brandSecondary, fontWeight: "700", fontSize: 13 },
  cardAddr: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  cardRecipient: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  cardTags: { flexDirection: "row", marginTop: 6, gap: 6, flexWrap: "wrap" },
  tag: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.pill, gap: 4,
  },
  tagDanger: { backgroundColor: colors.error },
  tagDangerText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  tagInfo: { backgroundColor: colors.brandTertiary },
  tagInfoText: { color: colors.brand, fontSize: 11, fontWeight: "700" },
  tagOk: { backgroundColor: "rgba(16,185,129,0.15)" },
  tagOkText: { color: colors.success, fontSize: 11, fontWeight: "700" },

  cardBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },
});
