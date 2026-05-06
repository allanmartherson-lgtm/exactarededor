import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/status";
import { toast } from "@/hooks/use-toast";
import { Plus, Copy, Send, Loader2, ExternalLink, KeyRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const ROLES: AppRole[] = ["admin", "diretor", "validador", "analista"];
const PROJECT_PREVIEW_ORIGIN = "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";

const getPasswordRecoveryOrigin = () => {
  if (window.location.hostname.endsWith(".lovableproject.com")) return PROJECT_PREVIEW_ORIGIN;
  return window.location.origin;
};

const Users = () => {
  const { roles: myRoles } = useAuth();
  const isAdmin = myRoles.includes("admin");
  const [users, setUsers] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    email: "", full_name: "", roles: [] as AppRole[], send_invite: true,
  });
  const [tempPwd, setTempPwd] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<{ email: string; link: string; kind: "invite" | "recovery" } | null>(null);

  const copyText = async (text: string, successTitle = "Copiado") => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: successTitle });
    } catch {
      toast({ title: "Não foi possível copiar automaticamente", description: "Selecione o texto e copie manualmente." });
    }
  };

  const load = async () => {
    const { data: profiles } = await supabase.from("profiles").select("*");
    const { data: roles } = await supabase.from("user_roles").select("*");
    const map = (profiles ?? []).map((p) => ({ ...p, roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role) }));
    setUsers(map);
  };
  useEffect(() => { document.title = "Usuários | MedPay"; load(); }, []);

  const toggle = async (userId: string, role: AppRole, has: boolean) => {
    if (has) await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    else await supabase.from("user_roles").insert({ user_id: userId, role });
    load(); toast({ title: "Atualizado" });
  };

  const resendInvite = async (u: { id: string; email: string }) => {
    setResendingId(u.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-resend-invite", {
        body: { email: u.email, app_origin: getPasswordRecoveryOrigin() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const kindLabel = data?.kind === "invite" ? "Convite reenviado" : "Link de redefinição enviado";
      const desc = data?.action_link
        ? `Tentamos enviar por e-mail para ${u.email}. Também abrimos o link manual para copiar.`
        : `Enviamos por e-mail para ${u.email}.`;
      toast({ title: kindLabel, description: desc });
      // Disponibiliza o link manual caso o e-mail não chegue (SMTP indisponível, etc.)
      if (data?.action_link) {
        setManualLink({ email: u.email, link: data.action_link, kind: data?.kind === "invite" ? "invite" : "recovery" });
      }
    } catch (e: any) {
      toast({ title: "Falha ao reenviar", description: e.message, variant: "destructive" });
    } finally {
      setResendingId(null);
    }
  };

  const resetForm = () => {
    setForm({ email: "", full_name: "", roles: [], send_invite: true });
    setTempPwd(null);
  };

  const submit = async () => {
    if (!form.email.trim()) {
      toast({ title: "E-mail obrigatório", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          roles: form.roles,
          send_invite: form.send_invite,
          app_origin: getPasswordRecoveryOrigin(),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.temp_password) {
        setTempPwd(data.temp_password);
        toast({ title: "Usuário criado", description: "Compartilhe a senha temporária abaixo." });
      } else {
        toast({ title: "Convite enviado", description: `Enviamos um e-mail para ${form.email}.` });
        setOpen(false);
        resetForm();
      }
      load();
    } catch (e: any) {
      toast({ title: "Erro ao criar usuário", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Usuários" description="Atribua papéis para controlar quem valida e aprova."
        actions={isAdmin ? (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Novo usuário</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo usuário</DialogTitle>
                <DialogDescription>Crie uma conta e atribua papéis. O usuário definirá a senha no primeiro acesso.</DialogDescription>
              </DialogHeader>
              {tempPwd ? (
                <div className="space-y-3">
                  <p className="text-sm">Senha temporária gerada. Compartilhe com o usuário — ele deverá alterá-la no primeiro acesso.</p>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={tempPwd} className="font-mono" />
                    <Button size="icon" variant="outline" onClick={() => copyText(tempPwd)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => { setOpen(false); resetForm(); }}>Concluir</Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome completo</Label>
                    <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Maria Silva" />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail *</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="maria@empresa.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Papéis</Label>
                    <div className="flex flex-wrap gap-2">
                      {ROLES.map((r) => {
                        const checked = form.roles.includes(r);
                        return (
                          <Button key={r} type="button" size="sm" variant={checked ? "default" : "outline"}
                            onClick={() => setForm({ ...form, roles: checked ? form.roles.filter((x) => x !== r) : [...form.roles, r] })}>
                            {ROLE_LABELS[r]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 pt-2 border-t">
                    <Checkbox id="send_invite" checked={form.send_invite}
                      onCheckedChange={(c) => setForm({ ...form, send_invite: !!c })} />
                    <div className="grid gap-1">
                      <Label htmlFor="send_invite" className="cursor-pointer">Enviar convite por e-mail</Label>
                      <p className="text-xs text-muted-foreground">
                        {form.send_invite
                          ? "O usuário receberá um link para definir a senha."
                          : "Será gerada uma senha temporária para você compartilhar manualmente."}
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                    <Button onClick={submit} disabled={saving}>{saving ? "Criando..." : "Criar usuário"}</Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        ) : undefined}
      />
      <div className="p-8">
        <Card className="shadow-card"><CardContent className="p-0">
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div><p className="font-medium text-sm">{u.full_name || u.email}</p><p className="text-xs text-muted-foreground">{u.email}</p></div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ROLES.map((r) => {
                    const has = u.roles.includes(r);
                    return <Button key={r} size="sm" variant={has ? "default" : "outline"} onClick={() => toggle(u.id, r, has)}>{ROLE_LABELS[r]}</Button>;
                  })}
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => resendInvite({ id: u.id, email: u.email })}
                      disabled={resendingId === u.id}
                      title="Reenvia o link de definição/redefinição de senha por e-mail"
                    >
                      {resendingId === u.id
                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        : <Send className="h-3.5 w-3.5 mr-1.5" />}
                      Reenviar convite
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      </div>
      <Dialog open={!!manualLink} onOpenChange={(o) => !o && setManualLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{manualLink?.kind === "invite" ? "Link de convite" : "Link de redefinição"}</DialogTitle>
            <DialogDescription>
              Se o e-mail não chegar para {manualLink?.email}, copie e envie este link manualmente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input readOnly value={manualLink?.link ?? ""} className="font-mono text-xs" />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  if (!manualLink?.link) return;
                  copyText(manualLink.link, "Link copiado");
                }}
              >
                <Copy className="h-4 w-4 mr-2" /> Copiar link
              </Button>
              <Button type="button" variant="outline" asChild>
                <a href={manualLink?.link ?? "#"} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" /> Abrir link
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default Users;