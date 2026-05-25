import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Tag, Plus, Pencil } from "lucide-react";

type PT = {
  id?: string;
  code: string;
  label: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
};

const empty: PT = { code: "", label: "", description: "", color: "", sort_order: 50, active: true };

export default function PaymentTypes() {
  const [list, setList] = useState<PT[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PT | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("payment_types").select("*").order("sort_order").order("label");
    if (error) toast.error("Erro ao carregar tipos: " + error.message);
    else setList((data ?? []) as PT[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing({ ...empty }); setIsNew(true); };
  const openEdit = (p: PT) => { setEditing({ ...p }); setIsNew(false); };

  const save = async () => {
    if (!editing) return;
    const code = editing.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!code || !editing.label.trim()) { toast.error("Código e rótulo são obrigatórios"); return; }
    setSaving(true);
    const payload = {
      code,
      label: editing.label.trim(),
      description: editing.description?.trim() || null,
      color: editing.color?.trim() || null,
      sort_order: Number(editing.sort_order) || 50,
      active: editing.active,
    };
    const { error } = isNew
      ? await supabase.from("payment_types").insert(payload)
      : await supabase.from("payment_types").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success(isNew ? "Tipo criado" : "Tipo atualizado");
    setEditing(null);
    load();
  };

  const toggleActive = async (p: PT) => {
    const { error } = await supabase.from("payment_types").update({ active: !p.active }).eq("id", p.id!);
    if (error) toast.error("Erro: " + error.message);
    else load();
  };

  return (
    <>
      <PageHeader
        title="Tipos de pagamento"
        description="Gerencie os tipos de pagamento usados nos lotes (produção, plantão, remessa, valor fixo etc.)."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo tipo</Button>}
      />
      <div className="p-8 max-w-5xl space-y-4">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" /> Tipos cadastrados</CardTitle>
            <CardDescription>
              O código é usado internamente nos lotes e nas regras. Mudanças de rótulo refletem em todo o sistema.
              Desativar um tipo impede que ele seja escolhido em novos lotes, mas preserva o histórico.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum tipo cadastrado.</p>
            ) : (
              <div className="space-y-2">
                {list.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.label}</span>
                        <Badge variant="outline" className="font-mono text-xs">{p.code}</Badge>
                        {!p.active && <Badge variant="secondary" className="text-xs">inativo</Badge>}
                      </div>
                      {p.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} aria-label="Ativo" />
                      <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? "Novo tipo de pagamento" : "Editar tipo"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Código *</Label>
                  <Input
                    value={editing.code}
                    disabled={!isNew}
                    onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                    placeholder="ex: producao"
                  />
                  <p className="text-xs text-muted-foreground">Letras minúsculas, números e _. Não pode ser alterado depois.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Rótulo *</Label>
                  <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="ex: Produção" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={2}
                  placeholder="Como esse tipo é usado no fluxo"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Ordem de exibição</Label>
                  <Input
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Cor (opcional)</Label>
                  <Input
                    value={editing.color ?? ""}
                    onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                    placeholder="#3b82f6"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                <Label className="font-normal cursor-pointer">Ativo</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
