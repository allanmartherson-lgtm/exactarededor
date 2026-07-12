import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

const OAUTH_NEXT_KEY = "exacta-oauth-next";
const OAUTH_DIAG_STORAGE_KEY = "exacta-oauth-diag";

const safeNext = (raw: string | null): string => {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
};

const readParam = (key: string) => {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return search.get(key) ?? hash.get(key);
};

const scrubCallbackUrl = () => {
  const clean = new URL(window.location.href);
  clean.search = "";
  clean.hash = "";
  window.history.replaceState(window.history.state, "", clean.pathname);
};

const OAuthCallback = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Finalizando conexão segura…");
  const diagEnabled = useMemo(() => {
    try { return localStorage.getItem(OAUTH_DIAG_STORAGE_KEY) === "1"; } catch { return false; }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const log = (label: string, data?: Record<string, unknown>) => {
      if (!diagEnabled) return;
      // eslint-disable-next-line no-console
      console.log("[oauth-diag] callback." + label, data ?? "");
    };

    const finish = async () => {
      const target = safeNext(sessionStorage.getItem(OAUTH_NEXT_KEY));
      const code = readParam("code");
      const accessToken = readParam("access_token");
      const refreshToken = readParam("refresh_token");
      const errorDescription = readParam("error_description") ?? readParam("error");

      log("boot", {
        href: window.location.href,
        hasCode: !!code,
        hasAccess: !!accessToken,
        hasRefresh: !!refreshToken,
        hasError: !!errorDescription,
        target,
      });

      if (errorDescription) throw new Error(errorDescription);

      if (accessToken && refreshToken) {
        setStatus("Registrando sessão…");
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        log("setSession", { ok: !error, error: error?.message });
        if (error) throw error;
      } else if (code) {
        setStatus("Confirmando autorização…");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        log("exchangeCodeForSession", { ok: !error, error: error?.message });
        if (error) throw error;
      }

      setStatus("Validando acesso…");
      const { data, error } = await supabase.auth.getSession();
      log("getSession", { hasSession: !!data.session, userId: data.session?.user?.id, error: error?.message });
      if (error) throw error;
      if (!data.session?.user) throw new Error("A sessão Google não retornou para o app.");

      try { sessionStorage.removeItem(OAUTH_NEXT_KEY); } catch { /* noop */ }
      scrubCallbackUrl();
      if (!cancelled) navigate(target, { replace: true });
    };

    finish().catch((error) => {
      scrubCallbackUrl();
      const message = error instanceof Error ? error.message : String(error);
      log("failed", { message });
      if (!cancelled) setStatus(`Não foi possível finalizar o login: ${message}`);
    });

    return () => { cancelled = true; };
  }, [diagEnabled, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-soft p-6">
      <Card className="w-full max-w-sm border-border/60 shadow-card">
        <CardHeader>
          <CardTitle>Conectando Google</CardTitle>
          <CardDescription>Estamos concluindo o retorno seguro para o Exacta.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{status}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default OAuthCallback;