/**
 * Lançamento manual via Modelo de Repasse (Onda 2).
 *
 * Fluxo:
 *  1) Escolhe tipo de pagamento / competência / empresa.
 *  2) Sistema acha modelos compatíveis (hospital + tipo + empresa) — analista escolhe.
 *  3) Renderiza as rubricas: bases recebem input de valor; faixas recebem qtd;
 *     descontos/acréscimos % usam param_key/fixed_pct mas permitem override.
 *  4) Memória de cálculo aparece em tempo real (composto via lib/payoutComposition.ts).
 *  5) Salvar: cria 1 payment manual com `total_amount = total_nf`, `payout_model_id`,
 *     `payout_model_version` e `payout_breakdown` jsonb populado.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { CostCenterCombobox } from "@/components/CostCenterCombobox";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { ArrowLeft, Loader2, FileText, Printer, Calculator } from "lucide-react";
import {
  computeBreakdown,
  formatBRL,
  type RubricDef,
  type RubricInputs,
  type ResolvedTierTable,
} from "@/lib/payoutComposition";

interface PayoutModelRow {
  id: string;
  hospital_id: string;
  payment_model_id: string | null;
  company_id: string | null;
  name: string;
  version: number;
  description: string | null;
}

export default function NewManualPaymentComposicao() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hospital } = useHospital();
  // Composição por modelo: só faz sentido escolher modelo de pagamento no cabeçalho
  // (item_types como Parecer/Visita/Cirurgia são definidos por linha, não por lote).
  const { list: paymentTypes } = usePaymentTypes({ onlyActive: true, origin: "payment_model" });

  const [paymentModelId, setPaymentModelId] = useState<string>("");
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [competence, setCompetence] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [costCenterCode, setCostCenterCode] = useState<string | null>(null);
  const [reference, setReference] = useState("");

  const [matchingModels, setMatchingModels] = useState<PayoutModelRow[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [rubrics, setRubrics] = useState<RubricDef[]>([]);
  const [tiers, setTiers] = useState<Record<string, ResolvedTierTable>>({});
  const [inputs, setInputs] = useState<Record<string, RubricInputs>>({});
  const [params, setParams] = useState<Record<string, number>>({});
  const [loadingModel, setLoadingModel] = useState(false);
  const [saving, setSaving] = useState(false);

  // Procurar modelos compatíveis quando tipo/empresa mudam
  useEffect(() => {
    if (!hospital?.id) return;
    (async () => {
      let q = supabase
        .from("payout_models" as any)
        .select("id,hospital_id,payment_model_id,company_id,name,version,description")
        .eq("hospital_id", hospital.id)
        .eq("active", true);
      if (paymentModelId) q = q.or(`payment_model_id.eq.${paymentModelId},payment_model_id.is.null`);
      else q = q.is("payment_model_id", null);
      const { data } = await q.order("name");
      let list = ((data ?? []) as unknown) as PayoutModelRow[];
      // Prioriza match exato por empresa; depois empresa nula (genérico)
      if (company?.id) {
        list = list.filter((m) => !m.company_id || m.company_id === company.id);
        list.sort((a, b) => (a.company_id === company.id ? -1 : 1));
      } else {
        list = list.filter((m) => !m.company_id);
      }
      setMatchingModels(list);
      if (list.length === 1) setSelectedModelId(list[0].id);
    })();
  }, [hospital?.id, paymentModelId, company?.id]);

  // Carrega rubricas + faixas + params do modelo selecionado
  useEffect(() => {
    if (!selectedModelId) {
      setRubrics([]);
      setTiers({});
      setInputs({});
      return;
    }
    (async () => {
      setLoadingModel(true);
      const { data: rs } = await supabase
        .from("payout_model_rubrics" as any)
        .select("*")
        .eq("model_id", selectedModelId)
        .order("sort_order");
      const list = ((rs ?? []) as unknown) as RubricDef[];
      setRubrics(list);

      // Resolve tier tables
      const tierIds = Array.from(new Set(list.map((r) => r.tier_table_id).filter(Boolean) as string[]));
      const tierMap: Record<string, ResolvedTierTable> = {};
      if (tierIds.length > 0) {
        const { data: rows } = await supabase
          .from("payout_tier_rows" as any)
          .select("tier_table_id,min_value,max_value,output_value,label,sort_order")
          .in("tier_table_id", tierIds)
          .order("sort_order");
        for (const id of tierIds) tierMap[id] = { id, rows: [] };
        for (const r of (rows ?? []) as any[]) {
          tierMap[r.tier_table_id]?.rows.push({
            min_value: Number(r.min_value),
            max_value: r.max_value == null ? null : Number(r.max_value),
            output_value: Number(r.output_value),
            label: r.label,
          });
        }
      }
      setTiers(tierMap);

      // Resolve param_keys via resolve_system_parameter (best-effort)
      const paramKeys = Array.from(new Set(list.map((r) => r.param_key).filter(Boolean) as string[]));
      const paramMap: Record<string, number> = {};
      for (const key of paramKeys) {
        const { data } = await supabase.rpc("resolve_system_parameter" as any, {
          p_key: key,
          p_hospital_id: hospital?.id ?? null,
          p_convenio_slug: null,
          p_specialty: null,
        });
        // Convenção: campo `value` (number) ou `pct`/`percent` dentro do jsonb
        const v: any = data;
        const num = typeof v === "number" ? v : typeof v?.value === "number" ? v.value : typeof v?.pct === "number" ? v.pct : null;
        if (num != null) paramMap[key] = num;
      }
      setParams(paramMap);
      setInputs({});
      setLoadingModel(false);
    })();
  }, [selectedModelId, hospital?.id]);

  const breakdown = useMemo(
    () => computeBreakdown(rubrics, inputs, tiers, params),
    [rubrics, inputs, tiers, params],
  );

  const selectedModel = matchingModels.find((m) => m.id === selectedModelId);

  const canSave =
    !!hospital?.id &&
    !!user &&
    !!paymentModelId &&
    !!costCenterCode &&
    !!reference.trim() &&
    !!selectedModelId &&
    breakdown.total_nf > 0;

  const save = async () => {
    if (!canSave || !selectedModel) return;
    setSaving(true);
    const breakdownJson = {
      model_id: selectedModel.id,
      model_version: selectedModel.version,
      model_name: selectedModel.name,
      company_id: company?.id ?? null,
      company_name: company?.name ?? null,
      computed_at: new Date().toISOString(),
      ...breakdown,
    };
    const { data, error } = await supabase
      .from("payments")
      .insert({
        reference: reference.trim(),
        description: selectedModel.description ?? null,
        status: "rascunho" as any,
        total_amount: breakdown.total_nf,
        items_count: 0,
        created_by: user!.id,
        hospital_id: hospital!.id,
        competence_month: `${competence}-01`,
        competence_months: [`${competence}-01`],
        payment_due_date: paymentDueDate || null,
        analysis_mode: "manual" as any,
        payment_model_id: paymentModelId,
        cost_center_code: costCenterCode,
        payout_model_id: selectedModel.id,
        payout_model_version: selectedModel.version,
        payout_breakdown: breakdownJson,
      } as any)
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Erro ao salvar", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pagamento criado", description: `Valor NF: ${formatBRL(breakdown.total_nf)}` });
    navigate(`/pagamentos/${data.id}`);
  };

  const updateInput = (rubricId: string, patch: Partial<RubricInputs>) =>
    setInputs((prev) => ({ ...prev, [rubricId]: { ...prev[rubricId], ...patch } }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lançamento manual por modelo"
        description="Use uma receita cadastrada (Cadastros → Modelos de Repasse) para gerar o valor de NF automaticamente a partir das bases e parâmetros."
        icon={Calculator}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Esquerda: configurações do lote */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dados do lote</CardTitle>
            <CardDescription>
              Tipo, competência, empresa e centro de custos. Após escolher, o sistema procura modelos
              compatíveis.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Tipo de pagamento *</Label>
                <Select value={paymentModelId} onValueChange={setPaymentModelId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar tipo" /></SelectTrigger>
                  <SelectContent>
                    {paymentTypes.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Competência *</Label>
                <Input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Empresa (PJ) *</Label>
                <CompanyCombobox value={company} onChange={setCompany} placeholder="Buscar empresa…" />
              </div>
              <div className="space-y-1.5">
                <Label>Vencimento (opcional)</Label>
                <Input type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Centro de custos *</Label>
                <CostCenterCombobox value={costCenterCode} onChange={setCostCenterCode} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Referência *</Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Ex.: Fisio HDF — Mai/26"
                />
              </div>
            </div>

            {/* Seletor de modelo */}
            <div className="space-y-1.5 pt-2 border-t">
              <Label>Modelo de repasse *</Label>
              {matchingModels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum modelo compatível. Cadastre em <code>Cadastros → Modelos de Repasse</code>.
                </p>
              ) : (
                <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar modelo" /></SelectTrigger>
                  <SelectContent>
                    {matchingModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} {m.company_id ? "(específico)" : "(genérico)"} · v{m.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Rubricas */}
            {loadingModel ? (
              <div className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-1" />Carregando modelo…</div>
            ) : rubrics.length > 0 ? (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm">Rubricas</Label>
                {rubrics.map((r) => (
                  <RubricInput
                    key={r.id}
                    rubric={r}
                    input={inputs[r.id] ?? {}}
                    paramValue={r.param_key ? params[r.param_key] : undefined}
                    onChange={(patch) => updateInput(r.id, patch)}
                  />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Direita: memória de cálculo */}
        <div className="space-y-4">
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Memória de cálculo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {breakdown.rubrics.length === 0 ? (
                <p className="text-xs text-muted-foreground">Selecione um modelo para começar.</p>
              ) : (
                <>
                  <div className="space-y-1">
                    {breakdown.rubrics.map((l) => (
                      <div key={l.order} className="flex justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          <span className="font-mono">{l.order}.</span> {l.label}
                          {l.pct != null && <span className="ml-1 text-[10px]">({l.pct}%)</span>}
                          {l.tier_quantity != null && l.tier_quantity > 0 && (
                            <span className="ml-1 text-[10px]">({l.tier_quantity})</span>
                          )}
                        </span>
                        <span className={l.value < 0 ? "text-destructive" : "text-foreground"}>
                          {formatBRL(l.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t pt-2 space-y-1 text-xs">
                    <Row label="Bases" value={breakdown.total_bases} />
                    <Row label="Acréscimos" value={breakdown.total_acrescimos} />
                    <Row label="Descontos" value={breakdown.total_descontos} />
                    <Row label="Retenções" value={breakdown.total_retencoes} />
                  </div>
                  <div className="border-t pt-2 flex justify-between font-semibold text-success">
                    <span>Valor a faturar em NF</span>
                    <span>{formatBRL(breakdown.total_nf)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button onClick={save} disabled={!canSave || saving}>
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Criar pagamento
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={breakdown.rubrics.length === 0}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir memória
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span>{formatBRL(value)}</span>
    </div>
  );
}

function RubricInput({
  rubric,
  input,
  paramValue,
  onChange,
}: {
  rubric: RubricDef;
  input: RubricInputs;
  paramValue: number | undefined;
  onChange: (patch: Partial<RubricInputs>) => void;
}) {
  const isBaseProd = rubric.kind === "base_producao";
  const isFaixa = rubric.kind === "acrescimo_faixa";
  const isPct = rubric.kind.endsWith("_pct");
  const hasFixedPct = rubric.fixed_pct != null;
  const hasParamPct = !!rubric.param_key && paramValue != null;
  const effectivePct = rubric.fixed_pct ?? paramValue ?? input.overridePct;

  if (!isBaseProd && !isFaixa && !(isPct && !hasFixedPct && !hasParamPct)) {
    // Rubrica totalmente automática (fixed_value, retenção param, etc.) — só exibe
    return (
      <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/30">
        <span className="font-mono">{rubric.sort_order}.</span> {rubric.label}
        {isPct && effectivePct != null && <span className="ml-1">({effectivePct}%)</span>}
        {rubric.fixed_value != null && <span className="ml-1">— {formatBRL(rubric.fixed_value)}</span>}
      </div>
    );
  }

  return (
    <div className="border rounded p-2 space-y-1 bg-muted/30">
      <Label className="text-xs">
        <span className="font-mono">{rubric.sort_order}.</span> {rubric.label}
      </Label>
      {isBaseProd && (
        <Input
          type="number"
          step="0.01"
          className="h-8 text-sm"
          value={input.baseValue ?? ""}
          onChange={(e) => onChange({ baseValue: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="Valor da base"
        />
      )}
      {isFaixa && (
        <Input
          type="number"
          className="h-8 text-sm"
          value={input.tierQuantity ?? ""}
          onChange={(e) => onChange({ tierQuantity: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="Quantidade (ex.: nº atendimentos)"
        />
      )}
      {isPct && !hasFixedPct && !hasParamPct && (
        <Input
          type="number"
          step="0.01"
          className="h-8 text-sm"
          value={input.overridePct ?? ""}
          onChange={(e) => onChange({ overridePct: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="% a aplicar"
        />
      )}
    </div>
  );
}
