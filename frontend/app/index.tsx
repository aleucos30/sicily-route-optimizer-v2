import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.container} testID="splash-loader">
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (!user.role) return <Redirect href="/onboarding" />;
  if (user.role === "company" && !user.company_id) return <Redirect href="/onboarding" />;
  if (user.role === "employee" && !user.company_id) return <Redirect href="/onboarding" />;
  if (user.role === "company") return <Redirect href="/company" />;
  return <Redirect href="/dashboard" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
