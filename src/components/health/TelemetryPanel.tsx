import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Brain, Database, Zap, AlertCircle, RefreshCw } from "lucide-react";

type Row = {
  id: string;
  job_id: string | null;
  payment_id: string;
  company_name: string | null;
  total_ms: number;
  ai_ms: number;
  rules_ms: number;
  writes_ms: number;
  items_count: number;
  ai_items_count: number;
  cache_hit: boolean;
  error: string | null;
  created_at: string;
};

type Aggregate = {
  count: number;
  avgTotal: number;
  avgAi: number;
  avgRules: number;
  avgWrites: number;
  cacheHitRate: number;
  errorCount: number;
  totalItems: number;
  p95Total: number;
};

const HOURS_WINDOW = 24;

const fmtMs = (ms: number) => {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
};

const percentile = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
};

const Cell = ({
  icon: Icon,
  iconColor,
  label,
  value,
  sub,
}: {
  icon: typeof Activity;
  iconColor: string;
  label: string;
  value: string;
  sub?: string;
}) => (
  <div
    style={{
      padding: "14px 16px",
      border: "1px solid hsl(var(--border))",
      borderRadius: 10,
      background: "hsl(var(--card))",
      display: "flex",
      alignItems: "center",
      gap: 12,
    }}
  >
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: iconColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon size={18} style={{ color: "white" }} />
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "hsl(var(--foreground))" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{sub}</div>}
    </div>
  </div>
);

export default function TelemetryPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [agg, setAgg] = useState<Aggregate | null>(null);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - HOURS_WINDOW * 3_600_000).toISOString();
    const { data } = await supabase
      .from("analysis_telemetry")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);

    const list = (data ?? []) as Row[];
    setRows(list);

    if (list.length === 0) {
      setAgg(null);
    } else {
      const totals = list.map((r) => r.total_ms);
      const ais = list.map((r) => r.ai_ms);
      const rls = list.map((r) => r.rules_ms);
      const wrt = list.map((r) => r.writes_ms);
      const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
      const errorCount = list.filter((r) => r.error).length;
      const cacheHits = list.filter((r) => r.cache_hit).length;
      setAgg({
        count: list.length,
        avgTotal: sum(totals) / totals.length,
        avgAi: sum(ais) / ais.length,
        avgRules: sum(rls) / rls.length,
        avgWrites: sum(wrt) / wrt.length,
        cacheHitRate: (cacheHits / list.length) * 100,
        errorCount,
        totalItems: list.reduce((a, r) => a + (r.items_count ?? 0), 0),
        p95Total: percentile(totals, 95),
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const slowest = [...rows].sort((a, b) => b.total_ms - a.total_ms).slice(0, 8);
  const errors = rows.filter((r) => r.error).slice(0, 8);

  return (
    <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "18px 22px", borderBottom: "1px solid hsl(var(--border))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "hsl(var(--bubble-teal-bg))", color: "hsl(var(--bubble-teal-fg))", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Activity size={16} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Telemetria de Análise</div>
          </div>
          <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 4, marginLeft: 42 }}>
            Métricas por empresa nas últimas {HOURS_WINDOW}h ({agg?.count ?? 0} execuções)
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid hsl(var(--border))",
            background: "transparent",
            cursor: "pointer",
            fontSize: 12,
            color: "hsl(var(--muted-foreground))",
          }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {!agg ? (
        <div style={{ padding: 32, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
          {loading ? "Carregando…" : "Sem execuções de análise registradas no período."}
        </div>
      ) : (
        <>
          <div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Cell icon={Zap} iconColor="hsl(var(--bubble-blue-fg))" label="Tempo médio total" value={fmtMs(agg.avgTotal)} sub={`p95: ${fmtMs(agg.p95Total)}`} />
            <Cell icon={Brain} iconColor="hsl(var(--bubble-purple-fg))" label="Tempo médio em IA" value={fmtMs(agg.avgAi)} sub={`${((agg.avgAi / agg.avgTotal) * 100).toFixed(0)}% do total`} />
            <Cell icon={Database} iconColor="hsl(var(--bubble-teal-fg))" label="Tempo médio carregando regras" value={fmtMs(agg.avgRules)} />
            <Cell icon={Activity} iconColor="hsl(var(--bubble-green-fg))" label="Cache de contexto" value={`${agg.cacheHitRate.toFixed(0)}%`} sub="hit rate" />
            <Cell icon={Database} iconColor="hsl(var(--bubble-teal-fg))" label="Tempo médio escrita" value={fmtMs(agg.avgWrites)} />
            <Cell icon={AlertCircle} iconColor={agg.errorCount > 0 ? "hsl(var(--bubble-red-fg))" : "hsl(var(--bubble-green-fg))"} label="Execuções com erro" value={String(agg.errorCount)} sub={`de ${agg.count} (${((agg.errorCount / agg.count) * 100).toFixed(0)}%)`} />
          </div>

          {slowest.length > 0 && (
            <div style={{ borderTop: "1px solid hsl(var(--border))", padding: "16px 22px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>
                Empresas mais lentas
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {slowest.map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 12, fontSize: 12, padding: "6px 0", borderBottom: "1px dashed hsl(var(--border))" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.company_name ?? "(sem empresa)"}</div>
                    <div style={{ color: "hsl(var(--muted-foreground))" }}>{r.items_count} itens</div>
                    <div style={{ color: r.cache_hit ? "hsl(var(--bubble-green-fg))" : "hsl(var(--muted-foreground))" }}>{r.cache_hit ? "cache" : "miss"}</div>
                    <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtMs(r.total_ms)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div style={{ borderTop: "1px solid hsl(var(--border))", padding: "16px 22px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--bubble-red-fg))", marginBottom: 10 }}>
                Últimas falhas
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {errors.map((r) => (
                  <div key={r.id} style={{ fontSize: 12, padding: "6px 10px", background: "hsl(var(--bubble-red-bg))", borderRadius: 6 }}>
                    <div style={{ fontWeight: 600 }}>{r.company_name ?? "(sem empresa)"}</div>
                    <div style={{ color: "hsl(var(--bubble-red-fg))", marginTop: 2 }}>{r.error}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
