import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, ShieldAlert, Calculator } from "lucide-react";
import { formatCurrency } from "@/lib/status";
import type { PaymentItemRow, RuleLite } from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";

/**
 * Aba dedicada do modo CONFECÇÃO.
 * Objetivo: dar ao analista segurança de que os cálculos foram aplicados
 * conforme as regras. Mostra, por item:
 *   - Base (tabela) usada
 *   - Regra casada (nome + tipo de cálculo)
 *   - Repasse calculado pelo sistema
 *   - Sinal de cobertura (regra/sem_regra)
 *
 * NÃO mostra coluna de "pago" nem "diferença" — não existem no modo confecção.
 */
export interface ConfeccaoAuditPanelProps {
  items: PaymentItemRow[];
  rulesIndex: Record<string, RuleLite>;
}

type CoverageStatus = "ok" | "sem_regra" | "zerado";

function coverageOf(it: PaymentItemRow): CoverageStatus {
  const expected = Number(it.expected_amount ?? 0);
  const method = (it.applied_calc_method ?? "") as string;
  if (!method || method === "sem_regra") return "sem_regra";
  if (expected <= 0) return "zerado";
  return "ok";
}

export function ConfeccaoAuditPanel({ items, rulesIndex }: ConfeccaoAuditPanelProps) {
  const stats = useMemo(() => {
    let ok = 0, semRegra = 0, zerado = 0, total = 0;
    let somaBase = 0, somaRepasse = 0;
    for (const it of items) {
      total++;
      somaBase += Number(it.procedure_amount ?? 0);
      somaRepasse += Number(it.expected_amount ?? 0);
      const c = coverageOf(it);
      if (c === "ok") ok++;
      else if (c === "sem_regra") semRegra++;
      else zerado++;
    }
    return { ok, semRegra, zerado, total, somaBase, somaRepasse };
  }, [items]);

  const grouped = useMemo(() => {
    const m = new Map<string, { rule?: RuleLite; method: string; count: number; total: number }>();
    for (const it of items) {
      const ruleId = (it.matched_rule_id ?? (it.ai_findings?.matched_rule_ids?.[0] as string | undefined)) ?? null;
      const method = (it.applied_calc_method ?? "sem_regra") as string;
      const key = `${ruleId ?? "—"}|${method}`;
      const entry = m.get(key) ?? { rule: ruleId ? rulesIndex[ruleId] : undefined, method, count: 0, total: 0 };
      entry.count++;
      entry.total += Number(it.expected_amount ?? 0);
      m.set(key, entry);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [items, rulesIndex]);

  return (
    <div className="space-y-3" data-testid="confeccao-audit-panel">
      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            Auditoria do cálculo de repasse
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Resumo de cobertura: quantos itens tiveram regra aplicada com sucesso, quantos ficaram sem regra cadastrada
            (não calculados pelo sistema) e quantos retornaram repasse zerado.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <Metric label="Total de itens" value={String(stats.total)} />
            <Metric
              label="Com regra"
              value={String(stats.ok)}
              tone="ok"
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            />
            <Metric
              label="Sem regra"
              value={String(stats.semRegra)}
              tone={stats.semRegra > 0 ? "warn" : "muted"}
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
            />
            <Metric
              label="Repasse zerado"
              value={String(stats.zerado)}
              tone={stats.zerado > 0 ? "warn" : "muted"}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
            <Metric label="Total repasse" value={formatCurrency(stats.somaRepasse)} />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Regras aplicadas</CardTitle>
          <p className="text-xs text-muted-foreground">
            Cada linha agrupa itens pela mesma regra + método de cálculo aplicado pelo motor.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Regra</th>
                  <th className="text-left px-3 py-2">Método</th>
                  <th className="text-right px-3 py-2">Itens</th>
                  <th className="text-right px-3 py-2">Repasse total</th>
                </tr>
              </thead>
              <tbody>
                {grouped.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhum item processado.
                    </td>
                  </tr>
                )}
                {grouped.map((g, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-3 py-2">
                      {g.rule?.name ?? <span className="text-muted-foreground italic">sem regra</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="font-mono text-[10px]">{g.method}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(g.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn" | "muted";
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card px-3 py-2",
        tone === "ok" && "border-emerald-500/40 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
