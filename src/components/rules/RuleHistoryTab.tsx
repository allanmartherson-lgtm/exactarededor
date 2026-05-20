import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { History, AlertCircle } from "lucide-react";
import { formatDateTimeBR } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";

type AuditEntry = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  created_at: string;
};

type Profile = { id: string; email: string; full_name: string | null };

const FINANCIAL_FIELDS = new Set([
  "multiplier", "package_amount", "convenio_percentage", "deflator_pct",
  "bonus_amount", "fixed_amount", "repasse_pct", "acrescimo_pct",
  "target_amount", "bonus_pct", "aux_first_pct", "aux_second_pct",
  "instrumentador_pct",
]);

const ACTION_LABELS: Record<string, string> = {
  create: "Criação",
  update: "Alteração",
  auto_set_valid_until: "Encerramento automático",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  description: "Descrição",
  rule_text: "Texto da regra",
  scope: "Escopo",
  target_type: "Tipo do alvo",
  target_identifier: "Identificador do alvo",
  target_name: "Nome do alvo",
  valid_from: "Vigência a partir de",
  valid_until: "Vigência até",
  active: "Ativa",
  severity: "Severidade",
  label: "Rótulo",
  calculation_type: "Método de cálculo",
  convenio_percentage: "% sobre convênio",
  fixed_amount: "Valor fixo (R$)",
  multiplier: "Multiplicador",
  deflator_pct: "Deflator (%)",
  repasse_pct: "% de repasse",
  acrescimo_pct: "Acréscimo (%)",
  package_amount: "Valor do pacote (R$)",
  bonus_amount: "Bônus fixo (R$)",
  bonus_pct: "Bônus (%)",
  target_amount: "Valor-alvo (R$)",
  reference_table_id: "Tabela de referência",
  sort_order: "Ordem",
};

const stringify = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.join(", ");
  try { return JSON.stringify(v); } catch { return String(v); }
};

export function RuleHistoryTab({ ruleId }: { ruleId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // 1. Pega IDs dos cálculos atuais da regra (para incluir audits de rule_calculation).
      const { data: calcs } = await supabase
        .from("rule_calculations").select("id").eq("rule_id", ruleId);
      const calcIds = (calcs ?? []).map((c: any) => c.id);
      const allIds = [ruleId, ...calcIds];

      const { data } = await supabase
        .from("audit_log")
        .select("*")
        .in("entity_id", allIds)
        .order("created_at", { ascending: false })
        .limit(200);

      const list = ((data ?? []) as AuditEntry[]).filter(
        (e) => e.action !== "create_via_rpc" && e.action !== "update_via_rpc",
      );

      const actorIds = Array.from(new Set(list.map((e) => e.actor_id).filter(Boolean) as string[]));
      const pmap = new Map<string, Profile>();
      if (actorIds.length) {
        const { data: pr } = await supabase
          .from("profiles").select("id,email,full_name").in("id", actorIds);
        (pr ?? []).forEach((p: any) => pmap.set(p.id, p));
      }
      if (cancelled) return;
      setProfiles(pmap);
      setEntries(list);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ruleId]);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Carregando histórico…</div>;
  }
  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center flex flex-col items-center gap-2">
        <History className="h-6 w-6 opacity-50" />
        Nenhum evento de auditoria para esta regra.
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      {entries.map((e) => {
        const actor = e.actor_id ? profiles.get(e.actor_id) : null;
        const actorLabel = actor?.full_name || actor?.email || (e.actor_id ? e.actor_id.slice(0, 8) : "Sistema");
        const isCalc = e.entity_type === "rule_calculation";
        const diff = e.diff ?? {};
        const calcLabel = (diff as any).__calc_label?.after as string | undefined;
        const fields = Object.entries(diff).filter(([k]) => !k.startsWith("__"));
        return (
          <div key={e.id} className="rounded-md border border-border bg-white p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{isCalc ? "Cálculo" : "Regra"}</Badge>
              <Badge variant={e.action === "create" ? "default" : "secondary"}>
                {ACTION_LABELS[e.action] ?? e.action}
              </Badge>
              {isCalc && calcLabel && (
                <span className="font-medium text-foreground">{calcLabel}</span>
              )}
              <span className="text-muted-foreground">por {actorLabel}</span>
              <span className="ml-auto text-muted-foreground">{formatDateTimeBR(e.created_at)}</span>
            </div>
            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Sem alterações detalhadas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Campo</th>
                      <th className="py-1 pr-3 font-medium">Antes</th>
                      <th className="py-1 font-medium">Depois</th>
                    </tr>
                  </thead>
                  <tbody className="align-top">
                    {fields.map(([field, change]) => {
                      const isFinancial = FINANCIAL_FIELDS.has(field);
                      return (
                        <tr key={field} className="border-t border-border/60">
                          <td className="py-1.5 pr-3">
                            <span className={cn(
                              "inline-flex items-center gap-1 font-mono",
                              isFinancial && "font-semibold text-foreground",
                            )}>
                              {isFinancial && <AlertCircle className="h-3 w-3 text-amber-600" />}
                              {FIELD_LABELS[field] ?? field}
                            </span>
                            {isFinancial && (
                              <Badge variant="outline" className="ml-2 h-4 px-1 text-[9px] border-amber-400 text-amber-700">
                                financeiro
                              </Badge>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 text-muted-foreground break-all max-w-[16rem]">
                            {stringify(change.before)}
                          </td>
                          <td className="py-1.5 text-foreground break-all max-w-[16rem]">
                            {stringify(change.after)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
