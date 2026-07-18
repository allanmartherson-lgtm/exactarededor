import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShieldAlert,
  ArrowRight,
  AlertTriangle,
  DollarSign,
  Layers,
  CheckCircle2,
  Building2,
  ChevronDown,
  ChevronRight,
  ListFilter,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";
import type { TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

type RuleAgg = {
  rule_name: string;
  alertas: number;
  valor: number;
  acatados: number;
  lotes: Set<string>;
};

type ItemDetail = {
  id: string;
  payment_id: string;
  payment_ref: string;
  company_name: string;
  doctor_name: string;
  procedure_name: string;
  gross: number;
  divergPct: number | null;
  ai_status: string;
  rule_names: string[];
};

type CompanyAgg = {
  company_name: string;
  alertas: number;
  valor: number;
};


type Totals = {
  alertas: number;
  valor: number;
  acatados: number;
  lotes: number;
  byRule: Map<string, RuleAgg>;
  items: ItemDetail[];
  byCompany: CompanyAgg[];
};

const EMPTY: Totals = {
  alertas: 0,
  valor: 0,
  acatados: 0,
  lotes: 0,
  byRule: new Map(),
  items: [],
  byCompany: [],
};

export function ValidationRiskSection({ track = "all" }: { track?: TrackFilterValue } = {}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Totals>(EMPTY);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const baseSelect =
        "id, gross_amount, expected_amount, payment_id, validation_findings, ai_status, company_name, doctor_name, procedure_name, procedure_code, payments!inner(payment_track, reference, title)";

      let qFindings = supabase
        .from("payment_items")
        .select(baseSelect)
        .not("validation_findings", "is", null)
        .neq("validation_findings", "[]");
      let qAlerta = supabase.from("payment_items").select(baseSelect).eq("ai_status", "alerta");
      let qDiverg = supabase.from("payment_items").select(baseSelect).gt("expected_amount", 0);

      if (track === "habitual" || track === "prioritario") {
        qFindings = qFindings.eq("payments.payment_track", track);
        qAlerta = qAlerta.eq("payments.payment_track", track);
        qDiverg = qDiverg.eq("payments.payment_track", track);
      } else if (track === "nao_classificado") {
        qFindings = qFindings.is("payments.payment_track", null);
        qAlerta = qAlerta.is("payments.payment_track", null);
        qDiverg = qDiverg.is("payments.payment_track", null);
      }

      const [rFindings, rAlerta, rDiverg] = await Promise.all([qFindings, qAlerta, qDiverg]);
      if (cancelled) return;

      const byRule = new Map<string, RuleAgg>();
      const allLotes = new Set<string>();
      let totalAlertas = 0;
      let totalValor = 0;
      let totalAcatados = 0;
      const valuedItems = new Set<string>();
      const itemMap = new Map<string, ItemDetail>();

      type Row = {
        id: string;
        gross_amount: number | null;
        expected_amount: number | null;
        payment_id?: string;
        validation_findings?: unknown;
        ai_status?: string;
        company_name?: string | null;
        doctor_name?: string | null;
        procedure_name?: string | null;
        procedure_code?: string | null;
        payments?: { payment_track?: string | null; reference?: string | null; title?: string | null } | null;
      };

      const paymentRefFrom = (it: Row) =>
        it.payments?.reference || it.payments?.title || "Sem referência";

      const registerItem = (it: Row, ruleName: string) => {
        const exp = Number(it.expected_amount ?? 0);
        const gross = Number(it.gross_amount ?? 0);
        const divergPct = exp > 0 ? ((gross - exp) / exp) * 100 : null;
        const cur = itemMap.get(it.id);
        if (cur) {
          if (!cur.rule_names.includes(ruleName)) cur.rule_names.push(ruleName);
          return;
        }
        itemMap.set(it.id, {
          id: it.id,
          payment_id: it.payment_id ?? "",
          payment_ref: paymentRefFrom(it),
          company_name: it.company_name?.trim() || "— Sem PJ —",
          doctor_name: it.doctor_name?.trim() || "—",
          procedure_name:
            it.procedure_name?.trim() || (it.procedure_code ? `TUSS ${it.procedure_code}` : "—"),
          gross,
          divergPct,
          ai_status: it.ai_status || "—",
          rule_names: [ruleName],
        });
      };

      const bump = (key: string, ruleName: string, item: Row) => {
        const cur = byRule.get(key) ?? {
          rule_name: ruleName,
          alertas: 0,
          valor: 0,
          acatados: 0,
          lotes: new Set<string>(),
        };
        const v = Number(item.gross_amount ?? 0);
        cur.alertas += 1;
        cur.valor += v;
        if (item.ai_status === "acatado") cur.acatados += 1;
        if (item.payment_id) cur.lotes.add(item.payment_id);
        byRule.set(key, cur);
        totalAlertas += 1;
        if (item.ai_status === "acatado") totalAcatados += 1;
        if (item.payment_id) allLotes.add(item.payment_id);
        if (!valuedItems.has(item.id)) {
          totalValor += v;
          valuedItems.add(item.id);
        }
        registerItem(item, ruleName);
      };

      // Fonte 1: validation_findings
      for (const it of ((rFindings.data as unknown as Row[]) ?? [])) {
        const findings = it.validation_findings;
        if (!Array.isArray(findings)) continue;
        for (const f of findings as Array<{ rule_id?: string; rule_name?: string }>) {
          const key = f.rule_id || f.rule_name;
          if (!key) continue;
          bump(key, f.rule_name || key, it);
        }
      }

      // Fonte 2: ai_status = 'alerta' — evita dupla contagem se já entrou por findings
      const findingIds = new Set(((rFindings.data as unknown as Row[]) ?? []).map((r) => r.id));
      for (const it of ((rAlerta.data as unknown as Row[]) ?? [])) {
        if (findingIds.has(it.id)) continue;
        bump("__motor_regras_alerta", "Motor de regras — alerta", it);
      }

      // Fonte 3: divergência > 10%
      for (const it of ((rDiverg.data as unknown as Row[]) ?? [])) {
        const exp = Number(it.expected_amount ?? 0);
        const gross = Number(it.gross_amount ?? 0);
        if (exp <= 0) continue;
        const diffPct = Math.abs(gross - exp) / exp;
        if (diffPct <= 0.1) continue;
        bump("__divergencia_valor", "Divergência de valor > 10%", it);
      }

      // Ordenar itens por magnitude da divergência (desc) e, fallback, por valor bruto
      const items = Array.from(itemMap.values()).sort((a, b) => {
        const ad = a.divergPct == null ? -1 : Math.abs(a.divergPct);
        const bd = b.divergPct == null ? -1 : Math.abs(b.divergPct);
        if (bd !== ad) return bd - ad;
        return b.gross - a.gross;
      });

      // Breakdown por empresa
      const companyMap = new Map<string, CompanyAgg>();
      for (const it of items) {
        const cur = companyMap.get(it.company_name) ?? {
          company_name: it.company_name,
          alertas: 0,
          valor: 0,
        };
        cur.alertas += 1;
        cur.valor += it.gross;
        companyMap.set(it.company_name, cur);
      }
      const byCompany = Array.from(companyMap.values())
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 5);

      setData({
        alertas: totalAlertas,
        valor: totalValor,
        acatados: totalAcatados,
        lotes: allLotes.size,
        byRule,
        items,
        byCompany,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [track]);



  if (loading) {
    return (
      <div
        style={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 12,
          padding: 22,
        }}
      >
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{ height: 40, background: "hsl(var(--muted))", borderRadius: 6, marginBottom: 8, opacity: 0.3 }}
          />
        ))}
      </div>
    );
  }

  const taxaAcate = data.alertas > 0 ? (data.acatados / data.alertas) * 100 : 0;

  const kpis = [
    { label: "Alertas ativos", value: data.alertas.toLocaleString("pt-BR"), Icon: AlertTriangle },
    { label: "Valor em risco", value: formatCurrency(data.valor), Icon: DollarSign },
    { label: "Lotes afetados", value: data.lotes.toLocaleString("pt-BR"), Icon: Layers },
    { label: "Taxa de acate", value: `${taxaAcate.toFixed(0)}%`, Icon: CheckCircle2 },
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(({ label, value, Icon }) => (
          <div
            key={label}
            className="rounded-xl border bg-card p-4 flex items-center gap-3"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <div
              className="flex items-center justify-center rounded-lg"
              style={{
                width: 36,
                height: 36,
                background: "hsl(var(--muted))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg font-semibold tabular-nums">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {data.byRule.size === 0 ? (
        <div
          style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 12,
            padding: 22,
            textAlign: "center",
            fontSize: 13,
            color: "hsl(var(--muted-foreground))",
          }}
        >
          Nenhum alerta identificado — motor de regras e validações não detectaram divergências nos lotes ativos.
        </div>
      ) : (
        <div
          style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 12,
          }}
        >
          <div
            className="flex items-center justify-between gap-3"
            style={{ padding: "18px 22px", borderBottom: "1px solid hsl(var(--border))" }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "hsl(var(--bubble-yellow-bg))",
                  color: "hsl(var(--bubble-yellow-fg))",
                }}
              >
                <ShieldAlert size={14} />
              </div>
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "hsl(var(--foreground))",
                  letterSpacing: "-0.01em",
                }}
              >
                Impacto financeiro por regra de validação
              </h3>
            </div>
            <Link
              to="/regras/validacao"
              style={{
                fontSize: 12,
                color: "hsl(var(--accent))",
                fontWeight: 500,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              Gerenciar regras <ArrowRight size={13} />
            </Link>
          </div>
          <div>
            {Array.from(data.byRule.entries()).map(([key, d], i, arr) => {
              const taxa = d.alertas > 0 ? (d.acatados / d.alertas) * 100 : 0;
              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 22px",
                    borderBottom: i < arr.length - 1 ? "1px solid hsl(var(--border))" : "none",
                    background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.3)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))" }}>
                      {d.rule_name}
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                      {d.alertas} alerta{d.alertas !== 1 ? "s" : ""} · {d.lotes.size} lote
                      {d.lotes.size !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "hsl(var(--muted-foreground))",
                      fontVariantNumeric: "tabular-nums",
                      width: 110,
                      textAlign: "right",
                      flexShrink: 0,
                    }}
                    title={`${d.acatados} de ${d.alertas} acatados`}
                  >
                    Acate: {taxa.toFixed(0)}%
                  </div>
                  <div
                    style={{
                      background: "hsl(var(--bubble-yellow-bg))",
                      border: "1px solid hsl(var(--bubble-yellow-fg) / 0.3)",
                      borderRadius: 8,
                      padding: "4px 12px",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "hsl(var(--bubble-yellow-fg))",
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                  >
                    {formatCurrency(d.valor)}
                  </div>
                </div>
              );
            })}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 22px",
                background: "hsl(var(--accent) / 0.08)",
                borderTop: "1px solid hsl(var(--border))",
                borderRadius: "0 0 12px 12px",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--accent))" }}>
                Total em risco — {data.alertas} alertas · {data.lotes} lotes · acate {taxaAcate.toFixed(0)}%
              </span>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "hsl(var(--accent))",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatCurrency(data.valor)}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
