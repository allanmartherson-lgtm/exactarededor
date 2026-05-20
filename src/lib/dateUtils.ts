/**
 * Formata uma string de data para exibição em PT-BR, sempre usando timezone de Brasília.
 * Aceita: "2026-04-10", "2026-04-10T11:10:00Z", "2026-04-10T11:10:00+00", null/undefined.
 *
 * Datas sem hora (ex: "2026-04-10") são tratadas como data local de Brasília,
 * não como UTC midnight (que causaria rollback de 1 dia em UTC-3).
 */
export const formatDateBR = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
      ? `${date.trim()}T12:00:00`
      : date;
    return new Date(normalized).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return date;
  }
};

/**
 * Formata data + hora para exibição em PT-BR com timezone de Brasília.
 */
export const formatDateTimeBR = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date;
  }
};
