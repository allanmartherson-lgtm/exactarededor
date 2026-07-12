/**
 * Relatório de economia / aumento por empresa DENTRO de um lote.
 *
 * Fonte: `intervention_ledger` (materializado no aprovar do diretor).
 * Filtra por `payment_id` (= id do lote) e ignora linhas revertidas.
 * Agrupa por empresa e classifica cada evento (economia / aumento / neutro).
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { ClipboardList, Download, TrendingDown, TrendingUp } from "lucide-react";
import {
  classifyItem,
  isCancellationNeutral,
  itemsToCsv,
  roleLabel,
  type InterventionItem,
  type IntervenorRole,
} from "@/lib/interventionSavings";

interface LedgerRow {
  id: string;
  payment_id: string;
  item_id: string;
  company_id: string | null;
  company_name: string | null;
  doctor_name: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  valor_regra: number;
  valor_pago_final: number;
  delta: number;
  fonte: string;
  cancellation_reason: string | null;
  autor_id: string | null;
  approved_at: string;
}

interface CompanyGroup {
  company_id: string | null;
  company_name: string;
  qtd: number;
  economia: number;
  perda: number;
  neutro: number;
  saldo: number;
  eventos: InterventionItem[];
}

// Mapeia `fonte` do ledger para um IntervenorRole que reusa os utilitários
// de classificação (economia/aumento/neutro) já existentes.
const fonteToRole = (fonte: string): IntervenorRole => {
  switch (fonte) {
    case "cancelamento": return "cancelamento_item";
    case "glosa": return "analista";
    case "ajuste_manual": return "analista";
    case "aceite_pago": return "analista";
    case "aceite_esperado": return "analista";
    default: return "analista";
  }
};

const fonteLabel = (fonte: string): string => {
  switch (fonte) {
    case "cancelamento": return "Cancelamento";
    case "glosa": return "Glosa aplicada";
    case "ajuste_manual": return "Ajuste manual";
    case "aceite_pago": return "Aceite valor pago";
    case "aceite_esperado": return "Aceite valor esperado";
    default: return fonte;
  }
};

const fonteBadge = (fonte: string) => {
  switch (fonte) {
    case "cancelamento": return "bg-destructive/10 text-destructive border-destructive/30";
    case "glosa": return "bg-warning/10 text-warning-text border-warning/30";
    case "ajuste_manual": return "bg-primary/10 text-primary border-primary/30";
    case "aceite_pago": return "bg-info/10 text-info border-info/30";
    case "aceite_esperado": return "bg-emerald-100 text-emerald-700 border-emerald-300";
    default: return "bg-muted text-muted-foreground border-border";
  }
};

const rowToItem = (r: LedgerRow): InterventionItem => ({
  item_id: r.item_id,
  payment_id: r.payment_id,
  obs_id: r.id,
  valor_regra: Number(r.valor_regra ?? 0),
  valor_pago_final: Number(r.valor_pago_final ?? 0),
  delta: Number(r.delta ?? 0),
  author_id: r.autor_id ?? "",
  autor: "",
  role: fonteToRole(r.fonte),
  obs_at: r.approved_at,
  acatado_at: r.approved_at,
  doctor_name: r.doctor_name,
  procedure_code: r.procedure_code,
  procedure_name: r.procedure_name,
  company_name: r.company_name,
  company_group_id: null,
  cancellation_reason: r.cancellation_reason,
});

export default function LoteInterventionReport() {
  const { id: paymentId } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [paymentRef, setPaymentRef] = useState<string>("");
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: p }, { data: l, error }] = await Promise.all([
          supabase.from("payments").select("reference,description").eq("id", paymentId).maybeSingle(),
          supabase
            .from("intervention_ledger")
            .select("id,payment_id,item_id,company_id,company_name,doctor_name,procedure_code,procedure_name,valor_regra,valor_pago_final,delta,fonte,cancellation_reason,autor_id,approved_at")
            .eq("payment_id", paymentId)
            .is("reverted_at", null)
            .order("approved_at", { ascending: false }),
        ]);
        if (error) throw error;
        let ledger = (l ?? []) as LedgerRow[];
        let preview = false;
        // Se o lote ainda não foi aprovado, o ledger fica vazio. Buscamos a
        // prévia calculada em tempo real a partir de payment_items (mesma
        // lógica do materialize_intervention_ledger, sem persistir).
        if (ledger.length === 0) {
          const { data: prev, error: prevErr } = await (supabase.rpc as unknown as (
            fn: string, args: Record<string, unknown>
          ) => Promise<{ data: unknown; error: unknown }>)(
            "get_lote_intervention_preview",
            { p_payment_id: paymentId },
          );
          if (!prevErr && Array.isArray(prev)) {
            ledger = (prev as LedgerRow[]).filter((r) => r.fonte !== "sem_intervencao");
            preview = true;
          }
        }
        if (!cancelled) {
          setRows(ledger);
          setPaymentRef(p?.reference ?? "");
          setIsPreview(preview);
        }
      } catch (e) {
        console.error(e);
        toast.error("Falha ao carregar relatório de intervenções do lote");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [paymentId]);

  const items = useMemo(() => rows.map(rowToItem), [rows]);

  const groups = useMemo<CompanyGroup[]>(() => {
    const map = new Map<string, CompanyGroup>();
    rows.forEach((r) => {
      const key = r.company_id ?? r.company_name ?? "__sem_empresa__";
      const name = r.company_name ?? "Sem empresa";
      const g = map.get(key) ?? {
        company_id: r.company_id,
        company_name: name,
        qtd: 0, economia: 0, perda: 0, neutro: 0, saldo: 0, eventos: [],
      };
      const it = rowToItem(r);
      g.eventos.push(it);
      g.qtd += 1;
      const c = classifyItem(it);
      if (c === "economia") g.economia += it.delta;
      else if (c === "aumento") g.perda += -it.delta;
      else g.neutro += Math.abs(it.delta);
      g.saldo = g.economia - g.perda;
      map.set(key, g);
    });
    return Array.from(map.values()).sort((a, b) => b.saldo - a.saldo);
  }, [rows]);

  const totals = useMemo(() => {
    let economia = 0, perda = 0, neutro = 0;
    items.forEach((it) => {
      const c = classifyItem(it);
      if (c === "economia") economia += it.delta;
      else if (c === "aumento") perda += -it.delta;
      else neutro += Math.abs(it.delta);
    });
    return { economia, perda, neutro, saldo: economia - perda, qtd: items.length };
  }, [items]);

  const exportCsv = () => {
    const csv = itemsToCsv(items);
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intervencoes_lote_${paymentRef || paymentId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Intervenções do lote"
        description={paymentRef ? `${paymentRef} — economia / aumento por empresa` : "Detalhamento por empresa"}
        icon={ClipboardList}
        showBack
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/pagamentos/${paymentId}`}>Voltar ao lote</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-1.5" /> Exportar CSV
            </Button>
          </div>
        }
      />
      <div className="p-4 md:p-6 space-y-4">
        {isPreview && rows.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-text flex items-start gap-2">
            <Badge variant="outline" className="border-warning/50 text-warning-text bg-warning/10 shrink-0">
              Prévia
            </Badge>
            <div>
              Lote ainda não aprovado — estes números refletem o estado atual das intervenções e podem mudar até o parecer do diretor.
              Só serão consolidados no ledger (e nos relatórios oficiais) após a aprovação.
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Saldo do lote"
            value={loading ? <Skeleton className="h-8 w-32" /> : formatCurrency(totals.saldo)}
            hint={`${totals.qtd} eventos${isPreview ? " · prévia" : ""}`}
            tone={totals.saldo > 0 ? "success" : totals.saldo < 0 ? "danger" : "default"}
          />
          <KpiCard
            label="Economia"
            value={loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(totals.economia)}
            tone="success"
          />
          <KpiCard
            label="Aumento"
            value={loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(totals.perda)}
            tone="danger"
          />
          <KpiCard
            label="Neutro (operacional)"
            value={loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(totals.neutro)}
            hint="Cancelamentos sem impacto financeiro"
          />
        </div>

        <Card className="shadow-card">
          <CardHeader><CardTitle>Resumo por empresa</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
              </div>
            ) : groups.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Nenhuma intervenção registrada para este lote.
                <div className="text-xs mt-1">
                  O ledger só é materializado quando o diretor aprova o lote.
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead className="text-right">Economia</TableHead>
                    <TableHead className="text-right">Aumento</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <TableRow key={g.company_id ?? g.company_name}>
                      <TableCell className="font-medium">{g.company_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.qtd}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        {g.economia > 0 ? formatCurrency(g.economia) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-700">
                        {g.perda > 0 ? formatCurrency(g.perda) : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${g.saldo > 0 ? "text-emerald-700" : g.saldo < 0 ? "text-red-700" : ""}`}>
                        {formatCurrency(g.saldo)}
                      </TableCell>
                      <TableCell>
                        {g.saldo > 0 ? <TrendingUp className="h-4 w-4 text-emerald-700" /> :
                         g.saldo < 0 ? <TrendingDown className="h-4 w-4 text-red-700" /> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {!loading && groups.length > 0 && (
          <Card className="shadow-card">
            <CardHeader><CardTitle>Detalhe por empresa</CardTitle></CardHeader>
            <CardContent>
              <Accordion type="multiple" className="w-full">
                {groups.map((g) => (
                  <AccordionItem key={g.company_id ?? g.company_name} value={g.company_id ?? g.company_name}>
                    <AccordionTrigger>
                      <div className="flex items-center gap-3 w-full pr-4">
                        <span className="font-medium">{g.company_name}</span>
                        <span className="text-xs text-muted-foreground">{g.qtd} eventos</span>
                        <span className={`ml-auto tabular-nums font-semibold ${g.saldo > 0 ? "text-emerald-700" : g.saldo < 0 ? "text-red-700" : ""}`}>
                          {formatCurrency(g.saldo)}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Fonte</TableHead>
                              <TableHead>Médico / Procedimento</TableHead>
                              <TableHead className="text-right">Valor regra</TableHead>
                              <TableHead className="text-right">Valor pago</TableHead>
                              <TableHead className="text-right">Δ</TableHead>
                              <TableHead>Classif.</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {g.eventos.map((e, idx) => {
                              const raw = rows.find(r => r.id === e.obs_id);
                              const fonte = raw?.fonte ?? "ajuste_manual";
                              const neutral = isCancellationNeutral(e);
                              const c = classifyItem(e);
                              return (
                                <TableRow key={`${e.obs_id}-${idx}`}>
                                  <TableCell>
                                    <Badge className={fonteBadge(fonte)} variant="outline">
                                      {fonteLabel(fonte)}
                                    </Badge>
                                    {raw?.cancellation_reason && (
                                      <div className="text-[10px] text-muted-foreground mt-0.5">
                                        {raw.cancellation_reason}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <div>{e.doctor_name ?? "—"}</div>
                                    <div className="text-muted-foreground">
                                      {[e.procedure_code, e.procedure_name].filter(Boolean).join(" · ") || "—"}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{formatCurrency(e.valor_regra)}</TableCell>
                                  <TableCell className="text-right tabular-nums">{formatCurrency(e.valor_pago_final)}</TableCell>
                                  <TableCell className={`text-right tabular-nums font-medium ${!neutral && e.delta > 0 ? "text-emerald-700" : !neutral && e.delta < 0 ? "text-red-700" : "text-muted-foreground"}`}>
                                    {formatCurrency(e.delta)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={c === "economia" ? "border-emerald-300 text-emerald-700" :
                                                 c === "aumento"  ? "border-red-300 text-red-700" :
                                                                    "border-muted text-muted-foreground"}
                                    >
                                      {c}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
