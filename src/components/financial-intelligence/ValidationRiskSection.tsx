import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";

type ValidationImpact = {
  alertas: number;
  valor: number;
  byRule: Map<string, { alertas: number; valor: number }>;
};

export function ValidationRiskSection() {
  const [loading, setLoading] = useState(true);
  const [validationImpact, setValidationImpact] = useState<ValidationImpact>({
    alertas: 0,
    valor: 0,
    byRule: new Map(),
  });

  useEffect(() => {
    (async () => {
      const { data: items } = await supabase
        .from("payment_items")
        .select("gross_amount, validation_findings")
        .not("validation_findings", "is", null)
        .neq("validation_findings", "[]");

      const byRule = new Map<string, { alertas: number; valor: number }>();
      let totalAlertas = 0;
      let totalValor = 0;
      for (const it of items ?? []) {
        const findings = it.validation_findings as any[];
        if (!Array.isArray(findings)) continue;
        for (const f of findings) {
          if (!f.rule_name) continue;
          const cur = byRule.get(f.rule_name) ?? { alertas: 0, valor: 0 };
          cur.alertas += 1;
          cur.valor += Number(it.gross_amount ?? 0);
          byRule.set(f.rule_name, cur);
          totalAlertas++;
          totalValor += Number(it.gross_amount ?? 0);
        }
      }
      setValidationImpact({ alertas: totalAlertas, valor: totalValor, byRule });
      setLoading(false);
    })();
  }, []);

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

  if (validationImpact.byRule.size === 0) {
    return (
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
        Nenhum alerta de validação em aberto.
      </div>
    );
  }

  return (
    <section>
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
              color: "#9A6B3A",
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
          {Array.from(validationImpact.byRule.entries()).map(([name, data], i, arr) => (
            <div
              key={name}
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
                <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))" }}>{name}</div>
                <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                  {data.alertas} alerta{data.alertas !== 1 ? "s" : ""} detectado{data.alertas !== 1 ? "s" : ""}
                </div>
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
                {formatCurrency(data.valor)}
              </div>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 22px",
              background: "#fdf5ec",
              borderTop: "1px solid hsl(var(--border))",
              borderRadius: "0 0 12px 12px",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#9A6B3A" }}>
              Total em risco — {validationImpact.alertas} alertas
            </span>
            <span
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "#9A6B3A",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatCurrency(validationImpact.valor)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
