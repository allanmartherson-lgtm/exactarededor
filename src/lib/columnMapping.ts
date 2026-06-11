/**
 * Mapeamento explícito de colunas da base de pagamento.
 *
 * Objetivo: tornar VISÍVEL e CORRIGÍVEL o casamento entre os campos do modelo
 * (`doctor_name`, `gross_amount`, `procedure_code` etc.) e os headers
 * realmente presentes na planilha do hospital. Quando o padrão da planilha
 * muda (header novo, coluna em outra ordem), o sistema mostra o que detectou
 * e pede confirmação em vez de importar silenciosamente os dados errados.
 *
 * Camadas:
 *  1. FIELD_DEFINITIONS — fonte única dos campos, sinônimos, obrigatoriedade e excludes
 *  2. inspectColumnMapping() — dado os headers da planilha, devolve a melhor
 *     correspondência por campo com score/confiança
 *  3. computeHeaderSignature() — hash determinístico dos headers para reuso
 *     de templates salvos por hospital
 */

import { sha256Hex } from "@/lib/hashing";

export type FieldKey =
  | "doctor_name"
  | "doctor_document"
  | "doctor_email"
  | "doctor_role"
  | "gross_amount"
  | "procedure_amount"
  | "procedure_code"
  | "procedure_name"
  | "description"
  | "attendance_number"
  | "patient_name"
  | "access_route"
  | "agreement_text"
  | "specialty"
  | "sector"
  | "quantity"
  | "procedure_date"
  | "attendance_character"
  | "company_name";

export type FieldRequirement = "required" | "recommended" | "optional";

export interface FieldDefinition {
  key: FieldKey;
  /** Label exibido ao analista no diálogo de mapeamento. */
  label: string;
  /** Texto curto explicando para que serve o campo. */
  hint?: string;
  /** Sinônimos aceitos. Ordem importa: os primeiros têm mais peso. */
  keys: string[];
  /** Termos que descartam um header (ex.: "solic" para evitar "Médico Solicitante"). */
  excludes?: string[];
  /** Importância para classificação e cálculo. */
  requirement: FieldRequirement;
  /** Tipo do valor — usado para mostrar o exemplo formatado. */
  kind: "text" | "number" | "date";
}

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: "doctor_name",
    label: "Médico",
    hint: "Nome do prestador que recebe o repasse",
    keys: [
      "medico parecerista", "médico parecerista", "parecerista",
      "medico executante", "médico executante", "executante",
      "medico exec", "médico exec",
      "medico", "médico", "prestador", "profissional",
    ],
    excludes: ["solic", "solicitante", "requisit", "pedinte"],
    requirement: "required",
    kind: "text",
  },
  {
    key: "doctor_role",
    label: "Função",
    hint: "Cirurgião, Primeiro Aux, Segundo Aux, Anestesista…",
    keys: ["funcao", "função", "papel", "tipo participacao", "tipo participação"],
    requirement: "required",
    kind: "text",
  },
  {
    key: "doctor_document",
    label: "CPF/CNPJ do médico",
    keys: ["cpf", "cnpj", "documento", "doc"],
    requirement: "optional",
    kind: "text",
  },
  {
    key: "doctor_email",
    label: "E-mail do médico",
    keys: ["email", "e-mail"],
    requirement: "optional",
    kind: "text",
  },
  {
    key: "gross_amount",
    label: "Valor pago (repasse)",
    hint: "Valor que será repassado ao médico após o acordo",
    keys: [
      "vl repasse", "valor repasse", "valor a repassar", "valor repassar",
      "vlrepasse", "vl. repasse",
      "r$ a pagar", "rs a pagar", "a pagar", "valor a pagar", "vl a pagar",
      "honorario liquido", "honorário líquido",
    ],
    requirement: "required",
    kind: "number",
  },
  {
    key: "procedure_amount",
    label: "Valor do procedimento (convênio)",
    hint: "Valor bruto do procedimento antes do acordo — base de cálculo",
    keys: [
      "valor procedimento", "valor proce", "vl proce", "vlproce",
      "valor convenio", "valor convênio", "vl convenio", "vl. convenio",
      "valor bruto", "vlrbruto", "bruto",
    ],
    excludes: ["repasse"],
    requirement: "recommended",
    kind: "number",
  },
  {
    key: "procedure_code",
    label: "Código TUSS",
    keys: [
      "codigo procedimento", "código procedimento", "codigoproc", "codproc",
      "cod. tuss", "tuss", "codigo tuss", "código tuss",
    ],
    requirement: "required",
    kind: "text",
  },
  {
    key: "procedure_name",
    label: "Nome do procedimento",
    keys: ["procedmat", "proced/mat", "proced.", "procedimento"],
    requirement: "recommended",
    kind: "text",
  },
  {
    key: "description",
    label: "Descrição / Serviço",
    keys: ["procedmat", "proced/mat", "proced.", "procedimento", "descricao", "descrição", "servico", "serviço"],
    requirement: "optional",
    kind: "text",
  },
  {
    key: "attendance_number",
    label: "Nº Atendimento",
    keys: ["nr atendimento", "n atendimento", "atendimento", "atend", "nratendim"],
    requirement: "required",
    kind: "text",
  },
  {
    key: "patient_name",
    label: "Paciente",
    keys: ["paciente", "nome paciente", "nm paciente", "nome do paciente", "nome"],
    requirement: "recommended",
    kind: "text",
  },
  {
    key: "access_route",
    label: "Via de acesso",
    keys: ["via de acesso", "viaacesso", "via acesso"],
    requirement: "optional",
    kind: "text",
  },
  {
    key: "agreement_text",
    label: "Convênio",
    keys: ["convenio", "convênio", "acordo", "operadora", "plano"],
    requirement: "required",
    kind: "text",
  },
  {
    key: "specialty",
    label: "Especialidade",
    keys: [
      "especialidade", "especialid", "especialidade médica", "especialidade medica",
      "espec destino", "espec. dest", "espec dest", "especialidade destino",
    ],
    requirement: "optional",
    kind: "text",
  },
  {
    key: "sector",
    label: "Setor / Unidade",
    keys: [
      "setor do pagamento", "setor",
      "unidade de atendimento", "unidade",
      "departamento", "servico", "serviço",
      "localizacao", "localização",
    ],
    requirement: "recommended",
    kind: "text",
  },
  {
    key: "quantity",
    label: "Quantidade",
    keys: ["qtd", "quantidade"],
    requirement: "optional",
    kind: "number",
  },
  {
    key: "procedure_date",
    label: "Data do procedimento",
    keys: [
      "data procedimento", "data atendimento", "data",
      "dt resposta", "dt. resp", "dt resp", "data resposta",
      "dt solic", "dt. solic", "data solicitacao", "data solicitação",
    ],
    requirement: "recommended",
    kind: "date",
  },
  {
    key: "attendance_character",
    label: "Caráter do atendimento",
    keys: [
      "tipo entrada", "tipo de entrada",
      "carater", "caráter",
      "carater atendimento", "caráter atendimento",
      "carater do atendimento", "caráter do atendimento",
      "tipo internacao", "tipo internação",
    ],
    requirement: "optional",
    kind: "text",
  },
  {
    key: "company_name",
    label: "Empresa (PJ)",
    hint: "Geralmente identificada pelo nome do arquivo — esta coluna é fallback",
    keys: ["empresa", "hospital", "unidade", "unidade de atendimento", "pj", "fornecedor"],
    requirement: "optional",
    kind: "text",
  },
];

export const FIELD_BY_KEY: Record<FieldKey, FieldDefinition> = Object.fromEntries(
  FIELD_DEFINITIONS.map((f) => [f.key, f]),
) as Record<FieldKey, FieldDefinition>;

// ============= Normalização e pontuação =============

export const normHeader = (s: string): string =>
  (s ?? "").toString().toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-./]+/g, "");

/**
 * Pontua um header contra a lista de sinônimos de um campo.
 * Espelha exatamente a lógica do `pick()` antigo para não regredir matches
 * que já funcionavam.
 */
export const scoreHeaderForField = (header: string, def: FieldDefinition): number => {
  const nh = normHeader(header);
  if (!nh) return 0;
  const excludes = (def.excludes ?? []).map(normHeader).filter(Boolean);
  if (excludes.some((ex) => nh.includes(ex))) return 0;
  let best = 0;
  def.keys.forEach((k, idx) => {
    const nk = normHeader(k);
    if (!nk) return;
    let s = 0;
    if (nh === nk) s = 100;
    else if (nh.startsWith(nk)) s = 60;
    else if (nh.includes(nk)) s = 30;
    if (s === 0) return;
    s += Math.max(0, 10 - idx);
    if (s > best) best = s;
  });
  return best;
};

export type Confidence = "high" | "medium" | "low" | "none";

export const scoreToConfidence = (score: number): Confidence => {
  if (score >= 90) return "high";
  if (score >= 60) return "medium";
  if (score > 0) return "low";
  return "none";
};

export interface FieldMappingHit {
  field: FieldKey;
  header: string | null;
  score: number;
  confidence: Confidence;
  /** Headers candidatos (top-3) para o analista escolher manualmente. */
  alternatives: Array<{ header: string; score: number }>;
}

/**
 * Inspeciona o melhor mapeamento para cada campo do modelo dada a lista de
 * headers detectada na planilha. Não lê dados — apenas decide colunas.
 */
export const inspectColumnMapping = (headers: string[]): FieldMappingHit[] => {
  const usedHeaders = new Set<string>();
  return FIELD_DEFINITIONS.map((def) => {
    const ranked = headers
      .map((h) => ({ header: h, score: scoreHeaderForField(h, def) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    const top = ranked[0];
    // permite o mesmo header servir a múltiplos campos (procedure_name e description compartilham "procedimento")
    if (top) usedHeaders.add(top.header);
    return {
      field: def.key,
      header: top?.header ?? null,
      score: top?.score ?? 0,
      confidence: scoreToConfidence(top?.score ?? 0),
      alternatives: ranked.slice(0, 5),
    };
  });
};

export const summarizeMissing = (hits: FieldMappingHit[]) => {
  const missingRequired = hits.filter(
    (h) => FIELD_BY_KEY[h.field].requirement === "required" && (!h.header || h.score < 30),
  );
  const lowConfidence = hits.filter(
    (h) => FIELD_BY_KEY[h.field].requirement !== "optional" && h.header && h.score < 60,
  );
  return { missingRequired, lowConfidence };
};

/**
 * Constrói um manualMapping (campo → header) a partir de uma lista de hits,
 * incluindo apenas o que o usuário CONFIRMOU. Campos sem header = não usar.
 */
export type ManualMapping = Partial<Record<FieldKey, string>>;

export const hitsToMapping = (hits: FieldMappingHit[]): ManualMapping => {
  const out: ManualMapping = {};
  hits.forEach((h) => {
    if (h.header) out[h.field] = h.header;
  });
  return out;
};

// ============= Assinatura de headers (para reuso de template) =============

/**
 * Hash determinístico dos headers normalizados + ordenados.
 * Duas planilhas com os mesmos cabeçalhos (ignorando ordem e maiúsculas)
 * geram a mesma assinatura — então o template salvo para uma reaproveita
 * automaticamente para a outra.
 */
export const computeHeaderSignature = async (headers: string[]): Promise<string> => {
  const norm = Array.from(new Set(headers.map(normHeader).filter(Boolean))).sort();
  return sha256Hex(norm.join("|"));
};
