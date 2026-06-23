/**
 * Rascunho autosave do "Novo Pagamento".
 *
 * Limitação técnica: `File` não é serializável em localStorage. Persistimos
 * apenas o estado leve (campos do formulário + decisões por arquivo). Ao
 * reabrir, o analista re-anexa as mesmas planilhas e as decisões são
 * reaplicadas via chave `nome::tamanho::lastModified`.
 */

const VERSION = 1;
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

export type FileDecision = {
  sectorMapping?: string | null;
  matchedCompany?: { id: string; name: string } | null;
  manualOverride?: boolean;
  convenioValueTotalized?: boolean;
  headerRowIndex?: number;
  sectorColumnUsed?: string | null;
  columnOverrides?: Record<string, unknown>;
  columnMapping?: Record<string, unknown>;
};

export type DraftPayload = {
  v: number;
  savedAt: number;
  form: {
    reference?: string;
    description?: string;
    competenceMonths?: string[];
    paymentDueDate?: string;
    paymentKind?: string;
    paymentTrack?: string;
    costCenterCode?: string | null;
    pSectors?: string[];
    pSpecialties?: string[];
    autoSectors?: boolean;
    autoSpecialties?: boolean;
    autoPaymentKind?: boolean;
    importMode?: string;
  };
  suspiciousDecisions?: Record<string, unknown>;
  fileDecisions?: Record<string, FileDecision>; // key = `${name}::${size}::${lastModified}`
};

function keyFor(hospitalId: string | null, mode: string, paymentTypeId: string | null): string {
  return `newPaymentDraft:v${VERSION}:${hospitalId ?? "_"}:${mode}:${paymentTypeId ?? "_"}`;
}

export function fileKey(f: { name: string; size: number; lastModified: number }): string {
  return `${f.name}::${f.size}::${f.lastModified}`;
}

export function loadDraft(
  hospitalId: string | null,
  mode: string,
  paymentTypeId: string | null,
): DraftPayload | null {
  try {
    const raw = localStorage.getItem(keyFor(hospitalId, mode, paymentTypeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    if (parsed.v !== VERSION) return null;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(keyFor(hospitalId, mode, paymentTypeId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(
  hospitalId: string | null,
  mode: string,
  paymentTypeId: string | null,
  payload: Omit<DraftPayload, "v" | "savedAt">,
): void {
  try {
    const data: DraftPayload = { v: VERSION, savedAt: Date.now(), ...payload };
    localStorage.setItem(keyFor(hospitalId, mode, paymentTypeId), JSON.stringify(data));
  } catch {
    /* quota, etc. — ignorar silenciosamente */
  }
}

export function clearDraft(
  hospitalId: string | null,
  mode: string,
  paymentTypeId: string | null,
): void {
  try {
    localStorage.removeItem(keyFor(hospitalId, mode, paymentTypeId));
  } catch {
    /* ignore */
  }
}

export function isDraftMeaningful(p: DraftPayload | null): boolean {
  if (!p) return false;
  const f = p.form ?? {};
  const hasForm =
    !!f.reference ||
    !!f.description ||
    (f.competenceMonths?.length ?? 0) > 0 ||
    !!f.paymentDueDate ||
    !!f.costCenterCode ||
    (f.pSectors?.length ?? 0) > 0 ||
    (f.pSpecialties?.length ?? 0) > 0;
  const hasFiles = Object.keys(p.fileDecisions ?? {}).length > 0;
  const hasSusp = Object.keys(p.suspiciousDecisions ?? {}).length > 0;
  return hasForm || hasFiles || hasSusp;
}
