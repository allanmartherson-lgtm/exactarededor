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
import { useHospital } from "@/contexts/HospitalContext";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Download, Scale, TrendingDown, TrendingUp } from "lucide-react";
import {
  emptyResult,
  filterItems,
  impactTone,
  itemsToCsv,
  summarizeItems,
  type InterventionFilters,
  type InterventionSavingsResult,
  type IntervenorRole,
} from "@/lib/interventionSavings";

type Range = 7 | 30 | 90 | 180;

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
  const { currentHospitalId } = useHospital();
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InterventionSavingsResult>(emptyResult());
  const [filters, setFilters] = useState<InterventionFilters>({ role: "all", userId: "all", search: "" });

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

  const users = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; role: IntervenorRole }>();
    for (const u of data.by_user) seen.set(u.user_id, { id: u.user_id, name: u.nome, role: u.role });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.by_user]);

  return (
    <div>
      <PageHeader
        title="Ajustes por intervenção"
        description="Impacto financeiro em R$ das devoluções e reprovações feitas por diretor e supervisor"
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
              onClick={() => downloadCsv(`ajustes-intervencao-${range}d.csv`, itemsToCsv(filteredItems))}
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
                      <Badge variant="outline">{u.role === "diretor" ? "Diretor" : "Supervisor"}</Badge>
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
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={8}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                  )}
                  {!loading && filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-muted-foreground text-center py-6">
                        Sem itens para os filtros atuais.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && filteredItems.map((it) => {
                    const positivo = it.delta > 0;
                    return (
                      <TableRow key={it.item_id}>
                        <TableCell className="text-sm">{fmtDate(it.acatado_at)}</TableCell>
                        <TableCell>
                          <div className="text-sm">{it.autor}</div>
                          <Badge variant="outline" className="text-[10px] mt-0.5">
                            {it.role === "diretor" ? "Diretor" : "Supervisor"}
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
                        <TableCell className={`text-right font-semibold ${positivo ? "text-success" : "text-destructive"}`}>
                          <span className="inline-flex items-center gap-1">
                            {positivo ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {formatCurrency(Math.abs(it.delta))}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/pagamentos/${it.payment_id}#item-${it.item_id}`}>Abrir</Link>
                          </Button>
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
