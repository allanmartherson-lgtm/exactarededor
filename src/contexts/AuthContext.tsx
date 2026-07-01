import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/status";

const isTransientAuthError = (message?: string | null) => {
  if (!message) return false;
  return /load failed|failed to fetch|network|fetch/i.test(message);
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const resetAuthState = () => ({
  session: null,
  user: null,
  roles: [] as AppRole[],
  accountActive: true,
  isSenior: false,
});

const isValidJwtShape = (token?: string | null) => Boolean(token && token.split(".").length === 3);

const clearLocalAuthSession = async () => {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    try {
      const storageKey = `sb-${new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
      localStorage.removeItem(storageKey);
    } catch {
      // ignore — se nem localStorage estiver disponível, só zera o state React.
    }
  }
};

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  accountActive: boolean;
  isSenior: boolean;
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
  const [accountActive, setAccountActive] = useState<boolean>(true);
  const [isSenior, setIsSenior] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  // Mantemos o último userId cuja role foi carregada para evitar recarregar
  // (e disparar rolesLoading=true) em cada TOKEN_REFRESHED/SIGNED_IN — isso
  // remontava o ProtectedRoute periodicamente e apagava formulários em
  // andamento (ex.: modal de cadastro de regras).
  const lastLoadedUserIdRef = useRef<string | null>(null);
  const activeRolesLoadRef = useRef(0);
  const isRecoveryRouteRef = useRef(false);
  isRecoveryRouteRef.current = ["/definir-senha", "/reset-password", "/auth/reset-password"].includes(
    location.pathname,
  );

  const loadRoles = async (userId: string) => {
    const loadId = ++activeRolesLoadRef.current;
    setRolesLoading(true);
    const [rolesRes, profileRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("active,is_senior").eq("id", userId).maybeSingle(),
    ]);
    if (loadId !== activeRolesLoadRef.current) return;
    setRoles((rolesRes.data ?? []).map((r) => r.role as AppRole));
    const profile = profileRes.data as { active?: boolean; is_senior?: boolean } | null;
    setAccountActive(profile?.active !== false);
    setIsSenior(profile?.is_senior === true);
    setRolesLoading(false);
    lastLoadedUserIdRef.current = userId;
  };

  const applySignedOutState = () => {
    activeRolesLoadRef.current += 1;
    const clean = resetAuthState();
    setSession(clean.session);
    setUser(clean.user);
    setRoles(clean.roles);
    setAccountActive(clean.accountActive);
    setIsSenior(clean.isSenior);
    setRolesLoading(false);
    lastLoadedUserIdRef.current = null;
  };

  const acceptSession = async (nextSession: Session | null, opts: { verify: boolean }) => {
    if (!nextSession?.user) {
      applySignedOutState();
      return;
    }

    // getSession() pode restaurar do localStorage uma sessão estruturalmente
    // corrompida/antiga. Se aceitarmos isso, o app dispara roles/profile com
    // Bearer inválido e prende o login em 401/403. Primeiro validamos a sessão.
    if (!isValidJwtShape(nextSession.access_token)) {
      console.warn("[auth] sessão local inválida removida: access_token malformado");
      await clearLocalAuthSession();
      applySignedOutState();
      return;
    }

    if (opts.verify) {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        console.warn("[auth] sessão local inválida removida", { message: error?.message ?? "usuário ausente" });
        await clearLocalAuthSession();
        applySignedOutState();
        return;
      }
    }

    setSession(nextSession);
    setUser(nextSession.user);
    const newUserId = nextSession.user.id;
    if (lastLoadedUserIdRef.current !== newUserId) {
      setRoles([]);
      setAccountActive(true);
      setIsSenior(false);
      setRolesLoading(true);
      await loadRoles(newUserId);
    }
  };


  useEffect(() => {
    // IMPORTANTE: sempre registramos o onAuthStateChange, mesmo quando a
    // primeira rota é /auth/reset-password. Caso contrário, ao navegar para
    // /auth e fazer signIn, o evento SIGNED_IN nunca chega ao contexto,
    // user permanece null e o login "não acontece" (ProtectedRoute joga de
    // volta para /auth).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Em rotas de recovery, ignoramos qualquer sessão remanescente do
      // recoveryClient para não autenticar o usuário antes de definir a senha.
      if (isRecoveryRouteRef.current) {
        const clean = resetAuthState();
        setSession(clean.session);
        setUser(clean.user);
        setRoles(clean.roles);
        setAccountActive(clean.accountActive);
        setIsSenior(clean.isSenior);
        setRolesLoading(false);
        lastLoadedUserIdRef.current = null;
        return;
      }
      void acceptSession(newSession, { verify: false });
    });

    if (isRecoveryRouteRef.current) {
      console.info("[auth recovery] AuthProvider pulou getSession inicial na rota de recovery", {
        path: location.pathname,
      });
      const clean = resetAuthState();
      setSession(clean.session);
      setUser(clean.user);
      setRoles(clean.roles);
      setAccountActive(clean.accountActive);
      setIsSenior(clean.isSenior);
      setRolesLoading(false);
      setLoading(false);
      lastLoadedUserIdRef.current = null;
      return () => sub.subscription.unsubscribe();
    }

    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      await acceptSession(existing, { verify: true });
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
    // Roda apenas uma vez por sessão. Trocar de rota não deve reinicializar
    // o listener (isso causava remount periódico em conjunto com o reload de
    // papéis).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn: AuthContextValue["signIn"] = async (email, password) => {
    const credentials = { email: email.trim().toLowerCase(), password };
    const firstAttempt = await supabase.auth.signInWithPassword(credentials);
    if (!firstAttempt.error) return { error: null };

    if (isTransientAuthError(firstAttempt.error.message)) {
      await wait(650);
      const secondAttempt = await supabase.auth.signInWithPassword(credentials);
      if (!secondAttempt.error) return { error: null };
      if (isTransientAuthError(secondAttempt.error.message)) {
        return { error: "Falha de conexão com o login. Atualize a tela e tente novamente; se estiver no 4G, teste também no Wi‑Fi." };
      }
      return { error: secondAttempt.error.message };
    }

    return { error: firstAttempt.error.message };
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
    <AuthContext.Provider value={{ user, session, roles, accountActive, isSenior, loading, rolesLoading, hasRole, signIn, signUp, signOut, refreshRoles }}>
      {children}
    </AuthContext.Provider>
  );

};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};