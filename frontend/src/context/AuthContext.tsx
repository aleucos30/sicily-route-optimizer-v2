import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const BACKEND_URL = "https://sicily-route-optimizer-v2.onrender.com";
const TOKEN_KEY = "speedymap_token";

export type Role = "private" | "employee" | "company" | null;

export type Company = {
  company_id: string;
  name: string;
  invite_code: string;
  owner_id: string;
};

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  vehicle_size: "small" | "medium" | "large";
  ztl_pass: boolean;
  role: Role;
  company_id?: string | null;
  company?: Company | null;
  language?: string;
};

type AuthCtx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  setSession: (token: string, user: User) => Promise<void>;
  refresh: () => Promise<User | null>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<User, "vehicle_size" | "ztl_pass">>) => Promise<void>;
  setRole: (role: Exclude<Role, null>) => Promise<User | null>;
  setupCompany: (name: string) => Promise<Company | null>;
  joinCompany: (code: string) => Promise<Company | null>;
};

const Ctx = createContext<AuthCtx | null>(null);

async function storeToken(token: string | null) {
  if (Platform.OS === "web") {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } else {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") return localStorage.getItem(TOKEN_KEY);
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async (t: string): Promise<User | null> => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (r.ok) return (await r.json()) as User;
    } catch {}
    return null;
  }, []);

  const refresh = useCallback(async (): Promise<User | null> => {
    if (!token) return null;
    const u = await fetchMe(token);
    if (u) setUser(u);
    return u;
  }, [token, fetchMe]);

  useEffect(() => {
    (async () => {
      const t = await readToken();
      if (t) {
        const u = await fetchMe(t);
        if (u) {
          setToken(t);
          setUser(u);
        } else {
          await storeToken(null);
        }
      }
      setLoading(false);
    })();
  }, [fetchMe]);

  const setSession = useCallback(async (t: string, u: User) => {
    await storeToken(t);
    setToken(t);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch(`${BACKEND_URL}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
    await storeToken(null);
    setToken(null);
    setUser(null);
  }, [token]);

  const updateProfile = useCallback(
    async (patch: Partial<Pick<User, "vehicle_size" | "ztl_pass">>) => {
      if (!token) return;
      const r = await fetch(`${BACKEND_URL}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        const updated = await r.json();
        setUser((prev) => (prev ? { ...prev, ...updated } : updated));
      }
    },
    [token]
  );

  const setRole = useCallback(
    async (role: Exclude<Role, null>): Promise<User | null> => {
      if (!token) return null;
      const r = await fetch(`${BACKEND_URL}/api/onboarding/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) return null;
      const u = await r.json();
      setUser((prev) => (prev ? { ...prev, ...u } : u));
      return u;
    },
    [token]
  );

  const switchRole = useCallback(
    async (role: Exclude<Role, null>): Promise<User | null> => {
      if (!token) return null;
      const r = await fetch(`${BACKEND_URL}/api/profile/switch-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) return null;
      const u = await r.json();
      setUser(u);
      return u;
    },
    [token]
  );

  const setupCompany = useCallback(
    async (name: string): Promise<Company | null> => {
      if (!token) return null;
      const r = await fetch(`${BACKEND_URL}/api/company/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_name: name }),
      });
      if (!r.ok) return null;
      const company = await r.json();
      // refresh user
      const me = await fetchMe(token);
      if (me) setUser(me);
      return company;
    },
    [token, fetchMe]
  );

  const joinCompany = useCallback(
    async (code: string): Promise<Company | null> => {
      if (!token) return null;
      const r = await fetch(`${BACKEND_URL}/api/company/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invite_code: code }),
      });
      if (!r.ok) return null;
      const company = await r.json();
      const me = await fetchMe(token);
      if (me) setUser(me);
      return company;
    },
    [token, fetchMe]
  );

  return (
    <Ctx.Provider
      value={{ user, token, loading, setSession, refresh, logout, updateProfile, setRole, switchRole, setupCompany, joinCompany }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
