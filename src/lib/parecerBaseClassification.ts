/**
 * Classificação Parecer × Visita a partir do ARQUIVO ORIGINAL do Tasy.
 *
 * O relatório original já traz a coluna "Medico Solic.":
 *  - contém a palavra "Visita" → a linha é uma VISITA;
 *  - contém o nome de um médico → a linha é um PARECER, e esse nome é o
 *    médico solicitante.
 * A comparação é feita em minúsculas e sem espaços nas pontas.
 *
 * A coluna "Espec. orig." é usada apenas como sinal de CORROBORAÇÃO
 * (vazia em visitas, preenchida em pareceres). Quando os dois sinais
 * divergem, a linha é importada normalmente e um alerta é devolvido para
 * o analista decidir — nunca há decisão automática nesse caso.
 *
 * Nenhuma coluna "Tipo" criada manualmente pelo analista é considerada aqui.
 */

export type ParecerBaseClass = {
  tipo: "parecer" | "visita";
  medico_solicitante: string | null;
  espec_origem: string | null;
  /** true quando o sinal da especialidade de origem contradiz a coluna Medico Solic. */
  divergent: boolean;
  divergenceMessage?: string;
};

const norm = (s: string) =>
  s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const SOLIC_HEADERS = [
  "medico solic",
  "medico solic.",
  "medico solicitante",
  "médico solic.",
  "médico solicitante",
];
const ESPEC_ORIG_HEADERS = [
  "espec orig",
  "espec. orig.",
  "espec origem",
  "especialidade origem",
  "especialidade de origem",
  "espec solicitante",
];

const pickCell = (
  raw: Record<string, unknown>,
  headers: readonly string[],
): { found: boolean; value: string } => {
  const wanted = headers.map(norm);
  for (const k of Object.keys(raw)) {
    if (!wanted.includes(norm(k))) continue;
    const v = raw[k];
    return { found: true, value: v == null ? "" : String(v).trim() };
  }
  return { found: false, value: "" };
};

/**
 * Retorna a classificação da linha ou `null` quando o arquivo não possui a
 * coluna "Medico Solic." (ou a célula está vazia) — nesse caso a classificação
 * segue pelo caminho padrão do parser.
 */
export function classifyParecerRowFromBase(
  raw: Record<string, unknown>,
): ParecerBaseClass | null {
  const solic = pickCell(raw, SOLIC_HEADERS);
  if (!solic.found) return null;
  const cell = solic.value.trim();
  if (!cell) return null;

  const espec = pickCell(raw, ESPEC_ORIG_HEADERS);
  const especVal = espec.value.trim() || null;

  const isVisita = cell.toLowerCase() === "visita";

  if (isVisita) {
    return {
      tipo: "visita",
      medico_solicitante: null,
      espec_origem: null,
      divergent: !!especVal,
      divergenceMessage: especVal
        ? `Classificada como Visita por "Medico Solic.", mas a especialidade de origem está preenchida ("${especVal}") — confirme manualmente.`
        : undefined,
    };
  }

  return {
    tipo: "parecer",
    medico_solicitante: cell,
    espec_origem: especVal,
    divergent: !especVal,
    divergenceMessage: !especVal
      ? `Classificada como Parecer (solicitante "${cell}"), mas a especialidade de origem está vazia — confirme manualmente.`
      : undefined,
  };
}
