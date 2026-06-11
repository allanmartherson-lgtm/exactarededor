import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { GitCompareIcon } from "@/config/icons/navIcons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Database, History } from "lucide-react";
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

const TAB_VALUES = ["pagamento", "bases", "retroativa"] as const;
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
          <div className="rounded-lg border border-border bg-card overflow-hidden">
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
