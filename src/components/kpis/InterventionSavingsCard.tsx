/**
 * Card compacto "Valor ajustado por intervenção".
 *
 * Fonte: RPC `get_intervention_savings` → lê a tabela `intervention_ledger`,
 * que só é populada quando o diretor aprova o pagamento. Nada em análise
 * entra aqui — só valor consolidado.
 *
 * Filtro de período: default = mês calendário atual (baseado no
 * `approved_at`, ou seja, quando o lote foi aprovado — não a competência).
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "react-router-dom";
import { ArrowRight, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/status";
import {
  emptyResult,
  impactTone,
  type InterventionSavingsResult,
} from "@/lib/interventionSavings";

type PeriodKey = "mes_atual" | "mes_anterior" | "d30" | "d90";

interface PeriodOption {
  key: PeriodKey;
  label: string;
  shortLabel: (now: Date) => string;
  range: (now: Date) => { start: Date; end: Date };
}

const MONTH_NAMES = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];

const PERIOD_OPTIONS: PeriodOption[] = [
  {
    key: "mes_atual",
    label: "Mês atual",
    shortLabel: (now) => `Impacto em ${MONTH_NAMES[now.getMonth()]}/${now.getFullYear()}`,
    range: (now) => ({
      start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    }),
  },
  {
    key: "mes_anterior",
    label: "Mês anterior",
    shortLabel: (now) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `Impacto em ${MONTH_NAMES[d.getMonth()]}/${d.getFullYear()}`;
    },
    range: (now) => ({
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    }),
  },
  {
    key: "d30",
    label: "Últimos 30 dias",
    shortLabel: () => "Impacto nos últimos 30 dias",
    range: (now) => ({
      start: new Date(now.getTime() - 30 * 24 * 3600 * 1000),
      end: now,
    }),
  },
  {
    key: "d90",
    label: "Últimos 90 dias",
    shortLabel: () => "Impacto nos últimos 90 dias",
    range: (now) => ({
      start: new Date(now.getTime() - 90 * 24 * 3600 * 1000),
      end: now,
    }),
  },
];

interface Props {
  /** @deprecated mantido por compatibilidade; agora o card controla o período internamente. */
  rangeDays?: number;
  className?: string;
  hideHeader?: boolean;
  defaultPeriod?: PeriodKey;
}

export default function InterventionSavingsCard({
  className,
  hideHeader = false,
  defaultPeriod = "mes_atual",
}: Props) {
  const { hasRole } = useAuth();
  const hospitalId = useActiveHospitalId();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InterventionSavingsResult>(emptyResult());
  const [periodKey, setPeriodKey] = useState<PeriodKey>(defaultPeriod);

  const allowed = hasRole("diretor") || hasRole("admin") || hasRole("validador");

  const period = useMemo(
    () => PERIOD_OPTIONS.find((p) => p.key === periodKey) ?? PERIOD_OPTIONS[0],
    [periodKey],
  );

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const now = new Date();
        const { start, end } = period.range(now);
        const { data: res, error } = await supabase.rpc("get_intervention_savings", {
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_hospital_id: hospitalId ?? null,
        });
        if (error) throw error;
        if (!cancelled) setData((res as unknown as InterventionSavingsResult) ?? emptyResult());
      } catch (e) {
        console.error("InterventionSavingsCard failed", e);
        if (!cancelled) setData(emptyResult());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, hospitalId, allowed]);

  if (!allowed) return null;

  const s = data.summary;
  const tone = impactTone(s.saldo);
  const ring =
    tone === "positive" ? "border-success/30" :
    tone === "negative" ? "border-destructive/30" : "border-border";
  const accent =
    tone === "positive" ? "text-success" :
    tone === "negative" ? "text-destructive" : "text-muted-foreground";
  const Icon = tone === "negative" ? TrendingDown : tone === "positive" ? TrendingUp : Scale;

  const saldoLabel =
    tone === "positive"
      ? "Economia líquida para o hospital"
      : tone === "negative"
      ? "Pagamento adicional após revisão"
      : "Sem impacto líquido no período";

  const periodShort = period.shortLabel(new Date());

  return (
    <Card className={`shadow-card border ${ring} ${className ?? ""}`}>
      <CardContent style={{ padding: "18px 18px 20px" }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {!hideHeader && (
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Impacto das intervenções no pagamento
              </p>
            )}
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
              {periodShort} · só lotes aprovados pelo diretor
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Select value={periodKey} onValueChange={(v) => setPeriodKey(v as PeriodKey)}>
              <SelectTrigger className="h-7 text-xs w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.key} value={p.key} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Icon className={`h-4 w-4 ${accent}`} />
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-8 w-40 mt-3" />
        ) : (
          <>
            <div className={`text-2xl font-semibold mt-2 ${accent}`}>
              {tone === "positive" ? "−" : tone === "negative" ? "+" : ""}
              {formatCurrency(Math.abs(s.saldo))}
            </div>
            <p className={`text-[11px] mt-0.5 font-medium ${accent}`}>{saldoLabel}</p>
          </>
        )}

        {!loading && (
          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-success" />
              <span>
                <span className="text-success font-medium">{formatCurrency(s.economia)}</span> deixou de ser pago indevidamente
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
              <span>
                <span className="text-destructive font-medium">{formatCurrency(s.perda)}</span> acrescido após revisão (ajustes para mais)
              </span>
            </div>
            <div className="text-muted-foreground/80 pt-0.5">
              {s.qtd_itens} item(ns) impactado(s) por devolução, ajuste, glosa ou cancelamento
            </div>
          </div>
        )}

        <div className="mt-3">
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link to="/relatorios/intervencoes?view=ajustes">
              Ver relatório <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
