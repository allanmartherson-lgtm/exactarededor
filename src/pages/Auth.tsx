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
import EcgPulseAnimation from "@/components/auth/EcgPulseAnimation";
import RedeDOrLogo from "@/components/auth/RedeDOrLogo";

const PASSWORD_AUTH_URL_CACHE_KEY = "exacta-password-auth-url";
const PASSWORD_RECOVERY_EMAIL_KEY = "exacta-password-recovery-email";
const PROJECT_PREVIEW_ORIGIN = "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";

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

const Auth = () => {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [reqForm, setReqForm] = useState({
    full_name: "", email: "", phone: "", role_title: "", department: "", birth_date: "", message: "",
  });

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setGoogleLoading(false);
      toast({ title: "Não foi possível entrar com Google", description: result.error.message ?? "Tente novamente.", variant: "destructive" });
      return;
    }
    if (result.redirected) return;
    setGoogleLoading(false);
    navigate("/", { replace: true });
  };

  useEffect(() => {
    document.title = "Entrar | Aprovação de Pagamentos Médicos";
  }, []);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

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
    const recoveryClient = createPasswordRecoveryClient();
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
    navigate("/", { replace: true });
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
      <div className="hidden lg:flex lg:w-[55%] relative bg-[#0d1117] overflow-hidden flex-col">
        <div className="absolute inset-0">
          <EcgPulseAnimation />
        </div>
        {/* Branding Rede D'Or no canto inferior esquerdo */}
        <div className="absolute bottom-8 left-8 flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <polygon points="14,2 17.5,10 26,10.5 20,16.5 22,25 14,20.5 6,25 8,16.5 2,10.5 10.5,10" fill="#D4A017" opacity="0.9"/>
          </svg>
          <div>
            <p className="text-white/90 text-sm font-medium leading-tight">Rede D'Or</p>
            <p className="text-white/50 text-xs leading-tight">Hospital DF Star</p>
          </div>
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
          <header className="text-center mb-8">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-elevated mb-4">
              <ShieldCheck className="h-7 w-7 text-primary-foreground" />
            </div>
            <h1 className="font-wordmark" style={{ fontSize: 32, fontWeight: 400, letterSpacing: "0.04em" }}>E<span style={{ color: "hsl(var(--accent))" }}>x</span>acta</h1>
            <p className="text-sm text-muted-foreground mt-1">Fluxo seguro de aprovação de pagamentos médicos</p>
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
                      <Input id="req-birth" type="date" value={reqForm.birth_date} onChange={(e) => setReqForm({ ...reqForm, birth_date: e.target.value })} required />
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
        </div>
      </div>
    </div>
  );
};

export default Auth;