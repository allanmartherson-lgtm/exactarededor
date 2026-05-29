import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2 } from "lucide-react";

type Announcement = {
  id: string;
  title: string | null;
  message: string;
  severity: "info" | "warning" | "critical" | "success";
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  dismissible: boolean;
};

const SEVERITIES = ["info", "success", "warning", "critical"] as const;

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export default function SystemAnnouncementsAdmin() {
  const { user } = useAuth();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState({
    title: "", message: "", severity: "info" as Announcement["severity"],
    active: true, dismissible: true, starts_at: "", ends_at: "",
  });

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("system_announcements" as never).select("*").order("created_at", { ascending: false });
    setItems((data as Announcement[] | null) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm({ title: "", message: "", severity: "info", active: true, dismissible: true, starts_at: toLocalInput(new Date().toISOString()), ends_at: "" });
    setOpen(true);
  }
  function openEdit(a: Announcement) {
    setEditing(a);
    setForm({
      title: a.title ?? "", message: a.message, severity: a.severity,
      active: a.active, dismissible: a.dismissible,
      starts_at: toLocalInput(a.starts_at), ends_at: toLocalInput(a.ends_at),
    });
    setOpen(true);
  }

  async function save() {
    if (!form.message.trim()) { toast({ title: "Mensagem obrigatória", variant: "destructive" }); return; }
    const payload = {
      title: form.title || null, message: form.message, severity: form.severity,
      active: form.active, dismissible: form.dismissible,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : new Date().toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      created_by: user?.id ?? null,
    };
    const res = editing
      ? await supabase.from("system_announcements" as never).update(payload as never).eq("id", editing.id)
      : await supabase.from("system_announcements" as never).insert(payload as never);
    if (res.error) { toast({ title: "Erro", description: res.error.message, variant: "destructive" }); return; }
    toast({ title: "Salvo" });
    setOpen(false); load();
  }

  async function toggle(a: Announcement) {
    await supabase.from("system_announcements" as never).update({ active: !a.active } as never).eq("id", a.id);
    load();
  }
  async function remove(a: Announcement) {
    if (!confirm("Remover aviso?")) return;
    await supabase.from("system_announcements" as never).delete().eq("id", a.id);
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Avisos do sistema"
        description="Banner global exibido no topo de todas as telas. Útil para manutenção, releases ou comunicados urgentes."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo aviso</Button>}
      />

      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <div className="space-y-2">
        {items.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge>{a.severity}</Badge>
                  <Badge variant={a.active ? "default" : "secondary"}>{a.active ? "Ativo" : "Inativo"}</Badge>
                  {a.ends_at && new Date(a.ends_at) < new Date() && <Badge variant="outline">Expirado</Badge>}
                </div>
                {a.title && <p className="font-medium">{a.title}</p>}
                <p className="text-sm text-muted-foreground">{a.message}</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={a.active} onCheckedChange={() => toggle(a)} />
                <Button size="sm" variant="ghost" onClick={() => openEdit(a)}><Edit className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(a)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Editar aviso" : "Novo aviso"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Título (opcional)</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label>Mensagem</Label>
              <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Severidade</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as Announcement["severity"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /> Ativo
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.dismissible} onCheckedChange={(v) => setForm({ ...form, dismissible: v })} /> Dispensável
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Início</Label>
                <Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              </div>
              <div>
                <Label>Fim (opcional)</Label>
                <Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
