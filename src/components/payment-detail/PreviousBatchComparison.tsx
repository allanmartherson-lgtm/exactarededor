import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitCompare, ChevronDown, ChevronRight, ArrowRight, TrendingUp, TrendingDown, Info, CheckCircle2 } from "lucide-react";
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

type MatchCriterion = "centro" | "exato" | "tipo";
type CandidateCriterion = MatchCriterion | "nenhum";

interface Candidate {
  paymentId: string;
  reference: string;
  competenceMonth: string | null;
  costCenter: string | null;
  sectors: string[];
  criterion: CandidateCriterion; // melhor critério que esse candidato satisfaz (ou "nenhum")
  chosen: boolean;
}

interface PrevBatch {
  paymentId: string;
  reference: string;
  competenceMonth: string | null;
  totalAmount: number;
  itemsCount: number;
  newDoctors: string[];
  matchQuality: MatchCriterion;
  prevCostCenter: string | null;
  currCostCenter: string | null;
}

function formatCompetence(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

const criterionLabel: Record<MatchCriterion, string> = {
  centro: "mesmo centro de custo",
  exato: "mesmo setor",
  tipo: "só por tipo",
};

const criterionBadgeVariant: Record<MatchCriterion, "success" | "info" | "muted"> = {
  centro: "success",
  exato: "info",
  tipo: "muted",
};

export function PreviousBatchComparison({
  companyName,
  currentPaymentId,
  currentTotalAmount,
  currentItemsCount,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [prev, setPrev] = useState<PrevBatch | null>(null);
  const [currentCompetence, setCurrentCompetence] = useState<string | null>(null);
  const [currentCostCenter, setCurrentCostCenter] = useState<string | null>(null);
  const [currentSectors, setCurrentSectors] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [noMatchReason, setNoMatchReason] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [candOpen, setCandOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNoMatchReason(null);
    setPrev(null);
    setCandidates([]);

    (async () => {
      // 1) Tipo/setores/centro de custo do lote atual — chave para evitar comparar pareceres com cirurgia.
      const { data: curr } = await supabase
        .from("payments")
        .select("payment_type, sectors, competence_month, cost_center_code")
        .eq("id", currentPaymentId)
        .maybeSingle();
      const currType = (curr?.payment_type ?? null) as string | null;
      const currSectorsRaw = ((curr?.sectors ?? []) as string[]).filter(Boolean);
      const currSectors = currSectorsRaw.map((s) => s.toLowerCase().trim()).filter(Boolean);
      const currCC = ((curr?.cost_center_code ?? null) as string | null)?.trim() || null;
      if (!cancelled) {
        setCurrentCompetence((curr?.competence_month as string | null) ?? null);
        setCurrentCostCenter(currCC);
        setCurrentSectors(currSectorsRaw);
      }

      if (!currType) {
        if (!cancelled) {
          setNoMatchReason("Lote atual sem tipo de pagamento definido — comparação automática desativada.");
          setLoading(false);
        }
        return;
      }

      // 2) Candidatos: grupos da mesma empresa em QUALQUER lote anterior.
      //    Não filtramos por payment_type aqui — o centro de custo é o critério primário
      //    (pedido explícito do usuário). payment_type vira só tiebreak na classificação,
      //    porque há lotes antigos com payment_type NULL que ainda têm o CC correto.
      const { data: rawCandidates } = await supabase
        .from("payment_company_groups")
        .select("payment_id, total_amount, items_count, created_at, payments!inner(reference, competence_month, payment_type, sectors, cost_center_code)")
        .eq("company_name", companyName)
        .neq("payment_id", currentPaymentId)
        .order("created_at", { ascending: false })
        .limit(30);

      type Row = NonNullable<typeof rawCandidates>[number] & {
        payments: { reference: string; competence_month: string | null; payment_type: string | null; sectors: string[] | null; cost_center_code: string | null } | null;
      };
      const rows = (rawCandidates ?? []) as Row[];

      if (rows.length === 0) {
        if (!cancelled) {
          setNoMatchReason(`Nenhum lote anterior encontrado para esta empresa.`);
          setLoading(false);
        }
        return;
      }

      // Classifica cada candidato pelo melhor critério que ele satisfaz vs lote atual.
      // Ordem: centro de custo > setor em comum > mesmo payment_type > nenhum.
      const classify = (r: Row): MatchCriterion | "nenhum" => {
        const cc = (r.payments?.cost_center_code ?? "").trim();
        if (currCC && cc && cc === currCC) return "centro";
        const sec = (r.payments?.sectors ?? []).map((s) => (s ?? "").toLowerCase().trim());
        if (currSectors.length > 0 && sec.some((s) => currSectors.includes(s))) return "exato";
        const t = (r.payments?.payment_type ?? "").trim();
        if (t && t === currType) return "tipo";
        return "nenhum";
      };

      // 3) Prioridade de match: centro > setor > tipo (com guarda para CC).
      let chosenIdx = -1;
      const centroIdx = rows.findIndex((r) => classify(r) === "centro");
      if (centroIdx >= 0) chosenIdx = centroIdx;
      if (chosenIdx < 0) {
        const setorIdx = rows.findIndex((r) => classify(r) === "exato");
        if (setorIdx >= 0) chosenIdx = setorIdx;
      }
      if (chosenIdx < 0 && !currCC) {
        chosenIdx = 0; // sem CC no atual, podemos cair pra mais recente do mesmo tipo
      }

      // Sempre populamos a lista de candidatos (para a UI mostrar critério de cada um).
      const candList: Candidate[] = rows.map((r, i) => ({
        paymentId: r.payment_id as string,
        reference: r.payments?.reference ?? "—",
        competenceMonth: r.payments?.competence_month ?? null,
        costCenter: (r.payments?.cost_center_code ?? null) || null,
        sectors: (r.payments?.sectors ?? []) as string[],
        criterion: classify(r),
        chosen: i === chosenIdx,
      }));
      if (!cancelled) setCandidates(candList);

      if (chosenIdx < 0) {
        // currCC definido mas nenhum candidato com mesmo CC nem com setor em comum → suprime
        if (!cancelled) {
          setNoMatchReason(
            `Nenhum lote anterior do mesmo centro de custo (${currCC}) encontrado para esta empresa. Comparação automática evitada para não cruzar perfis distintos (ex: centro cirúrgico vs parecer).`,
          );
          setLoading(false);
        }
        return;
      }

      const chosen = rows[chosenIdx];
      const chosenCrit = classify(chosen);
      const prevPaymentId = chosen.payment_id as string;

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
        reference: chosen.payments?.reference ?? "—",
        competenceMonth: chosen.payments?.competence_month ?? null,
        totalAmount: Number(chosen.total_amount ?? 0),
        itemsCount: Number(chosen.items_count ?? 0),
        newDoctors,
        matchQuality: chosenCrit,
        prevCostCenter: (chosen.payments?.cost_center_code ?? null) || null,
        currCostCenter: currCC,
      });
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [companyName, currentPaymentId]);

  if (loading) return <Skeleton className="h-8 w-full" />;

  // Painel reutilizável: lista de candidatos avaliados (com critério de cada um).
  const candidatesPanel = candidates.length > 0 && (
    <div className="rounded border bg-background">
      <button
        type="button"
        onClick={() => setCandOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] hover:bg-muted/40 transition-colors"
        aria-expanded={candOpen}
      >
        {candOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-medium">Lotes avaliados ({candidates.length})</span>
        <span className="text-muted-foreground">
          · CC atual:{" "}
          <span className="text-foreground tabular-nums">{currentCostCenter ?? "—"}</span>
          {currentSectors.length > 0 && (
            <> · setor(es): <span className="text-foreground">{currentSectors.join(", ")}</span></>
          )}
        </span>
      </button>
      {candOpen && (
        <ul className="border-t divide-y">
          {candidates.map((c) => (
            <li
              key={c.paymentId}
              className={`flex items-center gap-2 px-2 py-1.5 text-[11px] ${c.chosen ? "bg-success-soft/30" : ""}`}
            >
              {c.chosen ? (
                <CheckCircle2 className="h-3 w-3 text-[hsl(var(--success))] shrink-0" />
              ) : (
                <span className="h-3 w-3 shrink-0" />
              )}
              <Badge variant="muted" className="text-[10px]">{c.reference}</Badge>
              <span className="text-muted-foreground">{formatCompetence(c.competenceMonth)}</span>
              <Badge variant={criterionBadgeVariant[c.criterion]} className="text-[10px]">
                {criterionLabel[c.criterion]}
              </Badge>
              <span className="text-muted-foreground truncate">
                CC <span className="text-foreground tabular-nums">{c.costCenter ?? "—"}</span>
                {c.sectors.length > 0 && (
                  <> · <span className="text-foreground">{c.sectors.join(", ")}</span></>
                )}
              </span>
              <Link
                to={`/pagamentos/${c.paymentId}`}
                className="ml-auto text-primary hover:underline shrink-0"
              >
                abrir
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (!prev) {
    if (!noMatchReason && candidates.length === 0) return null;
    return (
      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs space-y-2">
        {noMatchReason && (
          <div className="text-muted-foreground flex items-start gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{noMatchReason}</span>
          </div>
        )}
        {candidatesPanel}
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
        <Badge
          variant={criterionBadgeVariant[prev.matchQuality]}
          className="text-[10px] gap-1"
          title={
            prev.matchQuality === "centro"
              ? `Critério: mesmo centro de custo (${prev.currCostCenter}).`
              : prev.matchQuality === "exato"
              ? "Critério: mesmo tipo e sobreposição de setor."
              : "Critério: só mesmo tipo de pagamento — interprete com cautela."
          }
        >
          {prev.matchQuality === "tipo" && <Info className="h-2.5 w-2.5" />}
          {criterionLabel[prev.matchQuality]}
          {prev.matchQuality === "centro" && prev.currCostCenter ? ` ${prev.currCostCenter}` : ""}
        </Badge>
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

          {candidatesPanel}

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
