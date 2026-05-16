import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet, View, Text, Pressable, TextInput,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { t } from "@/src/i18n";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Message = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  text: string;
  created_at: string;
};

export default function ChatThread() {
  const router = useRouter();
  const { user, token } = useAuth();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const peerId = params.id;
  const peerName = params.name || "";
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<Message>>(null);

  const fetchMessages = useCallback(async () => {
    if (!token || !peerId) return;
    try {
      const r = await fetch(`${BACKEND_URL}/api/messages?with_user=${peerId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setMessages(await r.json());
    } catch (e) {
      console.warn(e);
    }
  }, [token, peerId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchMessages();
      setLoading(false);
    })();
    const id = setInterval(fetchMessages, 4000);
    return () => clearInterval(id);
  }, [fetchMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || !token || sending) return;
    setSending(true);
    setText("");
    try {
      const r = await fetch(`${BACKEND_URL}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to_user_id: peerId, text: body }),
      });
      if (r.ok) {
        const m = await r.json();
        setMessages((prev) => [...prev, m]);
      } else {
        setText(body); // restore on error
      }
    } catch {
      setText(body);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="chat-thread-screen">
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerTitle}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(peerName || "?").charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.headerName} numberOfLines={1}>{peerName}</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="chatbubble-outline" size={36} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyText}>{t.noMessages}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: spacing.md, gap: 6 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              const mine = item.from_user_id === user?.user_id;
              return (
                <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowOther]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                    <Text style={[styles.bubbleText, mine && { color: colors.onBrand }]}>
                      {item.text}
                    </Text>
                    <Text style={[styles.bubbleTime, mine && { color: "rgba(255,255,255,0.7)" }]}>
                      {formatTime(item.created_at)}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        <View style={styles.composer}>
          <TextInput
            testID="message-input"
            value={text}
            onChangeText={setText}
            placeholder={t.typeMessage}
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            multiline
            maxLength={1000}
          />
          <Pressable
            testID="send-button"
            onPress={send}
            disabled={!text.trim() || sending}
            style={({ pressed }) => [
              styles.sendBtn,
              (!text.trim() || sending) && { opacity: 0.4 },
              pressed && { opacity: 0.85 },
            ]}
          >
            {sending ? (
              <ActivityIndicator color={colors.onBrand} size="small" />
            ) : (
              <Ionicons name="send" size={18} color={colors.onBrand} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  headerTitle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: spacing.md },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.brand, fontWeight: "800", fontSize: 13 },
  headerName: { color: colors.onSurface, fontSize: 15, fontWeight: "700", flex: 1 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13 },

  bubbleRow: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16,
  },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: colors.surfaceTertiary,
    borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  bubbleText: { color: colors.onSurface, fontSize: 14, lineHeight: 19 },
  bubbleTime: { color: colors.onSurfaceTertiary, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },

  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    padding: spacing.md, paddingBottom: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1, color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, maxHeight: 120, minHeight: 40,
    borderWidth: 1, borderColor: colors.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
});
