import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  // Mantemos o último userId cuja role foi carregada para evitar recarregar
  // (e disparar rolesLoading=true) em cada TOKEN_REFRESHED/SIGNED_IN — isso
  // remontava o ProtectedRoute periodicamente e apagava formulários em
  // andamento (ex.: modal de cadastro de regras).
  const lastLoadedUserIdRef = useRef<string | null>(null);
  const isRecoveryRouteRef = useRef(false);
  isRecoveryRouteRef.current = ["/definir-senha", "/reset-password", "/auth/reset-password"].includes(
    location.pathname,
  );

  const loadRoles = async (userId: string) => {
    setRolesLoading(true);
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    setRoles((data ?? []).map((r) => r.role as AppRole));
    setRolesLoading(false);
    lastLoadedUserIdRef.current = userId;
  };

  useEffect(() => {
    if (isRecoveryRouteRef.current) {
      console.info("[auth recovery] AuthProvider pulou init global na rota de recovery", {
        path: location.pathname,
      });
      setSession(null);
      setUser(null);
      setRoles([]);
      setRolesLoading(false);
      setLoading(false);
      lastLoadedUserIdRef.current = null;
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      const newUserId = newSession?.user?.id ?? null;
      if (newUserId) {
        // Só recarrega papéis se o usuário mudou. Eventos como
        // TOKEN_REFRESHED disparam frequentemente e não devem causar
        // rolesLoading=true (que desmonta a página via ProtectedRoute).
        if (lastLoadedUserIdRef.current !== newUserId) {
          setTimeout(() => loadRoles(newUserId), 0);
        }
      } else {
        setRoles([]);
        setRolesLoading(false);
        lastLoadedUserIdRef.current = null;
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) {
        if (lastLoadedUserIdRef.current !== existing.user.id) {
          await loadRoles(existing.user.id);
        }
      } else {
        setRoles([]);
        setRolesLoading(false);
        lastLoadedUserIdRef.current = null;
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
    // Roda apenas uma vez por sessão. Trocar de rota não deve reinicializar
    // o listener (isso causava remount periódico em conjunto com o reload de
    // papéis).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn: AuthContextValue["signIn"] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
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