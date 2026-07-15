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
import { KpiCard } from "@/components/ui/KpiCard";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Download, FileSpreadsheet, FileText, Info, MinusCircle, Scale, TrendingDown, TrendingUp, Undo2 } from "lucide-react";
import { exportInterventionExcel, exportInterventionPdf, exportInterventionExcelSintetico, exportInterventionPdfSintetico } from "@/lib/interventionReport";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useHospital } from "@/contexts/HospitalContext";
import { useAuth } from "@/contexts/AuthContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MultiSelectPopover } from "@/components/ui/MultiSelectPopover";
import {
  emptyResult,
  filterItems,
  impactTone,
  isCancellationNeutral,
  itemsToCsv,
  summarizeItems,
  roleLabel,
  type InterventionFilters,
  type InterventionItem,
  type InterventionSavingsResult,
  type IntervenorRole,
} from "@/lib/interventionSavings";
import { reasonLabel, isEconomiaRealReason } from "@/lib/cancelledPayments";
import { logExport } from "@/lib/exportLog";
import InterventionPreviewSection from "@/components/intervention/InterventionPreviewSection";

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
    role: "glosa_pj",
    hint: "Glosa aplicada por PJ: soma das aplicações confirmadas da glosa naquela empresa dentro do lote. Entra 100% como economia — reflete o valor efetivamente descontado da PJ.",
  },
  {
    role: "ajuste_manual",
    hint: "Ajuste manual de valor no item feito pelo analista fora dos fluxos de aceite. Δ = valor regra − valor pago final.",
  },
  {
    role: "aceite_esperado",
    hint: "Analista/validador acatou o valor esperado do motor. Δ = valor pago original − valor esperado (positivo = economia).",
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

/**
 * A RPC `get_intervention_savings` não retorna `cancellation_reason`. Buscamos os motivos
 * dos itens cancelados em `payment_items` e juntamos client-side para classificar como
 * economia real vs neutro (operacional).
 */
async function enrichItemsWithCancellationReasons(
  items: InterventionItem[],
): Promise<InterventionItem[]> {
  const cancellationRoles = new Set(["cancelamento_item", "cancelamento_empresa"]);
  const itemIds = Array.from(
    new Set(
      items
        .filter((it) => cancellationRoles.has(it.role) && it.item_id)
        .map((it) => it.item_id),
    ),
  );
  if (itemIds.length === 0) return items;
  // Supabase tem limite prático de ~1000 IDs por `in()`. Paginamos por segurança.
  const reasonByItem = new Map<string, string | null>();
  const chunkSize = 500;
  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const slice = itemIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("payment_items")
      .select("id, cancellation_reason")
      .in("id", slice);
    if (error) {
      // Não bloqueia o relatório — apenas perde a classificação fina (cai em neutro).
      console.warn("[InterventionAdjustments] enrich reasons failed", error);
      continue;
    }
    for (const row of (data ?? []) as Array<{ id: string; cancellation_reason: string | null }>) {
      reasonByItem.set(row.id, row.cancellation_reason);
    }
  }
  return items.map((it) =>
    cancellationRoles.has(it.role)
      ? { ...it, cancellation_reason: reasonByItem.get(it.item_id) ?? null }
      : it,
  );
}

/**
 * Busca o `reference` (identificador do lote) dos pagamentos referenciados
 * pelos itens ajustados. Serve para exibir origem na tabela — permite
 * identificar rapidamente lotes de teste/imputação que não deveriam contar.
 */
async function fetchPaymentRefs(
  items: InterventionItem[],
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(items.map((it) => it.payment_id).filter(Boolean)));
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("payments")
      .select("id, reference")
      .in("id", slice);
    if (error) {
      console.warn("[InterventionAdjustments] fetch payment refs failed", error);
      continue;
    }
    for (const row of (data ?? []) as Array<{ id: string; reference: string | null }>) {
      if (row.reference) map.set(row.id, row.reference);
    }
  }
  return map;
}

export default function InterventionAdjustments() {
  const currentHospitalId = useActiveHospitalId();
  const { hospital: currentHospital } = useHospital();
  const { hasRole } = useAuth();
  const canReactivate = hasRole("admin") || hasRole("diretor") || hasRole("validador");
  const [params] = useSearchParams();
  const initialRole = (params.get("role") as IntervenorRole | null) ?? "all";
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InterventionSavingsResult>(emptyResult());
  const [paymentRefs, setPaymentRefs] = useState<Map<string, string>>(new Map());
  const [filters, setFilters] = useState<InterventionFilters>({
    role: initialRole,
    userId: "all",
    search: "",
    // Padrão: Neutro fora — reduz ruído de cancelamentos operacionais.
    classifications: ["economia", "aumento"],
  });

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
    if (!error) {
      const result = (res as unknown as InterventionSavingsResult) ?? emptyResult();
      const enrichedItems = await enrichItemsWithCancellationReasons(result.items ?? []);
      setData({ ...result, items: enrichedItems });
      setPaymentRefs(await fetchPaymentRefs(enrichedItems));
    }
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
        const result = (res as unknown as InterventionSavingsResult) ?? emptyResult();
        const enrichedItems = await enrichItemsWithCancellationReasons(result.items ?? []);
        const refs = await fetchPaymentRefs(enrichedItems);
        if (!cancelled) {
          setData({ ...result, items: enrichedItems });
          setPaymentRefs(refs);
        }
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
    const base = filterItems(data.items, { ...filters, role: "all", roles: [] });

    const acc: Record<IntervenorRole, { qtd: number; saldo: number }> = {
      diretor: { qtd: 0, saldo: 0 },
      validador: { qtd: 0, saldo: 0 },
      analista: { qtd: 0, saldo: 0 },
      cancelamento_empresa: { qtd: 0, saldo: 0 },
      cancelamento_item: { qtd: 0, saldo: 0 },
      cancelamento_conciliacao: { qtd: 0, saldo: 0 },
      aceite_esperado: { qtd: 0, saldo: 0 },
      aceite_pago: { qtd: 0, saldo: 0 },
      ajuste_manual: { qtd: 0, saldo: 0 },
      glosa: { qtd: 0, saldo: 0 },
      glosa_pj: { qtd: 0, saldo: 0 },
      cancelamento: { qtd: 0, saldo: 0 },
    };
    for (const it of base) {
      if (!acc[it.role]) acc[it.role] = { qtd: 0, saldo: 0 };
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

  // Opções dinâmicas — só o que aparece nos itens do período atual, para não poluir
  // o select com valores inexistentes. Ordena alfabeticamente.
  const loteOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of data.items) {
      if (!it.payment_id) continue;
      map.set(it.payment_id, paymentRefs.get(it.payment_id) ?? `${it.payment_id.slice(0, 8)}…`);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data.items, paymentRefs]);

  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of data.items) if (it.company_name) set.add(it.company_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data.items]);

  const doctorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of data.items) if (it.doctor_name) set.add(it.doctor_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data.items]);

  const hasActiveFilters =
    (filters.role && filters.role !== "all") ||
    (filters.userId && filters.userId !== "all") ||
    (filters.paymentId && filters.paymentId !== "all") ||
    (filters.companyName && filters.companyName !== "all") ||
    (filters.doctorName && filters.doctorName !== "all") ||
    (filters.classification && filters.classification !== "all") ||
    (filters.roles?.length ?? 0) > 0 ||
    (filters.userIds?.length ?? 0) > 0 ||
    (filters.paymentIds?.length ?? 0) > 0 ||
    (filters.companyNames?.length ?? 0) > 0 ||
    (filters.doctorNames?.length ?? 0) > 0 ||
    // Considera "padrão" quando classifications = [economia, aumento].
    (() => {
      const c = filters.classifications ?? [];
      const isDefault = c.length === 2 && c.includes("economia") && c.includes("aumento");
      return c.length > 0 && !isDefault;
    })() ||
    filters.minValue != null ||
    filters.maxValue != null ||
    (filters.search ?? "").trim() !== "";



  return (
    <div>
      <PageHeader
        title="Ajustes por intervenção"
        description="Impacto financeiro em R$ de devoluções, correções, cancelamentos de item e cancelamentos de empresa"
        icon={Scale}
        showBack
      />
      <div className="p-4 md:p-6 space-y-4">
        {/* Prévia de lotes em andamento — não gravado no ledger */}
        <InterventionPreviewSection />

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
              <MultiSelectPopover
                width="w-[200px]"
                allLabel="Todos os papéis"
                placeholder="Buscar papel…"
                values={filters.roles ?? []}
                onChange={(v) => setFilters((f) => ({ ...f, roles: v, role: "all" }))}
                options={[
                  { value: "diretor", label: "Diretor" },
                  { value: "validador", label: "Supervisor" },
                  { value: "analista", label: "Analista" },
                  { value: "glosa_pj", label: "Glosa aplicada (PJ)" },
                  { value: "ajuste_manual", label: "Ajuste manual" },
                  { value: "aceite_esperado", label: "Aceite do esperado" },
                  { value: "aceite_pago", label: "Aceite mantendo pago" },
                  { value: "cancelamento_empresa", label: "Cancelamento empresa" },
                  { value: "cancelamento_item", label: "Cancelamento item" },
                  { value: "cancelamento_conciliacao", label: "Cancelamento via conciliação" },
                ]}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Classificação</label>
              <MultiSelectPopover
                width="w-[170px]"
                allLabel="Todas"
                searchable={false}
                values={filters.classifications ?? []}
                onChange={(v) =>
                  setFilters((f) => ({
                    ...f,
                    classifications: v as Array<"economia" | "aumento" | "neutro">,
                    classification: "all",
                  }))
                }
                options={[
                  { value: "economia", label: "Economia" },
                  { value: "aumento", label: "Aumento (perda)" },
                  { value: "neutro", label: "Neutro" },
                ]}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Usuário</label>
              <MultiSelectPopover
                width="w-[220px]"
                allLabel="Todos"
                placeholder="Buscar usuário…"
                values={filters.userIds ?? []}
                onChange={(v) => setFilters((f) => ({ ...f, userIds: v, userId: "all" }))}
                options={users.map((u) => ({ value: u.id, label: u.name }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Δ mínimo (R$)</label>
              <Input
                type="number"
                inputMode="decimal"
                className="w-[110px]"
                value={filters.minValue ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, minValue: e.target.value === "" ? null : Number(e.target.value) }))}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Δ máximo (R$)</label>
              <Input
                type="number"
                inputMode="decimal"
                className="w-[110px]"
                value={filters.maxValue ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, maxValue: e.target.value === "" ? null : Number(e.target.value) }))}
                placeholder="—"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Lote</label>
              <MultiSelectPopover
                width="w-[200px]"
                allLabel={`Todos (${loteOptions.length})`}
                placeholder="Buscar lote…"
                values={filters.paymentIds ?? []}
                onChange={(v) => setFilters((f) => ({ ...f, paymentIds: v, paymentId: "all" }))}
                options={loteOptions.map((l) => ({ value: l.id, label: l.label }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Empresa</label>
              <MultiSelectPopover
                width="w-[220px]"
                allLabel={`Todas (${companyOptions.length})`}
                placeholder="Buscar empresa…"
                values={filters.companyNames ?? []}
                onChange={(v) => setFilters((f) => ({ ...f, companyNames: v, companyName: "all" }))}
                options={companyOptions.map((c) => ({ value: c, label: c }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Médico</label>
              <MultiSelectPopover
                width="w-[220px]"
                allLabel={`Todos (${doctorOptions.length})`}
                placeholder="Buscar médico…"
                values={filters.doctorNames ?? []}
                onChange={(v) => setFilters((f) => ({ ...f, doctorNames: v, doctorName: "all" }))}
                options={doctorOptions.map((d) => ({ value: d, label: d }))}
              />
            </div>


            <div className="space-y-1 flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Buscar (médico, empresa, procedimento)</label>
              <Input
                value={filters.search ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Ex: cardiologia, Acme, 31309096"
              />
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                onClick={() =>
                  setFilters({
                    role: "all",
                    userId: "all",
                    paymentId: "all",
                    companyName: "all",
                    doctorName: "all",
                    classification: "all",
                    roles: [],
                    userIds: [],
                    paymentIds: [],
                    companyNames: [],
                    doctorNames: [],
                    classifications: ["economia", "aumento"],
                    minValue: null,
                    maxValue: null,
                    search: "",
                  })
                }
              >
                Restaurar padrão
              </Button>
            )}


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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={filteredItems.length === 0}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await exportInterventionExcel({
                        hospitalName: currentHospital?.name ?? null,
                        rangeDays: range,
                        summary: filteredSummary,
                        items: filteredItems,
                      });
                      void logExport({
                        reportKey: "intervention_adjustments",
                        reportLabel: "Ajustes por intervenção",
                        format: "csv",
                        filters: { range, ...filters, export: "xlsx", mode: "analitico" },
                        hospitalId: currentHospitalId ?? null,
                        rowCount: filteredItems.length,
                      });
                    } catch (e: any) {
                      toast.error("Falha ao gerar Excel", { description: e?.message });
                    }
                  }}
                >
                  Analítico (item a item)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await exportInterventionExcelSintetico({
                        hospitalName: currentHospital?.name ?? null,
                        rangeDays: range,
                        summary: filteredSummary,
                        items: filteredItems,
                      });
                      void logExport({
                        reportKey: "intervention_adjustments",
                        reportLabel: "Ajustes por intervenção",
                        format: "csv",
                        filters: { range, ...filters, export: "xlsx", mode: "sintetico" },
                        hospitalId: currentHospitalId ?? null,
                        rowCount: filteredItems.length,
                      });
                    } catch (e: any) {
                      toast.error("Falha ao gerar Excel sintético", { description: e?.message });
                    }
                  }}
                >
                  Sintético (consolidado)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={filteredItems.length === 0}>
                  <FileText className="h-4 w-4 mr-2" /> PDF
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await exportInterventionPdf({
                        hospitalName: currentHospital?.name ?? null,
                        rangeDays: range,
                        summary: filteredSummary,
                        items: filteredItems,
                      });
                      void logExport({
                        reportKey: "intervention_adjustments",
                        reportLabel: "Ajustes por intervenção",
                        format: "pdf",
                        filters: { range, ...filters, mode: "analitico" },
                        hospitalId: currentHospitalId ?? null,
                        rowCount: filteredItems.length,
                      });
                    } catch (e: any) {
                      toast.error("Falha ao gerar PDF", { description: e?.message });
                    }
                  }}
                >
                  Analítico (item a item)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await exportInterventionPdfSintetico({
                        hospitalName: currentHospital?.name ?? null,
                        rangeDays: range,
                        summary: filteredSummary,
                        items: filteredItems,
                      });
                      void logExport({
                        reportKey: "intervention_adjustments",
                        reportLabel: "Ajustes por intervenção",
                        format: "pdf",
                        filters: { range, ...filters, mode: "sintetico" },
                        hospitalId: currentHospitalId ?? null,
                        rowCount: filteredItems.length,
                      });
                    } catch (e: any) {
                      toast.error("Falha ao gerar PDF sintético", { description: e?.message });
                    }
                  }}
                >
                  Sintético (consolidado)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard
            icon={TrendingUp}
            label="Valor recuperado"
            value={formatCurrency(filteredSummary.economia)}
            hint="Cancelamentos de economia real + ajustes que reduziram o pagamento"
            tone="success"
            loading={loading}
          />
          <SummaryCard
            icon={TrendingDown}
            label="Valor extra a pagar"
            value={formatCurrency(filteredSummary.perda)}
            hint="Pagto final > valor regra"
            tone="destructive"
            loading={loading}
          />
          <SummaryCard
            icon={MinusCircle}
            label="Neutro (operacional)"
            value={formatCurrency(filteredSummary.neutro)}
            hint="Intervenções sem impacto financeiro: confirmações de valor e cancelamentos operacionais. Não somam no saldo."
            tone="muted"
            loading={loading}
          />
          <SummaryCard
            icon={Scale}
            label="Saldo líquido"
            value={formatCurrency(filteredSummary.saldo)}
            hint={`${filteredSummary.qtd_itens} item(ns) ajustado(s). Convenção: "−" verde = hospital pagou menos (valor recuperado); "+" vermelho = pagou mais (valor extra a pagar).`}
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
                  const activeRoles = filters.roles ?? [];
                  const active = activeRoles.includes(r);
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
                        onClick={() =>
                          setFilters((f) => {
                            const cur = f.roles ?? [];
                            const next = cur.includes(r)
                              ? cur.filter((x) => x !== r)
                              : [...cur, r];
                            return { ...f, roles: next, role: "all" };
                          })
                        }
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
                {(filters.roles?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, roles: [], role: "all" }))}
                    className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60 self-stretch"
                  >
                    Limpar filtro
                  </button>
                )}

              </div>
            </TooltipProvider>
            <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-semibold">Como o saldo é calculado:</span> Saldo = Valor recuperado − Valor extra a pagar.
              Ajustes de diretor/supervisor/analista entram pelo Δ (Δ &gt; 0 vira <span className="text-success">Valor recuperado</span>;
              Δ &lt; 0 vira <span className="text-destructive">Valor extra a pagar</span>).
              Já <strong>cancelamentos manuais</strong> só entram como valor recuperado quando o motivo é
              de economia real (médico fatura externamente, contrato encerrado, glosa, jurídico,
              duplicidade externa). Motivos operacionais (<em>pago em outro lote</em>,
              <em> duplicidade corrigida pelo motor</em>, <em>outro</em>) ficam em
              <span className="text-muted-foreground"> Neutro</span> e não somam no saldo.
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
                  <TableHead className="text-right">Recuperado</TableHead>
                  <TableHead className="text-right">Extra a pagar</TableHead>
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
            <div className="overflow-x-hidden overflow-y-auto max-h-[560px]">
              <Table className="w-full table-fixed text-xs [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 [&_td]:align-top [&_td]:break-words">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[88px]">Data</TableHead>
                    <TableHead className="w-[160px]">Lote</TableHead>
                    <TableHead className="w-[140px]">Autor</TableHead>
                    <TableHead className="w-[220px]">Empresa / Médico</TableHead>
                    <TableHead className="w-[200px]">Procedimento</TableHead>
                    <TableHead className="w-[88px] text-right">Valor regra</TableHead>
                    <TableHead className="w-[88px] text-right">Pago final</TableHead>
                    <TableHead className="w-[88px] text-right">Δ</TableHead>
                    <TableHead className="w-[96px]">Classificação</TableHead>
                    <TableHead className="w-[130px]"></TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={10}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                  )}
                  {!loading && filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-muted-foreground text-center py-6">
                        Sem itens para os filtros atuais.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && filteredItems.map((it) => {
                    const isNeutralCancellation = isCancellationNeutral(it);
                    const isCancellationRole =
                      it.role === "cancelamento_item" || it.role === "cancelamento_empresa";
                    const positivo = it.delta > 0;
                    const zeroDelta = Math.abs(it.delta) < 0.005;
                    // Classificação visual: neutro (cancelamento sem motivo de economia real),
                    // economia, perda ou zero.
                    const classification: "neutro" | "economia" | "aumento" = isNeutralCancellation
                      ? "neutro"
                      : zeroDelta
                      ? "neutro"
                      : positivo
                      ? "economia"
                      : "aumento";
                    return (
                      <TableRow key={it.item_id}>
                        <TableCell className="text-sm">{fmtDate(it.acatado_at)}</TableCell>
                        <TableCell className="text-xs">
                          <Link
                            to={`/pagamentos/${it.payment_id}`}
                            className="text-primary hover:underline break-all"
                            title="Abrir lote de origem"
                          >
                            {paymentRefs.get(it.payment_id) ?? `${it.payment_id.slice(0, 8)}…`}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{it.autor}</div>
                          <Badge variant="outline" className="text-[10px] mt-0.5">
                            {roleLabel(it.role)}
                          </Badge>
                          {isCancellationRole && (
                            <div className="mt-1">
                              <Badge
                                variant="outline"
                                className={
                                  "text-[10px] " +
                                  (isEconomiaRealReason(it.cancellation_reason)
                                    ? "border-success/30 text-success"
                                    : "border-muted-foreground/30 text-muted-foreground")
                                }
                                title="Motivo do cancelamento"
                              >
                                {it.cancellation_reason
                                  ? reasonLabel(it.cancellation_reason)
                                  : "Sem motivo classificado"}
                              </Badge>
                            </div>
                          )}
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
                        <TableCell
                          className={`text-right font-semibold ${
                            classification === "neutro"
                              ? "text-muted-foreground"
                              : classification === "economia"
                              ? "text-success"
                              : "text-destructive"
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {classification === "neutro"
                              ? null
                              : classification === "economia"
                              ? <ArrowUpRight className="h-3 w-3" />
                              : <ArrowDownRight className="h-3 w-3" />}
                            {formatCurrency(Math.abs(it.delta))}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              classification === "neutro"
                                ? "border-border text-muted-foreground"
                                : classification === "economia"
                                ? "border-success/40 text-success bg-success/5"
                                : "border-destructive/40 text-destructive bg-destructive/5"
                            }
                          >
                            {classification === "neutro"
                              ? "Neutro"
                              : classification === "economia"
                              ? "Recuperado"
                              : "Extra a pagar"}
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
                                disabled={reactivatingIds.has(it.item_id)}
                                onClick={() => handleReactivate(it.item_id)}
                                title="Reverter cancelamento e devolver item ao pagamento"
                              >
                                <Undo2 className="h-3.5 w-3.5 mr-1" />
                                {reactivatingIds.has(it.item_id) ? "..." : "Reativar"}
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
  icon: _Icon, label, value, hint, tone, loading,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string; value: string; hint?: string;
  tone: "success" | "destructive" | "muted";
  loading?: boolean;
}) {
  const kpiTone = tone === "success" ? "success" : tone === "destructive" ? "danger" : "default";
  return (
    <KpiCard
      label={label}
      value={loading ? <Skeleton className="h-8 w-32" /> : value}
      hint={hint}
      tone={kpiTone}
    />
  );
}
