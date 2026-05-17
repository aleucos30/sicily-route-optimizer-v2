import React, { useEffect, useState } from "react";
import {
  StyleSheet, View, Text, Pressable, TextInput, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform, ScrollView, Switch
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { t } from "@/src/i18n";

type Step = "choose" | "company" | "employee" | "vehicle" | "company-done";
type VehicleType = "car" | "van" | "scooter";

export default function Onboarding() {
  const router = useRouter();
  const { user, setRole, setupCompany, joinCompany, refresh } = useAuth();
  
  // Stati del flusso
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);
  
  // Stati Azienda / Dipendente
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  
  // Nuovi Stati richiesti: Veicolo e ZTL
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>("van");
  const [hasZtlPass, setHasZtlPass] = useState(false);

  // Controllo reindirizzamento se il profilo è già completo
  useEffect(() => {
    if (!user) return;
    if (user.role === "private" && user.vehicle_type) router.replace("/dashboard");
    else if (user.role === "employee" && user.company_id && user.vehicle_type) router.replace("/dashboard");
    else if (user.role === "company" && user.company_id) {
      if (user.company?.invite_code) {
        setGeneratedCode(user.company.invite_code);
        setStep("company-done");
      } else {
        router.replace("/company");
      }
    }
  }, [user]);

  // Gestione selezione ruolo iniziale
  const handleSelectRole = async (role: "private" | "employee" | "company") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (role === "private") {
      setStep("vehicle"); // I privati configurano subito il veicolo
    } else if (role === "employee") {
      setStep("employee"); // I dipendenti inseriscono il codice d'invito
    } else if (role === "company") {
      setStep("company"); // Le aziende creano la flotta
    }
  };

  // Salvataggio finale del veicolo e ZTL (Chiamata al server)
  const handleSaveVehicleConfig = async () => {
    setBusy(true);
    try {
      // Qui mandiamo le preferenze al backend su Render
      // Inoltriamo il ruolo 'private' o aggiorniamo i dettagli del 'driver'
      await setRole({ 
        role: user?.role || "private", 
        vehicle_type: selectedVehicle, 
        has_ztl: hasZtlPass 
      });
      router.replace("/dashboard");
    } catch (err) {
      Alert.alert("Errore", "Impossibile salvare la configurazione del veicolo.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCompany = async () => {
    if (!companyName.trim()) return;
    setBusy(true);
    try {
      const res = await setupCompany(companyName);
      setGeneratedCode(res.invite_code);
      setStep("company-done");
    } catch (err) {
      Alert.alert("Errore", "Impossibile creare l'azienda.");
    } finally {
      setBusy(false);
    }
  };

  const handleJoinCompany = async () => {
    if (!inviteCode.trim()) return;
    setBusy(true);
    try {
      await joinCompany(inviteCode);
      setStep("vehicle"); // Dopo essere entrato nell'azienda, configura il veicolo aziendale
    } catch (err) {
      Alert.alert("Errore", "Codice d'invito non valido.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          
          {/* STEP 1: SCELTA RUOLO */}
          {step === "choose" && (
            <View style={styles.card}>
              <Text style={styles.title}>Benvenuto in SpeedyMap</Text>
              <Text style={styles.subtitle}>Scegli la tua tipologia di profilo per ottimizzare i tuoi percorsi:</Text>
              
              <Pressable style={styles.buttonRole} onPress={() => handleSelectRole("private")}>
                <Ionicons name="person-outline" size={24} color={colors.primary} />
                <View style={styles.roleTextContainer}>
                  <Text style={styles.roleTitle}>Utente Privato</Text>
                  <Text style={styles.roleDesc}>Usa l'app per le tue consegne personali o occasionali</Text>
                </View>
              </Pressable>

              <Pressable style={styles.buttonRole} onPress={() => handleSelectRole("employee")}>
                <Ionicons name="bicycle-outline" size={24} color={colors.primary} />
                <View style={styles.roleTextContainer}>
                  <Text style={styles.roleTitle}>Dipendente / Corriere</Text>
                  <Text style={styles.roleDesc}>Unisciti alla flotta di un'azienda esistente tramite codice</Text>
                </View>
              </Pressable>

              <Pressable style={styles.buttonRole} onPress={() => handleSelectRole("company")}>
                <Ionicons name="business-outline" size={24} color={colors.primary} />
                <View style={styles.roleTextContainer}>
                  <Text style={styles.roleTitle}>Azienda / Manager</Text>
                  <Text style={styles.roleDesc}>Crea una flotta, monitora i corrieri e gestisci i percorsi</Text>
                </View>
              </Pressable>
            </View>
          )}

          {/* STEP 2: CONFIGURAZIONE VEICOLO & ZTL */}
          {step === "vehicle" && (
            <View style={styles.card}>
              <Text style={styles.title}>Configura il tuo Mezzo</Text>
              <Text style={styles.subtitle}>Seleziona il tipo di veicolo per calcolare i tempi e le strade corrette:</Text>
              
              {/* Selettori Veicolo */}
              <View style={styles.vehicleContainer}>
                <Pressable 
                  style={[styles.vehicleBox, selectedVehicle === "van" && styles.vehicleSelected]} 
                  onPress={() => setSelectedVehicle("van")}
                >
                  <Ionicons name="car-sport" size={32} color={selectedVehicle === "van" ? "#fff" : colors.primary} />
                  <Text style={[styles.vehicleLabel, selectedVehicle === "van" && styles.textWhite]}>Furgone</Text>
                </Pressable>

                <Pressable 
                  style={[styles.vehicleBox, selectedVehicle === "car" && styles.vehicleSelected]} 
                  onPress={() => setSelectedVehicle("car")}
                >
                  <Ionicons name="car-outline" size={32} color={selectedVehicle === "car" ? "#fff" : colors.primary} />
                  <Text style={[styles.vehicleLabel, selectedVehicle === "car" && styles.textWhite]}>Macchina</Text>
                </Pressable>

                <Pressable 
                  style={[styles.vehicleBox, selectedVehicle === "scooter" && styles.vehicleSelected]} 
                  onPress={() => setSelectedVehicle("scooter")}
                >
                  <Ionicons name="moped-outline" size={32} color={selectedVehicle === "scooter" ? "#fff" : colors.primary} />
                  <Text style={[styles.vehicleLabel, selectedVehicle === "scooter" && styles.textWhite]}>Scooter</Text>
                </Pressable>
              </View>

              {/* Toggle ZTL */}
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text style={styles.settingTitle}>Possiedi il Pass ZTL?</Text>
                  <Text style={styles.settingDesc}>Se attivo, l'algoritmo includerà le zone a traffico limitato di Palermo nei percorsi rapidi.</Text>
                </View>
                <Switch 
                  value={hasZtlPass} 
                  onValueChange={setHasZtlPass}
                  trackColor={{ false: "#767577", true: colors.primary }}
                />
              </View>

              <Pressable style={styles.buttonMain} onPress={handleSaveVehicleConfig} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonMainText}>Entra nella Mappa</Text>}
              </Pressable>
            </View>
          )}

          {/* STEP: CREA AZIENDA */}
          {step === "company" && (
            <View style={styles.card}>
              <Text style={styles.title}>Registra la tua Azienda</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Nome Azienda / Flotta" 
                value={companyName} 
                onChangeText={setCompanyName} 
              />
              <Pressable style={styles.buttonMain} onPress={handleCreateCompany} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonMainText}>Crea Flotta</Text>}
              </Pressable>
            </View>
          )}

          {/* STEP: CODICE INVITATO DIPENDENTE */}
          {step === "employee" && (
            <View style={styles.card}>
              <Text style={styles.title}>Unisciti alla Flotta</Text>
              <Text style={styles.subtitle}>Inserisci il codice fornito dal tuo datore di lavoro:</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Codice Invito Azienda" 
                value={inviteCode} 
                onChangeText={setInviteCode} 
                autoCapitalize="characters"
              />
              <Pressable style={styles.buttonMain} onPress={handleJoinCompany} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonMainText}>Verifica Codice</Text>}
              </Pressable>
            </View>
          )}

          {/* STEP: CONFERMA CODICE AZIENDA CREATA */}
          {step === "company-done" && (
            <View style={styles.card}>
              <Text style={styles.title}>Azienda Creata!</Text>
              <Text style={styles.subtitle}>Condividi questo codice con i tuoi autisti per farli unire alla flotta:</Text>
              <View style={styles.codeContainer}>
                <Text style={styles.codeText}>{generatedCode}</Text>
              </View>
              <Pressable style={styles.buttonMain} onPress={() => router.replace("/dashboard")}>
                <Text style={styles.buttonMainText}>Vai alla Dashboard di Controllo</Text>
              </Pressable>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  scroll: { padding: spacing.medium, justifyContent: "center", flexGrow: 1 },
  card: { backgroundColor: "#fff", padding: 24, borderRadius: radius.large, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  title: { fontSize: 24, fontWeight: "bold", color: "#2d3748", marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 14, color: "#718096", marginBottom: 24, textAlign: "center", lineHeight: 20 },
  buttonRole: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: radius.medium, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 12, backgroundColor: "#fff" },
  roleTextContainer: { marginLeft: 16, flex: 1 },
  roleTitle: { fontSize: 16, fontWeight: "600", color: "#2d3748" },
  roleDesc: { fontSize: 12, color: "#718096", marginTop: 2 },
  vehicleContainer: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  vehicleBox: { flex: 1, alignment: "center", padding: 16, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: radius.medium, marginHorizontal: 4, alignItems: "center" },
  vehicleSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  vehicleLabel: { fontSize: 12, fontWeight: "600", marginTop: 8, color: "#4a5568" },
  textWhite: { color: "#fff" },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#edf2f7", marginBottom: 24 },
  settingText: { flex: 0.85 },
  settingTitle: { fontSize: 16, fontWeight: "600", color: "#2d3748" },
  settingDesc: { fontSize: 12, color: "#718096", marginTop: 4, lineHeight: 16 },
  input: { borderWidth: 1, borderColor: "#e2e8f0", padding: 14, borderRadius: radius.medium, marginBottom: 16, fontSize: 16 },
  buttonMain: { backgroundColor: colors.primary, padding: 16, borderRadius: radius.medium, alignItems: "center", marginTop: 8 },
  buttonMainText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  codeContainer: { backgroundColor: "#f7fafc", padding: 16, borderRadius: radius.medium, marginVertical: 16, borderStyle: "dashed", borderWidth: 2, borderColor: colors.primary, alignItems: "center" },
  codeText: { fontSize: 24, fontWeight: "bold", color: colors.primary, letterSpacing: 2 }
});
