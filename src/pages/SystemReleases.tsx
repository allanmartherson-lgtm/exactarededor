import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Edit, Star, StarOff } from "lucide-react";
import type { SystemRelease } from "@/hooks/useSystemVersion";

const RELEASE_TYPES = ["major", "minor", "patch", "hotfix"] as const;

export default function SystemReleases() {
  const { user } = useAuth();
  const [items, setItems] = useState<SystemRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SystemRelease | null>(null);
  const [form, setForm] = useState({ version: "", title: "", changelog: "", release_type: "minor", is_current: false, published: true });

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("system_releases" as never).select("*").order("released_at", { ascending: false });
    setItems((data as SystemRelease[] | null) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm({ version: "", title: "", changelog: "", release_type: "minor", is_current: false, published: true });
    setOpen(true);
  }
  function openEdit(r: SystemRelease) {
    setEditing(r);
    setForm({
      version: r.version, title: r.title, changelog: r.changelog,
      release_type: r.release_type, is_current: r.is_current, published: r.published,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.version.trim() || !form.title.trim() || !form.changelog.trim()) {
      toast({ title: "Preencha versão, título e changelog", variant: "destructive" });
      return;
    }
    // Se vai marcar como atual, desmarca as outras primeiro
    if (form.is_current) {
      await supabase.from("system_releases" as never).update({ is_current: false } as never).eq("is_current", true);
    }
    const payload = { ...form, released_by: user?.id ?? null };
    const res = editing
      ? await supabase.from("system_releases" as never).update(payload as never).eq("id", editing.id)
      : await supabase.from("system_releases" as never).insert(payload as never);
    if (res.error) {
      toast({ title: "Erro ao salvar", description: res.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Release atualizada" : "Release criada" });
    setOpen(false);
    load();
  }

  async function setCurrent(r: SystemRelease) {
    await supabase.from("system_releases" as never).update({ is_current: false } as never).eq("is_current", true);
    await supabase.from("system_releases" as never).update({ is_current: true } as never).eq("id", r.id);
    toast({ title: `v${r.version} marcada como atual` });
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Versões do sistema"
        description="Controle de releases, changelog e versão ativa do Exacta."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Nova release</Button>}
      />

      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <div className="space-y-3">
        {items.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap mb-1">
                  <span className="font-mono text-base font-semibold">v{r.version}</span>
                  <Badge variant="outline">{r.release_type}</Badge>
                  {r.is_current && <Badge variant="default">Atual</Badge>}
                  {!r.published && <Badge variant="secondary">Rascunho</Badge>}
                </div>
                <p className="font-medium">{r.title}</p>
                <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground mt-1 line-clamp-3">{r.changelog}</pre>
              </div>
              <div className="flex gap-1">
                {!r.is_current ? (
                  <Button size="sm" variant="ghost" onClick={() => setCurrent(r)} title="Marcar como atual">
                    <Star className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled><StarOff className="h-4 w-4" /></Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Edit className="h-4 w-4" /></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Editar release" : "Nova release"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Versão (semver)</Label>
                <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="1.1.0" />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.release_type} onValueChange={(v) => setForm({ ...form, release_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RELEASE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Título</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Resumo curto do que mudou" />
            </div>
            <div>
              <Label>Changelog (Markdown)</Label>
              <Textarea value={form.changelog} onChange={(e) => setForm({ ...form, changelog: e.target.value })} rows={10} className="font-mono text-sm" />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.is_current} onCheckedChange={(v) => setForm({ ...form, is_current: v })} />
                Marcar como versão atual
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.published} onCheckedChange={(v) => setForm({ ...form, published: v })} />
                Publicada
              </label>
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
