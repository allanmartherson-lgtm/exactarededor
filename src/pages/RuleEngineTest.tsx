// Teste do motor de regras (dry-run) sobre um lote existente.
// Antes ficava como modal dentro de PaymentDetail; foi promovido para tela própria
// dentro do hub /regras porque simulação é ferramenta de regra, não ação do lote.
// Diferença vs. Simulador em lote: aqui roda o motor determinístico em cima de um
// lote já parseado no sistema (com todos os itens reais), sem tocar nos dados.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { GitCompare, Loader2, Play, RefreshCw, FlaskConical } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";

interface PaymentOption {
  id: string;
  reference: string;
  competence_month: string | null;
  item_count: number | null;

}

interface SimResult {
  item_id: string;
  status: string;
  expected_amount: number | null;
  matched_rule_name: string | null;
  calculation_explanation: string | null;
  // Snapshot atual (banco), não vem do edge:
  procedure_code?: string | null;
  procedure_name?: string | null;
  doctor_name?: string | null;
  access_route?: string | null;
  original_status?: string | null;
  original_expected?: number | null;
}

const PAGE = 1000;

async function fetchSnapshot(paymentId: string): Promise<Map<string, any>> {
  const acc = new Map<string, any>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("payment_items")
      .select("id, ai_status, ai_findings, procedure_code, procedure_name, doctor_name, access_route")
      .eq("payment_id", paymentId)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) acc.set(r.id, r);
    if (rows.length < PAGE) break;
    if (offset + PAGE >= 100000) break;
  }
  return acc;
}

export default function RuleEngineTest({ embedded = false }: { embedded?: boolean } = {}) {
  const { hospital } = useHospital();
  const [searchParams, setSearchParams] = useSearchParams();
  const preselect = searchParams.get("payment_id");

  const [payments, setPayments] = useState<PaymentOption[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(preselect ?? "");
  const [search, setSearch] = useState("");

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SimResult[] | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [selectedReference, setSelectedReference] = useState<string>("");

  // Carrega lotes do hospital ativo (últimos 90 dias).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!hospital?.id) return;
      setLoadingPayments(true);
      try {
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from("payments")
          .select("id, reference, competence_month, item_count")
          .eq("hospital_id", hospital.id)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!cancelled) setPayments((data ?? []) as PaymentOption[]);
      } finally {
        if (!cancelled) setLoadingPayments(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [hospital?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((p) => p.reference?.toLowerCase().includes(q));
  }, [payments, search]);

  const runTest = async (paymentId: string) => {
    if (!paymentId) {
      toast({ title: "Selecione um lote", variant: "destructive" });
      return;
    }
    setRunning(true);
    setResults(null);
    try {
      const chosen = payments.find((p) => p.id === paymentId);
      setSelectedReference(chosen?.reference ?? paymentId);

      // Snapshot ANTES (do banco) — evita comparar contra props stale de tela.
      const snapshot = await fetchSnapshot(paymentId);

      const { data, error } = await supabase.functions.invoke("analyze-payment", {
        body: { payment_id: paymentId, is_dry_run: true },
      });
      if (error) throw error;

      const merged: SimResult[] = (data?.results ?? []).map((res: any) => {
        const snap = snapshot.get(res.item_id);
        return {
          ...res,
          procedure_code: snap?.procedure_code ?? null,
          procedure_name: snap?.procedure_name ?? null,
          doctor_name: snap?.doctor_name ?? null,
          access_route: snap?.access_route ?? null,
          original_status: snap?.ai_status ?? null,
          original_expected: snap?.ai_findings?.expected_amount ?? null,
        };
      });
      setResults(merged);
      toast({
        title: "Simulação concluída",
        description: `${merged.length} itens analisados (lote tem ${snapshot.size}).`,
      });
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro na simulação", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const changedCount = useMemo(() => {
    if (!results) return 0;
    return results.filter((r) =>
      r.status !== r.original_status ||
      Number(r.expected_amount ?? 0) !== Number(r.original_expected ?? 0)
    ).length;
  }, [results]);

  const visible = useMemo(() => {
    if (!results) return [];
    if (!onlyChanged) return results;
    return results.filter((r) =>
      r.status !== r.original_status ||
      Number(r.expected_amount ?? 0) !== Number(r.original_expected ?? 0)
    );
  }, [results, onlyChanged]);

  const chooseAndRun = (id: string) => {
    setSelectedId(id);
    const next = new URLSearchParams(searchParams);
    next.set("payment_id", id);
    setSearchParams(next, { replace: true });
    void runTest(id);
  };

  // Auto-run se veio pré-selecionado por URL.
  useEffect(() => {
    if (preselect && payments.some((p) => p.id === preselect) && !results && !running) {
      void runTest(preselect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect, payments.length]);

  const container = (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            Escolha o lote para simular
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Label htmlFor="search-payment" className="text-xs">Buscar lote</Label>
              <Input
                id="search-payment"
                placeholder="Nome/referência do lote..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                onClick={() => selectedId && chooseAndRun(selectedId)}
                disabled={!selectedId || running}
                className="gap-2"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Rodar simulação
              </Button>
            </div>
          </div>

          <div className="border rounded-md max-h-64 overflow-auto">
            {loadingPayments ? (
              <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando lotes...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Nenhum lote encontrado.</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead className="w-[140px]">Competência</TableHead>
                    <TableHead className="w-[100px] text-right">Itens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 100).map((p) => (
                    <TableRow
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={cn("cursor-pointer", selectedId === p.id && "bg-primary/5")}
                    >
                      <TableCell>
                        <input
                          type="radio"
                          checked={selectedId === p.id}
                          onChange={() => setSelectedId(p.id)}
                          aria-label={`Selecionar ${p.reference}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{p.reference}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.competence_month ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{p.item_count ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {running && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center">
            <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
            <p className="text-sm font-medium">Processando motor determinístico...</p>
            <p className="text-xs text-muted-foreground mt-1">Carregando regras e paginando itens</p>
          </CardContent>
        </Card>
      )}

      {results && !running && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-primary" />
                Resultado — {selectedReference}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-normal cursor-pointer">
                  <Checkbox checked={onlyChanged} onCheckedChange={(v) => setOnlyChanged(!!v)} />
                  Só mudanças
                </label>
                <Button
                  onClick={() => selectedId && chooseAndRun(selectedId)}
                  variant="secondary"
                  size="sm"
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Rodar novamente
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4 px-4 py-2 bg-primary/5 border rounded-md text-sm">
              <div>
                <span className="text-muted-foreground">Itens analisados:</span>{" "}
                <span className="font-bold">{results.length}</span>
              </div>
              <div className="border-l pl-4">
                <span className="text-muted-foreground">Mudanças:</span>{" "}
                <span className={cn("font-bold", changedCount > 0 ? "text-orange-600" : "text-success")}>
                  {changedCount}
                </span>
              </div>
              <div className="border-l pl-4">
                <span className="text-muted-foreground">Exibindo:</span>{" "}
                <Badge variant="outline">{visible.length}</Badge>
              </div>
            </div>

            <ScrollArea className="border rounded-md max-h-[600px]">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="w-[120px]">Item / Código</TableHead>
                    <TableHead>Via / Médico</TableHead>
                    <TableHead className="text-center">Status (Antes → Depois)</TableHead>
                    <TableHead className="text-right">Esperado (Antes → Depois)</TableHead>
                    <TableHead>Regra / Explicação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        {onlyChanged ? "Nenhuma mudança em relação ao estado atual." : "Sem itens."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((res) => {
                      const isChanged = res.status !== res.original_status ||
                        Number(res.expected_amount ?? 0) !== Number(res.original_expected ?? 0);
                      return (
                        <TableRow key={res.item_id} className={cn(isChanged && "bg-orange-50/50")}>
                          <TableCell>
                            <div className="text-xs font-bold">{res.procedure_code}</div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={res.procedure_name ?? undefined}>
                              {res.procedure_name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-[10px] font-medium uppercase text-muted-foreground">{res.access_route}</div>
                            <div className="text-[10px]">{res.doctor_name}</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Badge variant="outline" className={cn("text-[9px] h-4", TONE_CLASSES[res.original_status as keyof typeof TONE_CLASSES] || "bg-muted")}>
                                {res.original_status ?? "—"}
                              </Badge>
                              <span className="text-muted-foreground">→</span>
                              <Badge variant="outline" className={cn("text-[9px] h-4 font-bold", TONE_CLASSES[res.status as keyof typeof TONE_CLASSES] || "bg-muted")}>
                                {res.status}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="text-[10px] text-muted-foreground line-through">{formatCurrency(res.original_expected ?? 0)}</div>
                            <div className={cn("text-[11px] font-bold", Number(res.expected_amount ?? 0) !== Number(res.original_expected ?? 0) && "text-orange-600")}>
                              {formatCurrency(res.expected_amount ?? 0)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-[10px] font-medium text-primary">{res.matched_rule_name || "—"}</div>
                            <div className="text-[10px] text-muted-foreground italic leading-tight">{res.calculation_explanation}</div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );

  if (embedded) return container;
  return (
    <div>
      <PageHeader
        title="Teste do motor de regras"
        description="Roda o motor determinístico em cima de um lote real, sem alterar dados. Útil para validar ajustes de regras antes de reanalisar."
        icon={FlaskConical}
      />
      <div className="p-4 md:p-6">{container}</div>
    </div>
  );
}
