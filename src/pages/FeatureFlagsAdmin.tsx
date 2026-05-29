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
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2 } from "lucide-react";

type Flag = {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  allowed_roles: string[];
  rollout_pct: number;
  updated_at: string;
};

const ROLES = ["admin", "diretor", "validador", "analista"] as const;

export default function FeatureFlagsAdmin() {
  const { user } = useAuth();
  const [items, setItems] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Flag | null>(null);
  const [form, setForm] = useState({ key: "", description: "", enabled: false, allowed_roles: [] as string[], rollout_pct: 100 });

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("feature_flags" as never).select("*").order("key");
    setItems((data as Flag[] | null) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm({ key: "", description: "", enabled: false, allowed_roles: [], rollout_pct: 100 });
    setOpen(true);
  }
  function openEdit(f: Flag) {
    setEditing(f);
    setForm({ key: f.key, description: f.description ?? "", enabled: f.enabled, allowed_roles: f.allowed_roles, rollout_pct: f.rollout_pct });
    setOpen(true);
  }

  async function save() {
    if (!form.key.trim()) { toast({ title: "Informe a chave da flag", variant: "destructive" }); return; }
    const payload = { ...form, updated_by: user?.id ?? null };
    const res = editing
      ? await supabase.from("feature_flags" as never).update(payload as never).eq("id", editing.id)
      : await supabase.from("feature_flags" as never).insert(payload as never);
    if (res.error) { toast({ title: "Erro", description: res.error.message, variant: "destructive" }); return; }
    toast({ title: "Salvo" });
    setOpen(false); load();
  }

  async function toggleEnabled(f: Flag) {
    await supabase.from("feature_flags" as never).update({ enabled: !f.enabled, updated_by: user?.id ?? null } as never).eq("id", f.id);
    load();
  }

  async function remove(f: Flag) {
    if (!confirm(`Remover flag "${f.key}"?`)) return;
    await supabase.from("feature_flags" as never).delete().eq("id", f.id);
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature flags"
        description="Liga e desliga funcionalidades por role e rollout percentual sem precisar de novo deploy."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Nova flag</Button>}
      />

      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <div className="space-y-2">
        {items.map((f) => (
          <Card key={f.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <code className="font-mono text-sm font-semibold bg-muted px-1.5 py-0.5 rounded">{f.key}</code>
                  <Badge variant={f.enabled ? "default" : "secondary"}>{f.enabled ? "Ativa" : "Inativa"}</Badge>
                  {f.rollout_pct < 100 && <Badge variant="outline">{f.rollout_pct}% rollout</Badge>}
                  {f.allowed_roles.length > 0 && (
                    <Badge variant="outline">roles: {f.allowed_roles.join(", ")}</Badge>
                  )}
                </div>
                {f.description && <p className="text-sm text-muted-foreground">{f.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={f.enabled} onCheckedChange={() => toggleEnabled(f)} />
                <Button size="sm" variant="ghost" onClick={() => openEdit(f)}><Edit className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(f)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Editar flag" : "Nova flag"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Chave</Label>
              <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="ex: novo_dashboard_dinheiro" disabled={!!editing} />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div>
              <Label>Roles permitidas (vazio = todas)</Label>
              <div className="flex gap-2 flex-wrap mt-1">
                {ROLES.map((r) => {
                  const checked = form.allowed_roles.includes(r);
                  return (
                    <button key={r} type="button"
                      onClick={() => setForm({
                        ...form,
                        allowed_roles: checked ? form.allowed_roles.filter((x) => x !== r) : [...form.allowed_roles, r],
                      })}
                      className={`px-3 py-1 rounded border text-xs ${checked ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input"}`}>
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>Rollout: {form.rollout_pct}%</Label>
              <Slider value={[form.rollout_pct]} onValueChange={([v]) => setForm({ ...form, rollout_pct: v })} min={0} max={100} step={5} className="mt-2" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
              Ativa
            </label>
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
