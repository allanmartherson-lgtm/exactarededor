import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitCompare, ChevronDown, ChevronRight, ArrowRight, TrendingUp, TrendingDown, Info } from "lucide-react";
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
  matchQuality: "centro" | "exato" | "tipo"; // centro = mesmo centro de custo; exato = mesmo tipo + setor; tipo = só payment_type
  prevCostCenter: string | null;
  currCostCenter: string | null;
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
  const [noMatchReason, setNoMatchReason] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNoMatchReason(null);
    setPrev(null);

    (async () => {
      // 1) Tipo/setores/centro de custo do lote atual — chave para evitar comparar pareceres com cirurgia.
      const { data: curr } = await supabase
        .from("payments")
        .select("payment_type, sectors, competence_month, cost_center_code")
        .eq("id", currentPaymentId)
        .maybeSingle();
      const currType = (curr?.payment_type ?? null) as string | null;
      const currSectors = ((curr?.sectors ?? []) as string[]).map((s) => s.toLowerCase().trim()).filter(Boolean);
      const currCC = ((curr?.cost_center_code ?? null) as string | null)?.trim() || null;
      if (!cancelled) setCurrentCompetence((curr?.competence_month as string | null) ?? null);

      if (!currType) {
        if (!cancelled) {
          setNoMatchReason("Lote atual sem tipo de pagamento definido — comparação automática desativada.");
          setLoading(false);
        }
        return;
      }

      // 2) Candidatos: grupos da mesma empresa em lotes do MESMO payment_type.
      const { data: candidates } = await supabase
        .from("payment_company_groups")
        .select("payment_id, total_amount, items_count, created_at, payments!inner(reference, competence_month, payment_type, sectors, cost_center_code)")
        .eq("company_name", companyName)
        .neq("payment_id", currentPaymentId)
        .eq("payments.payment_type", currType as "plantao" | "producao" | "remessa" | "valor_fixo")
        .order("created_at", { ascending: false })
        .limit(20);

      if (!candidates || candidates.length === 0) {
        if (!cancelled) {
          setNoMatchReason(`Nenhum lote anterior do tipo "${currType}" encontrado para esta empresa.`);
          setLoading(false);
        }
        return;
      }

      // 3) Prioridade de match:
      //    a) mesmo cost_center_code (centro de custo idêntico) — match "centro"
      //    b) sobreposição de setores — match "exato"
      //    c) mais recente do mesmo tipo — match "tipo" (com aviso)
      type Row = (typeof candidates)[number] & {
        payments: { reference: string; competence_month: string | null; payment_type: string | null; sectors: string[] | null; cost_center_code: string | null } | null;
      };
      let chosen: { row: Row; quality: "centro" | "exato" | "tipo" } | null = null;

      if (currCC) {
        for (const c of candidates as Row[]) {
          const cc = (c.payments?.cost_center_code ?? "").trim();
          if (cc && cc === currCC) {
            chosen = { row: c, quality: "centro" };
            break;
          }
        }
      }
      if (!chosen && currSectors.length > 0) {
        for (const c of candidates as Row[]) {
          const sec = (c.payments?.sectors ?? []).map((s) => (s ?? "").toLowerCase().trim());
          if (sec.some((s) => currSectors.includes(s))) {
            chosen = { row: c, quality: "exato" };
            break;
          }
        }
      }
      if (!chosen) {
        // Se o lote atual tem centro de custo definido mas nenhum candidato bate, NÃO caímos
        // para "tipo" cego — comparar com centro de custo diferente é justamente o que o
        // usuário pediu para evitar. Avisa e sai.
        if (currCC) {
          if (!cancelled) {
            setNoMatchReason(`Nenhum lote anterior do mesmo centro de custo (${currCC}) encontrado para esta empresa. Comparação automática evitada para não cruzar perfis distintos (ex: centro cirúrgico vs parecer).`);
            setLoading(false);
          }
          return;
        }
        chosen = { row: candidates[0] as Row, quality: "tipo" };
      }

      const prevPaymentId = chosen.row.payment_id as string;

      const [prevItemsRes, currItemsRes] = await Promise.all([
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
      ]);

      const prevDoctors = new Set(
        (prevItemsRes.data ?? []).map((r) => (r.doctor_name ?? "").trim()).filter(Boolean),
      );
      const currDoctorsSet = new Set(
        (currItemsRes.data ?? []).map((r) => (r.doctor_name ?? "").trim()).filter(Boolean),
      );
      const newDoctors = Array.from(currDoctorsSet).filter((d) => !prevDoctors.has(d)).sort();

      if (cancelled) return;
      setPrev({
        paymentId: prevPaymentId,
        reference: chosen.row.payments?.reference ?? "—",
        competenceMonth: chosen.row.payments?.competence_month ?? null,
        totalAmount: Number(chosen.row.total_amount ?? 0),
        itemsCount: Number(chosen.row.items_count ?? 0),
        newDoctors,
        matchQuality: chosen.quality,
        prevCostCenter: (chosen.row.payments?.cost_center_code ?? null) || null,
        currCostCenter: currCC,
      });
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [companyName, currentPaymentId]);

  if (loading) return <Skeleton className="h-8 w-full" />;

  if (!prev) {
    if (!noMatchReason) return null;
    return (
      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>{noMatchReason} Sem base comparável, evitamos cruzar lotes de natureza diferente (ex: pareceres vs cirurgia).</span>
      </div>
    );
  }

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
        {prev.matchQuality === "centro" && prev.currCostCenter && (
          <Badge
            variant="outline"
            className="text-[10px] gap-1"
            title={`Mesmo centro de custo (${prev.currCostCenter}) — perfis comparáveis.`}
          >
            CC {prev.currCostCenter}
          </Badge>
        )}
        {prev.matchQuality === "exato" && (
          <Badge variant="outline" className="text-[10px] gap-1" title="Mesmo tipo e sobreposição de setor.">
            mesmo setor
          </Badge>
        )}
        {prev.matchQuality === "tipo" && (
          <Badge
            variant="outline"
            className="text-[10px] gap-1"
            title="Mesmo tipo de pagamento, mas sem centro de custo nem setor em comum — interprete com cautela."
          >
            <Info className="h-2.5 w-2.5" /> só por tipo
          </Badge>
        )}
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
