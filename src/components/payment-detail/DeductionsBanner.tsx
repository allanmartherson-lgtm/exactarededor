import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, AlertTriangle, Loader2, Plus, Trash2, RefreshCw, ShieldAlert, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Caa = {
  id: string; payment_id: string; company_id: string; adjustment_id: string;
  valor_aplicado: number; parcela_numero: number; status: string; source: string;
  adjustment?: { descricao: string; tipo: string; valor_total: number; parcelas_total: number };
};
type Gpa = {
  id: string; payment_id: string; company_id: string; glosa_debt_id: string; doctor_id: string | null;
  valor_aplicado: number; parcela_numero: number; status: string; source: string; resolution_note: string | null;
  glosa_debt?: { doctor_name: string; doctor_crm: string | null; total_debt: number; parcelas_default: number };
};

const brl = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function DeductionsBanner({
  paymentId, companyId, canEdit,
}: { paymentId: string; companyId: string; canEdit: boolean }) {
  const [caa, setCaa] = useState<Caa[]>([]);
  const [gpa, setGpa] = useState<Gpa[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    const [c, g] = await Promise.all([
      supabase.from("company_adjustment_applications")
        .select("*")
        .eq("payment_id", paymentId).eq("company_id", companyId)
        .neq("status", "revertido").order("applied_at", { ascending: true }),
      supabase.from("glosa_payment_applications")
        .select("*")
        .eq("payment_id", paymentId).eq("company_id", companyId)
        .neq("status", "revertido").order("applied_at", { ascending: true }),
    ]);
    const caaList = (c.data as any[]) ?? [];
    if (caaList.length > 0) {
      const adjIds = Array.from(new Set(caaList.map(x => x.adjustment_id)));
      const { data: adjs } = await supabase.from("company_financial_adjustments")
        .select("id, descricao, tipo, valor_total, parcelas_total").in("id", adjIds);
      const m = new Map((adjs ?? []).map((a: any) => [a.id, a]));
      caaList.forEach(x => { x.adjustment = m.get(x.adjustment_id); });
    }
    setCaa(caaList as Caa[]);
    const gpaList = (g.data as any[]) ?? [];
    if (gpaList.length > 0) {
      const debtIds = Array.from(new Set(gpaList.map(x => x.glosa_debt_id)));
      const { data: debts } = await supabase.from("glosa_debts")
        .select("id, doctor_name, doctor_crm, total_debt, parcelas_default")
        .in("id", debtIds);
      const map = new Map((debts ?? []).map((d: any) => [d.id, d]));
      gpaList.forEach(x => { x.glosa_debt = map.get(x.glosa_debt_id); });
    }
    setGpa(gpaList as Gpa[]);
    setLoading(false);
  }, [paymentId, companyId]);



  const runAuto = useCallback(async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("apply-company-deductions", {
        body: { payment_id: paymentId, company_id: companyId },
      });
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast.error("Falha ao aplicar deduções", { description: e?.message });
    } finally { setRunning(false); }
  }, [paymentId, companyId, load]);

  // First load: trigger auto-apply once if there are no rows yet
  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  useEffect(() => {
    if (!loading && caa.length === 0 && gpa.length === 0 && !running) {
      runAuto();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const totalDebitos = caa.reduce((s, x) => s + Number(x.valor_aplicado || 0), 0);
  const totalGlosas = gpa.filter(g => g.status !== "pending_manual_resolution")
    .reduce((s, x) => s + Number(x.valor_aplicado || 0), 0);
  const pendingResolutions = gpa.filter(g => g.status === "pending_manual_resolution").length;
  const totalLinhas = caa.length + gpa.length;

  const removeCaa = async (id: string) => {
    if (!confirm("Remover esta dedução do pagamento?")) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("company_adjustment_applications")
      .update({ status: "revertido", reverted_at: new Date().toISOString(), reverted_by: user?.id })
      .eq("id", id);
    await load();
  };
  const removeGpa = async (id: string) => {
    if (!confirm("Remover esta glosa do pagamento?")) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("glosa_payment_applications")
      .update({ status: "revertido", reverted_at: new Date().toISOString(), reverted_by: user?.id })
      .eq("id", id);
    await load();
  };

  if (loading) return null;

  if (totalLinhas === 0 && !running) {
    return (
      <div className="rounded-md border bg-muted/30 px-4 py-2.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5" /> Nenhuma dedução para esta empresa nesta competência.
        </span>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)} className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" /> Adicionar manualmente
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={`rounded-md border-2 ${pendingResolutions > 0 ? "border-warning/40 bg-warning-soft" : "border-primary/30 bg-primary/5"} px-4 py-3`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {pendingResolutions > 0 ? <AlertTriangle className="h-4 w-4 text-warning-text shrink-0" /> : <Wallet className="h-4 w-4 text-primary shrink-0" />}
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {running ? "Aplicando deduções…" : `${totalLinhas} dedução(ões) aplicada(s) automaticamente`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                Débitos: {brl(totalDebitos)} · Glosas: {brl(totalGlosas)}
                {pendingResolutions > 0 && <span className="text-warning-text"> · {pendingResolutions} pendência(s) de resolução manual</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={runAuto} disabled={running} className="h-7 text-xs">
              <RefreshCw className={`h-3 w-3 mr-1 ${running ? "animate-spin" : ""}`} /> Reaplicar
            </Button>
            <Button size="sm" onClick={() => setOpen(true)} className="h-7 text-xs">Revisar</Button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Deduções do pagamento</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Débitos / créditos da empresa</h3>
                {canEdit && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" /> Adicionar
                  </Button>
                )}
              </div>
              {caa.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhum débito aplicado.</p>
              ) : (
                <div className="space-y-1">
                  {caa.map(r => (
                    <div key={r.id} className="rounded border p-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={r.adjustment?.tipo === "credito" ? "default" : "destructive"} className="text-[10px]">
                            {r.adjustment?.tipo ?? "?"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{r.source === "manual" ? "manual" : "auto"}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                          <span className="text-xs truncate">{r.adjustment?.descricao}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          Parcela {r.parcela_numero}/{r.adjustment?.parcelas_total ?? "?"} — {brl(r.valor_aplicado)}
                        </p>
                      </div>
                      {canEdit && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeCaa(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold mb-2">Glosas dos médicos da PJ</h3>
              {gpa.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhuma glosa para os médicos desta empresa.</p>
              ) : (
                <div className="space-y-1">
                  {gpa.map(r => (
                    <div key={r.id} className={`rounded border p-2 flex items-center gap-2 ${r.status === "pending_manual_resolution" ? "border-warning/40 bg-warning-soft" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.status === "pending_manual_resolution" && <ShieldAlert className="h-3.5 w-3.5 text-warning-text" />}
                          <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                          <span className="text-xs truncate">
                            {r.glosa_debt?.doctor_name} {r.glosa_debt?.doctor_crm && `· ${r.glosa_debt.doctor_crm}`}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          {r.status === "pending_manual_resolution"
                            ? r.resolution_note
                            : `Parcela ${r.parcela_numero}/${r.glosa_debt?.parcelas_default ?? "?"} — ${brl(r.valor_aplicado)}`}
                        </p>
                      </div>
                      {canEdit && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeGpa(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {addOpen && (
        <AddManualDeductionDialog
          paymentId={paymentId} companyId={companyId}
          onClose={() => { setAddOpen(false); load(); }}
        />
      )}
    </>
  );
}

function AddManualDeductionDialog({
  paymentId, companyId, onClose,
}: { paymentId: string; companyId: string; onClose: () => void }) {
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [valor, setValor] = useState("");

  useEffect(() => {
    supabase.from("company_financial_adjustments")
      .select("*").eq("company_id", companyId).eq("ativo", true)
      .then(({ data }) => setAdjustments(data ?? []));
  }, [companyId]);

  const save = async () => {
    if (!selected || !valor) { toast.error("Selecione e informe valor"); return; }
    const adj = adjustments.find(a => a.id === selected);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("company_adjustment_applications").insert({
      payment_id: paymentId, company_id: companyId, adjustment_id: selected,
      valor_aplicado: Number(valor.replace(",", ".")),
      parcela_numero: (adj?.parcelas_pagas ?? 0) + 1,
      applied_by: user?.id, status: "proposto", source: "manual",
    });
    if (error) { toast.error("Erro", { description: error.message }); return; }
    toast.success("Dedução adicionada");
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Adicionar dedução manual</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Débito / crédito cadastrado</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger><SelectValue placeholder="Escolha..." /></SelectTrigger>
              <SelectContent>
                {adjustments.length === 0 && <div className="p-2 text-xs text-muted-foreground">Nenhum cadastrado para esta empresa.</div>}
                {adjustments.map(a => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.tipo} — {a.descricao} ({brl(Number(a.valor_total) / Number(a.parcelas_total))}/parcela)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Valor a aplicar (R$)</Label>
            <Input value={valor} onChange={e => setValor(e.target.value)} placeholder="500.00" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save}>Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
