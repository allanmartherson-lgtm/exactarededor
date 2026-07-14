// Cache determinístico da IA por hash de entrada.
//
// A ideia: se o payload EXATO que iríamos mandar à IA é idêntico a um que
// já mandamos antes (para qualquer item de qualquer lote), reusamos o
// ai_note/extra_alerts em vez de gastar créditos de IA.
//
// Regras de correção:
//  1. O hash é derivado do PRÓPRIO objeto enviado à IA (itemForAi),
//     serializado canonicamente. Não há lista manual de campos — se um
//     campo novo entrar em itemForAi, entra no hash automaticamente.
//  2. Inclui o snapshot do resultado do motor (status, expected_amount,
//     alerts, matched_rule_id) — se o motor mudou de opinião, a IA vê
//     input diferente e o cache deve invalidar.
//  3. Inclui rules.updated_at (máximo do hospital) — mudança de qualquer
//     regra invalida cache de todos os itens.
//  4. Inclui digest determinístico dos IRMÃOS do mesmo atendimento —
//     o prompt pede que a IA identifique duplicidade no atendimento;
//     se qualquer irmão muda de código/valor/função, o output da IA
//     para este item pode mudar, então o hash deve invalidar.
//  5. Inclui AI_PROMPT_VERSION — mudança de prompt/tools invalida tudo.

/**
 * Bumpe esta constante SEMPRE que alterar:
 *  - systemPrompt em analyze-payment/index.ts
 *  - schema/tool da IA (report_justifications)
 *  - shape de itemsForAi
 *  - qualquer regra de composição do payload da IA
 */
export const AI_PROMPT_VERSION = "2026-07-14.v2-pii-mask";

/**
 * Serialização canônica: chaves ordenadas recursivamente. Arrays preservam
 * ordem (a menos que o chamador ordene antes — ver buildSiblingsDigest).
 * NaN/Infinity/undefined viram null para não quebrar JSON.
 */
export function canonicalStringify(value: unknown): string {
  const seen = new WeakSet();
  const normalize = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") {
      return Number.isFinite(v) ? v : null;
    }
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string" || typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map(normalize);
    if (typeof v === "object") {
      if (seen.has(v as object)) return null; // ciclo → null
      seen.add(v as object);
      const out: Record<string, unknown> = {};
      const keys = Object.keys(v as Record<string, unknown>).sort();
      for (const k of keys) {
        out[k] = normalize((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return String(v);
  };
  return JSON.stringify(normalize(value));
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type SiblingItem = {
  id: string;
  procedure_code: string | null;
  doctor_role: string | null;
  gross_amount: number | null;
  procedure_amount: number | null;
};

/**
 * Digest ordenado dos irmãos do mesmo atendimento. Ordenação estável por
 * (procedure_code, doctor_role, id) para que reordenação do array bruto
 * não altere o hash. O item alvo em si é EXCLUÍDO pelo chamador.
 */
export async function buildSiblingsDigest(siblings: SiblingItem[]): Promise<string> {
  if (!siblings || siblings.length === 0) return "no_siblings";
  const normalized = siblings
    .map((s) => ({
      procedure_code: s.procedure_code ?? "",
      doctor_role: s.doctor_role ?? "",
      gross_amount: s.gross_amount ?? 0,
      procedure_amount: s.procedure_amount ?? 0,
      id: s.id,
    }))
    .sort((a, b) => {
      if (a.procedure_code !== b.procedure_code) return a.procedure_code < b.procedure_code ? -1 : 1;
      if (a.doctor_role !== b.doctor_role) return a.doctor_role < b.doctor_role ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  return await sha256Hex(canonicalStringify(normalized));
}

export type EngineSnapshot = {
  status: string | null;
  expected_amount: number | null;
  matched_rule_id: string | null;
  alerts: string[];
};

/**
 * Hash canônico do payload completo enviado à IA para um item.
 * itemForAi deve ser exatamente o objeto que o worker mandaria dentro do
 * chunk — sem "picar" campos manualmente. Se o shape mudar, o hash muda.
 */
export async function buildAiInputHash(params: {
  itemForAi: unknown;
  engineSnapshot: EngineSnapshot;
  rulesUpdatedAt: string | null;
  siblingsDigest: string;
}): Promise<string> {
  const envelope = {
    v: AI_PROMPT_VERSION,
    item: params.itemForAi,
    engine: {
      status: params.engineSnapshot.status ?? null,
      expected_amount: params.engineSnapshot.expected_amount ?? null,
      matched_rule_id: params.engineSnapshot.matched_rule_id ?? null,
      alerts: [...(params.engineSnapshot.alerts ?? [])].sort(),
    },
    rules_updated_at: params.rulesUpdatedAt ?? "no_rules",
    siblings: params.siblingsDigest,
  };
  return await sha256Hex(canonicalStringify(envelope));
}
