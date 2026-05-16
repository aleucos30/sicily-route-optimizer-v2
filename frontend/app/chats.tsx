import React, { useCallback, useEffect, useState } from "react";
import {
  StyleSheet, View, Text, Pressable, FlatList,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { t } from "@/src/i18n";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Thread = {
  peer: { user_id: string; name: string; email: string; picture?: string | null };
  last_message: { text: string; created_at: string; from_user_id: string } | null;
  unread: number;
};

export default function ChatsList() {
  const router = useRouter();
  const { user, token } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchThreads = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${BACKEND_URL}/api/messages/threads`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setThreads(await r.json());
    } catch (e) {
      console.warn(e);
    }
  }, [token]);

  useEffect(() => {
    if (!user || !user.company_id) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      await fetchThreads();
      setLoading(false);
    })();
    const id = setInterval(fetchThreads, 5000);
    return () => clearInterval(id);
  }, [user, fetchThreads]);

  useFocusEffect(useCallback(() => { fetchThreads(); }, [fetchThreads]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchThreads();
    setRefreshing(false);
  };

  const openThread = (peerId: string, peerName: string) => {
    router.push({ pathname: "/chat/[id]", params: { id: peerId, name: peerName } });
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="chats-screen">
      <View style={styles.header}>
        <Pressable testID="chat-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.chats}</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : !user?.company_id ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={42} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>{t.noChats}</Text>
          <Text style={styles.emptyText}>{t.noChatsEmployee}</Text>
        </View>
      ) : threads.length === 0 ? (
        <View style={styles.empty} testID="empty-chats">
          <Ionicons name="chatbubbles-outline" size={42} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>{t.noChats}</Text>
          <Text style={styles.emptyText}>
            {user.role === "company" ? t.noChatsCompany : t.noChatsEmployee}
          </Text>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(thr) => thr.peer.user_id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`thread-${item.peer.user_id}`}
              onPress={() => openThread(item.peer.user_id, item.peer.name || item.peer.email)}
              style={({ pressed }) => [styles.threadCard, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(item.peer.name || item.peer.email).charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.threadName} numberOfLines={1}>
                  {item.peer.name || item.peer.email}
                </Text>
                <Text style={styles.threadLast} numberOfLines={1}>
                  {item.last_message?.text || t.noMessages}
                </Text>
              </View>
              {item.unread > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unread}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  headerTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "700" },
  iconBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: 8 },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700", marginTop: 8 },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: "center", maxWidth: 280 },

  threadCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.brand, fontWeight: "800", fontSize: 16 },
  threadName: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  threadLast: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 3 },
  badge: {
    minWidth: 22, height: 22, paddingHorizontal: 6,
    borderRadius: 11, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: colors.onBrand, fontWeight: "700", fontSize: 11 },
});
