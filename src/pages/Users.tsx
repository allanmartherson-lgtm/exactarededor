import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/status";
import { toast } from "@/hooks/use-toast";
import { Plus, Copy, Send, Loader2, ExternalLink, KeyRound, Check, X, Pencil, History, Bell } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatPhone, userExtraSchema } from "@/lib/userFields";
import { formatDateBR, formatDateTimeBR } from "@/lib/dateUtils";

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
    email: "", full_name: "", phone: "", role_title: "", department: "", birth_date: "",
    roles: [] as AppRole[], send_invite: true,
  });
  const [accessRequestId, setAccessRequestId] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [editingReq, setEditingReq] = useState<any | null>(null);
  const [savingReq, setSavingReq] = useState(false);
  const [tempPwd, setTempPwd] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; emailSent: boolean; warning: string | null; actionLink: string | null } | null>(null);
  const [confirmReset, setConfirmReset] = useState<{ id: string; email: string; full_name: string | null } | null>(null);
  const [manualLink, setManualLink] = useState<{ email: string; link: string; kind: "invite" | "recovery" } | null>(null);
  const [editingUser, setEditingUser] = useState<{ id: string; email: string; full_name: string; phone: string; role_title: string; department: string; birth_date: string } | null>(null);
  const [notifyingUser, setNotifyingUser] = useState<{ id: string; name: string } | null>(null);
  const [userSettings, setUserSettings] = useState<any[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [historyUser, setHistoryUser] = useState<{ id: string; label: string } | null>(null);
  const [historyEntries, setHistoryEntries] = useState<any[] | null>(null);
  const [historyActors, setHistoryActors] = useState<Record<string, string>>({});

  const FIELD_LABELS: Record<string, string> = {
    full_name: "Nome",
    phone: "Telefone",
    role_title: "Cargo",
    department: "Setor",
    birth_date: "Data de nascimento",
  };

  const formatHistoryValue = (field: string, value: any) => {
    if (value === null || value === undefined || value === "") return "—";
    if (field === "phone") return formatPhone(String(value));
    if (field === "birth_date") {
      const s = String(value).slice(0, 10);
      const [y, m, d] = s.split("-");
      return d && m && y ? `${d}/${m}/${y}` : s;
    }
    return String(value);
  };

  const openHistory = async (u: { id: string; email: string; full_name?: string | null }) => {
    setHistoryUser({ id: u.id, label: u.full_name || u.email });
    setHistoryEntries(null);
    const { data, error } = await supabase
      .from("audit_log")
      .select("id, created_at, actor_id, action, diff")
      .eq("entity_type", "user")
      .eq("entity_id", u.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Erro ao carregar histórico", description: error.message, variant: "destructive" });
      setHistoryEntries([]);
      return;
    }
    const entries = data ?? [];
    const actorIds = Array.from(new Set(entries.map((e) => e.actor_id).filter(Boolean))) as string[];
    if (actorIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", actorIds);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => { map[p.id] = p.full_name || p.email; });
      setHistoryActors(map);
    } else {
      setHistoryActors({});
    }
    setHistoryEntries(entries);
  };

  const saveUser = async () => {
    if (!editingUser) return;
    const parsed = userExtraSchema.safeParse({
      full_name: editingUser.full_name,
      email: editingUser.email,
      phone: editingUser.phone,
      role_title: editingUser.role_title,
      department: editingUser.department,
      birth_date: editingUser.birth_date,
    });
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSavingUser(true);
    const { error } = await supabase.from("profiles").update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      role_title: parsed.data.role_title,
      department: parsed.data.department,
      birth_date: parsed.data.birth_date,
    }).eq("id", editingUser.id);
    setSavingUser(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Usuário atualizado" });
    setEditingUser(null);
    load();
  };

  const loadUserSettings = async (userId: string, userName: string) => {
    setNotifyingUser({ id: userId, name: userName });
    setLoadingSettings(true);
    const { data, error } = await supabase
      .from("user_notification_settings")
      .select("*")
      .eq("user_id", userId);
    
    if (error) {
      toast({ title: "Erro ao carregar configurações", description: error.message, variant: "destructive" });
      setLoadingSettings(false);
      return;
    }

    const events = ["returned", "ia_concluded", "nf_received"];
    const existing = data || [];
    const complete = events.map(evt => {
      const s = existing.find(x => x.event_type === evt);
      return s || { event_type: evt, email_enabled: true, whatsapp_enabled: true };
    });

    setUserSettings(complete);
    setLoadingSettings(false);
  };

  const toggleUserSetting = async (eventType: string, field: string, value: boolean) => {
    if (!notifyingUser) return;
    
    const newSettings = userSettings.map(s => 
      s.event_type === eventType ? { ...s, [field]: value } : s
    );
    setUserSettings(newSettings);

    const { error } = await supabase
      .from("user_notification_settings")
      .upsert({
        user_id: notifyingUser.id,
        event_type: eventType,
        [field]: value,
        updated_at: new Date().toISOString()
      } as any, { onConflict: 'user_id,event_type' });

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      setUserSettings(userSettings);
    }
  };

  const EVENT_LABELS: Record<string, string> = {
    returned: "Lote devolvido",
    ia_concluded: "Análise IA concluída",
    nf_received: "Nota Fiscal recebida",
  };


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
  const loadRequests = async () => {
    if (!isAdmin) return;
    const { data } = await supabase
      .from("access_requests")
      .select("*")
      .eq("status", "pendente")
      .order("created_at", { ascending: false });
    setRequests(data ?? []);
  };
  useEffect(() => { document.title = "Usuários | MedPay"; load(); loadRequests(); }, [isAdmin]);

  const openCreateFromRequest = (r: any) => {
    setForm({
      email: r.email, full_name: r.full_name, phone: r.phone, role_title: r.role_title,
      department: r.department, birth_date: r.birth_date,
      roles: (r.requested_roles ?? ["analista"]) as AppRole[], send_invite: true,
    });
    setAccessRequestId(r.id);
    setOpen(true);
  };

  const rejectRequest = async () => {
    if (!rejecting) return;
    const { error } = await supabase.from("access_requests").update({
      status: "rejeitada",
      rejection_reason: rejecting.reason || null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", rejecting.id);
    if (error) {
      toast({ title: "Falha ao rejeitar", description: error.message, variant: "destructive" });
      return;
    }
    const req = requests.find((r) => r.id === rejecting.id);
    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user) {
      await supabase.from("audit_log").insert({
        actor_id: auth.user.id,
        entity_type: "access_request",
        entity_id: rejecting.id,
        action: "rejected",
        diff: { email: req?.email, full_name: req?.full_name, reason: rejecting.reason || null },
      });
    }
    setRejecting(null);
    loadRequests();
    toast({ title: "Solicitação rejeitada" });
  };

  const saveEditedRequest = async () => {
    if (!editingReq) return;
    const parsed = userExtraSchema.safeParse({
      full_name: editingReq.full_name,
      email: editingReq.email,
      phone: editingReq.phone ?? "",
      role_title: editingReq.role_title ?? "",
      department: editingReq.department ?? "",
      birth_date: editingReq.birth_date ?? "",
    });
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSavingReq(true);
    const { error } = await supabase.from("access_requests").update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      role_title: parsed.data.role_title,
      department: parsed.data.department,
      birth_date: parsed.data.birth_date,
    }).eq("id", editingReq.id);
    setSavingReq(false);
    if (error) {
      toast({ title: "Falha ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    setEditingReq(null);
    loadRequests();
    toast({ title: "Solicitação atualizada" });
  };

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

  const resetPassword = async (u: { id: string; email: string }) => {
    setResettingId(u.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-password", {
        body: { user_id: u.id, email: u.email, app_origin: getPasswordRecoveryOrigin() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const emailSent = data?.email_sent !== false;
      setResetResult({
        email: data?.email ?? u.email,
        emailSent,
        warning: data?.warning ?? null,
        actionLink: data?.action_link ?? null,
      });
      toast({
        title: emailSent ? "E-mail de redefinição enviado" : "Não foi possível enviar o e-mail",
        description: emailSent
          ? `Enviamos um link para ${u.email}. O usuário precisará definir uma nova senha.`
          : (data?.warning ?? "Use o link manual gerado para compartilhar com o usuário."),
        variant: emailSent ? undefined : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Falha ao resetar senha", description: e.message, variant: "destructive" });
    } finally {
      setResettingId(null);
      setConfirmReset(null);
    }
  };
  const resetForm = () => {
    setForm({ email: "", full_name: "", phone: "", role_title: "", department: "", birth_date: "", roles: [], send_invite: true });
    setAccessRequestId(null);
    setTempPwd(null);
  };

  const submit = async () => {
    const parsed = userExtraSchema.safeParse({
      full_name: form.full_name, email: form.email, phone: form.phone,
      role_title: form.role_title, department: form.department, birth_date: form.birth_date,
    });
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: parsed.data.email,
          full_name: parsed.data.full_name,
          phone: parsed.data.phone,
          role_title: parsed.data.role_title,
          department: parsed.data.department,
          birth_date: parsed.data.birth_date,
          roles: form.roles,
          send_invite: form.send_invite,
          app_origin: getPasswordRecoveryOrigin(),
          access_request_id: accessRequestId,
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
      loadRequests();
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
            <DialogContent className="w-[95vw] max-w-2xl max-h-[92vh] overflow-y-auto sm:p-0 p-0 overflow-hidden flex flex-col">
              <DialogHeader className="p-6 pb-2">
                <DialogTitle>Novo usuário</DialogTitle>
                <DialogDescription>Crie uma conta e atribua papéis. O usuário definirá a senha no primeiro acesso.</DialogDescription>
              </DialogHeader>
              {tempPwd ? (
                <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
                  <p className="text-sm">Senha temporária gerada. Compartilhe com o usuário — ele deverá alterá-la no primeiro acesso.</p>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={tempPwd} className="font-mono" />
                    <Button size="icon" variant="outline" onClick={() => copyText(tempPwd)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4 box-border min-w-0">
                  {accessRequestId && (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
                      Criando a partir de uma solicitação de acesso aprovada.
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Nome completo *</Label>
                    <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Maria Silva" />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail *</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="maria@empresa.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefone celular *</Label>
                    <Input inputMode="numeric" placeholder="(11) 99999-9999"
                      value={formatPhone(form.phone)}
                      onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label>Cargo *</Label>
                      <Input value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Setor *</Label>
                      <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Data de nascimento *</Label>
                    <Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
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
                  <DialogFooter className="p-6 pt-4 border-t">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                    <Button onClick={submit} disabled={saving}>{saving ? "Criando..." : "Criar usuário"}</Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        ) : undefined}
      />
      <div className="p-8 max-w-full space-y-6">
        {isAdmin && requests.length > 0 && (
          <Card className="shadow-card border-primary/30">
            <CardContent className="p-0">
              <div className="px-6 py-3 border-b flex items-center justify-between">
                <p className="font-medium text-sm">Solicitações de acesso pendentes</p>
                <Badge variant="secondary">{requests.length}</Badge>
              </div>
              <div className="divide-y divide-border">
                {requests.map((r) => (
                  <div key={r.id} className="px-6 py-4 flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1 min-w-0">
                      <p className="font-medium text-sm">{r.full_name} <span className="text-muted-foreground font-normal">— {r.email}</span></p>
                      <p className="text-xs text-muted-foreground">
                        {formatPhone(r.phone)} · {r.role_title} · {r.department} · Nasc. {formatDateBR(r.birth_date)}
                      </p>
                      {r.message && <p className="text-xs text-muted-foreground italic">"{r.message}"</p>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" onClick={() => openCreateFromRequest(r)}>
                        <Check className="h-3.5 w-3.5 mr-1.5" /> Aprovar e criar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingReq({ ...r })}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting({ id: r.id, reason: "" })}>
                        <X className="h-3.5 w-3.5 mr-1.5" /> Rejeitar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="shadow-card"><CardContent className="p-0">
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{u.full_name || u.email}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                  {(u.phone || u.role_title || u.department) && (
                    <p className="text-xs text-muted-foreground">
                      {[u.phone && formatPhone(u.phone), u.role_title, u.department].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
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
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingUser({
                        id: u.id,
                        email: u.email,
                        full_name: u.full_name ?? "",
                        phone: u.phone ?? "",
                        role_title: u.role_title ?? "",
                        department: u.department ?? "",
                        birth_date: u.birth_date ? String(u.birth_date).slice(0, 10) : "",
                      })}
                      title="Editar dados do usuário"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Editar
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openHistory(u)}
                      title="Ver histórico de alterações deste usuário"
                    >
                      <History className="h-3.5 w-3.5 mr-1.5" />
                      Histórico
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => loadUserSettings(u.id, u.full_name || u.email)}
                      title="Configurar notificações por e-mail/WhatsApp para este usuário"
                    >
                      <Bell className="h-3.5 w-3.5 mr-1.5" />
                      Notificações
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmReset({ id: u.id, email: u.email, full_name: u.full_name })}
                      disabled={resettingId === u.id}
                      title="Envia e-mail com link para o usuário definir uma nova senha"
                    >
                      {resettingId === u.id
                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        : <KeyRound className="h-3.5 w-3.5 mr-1.5" />}
                      Resetar senha
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      </div>
      <Dialog open={!!manualLink} onOpenChange={(o) => !o && setManualLink(null)}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[92vh] overflow-y-auto sm:p-0 p-0 overflow-hidden flex flex-col">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>{manualLink?.kind === "invite" ? "Link de convite" : "Link de redefinição"}</DialogTitle>
            <DialogDescription>
              Se o e-mail não chegar para {manualLink?.email}, copie e envie este link manualmente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
            <Input readOnly value={manualLink?.link ?? ""} className="font-mono text-xs" />
            <div className="flex flex-wrap gap-2 pt-2">
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
          <DialogFooter className="p-6 pt-2">
            <Button variant="outline" onClick={() => setManualLink(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingUser} onOpenChange={(o) => !o && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuário — {editingUser?.full_name || editingUser?.email}</DialogTitle>
            <DialogDescription>
              Atualize os dados do usuário. O e-mail é usado como login e não pode ser alterado.
            </DialogDescription>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <div className="space-y-2">
                <Label>Nome completo *</Label>
                <Input value={editingUser.full_name} onChange={(e) => setEditingUser({ ...editingUser, full_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>E-mail (login)</Label>
                <Input type="email" value={editingUser.email} disabled />
              </div>
              <div className="space-y-2">
                <Label>Telefone celular *</Label>
                <Input
                  inputMode="numeric"
                  placeholder="(11) 99999-9999"
                  value={formatPhone(editingUser.phone)}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                />
                <p className="text-xs text-muted-foreground">Também usado para WhatsApp em notificações de aprovação.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Cargo *</Label>
                  <Input value={editingUser.role_title} onChange={(e) => setEditingUser({ ...editingUser, role_title: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Setor *</Label>
                  <Input value={editingUser.department} onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Data de nascimento *</Label>
                <Input type="date" value={editingUser.birth_date} onChange={(e) => setEditingUser({ ...editingUser, birth_date: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)} disabled={savingUser}>Cancelar</Button>
            <Button onClick={saveUser} disabled={savingUser}>
              {savingUser && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!historyUser} onOpenChange={(o) => { if (!o) { setHistoryUser(null); setHistoryEntries(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico — {historyUser?.label}</DialogTitle>
            <DialogDescription>
              Alterações de dados deste usuário, com autor, data e campos modificados.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
            {historyEntries === null && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            )}
            {historyEntries && historyEntries.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma alteração registrada.</p>
            )}
            {historyEntries?.map((e) => {
              const isCreate = e.action === "created";
              const diff = e.diff ?? {};
              const when = new Date(e.created_at).toLocaleString("pt-BR");
              const actor = e.actor_id ? (historyActors[e.actor_id] ?? "—") : "Sistema";
              return (
                <div key={e.id} className="border rounded-md p-3 text-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-medium">{isCreate ? "Usuário criado" : "Dados atualizados"}</span>
                    <span className="text-xs text-muted-foreground">{when}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">por {actor}</p>
                  {isCreate ? (
                    <p className="text-xs text-muted-foreground">
                      {diff.email ? `E-mail: ${diff.email}` : null}
                      {diff.full_name ? ` · Nome: ${diff.full_name}` : null}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {Object.entries(diff).map(([field, change]: any) => (
                        <li key={field} className="text-xs">
                          <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span>{" "}
                          <span className="text-muted-foreground line-through">{formatHistoryValue(field, change?.from)}</span>
                          {" → "}
                          <span>{formatHistoryValue(field, change?.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setHistoryUser(null); setHistoryEntries(null); }}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!confirmReset} onOpenChange={(o) => !o && setConfirmReset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetar senha de {confirmReset?.full_name || confirmReset?.email}?</DialogTitle>
            <DialogDescription>
              Enviaremos um e-mail para o usuário com um link de redefinição. Ele será obrigado a definir uma nova senha no próximo acesso.
              Esta ação não afeta logins via Google/SSO.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(null)} disabled={resettingId !== null}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmReset && resetPassword({ id: confirmReset.id, email: confirmReset.email })}
              disabled={resettingId !== null}
            >
              {resettingId !== null ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
              Enviar e-mail de redefinição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!resetResult} onOpenChange={(o) => !o && setResetResult(null)}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[92vh] overflow-y-auto sm:p-0 p-0 overflow-hidden flex flex-col">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>{resetResult?.emailSent ? "E-mail de redefinição enviado" : "Não foi possível enviar o e-mail"}</DialogTitle>
            <DialogDescription>
              {resetResult?.emailSent
                ? <>Enviamos um link para <strong>{resetResult?.email}</strong>. O usuário deverá abrir o e-mail e definir uma nova senha.</>
                : (resetResult?.warning ?? "Use o link manual abaixo para compartilhar com o usuário por um canal seguro.")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
            {resetResult?.actionLink && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Link de redefinição manual (válido por tempo limitado). Use somente se o e-mail não chegar.
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={resetResult.actionLink} className="font-mono text-xs" />
                  <Button size="icon" variant="outline" onClick={() => resetResult.actionLink && copyText(resetResult.actionLink, "Link copiado")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="p-6 pt-2">
            <Button onClick={() => setResetResult(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar solicitação?</DialogTitle>
            <DialogDescription>Opcionalmente, registre o motivo da rejeição.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo (opcional)"
            value={rejecting?.reason ?? ""}
            onChange={(e) => setRejecting((r) => (r ? { ...r, reason: e.target.value } : r))}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={rejectRequest}>Rejeitar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingReq} onOpenChange={(o) => !o && setEditingReq(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar solicitação</DialogTitle>
            <DialogDescription>
              Ajuste os dados antes de aprovar. O e-mail não pode ser alterado.
            </DialogDescription>
          </DialogHeader>
          {editingReq && (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <div className="space-y-2">
                <Label>Nome completo *</Label>
                <Input value={editingReq.full_name ?? ""} onChange={(e) => setEditingReq({ ...editingReq, full_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input type="email" value={editingReq.email ?? ""} disabled />
              </div>
              <div className="space-y-2">
                <Label>Telefone celular *</Label>
                <Input
                  inputMode="numeric"
                  placeholder="(11) 99999-9999"
                  value={formatPhone(editingReq.phone ?? "")}
                  onChange={(e) => setEditingReq({ ...editingReq, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Cargo *</Label>
                  <Input value={editingReq.role_title ?? ""} onChange={(e) => setEditingReq({ ...editingReq, role_title: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Setor *</Label>
                  <Input value={editingReq.department ?? ""} onChange={(e) => setEditingReq({ ...editingReq, department: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Data de nascimento *</Label>
                <Input
                  type="date"
                  value={editingReq.birth_date ? String(editingReq.birth_date).slice(0, 10) : ""}
                  onChange={(e) => setEditingReq({ ...editingReq, birth_date: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingReq(null)} disabled={savingReq}>Cancelar</Button>
            <Button onClick={saveEditedRequest} disabled={savingReq}>{savingReq ? "Salvando..." : "Salvar alterações"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!notifyingUser} onOpenChange={(o) => !o && setNotifyingUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Notificações — {notifyingUser?.name}</DialogTitle>
            <DialogDescription>
              Configure quais avisos este usuário deve receber.
            </DialogDescription>
          </DialogHeader>
          
          {loadingSettings ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-4 py-2">
              {userSettings.map((s) => (
                <div key={s.event_type} className="p-3 border rounded-lg space-y-3">
                  <h4 className="text-sm font-medium">{EVENT_LABELS[s.event_type] || s.event_type}</h4>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id={`${s.event_type}-email`} 
                        checked={s.email_enabled} 
                        onCheckedChange={(val) => toggleUserSetting(s.event_type, 'email_enabled', !!val)} 
                      />
                      <Label htmlFor={`${s.event_type}-email`} className="text-xs font-normal cursor-pointer">E-mail</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id={`${s.event_type}-whatsapp`} 
                        checked={s.whatsapp_enabled} 
                        onCheckedChange={(val) => toggleUserSetting(s.event_type, 'whatsapp_enabled', !!val)} 
                      />
                      <Label htmlFor={`${s.event_type}-whatsapp`} className="text-xs font-normal cursor-pointer">WhatsApp</Label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <DialogFooter>
            <Button onClick={() => setNotifyingUser(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default Users;