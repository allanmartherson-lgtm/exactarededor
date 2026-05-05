import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";

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

const SetPassword = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [flow, setFlow] = useState<"invite" | "recovery" | "session">("recovery");
  const urlSessionRef = useRef<{ access_token: string; refresh_token: string } | null>(null);

  // Detecta os parâmetros vindos do email (hash ou query).
  const hashParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.hash.replace(/^#/, ""));
  }, []);

  useEffect(() => {
    document.title = "Definir senha | MedPay Approval";
    let cancelled = false;
    let settled = false;

    const markReady = (f?: "invite" | "recovery" | "session") => {
      if (cancelled || settled) return;
      settled = true;
      if (f) setFlow(f);
      setPhase("ready");
    };

    // Listener para eventos do Supabase. O cliente tem detectSessionInUrl=true,
    // então ele processa o ?code=/#access_token= automaticamente e dispara
    // PASSWORD_RECOVERY (recuperação) ou SIGNED_IN (convite).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY") {
        markReady("recovery");
      } else if (event === "SIGNED_IN" && session) {
        markReady();
      }
    });

    const run = async () => {
      try {
        const errorDescription = hashParams.get("error_description") ?? params.get("error_description");
        if (errorDescription) {
          setErrorMsg(decodeURIComponent(errorDescription));
          setPhase("invalid");
          return;
        }

        const type = (hashParams.get("type") ?? params.get("type") ?? "") as "invite" | "recovery" | "";
        const tokenHash = params.get("token_hash") ?? hashParams.get("token_hash");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const code = params.get("code");
        const hasUrlAuth = !!(code || tokenHash || accessToken);

        if (type === "invite") setFlow("invite");
        else if (type === "recovery") setFlow("recovery");

        // Links de hash/implicit podem chegar antes do listener processar a sessão.
        // Nesse caso, criamos a sessão explicitamente com os tokens da própria URL.
        if (accessToken && refreshToken) {
          urlSessionRef.current = { access_token: accessToken, refresh_token: refreshToken };
          const { error } = await supabase.auth.setSession(urlSessionRef.current);
          if (error) throw error;
          window.history.replaceState({}, "", window.location.pathname);
          markReady(type === "invite" ? "invite" : "recovery");
          return;
        }

        // token_hash é usado em alguns links gerados pelo admin.
        if (tokenHash && (type === "invite" || type === "recovery")) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
          window.history.replaceState({}, "", window.location.pathname);
          markReady(type);
          return;
        }

        // Para PKCE, deixamos o cliente tentar detectar primeiro; se não houver
        // sessão depois de um curto intervalo, fazemos o exchange como fallback.
        if (code) {
          for (let i = 0; i < 10; i++) {
            if (cancelled || settled) return;
            await new Promise((r) => setTimeout(r, 100));
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              window.history.replaceState({}, "", window.location.pathname);
              markReady(type === "invite" ? "invite" : "recovery");
              return;
            }
          }

          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState({}, "", window.location.pathname);
          markReady(type === "invite" ? "invite" : "recovery");
          return;
        }

        if (hasUrlAuth) {
          // Aguarda o Supabase terminar de processar a URL e disparar o evento.
          // Damos um tempo generoso (3s) e checamos a sessão como fallback.
          for (let i = 0; i < 30; i++) {
            if (cancelled || settled) return;
            await new Promise((r) => setTimeout(r, 100));
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              window.history.replaceState({}, "", window.location.pathname);
              markReady(type === "invite" ? "invite" : "recovery");
              return;
            }
          }
          if (cancelled || settled) return;
          setErrorMsg("Não foi possível validar o link. Ele pode ter expirado — solicite um novo.");
          setPhase("invalid");
          return;
        }

        // Sem parâmetros na URL — talvez já esteja logado e queira trocar a senha.
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          markReady("session");
          return;
        }

        setErrorMsg("Link inválido ou expirado. Solicite um novo convite ou recuperação de senha.");
        if (!cancelled) setPhase("invalid");
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Não foi possível validar o link.";
        setErrorMsg(msg);
        setPhase("invalid");
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
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      setPhase("ready");
      toast({ title: "Erro ao salvar senha", description: error.message, variant: "destructive" });
      return;
    }
    setPhase("done");
    toast({ title: "Senha definida", description: "Você já está autenticado." });
    setTimeout(() => navigate("/", { replace: true }), 800);
  };

  if (phase === "done") return <Navigate to="/" replace />;

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