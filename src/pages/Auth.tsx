import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";
import { createPasswordRecoveryClient } from "@/lib/passwordRecoveryClient";
import { lovable } from "@/integrations/lovable";

const PASSWORD_AUTH_URL_CACHE_KEY = "medpay-password-auth-url";
const PASSWORD_RECOVERY_EMAIL_KEY = "medpay-password-recovery-email";

const signInSchema = z.object({
  email: z.string().trim().email("Email inválido").max(255),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72),
});
const signUpSchema = signInSchema.extend({
  fullName: z.string().trim().min(2, "Informe seu nome").max(100),
});

const Auth = () => {
  const { user, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

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
      redirectTo: `${window.location.origin}/auth/reset-password`,
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

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const parsed = signUpSchema.safeParse({
      email: data.get("email"),
      password: data.get("password"),
      fullName: data.get("fullName"),
    });
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await signUp(parsed.data.email, parsed.data.password, parsed.data.fullName);
    setSubmitting(false);
    if (error) {
      toast({ title: "Não foi possível criar a conta", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Conta criada", description: "Você já pode entrar." });
  };

  return (
    <div className="min-h-screen bg-gradient-soft flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <header className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-elevated mb-4">
            <ShieldCheck className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">MedPay Approval</h1>
          <p className="text-sm text-muted-foreground mt-1">Fluxo seguro de aprovação de pagamentos médicos</p>
        </header>

        <Card className="shadow-card border-border/60">
          <CardHeader className="space-y-1">
            <CardTitle>Acesso</CardTitle>
            <CardDescription>Entre com seu email corporativo</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Criar conta</TabsTrigger>
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
                <form onSubmit={handleSignUp} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Nome completo</Label>
                    <Input id="signup-name" name="fullName" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input id="signup-email" name="email" type="email" autoComplete="email" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Senha</Label>
                    <Input id="signup-password" name="password" type="password" autoComplete="new-password" required minLength={6} />
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? "Criando..." : "Criar conta"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    O primeiro usuário cadastrado vira <strong>Diretor + Admin</strong>. Os demais entram como Analista e podem ter o papel ajustado pelo Admin.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Auth;