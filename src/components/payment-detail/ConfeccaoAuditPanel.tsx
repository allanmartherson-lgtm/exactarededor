import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, AlertTriangle, ShieldAlert, Calculator, Info } from "lucide-react";
import { formatCurrency } from "@/lib/status";
import type { PaymentItemRow, RuleLite } from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";

type Camada = "1" | "2" | "3" | "—";

function detectCamada(label: string | null | undefined, method: string, ruleId: string | null): Camada {
  const l = (label ?? "").toLowerCase();
  if (l.includes("camada 1")) return "1";
  if (l.includes("camada 2") || l.includes("sem acordo") || l.includes("exclus")) return "2";
  if (l.includes("camada 3") || l.includes("fallback")) return "3";
  if (ruleId && method && method !== "sem_regra") return "1";
  return "—";
}

const CAMADA_INFO: Record<Camada, { label: string; desc: string; tone: "ok" | "warn" | "muted" }> = {
  "1": {
    label: "Camada 1 — Cálculo da regra",
    desc: "Regra casou e um dos métodos de cálculo (tabela diferenciada, percentual, valor fixo, pacote, bônus) foi aplicado normalmente.",
    tone: "ok",
  },
  "2": {
    label: "Camada 2 — Sem Acordo / Exclusão",
    desc: "Regra casou, mas o código TUSS está em uma tabela vinculada (sem_acordo/exclusao). O motor encerra com esperado = valor base do convênio (procedure_amount), sem aplicar nenhum método de cálculo — por isso o método aparece vazio.",
    tone: "warn",
  },
  "3": {
    label: "Camada 3 — Fallback Master",
    desc: "Nenhuma regra específica casou e o motor caiu em uma regra master/global. Revisar se a cobertura de regras está adequada.",
    tone: "warn",
  },
  "—": {
    label: "Sem regra",
    desc: "Não há regra cadastrada cobrindo este item. O sistema não calcula valor — necessário cadastrar regra ou excluir o item.",
    tone: "warn",
  },
};


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
  const ruleId = (it as unknown as { applied_rule_id?: string | null }).applied_rule_id ?? null;
  // Camada 2 (Sem acordo / Exclusão) é regra aplicada mesmo sem método de cálculo:
  // o motor encerra com expected = procedure_amount. Se houver applied_rule_id,
  // o item está coberto por uma regra — não é "sem regra".
  if (!ruleId && (!method || method === "sem_regra")) return "sem_regra";
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
    const m = new Map<string, { rule?: RuleLite; method: string; camada: Camada; count: number; total: number; label?: string }>();
    for (const it of items) {
      const anyIt = it as unknown as { applied_rule_id?: string | null; applied_rule_label?: string | null };
      const ruleId =
        anyIt.applied_rule_id ??
        ((it.ai_findings?.matched_rule_ids?.[0] as string | undefined) ?? null);
      const rawMethod = (it.applied_calc_method ?? "") as string;
      const label = anyIt.applied_rule_label ?? null;
      const method = rawMethod
        ? rawMethod
        : label && /Sem acordo/i.test(label)
          ? "sem_acordo"
          : label && /Exclus[ãa]o/i.test(label)
            ? "exclusao"
            : "sem_regra";
      const camada = detectCamada(label, method, ruleId);
      const key = `${ruleId ?? "—"}|${method}|${camada}`;
      const entry = m.get(key) ?? {
        rule: ruleId ? rulesIndex[ruleId] : undefined,
        method,
        camada,
        count: 0,
        total: 0,
        label: label ?? undefined,
      };
      entry.count++;
      entry.total += Number(it.expected_amount ?? 0);
      m.set(key, entry);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [items, rulesIndex]);

  const camadasPresentes = useMemo(() => {
    const set = new Set<Camada>();
    for (const g of grouped) set.add(g.camada);
    return Array.from(set);
  }, [grouped]);



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
            Cada linha agrupa itens pela mesma regra + camada + método de cálculo aplicado pelo motor.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <TooltipProvider delayDuration={150}>
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Regra</th>
                    <th className="text-left px-3 py-2">Camada</th>
                    <th className="text-left px-3 py-2">Método</th>
                    <th className="text-right px-3 py-2">Itens</th>
                    <th className="text-right px-3 py-2">Repasse total</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        Nenhum item processado.
                      </td>
                    </tr>
                  )}
                  {grouped.map((g, idx) => {
                    const info = CAMADA_INFO[g.camada];
                    const methodEmpty = g.method === "sem_acordo" || g.method === "exclusao" || g.method === "sem_regra";
                    return (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2">
                          {g.rule?.name ?? <span className="text-muted-foreground italic">sem regra</span>}
                          {g.label && g.camada === "2" && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">{g.label}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-mono text-[10px] cursor-help",
                                  info.tone === "ok" && "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
                                  info.tone === "warn" && "border-amber-500/50 text-amber-700 dark:text-amber-400",
                                )}
                              >
                                {g.camada === "—" ? "—" : `Camada ${g.camada}`}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <div className="font-semibold text-xs mb-1">{info.label}</div>
                              <div className="text-xs">{info.desc}</div>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-3 py-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="font-mono text-[10px] cursor-help">
                                {g.method}
                              </Badge>
                            </TooltipTrigger>
                            {methodEmpty && (
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                {g.method === "sem_acordo"
                                  ? "Método vazio porque a Camada 2 (Sem Acordo) encerra a regra sem aplicar nenhum cálculo. O esperado é o valor base do convênio."
                                  : g.method === "exclusao"
                                    ? "Método vazio porque a Camada 2 (Exclusão) bloqueia o item da regra."
                                    : "Item não foi coberto por nenhuma regra — não há método de cálculo."}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(g.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      {camadasPresentes.length > 0 && (
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              Legenda das camadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(["1", "2", "3", "—"] as Camada[])
              .filter((c) => camadasPresentes.includes(c))
              .map((c) => {
                const info = CAMADA_INFO[c];
                return (
                  <div key={c} className="flex gap-2 text-xs">
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-mono text-[10px] shrink-0 h-fit",
                        info.tone === "ok" && "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
                        info.tone === "warn" && "border-amber-500/50 text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {c === "—" ? "—" : `Camada ${c}`}
                    </Badge>
                    <div>
                      <div className="font-medium">{info.label}</div>
                      <div className="text-muted-foreground">{info.desc}</div>
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}
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
