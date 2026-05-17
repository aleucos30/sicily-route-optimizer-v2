import React, { useState } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity, Text, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const BACKEND_URL = "https://sicily-route-optimizer-v2.onrender.com";

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert("Attenzione", "Inserisci email e password per procedere.");
      return;
    }

    setLoading(true);
    // IMPORTANTE: aggiunto /api/ prima delle rotte per allinearsi a server.py
    const endpoint = isRegistering ? '/api/register' : '/api/login';
    
    try {
      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        Alert.alert("Ottimo!", isRegistering ? "Registrazione completata! Ora puoi accedere." : "Accesso eseguito!");
        if (isRegistering) {
          setIsRegistering(false);
        } else {
          router.replace('/dashboard');
        }
      } else {
        Alert.alert("Nota", data.detail || "Verifica le tue credenziali.");
      }
    } catch (error) {
      Alert.alert("Server in risveglio", "Il server su Render potrebbe impiegare 30-50 secondi per attivarsi al primo tentativo. Riprova tra un istante.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.card}>
          <Text style={styles.logo}>SpeedyMap</Text>
          <Text style={styles.subtitle}>{isRegistering ? 'Crea il tuo profilo' : 'Accedi alla tua area riservata'}</Text>

          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{isRegistering ? 'REGISTRATI' : 'ACCEDI'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsRegistering(!isRegistering)} style={styles.switchLink}>
            <Text style={styles.switchText}>
              {isRegistering ? "Hai già un account? Accedi qui" : "Non hai un account? Registrati ora"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f7' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 25, padding: 35, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 6 },
  logo: { fontSize: 36, fontWeight: '900', color: '#005088', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#777', textAlign: 'center', marginBottom: 35, letterSpacing: 0.5 },
  inputGroup: { marginBottom: 20 },
  input: { backgroundColor: '#f9f9f9', borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 18, marginBottom: 15, fontSize: 16, color: '#333' },
  button: { backgroundColor: '#005088', borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 10, shadowColor: '#005088', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: 'bold', letterSpacing: 1 },
  switchLink: { marginTop: 25, alignItems: 'center' },
  switchText: { color: '#005088', fontSize: 14, fontWeight: '600' }
});
