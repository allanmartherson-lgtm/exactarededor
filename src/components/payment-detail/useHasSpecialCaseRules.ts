import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna true quando existe pelo menos 1 regra ATIVA cujo cálculo tem
 * `special_case_filter` preenchido e que é relevante para o contexto atual.
 *
 * Após a unificação (jun/2026) o filtro de caso especial vive APENAS no nível
 * do cálculo (`rule_calculations.special_case_filter`). A coluna equivalente
 * em `rules` foi descontinuada e não é mais lida.
 *
 * Resolução de alvo (todas as formas usadas pelo cadastro de regras):
 *  - FKs diretas: `target_doctor_id` / `target_company_id`
 *  - Identificador textual: `target_type='medico'` + `target_identifier` (CRM)
 *    e `target_type='empresa'` + `target_identifier` (CNPJ)
 *  - Escopo grupo: `group_doctors[]` e `group_company_links[]`
 *
 * Regras globais (sem nenhum alvo) NÃO contam — analistas reportaram banner
 * aparecendo em PJs sem vínculo real.
 */

const digits = (s: unknown) => String(s ?? "").replace(/\D+/g, "");

type RuleRow = {
  id: string;
  target_type: string | null;
  target_identifier: string | null;
  target_doctor_id: string | null;
  target_company_id: string | null;
  group_doctors: unknown;
  group_company_links: unknown;
};

function collectIds(arr: unknown, keys: string[]): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const el of arr) {
    if (typeof el === "string") { out.push(el); continue; }
    if (el && typeof el === "object") {
      for (const k of keys) {
        const v = (el as Record<string, unknown>)[k];
        if (typeof v === "string" && v) out.push(v);
      }
    }
  }
  return out;
}

function collectStrings(arr: unknown, keys: string[]): string[] {
  return collectIds(arr, keys);
}

export function useHasSpecialCaseRules(
  paymentId: string | null | undefined,
  companyId?: string | null,
) {
  const [hasRules, setHasRules] = useState<boolean | null>(null);

  useEffect(() => {
    if (!paymentId) { setHasRules(false); return; }
    let cancelled = false;
    (async () => {
      const finish = (v: boolean) => { if (!cancelled) setHasRules(v); };

      const { data: pay } = await supabase
        .from("payments")
        .select("hospital_id")
        .eq("id", paymentId)
        .maybeSingle();
      const hospitalId = (pay as { hospital_id?: string | null } | null)?.hospital_id ?? null;

      // 1) Regras que têm pelo menos 1 cálculo com special_case_filter preenchido.
      const { data: calcs } = await supabase
        .from("rule_calculations")
        .select("rule_id")
        .not("special_case_filter", "is", null);
      const ruleIdsWithSpecialCalc = Array.from(
        new Set(
          ((calcs ?? []) as Array<{ rule_id: string | null }>)
            .map((c) => c.rule_id)
            .filter((id): id is string => !!id),
        ),
      );
      if (ruleIdsWithSpecialCalc.length === 0) return finish(false);

      // 2) Alvos presentes no contexto (pagamento inteiro ou uma PJ específica).
      let itemsQ = supabase
        .from("payment_items")
        .select("company_id, doctor_id")
        .eq("payment_id", paymentId);
      if (companyId) itemsQ = itemsQ.eq("company_id", companyId);
      const { data: items } = await itemsQ;
      const rows = (items ?? []) as Array<{ company_id: string | null; doctor_id: string | null }>;

      const companyIds = new Set(
        companyId
          ? [companyId]
          : rows.map((r) => r.company_id).filter((c): c is string => !!c),
      );
      const doctorIds = new Set(rows.map((r) => r.doctor_id).filter((d): d is string => !!d));
      if (companyIds.size === 0 && doctorIds.size === 0) return finish(false);

      // 3) Regras candidatas (poucas — filtradas pelos cálculos especiais).
      let rulesQ = supabase
        .from("rules")
        .select("id, target_type, target_identifier, target_doctor_id, target_company_id, group_doctors, group_company_links")
        .eq("active", true)
        .in("id", ruleIdsWithSpecialCalc);
      if (hospitalId) rulesQ = rulesQ.eq("hospital_id", hospitalId);
      const { data: rulesData } = await rulesQ;
      const rules = (rulesData ?? []) as unknown as RuleRow[];
      if (rules.length === 0) return finish(false);

      // 4) Identificadores textuais (CRM / CNPJ) dos alvos do contexto.
      const crmSet = new Set<string>();
      const docSet = new Set<string>();
      if (doctorIds.size > 0) {
        const { data: docs } = await supabase
          .from("doctors")
          .select("id, crm")
          .in("id", Array.from(doctorIds));
        for (const d of (docs ?? []) as Array<{ crm: string | null }>) {
          const c = digits(d.crm);
          if (c) crmSet.add(c);
        }
      }
      if (companyIds.size > 0) {
        const { data: comps } = await supabase
          .from("companies")
          .select("id, document")
          .in("id", Array.from(companyIds));
        for (const c of (comps ?? []) as Array<{ document: string | null }>) {
          const d = digits(c.document);
          if (d) docSet.add(d);
        }
      }

      const matched = rules.some((r) => {
        if (r.target_doctor_id && doctorIds.has(r.target_doctor_id)) return true;
        if (r.target_company_id && companyIds.has(r.target_company_id)) return true;

        const ident = digits(r.target_identifier);
        if (ident) {
          if (r.target_type === "medico" && crmSet.has(ident)) return true;
          if (r.target_type === "empresa" && docSet.has(ident)) return true;
          // Sem target_type confiável: tenta ambos.
          if (!r.target_type && (crmSet.has(ident) || docSet.has(ident))) return true;
        }

        // Escopo grupo
        const gDocIds = collectIds(r.group_doctors, ["doctor_id", "id"]);
        if (gDocIds.some((id) => doctorIds.has(id))) return true;
        const gDocCrms = collectStrings(r.group_doctors, ["crm", "identifier"]).map(digits);
        if (gDocCrms.some((c) => c && crmSet.has(c))) return true;

        const gCoIds = collectIds(r.group_company_links, ["company_id", "id"]);
        if (gCoIds.some((id) => companyIds.has(id))) return true;
        const gCoDocs = collectStrings(r.group_company_links, ["company_document", "document"]).map(digits);
        if (gCoDocs.some((d) => d && docSet.has(d))) return true;

        // Médicos aninhados dentro dos vínculos de empresa
        if (Array.isArray(r.group_company_links)) {
          for (const link of r.group_company_links as Array<Record<string, unknown>>) {
            const nested = link?.doctors;
            const ids = collectIds(nested, ["doctor_id", "id"]);
            if (ids.some((id) => doctorIds.has(id))) return true;
            const crms = collectStrings(nested, ["crm", "identifier"]).map(digits);
            if (crms.some((c) => c && crmSet.has(c))) return true;
          }
        }
        return false;
      });

      finish(matched);
    })();
    return () => { cancelled = true; };
  }, [paymentId, companyId]);

  return hasRules;
}
