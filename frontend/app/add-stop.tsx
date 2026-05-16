import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { t } from "@/src/i18n";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Suggestion = {
  display_name: string;
  lat: number;
  lon: number;
};

export default function AddStop() {
  const router = useRouter();
  const { token } = useAuth();
  const [address, setAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    async (q: string) => {
      if (q.length < 3) {
        setSuggestions([]);
        return;
      }
      setSearching(true);
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/geocode/search?q=${encodeURIComponent(q)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (r.ok) setSuggestions(await r.json());
      } catch {}
      setSearching(false);
    },
    [token]
  );

  useEffect(() => {
    if (picked && address === picked.display_name) return;
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => search(address), 350);
    return () => {
      if (tRef.current) clearTimeout(tRef.current);
    };
  }, [address, picked, search]);

  const pickSuggestion = (s: Suggestion) => {
    setPicked(s);
    setAddress(s.display_name);
    setSuggestions([]);
  };

  const handleScan = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    setShowCamera(true);
  };

  const captureFromCamera = async () => {
    setOcrBusy(true);
    try {
      let base64: string | null = null;

      if (Platform.OS === "web") {
        // Web: use library picker (camera not reliably supported in webview)
        const r = await ImagePicker.launchImageLibraryAsync({
          base64: true,
          quality: 0.6,
        });
        if (r.canceled) {
          setOcrBusy(false);
          return;
        }
        base64 = r.assets[0].base64 || null;
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t.cameraPermissionTitle);
          setOcrBusy(false);
          return;
        }
        const r = await ImagePicker.launchCameraAsync({
          base64: true,
          quality: 0.6,
          allowsEditing: false,
        });
        if (r.canceled) {
          setOcrBusy(false);
          return;
        }
        base64 = r.assets[0].base64 || null;
      }

      if (!base64) {
        setOcrBusy(false);
        return;
      }

      const resp = await fetch(`${BACKEND_URL}/api/ocr/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image_base64: base64 }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.detail || "OCR failed");

      if (data.address) {
        setAddress(String(data.address));
        setPicked(null);
        search(String(data.address));
      }
      if (data.recipient) setRecipient(String(data.recipient));

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setShowCamera(false);
    } catch (e: any) {
      Alert.alert(t.scanFailed, String(e?.message || e));
    } finally {
      setOcrBusy(false);
    }
  };

  const save = async () => {
    if (!picked) {
      Alert.alert(t.pickSuggestion);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/deliveries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          address: picked.display_name,
          lat: picked.lat,
          lon: picked.lon,
          recipient: recipient || null,
          notes: notes || null,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.back();
    } catch (e: any) {
      Alert.alert(t.saveFailed, String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="add-stop-screen">
      <View style={styles.header}>
        <Pressable testID="close-modal" onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.addStop}</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Scan card */}
          <Pressable
            testID="ocr-scan-button"
            onPress={handleScan}
            style={({ pressed }) => [styles.scanCard, pressed && { opacity: 0.9 }]}
          >
            <View style={styles.scanIcon}>
              <Ionicons name="scan" size={26} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.scanTitle}>{t.scanLabel}</Text>
              <Text style={styles.scanSubtitle}>{t.scanLabelSub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
          </Pressable>

          <Text style={styles.label}>{t.address}</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="location-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="address-input"
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                setPicked(null);
              }}
              placeholder={t.addressPh}
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
              autoCorrect={false}
            />
            {searching && <ActivityIndicator color={colors.brand} size="small" />}
          </View>

          {suggestions.length > 0 && (
            <View style={styles.suggestionBox} testID="suggestions-list">
              {suggestions.map((s, i) => (
                <Pressable
                  key={`${s.lat}-${s.lon}-${i}`}
                  testID={`suggestion-${i}`}
                  onPress={() => pickSuggestion(s)}
                  style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.surfaceTertiary }]}
                >
                  <Ionicons name="pin-outline" size={14} color={colors.brand} />
                  <Text style={styles.suggestionText} numberOfLines={2}>
                    {s.display_name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {picked && (
            <View style={styles.picked} testID="picked-address">
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.pickedText} numberOfLines={2}>
                {t.addressConfirmed}
              </Text>
            </View>
          )}

          <Text style={styles.label}>{t.recipient}</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="person-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="recipient-input"
              value={recipient}
              onChangeText={setRecipient}
              placeholder={t.recipientPh}
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
            />
          </View>

          <Text style={styles.label}>{t.notes}</Text>
          <View style={[styles.inputWrap, { alignItems: "flex-start", minHeight: 80 }]}>
            <Ionicons name="document-text-outline" size={18} color={colors.onSurfaceTertiary} style={{ marginTop: 10 }} />
            <TextInput
              testID="notes-input"
              value={notes}
              onChangeText={setNotes}
              placeholder={t.notesPh}
              placeholderTextColor={colors.onSurfaceTertiary}
              style={[styles.input, { minHeight: 70, textAlignVertical: "top", paddingTop: 10 }]}
              multiline
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            testID="save-stop-button"
            onPress={save}
            disabled={saving || !picked}
            style={({ pressed }) => [
              styles.saveBtn,
              (!picked || saving) && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <>
                <Ionicons name="add-circle" size={18} color={colors.onBrand} />
                <Text style={styles.saveText}>{t.addToRoute}</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* OCR camera simulation modal */}
      <Modal visible={showCamera} animationType="fade" transparent={false} onRequestClose={() => setShowCamera(false)}>
        <View style={styles.camRoot}>
          <Image
            source={{
              uri: "https://images.unsplash.com/photo-1631010231931-d2c396b444ec?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2OTF8MHwxfHNlYXJjaHwyfHxzaGlwcGluZyUyMGxhYmVsJTIwYm94fGVufDB8fHx8MTc3ODkzODIzMXww&ixlib=rb-4.1.0&q=85",
            }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <View style={styles.camOverlay} />
          <SafeAreaView style={styles.camSafe}>
            <View style={styles.camHeader}>
              <Pressable
                testID="close-camera"
                onPress={() => setShowCamera(false)}
                style={[styles.iconBtn, { backgroundColor: "rgba(0,0,0,0.6)" }]}
              >
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
              <Text style={styles.camTitle}>{t.cameraTitle}</Text>
              <View style={{ width: 36 }} />
            </View>

            <View style={styles.camFrame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>

            <View style={styles.camFooter}>
              <Text style={styles.camHint}>
                {ocrBusy ? t.extracting : t.cameraHint}
              </Text>
              <Pressable
                testID="capture-button"
                onPress={captureFromCamera}
                disabled={ocrBusy}
                style={({ pressed }) => [
                  styles.shutter,
                  ocrBusy && { opacity: 0.6 },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}
              >
                {ocrBusy ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <View style={styles.shutterInner} />
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "700" },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },

  scanCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  scanIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  scanTitle: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  scanSubtitle: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },

  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, color: colors.onSurface, paddingVertical: 14, fontSize: 15 },

  suggestionBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  suggestionText: { color: colors.onSurfaceSecondary, fontSize: 13, flex: 1 },

  picked: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  pickedText: { color: colors.success, fontSize: 12, fontWeight: "600" },

  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  saveBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    paddingVertical: 16,
    borderRadius: radius.md,
  },
  saveText: { color: colors.onBrand, fontWeight: "700", fontSize: 15 },

  // Camera mock
  camRoot: { flex: 1, backgroundColor: "#000" },
  camOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  camSafe: { flex: 1, justifyContent: "space-between" },
  camHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  camTitle: { color: "#fff", fontWeight: "700" },
  camFrame: { flex: 1, marginHorizontal: 40, marginVertical: 60, position: "relative" },
  corner: { position: "absolute", width: 36, height: 36, borderColor: colors.brand },
  cornerTL: { top: 0, left: 0, borderLeftWidth: 4, borderTopWidth: 4 },
  cornerTR: { top: 0, right: 0, borderRightWidth: 4, borderTopWidth: 4 },
  cornerBL: { bottom: 0, left: 0, borderLeftWidth: 4, borderBottomWidth: 4 },
  cornerBR: { bottom: 0, right: 0, borderRightWidth: 4, borderBottomWidth: 4 },
  camFooter: {
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  camHint: { color: "#fff", fontSize: 13 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.4)",
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand,
  },
});
