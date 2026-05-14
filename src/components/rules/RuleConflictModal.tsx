/**
 * Sub-Onda 2D — Rodada 3.
 *
 * Modal de conflitos detectados pela edge function `validate-rule-save`.
 * Renderiza cada problema como card e permite "Aplicar correções automáticas
 * e salvar" — encerrando regras anteriores em `suggested_valid_until` via
 * RPC `apply_rule_save_with_corrections`.
 *
 * `calc_overlap` bloqueia o save (exige edição manual do formulário). Os
 * demais tipos têm checkbox de confirmação sempre marcado/desabilitado: o
 * usuário não tem opção de "salvar sem corrigir" — ou cancela ou aplica.
 *
 * Estética DF Star: light-only, weight 400/500, bordas 0.5px, ícones
 * outline. Não usar dark mode.
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Calendar, User, Building2, Star, Hand } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Problem =
  | {
      type: "doctor_already_bound" | "validity_overlap";
      doctor_crm?: string;
      company_key?: string;
      existing_rule_id: string;
      existing_rule_name: string;
      existing_valid_from: string | null;
      existing_valid_until: string | null;
      suggested_valid_until?: string | null;
    }
  | {
      type: "company_already_bound";
      company_key?: string;
      existing_rule_id: string;
      existing_rule_name: string;
      existing_valid_from: string | null;
      existing_valid_until: string | null;
      suggested_valid_until?: string | null;
    }
  | {
      type: "master_already_exists";
      existing_rule_id: string;
      existing_rule_name: string;
      existing_valid_from: string | null;
      existing_valid_until: string | null;
      suggested_valid_until?: string | null;
    }
  | {
      type: "calc_overlap";
      calc_a_id: string;
      calc_a_label: string;
      calc_b_id: string;
      calc_b_label: string;
      intersection_description: string;
    };

export interface Correction {
  type: "set_valid_until";
  rule_id: string;
  new_valid_until: string;
}

export interface RuleConflictModalProps {
  open: boolean;
  problems: Problem[];
  onCancel: () => void;
  onApplyAndSave: (corrections: Correction[]) => Promise<void>;
}

const COPPER = "#9A6B3A";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "em aberto";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

function titleFor(p: Problem, nameMap: Record<string, string>): string {
  switch (p.type) {
    case "doctor_already_bound":
      return `Médico CRM ${p.doctor_crm ?? "—"} já vinculado`;
    case "company_already_bound": {
      const k = p.company_key ?? "";
      const label = nameMap[k] ?? k ?? "—";
      return `Empresa ${label} já vinculada`;
    }
    case "validity_overlap":
      return "Sobreposição de vigência";
    case "master_already_exists":
      return "Já existe regra master vigente";
    case "calc_overlap":
      return "Cálculos com sobreposição";
  }
}

function IconFor({ type }: { type: Problem["type"] }) {
  const cls = "h-4 w-4";
  switch (type) {
    case "doctor_already_bound":
      return <User className={cls} strokeWidth={1.5} />;
    case "company_already_bound":
      return <Building2 className={cls} strokeWidth={1.5} />;
    case "validity_overlap":
      return <Calendar className={cls} strokeWidth={1.5} />;
    case "master_already_exists":
      return <Star className={cls} strokeWidth={1.5} />;
    case "calc_overlap":
      return <AlertTriangle className={cls} strokeWidth={1.5} />;
  }
}

export function RuleConflictModal({ open, problems, onCancel, onApplyAndSave }: RuleConflictModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasCalcOverlap = useMemo(
    () => problems.some((p) => p.type === "calc_overlap"),
    [problems],
  );

  // Deriva correções: 1 set_valid_until por (rule_id, suggested_valid_until)
  // único — evita duplicatas quando o mesmo conflito gera doctor_already_bound
  // + validity_overlap apontando para a mesma regra.
  const corrections = useMemo<Correction[]>(() => {
    const map = new Map<string, Correction>();
    for (const p of problems) {
      if (p.type === "calc_overlap") continue;
      const sug = (p as { suggested_valid_until?: string | null }).suggested_valid_until;
      const rid = (p as { existing_rule_id?: string }).existing_rule_id;
      if (!sug || !rid) continue;
      const key = `${rid}::${sug}`;
      if (!map.has(key)) {
        map.set(key, { type: "set_valid_until", rule_id: rid, new_valid_until: sug });
      }
    }
    return Array.from(map.values());
  }, [problems]);

  // Resolve UUIDs de empresa para nome legível
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = Array.from(new Set(
      problems
        .filter((p): p is Extract<Problem, { type: "company_already_bound" }> => p.type === "company_already_bound")
        .map((p) => p.company_key ?? "")
        .filter((k) => UUID_RE.test(k)),
    ));
    if (ids.length === 0) return;
    (async () => {
      const { data } = await supabase.from("companies").select("id,name,document").in("id", ids);
      const map: Record<string, string> = {};
      for (const c of (data ?? []) as { id: string; name: string; document: string | null }[]) {
        map[c.id] = c.document ? `${c.name} · ${c.document}` : c.name;
      }
      setCompanyNames(map);
    })();
  }, [problems]);

  const canApply = !hasCalcOverlap && !submitting;

  const handleApply = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await onApplyAndSave(corrections);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !submitting) onCancel(); }}>
      <DialogContent
        className="max-w-2xl bg-white text-neutral-900 border-[0.5px] border-neutral-300 rounded-md p-0 overflow-hidden"
        style={{ fontWeight: 400 }}
      >
        <DialogHeader className="px-6 pt-5 pb-3 border-b-[0.5px] border-neutral-200">
          <DialogTitle className="flex items-center gap-2 text-base font-medium text-neutral-900">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.5} style={{ color: COPPER }} />
            Conflitos detectados antes de salvar
          </DialogTitle>
          <DialogDescription className="text-xs text-neutral-600 mt-1">
            Foram encontrados {problems.length} problema{problems.length === 1 ? "" : "s"}. Revise abaixo antes de prosseguir.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto bg-neutral-50/40">
          {problems.map((p, idx) => {
            const isBlocker = p.type === "calc_overlap";
            const accent = isBlocker ? "#B33A3A" : "#B8860B"; // vermelho discreto vs amarelo discreto
            return (
              <div
                key={idx}
                className="rounded-md border-[0.5px] bg-white p-3"
                style={{ borderColor: isBlocker ? "#E5C2C2" : "#E8DDC2" }}
              >
                <div className="flex items-center gap-2 pb-2 border-b-[0.5px] border-neutral-200">
                  <span style={{ color: accent }}><IconFor type={p.type} /></span>
                  <span className="text-sm font-medium text-neutral-900">{titleFor(p, companyNames)}</span>
                </div>
                <div className="pt-2 text-xs text-neutral-700 space-y-1">
                  {"existing_rule_name" in p && (
                    <>
                      <div>
                        Regra existente: <span className="font-medium text-neutral-900">{p.existing_rule_name}</span>
                      </div>
                      <div>
                        Vigência: {fmtDate(p.existing_valid_from)} → {fmtDate(p.existing_valid_until)}
                      </div>
                    </>
                  )}
                  {p.type === "calc_overlap" && (
                    <>
                      <div>
                        Cálculos em conflito:{" "}
                        <span className="font-medium text-neutral-900">{p.calc_a_label}</span> e{" "}
                        <span className="font-medium text-neutral-900">{p.calc_b_label}</span>
                      </div>
                      <div>Itens compartilhados: <span className="text-neutral-900">{p.intersection_description}</span></div>
                    </>
                  )}
                </div>

                {isBlocker ? (
                  <div className="mt-3 flex items-start gap-2 text-xs text-[#B33A3A]">
                    <Hand className="h-3.5 w-3.5 mt-0.5" strokeWidth={1.5} />
                    <span>Sem correção automática. Edite os cálculos no formulário antes de salvar.</span>
                  </div>
                ) : (
                  (p as { suggested_valid_until?: string | null }).suggested_valid_until && (
                    <label className="mt-3 flex items-center gap-2 text-xs text-neutral-700 cursor-default">
                      <Checkbox checked disabled aria-label="Aplicar correção" />
                      Encerrar regra anterior em{" "}
                      <span className="font-medium text-neutral-900">
                        {fmtDate((p as { suggested_valid_until?: string | null }).suggested_valid_until!)}
                      </span>
                    </label>
                  )
                )}
              </div>
            );
          })}
        </div>

        {errorMsg && (
          <div className="px-6 pb-2 text-xs text-[#B33A3A]">
            Falha ao salvar: {errorMsg}
          </div>
        )}

        <DialogFooter className="px-6 py-3 border-t-[0.5px] border-neutral-200 bg-white">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            className="font-normal"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleApply}
            disabled={!canApply}
            className="font-medium text-white"
            style={{ backgroundColor: canApply ? COPPER : "#C9B79A", borderColor: COPPER }}
            title={hasCalcOverlap ? "Resolva a sobreposição de cálculos no formulário antes de salvar" : undefined}
          >
            {submitting ? "Salvando…" : "Aplicar correções e salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RuleConflictModal;
