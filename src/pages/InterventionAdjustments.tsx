import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Download, Info, Scale, TrendingDown, TrendingUp, Undo2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  emptyResult,
  filterItems,
  impactTone,
  itemsToCsv,
  summarizeItems,
  roleLabel,
  type InterventionFilters,
  type InterventionSavingsResult,
  type IntervenorRole,
} from "@/lib/interventionSavings";
import { logExport } from "@/lib/exportLog";

type Range = 7 | 30 | 90 | 180;

const ROLE_CHIPS: { role: IntervenorRole; hint: string }[] = [
  {
    role: "diretor",
    hint: "Devolução do diretor: ele aprovou pagar um valor diferente do que a regra calculou. Δ = valor da regra − valor pago final. Se ele cortou (pagou menos), entra como economia; se aumentou, entra como perda.",
  },
  {
    role: "validador",
    hint: "Revisão do supervisor/validador: ajuste feito antes de subir para o diretor. Mesma fórmula de Δ — corte vira economia, aumento vira perda no saldo.",
  },
  {
    role: "analista",
    hint: "Correção do analista: alteração de valor durante a análise inicial. Δ = valor antigo − valor novo. Reduzir o pagamento gera economia; aumentar gera perda.",
  },
  {
    role: "cancelamento_empresa",
    hint: "Empresa cancelada manualmente: todos os itens da PJ deixaram de ser pagos por decisão do analista (médico fatura externamente, contrato encerrado, etc). Entra 100% como economia.",
  },
  {
    role: "cancelamento_item",
    hint: "Item individual cancelado manualmente: linha específica anulada (duplicidade, contestação procedente, etc). Conta 100% do valor bruto como economia.",
  },
  {
    role: "cancelamento_conciliacao",
    hint: "Cancelamento disparado pelo motor de conciliação: itens removidos do pagamento porque o atendimento ou a empresa não estava mais na base do hospital. Mantém vínculo com a rodada de conciliação que originou.",
  },
];

const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function InterventionAdjustments() {
  const currentHospitalId = useActiveHospitalId();
  const { hasRole } = useAuth();
  const canReactivate = hasRole("admin") || hasRole("diretor") || hasRole("validador");
  const [params] = useSearchParams();
  const initialRole = (params.get("role") as IntervenorRole | null) ?? "all";
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InterventionSavingsResult>(emptyResult());
  const [filters, setFilters] = useState<InterventionFilters>({ role: initialRole, userId: "all", search: "" });
  // Set para permitir múltiplas reativações em paralelo de IDs distintos sem
  // que uma sobrescreva o estado da outra, e bloqueia retry no mesmo id.
  const [reactivatingIds, setReactivatingIds] = useState<Set<string>>(new Set());

  const reloadData = async () => {
    const end = new Date();
    const start = new Date(end.getTime() - range * 24 * 3600 * 1000);
    const { data: res, error } = await supabase.rpc("get_intervention_savings", {
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_hospital_id: currentHospitalId ?? null,
    });
    if (!error) setData((res as unknown as InterventionSavingsResult) ?? emptyResult());
  };

  const handleReactivate = async (itemId: string) => {
    // Idempotência: clique duplo no mesmo botão não dispara duas chamadas.
    if (reactivatingIds.has(itemId)) return;
    setReactivatingIds((prev) => new Set(prev).add(itemId));
    const toastId = toast.loading("Reativando item...");
    const { error } = await supabase.rpc("reactivate_cancelled_item", { p_item_id: itemId });
    setReactivatingIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    toast.dismiss(toastId);
    if (error) {
      toast.error("Falha ao reativar", { description: error.message });
      return;
    }
    toast.success("Item reativado. O cancelamento foi desfeito.");
    await reloadData();
  };


  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const end = new Date();
        const start = new Date(end.getTime() - range * 24 * 3600 * 1000);
        const { data: res, error } = await supabase.rpc("get_intervention_savings", {
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_hospital_id: currentHospitalId ?? null,
        });
        if (error) throw error;
        if (!cancelled) setData((res as unknown as InterventionSavingsResult) ?? emptyResult());
      } catch (e) {
        console.error(e);
        toast.error("Falha ao carregar ajustes por intervenção");
        if (!cancelled) setData(emptyResult());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, currentHospitalId]);

  const filteredItems = useMemo(() => filterItems(data.items, filters), [data.items, filters]);
  const filteredSummary = useMemo(() => summarizeItems(filteredItems), [filteredItems]);
  const saldoTone = impactTone(filteredSummary.saldo);

  /** Contadores por classificação semântica — sempre sobre o período (ignora filtro de papel). */
  const roleCounts = useMemo(() => {
    const base = filterItems(data.items, { ...filters, role: "all" });
    const acc: Record<IntervenorRole, { qtd: number; saldo: number }> = {
      diretor: { qtd: 0, saldo: 0 },
      validador: { qtd: 0, saldo: 0 },
      analista: { qtd: 0, saldo: 0 },
      cancelamento_empresa: { qtd: 0, saldo: 0 },
      cancelamento_item: { qtd: 0, saldo: 0 },
      cancelamento_conciliacao: { qtd: 0, saldo: 0 },
    };
    for (const it of base) {
      acc[it.role].qtd += 1;
      acc[it.role].saldo += it.delta;
    }
    return acc;
  }, [data.items, filters]);

  const users = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; role: IntervenorRole }>();
    for (const u of data.by_user) seen.set(u.user_id, { id: u.user_id, name: u.nome, role: u.role });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.by_user]);

  return (
    <div>
      <PageHeader
        title="Ajustes por intervenção"
        description="Impacto financeiro em R$ de devoluções, correções, cancelamentos de item e cancelamentos de empresa"
        icon={Scale}
        showBack
      />
      <div className="p-4 md:p-6 space-y-4">
        {/* Filtros */}
        <Card className="shadow-card">
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Período</label>
              <Select value={String(range)} onValueChange={(v) => setRange(Number(v) as Range)}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Últimos 7d</SelectItem>
                  <SelectItem value="30">Últimos 30d</SelectItem>
                  <SelectItem value="90">Últimos 90d</SelectItem>
                  <SelectItem value="180">Últimos 180d</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Papel</label>
              <Select
                value={filters.role ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, role: v as IntervenorRole | "all" }))}
              >
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="diretor">Diretor</SelectItem>
                  <SelectItem value="validador">Supervisor</SelectItem>
                  <SelectItem value="analista">Analista</SelectItem>
                  <SelectItem value="cancelamento_empresa">Cancelamento empresa</SelectItem>
                  <SelectItem value="cancelamento_item">Cancelamento item</SelectItem>
                  <SelectItem value="cancelamento_conciliacao">Cancelamento via conciliação</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Usuário</label>
              <Select
                value={filters.userId ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, userId: v }))}
              >
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Buscar (médico, empresa, procedimento)</label>
              <Input
                value={filters.search ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Ex: cardiologia, Acme, 31309096"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                downloadCsv(`ajustes-intervencao-${range}d.csv`, itemsToCsv(filteredItems));
                void logExport({
                  reportKey: "intervention_adjustments",
                  reportLabel: "Ajustes por intervenção",
                  format: "csv",
                  filters: { range, ...filters },
                  hospitalId: currentHospitalId ?? null,
                  rowCount: filteredItems.length,
                });
              }}
              disabled={filteredItems.length === 0}
            >
              <Download className="h-4 w-4 mr-2" /> Exportar CSV
            </Button>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryCard
            icon={TrendingUp}
            label="Economia"
            value={formatCurrency(filteredSummary.economia)}
            hint="Pagto final < valor regra"
            tone="success"
            loading={loading}
          />
          <SummaryCard
            icon={TrendingDown}
            label="Perda"
            value={formatCurrency(filteredSummary.perda)}
            hint="Pagto final > valor regra"
            tone="destructive"
            loading={loading}
          />
          <SummaryCard
            icon={Scale}
            label="Saldo líquido"
            value={formatCurrency(filteredSummary.saldo)}
            hint={`${filteredSummary.qtd_itens} item(ns) ajustado(s)`}
            tone={saldoTone === "positive" ? "success" : saldoTone === "negative" ? "destructive" : "muted"}
            loading={loading}
          />
        </div>

        {/* Classificação dos itens — chips clicáveis para filtrar por papel */}
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Classificação dos itens</CardTitle>
            <div className="text-xs text-muted-foreground">
              Clique em uma categoria para filtrar a tabela abaixo. Passe o mouse no <Info className="inline h-3 w-3 align-text-bottom" /> de cada chip para entender o que entra em cada classe e como afeta o saldo.
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <TooltipProvider delayDuration={150}>
              <div className="flex flex-wrap gap-2">
                {ROLE_CHIPS.map(({ role: r, hint }) => {
                  const c = roleCounts[r];
                  const active = filters.role === r;
                  const tone =
                    c.saldo > 0.005 ? "text-success" :
                    c.saldo < -0.005 ? "text-destructive" : "text-muted-foreground";
                  return (
                    <div
                      key={r}
                      className={
                        "rounded-lg border px-3 py-2 transition-colors hover:bg-muted/60 " +
                        (active ? "border-primary bg-primary/5" : "border-border")
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setFilters((f) => ({ ...f, role: active ? "all" : r }))}
                        className="text-left w-full"
                      >
                        <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                          <span>{roleLabel(r)}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center cursor-help"
                                aria-label={`O que é ${roleLabel(r)}`}
                              >
                                <Info className="h-3 w-3 opacity-60 hover:opacity-100" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                              {hint}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-semibold">{c.qtd}</span>
                          <span className={`text-xs ${tone}`}>{formatCurrency(c.saldo)}</span>
                        </div>
                      </button>
                    </div>
                  );
                })}
                {filters.role !== "all" && (
                  <button
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, role: "all" }))}
                    className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60 self-stretch"
                  >
                    Limpar filtro
                  </button>
                )}
              </div>
            </TooltipProvider>
            <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-semibold">Como o saldo é calculado:</span> Saldo = Economia − Perda.
              Itens com Δ &gt; 0 (pagou menos que a regra) entram em <span className="text-success">Economia</span>;
              Δ &lt; 0 (pagou a mais) entram em <span className="text-destructive">Perda</span>.
              Cancelamentos entram como economia integral (o valor que deixaria de ser pago).
            </div>
          </CardContent>
        </Card>





        {/* Por usuário */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Por usuário interventor</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead className="text-right">Itens</TableHead>
                  <TableHead className="text-right">Economia</TableHead>
                  <TableHead className="text-right">Perda</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                )}
                {!loading && data.by_user.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground text-center py-6">
                      Nenhuma intervenção com ajuste posterior no período.
                    </TableCell>
                  </TableRow>
                )}
                {!loading && data.by_user.map((u) => (
                  <TableRow key={u.user_id}>
                    <TableCell className="font-medium">{u.nome}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{roleLabel(u.role)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{u.qtd_itens}</TableCell>
                    <TableCell className="text-right text-success">{formatCurrency(u.economia)}</TableCell>
                    <TableCell className="text-right text-destructive">{formatCurrency(u.perda)}</TableCell>
                    <TableCell className={`text-right font-semibold ${u.saldo > 0 ? "text-success" : u.saldo < 0 ? "text-destructive" : ""}`}>
                      {formatCurrency(u.saldo)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Drill-down item-a-item */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">
              Itens ajustados ({filteredItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[560px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data acatamento</TableHead>
                    <TableHead>Autor</TableHead>
                    <TableHead>Empresa / Médico</TableHead>
                    <TableHead>Procedimento</TableHead>
                    <TableHead className="text-right">Valor regra</TableHead>
                    <TableHead className="text-right">Pago final</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead>Classificação</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={9}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                  )}
                  {!loading && filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-muted-foreground text-center py-6">
                        Sem itens para os filtros atuais.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && filteredItems.map((it) => {
                    const positivo = it.delta > 0;
                    const neutro = Math.abs(it.delta) < 0.005;
                    return (
                      <TableRow key={it.item_id}>
                        <TableCell className="text-sm">{fmtDate(it.acatado_at)}</TableCell>
                        <TableCell>
                          <div className="text-sm">{it.autor}</div>
                          <Badge variant="outline" className="text-[10px] mt-0.5">
                            {roleLabel(it.role)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{it.company_name ?? "—"}</div>
                          <div className="text-muted-foreground">{it.doctor_name ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-mono text-xs">{it.procedure_code ?? ""}</div>
                          <div className="text-muted-foreground">{it.procedure_name ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(it.valor_regra)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(it.valor_pago_final)}</TableCell>
                        <TableCell className={`text-right font-semibold ${neutro ? "" : positivo ? "text-success" : "text-destructive"}`}>
                          <span className="inline-flex items-center gap-1">
                            {neutro ? null : positivo ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {formatCurrency(Math.abs(it.delta))}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              neutro
                                ? "border-border text-muted-foreground"
                                : positivo
                                ? "border-success/40 text-success bg-success/5"
                                : "border-destructive/40 text-destructive bg-destructive/5"
                            }
                          >
                            {neutro ? "Neutro" : positivo ? "Economia" : "Aumento"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button asChild size="sm" variant="ghost">
                              <Link to={it.company_group_id ? `/pagamentos/${it.payment_id}/empresa/${it.company_group_id}#item-${it.item_id}` : `/pagamentos/${it.payment_id}#item-${it.item_id}`}>Abrir</Link>
                            </Button>
                            {(it.role === "cancelamento_conciliacao" || it.role === "cancelamento_item") && canReactivate && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={reactivatingId === it.item_id}
                                onClick={() => handleReactivate(it.item_id)}
                                title="Reverter cancelamento e devolver item ao pagamento"
                              >
                                <Undo2 className="h-3.5 w-3.5 mr-1" /> Reativar
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon, label, value, hint, tone, loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; hint?: string;
  tone: "success" | "destructive" | "muted";
  loading?: boolean;
}) {
  const ring =
    tone === "success" ? "border-success/30" :
    tone === "destructive" ? "border-destructive/30" :
    "border-border";
  const iconColor =
    tone === "success" ? "text-success" :
    tone === "destructive" ? "text-destructive" :
    "text-muted-foreground";
  return (
    <Card className={`shadow-card ${ring} border`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        {loading ? (
          <Skeleton className="h-7 w-32 mt-2" />
        ) : (
          <div className="text-2xl font-semibold mt-1">{value}</div>
        )}
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}
