import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";

type PayRow = {
  id: string;
  reference: string | null;
  competence_month: string | null;
  payment_type: string | null;
  payment_model_id: string | null;
};

type Gap = {
  key: string;
  payment_type: string;
  payment_model_id: string | null;
  month: string; // YYYY-MM-01
  monthLabel: string;
};

type GroupedGap = {
  payment_type: string;
  payment_model_id: string | null;
  gaps: Gap[]; // ordenados por mês asc
};

interface Props {
  onActed?: () => void;
}

export function ZeevRetroactiveGapsCard({ onActed }: Props) {
  const { hospital } = useHospital();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PayRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!hospital?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);
      cutoff.setDate(1);
      const { data, error } = await supabase
        .from("payments")
        .select("id, reference, competence_month, payment_type, payment_model_id, status")
        .eq("hospital_id", hospital.id)
        .gte("competence_month", cutoff.toISOString().slice(0, 10))
        .not("status", "eq", "cancelado")
        .limit(2000);
      if (cancelled) return;
      if (error || !data) {
        setRows([]);
      } else {
        setRows(data as PayRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [hospital?.id]);

  const gaps: Gap[] = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const byType = new Map<string, { model_id: string | null; months: Set<string> }>();
    for (const r of rows) {
      const t = (r.payment_type ?? "").trim();
      if (!t || !r.competence_month) continue;
      const monthKey = r.competence_month.slice(0, 7) + "-01";
      const modelId = r.payment_model_id ?? null;
      const entry = byType.get(t);
      if (entry) {
        entry.months.add(monthKey);
      } else {
        byType.set(t, { model_id: modelId, months: new Set([monthKey]) });
      }
    }
    const out: Gap[] = [];
    const fmt = (k: string) => {
      const [y, m] = k.split("-");
      return `${m}/${y}`;
    };
    for (const [type, entry] of byType.entries()) {
      // Exige ≥3 meses de histórico para considerar padrão
      if (entry.months.size < 3) continue;
      const sorted = [...entry.months].sort();
      const first = new Date(sorted[0]);
      // Limite = último mês com dado real (não extrapola até hoje)
      const last = new Date(sorted[sorted.length - 1]);
      const cursor = new Date(first);
      while (cursor <= last) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
        if (!entry.months.has(key)) {
          // Garante buraco genuíno: existe mês com dado antes E depois
          const hasBefore = sorted.some((m) => m < key);
          const hasAfter = sorted.some((m) => m > key);
          if (hasBefore && hasAfter) {
            out.push({
              key: `${type}::${key}`,
              payment_type: type,
              payment_model_id: entry.model_id,
              month: key,
              monthLabel: fmt(key),
            });
          }
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    return out.sort((a, b) => a.month.localeCompare(b.month));
  }, [rows]);

  const grouped: GroupedGap[] = useMemo(() => {
    const map = new Map<string, GroupedGap>();
    for (const g of gaps) {
      const existing = map.get(g.payment_type);
      if (existing) {
        existing.gaps.push(g);
      } else {
        map.set(g.payment_type, {
          payment_type: g.payment_type,
          payment_model_id: g.payment_model_id,
          gaps: [g],
        });
      }
    }
    return [...map.values()].map((g) => ({
      ...g,
      gaps: g.gaps.sort((a, b) => a.month.localeCompare(b.month)),
    }));
  }, [gaps]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Loader2 className="h-3 w-3 animate-spin" /> Procurando lotes faltantes…
      </div>
    );
  }

  if (gaps.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20 p-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
        <div className="text-[12px] leading-snug text-foreground">
          Nenhum gap de competência nos últimos 12 meses. Sequência mensal completa por tipo.
        </div>
      </div>
    );
  }

  const handleCreate = (g: Gap) => {
    const params = new URLSearchParams();
    if (g.payment_model_id) params.set("payment_type_id", g.payment_model_id);
    params.set("competence_month", g.month);
    params.set("import_mode", "historico");
    navigate(`/pagamentos/novo-manual?${params.toString()}`);
    onActed?.();
  };

  const totalGaps = gaps.length;
  const totalTypes = grouped.length;

  return (
    <div className="rounded-lg border border-border bg-transparent">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40 rounded-lg transition-colors"
      >
        <span className="text-[12px] text-foreground">
          <strong>{totalGaps}</strong> {totalGaps === 1 ? "competência faltante" : "competências faltantes"} em{" "}
          <strong>{totalTypes}</strong> {totalTypes === 1 ? "tipo" : "tipos"}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
          Ver detalhes
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-border border-t border-border">
          {grouped.map((grp) => {
            const oldest = grp.gaps[0];
            const label = grp.gaps.map((g) => g.monthLabel).join(", ");
            return (
              <li key={grp.payment_type} className="flex items-center gap-2.5 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-foreground truncate" title={grp.payment_type}>
                    {grp.payment_type}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    falta {label}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2 shrink-0"
                  onClick={() => handleCreate(oldest)}
                >
                  {grp.gaps.length > 1 ? "Criar lote (mais antigo)" : "Criar lote"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
