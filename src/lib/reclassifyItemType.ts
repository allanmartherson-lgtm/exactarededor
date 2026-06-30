/**
 * Helper puro que constrói o patch de reclassificação manual de um
 * payment_item ao trocar seu `item_type`.
 *
 * Regras (espelho do que o parser de importação aplica):
 *  - Tipo FIXO (tuss_default preenchido — Consulta/Parecer/Visita):
 *      → procedure_code = tuss_default
 *      → procedure_name = "{label} - {Espec dest}" (ou só label, se ausente)
 *  - Tipo DINÂMICO (Procedimento/SADT/Cirurgia/Exames — tuss_default nulo):
 *      → se raw_data contém flags __tuss_default_applied / __procedure_name_defaulted
 *        (ou seja, os valores atuais foram imputados na importação), restaura
 *        procedure_code e procedure_name a partir das colunas originais
 *        ("Código TUSS" / "Produto" / "Descrição").
 *      → se o item já carrega códigos próprios da planilha, mantém.
 *
 * Mantém também o reset de estado de análise (ai_status pendente,
 * package_absorbed false, etc.) para o motor recomputar do zero.
 */

export type TargetTypeMeta = {
  id: string;
  label: string;
  tuss_default: string | null;
};

export type ReclassifyItemInput = {
  id: string;
  raw_data?: Record<string, any> | null;
};

export type ReclassifyPatch = {
  item_type_id: string;
  item_type_source: "manual";
  reclassified_from_parecer: boolean;
  manual_intervention_notes: string | null;
  ai_status: "pendente";
  ai_findings: null;
  package_absorbed: false;
  package_absorbed_calc_id: null;
  procedure_code?: string;
  procedure_name?: string;
};

const pickRaw = (
  raw: Record<string, any> | null | undefined,
  regexes: RegExp[],
): string | null => {
  if (!raw || typeof raw !== "object") return null;
  for (const k of Object.keys(raw)) {
    if (regexes.some((r) => r.test(k))) {
      const v = (raw as any)[k];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return null;
};

export function buildReclassifyPatch(
  item: ReclassifyItemInput,
  targetType: TargetTypeMeta,
  newTypeLabel: string,
): ReclassifyPatch {
  const raw = (item.raw_data ?? {}) as Record<string, any>;
  const targetTuss = targetType.tuss_default ?? null;
  const targetLabel = targetType.label ?? newTypeLabel;
  const targetIsFixed = !!targetTuss;

  const patch: ReclassifyPatch = {
    item_type_id: targetType.id,
    item_type_source: "manual",
    reclassified_from_parecer: newTypeLabel === "Visita",
    manual_intervention_notes:
      newTypeLabel === "Visita"
        ? "Reclassificado manualmente como Visita."
        : null,
    ai_status: "pendente",
    ai_findings: null,
    package_absorbed: false,
    package_absorbed_calc_id: null,
  };

  if (targetIsFixed) {
    patch.procedure_code = targetTuss as string;
    const especDest = pickRaw(raw, [
      /espec.*dest/i,
      /^especialidade$/i,
      /especialidade\s*m[eé]dico/i,
    ]);
    patch.procedure_name = especDest ? `${targetLabel} - ${especDest}` : targetLabel;
  } else {
    const wasImputed = !!(
      raw.__tuss_default_applied || raw.__procedure_name_defaulted
    );
    if (wasImputed) {
      const rawCode = pickRaw(raw, [
        /c[oó]digo\s*tuss/i,
        /^tuss$/i,
        /^procedure_code$/i,
      ]);
      const rawName = pickRaw(raw, [
        /^produto$/i,
        /^procedimento$/i,
        /^descri[cç][aã]o$/i,
        /^procedure_name$/i,
      ]);
      if (rawCode) patch.procedure_code = rawCode;
      if (rawName) patch.procedure_name = rawName;
    }
  }

  return patch;
}
