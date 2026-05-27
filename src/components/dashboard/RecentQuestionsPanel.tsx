import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Building2, Users, ArrowRight, Filter } from "lucide-react";

type QType = "interno" | "empresa";
type QRow = {
  id: string;
  type: QType;
  payment_id: string;
  payment_ref: string;
  message: string;
  author: string;
  created_at: string;
  resolved: boolean;
  link: string;
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 mb-3">
    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>
      {children}
    </span>
    <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
  </div>
);

const formatRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

export default function RecentQuestionsPanel() {
  const [rows, setRows] = useState<QRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | QType>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [obsRes, iqRes] = await Promise.all([
        supabase
          .from("payment_observations")
          .select("id, payment_id, message, author_type, created_at, resolved_at, payment:payments!inner(reference)")
          .eq("is_question", true)
          .order("created_at", { ascending: false })
          .limit(60),
        supabase
          .from("invoice_questions")
          .select("id, payment_id, invoice_id, message, author_type, author_name, created_at, answered_at, read_at, payment:payments!inner(reference)")
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
      if (cancelled) return;

      const internos: QRow[] = ((obsRes.data ?? []) as any[]).map((o) => ({
        id: `obs-${o.id}`,
        type: "interno",
        payment_id: o.payment_id,
        payment_ref: o.payment?.reference ?? "—",
        message: o.message,
        author: o.author_type,
        created_at: o.created_at,
        resolved: !!o.resolved_at,
        link: `/pagamentos/${o.payment_id}#observacoes`,
      }));

      const empresa: QRow[] = ((iqRes.data ?? []) as any[]).map((q) => ({
        id: `iq-${q.id}`,
        type: "empresa",
        payment_id: q.payment_id,
        payment_ref: q.payment?.reference ?? "—",
        message: q.message,
        author: q.author_type === "recebedor" ? (q.author_name || "Empresa") : "Analista",
        created_at: q.created_at,
        resolved: !!q.answered_at || !!q.read_at,
        link: `/pagamentos/${q.payment_id}#nf`,
      }));

      const merged = [...internos, ...empresa]
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        .slice(0, 80);
      setRows(merged);
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel("dash_recent_questions")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_observations" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_questions" }, () => load())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  const paymentsList = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach((r) => { if (!seen.has(r.payment_id)) seen.set(r.payment_id, r.payment_ref); });
    return Array.from(seen.entries()).map(([id, ref]) => ({ id, ref }));
  }, [rows]);

  const openRows = useMemo(() => rows.filter((r) => !r.resolved), [rows]);
  const baseRows = showResolved ? rows : openRows;

  const filtered = useMemo(() => baseRows.filter((r) =>
    (typeFilter === "all" || r.type === typeFilter) &&
    (paymentFilter === "all" || r.payment_id === paymentFilter)
  ), [baseRows, typeFilter, paymentFilter]);

  const counts = useMemo(() => ({
    all: baseRows.length,
    interno: baseRows.filter((r) => r.type === "interno").length,
    empresa: baseRows.filter((r) => r.type === "empresa").length,
  }), [baseRows]);

  const resolvedCount = rows.length - openRows.length;

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 6,
    border: "none", cursor: "pointer", transition: "all 0.15s ease",
    background: active ? "hsl(var(--primary))" : "transparent",
    color: active ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
  });

  return (
    <section aria-labelledby="recent-questions-heading">
      <SectionLabel>Últimos questionamentos</SectionLabel>
      <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}>
        <div className="flex flex-wrap items-center justify-between gap-3" style={{ padding: "16px 20px", borderBottom: "1px solid hsl(var(--border))" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(var(--bubble-yellow-bg))", color: "hsl(var(--bubble-yellow-fg))" }}>
              <MessageCircle size={14} />
            </div>
            <h3 id="recent-questions-heading" style={{ fontSize: 14, fontWeight: 600, color: "hsl(var(--foreground))", letterSpacing: "-0.01em" }}>
              Perguntas internas e da empresa
            </h3>
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))", borderRadius: 12, padding: "2px 8px", fontWeight: 600 }}>
              {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div role="radiogroup" aria-label="Filtrar por tipo" style={{ display: "inline-flex", background: "hsl(var(--muted))", borderRadius: 8, padding: 3, gap: 2 }}>
              <button type="button" role="radio" aria-checked={typeFilter === "all"} onClick={() => setTypeFilter("all")} style={chip(typeFilter === "all")}>
                Todos · {counts.all}
              </button>
              <button type="button" role="radio" aria-checked={typeFilter === "interno"} onClick={() => setTypeFilter("interno")} style={chip(typeFilter === "interno")}>
                Internos · {counts.interno}
              </button>
              <button type="button" role="radio" aria-checked={typeFilter === "empresa"} onClick={() => setTypeFilter("empresa")} style={chip(typeFilter === "empresa")}>
                Empresa · {counts.empresa}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <Filter size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                aria-label="Filtrar por lote"
                style={{
                  fontSize: 12, fontWeight: 500, padding: "5px 8px", borderRadius: 6,
                  border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
                  color: "hsl(var(--foreground))", cursor: "pointer", maxWidth: 200,
                }}
              >
                <option value="all">Todos os lotes</option>
                {paymentsList.map((p) => (
                  <option key={p.id} value={p.id}>{p.ref}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
            Carregando…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
            Nenhum questionamento {typeFilter !== "all" ? `do tipo "${typeFilter}"` : ""} {paymentFilter !== "all" ? "neste lote" : ""}.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 480, overflowY: "auto" }}>
            {filtered.map((r, i) => {
              const isEmpresa = r.type === "empresa";
              return (
                <li key={r.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid hsl(var(--border))" : "none" }}>
                  <Link to={r.link} className="hover:bg-muted/40 transition-colors" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 20px", textDecoration: "none", color: "inherit" }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isEmpresa ? "hsl(var(--bubble-red-bg))" : "hsl(var(--bubble-yellow-bg))",
                      color: isEmpresa ? "hsl(var(--bubble-red-fg))" : "hsl(var(--bubble-yellow-fg))",
                    }}>
                      {isEmpresa ? <Building2 size={14} /> : <Users size={14} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                          padding: "2px 7px", borderRadius: 12,
                          background: isEmpresa ? "hsl(var(--bubble-red-bg))" : "hsl(var(--bubble-yellow-bg))",
                          color: isEmpresa ? "hsl(var(--bubble-red-fg))" : "hsl(var(--bubble-yellow-fg))",
                        }}>
                          {isEmpresa ? "Empresa (NF)" : "Interno"}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))" }}>{r.payment_ref}</span>
                        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>· {r.author}</span>
                        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>· {formatRelative(r.created_at)}</span>
                        {r.resolved && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--bubble-green-fg))", background: "hsl(var(--bubble-green-bg))", padding: "1px 6px", borderRadius: 10 }}>
                            resolvido
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, color: "hsl(var(--foreground))", lineHeight: 1.4, margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {r.message}
                      </p>
                    </div>
                    <ArrowRight size={14} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0, marginTop: 8 }} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
