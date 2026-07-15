/**
 * Prévia dos ajustes de intervenção — mostra, dentro do relatório
 * `/relatorios/intervencoes?view=ajustes`, quanto de economia/perda os lotes
 * AINDA-NÃO-APROVADOS vão gerar quando forem aprovados pelo diretor.
 *
 * Fonte: RPC `get_intervention_preview`. Nada é gravado em `intervention_ledger`.
 * Só entra no KPI oficial (card `InterventionSavingsCard`) depois da aprovação.
 *
 * Regras espelhadas do trigger real:
 *  - exclui lotes com `import_mode='historico'` (só entram no DRE)
 *  - só considera itens com intervenção humana (acatado, override, cancelamento)
 *  - mesma fórmula de delta = valor_regra − valor_pago
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Info, Sparkles, TrendingDown, TrendingUp, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/lib/status";
import { impactTone } from "@/lib/interventionSavings";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PreviewSummary {
  economia: number;
  perda: number;
  saldo: number;
  qtd_itens: number;
  qtd_lotes: number;
}

interface PreviewByPayment {
  payment_id: string;
  description: string | null;
  reference: string | null;
  competence_month: string | null;
  status: string;
  qtd_itens: number;
  economia: number;
  perda: number;
  saldo: number;
}

/** Rótulo amigável: descrição do analista → referência da planilha → fallback "Lote XXXXX". */
const loteLabel = (row: PreviewByPayment): string => {
  const desc = row.description?.trim();
  if (desc) return desc;
  const ref = row.reference?.trim();
  if (ref) return ref.length > 48 ? ref.slice(0, 45) + "…" : ref;
  return `Lote ${row.payment_id.slice(0, 8)}`;
};

interface PreviewResult {
  summary: PreviewSummary;
  by_payment: PreviewByPayment[];
}

const EMPTY: PreviewResult = {
  summary: { economia: 0, perda: 0, saldo: 0, qtd_itens: 0, qtd_lotes: 0 },
  by_payment: [],
};

const fmtCompetence = (raw: string | null) => {
  if (!raw) return "—";
  // Postgres devolve DATE como "YYYY-MM-DD"
  const [y, m] = raw.split("-");
  if (!y || !m) return raw;
  return `${m}/${y}`;
};

export default function InterventionPreviewSection() {
  const { hasRole } = useAuth();
  const hospitalId = useActiveHospitalId();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PreviewResult>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const allowed = hasRole("diretor") || hasRole("admin") || hasRole("validador");

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: res, error: err } = await supabase.rpc(
          "get_intervention_preview",
          { p_hospital_id: hospitalId ?? null },
        );
        if (err) throw err;
        // RPC pode voltar null, sem `by_payment`, ou sem `summary` — normalizar
        // para evitar crash "undefined is not an object (evaluating 't.by_payment.map')".
        const raw = (res ?? {}) as Partial<PreviewResult>;
        const normalized: PreviewResult = {
          summary: { ...EMPTY.summary, ...(raw.summary ?? {}) },
          by_payment: Array.isArray(raw.by_payment) ? raw.by_payment : [],
        };
        if (!cancelled) setData(normalized);
      } catch (e) {
        console.error("[InterventionPreviewSection] rpc failed", e);
        if (!cancelled) {
          setError("Não foi possível carregar a prévia.");
          setData(EMPTY);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, hospitalId]);

  const summaryTone = useMemo(() => impactTone(data.summary.saldo), [data.summary.saldo]);

  if (!allowed) return null;

  return (
    <Card className="shadow-card border-dashed border-primary/40 bg-primary/[0.03]">
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">
                Prévia — se os lotes em andamento forem aprovados agora
              </h3>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="Como funciona a prévia" className="text-muted-foreground hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm text-xs">
                    Simulação em tempo real dos itens já acatados, ajustados ou cancelados em lotes
                    que ainda não foram aprovados pelo diretor. Usa a mesma fórmula do KPI oficial
                    (Δ = valor da regra − valor pago). Nada é gravado — só entra no card de impacto
                    depois que o diretor aprovar o lote. Lotes de importação histórica são ignorados.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Valores potenciais — só entram no KPI oficial quando o lote for aprovado
            </p>
          </div>
        </div>

        {/* Summary strip */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data.summary.qtd_lotes === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Nenhum lote em andamento tem itens com intervenção pronta para virar economia ou perda.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryTile
                label="Saldo potencial"
                value={
                  <span
                    className={
                      summaryTone === "positive"
                        ? "text-success"
                        : summaryTone === "negative"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {summaryTone === "positive" ? "−" : summaryTone === "negative" ? "+" : ""}
                    {formatCurrency(Math.abs(data.summary.saldo))}
                  </span>
                }
                Icon={
                  summaryTone === "negative"
                    ? TrendingUp
                    : summaryTone === "positive"
                    ? TrendingDown
                    : Scale
                }
                iconClass={
                  summaryTone === "positive"
                    ? "text-success"
                    : summaryTone === "negative"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }
              />
              <SummaryTile
                label="Economia potencial"
                value={<span className="text-success">{formatCurrency(data.summary.economia)}</span>}
                Icon={TrendingDown}
                iconClass="text-success"
              />
              <SummaryTile
                label="Adicional potencial"
                value={<span className="text-destructive">{formatCurrency(data.summary.perda)}</span>}
                Icon={TrendingUp}
                iconClass="text-destructive"
              />
              <SummaryTile
                label="Lotes / itens"
                value={
                  <span className="text-foreground">
                    {data.summary.qtd_lotes} <span className="text-muted-foreground text-base font-normal">/</span> {data.summary.qtd_itens}
                  </span>
                }
                Icon={Sparkles}
                iconClass="text-primary"
              />
            </div>

            {/* Per-lot table */}
            <div className="rounded-lg border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lote</TableHead>
                    <TableHead>Competência</TableHead>
                    <TableHead>Status atual</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead className="text-right">Economia</TableHead>
                    <TableHead className="text-right">Adicional</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.by_payment.map((row) => {
                    const tone = impactTone(row.saldo);
                    return (
                      <TableRow key={row.payment_id} className="hover:bg-muted/40">
                        <TableCell className="font-medium max-w-[320px] truncate">
                          <Link
                            to={`/pagamentos/${row.payment_id}`}
                            className="hover:underline text-foreground"
                            title={loteLabel(row)}
                          >
                            {loteLabel(row)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {fmtCompetence(row.competence_month)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {PAYMENT_STATUS_LABELS[row.status as PaymentStatus] ?? row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.qtd_itens}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-success">
                          {row.economia > 0 ? formatCurrency(row.economia) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">
                          {row.perda > 0 ? formatCurrency(row.perda) : "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-medium ${
                            tone === "positive"
                              ? "text-success"
                              : tone === "negative"
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                        >
                          {tone === "positive" ? "−" : tone === "negative" ? "+" : ""}
                          {formatCurrency(Math.abs(row.saldo))}
                        </TableCell>
                        <TableCell>
                          <Link
                            to={`/pagamentos/${row.payment_id}`}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Abrir lote"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface SummaryTileProps {
  label: string;
  value: React.ReactNode;
  Icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
}

const SummaryTile = ({ label, value, Icon, iconClass }: SummaryTileProps) => (
  <div className="rounded-lg border bg-card p-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Icon className={`h-3.5 w-3.5 ${iconClass}`} />
    </div>
    <div className="mt-1.5 text-xl font-semibold tabular-nums leading-none">{value}</div>
  </div>
);
