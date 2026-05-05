/**
 * Single source of truth para LEITURA de campos de um payment_item, com
 * fallback robusto no `raw_data` original importado do Excel.
 *
 * Por que existe:
 * - O cabeçalho do Excel pode variar (acentos, caixa, espaços, "/", "_").
 * - Antes, cada componente fazia sua própria leitura indexando `raw_data`
 *   por chaves específicas (ex.: `raw["Convênio"]`). Isso causava bugs como
 *   um campo aparecer com o valor de OUTRA coluna do Excel quando o header
 *   tinha grafia ligeiramente diferente.
 * - Agora qualquer tela que precisar exibir um campo "do Excel" deve usar
 *   estes helpers — o mesmo critério de mapeamento (normalização de header)
 *   é aplicado em todo lugar (DRY / single source of truth).
 *
 * IMPORTANTE: o nome canônico no banco (ex.: `agreement_text`, `patient_name`)
 * sempre tem prioridade sobre o `raw_data`. O fallback no `raw_data` só é
 * usado quando o campo canônico está vazio (ex.: linhas mais antigas que
 * foram importadas antes da extração desse campo).
 */

export type ItemLike = {
  patient_name?: string | null;
  agreement_text?: string | null;
  access_route?: string | null;
  procedure_code?: string | null;
  procedure_name?: string | null;
  description?: string | null;
  doctor_name?: string | null;
  doctor_role?: string | null;
  raw_data?: unknown;
};

const norm = (s: string) =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-./]+/g, "");

/** Procura no raw_data por qualquer header equivalente (case/acento/separador-insensitive). */
export function rawPick(raw: unknown, keys: readonly string[]): string | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const wanted = keys.map(norm);
  for (const rk of Object.keys(row)) {
    if (wanted.includes(norm(rk))) {
      const v = row[rk];
      if (v != null && String(v).trim() !== "") return String(v);
    }
  }
  return null;
}

const HEADER_ALIASES = {
  agreement: ["convenio", "convênio", "acordo", "operadora", "plano"],
  patient: ["paciente", "nome paciente", "nm paciente", "nome do paciente"],
  accessRoute: ["via de acesso", "viaacesso", "via acesso"],
  procedureCode: ["codigo procedimento", "código procedimento", "codigoproc", "codproc", "cod tuss", "tuss"],
  procedureName: ["procedmat", "proced/mat", "proced.", "procedimento"],
  doctor: ["medico", "médico", "nome", "prestador", "fornecedor"],
  doctorRole: ["funcao", "função", "papel"],
} as const;

const FALLBACK = "—";

const firstNonEmpty = (...vals: Array<string | null | undefined>): string => {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return FALLBACK;
};

export const getAgreement = (it: ItemLike): string =>
  firstNonEmpty(it.agreement_text, rawPick(it.raw_data, HEADER_ALIASES.agreement));

export const getPatient = (it: ItemLike): string =>
  firstNonEmpty(it.patient_name, rawPick(it.raw_data, HEADER_ALIASES.patient));

export const getAccessRoute = (it: ItemLike): string =>
  firstNonEmpty(it.access_route, rawPick(it.raw_data, HEADER_ALIASES.accessRoute));

export const getProcedureCode = (it: ItemLike): string =>
  firstNonEmpty(it.procedure_code, rawPick(it.raw_data, HEADER_ALIASES.procedureCode));

export const getProcedureName = (it: ItemLike): string =>
  firstNonEmpty(
    it.procedure_name,
    it.description,
    rawPick(it.raw_data, HEADER_ALIASES.procedureName),
  );

export const getDoctor = (it: ItemLike): string =>
  firstNonEmpty(it.doctor_name, rawPick(it.raw_data, HEADER_ALIASES.doctor));

export const getDoctorRole = (it: ItemLike): string =>
  firstNonEmpty(it.doctor_role, rawPick(it.raw_data, HEADER_ALIASES.doctorRole));
