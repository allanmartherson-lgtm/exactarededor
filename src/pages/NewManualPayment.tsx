/**
 * Criação de um lote de pagamento MANUAL (sem importação de planilha).
 *
 * Fluxo:
 *  1. Analista escolhe tipo de pagamento, competência e referência
 *  2. Cria payments com analysis_mode='manual', status='rascunho'
 *  3. Redireciona para /pagamentos/:id/manual onde lança os itens
 *
 * O motor de regras NÃO roda nesse modo. Os valores vêm prontos do analista,
 * que pode anexar a planilha-fonte e descrever a composição em rubricas.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, FileEdit, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CostCenterCombobox } from "@/components/CostCenterCombobox";

export default function NewManualPayment() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { hospital } = useHospital();
  const { list: paymentTypes, loading: typesLoading } = usePaymentTypes({ onlyActive: true });

  const prefillCompetence = (() => {
    const raw = searchParams.get("competence_month");
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
    return null;
  })();
  const prefillTypeId = searchParams.get("payment_type_id");
  const prefillImportMode = searchParams.get("import_mode") === "historico" ? "historico" : "normal";

  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [competence, setCompetence] = useState(() => {
    if (prefillCompetence) return prefillCompetence;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [paymentModelId, setPaymentModelId] = useState<string>(prefillTypeId ?? "");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [costCenterCode, setCostCenterCode] = useState<string | null>(null);
  const [competenceRegime, setCompetenceRegime] = useState<"producao" | "remessa">("producao");
  const [submitting, setSubmitting] = useState(false);

  // Quando vem prefill do Zeev (retroativo), sugere referência inicial assim que o tipo carrega.
  useEffect(() => {
    if (!reference && prefillTypeId && paymentTypes.length > 0 && prefillCompetence) {
      const pt = paymentTypes.find((p) => p.id === prefillTypeId);
      if (pt) {
        const [y, m] = prefillCompetence.split("-");
        setReference(`${pt.label} — ${m}/${y} (retroativo)`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentTypes.length]);

  const canSubmit = !!reference.trim() && !!paymentModelId && !!competence && !!hospital?.id && !!costCenterCode;

  const handleCreate = async () => {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    // A FK payments.payment_model_id aponta para payment_types(id), mas o
    // combo usa a view payment_types_unified (item_types + payment_models),
    // cujos IDs não existem em payment_types. Resolve pelo `code` antes.
    const selected = paymentTypes.find((p) => p.id === paymentModelId);
    let resolvedTypeId = paymentModelId;
    if (selected?.code) {
      const { data: pt } = await supabase
        .from("payment_types")
        .select("id")
        .eq("code", selected.code)
        .maybeSingle();
      if (pt?.id) resolvedTypeId = pt.id;
    }
    const { data, error } = await supabase
      .from("payments")
      .insert({
        reference: reference.trim(),
        description: description.trim() || null,
        status: "rascunho" as any,
        total_amount: 0,
        items_count: 0,
        created_by: user.id,
        hospital_id: hospital!.id,
        competence_month: `${competence}-01`,
        competence_months: [`${competence}-01`],
        payment_due_date: paymentDueDate || null,
        analysis_mode: "manual" as any,
        payment_model_id: resolvedTypeId,
        cost_center_code: costCenterCode,
        competence_regime: competenceRegime,
        import_mode: prefillImportMode,
      } as any)
      .select()
      .single();
    setSubmitting(false);
    if (error || !data) {
      toast({ title: "Erro ao criar lote manual", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Lote criado", description: "Agora lance os itens manuais." });
    navigate(`/pagamentos/${data.id}/manual`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Novo lançamento manual"
        description="Para pagamentos cuja base vem de planilha externa (nefrologia, plantão fechado, coordenação rateada). O motor não calcula — você informa o valor por médico/empresa."
        icon={FileEdit}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/pagamentos/novo-manual-modelo")}>
              Lançar por modelo de repasse
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          </div>
        }
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Dados do lote</CardTitle>
          <CardDescription>
            Após criar, você adiciona as linhas (uma por médico ou empresa), informa valor e anexa a planilha-fonte.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ref">Referência *</Label>
              <Input
                id="ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ex.: Nefrologia Jan/26 — DF Star"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo de pagamento *</Label>
              <Select value={paymentModelId} onValueChange={setPaymentModelId} disabled={typesLoading}>
                <SelectTrigger id="tipo">
                  <SelectValue placeholder={typesLoading ? "Carregando…" : "Selecionar tipo"} />
                </SelectTrigger>
                <SelectContent>
                  {paymentTypes.map((pt) => (
                    <SelectItem key={pt.id} value={pt.id}>
                      {pt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp">Competência *</Label>
              <Input
                id="comp"
                type="month"
                value={competence}
                onChange={(e) => setCompetence(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due">Vencimento (opcional)</Label>
              <Input
                id="due"
                type="date"
                value={paymentDueDate}
                onChange={(e) => setPaymentDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Centro de custos *</Label>
            <CostCenterCombobox
              value={costCenterCode}
              onChange={setCostCenterCode}
              placeholder="Buscar por código P12 ou nome…"
            />
            <p className="text-xs text-muted-foreground">Obrigatório. Define o centro de custos contábil deste lote.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Regime de competência *</Label>
            <Select value={competenceRegime} onValueChange={(v) => setCompetenceRegime(v as "producao" | "remessa")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="producao">Produção realizada (procedimentos do mês da competência)</SelectItem>
                <SelectItem value="remessa">Produção remetida (pago quando enviado ao convênio — pode incluir meses anteriores)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Use <span className="font-medium">Remetida</span> para especialidades como infectologia/nefrologia históricas, em que o pagamento depende da remessa ao convênio e os atendimentos podem ser de meses anteriores.
            </p>
            {competenceRegime === "remessa" && (
              <div className="rounded-md border border-info/40 bg-info-soft/30 p-2.5 text-[11px] text-foreground/80">
                <span className="font-medium">Competência por item:</span> em remessa, o mês acima é apenas a <span className="font-medium">janela de envio</span>. A competência real de cada item é derivada automaticamente da <span className="font-medium">data do procedimento</span> na base importada. Itens sem data válida ficam num bucket de revisão (não bloqueia o lote).
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc">Descrição (opcional)</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notas sobre a origem dos valores, planilha de referência, etc."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={!canSubmit || submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Criar e lançar itens
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
