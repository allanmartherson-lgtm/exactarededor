import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitCompare, ChevronDown, ChevronRight, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/status";

interface Props {
  companyName: string;
  currentPaymentId: string;
  currentTotalAmount: number;
  currentItemsCount: number;
}

interface PrevBatch {
  paymentId: string;
  reference: string;
  competenceMonth: string | null;
  totalAmount: number;
  itemsCount: number;
  newDoctors: string[];
}

function formatCompetence(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function PreviousBatchComparison({
  companyName,
  currentPaymentId,
  currentTotalAmount,
  currentItemsCount,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [prev, setPrev] = useState<PrevBatch | null>(null);
  const [currentCompetence, setCurrentCompetence] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data: prevGroup } = await supabase
        .from("payment_company_groups")
        .select("id, payment_id, total_amount, items_count, created_at, payments(reference, competence_month)")
        .eq("company_name", companyName)
        .neq("payment_id", currentPaymentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!prevGroup) {
        if (!cancelled) {
          setPrev(null);
          setLoading(false);
        }
        return;
      }

      const prevPaymentId = prevGroup.payment_id as string;
      const payments = (prevGroup as { payments: { reference: string; competence_month: string | null } | null }).payments;

      const [prevItemsRes, currItemsRes, currPaymentRes] = await Promise.all([
        supabase
          .from("payment_items")
          .select("doctor_name")
          .eq("payment_id", prevPaymentId)
          .eq("company_name", companyName)
          .limit(2000),
        supabase
          .from("payment_items")
          .select("doctor_name")
          .eq("payment_id", currentPaymentId)
          .eq("company_name", companyName)
          .limit(2000),
        supabase.from("payments").select("competence_month").eq("id", currentPaymentId).maybeSingle(),
      ]);

      const prevDoctors = new Set(
        (prevItemsRes.data ?? [])
          .map((r) => (r.doctor_name ?? "").trim())
          .filter(Boolean),
      );
      const currDoctorsSet = new Set(
        (currItemsRes.data ?? [])
          .map((r) => (r.doctor_name ?? "").trim())
          .filter(Boolean),
      );
      const newDoctors = Array.from(currDoctorsSet).filter((d) => !prevDoctors.has(d)).sort();

      if (cancelled) return;
      setCurrentCompetence((currPaymentRes.data?.competence_month as string | null) ?? null);
      setPrev({
        paymentId: prevPaymentId,
        reference: payments?.reference ?? "—",
        competenceMonth: payments?.competence_month ?? null,
        totalAmount: Number(prevGroup.total_amount ?? 0),
        itemsCount: Number(prevGroup.items_count ?? 0),
        newDoctors,
      });
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [companyName, currentPaymentId]);

  if (loading) return <Skeleton className="h-8 w-full" />;
  if (!prev) return null;

  const deltaValue = currentTotalAmount - prev.totalAmount;
  const deltaItems = currentItemsCount - prev.itemsCount;
  const deltaPct = prev.totalAmount > 0 ? (deltaValue / prev.totalAmount) * 100 : 0;
  const up = deltaValue >= 0;
  const DeltaIcon = up ? TrendingUp : TrendingDown;
  const deltaColor = up ? "text-[hsl(var(--warning))]" : "text-[hsl(var(--success))]";

  return (
    <div className="rounded-md border border-dashed bg-muted/20 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">Comparar com lote anterior</span>
        <Badge variant="muted" className="ml-1">{prev.reference}</Badge>
        <span className={`ml-auto inline-flex items-center gap-1 ${deltaColor}`}>
          <DeltaIcon className="h-3 w-3" />
          {up ? "+" : ""}{deltaPct.toFixed(1)}%
        </span>
      </button>
      {open && (
        <div className="border-t px-3 py-3 space-y-3">
          <p className="text-muted-foreground">
            Competência: <span className="text-foreground">{formatCompetence(prev.competenceMonth)}</span>
            {" → "}
            <span className="text-foreground">{formatCompetence(currentCompetence)}</span>
          </p>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border bg-background p-2">
              <div className="text-[10px] text-muted-foreground uppercase">Total anterior</div>
              <div className="font-semibold tabular-nums">{formatCurrency(prev.totalAmount)}</div>
            </div>
            <div className="rounded border bg-background p-2">
              <div className="text-[10px] text-muted-foreground uppercase">Total atual</div>
              <div className="font-semibold tabular-nums">{formatCurrency(currentTotalAmount)}</div>
            </div>
            <div className="rounded border bg-background p-2">
              <div className="text-[10px] text-muted-foreground uppercase">Variação</div>
              <div className={`font-semibold tabular-nums ${deltaColor}`}>
                {up ? "+" : ""}{formatCurrency(deltaValue)}
                <span className="text-[10px] ml-1 opacity-80">({up ? "+" : ""}{deltaPct.toFixed(1)}%)</span>
              </div>
            </div>
          </div>

          <p className="text-muted-foreground">
            Itens: <span className="text-foreground tabular-nums">{prev.itemsCount}</span>
            {" → "}
            <span className="text-foreground tabular-nums">{currentItemsCount}</span>
            <span className={`ml-2 ${deltaItems >= 0 ? "text-[hsl(var(--warning))]" : "text-[hsl(var(--success))]"}`}>
              ({deltaItems >= 0 ? "+" : ""}{deltaItems})
            </span>
          </p>

          {prev.newDoctors.length > 0 && (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase mb-1">
                Médicos novos ({prev.newDoctors.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {prev.newDoctors.slice(0, 12).map((name) => (
                  <span key={name} className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5">
                    <Badge variant="info" className="text-[9px] px-1 py-0">Novo</Badge>
                    <span>{name}</span>
                  </span>
                ))}
                {prev.newDoctors.length > 12 && (
                  <span className="text-muted-foreground">+{prev.newDoctors.length - 12} outros</span>
                )}
              </div>
            </div>
          )}

          <Link
            to={`/pagamentos/${prev.paymentId}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Abrir lote anterior <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
