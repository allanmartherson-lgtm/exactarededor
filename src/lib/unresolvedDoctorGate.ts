/**
 * Trava de "médico não vinculado" na importação (src/pages/NewPayment.tsx).
 *
 * Regra: linha com nome de médico preenchido na planilha, mas que NÃO resolveu
 * para um doctor_id (nem por cadastro direto, nem por apelido), não pode ser
 * salva silenciosamente — o item ficaria fora de todo relatório por
 * médico/especialidade.
 *
 * A trava exige decisão explícita do analista, mas NUNCA impede o trabalho:
 * sempre há a saída "prosseguir mesmo assim", igual ao fluxo de PJ.
 *
 * A lógica vive aqui (pura) para poder ser testada sem montar o wizard inteiro.
 */

export interface UnresolvedDoctorRowInput {
  doctor_name?: string | null;
  gross_amount?: number | string | null;
  /** Resultado da resolução contra o cadastro; null = cadastros ainda carregando. */
  _resolution?: { doctor_id: string | null } | null;
}

export interface UnresolvedDoctorGroup {
  name: string;
  count: number;
  amount: number;
}

export interface UnresolvedDoctorSummary {
  count: number;
  amount: number;
  groups: UnresolvedDoctorGroup[];
}

export function summarizeUnresolvedDoctors(
  rows: UnresolvedDoctorRowInput[],
): UnresolvedDoctorSummary {
  const map = new Map<string, UnresolvedDoctorGroup>();
  let count = 0;
  let amount = 0;

  for (const row of rows) {
    const resolution = row._resolution;
    // Sem resolução calculada ainda (cadastros carregando): não acusa pendência
    // para não bloquear o analista com um alerta que pode ser falso.
    if (!resolution) continue;
    const name = (row.doctor_name ?? "").trim();
    if (!name || resolution.doctor_id) continue;

    const value = Number(row.gross_amount ?? 0) || 0;
    count += 1;
    amount += value;

    const key = name.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.amount += value;
    } else {
      map.set(key, { name, count: 1, amount: value });
    }
  }

  return {
    count,
    amount,
    groups: Array.from(map.values()).sort((a, b) => b.count - a.count),
  };
}
