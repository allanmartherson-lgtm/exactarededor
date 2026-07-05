import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { GitCompareIcon } from "@/config/icons/navIcons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Database, History, ShieldAlert } from "lucide-react";
import BlockingDivergencesTab from "@/components/conciliacao/BlockingDivergencesTab";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import RetroactiveReconciliationsTab from "@/components/retroactive/RetroactiveReconciliationsTab";
import BasesConciliacaoPanel from "@/components/conciliacao/BasesConciliacaoPanel";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatCompetenceBR } from "@/lib/dateUtils";

type RunRow = {
  id: string;
  payment_id: string;
  created_at: string;
  status: string;
  total_items: number;
  conciliado: number;
  valor_divergente: number;
  so_hospital: number;
  so_exacta: number;
};

type PaymentLite = {
  id: string;
  reference: string | null;
  competence_month: string | null;
  status: string;
};

const TAB_VALUES = ["pagamento", "bloqueios", "bases", "retroativa"] as const;
type TabValue = (typeof TAB_VALUES)[number];

export default function Conciliacao() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabValue = (TAB_VALUES as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as TabValue)
    : "pagamento";
  const setActiveTab = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === "pagamento") next.delete("tab");
    else next.set("tab", v);
    setSearchParams(next, { replace: true });
  };

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [paymentsById, setPaymentsById] = useState<Record<string, PaymentLite>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Contagem de bloqueios reais (exclui histórico e liberados). Se zero,
  // a aba fica escondida — evita ruído quando não há ação pendente.
  const [blockingCount, setBlockingCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: r } = await supabase
        .from("reconciliation_runs")
        .select("id,payment_id,created_at,status,total_items,conciliado,valor_divergente,so_hospital,so_exacta")
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      const list = (r ?? []) as RunRow[];
      setRuns(list);
      const ids = Array.from(new Set(list.map((x) => x.payment_id))).filter(Boolean);
      if (ids.length > 0) {
        const { data: ps } = await supabase
          .from("payments")
          .select("id, reference, competence_month, status")
          .in("id", ids);
        const map: Record<string, PaymentLite> = {};
        (ps ?? []).forEach((p: PaymentLite) => { map[p.id] = p; });
        setPaymentsById(map);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Contagem leve pra decidir se a aba "Divergências bloqueantes" aparece.
  // Ignora lotes em modo histórico (regra de projeto: histórico não bloqueia).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: cfg } = await supabase
        .from("system_configurations")
        .select("value")
        .eq("key", "divergence_thresholds")
        .maybeSingle();
      const v = (cfg?.value ?? {}) as Record<string, unknown>;
      const blockPct = Number(v.group_block_pct ?? 0.5);
      const blockAbs = Number(v.group_block_abs ?? 1.0);

      const { data } = await supabase
        .from("vw_group_rule_totals")
        .select("payment_id,diferenca,diferenca_pct")
        .limit(500);
      const rows = (data ?? []) as Array<{ payment_id: string | null; diferenca: number | null; diferenca_pct: number | null }>;
      const overLimit = rows.filter((r) => Math.abs(Number(r.diferenca ?? 0)) > blockAbs && Math.abs(Number(r.diferenca_pct ?? 0)) > blockPct);
      const paymentIds = Array.from(new Set(overLimit.map((r) => r.payment_id).filter(Boolean))) as string[];
      let historic = new Set<string>();
      if (paymentIds.length) {
        const { data: ps } = await supabase.from("payments").select("id,import_mode").in("id", paymentIds);
        historic = new Set((ps ?? []).filter((p: { import_mode: string | null }) => p.import_mode === "historico").map((p: { id: string }) => p.id));
      }
      const count = overLimit.filter((r) => !r.payment_id || !historic.has(r.payment_id)).length;
      if (!cancelled) setBlockingCount(count);
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) => {
      const p = paymentsById[r.payment_id];
      return (
        (p?.reference ?? "").toLowerCase().includes(q) ||
        (p?.competence_month ?? "").toLowerCase().includes(q)
      );
    });
  }, [runs, paymentsById, search]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Conciliação"
        icon={GitCompareIcon as never}
        showBack={false}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pagamento">
            <Wallet className="h-[18px] w-[18px] opacity-60 transition-transform group-hover:scale-110 group-data-[state=active]:opacity-100" />
            <span>Do pagamento</span>
            {runs.length > 0 && (
              <span className="ml-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-bold leading-none text-muted-foreground group-data-[state=active]:border-primary-foreground/20 group-data-[state=active]:bg-primary/70 group-data-[state=active]:text-primary-foreground">
                {runs.length}
              </span>
            )}
          </TabsTrigger>
          {(blockingCount ?? 0) > 0 && (
            <TabsTrigger value="bloqueios">
              <ShieldAlert className="h-[18px] w-[18px] opacity-60 transition-transform group-hover:scale-110 group-data-[state=active]:opacity-100" />
              <span>Divergências bloqueantes</span>
              <span className="ml-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive group-data-[state=active]:border-primary-foreground/20 group-data-[state=active]:bg-primary/70 group-data-[state=active]:text-primary-foreground">
                {blockingCount}
              </span>
            </TabsTrigger>
          )}
          <TabsTrigger value="bases">
            <Database className="h-[18px] w-[18px] opacity-60 transition-transform group-hover:scale-110 group-data-[state=active]:opacity-100" />
            <span>Bases hospitalares</span>
          </TabsTrigger>
          <TabsTrigger value="retroativa">
            <History className="h-[18px] w-[18px] opacity-60 transition-transform group-hover:scale-110 group-data-[state=active]:opacity-100" />
            <span>Retroativa</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pagamento" className="mt-4 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Conciliações executadas dentro de cada pagamento — base hospitalar × Exacta.
            Clique numa linha para abrir o pagamento e revisar a conciliação.
          </p>
          <Input
            placeholder="Buscar por nº do pagamento ou competência…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="md:max-w-sm"
          />
          {/* Desktop: tabela */}
          <div className="hidden md:block rounded-lg border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Executada em</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead className="text-right">Itens</TableHead>
                  <TableHead className="text-right">Conciliados</TableHead>
                  <TableHead className="text-right">Divergentes</TableHead>
                  <TableHead className="text-right">Só hospital</TableHead>
                  <TableHead className="text-right">Só Exacta</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!loading && filteredRuns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      Nenhuma conciliação encontrada.
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  filteredRuns.map((r) => {
                    const p = paymentsById[r.payment_id];
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => navigate(`/pagamentos/${r.payment_id}`)}
                      >
                        <TableCell className="text-[12.5px] text-muted-foreground whitespace-nowrap">
                          {format(new Date(r.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell className="font-medium">{p?.reference ?? "—"}</TableCell>
                        <TableCell>{p?.competence_month ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.total_items}</TableCell>
                        <TableCell className="text-right tabular-nums text-success">{r.conciliado}</TableCell>
                        <TableCell className="text-right tabular-nums text-warning">{r.valor_divergente}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.so_hospital}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.so_exacta}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "done" ? "outline" : r.status === "error" ? "destructive" : "secondary"}>
                            {r.status === "done" ? "Concluída" : r.status === "error" ? "Erro" : "Processando"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden flex flex-col gap-3">
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-lg" />
              ))}
            {!loading && filteredRuns.length === 0 && (
              <div className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
                Nenhuma conciliação encontrada.
              </div>
            )}
            {!loading &&
              filteredRuns.map((r) => {
                const p = paymentsById[r.payment_id];
                const isOpen = expandedId === r.id;
                return (
                  <div
                    key={r.id}
                    className="rounded-lg border border-border bg-card overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : r.id)}
                      aria-expanded={isOpen}
                      className="w-full text-left p-4 flex flex-col gap-2 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-[15px] font-semibold text-foreground break-words leading-snug">
                            {p?.reference ?? "—"}
                          </div>
                          <div className="text-[12px] text-muted-foreground mt-0.5 break-words">
                            {p?.competence_month ?? "—"} · {format(new Date(r.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                          </div>
                        </div>
                        <Badge
                          variant={r.status === "done" ? "outline" : r.status === "error" ? "destructive" : "secondary"}
                          className="flex-shrink-0"
                        >
                          {r.status === "done" ? "Concluída" : r.status === "error" ? "Erro" : "Processando"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span className="tabular-nums">
                          {r.total_items} itens · <span className="text-success font-medium">{r.conciliado} ok</span> · <span className="text-warning font-medium">{r.valor_divergente} div.</span>
                        </span>
                        <span className="text-[11px]">{isOpen ? "Recolher ▴" : "Detalhes ▾"}</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 flex flex-col gap-3 border-t border-border/60 pt-3">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-md bg-muted/40 px-2 py-2 min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Itens</div>
                            <div className="text-base font-semibold tabular-nums">{r.total_items}</div>
                          </div>
                          <div className="rounded-md bg-success/10 px-2 py-2 min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Conciliados</div>
                            <div className="text-base font-semibold tabular-nums text-success">{r.conciliado}</div>
                          </div>
                          <div className="rounded-md bg-warning/10 px-2 py-2 min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Diverg.</div>
                            <div className="text-base font-semibold tabular-nums text-warning">{r.valor_divergente}</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[12px] text-muted-foreground flex-wrap gap-2">
                          <span>Só hospital: <span className="font-medium text-foreground tabular-nums">{r.so_hospital}</span></span>
                          <span>Só Exacta: <span className="font-medium text-foreground tabular-nums">{r.so_exacta}</span></span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/pagamentos/${r.payment_id}`); }}
                          className="text-[13px] font-medium text-primary text-left"
                        >
                          Abrir pagamento →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </TabsContent>

        <TabsContent value="bloqueios" className="mt-4">
          <BlockingDivergencesTab onCountChange={setBlockingCount} />
        </TabsContent>

        <TabsContent value="bases" className="mt-4">
          <BasesConciliacaoPanel />
        </TabsContent>

        <TabsContent value="retroativa" className="mt-4">
          <RetroactiveReconciliationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
