import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { SafeCard } from "@/components/ui/SafeCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, formatCompetence, PAYMENT_STATUS_LABELS, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, type PaymentStatus, type PaymentType, type PaymentKind } from "@/lib/status";
import { Search, X, User, Tag, Clock, Building2, AlertTriangle, UserCheck, RefreshCcw, Sparkles, Archive, Inbox, MessageCircleQuestion, ChevronDown } from "lucide-react";
import { usePaymentRisk } from "@/hooks/usePaymentRisk";
import { RiskBadge } from "@/components/payment-detail/RiskBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { evaluateSla, type SlaSetting, type CompanySlaOverride } from "@/lib/sla";
import { TERMINAL_STATUSES } from "@/lib/paymentFlow";
import { toast } from "sonner";

interface Row {
  id: string;
  reference: string;
  status: PaymentStatus;
  total_amount: number | string;
  items_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  competence_month: string | null;
  competence_months: string[] | null;
  payment_due_date: string | null;
  payment_type: PaymentType | null;
  payment_kind: PaymentKind | null;
  processing_diagnostics?: any;
  processing_timeout_occurred?: boolean;
}

interface StatusEntry { status: PaymentStatus; changed_at: string }

/**
 * Status que NÃO consomem SLA, mesmo não sendo terminais.
 * Inclui terminais (lancado/pago/rejeitado/cancelado) + nf_conciliada
 * (aguarda apenas o analista marcar como lançado, sem prazo apertado).
 *
 * Conceitos separados de TERMINAL_STATUSES:
 *  - TERMINAL: arquivar / esconder das filas ativas.
 *  - SLA_EXEMPT: não calcular nível de atraso.
 */
const SLA_EXEMPT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  ...TERMINAL_STATUSES,
  "nf_conciliada",
]);

const formatDuration = (ms: number) => {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const delayLevel = (status: PaymentStatus, ms: number): "none" | "leve" | "critico" => {
  if (SLA_EXEMPT_STATUSES.has(status)) return "none";
  const days = ms / 86400000;
  if (days >= 7) return "critico";
  if (days >= 3) return "leve";
  return "none";
};

type OwnerGroup = "all" | "analista" | "validador" | "diretor";

const STATUSES_BY_OWNER: Record<Exclude<OwnerGroup, "all">, PaymentStatus[]> = {
  analista: ["rascunho", "em_analise_ia", "revisao_analista", "devolvido_analista", "aprovado_em_revisao", "lancado"],
  validador: ["aguardando_validacao"],
  diretor: ["aguardando_aprovacao"],
};

const OWNER_LABELS: Record<Exclude<OwnerGroup, "all">, string> = {
  analista: "Com analista",
  validador: "Com validador",
  diretor: "Com diretor",
};

/** Componente isolado para calcular e exibir o badge de risco em uma linha de listagem.
 *  Mantido como subcomponente para que cada linha tenha seu próprio hook (Rules of Hooks). */
const PaymentRiskBadgeInline = ({ paymentId, compact = false }: { paymentId: string; compact?: boolean }) => {
  const risk = usePaymentRisk(paymentId);
  if (!risk || risk.score <= 0) return null;
  return (
    <RiskBadge
      level={risk.level}
      score={risk.score}
      financialData={risk}
      showLabel={!compact}
      className={compact ? "scale-75 origin-left" : "scale-90 origin-left"}
    />
  );
};

const Payments = () => {
  const { roles, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [companyFilter, setCompanyFilter] = useState<CompanyOption | null>(null);
  const [doctorFilter, setDoctorFilter] = useState<{ id: string; full_name: string; crm: string | null; crm_uf: string | null } | null>(null);
  const [paymentIdsForCompany, setPaymentIdsForCompany] = useState<Set<string> | null>(null);
  const [paymentIdsForDoctor, setPaymentIdsForDoctor] = useState<Set<string> | null>(null);
  // Busca cruzada em itens (médico, atendimento, descrição, especialidade,
  // procedimento, CC). Acionada com 3+ chars e debounced.
  const [paymentIdsForQuery, setPaymentIdsForQuery] = useState<Set<string> | null>(null);
  const [searching, setSearching] = useState(false);
  const [analysts, setAnalysts] = useState<Record<string, string>>({});
  const [companiesPerPayment, setCompaniesPerPayment] = useState<Record<string, number>>({});
  const [statusEnteredAt, setStatusEnteredAt] = useState<Record<string, string>>({});
  const [analystFilter, setAnalystFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [competenceFilter, setCompetenceFilter] = useState<string>("all");
  const [delayedOnly, setDelayedOnly] = useState(searchParams.get("delayed") === "1");
  // Filtros vindos do Dashboard ("seus pagamentos por papel"). Quando ativos
  // restringem por grupo de status + (opcional) só os meus.
  const [ownerGroup, setOwnerGroup] = useState<OwnerGroup>(() => {
    const s = searchParams.get("status");
    return s === "analista" || s === "validador" || s === "diretor" ? s : "all";
  });
  const [onlyMine, setOnlyMine] = useState(() => searchParams.get("owner") === "me");

  // Sincroniza filtros simples vindos de outras telas (ex: Dashboard)
  useEffect(() => {
    setDelayedOnly(searchParams.get("delayed") === "1");
    setOpenQuestionOnly(searchParams.get("open_questions") === "1");
    const st = searchParams.get("status");
    if (st === "analista" || st === "validador" || st === "diretor") {
      setOwnerGroup(st);
    } else if (st) {
      setStatusFilter(st);
    }
    setOnlyMine(searchParams.get("owner") === "me");
  }, [searchParams]);

  const [view, setView] = useState<"lista" | "kanban">("lista");
  const [sortBy, setSortBy] = useState<"created" | "elapsed" | "status">("created");
  // Arquivados: lotes em estado terminal (lancado/pago/rejeitado/cancelado).
  // Default = "ativos" — esconde finalizados das filas de trabalho diárias.
  // Pode ser ligado via querystring (?archived=1) ou pelo toggle na UI.
  const [archivedView, setArchivedView] = useState<boolean>(searchParams.get("archived") === "1");
  const [slaSettings, setSlaSettings] = useState<Record<string, SlaSetting>>({});
  const [companyOverrides, setCompanyOverrides] = useState<Record<string, CompanySlaOverride>>({});
  const [companyByPayment, setCompanyByPayment] = useState<Record<string, string | null>>({});
  // Filtros avançados (não dependem de "criado por")
  const [divergenceFilter, setDivergenceFilter] = useState<"all" | "with" | "without">("all");
  const [questionedFilter, setQuestionedFilter] = useState<"all" | "with" | "without">("all");
  const [paymentIdsWithDivergence, setPaymentIdsWithDivergence] = useState<Set<string>>(new Set());
  const [paymentIdsWithQuestions, setPaymentIdsWithQuestions] = useState<Set<string>>(new Set());
  // Contagem de perguntas internas abertas por lote (badge nas listagens).
  const [openQuestionCount, setOpenQuestionCount] = useState<Record<string, number>>({});
  const [openQuestionOnly, setOpenQuestionOnly] = useState(() => searchParams.get("open_questions") === "1");
  // Fila de reprocessamento: ids selecionados + estado de execução em lote.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState<{ done: number; total: number } | null>(null);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runReanalysis = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setReprocessing(true);
    setReprocessProgress({ done: 0, total: ids.length });
    let ok = 0; let fail = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        const { error } = await supabase.functions.invoke("analyze-payment", { body: { payment_id: ids[i] } });
        if (error) throw error;
        ok++;
      } catch (e) {
        console.error("reanalyze failed", ids[i], e);
        fail++;
      }
      setReprocessProgress({ done: i + 1, total: ids.length });
    }
    setReprocessing(false);
    setReprocessProgress(null);
    setSelected(new Set());
    toast.success(`Reanálise concluída: ${ok} ok${fail ? `, ${fail} com falha` : ""}`);
  };

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("payments")
      .select("id,reference,status,total_amount,items_count,created_at,updated_at,created_by,competence_month,competence_months,payment_due_date,payment_type,payment_kind,processing_diagnostics,processing_timeout_occurred")
      .order("created_at", { ascending: false });
    
    const list = (data ?? []) as Row[];
    setRows(list);
    const ids = list.map((r) => r.id);
    const userIds = Array.from(new Set(list.map((r) => r.created_by).filter(Boolean))) as string[];
    // Profiles dos analistas
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id,full_name,email").in("id", userIds);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => { map[p.id] = p.full_name || p.email || "—"; });
      setAnalysts(map);
    }
    if (ids.length) {
      // Empresas distintas por lote
      const { data: groups } = await supabase
        .from("payment_company_groups")
        .select("payment_id,company_name")
        .in("payment_id", ids);
      const cmap: Record<string, Set<string>> = {};
      (groups ?? []).forEach((g: any) => {
        cmap[g.payment_id] = cmap[g.payment_id] ?? new Set();
        cmap[g.payment_id].add(g.company_name || "");
      });
      const counts: Record<string, number> = {};
      Object.entries(cmap).forEach(([k, v]) => { counts[k] = v.size; });
      setCompaniesPerPayment(counts);

      // Histórico: pega entrada mais recente por pagamento
      const { data: hist } = await supabase
        .from("payment_status_history")
        .select("payment_id,status_to,changed_at")
        .in("payment_id", ids)
        .order("changed_at", { ascending: false });
      const seen: Record<string, string> = {};
      (hist ?? []).forEach((h: any) => {
        if (!seen[h.payment_id]) seen[h.payment_id] = h.changed_at;
      });
      setStatusEnteredAt(seen);

      // Empresa principal por pagamento (1ª se múltiplas)
      const cByP: Record<string, string | null> = {};
      (groups ?? []).forEach((g: any) => { if (!cByP[g.payment_id]) cByP[g.payment_id] = null; });
      const { data: groupsWithIds } = await supabase
        .from("payment_company_groups").select("payment_id,company_id").in("payment_id", ids);
      (groupsWithIds ?? []).forEach((g: any) => {
        if (g.company_id && !cByP[g.payment_id]) cByP[g.payment_id] = g.company_id;
      });
      setCompanyByPayment(cByP);

      // Carrega SLAs e overrides relevantes em paralelo
      const compIds = Array.from(new Set(Object.values(cByP).filter(Boolean))) as string[];
      const [{ data: slas }, { data: ovs }] = await Promise.all([
        supabase.from("sla_settings").select("*").eq("active", true),
        compIds.length
          ? supabase.from("company_sla_overrides").select("*").in("company_id", compIds)
          : Promise.resolve({ data: [] as any[] } as any),
      ]);
      const sMap: Record<string, SlaSetting> = {};
      (slas ?? []).forEach((s: any) => { sMap[s.status] = s; });
      setSlaSettings(sMap);
      const oMap: Record<string, CompanySlaOverride> = {};
      (ovs ?? []).forEach((o: any) => { oMap[o.company_id] = o; });
      setCompanyOverrides(oMap);
    }
  }, []);

  const loadAncillaryData = useCallback(async () => {
    const [{ data: divItems }, { data: questPays }, { data: iq }, { data: openQs }] = await Promise.all([
      supabase.from("payment_items").select("payment_id").in("ai_status", ["alerta", "reprovado"]).limit(5000),
      supabase.from("payments").select("id").eq("status", "nf_questionada").limit(2000),
      supabase.from("invoice_questions").select("payment_id").limit(5000),
      supabase.from("payment_observations").select("payment_id").eq("is_question", true).is("resolved_at", null).limit(5000),
    ]);
    const div = new Set<string>();
    (divItems ?? []).forEach((r: any) => r.payment_id && div.add(r.payment_id));
    const quest = new Set<string>();
    (questPays ?? []).forEach((r: any) => r.id && quest.add(r.id));
    (iq ?? []).forEach((r: any) => r.payment_id && quest.add(r.payment_id));
    const counts: Record<string, number> = {};
    (openQs ?? []).forEach((r: any) => {
      if (!r.payment_id) return;
      counts[r.payment_id] = (counts[r.payment_id] ?? 0) + 1;
    });
    setOpenQuestionCount(counts);
    setPaymentIdsWithDivergence(div);
    setPaymentIdsWithQuestions(quest);
  }, []);

  useEffect(() => {
    document.title = "Pagamentos | MedPay Approval";
    load();
  }, [load]);

  useEffect(() => {
    loadAncillaryData();
  }, [loadAncillaryData]);

  useEffect(() => {
    const channel = supabase
      .channel("payments-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => { load(); loadAncillaryData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_company_groups" }, () => { load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_observations" }, () => { loadAncillaryData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_questions" }, () => { loadAncillaryData(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, loadAncillaryData]);

  // Quando uma empresa é escolhida, busca os payment_ids que possuem itens dela.
  useEffect(() => {
    let cancelled = false;
    if (!companyFilter) { setPaymentIdsForCompany(null); return; }
    supabase
      .from("payment_items")
      .select("payment_id")
      .eq("company_id", companyFilter.id)
      .then(({ data }) => {
        if (cancelled) return;
        const ids = new Set<string>((data ?? []).map((r: any) => r.payment_id).filter(Boolean));
        setPaymentIdsForCompany(ids);
      });
    return () => { cancelled = true; };
  }, [companyFilter]);

  // Busca cruzada em payment_items quando o termo for ≥3 chars.
  useEffect(() => {
    let cancelled = false;
    const term = q.trim();
    if (term.length < 3) { setPaymentIdsForQuery(null); setSearching(false); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      const like = `%${term}%`;
      // .or() em payment_items + busca em payments (pra cobrir CC e specialties).
      const [itemsRes, paysRes, obsRes] = await Promise.all([
        supabase
          .from("payment_items")
          .select("payment_id")
          .or(
            [
              `doctor_name.ilike.${like}`,
              `attendance_number.ilike.${like}`,
              `description.ilike.${like}`,
              `procedure_code.ilike.${like}`,
              `procedure_name.ilike.${like}`,
              `cost_center_code.ilike.${like}`,
              `company_name.ilike.${like}`,
            ].join(","),
          )
          .limit(2000),
        supabase
          .from("payments")
          .select("id")
          .or(`cost_center_code.ilike.${like},specialties.cs.{${term}},sectors.cs.{${term}},reference.ilike.${like}`)
          .limit(500),
        supabase
          .from("payment_observations")
          .select("payment_id")
          .ilike("message", like)
          .eq("is_question", true)
          .is("resolved_at", null)
          .limit(500),
      ]);
      if (cancelled) return;
      const ids = new Set<string>();
      (itemsRes.data ?? []).forEach((r: any) => r.payment_id && ids.add(r.payment_id));
      (paysRes.data ?? []).forEach((r: any) => r.id && ids.add(r.id));
      (obsRes.data ?? []).forEach((r: any) => r.payment_id && ids.add(r.payment_id));

      // Se o termo for especificamente "questionamento" ou "pergunta", incluímos todos que têm perguntas abertas
      const lowerTerm = term.toLowerCase();
      if (lowerTerm.includes("question") || lowerTerm.includes("pergunta")) {
        Object.keys(openQuestionCount).forEach(pid => ids.add(pid));
      }

      setPaymentIdsForQuery(ids);
      setSearching(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, openQuestionCount]);

  const competenceOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      (r.competence_months?.length ? r.competence_months : [r.competence_month]).forEach((c) => c && set.add(c.slice(0, 7)));
    });
    return Array.from(set).sort().reverse();
  }, [rows]);

  const now = Date.now();

  // Total de arquivados (terminais) — independente dos demais filtros, usado
  // pelo toggle e mensagem de observabilidade ("X lotes arquivados").
  const archivedCount = useMemo(
    () => rows.filter((r) => TERMINAL_STATUSES.has(r.status)).length,
    [rows],
  );
  const activeCount = rows.length - archivedCount;

  const filtered = useMemo(() => rows.filter((r) => {
    // Arquivamento: por default escondemos lotes em estado terminal das
    // listagens de trabalho. Toggle "Ver arquivados" inverte o filtro.
    const isTerminal = TERMINAL_STATUSES.has(r.status);
    if (archivedView ? !isTerminal : isTerminal) return false;
    const term = q.trim().toLowerCase();
    if (term) {
      const refMatches = r.reference.toLowerCase().includes(term);
      // Termo curto (<3): só filtra pela referência (busca cruzada não rodou).
      if (term.length < 3) {
        if (!refMatches) return false;
      } else {
        // Termo longo: união entre referência local e payment_ids do cruzamento.
        const crossMatches = paymentIdsForQuery?.has(r.id) ?? false;
        if (!refMatches && !crossMatches) return false;
      }
    }
    if (companyFilter) {
      if (!paymentIdsForCompany) return false;
      if (!paymentIdsForCompany.has(r.id)) return false;
    }
    if (analystFilter !== "all" && r.created_by !== analystFilter) return false;
    if (typeFilter !== "all" && r.payment_type !== typeFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (ownerGroup !== "all") {
      const allowed = STATUSES_BY_OWNER[ownerGroup];
      if (!allowed.includes(r.status)) return false;
    }
    // Validação é fila coletiva: qualquer validador vê todos os lotes em aguardando_validacao.
    if (onlyMine) {
      // Visão coletiva por perfil: "Meus" = lotes na fila do meu papel.
      // Para analista, isso significa todos os lotes em status do analista
      // (qualquer analista pode assumir). Validador/diretor idem.
      const myRoleStatuses: PaymentStatus[] = [];
      if (roles.includes("analista") || roles.includes("admin")) myRoleStatuses.push(...STATUSES_BY_OWNER.analista);
      if (roles.includes("validador") || roles.includes("admin")) myRoleStatuses.push(...STATUSES_BY_OWNER.validador);
      if (roles.includes("diretor") || roles.includes("admin")) myRoleStatuses.push(...STATUSES_BY_OWNER.diretor);
      if (myRoleStatuses.length && !myRoleStatuses.includes(r.status)) return false;
    }
    if (competenceFilter !== "all") {
      const months = (r.competence_months?.length ? r.competence_months : [r.competence_month]).filter(Boolean) as string[];
      if (!months.some((m) => m.startsWith(competenceFilter))) return false;
    }
    if (delayedOnly) {
      const since = statusEnteredAt[r.id] ?? r.updated_at ?? r.created_at;
      const lvl = delayLevel(r.status, now - new Date(since).getTime());
      if (lvl === "none") return false;
    }
    if (divergenceFilter !== "all") {
      const has = paymentIdsWithDivergence.has(r.id);
      if (divergenceFilter === "with" && !has) return false;
      if (divergenceFilter === "without" && has) return false;
    }
    if (questionedFilter !== "all") {
      const has = paymentIdsWithQuestions.has(r.id);
      if (questionedFilter === "with" && !has) return false;
      if (questionedFilter === "without" && has) return false;
    }
    if (openQuestionOnly && !(openQuestionCount[r.id] > 0)) return false;
    return true;
  }), [rows, archivedView, q, companyFilter, paymentIdsForCompany, paymentIdsForQuery, analystFilter, typeFilter, statusFilter, ownerGroup, onlyMine, roles, competenceFilter, delayedOnly, statusEnteredAt, now, divergenceFilter, questionedFilter, paymentIdsWithDivergence, paymentIdsWithQuestions, openQuestionOnly, openQuestionCount]);
  const isAnalista = roles.includes("analista") || roles.includes("admin");

  const analystOptions = useMemo(() => {
    const ids = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean))) as string[];
    return ids.map((id) => ({ id, name: analysts[id] ?? "—" })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, analysts]);

  const elapsedFor = (p: Row) => now - new Date(statusEnteredAt[p.id] ?? p.updated_at ?? p.created_at).getTime();

  const slaFor = (p: Row) => {
    const enteredAt = new Date(statusEnteredAt[p.id] ?? p.updated_at ?? p.created_at);
    const compId = companyByPayment[p.id] ?? null;
    const ov = compId ? companyOverrides[compId] ?? null : null;
    const setting = slaSettings[p.status] ?? null;
    return evaluateSla({
      status: p.status,
      enteredAt,
      override: ov,
      defaultSettings: setting,
      competenceMonth: p.competence_month ?? p.competence_months?.[0] ?? null,
      now: new Date(now),
    });
  };

  const sortedList = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "elapsed") arr.sort((a, b) => elapsedFor(b) - elapsedFor(a));
    else if (sortBy === "status") arr.sort((a, b) => a.status.localeCompare(b.status));
    else arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return arr;
  }, [filtered, sortBy, statusEnteredAt, now]);

  // Ordem das colunas do kanban (segue fluxo lógico)
  const KANBAN_ORDER: PaymentStatus[] = [
    "rascunho", "em_analise_ia", "revisao_analista", "aguardando_validacao",
    "devolvido_analista", "aguardando_aprovacao", "aprovado_em_revisao",
    "aprovado", "aprovado_com_ressalva", "pedido_nf_enviado", "nf_questionada",
    "nf_recebida", "nf_conciliada", "nf_divergente", "lancado", "pago", "arquivado", "rejeitado", "cancelado",
  ];

  const kanbanGroups = useMemo(() => {
    const groups: Record<string, Row[]> = {};
    for (const p of filtered) {
      (groups[p.status] = groups[p.status] ?? []).push(p);
    }
    Object.values(groups).forEach((g) => g.sort((a, b) => elapsedFor(b) - elapsedFor(a)));
    return KANBAN_ORDER.filter((s) => groups[s]?.length).map((s) => ({ status: s, items: groups[s] }));
  }, [filtered, statusEnteredAt, now]);

  const renderCard = (p: Row, compact = false) => {
    const elapsedMs = elapsedFor(p);
    const lvl = delayLevel(p.status, elapsedMs);
    const sla = slaFor(p);
    const slaLvl = sla?.level ?? "ok";
    // Combina: vencido > critico > preventivo > leve
    const finalLvl: "none" | "leve" | "critico" =
      slaLvl === "vencido" ? "critico" : slaLvl === "preventivo" ? "leve" : lvl;
    const companies = companiesPerPayment[p.id] ?? 0;
    const analystName = p.created_by ? analysts[p.created_by] ?? "—" : "—";
    
    if (compact) {
      const slaBadge = (
        <span className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
          finalLvl === "critico" && "bg-destructive-soft text-destructive",
          finalLvl === "leve" && "bg-warning-soft text-warning-foreground",
          finalLvl === "none" && "text-muted-foreground",
        )}>
          <Clock className="h-2.5 w-2.5 shrink-0" />{" "}
          <span className="truncate">
            {sla?.level === "vencido" ? "vencido" : sla?.level === "preventivo" ? "perto do prazo" : formatDuration(elapsedMs)}
          </span>
        </span>
      );

      return (
        <Link
          key={p.id}
          to={`/pagamentos/${p.id}`}
          className="block min-w-0"
        >
          <SafeCard
            headerColor={
              finalLvl === "critico" ? "hsl(var(--destructive))" : 
              finalLvl === "leve" ? "hsl(var(--warning))" : 
              undefined
            }
            badge={openQuestionCount[p.id] > 0 ? (
              <span
                title={`${openQuestionCount[p.id]} questionamento(s) aguardando resposta`}
                className="inline-flex items-center gap-0.5 rounded-bl-md border-l border-b border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground shrink-0 shadow-sm"
              >
                <AlertTriangle className="h-2 w-2" />
              </span>
            ) : undefined}
            className={cn(
              "hover:bg-muted/40 transition-colors space-y-2 p-0", // p-0 because SafeCard has padding 3
              finalLvl === "critico" && "border-destructive/40 ring-1 ring-destructive/20",
            )}
          >
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex flex-col gap-1 min-w-0">
                <p className="font-semibold text-xs break-words">{p.reference}</p>
                <PaymentRiskBadgeInline paymentId={p.id} compact />
              </div>
              
              <div className="flex items-center justify-between text-[10px] text-muted-foreground gap-2">
                <span className="truncate flex-1">{analystName}</span>
                <span className="tabular-nums font-medium text-foreground shrink-0">{formatCurrency(p.total_amount)}</span>
              </div>
              
              <div className="flex items-center justify-between text-[10px] gap-2 pt-1 border-t border-border/40">
                <span className="text-muted-foreground shrink-0">{p.items_count} itens · {companies || "—"} PJ</span>
                {slaBadge}
              </div>
            </div>
          </SafeCard>
        </Link>
      );
    }
    const isSelected = selected.has(p.id);
    return (
      <div key={p.id} className={cn("flex items-start gap-3 px-6 py-4 hover:bg-muted/40 transition-colors", isSelected && "bg-primary/5")}>
        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleSelect(p.id)}
            aria-label={`Selecionar ${p.reference} para reprocessamento`}
          />
        </div>
        <Link to={`/pagamentos/${p.id}`} className="flex items-start justify-between gap-4 flex-1 min-w-0">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-medium text-sm truncate">{p.reference}</p>
            <PaymentRiskBadgeInline paymentId={p.id} />

            {openQuestionCount[p.id] > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlertTriangle className="h-3 w-3" /> Questionamento ({openQuestionCount[p.id]})
                  </span>
                </TooltipTrigger>
                <TooltipContent>{openQuestionCount[p.id]} questionamento{openQuestionCount[p.id] > 1 ? "s" : ""} aguardando resposta</TooltipContent>
              </Tooltip>
            )}

            {p.processing_timeout_occurred && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold border border-destructive/20 cursor-help">
                    <Clock className="h-3 w-3" />
                    Limite IA
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[280px] space-y-2 text-xs">
                  <p className="font-bold flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-destructive" /> Diagnóstico de Performance
                  </p>
                  <p>O lote original excedeu o tempo limite de análise da IA.</p>
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/20 mt-1">
                    <div>
                      <p className="text-muted-foreground">Itens IA:</p>
                      <p className="font-medium text-foreground">{p.processing_diagnostics?.ai_processed_items || "—"} / {p.processing_diagnostics?.total_items || p.items_count}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Chunk Size:</p>
                      <p className="font-medium text-foreground">{p.processing_diagnostics?.chunk_size || 50} itens</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Tempo Total:</p>
                      <p className="font-medium text-foreground">{( (p.processing_diagnostics?.execution_time_ms || 0) / 1000 ).toFixed(1)}s</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Status:</p>
                      <p className="font-medium text-destructive">Timeout</p>
                    </div>
                  </div>
                  <p className="italic text-[10px] pt-1">O motor determinístico concluiu 100% dos cálculos; apenas as justificativas de IA foram limitadas aos itens mais críticos.</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
              <User className="h-3 w-3" /> {analystName}
            </Badge>
            {p.payment_type && (
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                <Tag className="h-3 w-3" /> {PAYMENT_TYPE_LABELS[p.payment_type]}
              </Badge>
            )}
            {companies > 0 && (
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                <Building2 className="h-3 w-3" /> {companies} empresa{companies > 1 ? "s" : ""}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn(
                "gap-1 font-normal",
                finalLvl === "critico" && "bg-destructive-soft text-destructive border-destructive/30",
                finalLvl === "leve" && "bg-warning-soft text-warning-foreground border-warning/30",
                finalLvl === "none" && "text-muted-foreground",
              )}
            >
              <Clock className="h-3 w-3" /> {formatDuration(elapsedMs)} no status
            </Badge>
            {sla && (
              <Badge
                variant="outline"
                title={`${sla.reason} · vence ${sla.dueAt.toLocaleDateString("pt-BR")} · ${sla.source === "empresa" ? "regra da empresa" : "SLA padrão"}`}
                className={cn(
                  "gap-1 font-normal",
                  sla.level === "vencido" && "bg-destructive-soft text-destructive border-destructive/30",
                  sla.level === "preventivo" && "bg-warning-soft text-warning-foreground border-warning/30",
                  sla.level === "ok" && "text-muted-foreground",
                )}
              >
                {sla.level === "vencido" ? "Vencido" : sla.level === "preventivo" ? "Perto do prazo" : `Vence ${sla.dueAt.toLocaleDateString("pt-BR")}`}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Competência <span className="font-medium text-foreground capitalize">{formatCompetence(p.competence_months?.length ? p.competence_months : p.competence_month)}</span>
            {" · "}{p.items_count} itens · {formatCurrency(p.total_amount)}
            {p.payment_kind && ` · ${PAYMENT_KIND_LABELS[p.payment_kind]}`}
            {" · criado em "}{formatDate(p.created_at)}
          </p>
        </div>
        <StatusBadge status={p.status} className={cn(finalLvl === "critico" && "ring-2 ring-destructive/40")} />
        </Link>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full w-full max-w-[100vw] overflow-x-hidden">
      <PageHeader
        title="Pagamentos"
        description="Todos os lotes de pagamento e seu status no fluxo."
      />
      <div className="p-4 md:p-8 w-full mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar referência, PJ, médico, atendimento, CC, especialidade…"
              className="pl-9"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                buscando…
              </span>
            )}
          </div>
          <CompanyCombobox
            value={companyFilter}
            onChange={setCompanyFilter}
            placeholder="Filtrar por empresa (CNPJ)…"
            className="min-w-[260px]"
          />
          <Select value={analystFilter} onValueChange={setAnalystFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Analista" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos analistas</SelectItem>
              {analystOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos tipos</SelectItem>
              {Object.entries(PAYMENT_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={competenceFilter} onValueChange={setCompetenceFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Competência" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas competências</SelectItem>
              {competenceOptions.map((c) => <SelectItem key={c} value={c}>{formatCompetence(`${c}-01`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={ownerGroup} onValueChange={(v) => {
            const ov = v as OwnerGroup;
            setOwnerGroup(ov);
            const next = new URLSearchParams(searchParams);
            if (ov === "all") next.delete("status"); else next.set("status", ov);
            setSearchParams(next, { replace: true });
          }}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Papel/fila" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer fila</SelectItem>
              <SelectItem value="analista">Com analista</SelectItem>
              <SelectItem value="validador">Com validador</SelectItem>
              <SelectItem value="diretor">Com diretor</SelectItem>
            </SelectContent>
          </Select>
          <Select value={divergenceFilter} onValueChange={(v) => setDivergenceFilter(v as typeof divergenceFilter)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Divergência" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Divergência: todas</SelectItem>
              <SelectItem value="with">Com divergência IA×regra</SelectItem>
              <SelectItem value="without">Sem divergência</SelectItem>
            </SelectContent>
          </Select>
          <Select value={questionedFilter} onValueChange={(v) => setQuestionedFilter(v as typeof questionedFilter)}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="NF questionada" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">NF: todas</SelectItem>
              <SelectItem value="with">NF questionada</SelectItem>
              <SelectItem value="without">Sem questionamento</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={delayedOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setDelayedOnly((v) => !v)}
          >
            <AlertTriangle className="h-4 w-4 mr-1" /> Atrasados
          </Button>
          <Button
            variant={openQuestionOnly ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !openQuestionOnly;
              setOpenQuestionOnly(next);
              const sp = new URLSearchParams(searchParams);
              if (next) sp.set("open_questions", "1"); else sp.delete("open_questions");
              setSearchParams(sp, { replace: true });
            }}
            title="Mostrar apenas lotes com perguntas internas aguardando resposta"
          >
            <MessageCircleQuestion className="h-4 w-4 mr-1" /> Com questionamento aberto
          </Button>
          {ownerGroup !== "all" && (
            <Badge variant="outline" className="gap-1 h-8 px-2 bg-primary/10 border-primary/30 text-primary">
              <UserCheck className="h-3.5 w-3.5" /> {OWNER_LABELS[ownerGroup]}
              <button
                type="button"
                aria-label="Remover filtro de papel"
                className="ml-1 hover:opacity-70"
                onClick={() => {
                  setOwnerGroup("all");
                  const next = new URLSearchParams(searchParams);
                  next.delete("status");
                  setSearchParams(next, { replace: true });
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {onlyMine && (
            <Badge variant="outline" className="gap-1 h-8 px-2 bg-primary/10 border-primary/30 text-primary">
              <User className="h-3.5 w-3.5" /> Apenas meus
              <button
                type="button"
                aria-label="Remover filtro apenas meus"
                className="ml-1 hover:opacity-70"
                onClick={() => {
                  setOnlyMine(false);
                  const next = new URLSearchParams(searchParams);
                  next.delete("owner");
                  setSearchParams(next, { replace: true });
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {(companyFilter || analystFilter !== "all" || typeFilter !== "all" || statusFilter !== "all" || competenceFilter !== "all" || delayedOnly || ownerGroup !== "all" || onlyMine || divergenceFilter !== "all" || questionedFilter !== "all") && (
            <Button variant="ghost" size="sm" onClick={() => {
              setCompanyFilter(null);
              setAnalystFilter("all"); setTypeFilter("all"); setStatusFilter("all"); setCompetenceFilter("all"); setDelayedOnly(false);
              setOwnerGroup("all"); setOnlyMine(false);
              setDivergenceFilter("all"); setQuestionedFilter("all");
              setSearchParams(new URLSearchParams(), { replace: true });
            }}>
              <X className="h-4 w-4 mr-1" /> Limpar
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant={archivedView ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const next = !archivedView;
                setArchivedView(next);
                const sp = new URLSearchParams(searchParams);
                if (next) sp.set("archived", "1"); else sp.delete("archived");
                setSearchParams(sp, { replace: true });
              }}
              title={archivedView ? "Voltar para pagamentos ativos" : "Ver pagamentos arquivados (terminais)"}
            >
              {archivedView ? <Inbox className="h-4 w-4 mr-1" /> : <Archive className="h-4 w-4 mr-1" />}
              {archivedView ? "Ver ativos" : `Ver arquivados${archivedCount ? ` (${archivedCount})` : ""}`}
            </Button>
            {view === "lista" && (
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-[170px]"><SelectValue placeholder="Ordenar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="created">Mais recentes</SelectItem>
                  <SelectItem value="elapsed">Tempo parado</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
            )}
            <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "lista" | "kanban")} variant="outline" size="sm">
              <ToggleGroupItem value="lista">Lista</ToggleGroupItem>
              <ToggleGroupItem value="kanban">Kanban</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        {/* Barra de seleção em massa para reprocessamento de regras/mapeamentos */}
        {view === "lista" && sortedList.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2">
            <div className="flex items-center gap-3 text-xs">
              <Checkbox
                checked={
                  selected.size > 0 && sortedList.every((p) => selected.has(p.id))
                    ? true
                    : selected.size > 0
                    ? "indeterminate"
                    : false
                }
                onCheckedChange={(v) => {
                  if (v) setSelected(new Set(sortedList.map((p) => p.id)));
                  else setSelected(new Set());
                }}
                aria-label="Selecionar todos os pagamentos visíveis"
              />
              <span className="text-muted-foreground">
                {selected.size > 0
                  ? `${selected.size} selecionado${selected.size > 1 ? "s" : ""}`
                  : "Selecione pagamentos para reprocessar regras/mapeamentos"}
              </span>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  limpar
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {reprocessProgress && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {reprocessProgress.done}/{reprocessProgress.total}
                </span>
              )}
              <Button
                size="sm"
                disabled={selected.size === 0 || reprocessing}
                onClick={runReanalysis}
              >
                {reprocessing ? (
                  <RefreshCcw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {reprocessing ? "Reprocessando..." : "Reanalisar selecionados"}
              </Button>
            </div>
          </div>
        )}
        {/* Observabilidade: sinaliza claramente o modo arquivados ou se há
            arquivados escondidos no modo ativos (evita "sumiu meu lote!"). */}
        {archivedView ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-xs">
            <div className="flex items-center gap-2 text-primary">
              <Archive className="h-3.5 w-3.5" />
              <span>
                Mostrando <strong>{archivedCount}</strong> lote{archivedCount === 1 ? "" : "s"} arquivado{archivedCount === 1 ? "" : "s"} (arquivado, rejeitado, cancelado).
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setArchivedView(false);
                const sp = new URLSearchParams(searchParams);
                sp.delete("archived");
                setSearchParams(sp, { replace: true });
              }}
              className="text-primary font-medium hover:underline underline-offset-2"
            >
              Voltar para ativos
            </button>
          </div>
        ) : archivedCount > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Archive className="h-3.5 w-3.5" />
              <span>
                <strong>{archivedCount}</strong> lote{archivedCount === 1 ? "" : "s"} arquivado{archivedCount === 1 ? "" : "s"} fora desta lista · {activeCount} ativo{activeCount === 1 ? "" : "s"}.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setArchivedView(true);
                const sp = new URLSearchParams(searchParams);
                sp.set("archived", "1");
                setSearchParams(sp, { replace: true });
              }}
              className="font-medium hover:text-foreground hover:underline underline-offset-2"
            >
              Ver arquivados
            </button>
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <Card className="shadow-card">
            <CardContent className="p-0">
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">Nenhum pagamento encontrado.</div>
            </CardContent>
          </Card>
        ) : view === "lista" ? (
          <Card className="shadow-card">
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {sortedList.map((p) => renderCard(p))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {kanbanGroups.map((g) => (
              <div key={g.status} className="rounded-lg border bg-muted/20 flex flex-col min-h-[120px]">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-background/40 rounded-t-lg">
                  <StatusBadge status={g.status} />
                  <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{g.items.length}</span>
                </div>
                <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                  {g.items.map((p) => renderCard(p, true))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Payments;
