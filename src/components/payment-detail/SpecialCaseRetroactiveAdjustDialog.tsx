// Dialog que materializa marcações de caso especial aprovadas em um
// ajuste retroativo formal (company_financial_adjustments), preservando
// a imutabilidade do pagamento fechado.
//
// Fluxo:
//   1) Lista marks approved → usuário escolhe quais e informa empresa +
//      valor + descrição por linha (default: 1 linha por mark agrupada
//      por médico→PJ).
//   2) Botão "Pré-visualizar" → invoke special-case-adjust com preview=true
//      → mostra summary por empresa e total de redução.
//   3) Se houver redução, exige checkbox de confirmação (gate equivalente
//      ao _allow_calc_reduction da governança de regras).
//   4) "Aplicar" → invoke special-case-adjust com preview=false →
//      cria company_financial_adjustments e vincula marks.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle } from "lucide-react";

interface MarkRow {
  id: string;
  attendance_number: string | null;
  special_case_type_code: string;
  doctor_id: string | null;
  item_id: string | null;
}

interface CompanyOpt { id: string; nome: string; documento: string | null }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: string;
  marks: MarkRow[];
  hospitalId?: string | null;
  onApplied?: () => void;
}

interface Row {
  mark_id: string;
  company_id: string;
  valor: string;          // string para input controlado; convertido no envio
  descricao: string;
  attendance: string;
  type: string;
}

interface Summary { company_id: string; valor: number; tipo: string }

export function SpecialCaseRetroactiveAdjustDialog({
  open, onOpenChange, paymentId, marks, hospitalId, onApplied,
}: Props) {
  const { toast } = useToast();
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary[] | null>(null);
  const [allowReduction, setAllowReduction] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Carrega empresas + sugere PJ ativa para cada doctor_id da marca.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const q = supabase.from("companies")
        .select("id, nome, documento, ativo, hospital_id")
        .eq("ativo", true)
        .order("nome");
      const { data } = hospitalId ? await q.eq("hospital_id", hospitalId) : await q;
      if (!alive) return;
      const opts = ((data as any[]) ?? []).map((c) => ({ id: c.id, nome: c.nome, documento: c.documento }));
      setCompanies(opts);

      const doctorIds = Array.from(new Set(marks.map((m) => m.doctor_id).filter(Boolean) as string[]));
      const suggested: Record<string, string> = {};
      if (doctorIds.length > 0) {
        const { data: links } = await supabase
          .from("doctor_companies")
          .select("doctor_id, company_id, end_date")
          .in("doctor_id", doctorIds);
        for (const d of doctorIds) {
          const active = (links ?? []).filter((l: any) => l.doctor_id === d && !l.end_date);
          if (active.length === 1) suggested[d] = active[0].company_id;
        }
      }

      setRows(marks.map((m) => ({
        mark_id: m.id,
        company_id: m.doctor_id ? (suggested[m.doctor_id] ?? "") : "",
        valor: "",
        descricao: `Atend ${m.attendance_number ?? "?"} — ${m.special_case_type_code}`,
        attendance: m.attendance_number ?? "",
        type: m.special_case_type_code,
      })));
      setSummary(null);
      setAllowReduction(false);
    })();
    return () => { alive = false; };
  }, [open, marks, hospitalId]);

  const validRows = useMemo(
    () => rows.filter((r) => r.company_id && Number(r.valor.replace(",", ".")) !== 0),
    [rows],
  );

  const updateRow = (idx: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const buildPayload = () => ({
    payment_id: paymentId,
    mark_ids: marks.map((m) => m.id),
    items: validRows.map((r) => ({
      company_id: r.company_id,
      valor: Number(r.valor.replace(",", ".")),
      descricao: r.descricao,
    })),
  });

  const doPreview = async () => {
    if (validRows.length === 0) {
      toast({ title: "Informe empresa e valor em pelo menos uma linha", variant: "destructive" });
      return;
    }
    setLoadingPreview(true);
    setSummary(null);
    try {
      const { data, error } = await supabase.functions.invoke("special-case-adjust", {
        body: { ...buildPayload(), preview: true },
      });
      if (error) throw error;
      setSummary(((data as any)?.summary ?? []) as Summary[]);
    } catch (e: any) {
      toast({ title: "Falha no preview", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setLoadingPreview(false);
    }
  };

  const totalReducao = (summary ?? []).filter((s) => s.valor < 0).reduce((a, b) => a + b.valor, 0);
  const needsReductionConfirm = totalReducao < 0;

  const doApply = async () => {
    if (!summary) {
      toast({ title: "Pré-visualize antes de aplicar", variant: "destructive" });
      return;
    }
    if (needsReductionConfirm && !allowReduction) {
      toast({ title: "Confirme a redução para prosseguir", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("special-case-adjust", {
        body: { ...buildPayload(), preview: false, allow_reduction: allowReduction },
      });
      if (error) throw error;
      toast({
        title: "Ajuste retroativo gerado",
        description: `${(data as any)?.adjustments?.length ?? 0} ajuste(s) criado(s).`,
      });
      onOpenChange(false);
      onApplied?.();
    } catch (e: any) {
      toast({ title: "Falha ao aplicar", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Gerar ajuste retroativo — casos especiais</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            O pagamento já está fechado e não será alterado. Estes lançamentos criam
            ajustes financeiros (complemento/dedução) vinculados às marcações.
          </p>

          <div className="space-y-2 max-h-72 overflow-auto pr-2">
            {rows.map((r, i) => (
              <div key={r.mark_id} className="grid grid-cols-12 gap-2 items-end border rounded p-2">
                <div className="col-span-12 text-xs text-muted-foreground">
                  Atend <strong>{r.attendance}</strong> · {r.type}
                </div>
                <div className="col-span-5">
                  <Label className="text-xs">PJ</Label>
                  <select
                    className="w-full h-9 rounded border px-2 text-sm bg-background"
                    value={r.company_id}
                    onChange={(e) => updateRow(i, { company_id: e.target.value })}
                  >
                    <option value="">Selecione…</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}{c.documento ? ` · ${c.documento}` : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">Valor (+ comp / − ded)</Label>
                  <Input
                    inputMode="decimal"
                    value={r.valor}
                    onChange={(e) => updateRow(i, { valor: e.target.value })}
                    placeholder="0,00"
                  />
                </div>
                <div className="col-span-4">
                  <Label className="text-xs">Descrição</Label>
                  <Input value={r.descricao} onChange={(e) => updateRow(i, { descricao: e.target.value })} />
                </div>
              </div>
            ))}
          </div>

          {summary && (
            <div className="rounded border bg-muted/40 p-3 text-sm space-y-1">
              <div className="font-medium mb-1">Pré-visualização por PJ</div>
              {summary.map((s) => (
                <div key={s.company_id} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {companies.find((c) => c.id === s.company_id)?.nome ?? s.company_id}
                  </span>
                  <span className={s.valor < 0 ? "text-amber-600" : "text-emerald-600"}>
                    {s.valor < 0 ? "−" : "+"} R$ {Math.abs(s.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} ({s.tipo})
                  </span>
                </div>
              ))}
              {needsReductionConfirm && (
                <div className="mt-2 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-amber-900 dark:text-amber-200 text-xs mb-1">
                      Total de redução: R$ {Math.abs(totalReducao).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.
                      Confirme para prosseguir.
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={allowReduction} onCheckedChange={(v) => setAllowReduction(!!v)} />
                      Confirmo a dedução retroativa
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="outline" onClick={doPreview} disabled={loadingPreview}>
            {loadingPreview && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Pré-visualizar
          </Button>
          <Button onClick={doApply} disabled={submitting || !summary}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Aplicar ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
