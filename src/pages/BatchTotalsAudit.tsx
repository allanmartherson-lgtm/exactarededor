// Auditoria de Totais do Lote
// Compara, para um lote selecionado:
//  - Bruto (itens)      → soma de gross_amount em payment_items
//  - Bruto (empresas)   → soma de bruto_total em payment_company_groups
//  - Líquido (empresas) → soma de liquido_total (fallback: payment_company_financials.liquido)
//  - Exclusões          → itens is_cancelled / package_absorbed (quantidade e valor)
// Leitura paginada (.range) para não esbarrar no teto de 1000 linhas do PostgREST.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { Scale, RefreshCw, Loader2 } from "lucide-react";

const PAGE = 1000;
const TOL = 0.05; // tolerância em reais para considerar "redondo"

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface PaymentRow {
  id: string;
  reference: string;
  status: string;
  competence_month: string | null;
  bruto_total: number | null;
  liquido_total: number | null;
  total_amount: number | null;
}

interface GroupRow {
  company_id: string | null;
  company_name: string | null;
  items_count: number | null;
  bruto_total: number | null;
  liquido_total: number | null;
  total_amount: number | null;
}

interface PcfRow {
  company_id: string | null;
  bruto: number | null;
  liquido: number | null;
  glosas: number | null;
  creditos: number | null;
  debitos: number | null;
}

interface ItemAgg {
  count: number;
  gross: number;
  cancelledCount: number;
  cancelledGross: number;
  absorbedCount: number;
  absorbedGross: number;
}

const emptyAgg = (): ItemAgg => ({
  count: 0,
  gross: 0,
  cancelledCount: 0,
  cancelledGross: 0,
  absorbedCount: 0,
  absorbedGross: 0,
});

interface AuditResult {
  totals: ItemAgg;
  byCompany: Map<string, ItemAgg>;
  groups: GroupRow[];
  pcf: Map<string, PcfRow>;
}

const DiffBadge = ({ diff }: { diff: number }) => {
  const ok = Math.abs(diff) < TOL;
  return (
    <Badge
      variant="outline"
      className={
        ok
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-destructive/10 text-destructive"
      }
    >
      {ok ? "OK" : fmt(diff)}
    </Badge>
  );
};

const BatchTotalsAudit = ({ embedded = false }: { embedded?: boolean } = {}) => {
  const hospitalId = useActiveHospitalId();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentId, setPaymentId] = useState<string>("");
  const [loadingList, setLoadingList] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingList(true);
      let q = supabase
        .from("payments")
        .select("id, reference, status, competence_month, bruto_total, liquido_total, total_amount")
        .order("created_at", { ascending: false })
        .limit(200);
      if (hospitalId) q = q.eq("hospital_id", hospitalId);
      const { data } = await q;
      if (!mounted) return;
      setPayments((data ?? []) as unknown as PaymentRow[]);
      setLoadingList(false);
    })();
    return () => {
      mounted = false;
    };
  }, [hospitalId]);

  const selected = useMemo(
    () => payments.find((p) => p.id === paymentId) ?? null,
    [payments, paymentId],
  );

  const runAudit = useCallback(async () => {
    if (!paymentId) return;
    setRunning(true);
    setResult(null);
    try {
      const totals = emptyAgg();
      const byCompany = new Map<string, ItemAgg>();

      // Itens — paginado para não truncar em 1000 linhas.
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("payment_items")
          .select("company_id, gross_amount, is_cancelled, package_absorbed")
          .eq("payment_id", paymentId)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as unknown as Array<{
          company_id: string | null;
          gross_amount: number | null;
          is_cancelled: boolean | null;
          package_absorbed: boolean | null;
        }>;
        for (const r of rows) {
          const g = Number(r.gross_amount ?? 0);
          const key = r.company_id ?? "__sem_pj__";
          const agg = byCompany.get(key) ?? emptyAgg();
          totals.count += 1;
          agg.count += 1;
          if (r.is_cancelled) {
            totals.cancelledCount += 1;
            totals.cancelledGross += g;
            agg.cancelledCount += 1;
            agg.cancelledGross += g;
          } else if (r.package_absorbed) {
            totals.absorbedCount += 1;
            totals.absorbedGross += g;
            agg.absorbedCount += 1;
            agg.absorbedGross += g;
          } else {
            totals.gross += g;
            agg.gross += g;
          }
          byCompany.set(key, agg);
        }
        if (rows.length < PAGE) break;
      }

      const [{ data: gData }, { data: fData }] = await Promise.all([
        supabase
          .from("payment_company_groups")
          .select("company_id, company_name, items_count, bruto_total, liquido_total, total_amount")
          .eq("payment_id", paymentId),
        supabase
          .from("payment_company_financials")
          .select("company_id, bruto, liquido, glosas, creditos, debitos")
          .eq("payment_id", paymentId),
      ]);

      const pcf = new Map<string, PcfRow>();
      for (const r of (fData ?? []) as unknown as PcfRow[]) {
        if (r.company_id) pcf.set(r.company_id, r);
      }

      setResult({
        totals,
        byCompany,
        groups: ((gData ?? []) as unknown as GroupRow[]).sort((a, b) =>
          (a.company_name ?? "").localeCompare(b.company_name ?? ""),
        ),
        pcf,
      });
    } finally {
      setRunning(false);
    }
  }, [paymentId]);

  const summary = useMemo(() => {
    if (!result) return null;
    const brutoItens = result.totals.gross;
    const brutoItensTodos =
      result.totals.gross + result.totals.cancelledGross + result.totals.absorbedGross;
    const brutoEmpresas = result.groups.reduce(
      (s, g) => s + Number(g.bruto_total ?? 0),
      0,
    );
    const liquidoEmpresas = result.groups.reduce((s, g) => {
      const fromPcf = g.company_id ? result.pcf.get(g.company_id)?.liquido : null;
      return s + Number(g.liquido_total ?? fromPcf ?? g.total_amount ?? 0);
    }, 0);
    const semPcf = result.groups.filter(
      (g) => !g.company_id || !result.pcf.has(g.company_id),
    ).length;
    return {
      brutoItens,
      brutoItensTodos,
      brutoEmpresas,
      liquidoEmpresas,
      diffBruto: brutoItens - brutoEmpresas,
      semPcf,
    };
  }, [result]);

  const filteredGroups = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    if (!q) return result.groups;
    return result.groups.filter((g) => (g.company_name ?? "").toLowerCase().includes(q));
  }, [result, query]);

  return (
    <div className={embedded ? "space-y-4" : "container mx-auto py-6 space-y-4"}>
      {!embedded && (
        <PageHeader
          title="Auditoria de totais do lote"
          description="Confere Bruto (itens) × Bruto (empresas) × Líquido (empresas) e as exclusões de itens cancelados ou absorvidos em pacote."
          icon={Scale}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Selecione o lote</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={paymentId} onValueChange={setPaymentId}>
            <SelectTrigger className="sm:max-w-xl">
              <SelectValue placeholder={loadingList ? "Carregando lotes…" : "Escolha um lote"} />
            </SelectTrigger>
            <SelectContent>
              {payments.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.reference} · {p.status}
                  {p.competence_month ? ` · ${p.competence_month}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={runAudit} disabled={!paymentId || running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Conferir totais
          </Button>
        </CardContent>
      </Card>

      {summary && result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Bruto (itens)"
              value={fmt(summary.brutoItens)}
              subtitle={`${result.totals.count - result.totals.cancelledCount - result.totals.absorbedCount} itens elegíveis`}
            />
            <KpiCard
              title="Bruto (empresas)"
              value={fmt(summary.brutoEmpresas)}
              subtitle={`${result.groups.length} PJ(s) no lote`}
            />
            <KpiCard
              title="Líquido (empresas)"
              value={fmt(summary.liquidoEmpresas)}
              subtitle={summary.semPcf > 0 ? `${summary.semPcf} PJ(s) sem resumo financeiro` : "Todas as PJs com resumo"}
            />
            <KpiCard
              title="Diferença Bruto"
              value={Math.abs(summary.diffBruto) < TOL ? "OK" : fmt(summary.diffBruto)}
              subtitle="Itens − Empresas"
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Exclusões de itens</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
              <div>
                <div className="text-muted-foreground">Total lido no lote</div>
                <div className="font-semibold">
                  {result.totals.count} itens · {fmt(summary.brutoItensTodos)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Cancelados (is_cancelled)</div>
                <div className="font-semibold">
                  {result.totals.cancelledCount} itens · {fmt(result.totals.cancelledGross)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Absorvidos em pacote (package_absorbed)</div>
                <div className="font-semibold">
                  {result.totals.absorbedCount} itens · {fmt(result.totals.absorbedGross)}
                </div>
              </div>
            </CardContent>
          </Card>

          {selected && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Cabeçalho do lote (payments)</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <div className="text-muted-foreground">bruto_total</div>
                  <div className="font-semibold flex items-center gap-2">
                    {fmt(Number(selected.bruto_total ?? 0))}
                    <DiffBadge diff={Number(selected.bruto_total ?? 0) - summary.brutoEmpresas} />
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">liquido_total</div>
                  <div className="font-semibold flex items-center gap-2">
                    {fmt(Number(selected.liquido_total ?? 0))}
                    <DiffBadge diff={Number(selected.liquido_total ?? 0) - summary.liquidoEmpresas} />
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">total_amount</div>
                  <div className="font-semibold">{fmt(Number(selected.total_amount ?? 0))}</div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Conferência por empresa</CardTitle>
              <Input
                placeholder="Buscar empresa…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="sm:max-w-xs"
              />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Itens (grupo)</TableHead>
                    <TableHead className="text-right">Itens (reais)</TableHead>
                    <TableHead className="text-right">Bruto (itens)</TableHead>
                    <TableHead className="text-right">Bruto (empresa)</TableHead>
                    <TableHead className="text-right">Δ Bruto</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead className="text-right">Excluídos</TableHead>
                    <TableHead>Resumo financeiro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroups.map((g) => {
                    const key = g.company_id ?? "__sem_pj__";
                    const agg = result.byCompany.get(key) ?? emptyAgg();
                    const brutoEmpresa = Number(g.bruto_total ?? 0);
                    const pcfRow = g.company_id ? result.pcf.get(g.company_id) : undefined;
                    const liquido = Number(g.liquido_total ?? pcfRow?.liquido ?? g.total_amount ?? 0);
                    const elegiveis = agg.count - agg.cancelledCount - agg.absorbedCount;
                    return (
                      <TableRow key={key}>
                        <TableCell className="max-w-[280px] truncate">{g.company_name ?? "—"}</TableCell>
                        <TableCell className="text-right">{g.items_count ?? 0}</TableCell>
                        <TableCell className="text-right">{elegiveis}</TableCell>
                        <TableCell className="text-right">{fmt(agg.gross)}</TableCell>
                        <TableCell className="text-right">{fmt(brutoEmpresa)}</TableCell>
                        <TableCell className="text-right">
                          <DiffBadge diff={agg.gross - brutoEmpresa} />
                        </TableCell>
                        <TableCell className="text-right">{fmt(liquido)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {agg.cancelledCount + agg.absorbedCount > 0
                            ? `${agg.cancelledCount + agg.absorbedCount} · ${fmt(agg.cancelledGross + agg.absorbedGross)}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {pcfRow ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                              OK
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400">
                              Ausente
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredGroups.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                        Nenhuma empresa encontrada.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default BatchTotalsAudit;
