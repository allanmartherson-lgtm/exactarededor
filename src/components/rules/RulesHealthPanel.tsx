import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Stethoscope, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateCalcOnlyFilters } from "@/../supabase/functions/_shared/rulesEngine";

type Severity = "erro" | "aviso";
type Issue = { severity: Severity; code: string; message: string };
type RuleHealth = {
  id: string;
  name: string;
  active: boolean;
  scope: string;
  issues: Issue[];
};

const ISSUE_LABELS: Record<string, string> = {
  no_calc: "Regra sem cálculo cadastrado",
  legacy_filter: "Filtro restritivo no nível Regra (legado)",
  bonus_no_value: "Bônus sem valor nem percentual",
  fixed_no_value: "Valor fixo sem montante",
  tabdiff_no_table: "Tabela diferenciada sem tabela vinculada",
  pct_conv_missing: "% sobre convênio sem percentual",
  pacote_no_amount: "Pacote sem valor (package_amount)",
  complemento_no_target: "Complemento sem valor-alvo",
  whitelist_empty: "Whitelist de códigos vazia",
  duplicate_label: "Cálculos com rótulos duplicados",
};

function severityTone(sev: Severity) {
  return sev === "erro"
    ? "border-destructive/40 bg-destructive/5 text-destructive"
    : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400";
}

export function RulesHealthPanel({ onSelectRule }: { onSelectRule?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RuleHealth[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const analyze = async () => {
    setLoading(true);
    try {
      const { data: rules } = await supabase.from("rules").select("*").order("created_at", { ascending: false });
      const { data: calcs } = await supabase.from("rule_calculations").select("*");
      const byRule = new Map<string, any[]>();
      (calcs ?? []).forEach((c: any) => {
        const arr = byRule.get(c.rule_id) ?? [];
        arr.push(c);
        byRule.set(c.rule_id, arr);
      });

      const result: RuleHealth[] = (rules ?? []).map((r: any) => {
        const issues: Issue[] = [];
        const calcList = byRule.get(r.id) ?? [];

        // Filtros legados no nível Regra
        const legacy = validateCalcOnlyFilters({ ...r, calculations: calcList } as any);
        legacy.forEach((m) => issues.push({ severity: "aviso", code: "legacy_filter", message: m }));

        // Sem cálculo
        if (calcList.length === 0) {
          issues.push({ severity: "erro", code: "no_calc", message: "Regra não possui nenhum item de cálculo." });
        }

        // Rótulos duplicados
        const labels = calcList.map((c: any) => (c.label || "").trim().toLowerCase()).filter(Boolean);
        const dup = labels.find((l, i) => labels.indexOf(l) !== i);
        if (dup) issues.push({ severity: "aviso", code: "duplicate_label", message: `Rótulo duplicado: "${dup}".` });

        // Validação por tipo de cálculo
        for (const c of calcList) {
          const lab = c.label || c.calculation_type;
          switch (c.calculation_type) {
            case "bonus":
              if (c.bonus_amount == null && c.bonus_pct == null) {
                issues.push({ severity: "erro", code: "bonus_no_value", message: `[${lab}] bônus sem valor nem percentual.` });
              }
              break;
            case "valor_fixo":
              if (c.fixed_amount == null) {
                issues.push({ severity: "erro", code: "fixed_no_value", message: `[${lab}] valor fixo sem montante.` });
              }
              break;
            case "tabela_diferenciada":
              if (!c.reference_table_id) {
                issues.push({ severity: "erro", code: "tabdiff_no_table", message: `[${lab}] tabela diferenciada sem tabela de referência.` });
              }
              break;
            case "percentual_sobre_convenio":
              if (c.convenio_percentage == null) {
                issues.push({ severity: "erro", code: "pct_conv_missing", message: `[${lab}] % sobre convênio sem percentual.` });
              }
              break;
            case "pacote":
            case "pacote_fechado":
            case "pacote_com_extras":
            case "pacote_por_atendimento":
              if (c.package_amount == null) {
                issues.push({ severity: "erro", code: "pacote_no_amount", message: `[${lab}] pacote sem valor (package_amount).` });
              }
              break;
            case "complemento":
              if (c.target_amount == null) {
                issues.push({ severity: "erro", code: "complemento_no_target", message: `[${lab}] complemento sem valor-alvo.` });
              }
              break;
          }
          // Whitelist vazia mas modo whitelist
          if ((c.code_match_mode ?? "whitelist") === "whitelist") {
            const codes = Array.isArray(c.procedure_codes) ? c.procedure_codes : [];
            if (codes.length === 0 && c.calculation_type !== "informativo") {
              // Apenas aviso: whitelist vazia = qualquer código (fallback) — desejado em alguns casos
            }
          }
        }

        return { id: r.id, name: r.name, active: !!r.active, scope: r.scope, issues };
      });
      setRows(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && rows.length === 0) analyze();
  }, [open]);

  const stats = useMemo(() => {
    const inconsistent = rows.filter((r) => r.issues.length > 0);
    const errors = rows.reduce((a, r) => a + r.issues.filter((i) => i.severity === "erro").length, 0);
    const warns = rows.reduce((a, r) => a + r.issues.filter((i) => i.severity === "aviso").length, 0);
    return { total: rows.length, inconsistent: inconsistent.length, errors, warns };
  }, [rows]);

  const inconsistentRows = rows.filter((r) => r.issues.length > 0);

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-4 space-y-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <Stethoscope className="h-5 w-5 text-amber-600" />
            <div>
              <div className="font-semibold flex items-center gap-2">
                Saúde das Regras
                {rows.length > 0 && (
                  <Badge variant="outline" className="ml-1">
                    {stats.inconsistent}/{stats.total} com problemas
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Verifica consistência: cálculos faltando, valores vazios, filtros legados, ambiguidade.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <>
                <Badge className="bg-destructive/10 text-destructive border border-destructive/30">
                  {stats.errors} erros
                </Badge>
                <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                  {stats.warns} avisos
                </Badge>
              </>
            )}
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </button>

        {open && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={analyze} disabled={loading}>
                <RefreshCw className={cn("h-3 w-3 mr-1", loading && "animate-spin")} />
                {loading ? "Analisando..." : "Reanalisar"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {loading ? "Verificando regras..." : `${stats.total} regras avaliadas`}
              </span>
            </div>

            {!loading && inconsistentRows.length === 0 && rows.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded p-3">
                <CheckCircle2 className="h-4 w-4" />
                Todas as regras passaram na verificação.
              </div>
            )}

            {inconsistentRows.map((r) => {
              const isOpen = expanded.has(r.id);
              const errCount = r.issues.filter((i) => i.severity === "erro").length;
              const warnCount = r.issues.filter((i) => i.severity === "aviso").length;
              return (
                <div key={r.id} className="border border-border bg-background rounded-md">
                  <button
                    type="button"
                    onClick={() => {
                      const ns = new Set(expanded);
                      ns.has(r.id) ? ns.delete(r.id) : ns.add(r.id);
                      setExpanded(ns);
                    }}
                    className="w-full flex items-center justify-between p-3 text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                      <AlertTriangle className={cn("h-4 w-4 shrink-0", errCount > 0 ? "text-destructive" : "text-amber-600")} />
                      <span className="font-medium truncate">{r.name}</span>
                      {!r.active && <Badge variant="outline" className="text-xs">inativa</Badge>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {errCount > 0 && <Badge className="bg-destructive/10 text-destructive border border-destructive/30 text-xs">{errCount} erro{errCount > 1 ? "s" : ""}</Badge>}
                      {warnCount > 0 && <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-700">{warnCount} aviso{warnCount > 1 ? "s" : ""}</Badge>}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2">
                      {r.issues.map((i, idx) => (
                        <div key={idx} className={cn("text-xs rounded border px-2 py-1.5", severityTone(i.severity))}>
                          <span className="font-semibold uppercase mr-2">{i.severity}</span>
                          <span className="opacity-80 mr-1">[{ISSUE_LABELS[i.code] ?? i.code}]</span>
                          {i.message}
                        </div>
                      ))}
                      {onSelectRule && (
                        <Button size="sm" variant="outline" onClick={() => onSelectRule(r.id)}>
                          Editar regra
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
