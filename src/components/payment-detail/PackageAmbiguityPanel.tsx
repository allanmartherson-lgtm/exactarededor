import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useManualInterventionReasons } from "@/hooks/useManualInterventionReasons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Painel de decisão para PACOTE AMBÍGUO.
 *
 * O motor (analyze-payment) grava `payment_items.package_ambiguity` quando:
 *  • `multi_anchor` — o atendimento tem 2+ códigos-alavanca e a via de acesso
 *    não desempatou sozinha (ou desempatou, mas o perdedor precisa de decisão).
 *  • `no_anchor` — nenhum código-alavanca foi faturado, mas os códigos do
 *    atendimento pertencem a um pacote cadastrado.
 *
 * Enquanto `resolved` estiver vazio, o item é NEUTRO: não gera economia
 * nem perda. A decisão do analista é soberana e não é sobrescrita pela
 * reanálise do motor.
 */

export type PackageAmbiguityOption = {
  calc_id: string;
  rule_id?: string;
  rule_name: string;
  calc_label?: string | null;
  code?: string;
  main_codes?: string[];
  package_amount?: number;
  included_codes?: string[];
  matched_included?: string[];
  access_route?: string | null;
};

export type PackageAmbiguity = {
  kind: "multi_anchor" | "no_anchor";
  att: string;
  item_code?: string;
  chosen_calc_id?: string | null;
  chosen_code?: string | null;
  options?: PackageAmbiguityOption[];
  suggestions?: PackageAmbiguityOption[];
  resolved?: string | null;
};

type ItemLike = {
  id: string;
  attendance_number?: string | null;
  procedure_code?: string | null;
  procedure_name?: string | null;
  doctor_name?: string | null;
  gross_amount?: number | null;
  package_ambiguity?: unknown;
};

const ROUTE_LABEL: Record<string, string> = {
  unica_principal: "Única ou principal",
  outra_via: "Outra via",
  mesma_via: "Mesma via",
  sem_via: "Sem via",
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function parseAmbiguity(raw: unknown): PackageAmbiguity | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as PackageAmbiguity;
  if (!a.kind) return null;
  if (a.resolved) return null; // já decidido
  return a;
}

export function PackageAmbiguityPanel({
  items,
  canEdit,
  onRefresh,
}: {
  items: ItemLike[];
  canEdit: boolean;
  onRefresh?: () => void;
}) {
  const { user } = useAuth();
  const { reasons } = useManualInterventionReasons({ appliesTo: "manual" });
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState<Record<string, string>>({});
  const [manualReason, setManualReason] = useState<Record<string, string>>({});

  const pending = useMemo(
    () =>
      items
        .map((it) => ({ item: it, amb: parseAmbiguity((it as any).package_ambiguity) }))
        .filter((x): x is { item: ItemLike; amb: PackageAmbiguity } => x.amb !== null),
    [items],
  );

  if (pending.length === 0) return null;

  const resolve = async (
    itemId: string,
    amb: PackageAmbiguity,
    decision: "absorbed" | "standalone" | "manual",
    extra: { calcId?: string | null; value?: number; reasonCode?: string; option?: PackageAmbiguityOption } = {},
  ) => {
    setSaving(itemId);
    try {
      const patch: Record<string, unknown> = {
        package_ambiguity: {
          ...amb,
          resolved: decision,
          resolved_by: user?.id ?? null,
          resolved_at: new Date().toISOString(),
          resolved_calc_id: extra.calcId ?? null,
          resolved_value: extra.value ?? null,
          resolved_reason_code: extra.reasonCode ?? null,
        },
      };

      if (decision === "absorbed") {
        const pkgValue = Number(extra.option?.package_amount ?? 0);
        patch.package_absorbed = true;
        patch.package_absorbed_calc_id = extra.calcId ?? null;
        patch.package_absorbed_by = user?.id ?? null;
        patch.package_absorbed_at = new Date().toISOString();
        patch.package_absorbed_note = `Decisão de pacote ambíguo (atend. ${amb.att}).`;
        // Este item é o CÓDIGO-ALAVANCA escolhido: recebe o valor do pacote.
        // Demais códigos inclusos do mesmo atendimento continuam absorvidos (expected=0)
        // conforme registrados pelo motor no próximo run.
        patch.expected_amount = pkgValue;
        patch.ai_status = "aprovado";
        patch.applied_calc_method = "pacote";
        patch.matched_rule_name = extra.option?.calc_label
          ? `${extra.option.rule_name} — ${extra.option.calc_label}`
          : extra.option?.rule_name ?? null;
      } else if (decision === "manual") {
        patch.expected_amount = extra.value ?? null;
        patch.ai_status = "aprovado";
      } else {
        // standalone: mantém o cálculo avulso do motor; volta a contar em
        // economia/perda a partir da próxima materialização.
        patch.ai_status = "pendente";
      }

      const { error } = await supabase
        .from("payment_items")
        .update(patch as any)
        .eq("id", itemId);
      if (error) {
        toast.error(`Não foi possível registrar a decisão: ${error.message}`);
        return;
      }

      const { error: auditErr } = await supabase.from("audit_log").insert({
        entity_type: "payment_item",
        entity_id: itemId,
        action: "update",
        diff: {
          source: "package_ambiguity_panel",
          kind: amb.kind,
          att: amb.att,
          decision,
          calc_id: extra.calcId ?? null,
          value: extra.value ?? null,
          reason_code: extra.reasonCode ?? null,
        },
      } as any);
      if (auditErr) console.warn("audit package_ambiguity falhou:", auditErr.message);

      setManualOpen(null);
      toast.success("Decisão registrada.");
      onRefresh?.();
    } catch (e: any) {
      toast.error(`Erro inesperado: ${e?.message ?? e}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-amber-700" /> : <ChevronRight className="h-4 w-4 text-amber-700" />}
        <AlertTriangle className="h-4 w-4 text-amber-700" />
        <span className="text-xs font-semibold text-amber-900">
          Pacote ambíguo — {pending.length} item(ns) aguardando decisão
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-amber-700">
          neutro · não gera economia nem perda
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          {pending.map(({ item, amb }) => {
            const options = amb.kind === "multi_anchor" ? amb.options ?? [] : amb.suggestions ?? [];
            const isSaving = saving === item.id;
            return (
              <div key={item.id} className="rounded border border-amber-200 bg-white/80 p-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <Package className="h-3.5 w-3.5 text-amber-700" />
                  <span className="font-semibold">Atend. {amb.att}</span>
                  <span className="font-mono">{item.procedure_code ?? amb.item_code ?? "—"}</span>
                  <span className="flex-1 truncate text-muted-foreground">
                    {item.procedure_name ?? "—"} · {item.doctor_name ?? "—"}
                  </span>
                  <span className="font-mono tabular-nums">{brl(Number(item.gross_amount ?? 0))}</span>
                </div>

                <p className="text-[10px] text-muted-foreground">
                  {amb.kind === "multi_anchor"
                    ? `O motor encontrou mais de um código-alavanca neste atendimento${
                        amb.chosen_code ? ` e aplicou automaticamente o pacote do código ${amb.chosen_code}` : " e não conseguiu desempatar pela via de acesso"
                      }. Escolha o caminho deste código.`
                    : "Nenhum código-alavanca foi faturado, mas este código pertence a um pacote cadastrado. Escolha o caminho."}
                </p>

                {canEdit && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {options.map((op) => (
                      <button
                        key={`${item.id}-${op.calc_id}`}
                        type="button"
                        disabled={isSaving}
                        onClick={() => resolve(item.id, amb, "absorbed", { calcId: op.calc_id })}
                        className="rounded bg-amber-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-700 disabled:opacity-40"
                        title={
                          op.package_amount != null
                            ? `Pacote de ${brl(Number(op.package_amount))}`
                            : undefined
                        }
                      >
                        Absorver em “{op.rule_name}”
                        {op.access_route ? ` (${ROUTE_LABEL[op.access_route] ?? op.access_route})` : ""}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => resolve(item.id, amb, "standalone")}
                      className="rounded border border-amber-400 px-2 py-1 text-[10px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                    >
                      Pagar avulso (manter cálculo)
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => setManualOpen(manualOpen === item.id ? null : item.id)}
                      className="rounded border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-40"
                    >
                      Outro valor…
                    </button>
                  </div>
                )}

                {canEdit && manualOpen === item.id && (
                  <div className="space-y-1.5 rounded border border-dashed border-amber-300 p-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Valor a pagar"
                        value={manualValue[item.id] ?? ""}
                        onChange={(e) => setManualValue((d) => ({ ...d, [item.id]: e.target.value }))}
                        className="w-36 rounded border border-amber-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                      <select
                        value={manualReason[item.id] ?? ""}
                        onChange={(e) => setManualReason((d) => ({ ...d, [item.id]: e.target.value }))}
                        className="flex-1 rounded border border-amber-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                      >
                        <option value="">Motivo da intervenção…</option>
                        {reasons.map((r) => (
                          <option key={r.id} value={r.code}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          isSaving ||
                          !manualReason[item.id] ||
                          !(Number(manualValue[item.id]) >= 0 && manualValue[item.id] !== "")
                        }
                        onClick={() =>
                          resolve(item.id, amb, "manual", {
                            value: Number(manualValue[item.id]),
                            reasonCode: manualReason[item.id],
                          })
                        }
                        className={cn(
                          "rounded bg-amber-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-700",
                          "disabled:opacity-40",
                        )}
                      >
                        {isSaving ? "Salvando…" : "Confirmar valor"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setManualOpen(null)}
                        className="rounded border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
