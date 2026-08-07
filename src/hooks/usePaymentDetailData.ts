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
  // Severity vem da config da regra — usado pela UI para colorir o
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
  const [paymentMissing, setPaymentMissing] = useState(false);
  const [items, setItems] = useState<PaymentItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsLoadIssue, setItemsLoadIssue] = useState<string | null>(null);
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
  // Lock + trailing-only queue: enquanto um load() paginado está em voo,
  // novos pedidos não disparam um load() concorrente — apenas marcam que
  // há trabalho pendente. Ao terminar, se houver pendência, dispara UM
  // único refetch. Isso elimina o race em que vários loads paralelos se
  // sobrescrevem pelo loadTokenRef e deixam itens=[] na UI.
  const loadInFlightRef = useRef(false);
  const loadInFlightPromiseRef = useRef<Promise<void> | null>(null);
  const loadPendingRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    // Guard de sessão: sem sessão válida o supabase-js cai para a chave anon e
    // TODAS as queries desta tela batem em "permission denied" (42501). Como o
    // fluxo de erro reagenda o load, isso vira uma rajada de dezenas de
    // requisições anônimas contra payment_items. Nunca consultar sem sessão.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      setItemsLoading(false);
      setItemsLoadIssue("Sessão expirada. Faça login novamente para carregar o lote.");
      loadPendingRef.current = false;
      return;
    }
    setItemsLoading(true);
    // NÃO abortamos o request anterior aqui. Durante a análise por IA, o
    // realtime dispara muitos refetches em sequência; abortar o anterior
    // faz a UI nunca terminar de carregar e ficar vazia até o usuário dar
    // F5. O loadTokenRef garante que respostas stale sejam descartadas.
    const ac = new AbortController();
    abortRef.current = ac;
    const myToken = ++loadTokenRef.current;

    const [
      paymentRes,
      itemsRes,
      obsRes,
      profilesRes,
      aiVersionsRes,
      groupsRes,
      invoicesRes,
      questionsRes,
      assignmentsRes,
    ] = await Promise.all([
      supabase.from("payments").select("*").eq("id", id).abortSignal(ac.signal).maybeSingle(),
      (async () => {
        // Paginar itens — PostgREST tem teto server-side (~1000) por requisição,
        // independente do .limit() solicitado. Sem paginar, lotes grandes ficam
        // truncados e os contadores por empresa (✓/✕/⚠) sub-reportam.
        let companyName: string | null = null;
        if (options?.groupId) {
          const { data: g } = await supabase
            .from("payment_company_groups")
            .select("company_name")
            .eq("id", options.groupId)
            .single();
          companyName = g?.company_name ?? null;
        }
        // Página menor (500) reduz o custo por requisição — em lotes grandes
        // (~3k+ itens) o combinado de policies RLS permissivas + JSONB largo
        // (ai_findings/validation_findings) estava batendo statement_timeout
        // na página de 1000. 500 dá folga e mantém poucas rodadas.
        const PAGE = 500;
        const MAX_RETRIES = 3;
        const PARALLELISM = 4; // pages simultâneos — corta o tempo total em lotes grandes.
        const isTimeoutErr = (e: unknown) => {
          const err = e as { code?: string; message?: string } | null;
          const msg = String(err?.message ?? "").toLowerCase();
          return err?.code === "57014" || msg.includes("statement timeout") || msg.includes("canceling statement");
        };
        const buildQuery = (from: number) => {
          let q = supabase
            .from("payment_items")
            .select("*")
            .eq("payment_id", id)
            .order("created_at")
            .range(from, from + PAGE - 1)
            .abortSignal(ac.signal);
          if (companyName) q = q.eq("company_name", companyName);
          return q;
        };
        const runPage = async (from: number): Promise<any> => {
          let attempt = 0;
          while (true) {
            const res = await buildQuery(from);
            if (!res.error) return res;
            if (!isTimeoutErr(res.error) || attempt >= MAX_RETRIES || ac.signal.aborted) return res;
            attempt += 1;
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        };

        // 1) HEAD count — evita rodadas sequenciais "às cegas".
        let headQ = supabase
          .from("payment_items")
          .select("id", { count: "exact", head: true })
          .eq("payment_id", id)
          .abortSignal(ac.signal);
        if (companyName) headQ = headQ.eq("company_name", companyName);
        const headRes = await headQ;
        const total = headRes.count ?? 0;
        if (headRes.error && !total) {
          // fallback: sequencial legado, para não regredir se a HEAD falhar.
          const all: any[] = [];
          for (let from = 0; ; from += PAGE) {
            const res = await runPage(from);
            if (res.error) return res;
            const rows = res.data ?? [];
            all.push(...rows);
            if (rows.length < PAGE) return { data: all, error: null } as any;
            if (all.length >= 20000) return { data: all, error: null } as any;
          }
        }

        // 2) Dispara páginas em paralelo (com limite de concorrência).
        const offsets: number[] = [];
        for (let from = 0; from < total; from += PAGE) offsets.push(from);
        const results: any[] = new Array(offsets.length);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(PARALLELISM, offsets.length) }, async () => {
          while (true) {
            const idx = cursor++;
            if (idx >= offsets.length) return;
            const res = await runPage(offsets[idx]);
            if (res.error) throw res.error;
            results[idx] = res.data ?? [];
          }
        });
        try {
          await Promise.all(workers);
        } catch (error) {
          return { data: null, error } as any;
        }
        const all = results.flat();
        return { data: all, error: null } as any;
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
      supabase
        .from("invoices")
        .select(
          "id,payment_id,expected_amount,received_amount,invoice_number,file_path,status,recipient_email,sent_at,received_at,reconciliation_notes,created_at,updated_at,company_id,company_name,ai_validation,ai_validated_at,ai_extracted_amount,ai_extracted_number,ai_extracted_cnpj,recipient_cc,request_message,items_count,send_error,company_group_id,hospital_id",
        )
        .eq("payment_id", id)
        .abortSignal(ac.signal),
      supabase
        .from("invoice_questions")
        .select("id, invoice_id, author_type, author_name, message, created_at, read_at")
        .eq("payment_id", id)
        .order("created_at", { ascending: true })
        .abortSignal(ac.signal),
      supabase.from("payment_assignments")
        .select("*")
        .eq("payment_id", id)
        .order("created_at", { ascending: false })
        .abortSignal(ac.signal),

    ]);
    if (myToken !== loadTokenRef.current || ac.signal.aborted) return;
    const p = paymentRes.data;
    const it = itemsRes.data;
    const o = obsRes.data;
    const pr = profilesRes.data;
    const vs = aiVersionsRes.data;
    const gs = groupsRes.data;
    const inv = invoicesRes.data;
    const qs = questionsRes.data;
    const as = assignmentsRes.data;
    setPayment(p);
    // Distingue "ainda carregando" de "não encontrado / RLS bloqueou (outro hospital)".
    // Sem esse flag, o componente ficava eternamente em "Carregando..." quando o
    // pagamento pertencia a outra unidade após troca de hospital.
    setPaymentMissing(!paymentRes.error && !p);
    if (itemsRes.error) {
      console.error("[PaymentDetail] Falha ao carregar itens; mantendo estado anterior", itemsRes.error);
      setItemsLoadIssue("Falha temporária ao carregar itens. Recarregando…");
      loadPendingRef.current = true;
      return;
    }
    // Itens cancelados: suprime todos os ai_findings, alerts e validation_findings
    // antes de qualquer consumidor (badges, contagens, alertas, tooltips).
    // Item cancelado não deve mais "gritar" como alerta/validação em nenhuma tela
    // de análise — espelha a decisão do analista de descontinuá-lo.
    const rawItems = (it ?? []) as unknown as PaymentItemRow[];
    const expectedItems = Number((p as { items_count?: number | null } | null)?.items_count ?? 0);
    if (expectedItems > 0 && rawItems.length === 0) {
      console.warn("[PaymentDetail] Fetch retornou 0 itens para lote com items_count > 0; reagendando sem limpar a UI", { expectedItems });
      setItemsLoadIssue("Itens temporariamente indisponíveis. Recarregando…");
      loadPendingRef.current = true;
      return;
    }
    const sanitizedItems = rawItems.map((row) => {
      if (!(row as any).is_cancelled) return row;
      return {
        ...row,
        ai_findings: row.ai_findings
          ? { ...(row.ai_findings as any), alerts: [], needs_human_review: false }
          : row.ai_findings,
        validation_findings: [],
      } as PaymentItemRow;
    });

    setItems(sanitizedItems);
    setItemsLoading(false);
    setItemsLoadIssue(null);

    setObs(o ?? []);
    setAiVersions((vs ?? []) as unknown as AiVersionRow[]);
    setGroups(gs ?? []);
    const invList = (inv ?? []) as Array<Omit<InvoiceRow, "upload_token">>;
    let invWithTokens: InvoiceRow[] = invList.map((r) => ({ ...r, upload_token: "" } as InvoiceRow));
    if (invList.length > 0) {
      const { data: tokRows } = await supabase.rpc("get_invoice_upload_tokens", {
        p_invoice_ids: invList.map((r) => r.id),
      });
      const tokMap = new Map<string, string>(
        ((tokRows ?? []) as Array<{ invoice_id: string; upload_token: string }>).map((t) => [
          t.invoice_id,
          t.upload_token,
        ]),
      );
      invWithTokens = invList.map((r) => ({ ...r, upload_token: tokMap.get(r.id) ?? "" } as InvoiceRow));
    }
    setInvoices(invWithTokens);
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
        ? supabase.from("rules").select("id,name,rule_text,description,calculation_type,exclusion_reason,allows_authorized_exception,severity").in("id", ids).abortSignal(ac.signal)
        : Promise.resolve({ data: [] as RuleLite[] }),
      names.length
        ? supabase.from("rules").select("id,name,rule_text,description,calculation_type,exclusion_reason,allows_authorized_exception,severity").in("name", names).abortSignal(ac.signal)
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

  // Wrapper com lock + trailing single-flight (ver loadInFlightRef acima).
  const loadGuarded = useCallback(async () => {
    if (loadInFlightRef.current) {
      loadPendingRef.current = true;
      return loadInFlightPromiseRef.current ?? Promise.resolve();
    }
    loadInFlightRef.current = true;
    const promise = (async () => {
      do {
        loadPendingRef.current = false;
        try {
          await load();
        } catch (e) {
          const aborted = e instanceof DOMException && e.name === "AbortError";
          if (!aborted) {
            console.error("[PaymentDetail] Falha no recarregamento", e);
            setItemsLoadIssue("Falha temporária ao atualizar dados. Recarregando…");
          }
        }
        if (loadPendingRef.current) await new Promise((resolve) => setTimeout(resolve, 800));
      } while (loadPendingRef.current);
    })();
    loadInFlightPromiseRef.current = promise;
    try {
      await promise;
    } finally {
      loadInFlightRef.current = false;
      loadInFlightPromiseRef.current = null;
    }
  }, [load]);

  useEffect(() => {
    loadGuarded();
    return () => {
      loadTokenRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [loadGuarded]);

  /**
   * Realtime: assina mudanças em payment_observations e invoice_questions
   * filtradas pelo payment atual. Em qualquer evento (INSERT/UPDATE/DELETE),
   * recarrega — é simples, evita merge manual e é barato porque o usuário
   * está olhando ativamente esta tela.
   */
  useEffect(() => {
    if (!id) return;
    // Debounce coalesces bursts of realtime events (e.g., aplicar em lote do
    // Zeev, análise por IA que faz DELETE+INSERT de payment_items). Usamos
    // duas janelas: uma curta (400 ms) para mudanças "leves" — payment,
    // observações, perguntas, atribuições — e uma longa (1500 ms) para
    // payment_items, que costuma vir em rajadas maiores. Enquanto qualquer
    // evento continuar chegando dentro de um intervalo máximo (`MAX_WAIT`),
    // seguramos o refetch para evitar redesenho a cada linha; passado o
    // MAX_WAIT desde o primeiro evento, forçamos um refetch mesmo que os
    // eventos ainda estejam vindo.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let firstEventAt: number | null = null;
    const MAX_WAIT_MS = 3000;
    const flush = () => {
      debounceTimer = null;
      firstEventAt = null;
      loadGuarded();
    };
    const scheduleReload = (delay = 400) => {
      const now = Date.now();
      if (firstEventAt == null) firstEventAt = now;
      const elapsed = now - firstEventAt;
      if (elapsed >= MAX_WAIT_MS) {
        if (debounceTimer) clearTimeout(debounceTimer);
        flush();
        return;
      }
      const wait = Math.min(delay, MAX_WAIT_MS - elapsed);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, wait);
    };
    const scheduleReloadFast = () => scheduleReload(400);
    const scheduleReloadItems = () => scheduleReload(1500);

    const channel = supabase
      .channel(`payment-detail:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_observations", filter: `payment_id=eq.${id}` },
        scheduleReloadFast,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoice_questions", filter: `payment_id=eq.${id}` },
        scheduleReloadFast,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_assignments", filter: `payment_id=eq.${id}` },
        scheduleReloadFast,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `id=eq.${id}` },
        scheduleReloadFast,
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
      // payment_items: rajadas grandes (aplicar em lote / análise IA). Janela
      // maior evita redesenho da grid a cada linha.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_items", filter: `payment_id=eq.${id}` },
        scheduleReloadItems,
      )
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [id, loadGuarded]);


  /**
   * Polling de segurança (backup do Realtime): a cada 20s busca apenas a
   * linha `payments` e mescla no estado. Garante que o badge de status e o
   * resumo da IA reflitam o banco mesmo quando o canal Realtime perde
   * eventos (reconexão silenciosa, throttle, UPDATE via SQL direto, etc.).
   * Roda só com a aba visível e dispara imediatamente ao voltar ao foco.
   */
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const { data } = await supabase
        .from("payments")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (cancelled || !data) return;
      setPayment((prev) => (prev ? { ...prev, ...(data as PaymentRow) } : (data as PaymentRow)));
    };
    const interval = setInterval(tick, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id]);

  return {
    // state
    payment,
    paymentMissing,
    items,
    itemsLoading,
    itemsLoadIssue,
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
    load: loadGuarded,
  };
}