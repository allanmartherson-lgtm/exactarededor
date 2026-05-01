import { supabase } from "@/integrations/supabase/client";

export type AuditEntity = "rule" | "payment";
export type AuditAction = "create" | "update";

export interface AuditCompany {
  id?: string | null;
  name?: string | null;
  document?: string | null;
}

export interface AuditDiffEntry {
  before: unknown;
  after: unknown;
}
export type AuditDiff = Record<string, AuditDiffEntry>;

/** Compara dois objetos rasos e retorna apenas os campos que mudaram. */
export const buildDiff = <T extends Record<string, unknown>>(before: T | null, after: T): AuditDiff => {
  const diff: AuditDiff = {};
  if (!before) {
    for (const k of Object.keys(after)) diff[k] = { before: null, after: (after as any)[k] };
    return diff;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = (before as any)[k];
    const b = (after as any)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[k] = { before: a ?? null, after: b ?? null };
  }
  return diff;
};

/** Insere um registro no histórico. Falhas são logadas mas não bloqueiam a operação principal. */
export const recordAudit = async (params: {
  entityType: AuditEntity;
  entityId: string;
  action: AuditAction;
  actorId: string;
  company?: AuditCompany | null;
  diff?: AuditDiff;
}): Promise<void> => {
  const { entityType, entityId, action, actorId, company, diff } = params;
  const { error } = await supabase.from("audit_log").insert({
    entity_type: entityType,
    entity_id: entityId,
    action,
    actor_id: actorId,
    company_id: company?.id ?? null,
    company_name: company?.name ?? null,
    company_document: company?.document ?? null,
    diff: diff ?? {},
  });
  if (error) console.warn("[audit] falha ao registrar histórico:", error.message);
};