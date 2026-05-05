import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";
import { createPasswordRecoveryClient } from "@/lib/passwordRecoveryClient";

/**
 * Página pública que captura o token enviado por email (convite ou recuperação)
 * e permite ao usuário definir uma nova senha.
 *
 * Suporta os formatos do Supabase:
 *  - Hash legado:  #access_token=...&type=invite|recovery
 *  - PKCE:          ?code=...
 *  - Token hash:    ?token_hash=...&type=invite|recovery
 */

const schema = z.object({
  password: z.string().min(8, "Mínimo 8 caracteres").max(72, "Máximo 72 caracteres"),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { path: ["confirm"], message: "As senhas não coincidem" });

type Phase = "loading" | "ready" | "invalid" | "saving" | "done";
const PASSWORD_AUTH_URL_CACHE_KEY = "medpay-password-auth-url";

type AuthFlow = "invite" | "recovery" | "session";
type EmailOtpFlow = "invite" | "recovery";
type ParsedAuthUrl = ReturnType<typeof parseAuthUrl>;

const TOKEN_KEYS = ["access_token", "refresh_token", "token_hash", "token", "code"];
const ERROR_KEYS = ["error", "error_code", "error_description"];

const parseAuthUrl = (href: string) => {
  const url = new URL(href);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const read = (key: string) => query.get(key) ?? hash.get(key);
  const typeValue = read("type");
  const type: EmailOtpFlow | "" = typeValue === "invite" || typeValue === "recovery" ? typeValue : "";
  const hasAuthSignal = [...TOKEN_KEYS, ...ERROR_KEYS, "type"].some((key) => Boolean(read(key)));

  return {
    href,
    url,
    query,
    hash,
    read,
    type,
    accessToken: read("access_token"),
    refreshToken: read("refresh_token"),
    tokenHash: read("token_hash") ?? read("token"),
    code: read("code"),
    errorDescription: read("error_description"),
    hasAuthSignal,
  };
};

const maskAuthUrl = (href: string) => {
  try {
    const url = new URL(href);
    const maskParams = (params: URLSearchParams) => {
      [...TOKEN_KEYS, ...ERROR_KEYS].forEach((key) => {
        if (params.has(key)) params.set(key, "[presente]");
      });
    };
    maskParams(url.searchParams);
    if (url.hash) {
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      maskParams(hash);
      url.hash = hash.toString();
    }
    return url.toString();
  } catch {
    return "[url inválida]";
  }
};

const maskParamsForLog = (params: URLSearchParams) =>
  Object.fromEntries(
    [...params.entries()].map(([key, value]) => [
      key,
      [...TOKEN_KEYS, ...ERROR_KEYS].includes(key) ? (value ? "[presente]" : "[vazio]") : value,
    ]),
  );

const getCachedAuthUrl = () => {
  const raw = sessionStorage.getItem(PASSWORD_AUTH_URL_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { href?: string; savedAt?: number };
    if (!parsed.href || !parsed.savedAt || Date.now() - parsed.savedAt > 15 * 60 * 1000) {
      sessionStorage.removeItem(PASSWORD_AUTH_URL_CACHE_KEY);
      return null;
    }
    return parsed.href;
  } catch {
    sessionStorage.removeItem(PASSWORD_AUTH_URL_CACHE_KEY);
    return null;
  }
};

const chooseAuthUrl = (): { authUrl: ParsedAuthUrl; usedCachedUrl: boolean } => {
  const current = parseAuthUrl(window.location.href);
  const cachedHref = getCachedAuthUrl();
  const cached = cachedHref ? parseAuthUrl(cachedHref) : null;

  // Se o link atual tem token/hash/code, ele sempre vence para evitar reaproveitar
  // um token antigo salvo em sessionStorage após uma tentativa expirada.
  if (current.hasAuthSignal) return { authUrl: current, usedCachedUrl: false };
  if (cached?.hasAuthSignal) return { authUrl: cached, usedCachedUrl: true };
  return { authUrl: current, usedCachedUrl: false };
};

const SetPassword = () => {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [flow, setFlow] = useState<AuthFlow>("recovery");
  const [recoveryClient] = useState(() => createPasswordRecoveryClient());

  useEffect(() => {
    document.title = "Definir senha | MedPay Approval";
    let cancelled = false;
    let settled = false;
    const { authUrl, usedCachedUrl } = chooseAuthUrl();

    console.groupCollapsed("[auth recovery] validar link");
    console.info("URL recebida", maskAuthUrl(authUrl.href));
    console.info("URL completa recebida", maskAuthUrl(window.location.href));
    console.info("Hash presente?", Boolean(authUrl.url.hash));
    console.info("Query params presentes?", Boolean(authUrl.url.search));
    console.info("Parâmetros detectados", {
      query: maskParamsForLog(authUrl.query),
      hash: maskParamsForLog(authUrl.hash),
      type: authUrl.type || "ausente",
      hasAccessToken: Boolean(authUrl.accessToken),
      hasRefreshToken: Boolean(authUrl.refreshToken),
      hasTokenHash: Boolean(authUrl.tokenHash),
      hasCode: Boolean(authUrl.code),
      usedCachedUrl,
    });
    console.groupEnd();

    const finishAuthUrl = () => {
      sessionStorage.removeItem(PASSWORD_AUTH_URL_CACHE_KEY);
      window.history.replaceState({}, "", window.location.pathname);
    };

    const markReady = (f: AuthFlow) => {
      if (cancelled || settled) return;
      settled = true;
      setFlow(f);
      setPhase("ready");
      finishAuthUrl();
    };

    const markInvalid = (msg: string) => {
      if (cancelled || settled) return;
      settled = true;
      console.warn("[auth recovery]", msg);
      setErrorMsg(msg);
      setPhase("invalid");
    };

    if (authUrl.type) setFlow(authUrl.type);

    // 1. Listener PASSWORD_RECOVERY/SIGNED_IN — caminho principal:
    //    detectSessionInUrl=true faz a auth-js processar #access_token / ?code
    //    automaticamente e disparar o evento correto.
    const { data: sub } = recoveryClient.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      console.info("[auth recovery] evento onAuthStateChange", { event, hasSession: Boolean(session) });
      if (event === "PASSWORD_RECOVERY") {
        markReady("recovery");
      } else if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        markReady(authUrl.type === "invite" ? "invite" : authUrl.type === "recovery" ? "recovery" : "session");
      }
    });

    const run = async () => {
      try {
        if (authUrl.errorDescription) {
          markInvalid(decodeURIComponent(authUrl.errorDescription));
          return;
        }

        // 2. Fallback explícito para token_hash (links manuais do edge function
        //    admin-resend-invite). verifyOtp é o método correto aqui.
        if (authUrl.tokenHash) {
          const otpType: EmailOtpFlow = (authUrl.type as EmailOtpFlow) || "recovery";
          console.info("[auth recovery] verifyOtp(token_hash)", { type: otpType });
          const { data, error } = await recoveryClient.auth.verifyOtp({
            token_hash: authUrl.tokenHash,
            type: otpType,
          });
          if (!error && data.session) {
            markReady(otpType);
            return;
          }
          if (error) console.warn("[auth recovery] verifyOtp falhou", error.message);
        }

        // 3. Fallback explícito para access_token+refresh_token no hash
        //    (caso o detectSessionInUrl tenha falhado por algum motivo).
        if (authUrl.accessToken && authUrl.refreshToken) {
          console.info("[auth recovery] setSession(access_token+refresh_token)");
          const { error } = await recoveryClient.auth.setSession({
            access_token: authUrl.accessToken,
            refresh_token: authUrl.refreshToken,
          });
          if (!error) {
            markReady(authUrl.type === "invite" ? "invite" : "recovery");
            return;
          }
          console.warn("[auth recovery] setSession falhou", error.message);
        }

        // 4. Aguarda 1.5s o listener disparar (caso seja implicit puro).
        //    Se nada chegou, o link está sem tokens — provavelmente Redirect URL
        //    não cadastrada ou usuário abriu a rota direto.
        setTimeout(() => {
          if (settled || cancelled) return;
          if (!authUrl.tokenHash && !authUrl.accessToken && !authUrl.code) {
            markInvalid(
              "Link inválido ou expirado. Abra o link diretamente do email mais recente. " +
              "Se o problema persistir, peça um novo link de recuperação.",
            );
          } else {
            markInvalid("Não foi possível validar o link. Solicite um novo link de recuperação.");
          }
        }, 1500);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Não foi possível validar o link.";
        markInvalid(msg);
      }
    };

    run();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({ password: fd.get("password"), confirm: fd.get("confirm") });
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setPhase("saving");
    const { error } = await recoveryClient.auth.updateUser({ password: parsed.data.password });
    if (error) {
      console.error("[auth recovery] erro retornado ao tentar updateUser", error);
      setPhase("ready");
      toast({ title: "Erro ao salvar senha", description: error.message, variant: "destructive" });
      return;
    }
    await recoveryClient.auth.signOut();
    setPhase("done");
    toast({ title: "Senha definida", description: "Entre novamente com sua nova senha." });
    setTimeout(() => navigate("/auth", { replace: true }), 800);
  };

  if (phase === "done") return <Navigate to="/auth" replace />;

  const title = flow === "invite" ? "Bem-vindo(a)!" : flow === "recovery" ? "Redefinir senha" : "Trocar senha";
  const desc = flow === "invite"
    ? "Defina uma senha para concluir seu primeiro acesso."
    : flow === "recovery"
      ? "Crie uma nova senha para acessar sua conta."
      : "Atualize sua senha de acesso.";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-glow shadow-elegant">
            <ShieldCheck className="h-8 w-8 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">MedPay Approval</h1>
            <p className="text-sm text-muted-foreground">Fluxo seguro de aprovação de pagamentos médicos</p>
          </div>
        </div>
        <Card className="shadow-elegant">
          <CardHeader className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </CardHeader>
          <CardContent>
            {phase === "loading" && (
              <p className="text-sm text-muted-foreground py-6 text-center">Validando link…</p>
            )}

            {phase === "invalid" && (
              <div className="space-y-4">
                <p className="text-sm text-destructive">{errorMsg}</p>
                <Button className="w-full" variant="outline" onClick={() => navigate("/auth", { replace: true })}>
                  Voltar ao login
                </Button>
              </div>
            )}

            {(phase === "ready" || phase === "saving") && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nova senha</Label>
                  <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
                  <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirmar senha</Label>
                  <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
                </div>
                <Button type="submit" className="w-full" disabled={phase === "saving"}>
                  {phase === "saving" ? "Salvando…" : flow === "invite" ? "Criar senha e entrar" : "Salvar nova senha"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SetPassword;