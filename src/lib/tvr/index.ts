/**
 * Domínio TASY vs Repasse (TVR) — lógica pura, sem React e sem Supabase.
 *
 * Extraído de RetroactiveReconciliationsTab.tsx para que testes e libs possam
 * importar as regras sem arrastar a árvore de componentes junto.
 */
export type { TasyRow, PagRow, TvrStatus, TvrResult, TvrAcao } from "./types";

export { num, brl, formatTvrDate } from "./format";

export {
  normTuss,
  tvrTussKey,
  isExcludedTvrTuss,
  normAtt,
  normDoctorName,
  doctorKeyPart,
  dateKeyPart,
  tvrMatchKey,
  isYmdWithinInclusive,
} from "./keys";

export {
  TVR_SOURCE,
  TVR_STATUS_LABEL,
  TVR_STATUS_TONE,
  TVR_STATUS_ORDER,
  KEY_AUDIT_SOURCE_LABEL,
  KEY_AUDIT_SOURCE_TONE,
  effectiveTvrStatus,
  computeTvrCounts,
  mapTvrStatusToStoredClassification,
  isTvrResult,
  getAusenteTasyMissingFields,
} from "./status";

export {
  getTvrValorRecuperar,
  computeTvrFinancialTotals,
  computeTvrComplementarBreakdown,
  computeTvrHeadlineTotals,
} from "./totals";

export { describeTvrAcao } from "./acao";

export { buildTvrReplaceSummary } from "./summary";
