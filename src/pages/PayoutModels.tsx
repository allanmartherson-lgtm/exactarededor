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
// Dialog primitives substituídos por FormDialog (alinhamento com cadastro de regras).
import { FormDialog } from "@/components/FormDialog";
import { RuleFormStepper } from "@/components/rules/RuleFormStepper";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Pencil, Trash2, Loader2, FileText, Layers, Check, ChevronsUpDown, X, Wand2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeConvenioSlugs, toggleConvenioSlug } from "@/lib/convenioMatching";
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

/** Texto explicativo curto exibido abaixo do select de Tipo. */
const RUBRIC_KIND_HELP: Record<RubricKind, string> = {
  base_producao:
    "O analista digita o valor no lançamento (ex.: produção do mês de Sul América). Soma ao bruto.",
  base_fixa:
    "Valor fixo cadastrado aqui — usado quando o repasse independe da produção (ex.: sessão fixa para Particular).",
  desconto_pct:
    "Subtrai um percentual aplicado sobre o que você escolher em 'Incide sobre' (bruto, subtotal anterior ou rubrica específica).",
  desconto_valor:
    "Subtrai um valor fixo do cálculo (ex.: ajuste contratual em R$).",
  acrescimo_pct:
    "Soma um percentual sobre o que você escolher em 'Incide sobre'.",
  acrescimo_valor:
    "Soma um valor fixo ao cálculo.",
  acrescimo_faixa:
    "Soma um valor lido de uma tabela de faixas (ex.: bônus por nº de atendimentos). Cadastre a tabela em Modelos de Repasse → Tabelas de Faixas.",
  retencao_pct:
    "Subtrai um percentual de retenção no final (ex.: TRD, ISS). Pode reusar valor cadastrado em Parâmetros do Sistema via 'Param key'.",
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
  convenio_slugs: string[];

  required: boolean;
  notes: string | null;
}

interface TierTable {
  id: string;
  name: string;
  dimension: string;
}

// ---------- wizard ----------
type WizardStep = "bases" | "ajustes" | "convenios" | "reuso";

const WIZARD_STEPS: { id: WizardStep; label: string; description: string }[] = [
  { id: "bases", label: "Bases", description: "Identifique o modelo e o que entra na conta." },
  { id: "ajustes", label: "Ajustes", description: "Descontos, acréscimos e retenções." },
  { id: "convenios", label: "Convênios", description: "A quais convênios cada rubrica se refere." },
  { id: "reuso", label: "Reuso & Revisão", description: "% fixo ou param key, e revisão final." },
];

const BASE_KINDS: RubricKind[] = ["base_producao", "base_fixa"];
const AJUSTE_KINDS: RubricKind[] = [
  "desconto_pct",
  "desconto_valor",
  "acrescimo_pct",
  "acrescimo_valor",
  "acrescimo_faixa",
  "retencao_pct",
];
const isBaseKind = (k: RubricKind) => BASE_KINDS.includes(k);
const isPctKind = (k: RubricKind) => k.endsWith("_pct");

const normalizeLookup = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const findConvenioSlug = (
  convenios: Array<{ slug: string; name: string }>,
  aliases: string[],
) => {
  const normalizedAliases = aliases.map(normalizeLookup);
  return convenios.find((c) => {
    const haystack = normalizeLookup(`${c.name} ${c.slug}`);
    return normalizedAliases.some((alias) => haystack.includes(alias));
  })?.slug;
};


// ---------- página ----------
export default function PayoutModels({ embedded = false }: { embedded?: boolean } = {}) {
  const { roles } = useAuth() as { roles?: string[] };
  const { hospital } = useHospital();
  const canManage = !!roles?.some((r) => r === "admin" || r === "diretor");
  const { list: paymentTypes } = usePaymentTypes({ onlyActive: true });

  const [models, setModels] = useState<PayoutModel[]>([]);
  const [tierTables, setTierTables] = useState<TierTable[]>([]);
  const [convenios, setConvenios] = useState<Array<{ slug: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PayoutModel | null>(null);
  const [editingCompany, setEditingCompany] = useState<{ id: string; name: string; document: string | null } | null>(null);
  const [editingRubrics, setEditingRubrics] = useState<PayoutRubric[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Navegação entre etapas é controlada internamente pelo RuleFormStepper.


  const reload = async () => {
    if (!hospital?.id) return;
    setLoading(true);
    const [{ data: ms }, { data: tt }, { data: cv }] = await Promise.all([
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
      supabase
        .from("convenios")
        .select("slug,name")
        .eq("active", true)
        .order("name"),
    ]);
    setModels((ms ?? []) as any);
    setTierTables((tt ?? []) as any);
    setConvenios((cv ?? []) as any);
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
    setEditingCompany(null);
    setDialogOpen(true);

  };

  const openEdit = async (m: PayoutModel) => {
    setEditing(m);
    const [{ data: rubrics }, companyRes] = await Promise.all([
      supabase
        .from("payout_model_rubrics" as any)
        .select("*")
        .eq("model_id", m.id)
        .order("sort_order"),
      m.company_id
        ? supabase.from("companies").select("id,name,document").eq("id", m.company_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);
    setEditingRubrics((rubrics ?? []) as any);
    setEditingCompany((companyRes?.data as any) ?? null);
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
        convenio_slug: r.convenio_slugs?.[0] ?? r.convenio_slug ?? null,
        convenio_slugs: r.convenio_slugs ?? [],

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

  const addRubric = (kind: RubricKind = "base_producao") => {
    setEditingRubrics((prev) => [
      ...prev,
      {
        sort_order: prev.length + 1,
        kind,
        label: "",
        incide_sobre: kind === "base_producao" || kind === "base_fixa" ? null : "subtotal_anterior",
        ref_rubric_order: null,
        param_key: null,
        fixed_pct: null,
        fixed_value: null,
        tier_table_id: null,
        convenio_slug: null,
        convenio_slugs: [],
        required: true,
        notes: null,
      },
    ]);
  };

  const applyGlosaTrdScenario = () => {
    if (editingRubrics.length > 0) {
      const ok = window.confirm(
        "Substituir as rubricas atuais pelo cenário: 3 convênios sem glosa, demais com glosa e TRD no final?",
      );
      if (!ok) return;
    }

    const sulAmerica = findConvenioSlug(convenios, ["sul america", "sulamerica"]);
    const bradesco = findConvenioSlug(convenios, ["bradesco"]);
    const particular = findConvenioSlug(convenios, ["particular"]);

    const baseRubric = (
      label: string,
      convenioSlug: string | undefined,
      notes: string | null = null,
    ): PayoutRubric => ({
      sort_order: 0,
      kind: "base_producao",
      label,
      incide_sobre: null,
      ref_rubric_order: null,
      param_key: null,
      fixed_pct: null,
      fixed_value: null,
      tier_table_id: null,
      convenio_slug: convenioSlug ?? null,
      convenio_slugs: convenioSlug ? [convenioSlug] : [],
      required: true,
      notes,
    });

    const rows: PayoutRubric[] = [
      baseRubric("Produção Sul América — sem glosa", sulAmerica),
      baseRubric("Produção Bradesco — sem glosa", bradesco),
      baseRubric("Produção Particular — sem glosa", particular),
      baseRubric(
        "Produção demais convênios — com glosa",
        undefined,
        "Agrupe aqui todos os convênios que não são Sul América, Bradesco ou Particular.",
      ),
      {
        sort_order: 0,
        kind: "desconto_pct",
        label: "Glosa sobre demais convênios",
        incide_sobre: "rubrica_especifica",
        ref_rubric_order: 4,
        param_key: "repasse.glosa_demais_convenios",
        fixed_pct: null,
        fixed_value: null,
        tier_table_id: null,
        convenio_slug: null,
        convenio_slugs: [],
        required: true,
        notes: "Aplica glosa somente sobre a rubrica #4. As bases #1, #2 e #3 ficam fora da glosa.",
      },
      {
        sort_order: 0,
        kind: "retencao_pct",
        label: "TRD sobre valor final",
        incide_sobre: "subtotal_anterior",
        ref_rubric_order: null,
        param_key: "repasse.trd",
        fixed_pct: null,
        fixed_value: null,
        tier_table_id: null,
        convenio_slug: null,
        convenio_slugs: [],
        required: true,
        notes: "Calcula depois da glosa: incide sobre as 3 bases sem glosa + demais convênios já com glosa aplicada.",
      },
    ].map((r, idx) => ({ ...r, sort_order: idx + 1 }));

    setEditingRubrics(rows);
    toast({ title: "Cenário aplicado", description: "Revise os percentuais/param keys antes de salvar." });
  };


  const updateRubric = (idx: number, patch: Partial<PayoutRubric>) => {
    setEditingRubrics((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRubric = (idx: number) => {
    setEditingRubrics((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---------- validações por etapa ----------
  const validateStep = (s: WizardStep): string | null => {
    if (s === "bases") {
      if (!editing?.name.trim()) return "Informe o nome do modelo.";
      const bases = editingRubrics.filter((r) => isBaseKind(r.kind));
      if (bases.length === 0) return "Adicione ao menos uma base (produção ou fixa).";
      const semLabel = bases.find((r) => !r.label.trim());
      if (semLabel) return "Toda base precisa de um rótulo.";
      const fixaSemValor = bases.find(
        (r) => r.kind === "base_fixa" && (r.fixed_value == null || r.fixed_value <= 0),
      );
      if (fixaSemValor)
        return `A base fixa "${fixaSemValor.label}" precisa de um valor maior que zero.`;
      return null;
    }
    if (s === "ajustes") {
      const ajustes = editingRubrics.filter((r) => !isBaseKind(r.kind));
      for (const r of ajustes) {
        if (!r.label.trim()) return "Toda rubrica de ajuste precisa de um rótulo.";
        if (r.kind === "acrescimo_faixa" && !r.tier_table_id)
          return `Rubrica "${r.label}" precisa de uma tabela de faixas.`;
        if (
          (r.kind === "desconto_valor" || r.kind === "acrescimo_valor") &&
          (r.fixed_value == null || r.fixed_value === 0)
        )
          return `Rubrica "${r.label}" precisa de um valor fixo.`;
        if (r.incide_sobre === "rubrica_especifica" && !r.ref_rubric_order)
          return `Rubrica "${r.label}" precisa do nº da rubrica de referência.`;
      }
      return null;
    }
    if (s === "convenios") return null; // sempre opcional
    if (s === "reuso") {
      const pcts = editingRubrics.filter((r) => isPctKind(r.kind));
      for (const r of pcts) {
        const hasFixed = r.fixed_pct != null && r.fixed_pct !== 0;
        const hasParam = !!r.param_key?.trim();
        if (!hasFixed && !hasParam)
          return `Rubrica % "${r.label || "(sem rótulo)"}" precisa de % fixo ou Param key.`;
      }
      return null;
    }
    return null;
  };

  const handleSave = async () => {
    for (const s of WIZARD_STEPS) {
      const err = validateStep(s.id);
      if (err) {
        toast({ title: err, variant: "destructive" });
        return;
      }
    }
    await save();
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
            <Layers className="h-4 w-4" /> Como funciona um modelo
          </CardTitle>
          <CardDescription className="text-xs">
            Um modelo é uma <span className="font-medium">receita</span> que o analista executa todo mês no lançamento manual.
            Cada linha é uma <span className="font-medium">rubrica</span>, e elas são calculadas
            na ordem em que aparecem.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>
            <span className="font-medium text-foreground">1) Bases</span> — o que entra na conta.
            Use <em>Base de produção</em> para valores digitados pelo analista (ex.: produção do
            mês por convênio) e <em>Base fixa</em> quando o valor está cadastrado aqui (ex.:
            sessão fixa para Particular).
          </p>
          <p>
            <span className="font-medium text-foreground">2) Descontos / Acréscimos / Retenções</span>{" "}
            — apontam sobre o que incidem (bruto, subtotal anterior ou rubrica específica) e podem
            ser % ou valor fixo. <em>Acréscimo por faixa</em> lê o valor de uma tabela
            (ex.: bônus por atendimentos).
          </p>
          <p>
            <span className="font-medium text-foreground">3) Convênio na rubrica</span> — é apenas{" "}
            <em>identificação</em>. Aparece na memória de cálculo (PDF/portal) e permite buscar %
            específico em Parâmetros do Sistema (ex.: TRD diferente para Sul América).{" "}
            <span className="font-medium">Não filtra nem soma sozinho</span> — a soma vem sempre
            do valor digitado pelo analista naquela base.
          </p>
          <p>
            <span className="font-medium text-foreground">4) Reuso de parâmetros</span> — em
            descontos/retenções %, prefira "Param key" (ex.: <code className="px-1">repasse.glosa_media</code>)
            em vez de % fixo: você muda no cadastro central e todos os modelos atualizam.
          </p>
          <p>
            <span className="font-medium text-foreground">Versão</span> — cada salvamento incrementa
            a versão. Pagamentos antigos preservam a versão usada na hora do cálculo (auditoria estável).
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

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing?.id ? "Editar modelo de repasse" : "Novo modelo de repasse"}
        description="Receita de cálculo aplicada nos lançamentos manuais."
        maxWidth="5xl"
      >
        {editing && (() => {
          const stepperSteps = WIZARD_STEPS.map((s) => {
            const err = validateStep(s.id);
            return {
              key: s.id,
              label: s.label,
              description: s.description,
              errorCount: err ? 1 : 0,
              content:
                s.id === "bases" ? (
                  <BasesStep
                    editing={editing}
                    setEditing={setEditing}
                    editingCompany={editingCompany}
                    setEditingCompany={setEditingCompany}
                    paymentTypes={paymentTypes}
                    rubrics={editingRubrics}
                    addRubric={addRubric}
                    applyGlosaTrdScenario={applyGlosaTrdScenario}
                    updateRubric={updateRubric}
                    removeRubric={removeRubric}
                    tierTables={tierTables}
                    convenios={convenios}
                  />
                ) : s.id === "ajustes" ? (
                  <AjustesStep
                    rubrics={editingRubrics}
                    addRubric={addRubric}
                    updateRubric={updateRubric}
                    removeRubric={removeRubric}
                    tierTables={tierTables}
                    convenios={convenios}
                  />
                ) : s.id === "convenios" ? (
                  <ConveniosStep
                    rubrics={editingRubrics}
                    updateRubric={updateRubric}
                    convenios={convenios}
                  />
                ) : (
                  <ReusoStep
                    rubrics={editingRubrics}
                    updateRubric={updateRubric}
                    editing={editing}
                    paymentTypeLabel={paymentTypeLabel}
                    editingCompany={editingCompany}
                  />
                ),
            };
          });

          return (
            <RuleFormStepper
              isEditing={!!editing?.id}
              saving={saving}
              steps={stepperSteps}
              onCancel={() => setDialogOpen(false)}
              onSubmit={handleSave}
              submitLabel={{ create: "Criar modelo", update: "Atualizar modelo" }}
            />
          );
        })()}
      </FormDialog>
    </div>
  );
}

// ---------- editor de rubrica ----------
function RubricEditor({
  index,
  rubric,
  tierTables,
  convenios,
  onChange,
  onRemove,
  allowedKinds,
  hideConvenio = false,
  hideReuso = false,
}: {
  index: number;
  rubric: PayoutRubric;
  tierTables: TierTable[];
  convenios: Array<{ slug: string; name: string }>;
  onChange: (patch: Partial<PayoutRubric>) => void;
  onRemove: () => void;
  allowedKinds?: RubricKind[];
  hideConvenio?: boolean;
  hideReuso?: boolean;
}) {
  const isPct = rubric.kind.endsWith("_pct");
  const isValor = rubric.kind === "desconto_valor" || rubric.kind === "acrescimo_valor" || rubric.kind === "base_fixa";
  const isFaixa = rubric.kind === "acrescimo_faixa";
  const isBase = rubric.kind === "base_producao" || rubric.kind === "base_fixa";

  const selectedSlugs = rubric.convenio_slugs?.length
    ? rubric.convenio_slugs
    : rubric.convenio_slug
      ? [rubric.convenio_slug]
      : [];
  const slugLabel = (slug: string) => convenios.find((c) => c.slug === slug)?.name ?? slug;

  const kindOptions = (allowedKinds ?? (Object.keys(RUBRIC_KIND_LABEL) as RubricKind[]));

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex flex-wrap items-center gap-1">
          Rubrica #{index + 1}
          {selectedSlugs.map((s) => (
            <span
              key={s}
              className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]"
            >
              {slugLabel(s)}
            </span>
          ))}
        </span>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remover rubrica">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={rubric.kind} onValueChange={(v) => onChange({ kind: v as RubricKind })}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kindOptions.map((k) => (
                <SelectItem key={k} value={k}>
                  {RUBRIC_KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground leading-snug">{RUBRIC_KIND_HELP[rubric.kind]}</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Rótulo (aparece na memória de cálculo)</Label>
          <Input
            className="h-8 text-sm"
            value={rubric.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Ex.: Produção Sul América"
          />
        </div>

        {!isBase && (
          <div className="space-y-1">
            <Label className="text-xs">Incide sobre</Label>
            <Select
              value={rubric.incide_sobre ?? "subtotal_anterior"}
              onValueChange={(v) => onChange({ incide_sobre: v as IncideSobre })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bruto">Bruto (soma de todas as bases)</SelectItem>
                <SelectItem value="subtotal_anterior">Subtotal anterior (bases + rubricas até aqui)</SelectItem>
                <SelectItem value="rubrica_especifica">Rubrica específica</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Define a base de cálculo do % ou referência do valor.
            </p>
          </div>
        )}

        {rubric.incide_sobre === "rubrica_especifica" && (
          <div className="space-y-1">
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

        {isPct && !hideReuso && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">% fixo</Label>
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
              <p className="text-[11px] text-muted-foreground leading-snug">
                Use isto OU "Param key" — se ambos preenchidos, o % fixo vence.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Param key (Parâmetros do Sistema)</Label>
              <Input
                className="h-8 text-sm"
                value={rubric.param_key ?? ""}
                onChange={(e) => onChange({ param_key: e.target.value || null })}
                placeholder="repasse.glosa_media"
              />
              <p className="text-[11px] text-muted-foreground leading-snug">
                Lê o % do cadastro central — mude lá uma vez e todos os modelos atualizam.
              </p>
            </div>
          </>
        )}


        {isValor && (
          <div className="space-y-1">
            <Label className="text-xs">Valor fixo (R$)</Label>
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
          <div className="md:col-span-2 space-y-1">
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

        {!hideConvenio && (
          <div className="md:col-span-2 space-y-1">
            <Label className="text-xs">Convênios (opcional)</Label>
            <ConvenioMultiSelectField
              convenios={convenios}
              value={rubric.convenio_slugs ?? []}
              onChange={(slugs) => {
                const norm = normalizeConvenioSlugs(slugs);
                onChange({ convenio_slugs: norm, convenio_slug: norm[0] ?? null });
              }}
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              <span className="font-medium text-foreground">Para que serve:</span> apenas
              <em> identifica </em> a quais convênios esta rubrica se refere. Não filtra nem soma sozinho.
            </p>
          </div>
        )}


      </div>
    </div>
  );
}

// ---------- multi-select de convênios ----------
function ConvenioMultiSelectField({
  convenios,
  value,
  onChange,
}: {
  convenios: Array<{ slug: string; name: string }>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const bySlug = useMemo(() => {
    const m = new Map<string, string>();
    convenios.forEach((c) => m.set(c.slug, c.name));
    return m;
  }, [convenios]);

  const toggle = (slug: string) => {
    // dedupe + normalização (case/trim) garantida pelo helper
    onChange(toggleConvenioSlug(value, slug));
  };

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className={cn(
              "w-full justify-between font-normal h-8 text-sm",
              !value.length && "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {value.length === 0
                ? "Sem vínculo — vale para qualquer convênio"
                : `${value.length} convênio${value.length > 1 ? "s" : ""} selecionado${value.length > 1 ? "s" : ""}`}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar convênio…" />
            <CommandList>
              <CommandEmpty>Nenhum convênio encontrado.</CommandEmpty>
              <CommandGroup>
                {convenios.map((c) => {
                  const checked = value.includes(c.slug);
                  return (
                    <CommandItem key={c.slug} value={`${c.name} ${c.slug}`} onSelect={() => toggle(c.slug)}>
                      <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                      <span className="text-xs">{c.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((slug) => (
            <button
              key={slug}
              type="button"
              onClick={() => onChange(value.filter((s) => s !== slug))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-primary/40 bg-accent text-primary hover:bg-accent/70"
              title="Remover"
            >
              <span className="truncate max-w-[200px]">{bySlug.get(slug) ?? slug}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- steps ----------
interface BaseStepProps {
  rubrics: PayoutRubric[];
  addRubric: (kind?: RubricKind) => void;
  updateRubric: (idx: number, patch: Partial<PayoutRubric>) => void;
  removeRubric: (idx: number) => void;
  tierTables: TierTable[];
  convenios: Array<{ slug: string; name: string }>;
}

function BasesStep({
  editing,
  setEditing,
  editingCompany,
  setEditingCompany,
  paymentTypes,
  rubrics,
  addRubric,
  updateRubric,
  removeRubric,
  tierTables,
  convenios,
}: BaseStepProps & {
  editing: PayoutModel;
  setEditing: (m: PayoutModel) => void;
  editingCompany: { id: string; name: string; document: string | null } | null;
  setEditingCompany: (c: { id: string; name: string; document: string | null } | null) => void;
  paymentTypes: Array<{ id: string; label: string }>;
}) {
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Identificação do modelo</h3>
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
              value={editingCompany}
              onChange={(c) => {
                setEditingCompany(c);
                setEditing({ ...editing, company_id: c?.id ?? null });
              }}
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
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Bases — o que entra na conta</h3>
            <p className="text-xs text-muted-foreground">
              Adicione ao menos uma base. "Base de produção" recebe valor digitado pelo analista todo mês;
              "Base fixa" usa o valor cadastrado aqui.
            </p>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => addRubric("base_producao")}>
              <Plus className="h-3 w-3 mr-1" /> Base produção
            </Button>
            <Button size="sm" variant="outline" onClick={() => addRubric("base_fixa")}>
              <Plus className="h-3 w-3 mr-1" /> Base fixa
            </Button>
          </div>
        </div>

        <RubricListByKinds
          rubrics={rubrics}
          allowedKinds={BASE_KINDS}
          updateRubric={updateRubric}
          removeRubric={removeRubric}
          tierTables={tierTables}
          convenios={convenios}
          hideConvenio
          hideReuso
          emptyHint="Nenhuma base adicionada ainda. Use os botões acima."
        />
      </section>
    </div>
  );
}

function AjustesStep({
  rubrics,
  addRubric,
  updateRubric,
  removeRubric,
  tierTables,
  convenios,
}: BaseStepProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Descontos, acréscimos e retenções</h3>
          <p className="text-xs text-muted-foreground">
            Aplicados após as bases. Definem o que sai (descontos/retenções) e o que entra (acréscimos)
            antes do total. Opcional — pode não haver nenhum.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 justify-end">
          <Button size="sm" variant="outline" onClick={() => addRubric("desconto_pct")}>
            <Plus className="h-3 w-3 mr-1" /> Desc. %
          </Button>
          <Button size="sm" variant="outline" onClick={() => addRubric("desconto_valor")}>
            <Plus className="h-3 w-3 mr-1" /> Desc. R$
          </Button>
          <Button size="sm" variant="outline" onClick={() => addRubric("acrescimo_pct")}>
            <Plus className="h-3 w-3 mr-1" /> Acr. %
          </Button>
          <Button size="sm" variant="outline" onClick={() => addRubric("acrescimo_valor")}>
            <Plus className="h-3 w-3 mr-1" /> Acr. R$
          </Button>
          <Button size="sm" variant="outline" onClick={() => addRubric("acrescimo_faixa")}>
            <Plus className="h-3 w-3 mr-1" /> Faixa
          </Button>
          <Button size="sm" variant="outline" onClick={() => addRubric("retencao_pct")}>
            <Plus className="h-3 w-3 mr-1" /> Reten. %
          </Button>
        </div>
      </div>

      <RubricListByKinds
        rubrics={rubrics}
        allowedKinds={AJUSTE_KINDS}
        updateRubric={updateRubric}
        removeRubric={removeRubric}
        tierTables={tierTables}
        convenios={convenios}
        hideConvenio
        hideReuso
        emptyHint="Nenhum ajuste adicionado — siga para a próxima etapa se não precisar."
      />
    </div>
  );
}

function RubricListByKinds({
  rubrics,
  allowedKinds,
  updateRubric,
  removeRubric,
  tierTables,
  convenios,
  hideConvenio,
  hideReuso,
  emptyHint,
}: {
  rubrics: PayoutRubric[];
  allowedKinds: RubricKind[];
  updateRubric: (idx: number, patch: Partial<PayoutRubric>) => void;
  removeRubric: (idx: number) => void;
  tierTables: TierTable[];
  convenios: Array<{ slug: string; name: string }>;
  hideConvenio?: boolean;
  hideReuso?: boolean;
  emptyHint: string;
}) {
  const filtered = rubrics
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => allowedKinds.includes(r.kind));

  if (filtered.length === 0) {
    return (
      <div className="text-xs text-muted-foreground border border-dashed rounded p-4 text-center">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {filtered.map(({ r, i }) => (
        <RubricEditor
          key={i}
          index={i}
          rubric={r}
          tierTables={tierTables}
          convenios={convenios}
          allowedKinds={allowedKinds}
          hideConvenio={hideConvenio}
          hideReuso={hideReuso}
          onChange={(patch) => updateRubric(i, patch)}
          onRemove={() => removeRubric(i)}
        />
      ))}
    </div>
  );
}

function ConveniosStep({
  rubrics,
  updateRubric,
  convenios,
}: {
  rubrics: PayoutRubric[];
  updateRubric: (idx: number, patch: Partial<PayoutRubric>) => void;
  convenios: Array<{ slug: string; name: string }>;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Vínculo de convênios por rubrica</h3>
        <p className="text-xs text-muted-foreground">
          O convênio é apenas <em>identificação</em> — usado na memória de cálculo e em overrides de
          parâmetros (ex.: TRD diferente por convênio). <span className="font-medium">Não filtra nem soma sozinho</span>.
          Deixar vazio = vale para qualquer convênio.
        </p>
      </div>

      {rubrics.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed rounded p-4 text-center">
          Sem rubricas para vincular.
        </div>
      ) : (
        <div className="space-y-2">
          {rubrics.map((r, i) => (
            <div key={i} className="border rounded-md p-3 bg-muted/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  #{i + 1} · {RUBRIC_KIND_LABEL[r.kind]}
                </span>
                <span className="text-muted-foreground truncate max-w-[60%]">{r.label || "(sem rótulo)"}</span>
              </div>
              <ConvenioMultiSelectField
                convenios={convenios}
                value={r.convenio_slugs ?? []}
                onChange={(slugs) => {
                  const norm = normalizeConvenioSlugs(slugs);
                  updateRubric(i, { convenio_slugs: norm, convenio_slug: norm[0] ?? null });
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReusoStep({
  rubrics,
  updateRubric,
  editing,
  paymentTypeLabel,
  editingCompany,
}: {
  rubrics: PayoutRubric[];
  updateRubric: (idx: number, patch: Partial<PayoutRubric>) => void;
  editing: PayoutModel;
  paymentTypeLabel: (id: string | null) => string;
  editingCompany: { id: string; name: string; document: string | null } | null;
}) {
  const pcts = rubrics
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => isPctKind(r.kind));

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Reuso de parâmetros nos %</h3>
        <p className="text-xs text-muted-foreground">
          Para cada rubrica %, escolha entre <span className="font-medium">% fixo</span> (vale só para este
          modelo) ou <span className="font-medium">Param key</span> (lê de Parâmetros do Sistema — uma mudança
          atualiza todos os modelos). Pelo menos um dos dois é obrigatório.
        </p>

        {pcts.length === 0 ? (
          <div className="text-xs text-muted-foreground border border-dashed rounded p-4 text-center">
            Nenhuma rubrica % neste modelo.
          </div>
        ) : (
          <div className="space-y-2">
            {pcts.map(({ r, i }) => {
              const hasFixed = r.fixed_pct != null && r.fixed_pct !== 0;
              const hasParam = !!r.param_key?.trim();
              const ok = hasFixed || hasParam;
              return (
                <div
                  key={i}
                  className={`border rounded-md p-3 space-y-2 ${ok ? "bg-muted/30" : "border-destructive/40 bg-destructive/5"}`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">
                      #{i + 1} · {RUBRIC_KIND_LABEL[r.kind]}
                    </span>
                    <span className="text-muted-foreground truncate max-w-[60%]">{r.label || "(sem rótulo)"}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">% fixo</Label>
                      <Input
                        type="number"
                        step="0.01"
                        className="h-8 text-sm"
                        value={r.fixed_pct ?? ""}
                        onChange={(e) =>
                          updateRubric(i, { fixed_pct: e.target.value ? Number(e.target.value) : null })
                        }
                        placeholder="Ex.: 10"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Param key</Label>
                      <Input
                        className="h-8 text-sm"
                        value={r.param_key ?? ""}
                        onChange={(e) => updateRubric(i, { param_key: e.target.value || null })}
                        placeholder="repasse.glosa_media"
                      />
                    </div>
                  </div>
                  {!ok && (
                    <p className="text-[11px] text-destructive">
                      Defina % fixo ou Param key para esta rubrica.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Revisão final</h3>
        <div className="rounded-md border p-3 text-xs space-y-1 bg-muted/20">
          <div><span className="text-muted-foreground">Nome:</span> <span className="font-medium">{editing.name || "—"}</span></div>
          <div><span className="text-muted-foreground">Tipo de pagamento:</span> {paymentTypeLabel(editing.payment_type_id)}</div>
          <div><span className="text-muted-foreground">Empresa:</span> {editingCompany?.name ?? "qualquer empresa"}</div>
          <div><span className="text-muted-foreground">Rubricas:</span> {rubrics.length}</div>
        </div>
        <div className="space-y-1">
          {rubrics.map((r, i) => (
            <div key={i} className="text-xs flex justify-between border-b border-border/60 py-1">
              <span>
                <span className="font-mono text-muted-foreground">#{i + 1}</span> {RUBRIC_KIND_LABEL[r.kind]} — {r.label || "(sem rótulo)"}
              </span>
              <span className="text-muted-foreground">
                {r.fixed_pct != null && `${r.fixed_pct}%`}
                {r.fixed_value != null && `R$ ${r.fixed_value}`}
                {r.param_key && ` · ${r.param_key}`}
                {(r.convenio_slugs?.length ?? 0) > 0 && ` · ${r.convenio_slugs!.length} convênio(s)`}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}


