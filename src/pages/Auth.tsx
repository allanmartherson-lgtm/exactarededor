import { ExactaLogo } from "@/components/brand/ExactaLogo";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";
import { createPasswordRecoveryClient } from "@/lib/passwordRecoveryClient";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone, userExtraSchema } from "@/lib/userFields";
import LoginAnimation from "@/components/auth/LoginAnimation";
import { DateInput } from "@/components/ui/date-input";
import { CuraSubmitButton } from "@/components/brand/CuraSubmitButton";



const PASSWORD_AUTH_URL_CACHE_KEY = "exacta-password-auth-url";
const PASSWORD_RECOVERY_EMAIL_KEY = "exacta-password-recovery-email";
const PROJECT_PREVIEW_ORIGIN = "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";
const GOOGLE_SIGN_IN_TIMEOUT_MS = 120_000;
const GOOGLE_SESSION_POLL_MS = 700;
const OAUTH_MESSAGE_ORIGINS = new Set([
  "https://oauth.lovable.app",
  "https://lovable.dev",
  PROJECT_PREVIEW_ORIGIN,
  "https://exactarededor.lovable.app",
]);
const OAUTH_DIAG_STORAGE_KEY = "exacta-oauth-diag";

type DiagEntry = { t: number; label: string; data?: unknown };
type OAuthBridgeResult = "session" | "timeout";
type OAuthTokenPair = { access_token: string; refresh_token: string };
// Sink usado tanto dentro do componente quanto por helpers de módulo.
let diagPush: (label: string, data?: unknown) => void = () => {};
const isOAuthDiagEnabled = () => {
  try {
    if (new URLSearchParams(window.location.search).get("diag") === "1") {
      try { localStorage.setItem(OAUTH_DIAG_STORAGE_KEY, "1"); } catch { /* noop */ }
      return true;
    }
    return localStorage.getItem(OAUTH_DIAG_STORAGE_KEY) === "1";
  } catch { return false; }
};
const safeSerialize = (value: unknown) => {
  try {
    return JSON.parse(JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) return { name: v.name, message: v.message };
      if (typeof v === "string" && v.length > 400) return v.slice(0, 400) + "…";
      return v;
    }));
  } catch { return String(value); }
};

const getPasswordRecoveryOrigin = () => {
  if (window.location.hostname.endsWith(".lovableproject.com")) return PROJECT_PREVIEW_ORIGIN;
  return window.location.origin;
};

const signInSchema = z.object({
  email: z.string().trim().email("Email inválido").max(255),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72),
});
const accessRequestSchema = userExtraSchema.extend({
  message: z.string().trim().max(500).optional(),
});

// Only allow same-origin relative paths as post-login redirect targets.
const safeNext = (raw: string | null): string => {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
};

const waitForSessionAfterGoogle = async (deadline: number) => {
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    const { data, error } = await supabase.auth.getSession();
    diagPush("poll.getSession", { attempts, hasSession: !!data.session, userId: data.session?.user?.id, error: error?.message });
    if (data.session?.user) return data.session;
    await new Promise((resolve) => window.setTimeout(resolve, GOOGLE_SESSION_POLL_MS));
  }
  return null;
};

const waitForOAuthCompletion = async (deadline: number, bridgePromise: Promise<OAuthBridgeResult>) => {
  let ticks = 0;
  while (Date.now() < deadline) {
    ticks++;
    const { data, error } = await supabase.auth.getSession();
    diagPush("oauth.wait.getSession", { ticks, hasSession: !!data.session, userId: data.session?.user?.id, error: error?.message });
    if (data.session?.user) return data.session;

    const bridgeResult = await Promise.race<OAuthBridgeResult | "tick">([
      bridgePromise,
      new Promise<"tick">((resolve) => window.setTimeout(() => resolve("tick"), GOOGLE_SESSION_POLL_MS)),
    ]);
    diagPush("oauth.wait.tick", { ticks, bridgeResult });
    if (bridgeResult === "session") {
      const { data: afterBridge, error: afterBridgeError } = await supabase.auth.getSession();
      diagPush("oauth.wait.afterBridge", { hasSession: !!afterBridge.session, userId: afterBridge.session?.user?.id, error: afterBridgeError?.message });
      if (afterBridge.session?.user) return afterBridge.session;
    }
    if (bridgeResult === "timeout") return null;
  }
  return null;
};

const isTrustedOAuthMessageOrigin = (origin: string) => origin === window.location.origin || OAUTH_MESSAGE_ORIGINS.has(origin);

const isEmbeddedPreviewFrame = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const extractOAuthTokensFromMessage = (data: unknown): OAuthTokenPair | null => {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const response = root.response && typeof root.response === "object" ? root.response as Record<string, unknown> : null;
  const responseTokens = response?.tokens && typeof response.tokens === "object" ? response.tokens as Record<string, unknown> : null;
  const rootTokens = root.tokens && typeof root.tokens === "object" ? root.tokens as Record<string, unknown> : null;

  const accessToken = response?.access_token ?? responseTokens?.access_token ?? root.access_token ?? rootTokens?.access_token;
  const refreshToken = response?.refresh_token ?? responseTokens?.refresh_token ?? root.refresh_token ?? rootTokens?.refresh_token;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") return null;
  return { access_token: accessToken, refresh_token: refreshToken };
};

const startOAuthWebMessageBridge = () => {
  let done = false;
  let timeoutId: number | undefined;
  let resolveBridge!: (value: OAuthBridgeResult) => void;
  const promise = new Promise<OAuthBridgeResult>((resolve) => { resolveBridge = resolve; });

  const finish = (value: OAuthBridgeResult) => {
    if (done) return;
    done = true;
    window.removeEventListener("message", onMessage);
    if (timeoutId) window.clearTimeout(timeoutId);
    diagPush("bridge.finish", { value });
    resolveBridge(value);
  };

  const onMessage = (event: MessageEvent) => {
    const trusted = isTrustedOAuthMessageOrigin(event.origin);
    const payload = event.data as { type?: unknown; response?: unknown; tokens?: unknown } | null;
    const response = payload?.response && typeof payload.response === "object" ? payload.response as Record<string, unknown> : null;
    const responseTokens = response?.tokens && typeof response.tokens === "object" ? response.tokens as Record<string, unknown> : null;
    const rootTokens = payload?.tokens && typeof payload.tokens === "object" ? payload.tokens as Record<string, unknown> : null;
    diagPush("bridge.message", {
      origin: event.origin,
      trusted,
      type: payload?.type,
      keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : [],
      responseKeys: response ? Object.keys(response).slice(0, 8) : [],
      hasAccess: typeof response?.access_token === "string" || typeof responseTokens?.access_token === "string" || typeof rootTokens?.access_token === "string",
      hasRefresh: typeof response?.refresh_token === "string" || typeof responseTokens?.refresh_token === "string" || typeof rootTokens?.refresh_token === "string",
    });
    if (!trusted) return;
    if (!payload || payload.type !== "authorization_response") return;
    const tokens = extractOAuthTokensFromMessage(payload);
    if (!tokens) return;
    void supabase.auth.setSession(tokens).then(({ error }) => {
      diagPush("bridge.setSession", { ok: !error, error: error?.message });
      if (!error) finish("session");
    });
  };

  window.addEventListener("message", onMessage);
  timeoutId = window.setTimeout(() => finish("timeout"), GOOGLE_SIGN_IN_TIMEOUT_MS);
  diagPush("bridge.start", { timeoutMs: GOOGLE_SIGN_IN_TIMEOUT_MS });
  return { promise, cleanup: () => finish("timeout") };
};

const Auth = () => {
  const { user, loading, roles, rolesLoading, accountActive, signIn } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [reqForm, setReqForm] = useState({
    full_name: "", email: "", phone: "", role_title: "", department: "", birth_date: "", message: "",
  });

  // Diagnóstico do login Google (mobile). Ativa via ?diag=1 ou localStorage.
  const [diagEnabled, setDiagEnabled] = useState<boolean>(() => isOAuthDiagEnabled());
  const [diagLogs, setDiagLogs] = useState<DiagEntry[]>([]);
  useEffect(() => {
    diagPush = (label: string, data?: unknown) => {
      const entry: DiagEntry = { t: Date.now(), label, data: data !== undefined ? safeSerialize(data) : undefined };
      // eslint-disable-next-line no-console
      console.log("[oauth-diag]", label, entry.data ?? "");
      setDiagLogs((prev) => [...prev, entry].slice(-200));
    };
    return () => { diagPush = () => {}; };
  }, []);
  useEffect(() => {
    if (!diagEnabled) return;
    diagPush("boot", {
      ua: navigator.userAgent,
      href: window.location.href,
      origin: window.location.origin,
      inIframe: window !== window.parent,
      standalone: (window.matchMedia?.("(display-mode: standalone)").matches) ?? false,
      cookieEnabled: navigator.cookieEnabled,
      lang: navigator.language,
      hasLocalStorage: (() => { try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return true; } catch { return false; } })(),
    });
    const onAuth = supabase.auth.onAuthStateChange((event, session) => {
      diagPush("auth.onAuthStateChange", { event, hasSession: !!session, userId: session?.user?.id });
    });
    const onVis = () => diagPush("visibility", { state: document.visibilityState });
    document.addEventListener("visibilitychange", onVis);
    return () => { onAuth.data.subscription.unsubscribe(); document.removeEventListener("visibilitychange", onVis); };
  }, [diagEnabled]);

  // Preserva o destino pretendido (ex.: /.lovable/oauth/consent?authorization_id=...)
  // para que o fluxo de conexão MCP não caia em "/" após o login.
  const nextTarget = safeNext(new URLSearchParams(window.location.search).get("next"));

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    // Preserva o destino via sessionStorage — o redirect_uri fica sempre no
    // origin puro (exigência do broker OAuth managed da Lovable e do fluxo
    // web_message do Safari mobile). O destino real é aplicado só depois
    // que a sessão está válida.
    try { sessionStorage.setItem("exacta-oauth-next", nextTarget); } catch { /* noop */ }

    // IMPORTANTE: não passar `response_mode`, não detectar iframe, não usar
    // path protegido no redirect_uri. O helper @lovable.dev/cloud-auth-js já
    // trata popup + web_message no preview e full-page redirect fora dele.
    // Qualquer wrapper adicional trava o login no Safari mobile e no desktop
    // (o promise do helper nunca resolve).
    const redirectUri = window.location.origin;
    diagPush("google.click", { nextTarget, redirect_uri: redirectUri });

    try {
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirectUri });
      diagPush("google.signInWithOAuth.resolved", {
        redirected: (result as { redirected?: boolean })?.redirected,
        hasError: !!(result as { error?: unknown })?.error,
      });

      if (result.error) {
        setGoogleLoading(false);
        toast({
          title: "Não foi possível entrar com Google",
          description: result.error.message ?? "Tente novamente.",
          variant: "destructive",
        });
        return;
      }

      // Full-page redirect: o navegador vai sair da página; nada mais a fazer.
      if (result.redirected) return;

      // Popup/web_message: o helper já chamou setSession. Confirma e navega.
      const deadline = Date.now() + 5_000;
      const session = await waitForSessionAfterGoogle(deadline);
      setGoogleLoading(false);
      if (!session) {
        toast({
          title: "Login Google não finalizou",
          description: "Feche a janela do Google e toque novamente em Entrar com Google.",
          variant: "destructive",
        });
        return;
      }
      let target = nextTarget;
      try {
        const stored = sessionStorage.getItem("exacta-oauth-next");
        if (stored) { target = safeNext(stored); sessionStorage.removeItem("exacta-oauth-next"); }
      } catch { /* noop */ }
      navigate(target, { replace: true });
    } catch (e) {
      diagPush("google.signInWithOAuth.threw", { error: e instanceof Error ? e.message : String(e) });
      setGoogleLoading(false);
      toast({
        title: "Não foi possível entrar com Google",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    document.title = "Entrar | Aprovação de Pagamentos Médicos";
  }, []);

  // Se chegou aqui já autenticado mas sem nenhum papel do Exacta (ex.: usuário
  // só de portal), encerra a sessão e exibe um aviso — evita loop com o
  // ProtectedRoute e deixa claro que o portal usa magic link, não login direto.
  useEffect(() => {
    if (!loading && user && !rolesLoading) {
      if (roles.length === 0) {
        setNoAccess(true);
        void supabase.auth.signOut();
        toast({
          title: "Sem acesso ao Exacta",
          description: "Este usuário pertence apenas a um portal (empresa ou médico). O acesso é feito pelo link enviado por e-mail.",
          variant: "destructive",
        });
      } else if (!accountActive) {
        setNoAccess(true);
        void supabase.auth.signOut();
        toast({
          title: "Acesso desabilitado",
          description: "Seu cadastro está inativo. Procure um administrador para reabilitar o acesso.",
          variant: "destructive",
        });
      }
    }
  }, [loading, user, rolesLoading, roles, accountActive]);

  if (loading) return null;
  if (user && !noAccess && !rolesLoading && accountActive && roles.length > 0) return <Navigate to={nextTarget} replace />;

  const handleForgotPassword = async () => {
    const emailEl = document.getElementById("signin-email") as HTMLInputElement | null;
    const email = (emailEl?.value ?? "").trim();
    const parsed = z.string().email().safeParse(email);
    if (!parsed.success) {
      toast({ title: "Informe seu email", description: "Preencha o campo de email para enviarmos o link de recuperação.", variant: "destructive" });
      return;
    }
    sessionStorage.removeItem(PASSWORD_AUTH_URL_CACHE_KEY);
    sessionStorage.setItem(PASSWORD_RECOVERY_EMAIL_KEY, parsed.data);
    setResetting(true);
    const recoveryClient = createPasswordRecoveryClient({ flowType: "implicit" });
    const { error } = await recoveryClient.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${getPasswordRecoveryOrigin()}/auth/reset-password`,
    });
    setResetting(false);
    if (error) {
      toast({ title: "Não foi possível enviar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Email enviado", description: "Confira sua caixa de entrada para redefinir a senha." });
  };

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const parsed = signInSchema.safeParse({ email: data.get("email"), password: data.get("password") });
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await signIn(parsed.data.email, parsed.data.password);
    setSubmitting(false);
    if (error) {
      toast({ title: "Não foi possível entrar", description: error, variant: "destructive" });
      return;
    }
    navigate(nextTarget, { replace: true });
  };

  const handleAccessRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = accessRequestSchema.safeParse(reqForm);
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("access_requests").insert({
      full_name: parsed.data.full_name,
      email: parsed.data.email.toLowerCase(),
      phone: parsed.data.phone,
      role_title: parsed.data.role_title,
      department: parsed.data.department,
      birth_date: parsed.data.birth_date,
      message: parsed.data.message || null,
      requested_roles: ["analista"],
    });
    setSubmitting(false);
    if (error) {
      const desc = /duplicate|unique/i.test(error.message)
        ? "Já existe uma solicitação pendente para este e-mail."
        : error.message;
      toast({ title: "Não foi possível enviar a solicitação", description: desc, variant: "destructive" });
      return;
    }
    setReqForm({ full_name: "", email: "", phone: "", role_title: "", department: "", birth_date: "", message: "" });
    toast({ title: "Solicitação enviada", description: "Um administrador analisará seu pedido. Você receberá um e-mail com o convite após a aprovação." });
  };

  return (
    <div className="min-h-screen flex">
      {/* Painel esquerdo: animação — visível apenas em lg+ */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-[#002855] overflow-hidden flex-col">
        <div className="absolute inset-0">
          <LoginAnimation />
        </div>

        {/* Tagline no centro inferior */}
        <div className="absolute bottom-8 right-8 text-right">
          <p className="text-white/30 text-xs tracking-widest uppercase">Precisão em cada</p>
          <p className="text-white/30 text-xs tracking-widest uppercase">pagamento médico</p>
        </div>
      </div>

      {/* Painel direito: formulário */}
      <div className="flex flex-1 items-center justify-center p-6 bg-gradient-soft">
        <div className="w-full max-w-md">
          <header className="flex flex-col items-center text-center mb-8">
            <ExactaLogo variant="full" iconSize={56} wordmarkSize={28} asLink={false} className="flex-col gap-3" />
            <p className="text-sm text-muted-foreground mt-3">Fluxo seguro de aprovação de pagamentos médicos</p>
          </header>


          <Card className="shadow-card border-border/60">
            <CardHeader className="space-y-1">
              <CardTitle>Acesso</CardTitle>
              <CardDescription>Entre com seu email corporativo</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 pb-4">
                <Button type="button" variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={googleLoading}>
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/>
                  </svg>
                  {googleLoading ? "Conectando..." : "Entrar com Google"}
                </Button>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                  <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">ou com email</span></div>
                </div>
              </div>
              <Tabs defaultValue="signin">
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="signin">Entrar</TabsTrigger>
                  <TabsTrigger value="signup">Solicitar acesso</TabsTrigger>
                </TabsList>
                <TabsContent value="signin">
                  <form onSubmit={handleSignIn} className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">Email</Label>
                      <Input id="signin-email" name="email" type="email" autoComplete="email" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signin-password">Senha</Label>
                      <Input id="signin-password" name="password" type="password" autoComplete="current-password" required />
                    </div>
                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting ? "Entrando..." : "Entrar"}
                    </Button>

                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={resetting}
                      className="block w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {resetting ? "Enviando…" : "Esqueci minha senha"}
                    </button>
                  </form>
                </TabsContent>
                <TabsContent value="signup">
                  <form onSubmit={handleAccessRequest} className="space-y-3 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="req-name">Nome completo</Label>
                      <Input id="req-name" value={reqForm.full_name} onChange={(e) => setReqForm({ ...reqForm, full_name: e.target.value })} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="req-email">Email</Label>
                      <Input id="req-email" type="email" value={reqForm.email} onChange={(e) => setReqForm({ ...reqForm, email: e.target.value })} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="req-phone">Telefone celular</Label>
                      <Input id="req-phone" inputMode="numeric" placeholder="(11) 99999-9999"
                        value={formatPhone(reqForm.phone)}
                        onChange={(e) => setReqForm({ ...reqForm, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                        required />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="req-role">Cargo</Label>
                        <Input id="req-role" value={reqForm.role_title} onChange={(e) => setReqForm({ ...reqForm, role_title: e.target.value })} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="req-dept">Setor</Label>
                        <Input id="req-dept" value={reqForm.department} onChange={(e) => setReqForm({ ...reqForm, department: e.target.value })} required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="req-birth">Data de nascimento</Label>
                      <DateInput value={reqForm.birth_date} onChange={(v) => setReqForm({ ...reqForm, birth_date: v })} id="req-birth" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="req-msg">Mensagem (opcional)</Label>
                      <Textarea id="req-msg" rows={2} value={reqForm.message} onChange={(e) => setReqForm({ ...reqForm, message: e.target.value })} />
                    </div>
                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting ? "Enviando..." : "Solicitar acesso"}
                    </Button>

                    <p className="text-xs text-muted-foreground">
                      Sua solicitação será analisada por um administrador. Após a aprovação, você receberá um e-mail com o link para definir sua senha.
                    </p>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Painel de diagnóstico do login Google — habilite com ?diag=1 */}
          <div className="mt-4 text-center">
            <button
              type="button"
              className="text-[11px] text-muted-foreground/70 hover:text-foreground underline"
              onClick={() => {
                const next = !diagEnabled;
                setDiagEnabled(next);
                try {
                  if (next) localStorage.setItem(OAUTH_DIAG_STORAGE_KEY, "1");
                  else localStorage.removeItem(OAUTH_DIAG_STORAGE_KEY);
                } catch { /* noop */ }
              }}
            >
              {diagEnabled ? "Ocultar diagnóstico OAuth" : "Ativar diagnóstico OAuth"}
            </button>
          </div>
          {diagEnabled && (
            <Card className="mt-3 border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">Diagnóstico OAuth Google</CardTitle>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-[11px] px-2 py-1 rounded border border-border bg-background hover:bg-muted"
                      onClick={() => setDiagLogs([])}
                    >Limpar</button>
                    <button
                      type="button"
                      className="text-[11px] px-2 py-1 rounded border border-border bg-background hover:bg-muted"
                      onClick={() => {
                        const text = diagLogs.map((e) => `${new Date(e.t).toISOString()} ${e.label} ${e.data ? JSON.stringify(e.data) : ""}`).join("\n");
                        void navigator.clipboard?.writeText(text).then(
                          () => toast({ title: "Log copiado", description: `${diagLogs.length} eventos` }),
                          () => toast({ title: "Falha ao copiar", variant: "destructive" }),
                        );
                      }}
                    >Copiar</button>
                  </div>
                </div>
                <CardDescription className="text-[11px]">
                  {diagLogs.length} eventos · UA: {navigator.userAgent.slice(0, 60)}…
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-72 overflow-auto rounded border border-border bg-background p-2 font-mono text-[10px] leading-relaxed">
                  {diagLogs.length === 0 ? (
                    <p className="text-muted-foreground">Nenhum evento ainda. Toque em “Entrar com Google” para começar a instrumentação.</p>
                  ) : diagLogs.map((e, i) => (
                    <div key={i} className="border-b border-border/40 py-1 break-words">
                      <span className="text-muted-foreground">+{((e.t - (diagLogs[0]?.t ?? e.t)) / 1000).toFixed(2)}s</span>{" "}
                      <span className="font-semibold">{e.label}</span>
                      {e.data !== undefined && (
                        <pre className="whitespace-pre-wrap text-muted-foreground">{JSON.stringify(e.data, null, 0)}</pre>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;