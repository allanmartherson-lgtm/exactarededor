/**
 * Modelos de Repasse — fundação (Onda 1)
 *
 * CRUD de "receitas" de cálculo de pagamento manual por equipe (escopo
 * hospital + tipo de pagamento + empresa opcional). Substitui a tentação
 * de criar telas/tabelas específicas por especialidade (fisio, oncologia,
 * plantão fechado, etc.) — cada equipe nova vira 1 linha aqui + suas rubricas.
 *
 * NÃO inclui o motor de aplicação do modelo (Onda 2) nem leitura no
 * lançamento manual — apenas o cadastro.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Loader2, FileText, Layers } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CompanyCombobox } from "@/components/CompanyCombobox";

// ---------- tipos ----------
type RubricKind =
  | "base_producao"
  | "base_fixa"
  | "desconto_pct"
  | "desconto_valor"
  | "acrescimo_pct"
  | "acrescimo_valor"
  | "acrescimo_faixa"
  | "retencao_pct";

const RUBRIC_KIND_LABEL: Record<RubricKind, string> = {
  base_producao: "Base de produção (entrada manual)",
  base_fixa: "Base fixa (valor cadastrado)",
  desconto_pct: "Desconto %",
  desconto_valor: "Desconto valor",
  acrescimo_pct: "Acréscimo %",
  acrescimo_valor: "Acréscimo valor",
  acrescimo_faixa: "Acréscimo por faixa (tabela)",
  retencao_pct: "Retenção % (TRD/imposto)",
};

type IncideSobre = "bruto" | "subtotal_anterior" | "rubrica_especifica";

interface PayoutModel {
  id: string;
  hospital_id: string;
  payment_type_id: string | null;
  company_id: string | null;
  name: string;
  description: string | null;
  version: number;
  active: boolean;
  effective_from: string | null;
  effective_to: string | null;
}

interface PayoutRubric {
  id?: string;
  model_id?: string;
  sort_order: number;
  kind: RubricKind;
  label: string;
  incide_sobre: IncideSobre | null;
  ref_rubric_order: number | null;
  param_key: string | null;
  fixed_pct: number | null;
  fixed_value: number | null;
  tier_table_id: string | null;
  convenio_slug: string | null;
  required: boolean;
  notes: string | null;
}

interface TierTable {
  id: string;
  name: string;
  dimension: string;
}

// ---------- página ----------
export default function PayoutModels({ embedded = false }: { embedded?: boolean } = {}) {
  const { roles } = useAuth() as { roles?: string[] };
  const { hospital } = useHospital();
  const canManage = !!roles?.some((r) => r === "admin" || r === "diretor");
  const { list: paymentTypes } = usePaymentTypes({ onlyActive: true });

  const [models, setModels] = useState<PayoutModel[]>([]);
  const [tierTables, setTierTables] = useState<TierTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PayoutModel | null>(null);
  const [editingCompany, setEditingCompany] = useState<{ id: string; name: string; document: string | null } | null>(null);
  const [editingRubrics, setEditingRubrics] = useState<PayoutRubric[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!hospital?.id) return;
    setLoading(true);
    const [{ data: ms }, { data: tt }] = await Promise.all([
      supabase
        .from("payout_models" as any)
        .select("*")
        .eq("hospital_id", hospital.id)
        .order("active", { ascending: false })
        .order("name"),
      supabase
        .from("payout_tier_tables" as any)
        .select("id,name,dimension")
        .or(`hospital_id.eq.${hospital.id},hospital_id.is.null`)
        .eq("active", true)
        .order("name"),
    ]);
    setModels((ms ?? []) as any);
    setTierTables((tt ?? []) as any);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospital?.id]);

  const openNew = () => {
    if (!hospital?.id) return;
    setEditing({
      id: "",
      hospital_id: hospital.id,
      payment_type_id: null,
      company_id: null,
      name: "",
      description: "",
      version: 1,
      active: true,
      effective_from: null,
      effective_to: null,
    });
    setEditingRubrics([]);
    setDialogOpen(true);
  };

  const openEdit = async (m: PayoutModel) => {
    setEditing(m);
    const { data } = await supabase
      .from("payout_model_rubrics" as any)
      .select("*")
      .eq("model_id", m.id)
      .order("sort_order");
    setEditingRubrics((data ?? []) as any);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!editing || !editing.name.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    setSaving(true);
    let modelId = editing.id;
    if (!modelId) {
      const { data, error } = await supabase
        .from("payout_models" as any)
        .insert({
          hospital_id: editing.hospital_id,
          payment_type_id: editing.payment_type_id,
          company_id: editing.company_id,
          name: editing.name.trim(),
          description: editing.description?.trim() || null,
          active: editing.active,
          effective_from: editing.effective_from,
          effective_to: editing.effective_to,
        })
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Erro ao criar modelo", description: error?.message, variant: "destructive" });
        return;
      }
      modelId = (data as any).id;
    } else {
      const { error } = await supabase
        .from("payout_models" as any)
        .update({
          payment_type_id: editing.payment_type_id,
          company_id: editing.company_id,
          name: editing.name.trim(),
          description: editing.description?.trim() || null,
          active: editing.active,
          effective_from: editing.effective_from,
          effective_to: editing.effective_to,
          version: editing.version + 1,
        })
        .eq("id", modelId);
      if (error) {
        setSaving(false);
        toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
        return;
      }
    }

    // Estratégia simples: apaga rubricas e re-insere (cadastro raro, alto controle).
    await supabase.from("payout_model_rubrics" as any).delete().eq("model_id", modelId);
    if (editingRubrics.length > 0) {
      const rows = editingRubrics.map((r, idx) => ({
        model_id: modelId,
        sort_order: idx + 1,
        kind: r.kind,
        label: r.label,
        incide_sobre: r.incide_sobre,
        ref_rubric_order: r.ref_rubric_order,
        param_key: r.param_key,
        fixed_pct: r.fixed_pct,
        fixed_value: r.fixed_value,
        tier_table_id: r.tier_table_id,
        convenio_slug: r.convenio_slug,
        required: r.required,
        notes: r.notes,
      }));
      const { error } = await supabase.from("payout_model_rubrics" as any).insert(rows);
      if (error) {
        setSaving(false);
        toast({ title: "Erro ao salvar rubricas", description: error.message, variant: "destructive" });
        return;
      }
    }

    setSaving(false);
    setDialogOpen(false);
    toast({ title: "Modelo salvo" });
    reload();
  };

  const remove = async (m: PayoutModel) => {
    if (!confirm(`Inativar o modelo "${m.name}"?`)) return;
    await supabase.from("payout_models" as any).update({ active: false }).eq("id", m.id);
    reload();
  };

  const addRubric = () => {
    setEditingRubrics((prev) => [
      ...prev,
      {
        sort_order: prev.length + 1,
        kind: "base_producao",
        label: "",
        incide_sobre: "subtotal_anterior",
        ref_rubric_order: null,
        param_key: null,
        fixed_pct: null,
        fixed_value: null,
        tier_table_id: null,
        convenio_slug: null,
        required: true,
        notes: null,
      },
    ]);
  };

  const updateRubric = (idx: number, patch: Partial<PayoutRubric>) => {
    setEditingRubrics((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRubric = (idx: number) => {
    setEditingRubrics((prev) => prev.filter((_, i) => i !== idx));
  };

  const paymentTypeLabel = (id: string | null) =>
    paymentTypes.find((p) => p.id === id)?.label ?? "—";

  const content = (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Receitas de cálculo para lançamentos manuais (ex.: Fisio HDF, plantão fechado, oncologia).
          Cada modelo é uma lista ordenada de <span className="font-medium">rubricas</span> que somam/subtraem
          até o valor a faturar em NF.
        </p>
        {canManage && (
          <Button size="sm" onClick={openNew} disabled={!hospital?.id}>
            <Plus className="h-4 w-4 mr-1" /> Novo modelo
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
            </div>
          ) : models.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum modelo cadastrado neste hospital.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo de pagamento</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="text-center">Versão</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{paymentTypeLabel(m.payment_type_id)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.company_id ? "específico" : "qualquer empresa"}
                    </TableCell>
                    <TableCell className="text-center text-xs">v{m.version}</TableCell>
                    <TableCell className="text-center">
                      {m.active ? (
                        <span className="text-xs text-success">Sim</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Inativo</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {canManage && m.active && (
                        <Button variant="ghost" size="icon" onClick={() => remove(m)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4" /> Como funciona
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>
            <span className="font-medium text-foreground">Tipos de rubrica:</span> base (entrada manual ou
            valor fixo), desconto (% ou valor), acréscimo (% / valor / faixa de tabela) e retenção (% no final).
          </p>
          <p>
            <span className="font-medium text-foreground">Incidência:</span> cada rubrica % aponta sobre o que
            incide — bruto, subtotal anterior ou uma rubrica específica.
          </p>
          <p>
            <span className="font-medium text-foreground">Reuso:</span> glosa média e TRD podem vir de
            <code className="px-1">system_parameter_defs</code> via <code className="px-1">param_key</code> — mude
            no parâmetro e todo modelo que aponta atualiza.
          </p>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full">
      {!embedded && (
        <PageHeader
          title="Modelos de Repasse"
          description="Receitas de cálculo para lançamentos manuais por equipe."
          icon={FileText}
        />
      )}
      <div className={embedded ? "w-full" : "p-4 md:p-8 w-full"}>{content}</div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar modelo" : "Novo modelo de repasse"}</DialogTitle>
            <DialogDescription>
              Cada salvamento incrementa a versão. Pagamentos antigos preservam a versão usada no
              <code className="px-1">payout_breakdown</code>.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-5">
              {/* Cabeçalho */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nome *</Label>
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Ex.: Fisio HDF — repasse mensal"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo de pagamento</Label>
                  <Select
                    value={editing.payment_type_id ?? "none"}
                    onValueChange={(v) =>
                      setEditing({ ...editing, payment_type_id: v === "none" ? null : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Qualquer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Qualquer tipo</SelectItem>
                      {paymentTypes.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Empresa (opcional)</Label>
                  <CompanyCombobox
                    value={editing.company_id ?? null}
                    onChange={(v) => setEditing({ ...editing, company_id: v })}
                    placeholder="Qualquer empresa do tipo selecionado"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Vigência início</Label>
                  <Input
                    type="date"
                    value={editing.effective_from ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, effective_from: e.target.value || null })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Vigência fim</Label>
                  <Input
                    type="date"
                    value={editing.effective_to ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, effective_to: e.target.value || null })
                    }
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Descrição</Label>
                  <Textarea
                    rows={2}
                    value={editing.description ?? ""}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="Contexto do acordo, referência contratual, observações."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editing.active}
                    onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                  />
                  <Label>Ativo</Label>
                </div>
              </div>

              {/* Rubricas */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Rubricas (em ordem de cálculo)</h3>
                  <Button size="sm" variant="outline" onClick={addRubric}>
                    <Plus className="h-3 w-3 mr-1" /> Adicionar rubrica
                  </Button>
                </div>

                {editingRubrics.length === 0 ? (
                  <div className="text-xs text-muted-foreground border border-dashed rounded p-4 text-center">
                    Nenhuma rubrica. Comece adicionando as bases de produção, depois descontos e
                    retenções.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {editingRubrics.map((r, idx) => (
                      <RubricEditor
                        key={idx}
                        index={idx}
                        rubric={r}
                        tierTables={tierTables}
                        onChange={(patch) => updateRubric(idx, patch)}
                        onRemove={() => removeRubric(idx)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving || !canManage}>
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- editor de rubrica ----------
function RubricEditor({
  index,
  rubric,
  tierTables,
  onChange,
  onRemove,
}: {
  index: number;
  rubric: PayoutRubric;
  tierTables: TierTable[];
  onChange: (patch: Partial<PayoutRubric>) => void;
  onRemove: () => void;
}) {
  const isPct = rubric.kind.endsWith("_pct");
  const isValor = rubric.kind === "desconto_valor" || rubric.kind === "acrescimo_valor" || rubric.kind === "base_fixa";
  const isFaixa = rubric.kind === "acrescimo_faixa";
  const isBase = rubric.kind === "base_producao" || rubric.kind === "base_fixa";

  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
        <Button variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select value={rubric.kind} onValueChange={(v) => onChange({ kind: v as RubricKind })}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RUBRIC_KIND_LABEL) as RubricKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {RUBRIC_KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Rótulo</Label>
          <Input
            className="h-8 text-sm"
            value={rubric.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Ex.: Produção Sul América"
          />
        </div>

        {!isBase && (
          <div>
            <Label className="text-xs">Incide sobre</Label>
            <Select
              value={rubric.incide_sobre ?? "subtotal_anterior"}
              onValueChange={(v) => onChange({ incide_sobre: v as IncideSobre })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bruto">Bruto (soma das bases)</SelectItem>
                <SelectItem value="subtotal_anterior">Subtotal anterior</SelectItem>
                <SelectItem value="rubrica_especifica">Rubrica específica</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {rubric.incide_sobre === "rubrica_especifica" && (
          <div>
            <Label className="text-xs">Nº da rubrica de referência</Label>
            <Input
              type="number"
              className="h-8 text-sm"
              value={rubric.ref_rubric_order ?? ""}
              onChange={(e) =>
                onChange({ ref_rubric_order: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>
        )}

        {isPct && (
          <>
            <div>
              <Label className="text-xs">% fixo (opcional)</Label>
              <Input
                type="number"
                step="0.01"
                className="h-8 text-sm"
                value={rubric.fixed_pct ?? ""}
                onChange={(e) =>
                  onChange({ fixed_pct: e.target.value ? Number(e.target.value) : null })
                }
                placeholder="Ex.: 10"
              />
            </div>
            <div>
              <Label className="text-xs">Param key (alternativa)</Label>
              <Input
                className="h-8 text-sm"
                value={rubric.param_key ?? ""}
                onChange={(e) => onChange({ param_key: e.target.value || null })}
                placeholder="repasse.glosa_media"
              />
            </div>
          </>
        )}

        {isValor && (
          <div>
            <Label className="text-xs">Valor fixo</Label>
            <Input
              type="number"
              step="0.01"
              className="h-8 text-sm"
              value={rubric.fixed_value ?? ""}
              onChange={(e) =>
                onChange({ fixed_value: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>
        )}

        {isFaixa && (
          <div className="md:col-span-2">
            <Label className="text-xs">Tabela de faixas</Label>
            <Select
              value={rubric.tier_table_id ?? ""}
              onValueChange={(v) => onChange({ tier_table_id: v || null })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Selecionar tabela" />
              </SelectTrigger>
              <SelectContent>
                {tierTables.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    Nenhuma tabela cadastrada
                  </SelectItem>
                ) : (
                  tierTables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.dimension})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="md:col-span-2">
          <Label className="text-xs">Convênio (opcional — restringe a base/rubrica)</Label>
          <Input
            className="h-8 text-sm"
            value={rubric.convenio_slug ?? ""}
            onChange={(e) => onChange({ convenio_slug: e.target.value || null })}
            placeholder="sul_america, bradesco_segur, particular…"
          />
        </div>
      </div>
    </div>
  );
}
