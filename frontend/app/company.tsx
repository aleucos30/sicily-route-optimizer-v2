import React, { useCallback, useEffect, useState } from "react";
import {
  StyleSheet, View, Text, Pressable, ScrollView,
  ActivityIndicator, RefreshControl, Alert, Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import MapView from "@/src/components/MapView";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, ITALY_CENTER } from "@/src/theme";
import { t } from "@/src/i18n";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Delivery = {
  id: string; address: string; lat: number; lon: number;
  in_ztl: boolean; status: string;
};

type Employee = {
  user_id: string; email: string; name: string; picture?: string | null;
  vehicle_size: string; ztl_pass: boolean;
  last_lat?: number; last_lon?: number; last_seen?: string;
  deliveries: Delivery[];
  summary: {
    total: number; done: number; pending: number;
    ztl_warnings: number; completion_pct: number;
  };
};

export default function CompanyDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, token, logout } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchEmployees = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${BACKEND_URL}/api/company/employees`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setEmployees(await r.json());
    } catch (e) {
      console.warn(e);
    }
  }, [token]);

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "company") {
      router.replace("/dashboard");
      return;
    }
    (async () => {
      setLoading(true);
      await fetchEmployees();
      setLoading(false);
    })();
    const id = setInterval(fetchEmployees, 30000);
    return () => clearInterval(id);
  }, [user, fetchEmployees, router]);

  useFocusEffect(useCallback(() => { fetchEmployees(); }, [fetchEmployees]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchEmployees();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert(t.logout, t.logoutConfirm, [
      { text: t.cancel, style: "cancel" },
      { text: t.logout, style: "destructive", onPress: () => logout() },
    ]);
  };

  const copyCode = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // All markers: employees with their last position
  const markers = employees
    .filter((e) => e.last_lat && e.last_lon)
    .map((e) => ({
      id: e.user_id,
      lat: e.last_lat!,
      lon: e.last_lon!,
      label: `${e.name} · ${e.summary.pending} ${t.pending}`,
      color: "blue" as const,
    }));

  const mapCenter = markers.length
    ? { latitude: markers[0].lat, longitude: markers[0].lon }
    : ITALY_CENTER;
  const mapZoom = markers.length ? 11 : 6;

  return (
    <View style={styles.root} testID="company-dashboard">
      {/* Map area - 50% */}
      <View style={styles.mapWrap}>
        <MapView center={mapCenter} zoom={mapZoom} markers={markers} />

        <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
          <View style={styles.topBarRow}>
            <View style={styles.headerLeft}>
              <View style={styles.brandDot} />
              <View>
                <Text style={styles.brandText}>{t.companyDashboard}</Text>
                {user?.company?.name ? (
                  <Text style={styles.companyName}>{user.company.name}</Text>
                ) : null}
              </View>
            </View>
            <Pressable
              testID="logout-button"
              onPress={handleLogout}
              style={styles.iconBtn}
              hitSlop={10}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.onSurface} />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>

      {/* List area - 50% */}
      <View style={styles.listWrap}>
        {/* Invite code header */}
        {user?.company ? (
          <View style={styles.inviteHeader} testID="invite-header">
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteLabel}>{t.shareInviteCode}</Text>
              <Text style={styles.inviteCode} testID="invite-code-text">{user.company.invite_code}</Text>
            </View>
            <Pressable
              testID="copy-invite-btn"
              onPress={copyCode}
              style={styles.inviteCopyBtn}
            >
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={colors.brand} />
              <Text style={styles.inviteCopyText}>{copied ? t.copied : t.copy}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>{t.employees}</Text>
          <Text style={styles.listCount}>{employees.length}</Text>
        </View>

        {loading ? (
          <View style={{ padding: spacing.xl, alignItems: "center" }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : employees.length === 0 ? (
          <View style={styles.empty} testID="empty-employees">
            <Ionicons name="people-outline" size={42} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>{t.noEmployees}</Text>
            <Text style={styles.emptyText}>{t.noEmployeesSub}</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
            }
          >
            {employees.map((e) => (
              <EmployeeCard key={e.user_id} emp={e} />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function EmployeeCard({ emp }: { emp: Employee }) {
  const lastSeen = emp.last_seen
    ? formatLastSeen(emp.last_seen)
    : t.never;
  const isOnline = emp.last_seen && (Date.now() - new Date(emp.last_seen).getTime()) < 5 * 60 * 1000;

  return (
    <View style={styles.empCard} testID={`employee-card-${emp.user_id}`}>
      <View style={styles.empHeader}>
        <View style={styles.empAvatar}>
          <Text style={styles.empAvatarText}>{(emp.name || emp.email).charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.empName}>{emp.name || emp.email}</Text>
          <View style={styles.empMeta}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? colors.success : colors.onSurfaceTertiary }]} />
            <Text style={styles.empMetaText}>
              {isOnline ? t.online : t.offline} · {lastSeen}
            </Text>
          </View>
        </View>
        {emp.summary.ztl_warnings > 0 ? (
          <View style={styles.warnBadge} testID={`ztl-warn-${emp.user_id}`}>
            <Ionicons name="warning" size={11} color="#fff" />
            <Text style={styles.warnBadgeText}>{emp.summary.ztl_warnings}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.empStats}>
        <Stat label={t.totalDeliveries} value={emp.summary.total} />
        <Stat label={t.completed} value={`${emp.summary.completion_pct}%`} accent />
        <Stat label={t.pending} value={emp.summary.pending} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressBg}>
        <View style={[styles.progressFill, { width: `${emp.summary.completion_pct}%` }]} />
      </View>
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && { color: colors.brand }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s fa`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
  return d.toLocaleDateString("it-IT");
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  mapWrap: { flex: 1, minHeight: 240, backgroundColor: colors.surface },
  listWrap: { flex: 1.2, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, marginTop: -16, overflow: "hidden" },

  topBar: { position: "absolute", top: 0, left: 0, right: 0 },
  topBarRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  brandText: { color: colors.onSurface, fontWeight: "800", fontSize: 16 },
  companyName: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "rgba(17,17,17,0.85)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },

  inviteHeader: {
    flexDirection: "row", alignItems: "center",
    padding: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.lg,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brand,
  },
  inviteLabel: { color: colors.onSurfaceTertiary, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  inviteCode: {
    color: colors.brand, fontSize: 22, fontWeight: "800",
    letterSpacing: 3, marginTop: 4,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  inviteCopyBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.pill, backgroundColor: colors.brandTertiary,
  },
  inviteCopyText: { color: colors.brand, fontWeight: "700", fontSize: 12 },

  listHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, paddingTop: spacing.lg,
  },
  listTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "700" },
  listCount: { color: colors.brand, fontSize: 14, fontWeight: "700" },

  empty: { alignItems: "center", padding: spacing.xl, gap: 8 },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700", marginTop: 8 },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: "center" },

  empCard: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  empHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  empAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  empAvatarText: { color: colors.brand, fontWeight: "800", fontSize: 15 },
  empName: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  empMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  empMetaText: { color: colors.onSurfaceTertiary, fontSize: 11 },
  warnBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.pill, backgroundColor: colors.error,
  },
  warnBadgeText: { color: "#fff", fontWeight: "700", fontSize: 11 },

  empStats: {
    flexDirection: "row", marginTop: spacing.md, gap: spacing.md,
    paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  stat: { flex: 1, alignItems: "flex-start" },
  statValue: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.onSurfaceTertiary, fontSize: 10, marginTop: 2, textTransform: "uppercase" },

  progressBg: {
    marginTop: spacing.md, height: 4, borderRadius: 2,
    backgroundColor: colors.surfaceSecondary, overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.brand, borderRadius: 2 },
});
