// Página /diretores — cadastro dos diretores autorizados a aprovar pagamentos.
// É usada pelo motor de leitura de aprovações por e-mail (parse-email-approval)
// para validar se quem assinou o e-mail está autorizado.
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, ShieldCheck, Mail, Loader2 } from "lucide-react";

type Director = {
  id: string;
  hospital_id: string;
  full_name: string;
  email: string;
  role_label: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
};

const empty = (hid: string): Partial<Director> => ({
  hospital_id: hid, full_name: "", email: "", role_label: "Diretor", active: true, notes: "",
});

export default function Directors() {
  const { user, hasRole } = useAuth();
  const { hospital } = useHospital();
  const canManage = hasRole("admin") || hasRole("diretor");
  const [list, setList] = useState<Director[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Director> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!hospital) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("hospital_directors")
      .select("*")
      .eq("hospital_id", hospital.id)
      .order("active", { ascending: false })
      .order("full_name");
    setLoading(false);
    if (error) { toast.error("Falha ao carregar diretores: " + error.message); return; }
    setList((data ?? []) as Director[]);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [hospital?.id]);

  const startCreate = () => { setDraft(empty(hospital!.id)); setOpen(true); };
  const startEdit = (d: Director) => { setDraft({ ...d }); setOpen(true); };

  const save = async () => {
    if (!draft || !user || !hospital) return;
    const name = (draft.full_name ?? "").trim();
    const email = (draft.email ?? "").trim().toLowerCase();
    if (!name || !email) { toast.error("Nome e e-mail são obrigatórios."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("E-mail inválido."); return; }
    setSaving(true);
    const payload = {
      hospital_id: hospital.id,
      full_name: name,
      email,
      role_label: draft.role_label ?? null,
      active: draft.active ?? true,
      notes: draft.notes ?? null,
    };
    const { error } = draft.id
      ? await supabase.from("hospital_directors").update(payload).eq("id", draft.id)
      : await supabase.from("hospital_directors").insert({ ...payload, created_by: user.id });
    setSaving(false);
    if (error) {
      const msg = error.message.includes("uq_hospital_directors_email")
        ? "Já existe um diretor cadastrado com este e-mail neste hospital."
        : error.message;
      toast.error(msg);
      return;
    }
    toast.success(draft.id ? "Diretor atualizado" : "Diretor cadastrado");
    setOpen(false); setDraft(null);
    void load();
  };

  const remove = async (d: Director) => {
    const ok = await confirmDialog({
      title: "Inativar diretor?",
      description: `${d.full_name} (${d.email}) deixará de validar aprovações por e-mail.`,
      details: "O cadastro não é apagado — só desativado. Você pode reativar depois.",
      confirmText: "Inativar",
      tone: "warning",
    });
    if (!ok) return;
    const { error } = await supabase.from("hospital_directors").update({ active: false }).eq("id", d.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Diretor inativado");
    void load();
  };

  return (
    <div className="container mx-auto p-6 space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Diretores autorizados
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastre os diretores que podem aprovar pagamentos. O sistema usa esta lista para validar
            automaticamente as <strong>aprovações anexadas por e-mail</strong> (PDF ou print).
          </p>
        </div>
        {canManage && (
          <Button onClick={startCreate} disabled={!hospital}>
            <Plus className="h-4 w-4 mr-2" /> Novo diretor
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {hospital?.name ?? "—"} {list.length > 0 && <Badge variant="secondary" className="ml-2">{list.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
            </div>
          ) : list.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhum diretor cadastrado ainda. Sem cadastro, toda aprovação por e-mail é marcada como divergente.
            </div>
          ) : (
            <div className="divide-y">
              {list.map((d) => (
                <div key={d.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{d.full_name}</span>
                      {d.role_label && <Badge variant="outline" className="text-[10px]">{d.role_label}</Badge>}
                      {!d.active && <Badge variant="secondary" className="text-[10px]">Inativo</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Mail className="h-3 w-3" /> {d.email}
                    </div>
                    {d.notes && <div className="text-xs text-muted-foreground mt-1 italic">{d.notes}</div>}
                  </div>
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => startEdit(d)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {d.active && (
                        <Button size="sm" variant="ghost" onClick={() => remove(d)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDraft(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Editar diretor" : "Novo diretor"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label>Nome completo *</Label>
                <Input value={draft.full_name ?? ""} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} placeholder="Ex: Dr. João Silva" />
              </div>
              <div className="space-y-1">
                <Label>E-mail *</Label>
                <Input type="email" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="diretor@hospital.com.br" />
                <p className="text-[11px] text-muted-foreground">Usado para cruzar com o remetente do e-mail de aprovação.</p>
              </div>
              <div className="space-y-1">
                <Label>Cargo / rótulo</Label>
                <Input value={draft.role_label ?? ""} onChange={(e) => setDraft({ ...draft, role_label: e.target.value })} placeholder="Diretor Clínico, CEO, etc." />
              </div>
              <div className="space-y-1">
                <Label>Observações</Label>
                <Input value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Opcional" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={draft.active ?? true} onCheckedChange={(v) => setDraft({ ...draft, active: v })} />
                <Label className="text-sm">Ativo</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
