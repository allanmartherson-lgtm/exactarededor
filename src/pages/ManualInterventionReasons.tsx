import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Wand2, Plus, Pencil, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type Category = "reclassificacao_clinica" | "aceite_financeiro";
type Row = {
  id?: string;
  code: string;
  label: string;
  description: string | null;
  category: Category;
  sort_order: number;
  is_active: boolean;
  is_seed: boolean;
  hospital_id: string | null;
};

const empty: Row = {
  code: "",
  label: "",
  description: "",
  category: "reclassificacao_clinica",
  sort_order: 50,
  is_active: true,
  is_seed: false,
  hospital_id: null,
};

const CATEGORY_LABEL: Record<Category, string> = {
  reclassificacao_clinica: "Reclassificação clínica",
  aceite_financeiro: "Aceite financeiro",
};

export default function ManualInterventionReasons({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const [list, setList] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("manual_intervention_reasons")
      .select(
        "id,code,label,description,category,sort_order,is_active,is_seed,hospital_id",
      )
      .order("category")
      .order("sort_order")
      .order("label");
    if (error) toast.error("Erro ao carregar motivos: " + error.message);
    else setList((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing({ ...empty });
    setIsNew(true);
  };

  const openEdit = (r: Row) => {
    setEditing({ ...r });
    setIsNew(false);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.code.trim() || !editing.label.trim()) {
      toast.error("Código e rótulo são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: editing.code.trim(),
        label: editing.label.trim(),
        description: editing.description?.trim() || null,
        category: editing.category,
        sort_order: editing.sort_order ?? 50,
        is_active: editing.is_active,
      };
      if (isNew) {
        const { error } = await supabase
          .from("manual_intervention_reasons")
          .insert({ ...payload, created_by: user?.id ?? null } as any);
        if (error) throw error;
        toast.success("Motivo criado");
      } else {
        const { error } = await supabase
          .from("manual_intervention_reasons")
          .update(payload as any)
          .eq("id", editing.id!);
        if (error) throw error;
        toast.success("Motivo atualizado");
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error("Falha ao salvar: " + (e?.message ?? String(e)));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r: Row) => {
    if (r.is_seed) {
      toast.error("Motivos padrão não podem ser desativados");
      return;
    }
    const { error } = await supabase
      .from("manual_intervention_reasons")
      .update({ is_active: !r.is_active } as any)
      .eq("id", r.id!);
    if (error) toast.error("Falha: " + error.message);
    else load();
  };

  const grouped: Record<Category, Row[]> = {
    reclassificacao_clinica: list.filter(
      (r) => r.category === "reclassificacao_clinica",
    ),
    aceite_financeiro: list.filter((r) => r.category === "aceite_financeiro"),
  };

  const body = (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Novo motivo
        </Button>
      </div>

      {(["reclassificacao_clinica", "aceite_financeiro"] as Category[]).map(
        (cat) => (
          <Card key={cat}>
            <CardHeader>
              <CardTitle className="text-base">{CATEGORY_LABEL[cat]}</CardTitle>
              <CardDescription>
                {cat === "reclassificacao_clinica"
                  ? "Motivos clínicos — item foi reclassificado e segue valor do convênio."
                  : "Motivos financeiros — aceitamos a divergência conscientemente."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : grouped[cat].length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum motivo.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {grouped[cat].map((r) => (
                    <li
                      key={r.id}
                      className="py-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{r.label}</span>
                          <code className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {r.code}
                          </code>
                          {r.is_seed && (
                            <Badge variant="secondary" className="gap-1">
                              <Lock className="h-3 w-3" /> Padrão
                            </Badge>
                          )}
                          {!r.is_active && (
                            <Badge variant="outline">Inativo</Badge>
                          )}
                        </div>
                        {r.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {r.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!r.is_seed && (
                          <Switch
                            checked={r.is_active}
                            onCheckedChange={() => toggleActive(r)}
                          />
                        )}
                        {!r.is_seed && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ),
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isNew ? "Novo motivo" : "Editar motivo"}
            </DialogTitle>
            <DialogDescription>
              Motivos categorizados que o analista escolhe ao tratar um item
              manualmente.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Código</Label>
                  <Input
                    value={editing.code}
                    onChange={(e) =>
                      setEditing({ ...editing, code: e.target.value })
                    }
                    placeholder="snake_case"
                  />
                </div>
                <div>
                  <Label>Ordem</Label>
                  <Input
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        sort_order: Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>Rótulo</Label>
                <Input
                  value={editing.label}
                  onChange={(e) =>
                    setEditing({ ...editing, label: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select
                  value={editing.category}
                  onValueChange={(v) =>
                    setEditing({ ...editing, category: v as Category })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reclassificacao_clinica">
                      Reclassificação clínica
                    </SelectItem>
                    <SelectItem value="aceite_financeiro">
                      Aceite financeiro
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Descrição (opcional)</Label>
                <Textarea
                  rows={3}
                  value={editing.description ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editing.is_active}
                  onCheckedChange={(v) =>
                    setEditing({ ...editing, is_active: v })
                  }
                />
                <Label>Ativo</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (embedded) return body;

  return (
    <div>
      <PageHeader
        title="Motivos de tratamento manual"
        description="Padroniza os motivos que o analista escolhe ao tratar um item manualmente."
        icon={Wand2}
      />
      <div className="p-4 md:p-6">{body}</div>
    </div>
  );
}
