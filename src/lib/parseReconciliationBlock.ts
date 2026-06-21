/**
 * Parser do erro do trigger `check_group_reconciliation_gate`.
 *
 * O trigger faz `RAISE EXCEPTION ... USING DETAIL = jsonb`, e supabase-js
 * expõe o DETAIL em `error.details` (string). Quando o gate dispara, o
 * payload tem `kind: 'reconciliation_block'` + dados estruturados pra UI
 * oferecer ações diretas (devolver, liberar, abrir empresa) sem precisar
 * fazer mais round-trips ao banco.
 *
 * Mantemos o parse defensivo: a mesma RPC pode falhar por N motivos
 * diferentes; só tratamos como "block reconciliável" quando o JSON bate
 * o shape esperado.
 */
export interface ReconciliationBlockPayload {
  kind: "reconciliation_block";
  group_id: string;
  payment_id: string;
  hospital_id: string;
  company_id: string | null;
  company_name: string;
  bruto_pedido: number;
  bruto_regra: number;
  diferenca: number;
  diff_pct: number;
  attempted_status: string;
}

export function parseReconciliationBlock(
  error: { message?: string | null; details?: string | null } | null | undefined,
): ReconciliationBlockPayload | null {
  if (!error) return null;

  // Primeira tentativa: DETAIL estruturado.
  const raw = error.details;
  if (raw && typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.kind === "reconciliation_block" && parsed.group_id) {
        return {
          kind: "reconciliation_block",
          group_id: String(parsed.group_id),
          payment_id: String(parsed.payment_id),
          hospital_id: String(parsed.hospital_id),
          company_id: parsed.company_id ? String(parsed.company_id) : null,
          company_name: String(parsed.company_name ?? ""),
          bruto_pedido: Number(parsed.bruto_pedido ?? 0),
          bruto_regra: Number(parsed.bruto_regra ?? 0),
          diferenca: Number(parsed.diferenca ?? 0),
          diff_pct: Number(parsed.diff_pct ?? 0),
          attempted_status: String(parsed.attempted_status ?? ""),
        };
      }
    } catch {
      // JSON inválido → cai no fallback de message-only abaixo.
    }
  }

  // Fallback heurístico: detecta pela mensagem (sem group_id útil).
  // Útil pra migrations antigas que ainda estavam no preview até este
  // deploy. Sem group_id, a UI mostra só a mensagem genérica sem ações.
  if (error.message && /Aprovação bloqueada em/i.test(error.message)) {
    return null;
  }
  return null;
}
