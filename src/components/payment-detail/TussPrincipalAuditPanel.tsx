/**
 * TussPrincipalAuditPanel
 * -----------------------------------------------
 * Lista itens de um pagamento onde o motor não usou o TUSS
 * principal como chave (cai em fallback ou regra divergente).
 *
 * Usado em:
 *  - PaymentDetail (aba/seção "Auditoria TUSS principal")
 *  - Página global /auditoria/tuss-principal (mesmo componente, com payment_id)
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  detectTussMismatch,
  REASON_LABELS,
  fetchOverrides,
  resolveOverride,
  reopenOverride,
  type TussMismatch,
} from "@/lib/tussPrincipalAudit";
import { ShieldAlert, RefreshCw, CheckCircle2, RotateCcw } from "lucide-react";

type Row = {
  id: string;
  payment_id: string;
  attendance_number: string | null;
  doctor_name: string | null;
  doctor_role: string | null;
  procedure_code: string | null;
  applied_calc_method: string | null;
  applied_calc_id: string | null;
  applied_rule_id: string | null;
  package_absorbed: boolean | null;
  ai_findings: any;
  _calc?: { id: string; label: string | null; package_main_code: string | null; package_included_codes: string[] | null; procedure_codes: string[] | null; rule_id: string | null; calculation_type: string | null; rule_name?: string | null } | null;
  _mismatch?: TussMismatch | null;
  _override?: { resolved_at: string | null; justification: string | null } | null;
};

export function TussPrincipalAuditPanel({
  paymentId,
  onCountsChange,
}: {
  paymentId?: string;
  onCountsChange?: (counts: { open: number; resolved: number }) => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [justifyOpen, setJustifyOpen] = useState<string | null>(null);
  const [justifyText, setJustifyText] = useState("");

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("payment_items")
      .select(
        "id,payment_id,attendance_number,doctor_name,doctor_role,procedure_code,applied_calc_method,applied_calc_id,applied_rule_id,package_absorbed,ai_findings",
      )
      .limit(2000);
    if (paymentId) q = q.eq("payment_id", paymentId);
    else
      q = q.in(
        "applied_calc_method",
        ["sem_regra", "sem_acordo", "exclusao", "default_geral", "default_hemodinamica"],
      );

    const { data: items, error } = await q;
    if (error) {
      toast({ title: "Erro ao carregar itens", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const list = (items ?? []) as Row[];

    // Busca rule_calculations referenciados
    const calcIds = Array.from(new Set(list.map((r) => r.applied_calc_id).filter(Boolean))) as string[];
    let calcMap = new Map<string, Row["_calc"]>();
    if (calcIds.length > 0) {
      const { data: calcs } = await supabase
        .from("rule_calculations")
        .select("id,label,package_main_code,package_included_codes,procedure_codes,rule_id,calculation_type,rules(name)")
        .in("id", calcIds);
      for (const c of (calcs ?? []) as any[]) {
        calcMap.set(c.id, {
          id: c.id,
          label: c.label,
          package_main_code: c.package_main_code,
          package_included_codes: c.package_included_codes ?? null,
          procedure_codes: c.procedure_codes ?? null,
          rule_id: c.rule_id,
          calculation_type: c.calculation_type,
          rule_name: c.rules?.name ?? null,
        });
      }
    }

    // Detecta mismatch e busca overrides
    const enriched: Row[] = list
      .map((r) => {
        const calc = r.applied_calc_id ? calcMap.get(r.applied_calc_id) ?? null : null;
        const mismatch = detectTussMismatch(r, calc as any);
        return { ...r, _calc: calc, _mismatch: mismatch };
      })
      .filter((r) => !!r._mismatch);

    const overrideMap = await fetchOverrides(enriched.map((r) => r.id));
    for (const r of enriched) {
      const ov = overrideMap.get(r.id);
      r._override = ov ? { resolved_at: ov.resolved_at, justification: ov.justification } : null;
    }

    setRows(enriched);
    setLoading(false);
    onCountsChange?.({
      open: enriched.filter((r) => !r._override?.resolved_at).length,
      resolved: enriched.filter((r) => !!r._override?.resolved_at).length,
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  const filtered = useMemo(
    () => rows.filter((r) => (showResolved ? !!r._override?.resolved_at : !r._override?.resolved_at)),
    [rows, showResolved],
  );

  const openCount = rows.filter((r) => !r._override?.resolved_at).length;
  const resolvedCount = rows.filter((r) => !!r._override?.resolved_at).length;

  const handleResolve = async (itemId: string) => {
    if (!justifyText.trim()) {
      toast({ title: "Justificativa obrigatória", variant: "destructive" });
      return;
    }
    const { error } = await resolveOverride(itemId, user?.id ?? null, justifyText.trim());
    if (error) {
      toast({ title: "Erro ao resolver", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Item marcado como resolvido" });
    setJustifyOpen(null);
    setJustifyText("");
    load();
  };

  const handleReopen = async (itemId: string) => {
    const { error } = await reopenOverride(itemId);
    if (error) {
      toast({ title: "Erro ao reabrir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Item reaberto" });
    load();
  };

  return (
    <Card className={openCount > 0 ? "border-destructive/50" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert
            className={openCount > 0 ? "h-4 w-4 text-destructive" : "h-4 w-4 text-muted-foreground"}
          />
          Auditoria de TUSS principal
          <Badge variant={openCount > 0 ? "destructive" : "secondary"} className="ml-1">
            {openCount} {openCount === 1 ? "pendência" : "pendências"}
          </Badge>
          {resolvedCount > 0 && (
            <Badge variant="outline" className="ml-1">
              {resolvedCount} resolvido{resolvedCount === 1 ? "" : "s"}
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {openCount > 0 && (
          <p className="text-xs text-destructive mb-2">
            Aprovação bloqueada enquanto houver itens em que o motor não usou o TUSS principal como chave.
          </p>
        )}

        <div className="flex items-center gap-2 mb-2">
          <Button
            variant={showResolved ? "outline" : "default"}
            size="sm"
            onClick={() => setShowResolved(false)}
          >
            Abertas ({openCount})
          </Button>
          <Button
            variant={showResolved ? "default" : "outline"}
            size="sm"
            onClick={() => setShowResolved(true)}
          >
            Resolvidas ({resolvedCount})
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showResolved ? "Nenhum item resolvido." : "Nenhuma pendência — todos os itens usaram o TUSS principal como chave."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left py-1 pr-2">Atendimento</th>
                  <th className="text-left py-1 pr-2">Médico</th>
                  <th className="text-left py-1 pr-2">Função</th>
                  <th className="text-left py-1 pr-2">TUSS item</th>
                  <th className="text-left py-1 pr-2">Regra aplicada</th>
                  <th className="text-left py-1 pr-2">TUSS regra</th>
                  <th className="text-left py-1 pr-2">Motivo</th>
                  <th className="text-right py-1">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-2 font-mono">{r.attendance_number ?? "—"}</td>
                    <td className="py-1.5 pr-2">{r.doctor_name ?? "—"}</td>
                    <td className="py-1.5 pr-2">{r.doctor_role ?? "—"}</td>
                    <td className="py-1.5 pr-2 font-mono">{r._mismatch?.tuss_item ?? "—"}</td>
                    <td className="py-1.5 pr-2">{r._calc?.rule_name ?? "—"}</td>
                    <td className="py-1.5 pr-2 font-mono">{r._mismatch?.tuss_regra ?? "—"}</td>
                    <td className="py-1.5 pr-2">
                      <Badge variant="outline" className="text-[10px]">
                        {REASON_LABELS[r._mismatch!.reason]}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {r._mismatch?.detalhe}
                      </div>
                      {r._override?.justification && (
                        <div className="text-[10px] text-success mt-0.5">
                          ✓ {r._override.justification}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      {!paymentId && (
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="text-[11px] h-7"
                        >
                          <a href={`/pagamentos/${r.payment_id}`}>Abrir pagamento</a>
                        </Button>
                      )}
                      {r._override?.resolved_at ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[11px] h-7"
                          onClick={() => handleReopen(r.id)}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Reabrir
                        </Button>
                      ) : (
                        <Dialog
                          open={justifyOpen === r.id}
                          onOpenChange={(o) => {
                            setJustifyOpen(o ? r.id : null);
                            if (!o) setJustifyText("");
                          }}
                        >
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-[11px] h-7">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Resolver
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Marcar como resolvido</DialogTitle>
                            </DialogHeader>
                            <p className="text-sm text-muted-foreground">
                              Explique por que este item pode ser aprovado mesmo sem o
                              motor ter usado o TUSS principal como chave.
                            </p>
                            <Textarea
                              value={justifyText}
                              onChange={(e) => setJustifyText(e.target.value)}
                              placeholder="Ex.: regra cadastrada após análise; valores conferem manualmente; etc."
                              rows={4}
                            />
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setJustifyOpen(null)}>
                                Cancelar
                              </Button>
                              <Button onClick={() => handleResolve(r.id)}>Confirmar</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Hook utilitário: retorna a quantidade de pendências abertas de
 * TUSS principal para um pagamento. Usado para travar a aprovação.
 */
export function useTussAuditOpenCount(paymentId: string | undefined) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!paymentId) {
      setCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: items } = await supabase
        .from("payment_items")
        .select("id,procedure_code,applied_calc_method,applied_calc_id,applied_rule_id,package_absorbed,ai_findings")
        .eq("payment_id", paymentId);
      const list = (items ?? []) as any[];
      const calcIds = Array.from(new Set(list.map((r) => r.applied_calc_id).filter(Boolean))) as string[];
      const calcMap = new Map<string, any>();
      if (calcIds.length > 0) {
        const { data: calcs } = await supabase
          .from("rule_calculations")
          .select("id,package_main_code,package_included_codes,procedure_codes,rule_id,calculation_type")
          .in("id", calcIds);
        for (const c of (calcs ?? []) as any[]) calcMap.set(c.id, c);
      }
      const flagged = list
        .map((r) => ({ id: r.id, m: detectTussMismatch(r, r.applied_calc_id ? calcMap.get(r.applied_calc_id) : null) }))
        .filter((r) => !!r.m);
      const overrides = await fetchOverrides(flagged.map((r) => r.id));
      const open = flagged.filter((r) => !overrides.get(r.id)?.resolved_at).length;
      if (!cancelled) setCount(open);
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId]);
  return count;
}
