import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/status";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  rolesLoading: boolean;
  hasRole: (role: AppRole) => boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_TIMEOUT_MS = 8000;

const withTimeout = async <T,>(promise: PromiseLike<T>, ms: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("auth_timeout")), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const getStorageKey = (): string | null => {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!url) return null;
    const ref = new URL(url).hostname.split(".")[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
};

const readCachedSession = (): Session | null => {
  if (typeof window === "undefined") return null;
  const key = getStorageKey();
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session & { expires_at?: number };
    if (!parsed?.access_token) return null;
    const expiresAt = parsed.expires_at ?? 0;
    // Treat as expired if no expiry or already past (with 10s skew).
    if (!expiresAt || expiresAt * 1000 <= Date.now() + 10_000) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed as Session;
  } catch {
    try {
      const k = getStorageKey();
      if (k) window.localStorage.removeItem(k);
    } catch { /* noop */ }
    return null;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const cached = readCachedSession();
  const [session, setSession] = useState<Session | null>(cached);
  const [user, setUser] = useState<User | null>(cached?.user ?? null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  // If we already have a valid cached session, don't block UI on network.
  const [loading, setLoading] = useState(!cached);
  const [rolesLoading, setRolesLoading] = useState(true);

  const loadRoles = async (userId: string) => {
    setRolesLoading(true);
    try {
      const { data } = await withTimeout(
        supabase.from("user_roles").select("role").eq("user_id", userId),
        8000,
      );
      setRoles((data ?? []).map((r) => r.role as AppRole));
    } catch (error) {
      console.error("[auth] Falha ao carregar papéis do usuário", error);
      setRoles([]);
    } finally {
      setRolesLoading(false);
    }
  };

  useEffect(() => {
    const path = location.pathname;
    const isPasswordRecoveryRoute = ["/definir-senha", "/reset-password", "/auth/reset-password"].includes(path);

    if (isPasswordRecoveryRoute) {
      console.info("[auth recovery] AuthProvider pulou init global na rota de recovery", { path });
      setSession(null);
      setUser(null);
      setRoles([]);
      setRolesLoading(false);
      setLoading(false);
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setTimeout(() => loadRoles(newSession.user.id), 0);
      } else {
        setRoles([]);
        setRolesLoading(false);
      }
    });

    withTimeout(supabase.auth.getSession(), 8000).then(async ({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) {
        await loadRoles(existing.user.id);
      } else {
        setRoles([]);
        setRolesLoading(false);
      }
    }).catch((error) => {
      console.error("[auth] Falha ao inicializar sessão", error);
      setSession(null);
      setUser(null);
      setRoles([]);
      setRolesLoading(false);
    }).finally(() => {
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, [location.pathname]);

  const signIn: AuthContextValue["signIn"] = async (email, password) => {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        AUTH_TIMEOUT_MS,
      );
      if (data.session) {
        setSession(data.session);
        setUser(data.session.user);
        setTimeout(() => loadRoles(data.session.user.id), 0);
      }
      return { error: error?.message ?? null };
    } catch (error) {
      console.error("[auth] Falha ao entrar", error);
      return {
        error: error instanceof Error && error.message === "auth_timeout"
          ? "Tempo esgotado ao entrar. Verifique sua conexão e tente novamente."
          : "Não foi possível entrar. Tente novamente.",
      };
    }
  };

  const signUp: AuthContextValue["signUp"] = async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const hasRole = (role: AppRole) => roles.includes(role);

  const refreshRoles = async () => {
    if (user) await loadRoles(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, roles, loading, rolesLoading, hasRole, signIn, signUp, signOut, refreshRoles }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};