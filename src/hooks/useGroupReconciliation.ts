import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type GroupRuleTotals = {
  group_id: string;
  payment_id: string | null;
  company_id: string | null;
  hospital_id: string | null;
  status: string | null;
  bruto_pedido_total: number | null;
  bruto_regra_total: number | null;
  diferenca: number | null;
  diferenca_pct: number | null;
  itens_sem_regra: number | null;
  itens_divergentes: number | null;
  itens_total: number | null;
};

export type GroupOverride = {
  id: string;
  group_id: string;
  bruto_regra_snapshot: number;
  bruto_pedido_snapshot: number;
  diferenca_snapshot: number;
  justification: string;
  approved_by: string;
  created_at: string;
};

export type GateStatus = "conciliado" | "divergente" | "liberado" | "sem_dados";

export type GateThresholds = { block_pct: number; block_abs: number };

/**
 * FONTE ÚNICA DE VERDADE do critério de bloqueio pedido × regra por empresa.
 * Usada pelo hook (painel) e pela validação do botão "Concluir análise".
 */
export function computeGateStatus(
  totals: GroupRuleTotals | null,
  overrides: GroupOverride[],
  thresholds: GateThresholds,
): GateStatus {
  if (!totals) return "sem_dados";
  const diff = Math.abs(Number(totals.diferenca ?? 0));
  const pct = Math.abs(Number(totals.diferenca_pct ?? 0));
  if (diff <= thresholds.block_abs || pct <= thresholds.block_pct) return "conciliado";
  const matched = overrides.some(
    (o) =>
      Math.abs(o.bruto_regra_snapshot - Number(totals.bruto_regra_total ?? 0)) < 0.01 &&
      Math.abs(o.bruto_pedido_snapshot - Number(totals.bruto_pedido_total ?? 0)) < 0.01,
  );
  return matched ? "liberado" : "divergente";
}

/** Busca os dados frescos do gate de uma empresa e devolve o status calculado. */
export async function fetchGroupGate(groupId: string): Promise<{
  status: GateStatus;
  totals: GroupRuleTotals | null;
  overrides: GroupOverride[];
  thresholds: GateThresholds;
}> {
  const [{ data: t }, { data: o }, { data: cfg }] = await Promise.all([
    supabase.from("vw_group_rule_totals").select("*").eq("group_id", groupId).maybeSingle(),
    supabase
      .from("payment_group_reconciliation_overrides")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false }),
    supabase.from("system_configurations").select("value").eq("key", "divergence_thresholds").maybeSingle(),
  ]);
  const v = (cfg?.value ?? {}) as Record<string, unknown>;
  const thresholds: GateThresholds = {
    block_pct: Number(v.group_block_pct ?? 0.5),
    block_abs: Number(v.group_block_abs ?? 1.0),
  };
  const totals = (t as GroupRuleTotals) ?? null;
  const overrides = (o as GroupOverride[]) ?? [];
  return { status: computeGateStatus(totals, overrides, thresholds), totals, overrides, thresholds };
}


export function useGroupReconciliation(groupId: string | null | undefined) {
  const [totals, setTotals] = useState<GroupRuleTotals | null>(null);
  const [overrides, setOverrides] = useState<GroupOverride[]>([]);
  const [thresholds, setThresholds] = useState<{ block_pct: number; block_abs: number }>({
    block_pct: 0.5,
    block_abs: 1.0,
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const [{ data: t }, { data: o }, { data: cfg }] = await Promise.all([
      supabase.from("vw_group_rule_totals").select("*").eq("group_id", groupId).maybeSingle(),
      supabase
        .from("payment_group_reconciliation_overrides")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false }),
      supabase.from("system_configurations").select("value").eq("key", "divergence_thresholds").maybeSingle(),
    ]);
    setTotals((t as GroupRuleTotals) ?? null);
    setOverrides((o as GroupOverride[]) ?? []);
    const v = (cfg?.value ?? {}) as Record<string, unknown>;
    setThresholds({
      block_pct: Number(v.group_block_pct ?? 0.5),
      block_abs: Number(v.group_block_abs ?? 1.0),
    });
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const status: GateStatus = (() => {
    if (!totals) return "sem_dados";
    const diff = Math.abs(Number(totals.diferenca ?? 0));
    const pct = Math.abs(Number(totals.diferenca_pct ?? 0));
    if (diff <= thresholds.block_abs || pct <= thresholds.block_pct) return "conciliado";
    const matched = overrides.some(
      (o) =>
        Math.abs(o.bruto_regra_snapshot - Number(totals.bruto_regra_total ?? 0)) < 0.01 &&
        Math.abs(o.bruto_pedido_snapshot - Number(totals.bruto_pedido_total ?? 0)) < 0.01,
    );
    return matched ? "liberado" : "divergente";
  })();

  return { totals, overrides, thresholds, loading, status, reload: load };
}
