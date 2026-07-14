// Pseudonimização de dados de paciente (LGPD).
//
// Substitui nomes de paciente por tokens estáveis "PACIENTE_N" ANTES de
// qualquer envio a provedor externo de IA, e re-hidrata os nomes em textos
// devolvidos pela IA antes de gravar/exibir.
//
// Regras críticas:
//  - Tokens são atribuídos por ORDEM DE PRIMEIRA OCORRÊNCIA em walk canônico
//    (chaves ordenadas alfabeticamente). O mesmo conjunto de pacientes no
//    mesmo shape sempre gera os mesmos tokens — essencial para não invalidar
//    o cache determinístico de ai_input_hash.
//  - reverseMap só vive na request corrente. NUNCA persistir nem enviar.
//  - Nomes de médico, CRM, empresa, convênio, TUSS, valores, datas e
//    atendimento NÃO são mascarados — são necessários para a análise.
//
// Escopo de aplicação: mascare por UNIDADE que precisa ser deterministicamente
// hasheável (ex.: por item em analyze-payment). Se mascarar o batch inteiro,
// o token de um paciente muda conforme os vizinhos, quebrando cache.

const PATIENT_KEYS_NORM = new Set([
  "patientname",
  "patient",
  "paciente",
  "nomepaciente",
  "nmpaciente",
  "nomedopaciente",
  "pacientenome",
]);

const normKey = (k: string): string =>
  k
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-./]+/g, "");

export type ReverseMap = Record<string, string>;

export interface MaskResult<T> {
  masked: T;
  reverseMap: ReverseMap;
}

/**
 * Mascara nomes de paciente em qualquer estrutura JSON-like.
 * Walk é feito com chaves ORDENADAS para que a atribuição de tokens seja
 * determinística e independente da ordem original das propriedades.
 */
export function maskPatients<T>(payload: T): MaskResult<T> {
  const tokenByName = new Map<string, string>();

  const assign = (rawName: string): string => {
    const name = rawName.trim();
    let tok = tokenByName.get(name);
    if (!tok) {
      tok = `PACIENTE_${tokenByName.size + 1}`;
      tokenByName.set(name, tok);
    }
    return tok;
  };

  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object") {
      if (seen.has(v as object)) return null;
      seen.add(v as object);
      const src = v as Record<string, unknown>;
      const keys = Object.keys(src).sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const val = src[k];
        if (
          PATIENT_KEYS_NORM.has(normKey(k)) &&
          typeof val === "string" &&
          val.trim() !== ""
        ) {
          out[k] = assign(val);
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    return v;
  };

  const masked = walk(payload) as T;
  const reverseMap: ReverseMap = {};
  for (const [name, tok] of tokenByName.entries()) reverseMap[tok] = name;
  return { masked, reverseMap };
}

/**
 * Re-hidrata tokens PACIENTE_N em texto plano vindo da IA.
 * Tokens de índice maior são substituídos primeiro para evitar que
 * PACIENTE_1 case dentro de PACIENTE_10.
 */
export function unmaskText(
  text: string | null | undefined,
  reverseMap: ReverseMap,
): string {
  if (text == null || text === "") return text ?? "";
  const tokens = Object.keys(reverseMap).sort((a, b) => b.length - a.length);
  let out = text;
  for (const tok of tokens) {
    if (out.includes(tok)) out = out.split(tok).join(reverseMap[tok]);
  }
  return out;
}

/**
 * Re-hidrata tokens em qualquer valor JSON-like (objeto/array/string).
 * Não-strings são preservados. Chaves são preservadas como estão.
 */
export function unmaskDeep<T>(value: T, reverseMap: ReverseMap): T {
  if (value == null) return value;
  if (typeof value === "string") return unmaskText(value, reverseMap) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => unmaskDeep(v, reverseMap)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = unmaskDeep(v, reverseMap);
    }
    return out as unknown as T;
  }
  return value;
}
