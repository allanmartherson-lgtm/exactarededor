import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CalendarClock, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";

type PayRow = {
  id: string;
  reference: string | null;
  competence_month: string | null;
  payment_type: string | null;
  payment_type_id: string | null;
};

type Gap = {
  key: string;
  payment_type: string;
  payment_type_id: string | null;
  month: string; // YYYY-MM-01
  monthLabel: string;
};

interface Props {
  onActed?: () => void;
}

/**
 * Detecta gaps de competência por tipo de pagamento no hospital ativo
 * e propõe criar o lote faltante (Fase 3.2 leve — leva pro NewManualPayment com prefill).
 */
export function ZeevRetroactiveGapsCard({ onActed }: Props) {
  const { hospital } = useHospital();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PayRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hospital?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // últimos 12 meses; ignora pagamentos cancelados
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);
      cutoff.setDate(1);
      const { data, error } = await supabase
        .from("payments")
        .select("id, reference, competence_month, payment_type, payment_type_id, status")
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
    // agrupa por payment_type (string legível). Só considera tipos com ≥2 lotes históricos.
    const byType = new Map<string, { type_id: string | null; months: Set<string> }>();
    for (const r of rows) {
      const t = (r.payment_type ?? "").trim();
      if (!t || !r.competence_month) continue;
      const monthKey = r.competence_month.slice(0, 7) + "-01";
      const entry = byType.get(t);
      if (entry) {
        entry.months.add(monthKey);
      } else {
        byType.set(t, { type_id: r.payment_type_id, months: new Set([monthKey]) });
      }
    }
    const out: Gap[] = [];
    const fmt = (k: string) => {
      const [y, m] = k.split("-");
      return `${m}/${y}`;
    };
    const today = new Date();
    today.setDate(1);
    for (const [type, entry] of byType.entries()) {
      if (entry.months.size < 2) continue;
      const sorted = [...entry.months].sort();
      const first = new Date(sorted[0]);
      const last = today; // detecta gaps até o mês atual
      const cursor = new Date(first);
      while (cursor <= last) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
        if (!entry.months.has(key)) {
          out.push({
            key: `${type}::${key}`,
            payment_type: type,
            payment_type_id: entry.type_id,
            month: key,
            monthLabel: fmt(key),
          });
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    // ordena: mais antigos primeiro (mais urgentes pra retroativo)
    return out.sort((a, b) => a.month.localeCompare(b.month)).slice(0, 8);
  }, [rows]);

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
    if (g.payment_type_id) params.set("payment_type_id", g.payment_type_id);
    params.set("competence_month", g.month);
    params.set("import_mode", "historico");
    navigate(`/pagamentos/novo-manual?${params.toString()}`);
    onActed?.();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Lotes faltantes detectados</span>
        <span className="text-foreground/60">{gaps.length}</span>
      </div>
      <ul className="space-y-1.5">
        {gaps.map((g) => (
          <li
            key={g.key}
            className="rounded-lg border border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20 p-2.5 flex items-center gap-2.5"
          >
            <CalendarClock className="h-4 w-4 text-foreground/70 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold leading-tight truncate" title={g.payment_type}>
                {g.payment_type}
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                Falta competência <strong className="text-foreground">{g.monthLabel}</strong>
              </div>
            </div>
            <Button size="sm" className="h-6 text-[10px] px-2 shrink-0" onClick={() => handleCreate(g)}>
              Criar lote <ArrowRight className="h-2.5 w-2.5 ml-1" />
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground italic leading-snug">
        Cada botão abre o lançamento manual já pré-preenchido em modo histórico (não grava aliases auto).
      </p>
    </div>
  );
}
