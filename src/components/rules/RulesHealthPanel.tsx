import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Stethoscope, RefreshCw, UserX, Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateCalcOnlyFilters } from "@/../supabase/functions/_shared/rulesEngine";
import {
  detectDoctorMultiRule,
  type DoctorMultiRuleProblem,
} from "@/../supabase/functions/_shared/doctorMultiRule";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

function fpCell(values: string[], max = 8): string {
  if (!values || values.length === 0) return "—";
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown} (+${values.length - max})` : shown;
}

function buildCollisionRows(collisions: DoctorMultiRuleProblem[]) {
  const rows: { doctor: string; ruleA: string; ruleB: string; codesA: string; codesB: string; sectorsA: string; sectorsB: string; agreementsA: string; agreementsB: string; routesA: string; routesB: string; diff: string }[] = [];
  for (const c of collisions) {
    const ids = c.rule_ids;
    const fps = c.rule_fingerprints ?? [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = fps[i] ?? { codes: [], sectors: [], agreements: [], routes: [] };
        const b = fps[j] ?? { codes: [], sectors: [], agreements: [], routes: [] };
        const diffs: string[] = [];
        const sameArr = (x: string[], y: string[]) => x.length === y.length && x.every((v, k) => v === y[k]);
        if (!sameArr(a.codes, b.codes)) diffs.push("códigos");
        if (!sameArr(a.sectors, b.sectors)) diffs.push("setores");
        if (!sameArr(a.agreements, b.agreements)) diffs.push("convênios");
        if (!sameArr(a.routes, b.routes)) diffs.push("vias");
        rows.push({
          doctor: c.doctor_label,
          ruleA: c.rule_names[i],
          ruleB: c.rule_names[j],
          codesA: fpCell(a.codes), codesB: fpCell(b.codes),
          sectorsA: fpCell(a.sectors), sectorsB: fpCell(b.sectors),
          agreementsA: fpCell(a.agreements), agreementsB: fpCell(b.agreements),
          routesA: fpCell(a.routes), routesB: fpCell(b.routes),
          diff: diffs.length ? diffs.join(" · ") : "nenhuma (ambíguo)",
        });
      }
    }
  }
  return rows;
}

function exportDoctorCollisionsCsv(collisions: DoctorMultiRuleProblem[]) {
  const rows = buildCollisionRows(collisions);
  const headers = ["Médico", "Regra A", "Regra B", "Códigos A", "Códigos B", "Setores A", "Setores B", "Convênios A", "Convênios B", "Vias A", "Vias B", "Campos que diferem"];
  const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(";"), ...rows.map((r) => [r.doctor, r.ruleA, r.ruleB, r.codesA, r.codesB, r.sectorsA, r.sectorsB, r.agreementsA, r.agreementsB, r.routesA, r.routesB, r.diff].map(esc).join(";"))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medicos-multi-regras-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDoctorCollisionsPdf(collisions: DoctorMultiRuleProblem[]) {
  const rows = buildCollisionRows(collisions);
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Médicos vinculados a múltiplas regras sem distinção", 14, 14);
  doc.setFontSize(9);
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")} · ${collisions.length} médico(s) · ${rows.length} par(es) de regras`, 14, 20);
  autoTable(doc, {
    startY: 26,
    head: [["Médico", "Regra A", "Regra B", "Códigos A | B", "Setores A | B", "Convênios A | B", "Vias A | B", "Diferem em"]],
    body: rows.map((r) => [
      r.doctor,
      r.ruleA,
      r.ruleB,
      `${r.codesA}\n— vs —\n${r.codesB}`,
      `${r.sectorsA}\n— vs —\n${r.sectorsB}`,
      `${r.agreementsA}\n— vs —\n${r.agreementsB}`,
      `${r.routesA}\n— vs —\n${r.routesB}`,
      r.diff,
    ]),
    styles: { fontSize: 7, cellWidth: "wrap", valign: "top" },
    headStyles: { fillColor: [220, 38, 38], textColor: 255, fontSize: 8 },
    columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 32 }, 2: { cellWidth: 32 }, 7: { cellWidth: 28, fontStyle: "bold" } },
  });
  doc.save(`medicos-multi-regras-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function RulesHealthPanel({ onSelectRule }: { onSelectRule?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RuleHealth[]>([]);
  const [doctorCollisions, setDoctorCollisions] = useState<DoctorMultiRuleProblem[]>([]);
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

      // Cross-rule: médico em múltiplas regras ativas sem restrições diferenciadoras
      const activeRules = (rules ?? []).filter((r: any) => !!r.active);
      const collisions = detectDoctorMultiRule(activeRules as any, byRule as any);
      setDoctorCollisions(collisions);
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
                {doctorCollisions.length > 0 && (
                  <Badge className="bg-destructive/10 text-destructive border border-destructive/30 flex items-center gap-1">
                    <UserX className="h-3 w-3" />
                    {doctorCollisions.length} médico{doctorCollisions.length > 1 ? "s" : ""} em conflito
                  </Badge>
                )}
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

            {!loading && inconsistentRows.length === 0 && doctorCollisions.length === 0 && rows.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded p-3">
                <CheckCircle2 className="h-4 w-4" />
                Todas as regras passaram na verificação.
              </div>
            )}

            {doctorCollisions.length > 0 && (
              <div className="border border-destructive/40 bg-destructive/5 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                    <UserX className="h-4 w-4" />
                    Médicos vinculados a múltiplas regras sem distinção
                    <Badge className="bg-destructive/10 text-destructive border border-destructive/30 text-xs ml-1">
                      {doctorCollisions.length}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportDoctorCollisionsCsv(doctorCollisions)}>
                      <Download className="h-3 w-3 mr-1" /> CSV
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportDoctorCollisionsPdf(doctorCollisions)}>
                      <FileText className="h-3 w-3 mr-1" /> PDF
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Um médico só pode estar em mais de uma regra ativa se ao menos uma delas tiver restrições (códigos, setor, convênio ou via de acesso) que a outra não tenha. Caso contrário, há ambiguidade no motor.
                </p>
                <div className="space-y-2">
                  {doctorCollisions.map((c) => (
                    <div key={c.doctor_key} className="text-xs rounded border border-destructive/30 bg-background px-2 py-2">
                      <div className="font-semibold mb-1">{c.doctor_label}</div>
                      <div className="text-muted-foreground mb-1">Regras em conflito:</div>
                      <ul className="space-y-1">
                        {c.rule_ids.map((id, i) => {
                          const fp = c.rule_fingerprints?.[i];
                          const summary = fp
                            ? [
                                fp.codes.length ? `${fp.codes.length} código(s)` : null,
                                fp.sectors.length ? `${fp.sectors.length} setor(es)` : null,
                                fp.agreements.length ? `${fp.agreements.length} convênio(s)` : null,
                                fp.routes.length ? `${fp.routes.length} via(s)` : null,
                              ].filter(Boolean).join(" · ") || "sem restrições"
                            : "";
                          return (
                            <li key={id} className="flex items-center justify-between gap-2">
                              <span className="truncate">
                                • {c.rule_names[i]}
                                {summary && <span className="text-muted-foreground ml-1">— {summary}</span>}
                              </span>
                              {onSelectRule && (
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onSelectRule(id)}>
                                  Editar
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
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
