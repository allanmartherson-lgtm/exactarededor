import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface GroupReapprovalState {
  id: string;
  payment_id: string;
  company_name: string | null;
  approval_version: number;
  reapproval_pending: boolean;
  reapproval_reason: string | null;
  reapproval_triggered_at: string | null;
  reapproval_trigger_source:
    | "analyst_edit"
    | "invoice_pendency"
    | "company_change_source"
    | "company_change_destination"
    | null;
  bruto_total: number;
  liquido_total: number;
  last_approved_bruto: number | null;
  last_approved_liquido: number | null;
  last_approved_company_id: string | null;
}

/**
 * Carrega o estado de re-aprovação de um grupo de empresa.
 * Quando `reapproval_pending=true`, a UI deve mostrar badge + diff e o
 * gate de avanço (NF/lançado/pago) já é bloqueado por trigger no banco.
 */
export function useGroupReapproval(companyGroupId: string | null | undefined) {
  const [state, setState] = useState<GroupReapprovalState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyGroupId) {
      setState(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("payment_company_groups")
      .select(
        "id, payment_id, company_name, approval_version, reapproval_pending, reapproval_reason, reapproval_triggered_at, reapproval_trigger_source, bruto_total, liquido_total, last_approved_bruto, last_approved_liquido, last_approved_company_id",
      )
      .eq("id", companyGroupId)
      .maybeSingle();
    if (err) {
      setError(err.message);
      setState(null);
    } else {
      setState(data as GroupReapprovalState | null);
    }
    setLoading(false);
  }, [companyGroupId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, loading, error, refresh };
}

/**
 * Dispara o enfileiramento da notificação de re-aprovação ao(s) diretor(es).
 * Idempotente: o worker faz debounce e a edge function valida o estado.
 */
export async function requestGroupReapprovalNotification(
  paymentId: string,
  companyGroupId: string,
) {
  return supabase.functions.invoke("notify-director-reapproval", {
    body: { paymentId, companyGroupId },
  });
}
