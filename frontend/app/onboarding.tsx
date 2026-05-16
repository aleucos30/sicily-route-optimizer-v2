import React, { useEffect, useState } from "react";
import {
  StyleSheet, View, Text, Pressable, TextInput, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { t } from "@/src/i18n";

type Step = "choose" | "company" | "employee" | "company-done";

export default function Onboarding() {
  const router = useRouter();
  const { user, setRole, setupCompany, joinCompany, refresh } = useAuth();
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // If user already has role + company (or is private), redirect
  useEffect(() => {
    if (!user) return;
    if (user.role === "private") router.replace("/dashboard");
    else if (user.role === "employee" && user.company_id) router.replace("/dashboard");
    else if (user.role === "company" && user.company_id) {
      // show the invite code summary
      if (user.company?.invite_code) {
        setGeneratedCode(user.company.invite_code);
        setStep("company-done");
      } else {
        router.replace("/company");
      }
    }
  }, [user, router]);

  const haptic = (style: "select" | "heavy" = "select") => {
    if (Platform.OS === "web") return;
    if (style === "heavy") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else Haptics.selectionAsync();
  };

  const choosePrivate = async () => {
    haptic();
    setBusy(true);
    const u = await setRole("private");
    setBusy(false);
    if (u) router.replace("/dashboard");
    else Alert.alert("Errore", "Impossibile salvare il ruolo");
  };

  const startEmployee = async () => {
    haptic();
    setBusy(true);
    await setRole("employee");
    setBusy(false);
    setStep("employee");
  };

  const startCompany = async () => {
    haptic();
    setBusy(true);
    await setRole("company");
    setBusy(false);
    setStep("company");
  };

  const doJoin = async () => {
    if (inviteCode.trim().length < 4) {
      Alert.alert("Codice mancante", "Inserisci un codice valido");
      return;
    }
    setBusy(true);
    const c = await joinCompany(inviteCode.trim());
    setBusy(false);
    if (!c) {
      Alert.alert(t.invalidInviteCode);
      return;
    }
    haptic("heavy");
    router.replace("/dashboard");
  };

  const doSetup = async () => {
    if (companyName.trim().length < 2) {
      Alert.alert("Nome mancante", "Inserisci il nome dell'azienda");
      return;
    }
    setBusy(true);
    const c = await setupCompany(companyName.trim());
    setBusy(false);
    if (!c) {
      Alert.alert("Errore", "Impossibile creare l'azienda");
      return;
    }
    haptic("heavy");
    setGeneratedCode(c.invite_code);
    setStep("company-done");
    refresh();
  };

  const copyCode = () => {
    haptic();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const goToCompany = () => {
    router.replace("/company");
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="onboarding-screen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.xl, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={styles.logoBadge}>
            <Ionicons name="map" size={28} color={colors.brand} />
          </View>

          {step === "choose" && (
            <>
              <Text style={styles.title}>{t.onboardingTitle}</Text>
              <Text style={styles.subtitle}>{t.onboardingSub}</Text>

              <RoleCard
                testID="role-private"
                icon="person"
                title={t.rolePrivate}
                desc={t.rolePrivateDesc}
                onPress={choosePrivate}
                disabled={busy}
              />
              <RoleCard
                testID="role-employee"
                icon="bicycle"
                title={t.roleEmployee}
                desc={t.roleEmployeeDesc}
                onPress={startEmployee}
                disabled={busy}
              />
              <RoleCard
                testID="role-company"
                icon="business"
                title={t.roleCompany}
                desc={t.roleCompanyDesc}
                onPress={startCompany}
                disabled={busy}
              />
            </>
          )}

          {step === "employee" && (
            <>
              <Text style={styles.title}>{t.joinCompany}</Text>
              <Text style={styles.subtitle}>Inserisci il codice ricevuto dalla tua azienda</Text>

              <Text style={styles.label}>{t.inviteCodeLabel}</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="key-outline" size={18} color={colors.onSurfaceTertiary} />
                <TextInput
                  testID="invite-code-input"
                  value={inviteCode}
                  onChangeText={(s) => setInviteCode(s.toUpperCase())}
                  placeholder={t.inviteCodePh}
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>

              <Pressable
                testID="join-company-btn"
                onPress={doJoin}
                disabled={busy}
                style={({ pressed }) => [styles.cta, busy && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
              >
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.ctaText}>{t.joinCompany}</Text>}
              </Pressable>

              <Pressable onPress={() => setStep("choose")} style={styles.backLink}>
                <Text style={styles.backLinkText}>← Cambia ruolo</Text>
              </Pressable>
            </>
          )}

          {step === "company" && (
            <>
              <Text style={styles.title}>{t.createCompany}</Text>
              <Text style={styles.subtitle}>Crea la tua azienda e ricevi un codice invito da condividere</Text>

              <Text style={styles.label}>{t.companyNameLabel}</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="business-outline" size={18} color={colors.onSurfaceTertiary} />
                <TextInput
                  testID="company-name-input"
                  value={companyName}
                  onChangeText={setCompanyName}
                  placeholder={t.companyNamePh}
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>

              <Pressable
                testID="setup-company-btn"
                onPress={doSetup}
                disabled={busy}
                style={({ pressed }) => [styles.cta, busy && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
              >
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.ctaText}>{t.createCompany}</Text>}
              </Pressable>

              <Pressable onPress={() => setStep("choose")} style={styles.backLink}>
                <Text style={styles.backLinkText}>← Cambia ruolo</Text>
              </Pressable>
            </>
          )}

          {step === "company-done" && generatedCode && (
            <>
              <View style={styles.successBadge}>
                <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              </View>
              <Text style={styles.title}>{t.companyCreated}</Text>
              <Text style={styles.subtitle}>{t.yourInviteCode}</Text>

              <View style={styles.codeBox} testID="invite-code-display">
                <Text style={styles.codeText}>{generatedCode}</Text>
                <Pressable testID="copy-code-btn" onPress={copyCode} style={styles.copyBtn}>
                  <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={colors.brand} />
                  <Text style={styles.copyText}>{copied ? t.copied : t.copy}</Text>
                </Pressable>
              </View>

              <Text style={styles.hint}>
                Condividi questo codice con i tuoi driver: ognuno potrà inserirlo durante la registrazione per entrare nella tua azienda.
              </Text>

              <Pressable
                testID="goto-company-btn"
                onPress={goToCompany}
                style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.ctaText}>{t.goToDashboard}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoleCard({
  icon, title, desc, onPress, disabled, testID,
}: {
  icon: any; title: string; desc: string; onPress: () => void; disabled?: boolean; testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.roleCard, pressed && { opacity: 0.85, borderColor: colors.brand }]}
    >
      <View style={styles.roleIcon}>
        <Ionicons name={icon} size={26} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.roleTitle}>{title}</Text>
        <Text style={styles.roleDesc}>{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  logoBadge: {
    width: 56, height: 56, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "800", marginBottom: 6 },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 15, lineHeight: 22, marginBottom: spacing.xl },

  roleCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    padding: spacing.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  roleIcon: {
    width: 48, height: 48, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  roleTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  roleDesc: { color: colors.onSurfaceTertiary, fontSize: 13, marginTop: 2 },

  label: {
    color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.6,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  inputWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  input: { flex: 1, color: colors.onSurface, paddingVertical: 14, fontSize: 16 },

  cta: {
    marginTop: spacing.xl, backgroundColor: colors.brand,
    paddingVertical: 16, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
  },
  ctaText: { color: colors.onBrand, fontSize: 16, fontWeight: "700" },

  backLink: { alignSelf: "center", marginTop: spacing.lg, padding: spacing.sm },
  backLinkText: { color: colors.onSurfaceTertiary, fontSize: 14 },

  successBadge: { alignItems: "center", marginVertical: spacing.lg },
  codeBox: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brand,
    padding: spacing.xl, alignItems: "center", marginBottom: spacing.lg,
  },
  codeText: {
    color: colors.brand, fontSize: 36, fontWeight: "800",
    letterSpacing: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: spacing.md, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.pill, backgroundColor: colors.brandTertiary,
  },
  copyText: { color: colors.brand, fontWeight: "600", fontSize: 13 },
  hint: { color: colors.onSurfaceTertiary, fontSize: 13, lineHeight: 20 },
});
