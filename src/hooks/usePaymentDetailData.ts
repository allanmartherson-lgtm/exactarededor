import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { InvoiceQuestion } from "@/components/InvoiceQuestionsThread";

type Tables = Database["public"]["Tables"];
export type PaymentRow = Tables["payments"]["Row"];
export type AiFindingsEngine = {
  calculation_type_used?: string;
  matched_priority?:
    | "medico_codigo"
    | "medico"
    | "empresa_codigo"
    | "empresa"
    | "setor_codigo"
    | "setor"
    | "setor_outro"
    | "default_setor";
  diff_pct?: number | null;
  ai_note?: string | null;
};
export type AiFindings = {
  alerts?: string[];
  matched_rules?: string[];
  matched_rule_ids?: string[];
  calculation_explanation?: string;
  expected_amount?: number | null;
  engine?: AiFindingsEngine | null;
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
export type AssignmentRow = {
  id: string;
  payment_id: string;
  analyst_id: string;
  previous_analyst_id: string | null;
  action: "assumiu" | "transferiu";
  source: "manual" | "auto";
  note: string | null;
  created_by: string;
  created_at: string;
};
export type RuleLite = {
  id: string;
  name: string;
  rule_text: string;
  description: string | null;
  calculation_type?: string | null;
  exclusion_reason?: string | null;
  allows_authorized_exception?: boolean | null;
  // Severity/action vêm da config da regra — usados pela UI para colorir o
  // badge de Validação por nível dominante.
  severity?: string | null;
  action?: string | null;
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
export function usePaymentDetailData(id: string | undefined, options?: { groupId?: string }) {
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
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const loadTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    // NÃO abortamos o request anterior aqui. Durante a análise por IA, o
    // realtime dispara muitos refetches em sequência; abortar o anterior
    // faz a UI nunca terminar de carregar e ficar vazia até o usuário dar
    // F5. O loadTokenRef garante que respostas stale sejam descartadas.
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
      { data: as },
    ] = await Promise.all([
      supabase.from("payments").select("*").eq("id", id).abortSignal(ac.signal).single(),
      (async () => {
        if (options?.groupId) {
          // Busca o nome da empresa do grupo primeiro para filtrar itens
          const { data: g } = await supabase.from("payment_company_groups").select("company_name").eq("id", options.groupId).single();
          if (g?.company_name) {
            return supabase.from("payment_items").select("*").eq("payment_id", id).eq("company_name", g.company_name).order("created_at").limit(5000).abortSignal(ac.signal);
          }
        }
        return supabase.from("payment_items").select("*").eq("payment_id", id).order("created_at").limit(5000).abortSignal(ac.signal);
      })(),
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
      (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)("payment_assignments")
        .select("*")
        .eq("payment_id", id)
        .order("created_at", { ascending: false })
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
    setAssignments((as ?? []) as unknown as AssignmentRow[]);
    setExpandedGroups(new Set());
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
        ? supabase.from("rules").select("id,name,rule_text,description,calculation_type,exclusion_reason,allows_authorized_exception,severity,action").in("id", ids).abortSignal(ac.signal)
        : Promise.resolve({ data: [] as RuleLite[] }),
      names.length
        ? supabase.from("rules").select("id,name,rule_text,description,calculation_type,exclusion_reason,allows_authorized_exception,severity,action").in("name", names).abortSignal(ac.signal)
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

  /**
   * Realtime: assina mudanças em payment_observations e invoice_questions
   * filtradas pelo payment atual. Em qualquer evento (INSERT/UPDATE/DELETE),
   * recarrega — é simples, evita merge manual e é barato porque o usuário
   * está olhando ativamente esta tela.
   */
  useEffect(() => {
    if (!id) return;
    // Debounce coalesces bursts of realtime events (e.g., centenas de updates de
    // payment_items durante a análise por IA) num único refetch. Sem isso, cada
    // evento chama load() e o AbortController do load() anterior cancela o
    // request em voo — resultado: o estado fica preso vazio até o usuário
    // recarregar a página manualmente.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        load();
      }, 600);
    };

    const channel = supabase
      .channel(`payment-detail:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_observations", filter: `payment_id=eq.${id}` },
        scheduleReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoice_questions", filter: `payment_id=eq.${id}` },
        scheduleReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_assignments", filter: `payment_id=eq.${id}` },
        scheduleReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `id=eq.${id}` },
        scheduleReload,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "payment_company_groups", filter: `payment_id=eq.${id}` },
        (payload) => {
          const row = payload.new as GroupRow;
          setGroups((prev) => (prev.some((g) => g.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_company_groups", filter: `payment_id=eq.${id}` },
        (payload) => {
          const row = payload.new as GroupRow;
          setGroups((prev) => prev.map((g) => (g.id === row.id ? { ...g, ...row } : g)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "payment_company_groups", filter: `payment_id=eq.${id}` },
        (payload) => {
          const row = payload.old as Partial<GroupRow>;
          if (!row?.id) return;
          setGroups((prev) => prev.filter((g) => g.id !== row.id));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "payment_items", filter: `payment_id=eq.${id}` },
        (payload) => {
          const row = payload.new as unknown as PaymentItemRow;
          setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_items", filter: `payment_id=eq.${id}` },
        (payload) => {
          const row = payload.new as unknown as PaymentItemRow;
          setItems((prev) => prev.map((i) => (i.id === row.id ? { ...i, ...row } : i)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "payment_items", filter: `payment_id=eq.${id}` },
        (payload) => {
          const row = payload.old as Partial<PaymentItemRow>;
          if (!row?.id) return;
          setItems((prev) => prev.filter((i) => i.id !== row.id));
        },
      )
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [id, load]);

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
    assignments,
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