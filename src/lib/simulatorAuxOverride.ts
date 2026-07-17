// Override histórico para auxiliares no Simulador de Cenário.
//
// PROBLEMA: A "regra sintética" enviada ao motor determinístico
// (simulate-scenario) não conhece a tabela de funções da regra original — por
// isso todos os itens (principal, 1º aux, 2º aux, instrumentador) recebem o
// valor cheio do cirurgião principal.
//
// SOLUÇÃO: Após a resposta do motor, agrupa os itens por
// `attendance_number + procedure_code`. Dentro de cada grupo, calcula o ratio
// histórico real (`aux.gross_amount / principal.gross_amount`) e aplica esse
// mesmo ratio sobre o valor SIMULADO do principal. Assim o simulado replica
// exatamente o percentual efetivamente pago à época.
//
// Isolado em módulo puro para permitir testes com dados históricos reais
// (ex.: atendimento 9147517 — Dr. Abner cirurgião principal + auxiliares).

export interface OverrideItem {
  id: string;
  attendance_number: string | null;
  procedure_code: string | null;
  doctor_role: string | null;
  gross_amount: number;
}

export interface SimPerItemMinimal {
  expected_amount: number;
  matched: boolean;
  calculation_type_used: string | null;
  alerts: string[];
}

/** Normaliza role removendo acentos, minúsculas e trim. */
export function normalizeRole(r?: string | null): string {
  return (r ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Cirurgião principal / único.
 *
 * Deve casar TASY variants: "Cirurgião Principal", "Cirurgião", "Cirurgião
 * Único", "Cirurgiao Unico". Nunca casa auxiliar/instrumentador.
 */
export function isPrincipalRole(r?: string | null): boolean {
  const n = normalizeRole(r);
  if (!n) return false;
  if (isAuxRole(r)) return false;
  return /cirurgiao/.test(n) || /principal|unico/.test(n);
}

/**
 * Auxiliar / instrumentador.
 *
 * BUG anterior: regex `/auxili/` NÃO casava "Primeiro Aux" (forma curta usada
 * pelo Tasy). Corrigido para `/\baux/` — cobre "aux", "auxiliar", "auxiliares"
 * sem casar palavras como "auxílio" mal formadas. Também mantém detecção de
 * "instrumentador".
 */
export function isAuxRole(r?: string | null): boolean {
  const n = normalizeRole(r);
  if (!n) return false;
  return /\baux/.test(n) || /instrument/.test(n);
}

/**
 * Aplica o override histórico in-place sobre `perItem`.
 *
 * Regras:
 * - Precisa haver principal identificado no grupo (att+tuss).
 * - principalSim > 0 e principalReal > 0.
 * - auxReal > 0.
 * - ratio > 1 é implausível → mantém o valor do motor (não força para baixo
 *   nem quebra o resultado).
 *
 * Retorna a lista de ajustes efetuados (útil em testes/telemetria).
 */
export interface OverrideAdjustment {
  aux_id: string;
  principal_id: string;
  ratio: number;
  new_expected: number;
}

export function applyHistoricalAuxOverride(
  items: OverrideItem[],
  perItem: Record<string, SimPerItemMinimal>,
): OverrideAdjustment[] {
  const grupos = new Map<string, OverrideItem[]>();
  for (const d of items) {
    const k = `${d.attendance_number ?? ""}|${(d.procedure_code ?? "").trim()}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(d);
  }
  const ajustes: OverrideAdjustment[] = [];
  for (const [, grupo] of grupos) {
    const principal = grupo.find((g) => isPrincipalRole(g.doctor_role));
    if (!principal) continue;
    const principalSim = perItem[principal.id]?.expected_amount ?? 0;
    const principalReal = Number(principal.gross_amount ?? 0);
    if (principalSim <= 0 || principalReal <= 0) continue;
    for (const g of grupo) {
      if (g.id === principal.id || !isAuxRole(g.doctor_role)) continue;
      const auxReal = Number(g.gross_amount ?? 0);
      if (auxReal <= 0) continue;
      const ratio = auxReal / principalReal;
      if (ratio > 1.001) continue;
      const newExpected = principalSim * ratio;
      const cur = perItem[g.id];
      perItem[g.id] = {
        expected_amount: newExpected,
        matched: cur?.matched ?? true,
        calculation_type_used: cur?.calculation_type_used ?? "aux_historical_override",
        alerts: [
          ...(cur?.alerts ?? []),
          `Aux ajustado ao histórico: ${(ratio * 100).toFixed(1)}% do principal`,
        ],
      };
      ajustes.push({
        aux_id: g.id,
        principal_id: principal.id,
        ratio,
        new_expected: newExpected,
      });
    }
  }
  return ajustes;
}
