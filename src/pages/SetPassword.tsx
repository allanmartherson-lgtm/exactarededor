import { useEffect, useMemo, useState } from "react";
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
 * Suporta os dois formatos do Supabase:
 *  - Hash legado:  #access_token=...&type=invite|recovery
 *  - PKCE (novo):  ?code=...   (precisa exchangeCodeForSession)
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

  // Detecta os parâmetros vindos do email (hash ou query).
  const hashParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.hash.replace(/^#/, ""));
  }, []);

  useEffect(() => {
    document.title = "Definir senha | MedPay Approval";
    let cancelled = false;

    const run = async () => {
      try {
        const errorDescription = hashParams.get("error_description") ?? params.get("error_description");
        if (errorDescription) {
          setErrorMsg(decodeURIComponent(errorDescription));
          setPhase("invalid");
          return;
        }

        const code = params.get("code");
        const type = (hashParams.get("type") ?? params.get("type") ?? "") as "invite" | "recovery" | "";
        const tokenHash = params.get("token_hash") ?? hashParams.get("token_hash");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (type === "invite") setFlow("invite");
        else if (type === "recovery") setFlow("recovery");

        // Caminho 0 — link manual gerado pelo admin (?token_hash=...&type=invite|recovery)
        if (tokenHash && (type === "invite" || type === "recovery")) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          if (error) throw error;
          window.history.replaceState({}, "", window.location.pathname);
          if (!cancelled) setPhase("ready");
          return;
        }

        // Caminho 1 — fluxo PKCE moderno (?code=...)
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          // Limpa o parâmetro da URL
          window.history.replaceState({}, "", window.location.pathname);
          if (!cancelled) setPhase("ready");
          return;
        }

        // Caminho 2 — fluxo legado por hash (#access_token=...)
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) throw error;
          window.history.replaceState({}, "", window.location.pathname);
          if (!cancelled) setPhase("ready");
          return;
        }

        // Caminho 3 — usuário já está logado e quer trocar a senha manualmente
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setFlow("session");
          if (!cancelled) setPhase("ready");
          return;
        }

        setErrorMsg("Link inválido ou expirado. Solicite um novo convite ou recuperação de senha.");
        if (!cancelled) setPhase("invalid");
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Não foi possível validar o link.");
        setPhase("invalid");
      }
    };

    run();
    return () => { cancelled = true; };
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