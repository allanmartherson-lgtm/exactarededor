/**
 * Helpers de resolução de ESPECIALIDADE MÉDICA usados pelo motor de análise
 * (`analyze-payment`). Extraídos para um módulo dedicado porque são o ponto
 * histórico de falha quando o motor não consegue cruzar regras específicas:
 *
 *   1) A planilha trazia coluna "Especialidade Médico" preenchida, mas
 *      `payment_items.specialty` estava nulo (importação antiga). O motor
 *      ignorava o raw_data e marcava cálculos com `match_by_specialty=true`
 *      como `especialidade_nao_informada`.
 *   2) O lookup do médico era case-sensitive (.in("full_name", ...)), então
 *      "Karimi Da Silva" (planilha, Title Case) não casava
 *      "Karimi da Silva" (cadastro, com `da` minúsculo) e o fallback pelo
 *      cadastro também devolvia null.
 *
 * Manter essa lógica em arquivo separado permite testes de regressão
 * determinísticos (ver `specialty_regression_test.ts`) sem precisar bootar
 * a edge function inteira.
 */

/** Chave canônica para nome de médico: trim + lowercase (tolera caixa). */
export const normDocKey = (s: string): string => s.trim().toLowerCase();

/** Normaliza header de planilha: lowercase, sem acento, só [a-z0-9]. */
export const normRawHeader = (s: string): string =>
  String(s ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

/** Aliases aceitos para a coluna de especialidade na planilha original. */
export const SHEET_SPECIALTY_HEADERS: ReadonlySet<string> = new Set(
  [
    "especialidade",
    "especialidade médica",
    "especialidade medica",
    "especialidade médico",
    "especialidade medico",
    "espec médico",
    "espec medico",
    "espec. médico",
    "espec. medico",
    "espec destino",
    "espec. destino",
    "especialidade destino",
  ].map(normRawHeader),
);

/**
 * Lê a especialidade da PLANILHA (raw_data do payment_item).
 * É a fonte da verdade quando presente — vence o campo persistido e o cadastro.
 */
export function sheetSpecialtyFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  for (const [header, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SHEET_SPECIALTY_HEADERS.has(normRawHeader(header))) continue;
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

export type SpecialtyResolution = {
  value: string | null;
  source: "planilha" | "doctor" | "doctor_ambiguous" | "none";
};

/**
 * Fábrica do resolver canônico de especialidade médica.
 * Ordem (definida pelo produto):
 *   1) Especialidade declarada na planilha (raw_data).
 *   2) Campo persistido `payment_items.specialty` (também conta como planilha).
 *   3) Cadastro do médico vinculado (única especialidade → usa; várias →
 *      ambíguo, devolve null).
 *   4) Nada. NÃO inferimos via TUSS, nome de procedimento ou especialidade
 *      dominante do lote — especialidade é informacional.
 *
 * @param doctorSpecsByName map normalizado (normDocKey → string[]).
 */
export function makeResolveMedicalSpecialty(
  doctorSpecsByName: Record<string, string[]>,
) {
  return function resolveMedicalSpecialty(
    item: { raw_data?: unknown; specialty?: string | null; doctor_name?: string | null },
  ): SpecialtyResolution {
    const fromRawSheet = sheetSpecialtyFromRaw(item.raw_data);
    if (fromRawSheet) return { value: fromRawSheet, source: "planilha" };

    const fromPersisted = String(item.specialty ?? "").trim();
    if (fromPersisted) return { value: fromPersisted, source: "planilha" };

    const docList = doctorSpecsByName[normDocKey(String(item.doctor_name ?? ""))] ?? [];
    if (docList.length === 1) return { value: docList[0], source: "doctor" };
    if (docList.length > 1) return { value: null, source: "doctor_ambiguous" };
    return { value: null, source: "none" };
  };
}
