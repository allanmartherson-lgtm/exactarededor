import { useEffect, useMemo, useState } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Wand2, Plus, Pencil, Lock, Trash2, ClipboardList } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type Category = "reclassificacao_clinica" | "aceite_financeiro" | "operacional";
type FinancialImpact = "economia" | "perda" | "neutro";
type AppliesTo = "manual" | "acatar" | "excluir" | "editar";

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
  financial_impact: FinancialImpact;
  applies_to: AppliesTo[];
};

const empty: Row = {
  code: "",
  label: "",
  description: "",
  category: "aceite_financeiro",
  sort_order: 50,
  is_active: true,
  is_seed: false,
  hospital_id: null,
  financial_impact: "neutro",
  applies_to: ["manual"],
};

const CATEGORY_LABEL: Record<Category, string> = {
  reclassificacao_clinica: "Reclassificação clínica",
  aceite_financeiro: "Aceite financeiro",
  operacional: "Operacional",
};

const IMPACT_LABEL: Record<FinancialImpact, string> = {
  economia: "Economia",
  perda: "Perda",
  neutro: "Neutro",
};

const APPLIES_TO_LABEL: Record<AppliesTo, string> = {
  manual: "Manual",
  acatar: "Acatar",
  excluir: "Excluir",
  editar: "Editar",
};

const ALL_APPLIES_TO: AppliesTo[] = ["manual", "acatar", "excluir", "editar"];

function ImpactBadge({ impact }: { impact: FinancialImpact }) {
  const cls =
    impact === "economia"
      ? "bg-success/10 text-success border-success/30"
      : impact === "perda"
        ? "bg-destructive/10 text-destructive border-destructive/30"
        : "bg-muted text-muted-foreground border-muted-foreground/20";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        cls,
      )}
    >
      {IMPACT_LABEL[impact]}
    </span>
  );
}

function AppliesChips({ items }: { items: AppliesTo[] }) {
  if (!items?.length)
    return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((a) => (
        <span
          key={a}
          className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium"
        >
          {APPLIES_TO_LABEL[a]}
        </span>
      ))}
    </div>
  );
}

export default function ManualInterventionReasons({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const [list, setList] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Row | null>(null);

  // filtros
  const [filterCat, setFilterCat] = useState<"all" | Category>("all");
  const [filterImpact, setFilterImpact] = useState<"all" | FinancialImpact>(
    "all",
  );
  const [showInactive, setShowInactive] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("manual_intervention_reasons")
      .select(
        "id,code,label,description,category,sort_order,is_active,is_seed,hospital_id,financial_impact,applies_to",
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

  const toggleApplies = (a: AppliesTo) => {
    if (!editing) return;
    const has = editing.applies_to?.includes(a);
    setEditing({
      ...editing,
      applies_to: has
        ? editing.applies_to.filter((x) => x !== a)
        : [...(editing.applies_to ?? []), a],
    });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.code.trim() || !editing.label.trim()) {
      toast.error("Código e rótulo são obrigatórios");
      return;
    }
    if (!editing.applies_to || editing.applies_to.length === 0) {
      toast.error("Selecione ao menos uma ação em 'Aplica-se a'");
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
        financial_impact: editing.financial_impact,
        applies_to: editing.applies_to,
      };
      if (isNew) {
        const { error } = await supabase
          .from("manual_intervention_reasons")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .insert({ ...payload, created_by: user?.id ?? null } as any);
        if (error) throw error;
        toast.success("Motivo criado");
      } else {
        const { error } = await supabase
          .from("manual_intervention_reasons")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(payload as any)
          .eq("id", editing.id!);
        if (error) throw error;
        toast.success("Motivo atualizado");
      }
      setEditing(null);
      await load();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error("Falha ao salvar: " + (e?.message ?? String(e)));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r: Row) => {
    const { error } = await supabase
      .from("manual_intervention_reasons")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ is_active: !r.is_active } as any)
      .eq("id", r.id!);
    if (error) toast.error("Falha: " + error.message);
    else load();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const { error } = await supabase
      .from("manual_intervention_reasons")
      .delete()
      .eq("id", toDelete.id!);
    if (error) toast.error("Falha ao excluir: " + error.message);
    else {
      toast.success("Motivo excluído");
      load();
    }
    setToDelete(null);
  };

  const filtered = useMemo(() => {
    return list.filter((r) => {
      if (filterCat !== "all" && r.category !== filterCat) return false;
      if (filterImpact !== "all" && r.financial_impact !== filterImpact)
        return false;
      if (!showInactive && !r.is_active) return false;
      return true;
    });
  }, [list, filterCat, filterImpact, showInactive]);

  const grouped: Record<Category, Row[]> = {
    reclassificacao_clinica: filtered.filter(
      (r) => r.category === "reclassificacao_clinica",
    ),
    aceite_financeiro: filtered.filter(
      (r) => r.category === "aceite_financeiro",
    ),
    operacional: filtered.filter((r) => r.category === "operacional"),
  };

  const body = (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
          <div className="min-w-[180px]">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Categoria
            </Label>
            <Select
              value={filterCat}
              onValueChange={(v) => setFilterCat(v as "all" | Category)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="aceite_financeiro">
                  Aceite financeiro
                </SelectItem>
                <SelectItem value="reclassificacao_clinica">
                  Reclassificação clínica
                </SelectItem>
                <SelectItem value="operacional">Operacional</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Impacto financeiro
            </Label>
            <Select
              value={filterImpact}
              onValueChange={(v) =>
                setFilterImpact(v as "all" | FinancialImpact)
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="economia">Economia</SelectItem>
                <SelectItem value="perda">Perda</SelectItem>
                <SelectItem value="neutro">Neutro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 h-9">
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              id="show-inactive"
            />
            <Label htmlFor="show-inactive" className="text-sm">
              Mostrar inativos
            </Label>
          </div>
          <div className="ml-auto">
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" /> Novo motivo
            </Button>
          </div>
        </div>

        {(["aceite_financeiro", "reclassificacao_clinica", "operacional"] as Category[]).map(
          (cat) => (
            <Card key={cat}>
              <CardHeader className="bg-primary text-primary-foreground rounded-t-lg py-3">
                <CardTitle className="text-sm uppercase tracking-wider">
                  {CATEGORY_LABEL[cat]}
                </CardTitle>
                <CardDescription className="text-primary-foreground/80 text-xs">
                  {cat === "reclassificacao_clinica"
                    ? "Motivos clínicos — item reclassificado, segue valor do convênio."
                    : cat === "aceite_financeiro"
                      ? "Motivos financeiros — analista aceita divergência conscientemente."
                      : "Motivos operacionais — erros de importação, cancelamentos, correções."}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <p className="text-sm text-muted-foreground p-4">
                    Carregando…
                  </p>
                ) : grouped[cat].length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">
                    Nenhum motivo nesta categoria.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr className="text-left">
                          <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider">
                            Rótulo
                          </th>
                          <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider">
                            Código
                          </th>
                          <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider">
                            Impacto
                          </th>
                          <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider">
                            Aplica-se a
                          </th>
                          <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider w-16">
                            Ordem
                          </th>
                          <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider w-24">
                            Ativo
                          </th>
                          <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider w-24 text-right">
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped[cat].map((r) => (
                          <tr
                            key={r.id}
                            className={cn(
                              "border-t hover:bg-muted/20",
                              !r.is_active && "opacity-50",
                            )}
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium">{r.label}</div>
                              {r.description && (
                                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {r.description}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <code className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  {r.code}
                                </code>
                                {r.is_seed && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Lock className="h-3 w-3 text-muted-foreground" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Motivo padrão do sistema.
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <ImpactBadge impact={r.financial_impact} />
                            </td>
                            <td className="px-3 py-2">
                              <AppliesChips items={r.applies_to ?? []} />
                            </td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {r.sort_order}
                            </td>
                            <td className="px-3 py-2">
                              <Switch
                                checked={r.is_active}
                                onCheckedChange={() => toggleActive(r)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => openEdit(r)}
                                  title="Editar"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                {r.is_seed ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          disabled
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[240px]">
                                      Este motivo é padrão do sistema e não pode
                                      ser excluído, mas pode ser desativado.
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setToDelete(r)}
                                    title="Excluir"
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ),
        )}

        {/* Dialog de edição */}
        <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {isNew ? "Novo motivo" : "Editar motivo"}
              </DialogTitle>
              <DialogDescription>
                Motivos categorizados que o analista escolhe ao intervir em um
                item (tratamento manual, acate, exclusão ou edição).
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
                      readOnly={!isNew && editing.is_seed}
                      className={
                        !isNew && editing.is_seed
                          ? "bg-muted cursor-not-allowed"
                          : ""
                      }
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
                <div className="grid grid-cols-2 gap-3">
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
                        <SelectItem value="aceite_financeiro">
                          Aceite financeiro
                        </SelectItem>
                        <SelectItem value="reclassificacao_clinica">
                          Reclassificação clínica
                        </SelectItem>
                        <SelectItem value="operacional">Operacional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Impacto financeiro</Label>
                    <Select
                      value={editing.financial_impact}
                      onValueChange={(v) =>
                        setEditing({
                          ...editing,
                          financial_impact: v as FinancialImpact,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="economia">
                          Economia (hospital paga menos)
                        </SelectItem>
                        <SelectItem value="perda">
                          Perda (hospital paga mais)
                        </SelectItem>
                        <SelectItem value="neutro">
                          Neutro (sem impacto)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Aplica-se a</Label>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {ALL_APPLIES_TO.map((a) => {
                      const active = editing.applies_to?.includes(a);
                      return (
                        <button
                          key={a}
                          type="button"
                          onClick={() => toggleApplies(a)}
                          className={cn(
                            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:bg-muted",
                          )}
                        >
                          {APPLIES_TO_LABEL[a]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Ações onde este motivo aparecerá para o analista.
                  </p>
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

        {/* Confirmação de exclusão */}
        <AlertDialog
          open={!!toDelete}
          onOpenChange={(v) => !v && setToDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir motivo?</AlertDialogTitle>
              <AlertDialogDescription>
                O motivo <strong>{toDelete?.label}</strong> será removido
                permanentemente. Itens que já usaram este motivo mantêm o
                histórico, mas ele não aparecerá mais para novas intervenções.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );

  if (embedded) return body;

  return (
    <div>
      <PageHeader
        title="Motivos de intervenção"
        description="Padroniza os motivos que o analista escolhe ao intervir em um item (tratamento manual, acate, exclusão ou edição)."
        icon={ClipboardList}
      />
      <div className="p-4 md:p-6">{body}</div>
    </div>
  );
}

// Compat: keep icon export where legacy imports may reference Wand2
export const _legacyIcon = Wand2;
