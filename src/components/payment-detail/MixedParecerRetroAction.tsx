import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useItemTypes } from "@/hooks/useItemTypes";
import { ParecerReportWizardCard, type ParecerWizardPayload } from "@/components/payment-wizard/ParecerReportWizardCard";
import { useAmbiguousTussCount } from "@/components/payment-wizard/MixedParecerSetupCard";

/**
 * Ação retroativa: marca um lote já existente (de produção/mista) como "lote
 * misto com parecer/visita", anexa o relatório do Tasy e dispara o cruzamento.
 *
 * Aparece em CompanyAnalysis para lotes que NÃO são parecer/visita puro e
 * ainda não estão marcados como mistos.
 */
export function MixedParecerRetroAction({
  paymentId,
  paymentTypeId,
  paymentTypeCode,
  paymentTypeCategory,
  competenceMonths,
  hasMixedParecer,
  allowPureType = false,
  onApplied,
}: {
  paymentId: string;
  paymentTypeId?: string | null;
  paymentTypeCode?: string | null;
  paymentTypeCategory?: string | null;
  competenceMonths: string[];
  hasMixedParecer: boolean;
  allowPureType?: boolean;
  onApplied?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(hasMixedParecer);
  const [parecerTypeId, setParecerTypeId] = useState<string | null>(null);
  const [parecerPayload, setParecerPayload] = useState<ParecerWizardPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { list: itemTypes } = useItemTypes({ onlyActive: true });
  const parecerSubtypes = itemTypes.filter((t) => t.code.startsWith("parecer"));
  const ambiguousCount = useAmbiguousTussCount();

  useEffect(() => {
    if (parecerSubtypes.length > 0 && !parecerTypeId) {
      setParecerTypeId(parecerSubtypes[0].id);
    }
  }, [parecerSubtypes.length, parecerTypeId]);

  // Esconde se o lote já é parecer/visita/consulta (esses cruzam por padrão e
  // não fazem sentido como "lote misto de parecer"). Cobre tanto pelo `code`
  // quanto pela `category` do payment_type — alguns tenants usam códigos
  // customizados (ex.: "parecer_adulto") e outros se baseiam só na categoria.
  // Também esconde enquanto o meta ainda não carregou para evitar flash.
  const code = (paymentTypeCode ?? "").toLowerCase();
  const cat = (paymentTypeCategory ?? "").toLowerCase();
  if (paymentTypeId && !paymentTypeCode && !paymentTypeCategory) return null;
  if (!allowPureType) {
    if (
      code.startsWith("parecer") || code === "visita" || code === "consulta" ||
      cat === "parecer" || cat === "visita" || cat === "consulta"
    ) return null;
  }


  const submit = async () => {
    if (!enabled) {
      toast({ title: "Marque a opção 'lote misto' para continuar.", variant: "destructive" });
      return;
    }
    if (!parecerTypeId) {
      toast({ title: "Selecione o subtipo de parecer.", variant: "destructive" });
      return;
    }
    if (!parecerPayload) {
      toast({ title: "Anexe o relatório do Tasy.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error: updErr } = await supabase
        .from("payments")
        .update({
          has_mixed_parecer: true,
          // D3.e.2: grava na coluna canônica. O trigger sync_payments_mixed_parecer_columns
          // mantém `mixed_parecer_payment_type_id` (legada) em paralelo durante a transição.
          mixed_parecer_item_type_id: parecerTypeId,
        })
        .eq("id", paymentId);
      if (updErr) throw updErr;

      const initRes = await supabase.functions.invoke("import-parecer-report", {
        body: {
          mode: "init",
          payment_id: paymentId,
          filename: parecerPayload.fileName,
          file_hash: parecerPayload.fileHash,
          period_start: parecerPayload.periodStart,
          period_end: parecerPayload.periodEnd,
        },
      });
      if (initRes.error) throw initRes.error;
      const initData = (initRes.data as any) ?? {};
      const reportId = initData.report_id;
      if (!reportId) throw new Error("Falha ao criar cabeçalho do relatório");

      // Se o arquivo já foi importado antes (mesmo hash), pula append/finalize
      // e vai direto para o cruzamento — não faz sentido re-enviar 2800 linhas.
      const isDuplicate = !!initData.duplicate;

      if (!isDuplicate) {
        const CHUNK = 300;
        let inserted = 0;
        for (let i = 0; i < parecerPayload.rows.length; i += CHUNK) {
          const chunk = parecerPayload.rows.slice(i, i + CHUNK);
          const { error: appErr } = await supabase.functions.invoke("import-parecer-report", {
            body: { mode: "append", report_id: reportId, rows: chunk },
          });
          if (appErr) throw appErr;
          inserted += chunk.length;
        }

        await supabase.functions.invoke("import-parecer-report", {
          body: { mode: "finalize", report_id: reportId, row_count: inserted },
        });
      }

      // finalize já dispara cross-reference-parecer; chamamos novamente com
      // trigger_reanalysis=true para forçar reanálise das regras pós-classificação.
      const { error: xrefErr } = await supabase.functions.invoke("cross-reference-parecer", {
        body: { payment_id: paymentId, trigger_reanalysis: true },
      });
      if (xrefErr) throw xrefErr;

      toast({
        title: "Lote marcado como misto",
        description: "Relatório anexado e cruzamento disparado. A reanálise vai ajustar os subtipos.",
      });
      setOpen(false);
      onApplied?.();
    } catch (e: any) {
      toast({
        title: "Falha ao aplicar",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (hasMixedParecer && !open) {
    return (
      <Card className="shadow-card border-dashed">
        <CardContent className="p-3 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span>Lote misto ativo — cruzamento parecer/visita habilitado.</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Reanexar relatório
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    return (
      <Card className="shadow-card border-dashed">
        <CardContent className="p-3 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span>
              Esse lote contém parecer/visita misturado com os procedimentos?
              Marque como misto e anexe o relatório do Tasy para cruzar.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setOpen(true); setEnabled(true); }}>
            Marcar como lote misto
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Lote misto — anexar relatório de parecer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <Checkbox id="mp-retro" checked={enabled} onCheckedChange={(c) => setEnabled(!!c)} className="mt-0.5" />
          <Label htmlFor="mp-retro" className="text-sm cursor-pointer">
            Confirmar que este lote contém atendimentos de parecer/visita misturados com os demais procedimentos
          </Label>
        </div>
        {enabled && (
          <>
            <div>
              <Label className="text-xs">Subtipo de parecer para itens cruzados *</Label>
              <Select value={parecerTypeId ?? ""} onValueChange={setParecerTypeId}>
                <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {parecerSubtypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {ambiguousCount === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-[12px] text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Sem TUSS cadastrados em Parecer/Visita/Consulta — o filtro de itens ambíguos ficará vazio.</span>
              </div>
            )}
            <ParecerReportWizardCard
              competenceMonths={competenceMonths}
              tasyAttendanceKeys={null}
              value={parecerPayload}
              onChange={setParecerPayload}
            />
          </>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={submitting}>Cancelar</Button>
          <Button size="sm" onClick={submit} disabled={submitting || !enabled || !parecerPayload || !parecerTypeId}>
            {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Aplicar e cruzar agora
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
