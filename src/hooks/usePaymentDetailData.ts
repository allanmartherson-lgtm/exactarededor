import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { InvoiceQuestion } from "@/components/InvoiceQuestionsThread";

type Tables = Database["public"]["Tables"];
export type PaymentRow = Tables["payments"]["Row"];
export type AiFindings = {
  alerts?: string[];
  matched_rules?: string[];
  matched_rule_ids?: string[];
  calculation_explanation?: string;
  [k: string]: unknown;
};
export type PaymentItemRow = Omit<Tables["payment_items"]["Row"], "ai_findings"> & {
  ai_findings: AiFindings | null;
};
export type ObservationRow = Tables["payment_observations"]["Row"];
export type AiVersionRow = Omit<
  Tables["ai_analysis_versions"]["Row"],
  "alerts" | "matched_rules" | "matched_rule_ids"
> & {
  alerts: string[] | null;
  matched_rules: string[] | null;
  matched_rule_ids: string[] | null;
};
export type GroupRow = Tables["payment_company_groups"]["Row"];
export type InvoiceRow = Tables["invoices"]["Row"];
export type RuleLite = {
  id: string;
  name: string;
  rule_text: string;
  description: string | null;
};

/**
 * Hook responsável por carregar TODOS os dados do PaymentDetail.
 * - Centraliza fetches paralelos (payment, items, obs, profiles, AI versions,
 *   groups, invoices, questions) + carregamento das regras citadas pela IA.
 * - Implementa race-token: respostas de uma carga anterior (antes do :id mudar
 *   ou o componente desmontar) são descartadas e nunca sobrescrevem o estado.
 * - Expõe os setters para que o componente continue podendo aplicar otimismo
 *   local em ações pontuais (ex.: limpar drafts ao salvar).
 */
export function usePaymentDetailData(id: string | undefined) {
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [items, setItems] = useState<PaymentItemRow[]>([]);
  const [obs, setObs] = useState<ObservationRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [aiVersions, setAiVersions] = useState<AiVersionRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [questions, setQuestions] = useState<(InvoiceQuestion & { invoice_id: string })[]>([]);
  const [rulesIndex, setRulesIndex] = useState<Record<string, RuleLite>>({});
  const [rulesByName, setRulesByName] = useState<Record<string, RuleLite>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const loadTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    // Cancela request anterior em voo (se houver) antes de iniciar a nova.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const myToken = ++loadTokenRef.current;
    const [
      { data: p },
      { data: it },
      { data: o },
      { data: pr },
      { data: vs },
      { data: gs },
      { data: inv },
      { data: qs },
    ] = await Promise.all([
      supabase.from("payments").select("*").eq("id", id).abortSignal(ac.signal).single(),
      supabase.from("payment_items").select("*").eq("payment_id", id).order("created_at").abortSignal(ac.signal),
      supabase
        .from("payment_observations")
        .select("*")
        .eq("payment_id", id)
        .order("created_at", { ascending: false })
        .abortSignal(ac.signal),
      supabase.from("profiles").select("id,full_name,email").abortSignal(ac.signal),
      supabase
        .from("ai_analysis_versions")
        .select("*")
        .eq("payment_id", id)
        .order("version", { ascending: false })
        .abortSignal(ac.signal),
      supabase
        .from("payment_company_groups")
        .select("*")
        .eq("payment_id", id)
        .order("company_name")
        .abortSignal(ac.signal),
      supabase.from("invoices").select("*").eq("payment_id", id).abortSignal(ac.signal),
      supabase
        .from("invoice_questions")
        .select("id, invoice_id, author_type, author_name, message, created_at, read_at")
        .eq("payment_id", id)
        .order("created_at", { ascending: true })
        .abortSignal(ac.signal),
    ]);
    if (myToken !== loadTokenRef.current || ac.signal.aborted) return;
    setPayment(p);
    setItems((it ?? []) as unknown as PaymentItemRow[]);
    setObs(o ?? []);
    setAiVersions((vs ?? []) as unknown as AiVersionRow[]);
    setGroups(gs ?? []);
    setInvoices(inv ?? []);
    setQuestions((qs ?? []) as unknown as (InvoiceQuestion & { invoice_id: string })[]);
    setExpandedGroups(new Set((gs ?? []).map((g) => g.id)));
    const map: Record<string, string> = {};
    (pr ?? []).forEach((x) => {
      map[x.id] = (x as { full_name?: string | null; email: string }).full_name || x.email;
    });
    setProfiles(map);

    // Regras citadas pela IA (resumo + link nos tooltips)
    const ids = Array.from(
      new Set(
        (it ?? []).flatMap(
          (x) => ((x as { ai_findings?: AiFindings | null }).ai_findings?.matched_rule_ids ?? []),
        ),
      ),
    ).filter(Boolean) as string[];
    const names = Array.from(
      new Set(
        (it ?? []).flatMap(
          (x) => ((x as { ai_findings?: AiFindings | null }).ai_findings?.matched_rules ?? []),
        ),
      ),
    ).filter(Boolean) as string[];
    const [byIdRes, byNameRes] = await Promise.all([
      ids.length
        ? supabase.from("rules").select("id,name,rule_text,description").in("id", ids).abortSignal(ac.signal)
        : Promise.resolve({ data: [] as RuleLite[] }),
      names.length
        ? supabase.from("rules").select("id,name,rule_text,description").in("name", names).abortSignal(ac.signal)
        : Promise.resolve({ data: [] as RuleLite[] }),
    ]);
    if (myToken !== loadTokenRef.current || ac.signal.aborted) return;
    const idx: Record<string, RuleLite> = {};
    (byIdRes.data ?? []).forEach((r) => {
      idx[(r as RuleLite).id] = r as RuleLite;
    });
    (byNameRes.data ?? []).forEach((r) => {
      idx[(r as RuleLite).id] = r as RuleLite;
    });
    const nameIdx: Record<string, RuleLite> = {};
    Object.values(idx).forEach((r) => {
      nameIdx[String(r.name).trim().toLowerCase()] = r;
    });
    setRulesIndex(idx);
    setRulesByName(nameIdx);
  }, [id]);

  useEffect(() => {
    load();
    // Cleanup: aborta o request HTTP em voo + invalida o token (defesa em
    // profundidade) ao trocar :id ou desmontar.
    return () => {
      loadTokenRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [load]);

  return {
    // state
    payment,
    items,
    obs,
    profiles,
    aiVersions,
    groups,
    invoices,
    questions,
    rulesIndex,
    rulesByName,
    expandedGroups,
    // setters (uso pontual no componente)
    setPayment,
    setItems,
    setObs,
    setAiVersions,
    setGroups,
    setInvoices,
    setQuestions,
    setExpandedGroups,
    // actions
    load,
  };
}