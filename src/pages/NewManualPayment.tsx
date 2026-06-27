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
import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const { user } = useAuth();
  const { hospital } = useHospital();
  const { list: paymentTypes, loading: typesLoading } = usePaymentTypes({ onlyActive: true });

  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [competence, setCompetence] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [paymentTypeId, setPaymentTypeId] = useState<string>("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [costCenterCode, setCostCenterCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !!reference.trim() && !!paymentTypeId && !!competence && !!hospital?.id && !!costCenterCode;

  const handleCreate = async () => {
    if (!canSubmit || !user) return;
    setSubmitting(true);
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
        payment_type_id: paymentTypeId,
        cost_center_code: costCenterCode,
        import_mode: "normal",
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
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
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
              <Select value={paymentTypeId} onValueChange={setPaymentTypeId} disabled={typesLoading}>
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
