import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";

const schema = z.object({
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: "As senhas não conferem", path: ["confirm"] });

const ForceChangePassword = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  useEffect(() => { document.title = "Trocar senha | MedPay Approval"; }, []);

  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  // Se o usuário não está marcado para troca, manda pra home.
  const mustReset = (user.user_metadata as Record<string, unknown> | undefined)?.must_reset_password === true;
  if (!mustReset) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({ password: fd.get("password"), confirm: fd.get("confirm") });
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
      data: { must_reset_password: false, password_changed_at: new Date().toISOString() },
    });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar senha", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Senha atualizada", description: "Faça login novamente com a nova senha." });
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-glow shadow-elegant">
            <ShieldCheck className="h-8 w-8 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Trocar senha</h1>
            <p className="text-sm text-muted-foreground">Você está usando uma senha temporária. Defina uma nova para continuar.</p>
          </div>
        </div>
        <Card className="shadow-elegant">
          <CardHeader className="space-y-1">
            <CardTitle>Defina sua nova senha</CardTitle>
            <CardDescription>Mínimo 8 caracteres. Após salvar você precisará entrar novamente.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Nova senha</Label>
                <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmar senha</Label>
                <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Salvando…" : "Salvar e entrar novamente"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ForceChangePassword;
