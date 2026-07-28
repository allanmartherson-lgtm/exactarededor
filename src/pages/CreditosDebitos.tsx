import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Trash2, Plus, Pencil, Scale, Receipt, ChevronDown, ChevronRight, Search, X, Filter, Download, FileSpreadsheet, FileText, Rocket, History } from "lucide-react";
import { toast } from "sonner";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { useActiveHospitalId, useHospital } from "@/contexts/HospitalContext";
import { buildReportData, generateCreditosDebitosPdf, generateCreditosDebitosXlsx, downloadBlob, type ReportFiltersSummary } from "@/lib/creditosDebitosReport";
import { logDeductionEvent, logDeductionEvents } from "@/lib/deductionAudit";
import { DeductionAuditDialog } from "@/components/DeductionAuditDialog";
import { CostCenterCombobox } from "@/components/CostCenterCombobox";

type Company = { id: string; name: string };
type Adjustment = {
  id: string;
  company_id: string;
  tipo: "credito" | "debito" | "glosa_parcelada" | "acordo";
  descricao: string;
  valor_total: number;
  parcelas_total: number;
  parcelas_pagas: number;
  data_inicio: string;
  ativo: boolean;
  origem: string | null;
  payment_model_ids: string[] | null;
  recorrente: boolean;
  data_fim: string | null;
  /** Filtro opcional: quando preenchido, o ajuste só é sugerido em lotes cujo
   *  cost_center_code resolva para este cost_center. Vazio = qualquer lote. */
  cost_center_id: string | null;
  cost_center?: { id: string; code_p12: string; level4: string | null; level5: string | null } | null;
  /** Estado local: código do CC exibido no combobox. Não persiste no banco —
   *  é resolvido para id em saveAdj. */
  _cc_code?: string | null;
  _company_name?: string;
};

type GlosaDebt = {
  id: string;
  company_id: string;
  doctor_id: string | null;
  doctor_name: string;
  doctor_crm: string | null;
  total_debt: number;
  parcelas_default: number | null;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  target_payment_id: string | null;
  origem_payment_id: string | null;
  _company_name?: string;
  _origem_cc?: string | null;
  _origem_track?: string | null;
};

type LoteOption = {
  id: string;
  label: string;
  liquido: number | null;
  status: string;
  competence: string | null;
  cost_center_code: string | null;
  payment_track: string | null;
  reference?: string | null;
};

type AdjApplication = {
  id: string;
  adjustment_id: string;
  payment_id: string;
  parcela_numero: number | null;
  valor_aplicado: number;
  status: string;
  source: string | null;
  applied_at: string | null;
  confirmed_at: string | null;
  reverted_at: string | null;
  reverted_reason: string | null;
};

const OPEN_PAYMENT_STATUSES = [
  "rascunho",
  "em_analise_ia",
  "revisao_analista",
  "aguardando_aprovacao",
  "pedido_nf_enviado",
  "revisao_pos_aprovacao",
] as const;

// Lotes que ainda podem receber glosa sem retrabalho de validação/aprovação.
// "revisao_analista" continua sendo etapa segura para receber glosa — só a
// partir de aguardando_aprovacao (validação) o warning faz sentido.
const GLOSA_SUGGESTABLE_STATUSES = new Set(["rascunho", "em_analise_ia", "revisao_analista"]);

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

type PeriodPreset = "all" | "current_month" | "last_month" | "last_90" | "current_year";

const periodRange = (p: PeriodPreset): { from: Date | null; to: Date | null } => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p) {
    case "current_month":
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59) };
    case "last_month":
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59) };
    case "last_90": {
      const from = new Date(); from.setDate(from.getDate() - 90);
      return { from, to: now };
    }
    case "current_year":
      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59) };
    default:
      return { from: null, to: null };
  }
};

const inRange = (iso: string | null | undefined, from: Date | null, to: Date | null) => {
  if (!from && !to) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
};

export default function CreditosDebitos() {
  const { list: paymentModels } = usePaymentTypes({ onlyActive: true, origin: "payment_model" });
  const activeHospitalId = useActiveHospitalId();
  const [searchParams, setSearchParams] = useSearchParams();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [glosaDebts, setGlosaDebts] = useState<GlosaDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjDialogOpen, setAdjDialogOpen] = useState(false);
  const [editingAdj, setEditingAdj] = useState<Partial<Adjustment> | null>(null);
  const [savingAdj, setSavingAdj] = useState(false);
  const [deletingAdjIds, setDeletingAdjIds] = useState<Set<string>>(new Set());
  const [editingGlosa, setEditingGlosa] = useState<GlosaDebt | null>(null);
  const [glosaParc, setGlosaParc] = useState<number>(1);
  const [busyGlosa, setBusyGlosa] = useState(false);
  const [openLotes, setOpenLotes] = useState<LoteOption[]>([]);
  const [loadingLotes, setLoadingLotes] = useState(false);
  const [lotePick, setLotePick] = useState<string>("");
  const [paymentLabels, setPaymentLabels] = useState<Record<string, string>>({});
  const [paymentStatuses, setPaymentStatuses] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [appsByAdj, setAppsByAdj] = useState<Record<string, AdjApplication[]>>({});
  // Aplicações de glosa por debt_id → usado para sinalizar "já aplicado neste lote"
  // e evitar reinvocar apply-company-deductions em (payment_id, company_id) já processados.
  const [glosaAppsByDebt, setGlosaAppsByDebt] = useState<Record<string, { payment_id: string; status: string; valor_aplicado: number; applied_at: string | null; postpone_reason?: string | null }[]>>({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Histórico de aplicações (auditoria)
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditFilter, setAuditFilter] = useState<{ company_id?: string; debt_id?: string; payment_id?: string }>({});
  const [auditTitle, setAuditTitle] = useState<string>("Histórico de aplicações");
  const openAudit = (opts: { company_id?: string; debt_id?: string; payment_id?: string; title?: string }) => {
    setAuditFilter({ company_id: opts.company_id, debt_id: opts.debt_id, payment_id: opts.payment_id });
    setAuditTitle(opts.title ?? "Histórico de aplicações");
    setAuditOpen(true);
  };

  // Confirmação em massa
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [massDialogPjId, setMassDialogPjId] = useState<string | null>(null);
  const [massParc, setMassParc] = useState<number>(1);
  const [massLotePick, setMassLotePick] = useState<string>("");
  const [busyMass, setBusyMass] = useState(false);

  const [globalDialogOpen, setGlobalDialogOpen] = useState(false);
  const [globalParc, setGlobalParc] = useState<number>(1);
  const [globalLoteByPj, setGlobalLoteByPj] = useState<Record<string, string>>({});
  const [globalLotesByPj, setGlobalLotesByPj] = useState<Record<string, LoteOption[]>>({});
  const [busyGlobal, setBusyGlobal] = useState(false);

  // ============ Dialog "Aplicar no lote vigente" (seletor obrigatório) ============
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyDialogScopePj, setApplyDialogScopePj] = useState<string | null>(null); // null = todas
  const [applyLotesByPj, setApplyLotesByPj] = useState<Record<string, LoteOption[]>>({});
  const [applyPickByPj, setApplyPickByPj] = useState<Record<string, string>>({});
  const [applyLoading, setApplyLoading] = useState(false);

  // Resultado detalhado da aplicação (substitui toast genérico por tela vermelha
  // com motivo específico e ação recomendada, PJ a PJ).
  type ApplyOutcome = {
    pj_id: string;
    pj_name: string;
    payment_label: string;
    ok: boolean;
    applied: number;      // glosas efetivamente aplicadas agora
    already: number;      // já aplicadas antes (idempotência)
    postponed: number;    // sem líquido — rolam para próximo ciclo
    partial: number;      // aplicado parcial
    capacidade: number | null;
    error?: string | null;
    hint?: string | null; // ação recomendada
  };
  const [resultDialog, setResultDialog] = useState<{ open: boolean; outcomes: ApplyOutcome[] }>({ open: false, outcomes: [] });

  // ============ FILTROS (sincronizados via URL) ============
  const tab = searchParams.get("tab") || "pendentes";
  const search = searchParams.get("q") || "";
  const period = (searchParams.get("period") as PeriodPreset) || "all";
  const pjFilter = searchParams.get("pj") || "all";
  const ccFilter = searchParams.get("cc") || "all";
  const trackFilter = searchParams.get("track") || "all";
  const tipoFilter = searchParams.get("tipo") || "all";

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all" || value === "") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams();
    if (tab !== "pendentes") next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };
  const hasAnyFilter = !!(search || (period !== "all") || pjFilter !== "all" || ccFilter !== "all" || trackFilter !== "all" || tipoFilter !== "all");

  const loadAll = async () => {
    setLoading(true);
    const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
    const [companiesAll, a, g] = await Promise.all([
      fetchAllPaginated<{ id: string; name: string }>((from, to) =>
        supabase.from("companies").select("id, name").not("name", "ilike", "\\_\\_E2E%").order("name").range(from, to),
      ),
      supabase.from("company_financial_adjustments").select("*, cost_center:cost_centers(id, code_p12, level4, level5)").order("created_at", { ascending: false }),
      (supabase as any)
        .from("glosa_debts")
        .select("id, company_id, doctor_id, doctor_name, doctor_crm, total_debt, parcelas_default, status, created_at, confirmed_at, target_payment_id, origem_payment_id")
        .eq("status", "ativo")
        .order("created_at", { ascending: false }),
    ]);
    setCompanies(companiesAll.filter((c) => !c.name.trim().toUpperCase().startsWith("__E2E")));
    const cMap = new Map(companiesAll.map((x) => [x.id, x.name]));
    const adjs = (a.data || []) as Adjustment[];
    setAdjustments(adjs.map(x => ({ ...x, _company_name: cMap.get(x.company_id) })));
    const debtsRaw = ((g as any).data || []) as GlosaDebt[];
    const origIds = Array.from(new Set(debtsRaw.map(d => d.origem_payment_id).filter(Boolean))) as string[];
    const origMeta = new Map<string, { cc: string | null; track: string | null }>();
    if (origIds.length) {
      const { data: origPays } = await supabase
        .from("payments").select("id, cost_center_code, payment_track").in("id", origIds);
      ((origPays as any[]) ?? []).forEach(p => origMeta.set(p.id, { cc: p.cost_center_code ?? null, track: p.payment_track ?? null }));
    }
    const debts = debtsRaw.map(x => ({
      ...x,
      _company_name: cMap.get(x.company_id),
      _origem_cc: x.origem_payment_id ? origMeta.get(x.origem_payment_id)?.cc ?? null : null,
      _origem_track: x.origem_payment_id ? origMeta.get(x.origem_payment_id)?.track ?? null : null,
    }));
    setGlosaDebts(debts);

    const adjIds = adjs.map(x => x.id);
    const appsMap: Record<string, AdjApplication[]> = {};
    const allPaymentIds = new Set<string>();
    if (adjIds.length) {
      const { data: apps } = await supabase
        .from("company_adjustment_applications")
        .select("id, adjustment_id, payment_id, parcela_numero, valor_aplicado, status, source, applied_at, confirmed_at, reverted_at, reverted_reason")
        .in("adjustment_id", adjIds)
        .order("applied_at", { ascending: false });
      ((apps as any[]) ?? []).forEach(r => {
        (appsMap[r.adjustment_id] ??= []).push(r as AdjApplication);
        if (r.payment_id) allPaymentIds.add(r.payment_id);
      });
    }
    setAppsByAdj(appsMap);

    // Aplicações de glosas por debt_id — inclui "postponed" para marcar dívidas
    // que já foram processadas neste lote (mesmo que sem saldo suficiente para
    // aplicar agora), evitando que o botão "Aplicar" fique habilitado
    // eternamente e a edge seja reinvocada sem produzir efeito.
    const debtIds = debts.map(d => d.id);
    const gpaMap: Record<string, { payment_id: string; status: string; valor_aplicado: number; applied_at: string | null; postpone_reason: string | null }[]> = {};
    if (debtIds.length) {
      const { data: gpaRows } = await (supabase as any)
        .from("glosa_payment_applications")
        .select("glosa_debt_id, payment_id, status, valor_aplicado, applied_at, postpone_reason")
        .in("glosa_debt_id", debtIds)
        .in("status", ["proposto", "confirmado", "partial", "pending_manual_resolution", "postponed"]);
      ((gpaRows as any[]) ?? []).forEach(r => {
        (gpaMap[r.glosa_debt_id] ??= []).push({
          payment_id: r.payment_id,
          status: r.status,
          valor_aplicado: Number(r.valor_aplicado ?? 0),
          applied_at: r.applied_at ?? null,
          postpone_reason: r.postpone_reason ?? null,
        });
        if (r.payment_id) allPaymentIds.add(r.payment_id);
      });
    }
    setGlosaAppsByDebt(gpaMap);

    const tgtIds = Array.from(new Set([
      ...debts.map(d => d.target_payment_id).filter(Boolean) as string[],
      ...Array.from(allPaymentIds),
    ]));
    if (tgtIds.length) {
      const { data: pays } = await supabase
        .from("payments").select("id, reference, competence_month, status").in("id", tgtIds);
      const labels: Record<string, string> = {};
      const statuses: Record<string, string> = {};
      ((pays as any[]) ?? []).forEach(p => {
        labels[p.id] = `${p.reference} · ${fmtCompetence(p.competence_month)} · ${statusShort(p.status)}`;
        statuses[p.id] = String(p.status ?? "");
      });
      setPaymentLabels(prev => ({ ...prev, ...labels }));
      setPaymentStatuses(prev => ({ ...prev, ...statuses }));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!activeHospitalId) {
      setCompanies([]); setAdjustments([]); setGlosaDebts([]); setLoading(false); return;
    }
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHospitalId]);

  const openAdj = (a?: Adjustment) => {
    setEditingAdj(a ? { ...a, _cc_code: a.cost_center?.code_p12 ?? null } : {
      tipo: "credito", descricao: "", valor_total: 0, parcelas_total: 1,
      parcelas_pagas: 0, data_inicio: new Date().toISOString().slice(0, 10), ativo: true, origem: "",
      payment_model_ids: null, recorrente: false, data_fim: null,
      cost_center_id: null, _cc_code: null,
    });
    setAdjDialogOpen(true);
  };
  const saveAdj = async () => {
    if (savingAdj) return;
    if (!editingAdj?.company_id || !editingAdj.descricao || !editingAdj.valor_total) {
      toast.error("Preencha empresa, descrição e valor"); return;
    }
    if (!editingAdj.id && !activeHospitalId) {
      toast.error("Sem hospital ativo."); return;
    }

    const recorrente = !!editingAdj.recorrente;
    // Resolve cost_center_id a partir do código informado no combobox.
    let costCenterId: string | null = null;
    const ccCode = editingAdj._cc_code?.trim() || null;
    if (ccCode) {
      const { data: ccRow, error: ccErr } = await supabase
        .from("cost_centers")
        .select("id")
        .eq("code_p12", ccCode)
        .eq("active", true)
        .maybeSingle();
      if (ccErr || !ccRow) {
        toast.error("Centro de custos inválido ou inativo"); return;
      }
      costCenterId = (ccRow as any).id;
    }
    const payload: any = {
      company_id: editingAdj.company_id, tipo: editingAdj.tipo, descricao: editingAdj.descricao,
      valor_total: editingAdj.valor_total,
      parcelas_total: recorrente ? 1 : (editingAdj.parcelas_total ?? 1),
      parcelas_pagas: editingAdj.parcelas_pagas ?? 0,
      data_inicio: editingAdj.data_inicio,
      ativo: editingAdj.ativo ?? true, origem: editingAdj.origem || null,
      payment_model_ids: (editingAdj.payment_model_ids && editingAdj.payment_model_ids.length > 0) ? editingAdj.payment_model_ids : null,
      recorrente,
      data_fim: recorrente ? (editingAdj.data_fim || null) : null,
      cost_center_id: costCenterId,
    };
    if (!editingAdj.id) payload.hospital_id = activeHospitalId;

    setSavingAdj(true);
    const result = editingAdj.id
      ? await supabase.from("company_financial_adjustments").update(payload).eq("id", editingAdj.id).select("*, cost_center:cost_centers(id, code_p12, level4, level5)").single()
      : await supabase.from("company_financial_adjustments").insert(payload).select("*, cost_center:cost_centers(id, code_p12, level4, level5)").single();
    setSavingAdj(false);
    if (result.error) { toast.error(result.error.message); return; }
    const row = result.data as Adjustment;
    const saved = {
      ...row,
      _company_name: companies.find(c => c.id === row.company_id)?.name,
    };
    setAdjustments(prev => editingAdj.id
      ? prev.map(a => a.id === saved.id ? saved : a)
      : [saved, ...prev]
    );
    toast.success("Ajuste salvo");
    setAdjDialogOpen(false); setEditingAdj(null);
  };
  const removeAdj = async (id: string) => {
    if (!confirm("Excluir este ajuste?")) return;
    setDeletingAdjIds(prev => new Set(prev).add(id));
    const { data, error } = await (supabase as any).rpc("delete_company_financial_adjustment", {
      _adjustment_id: id,
      _reason: "Exclusão manual pela tela de Créditos e Débitos",
    });
    setDeletingAdjIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (error) { toast.error(error.message); return; }
    if (data?.deleted === false) { toast.error("Ajuste não encontrado ou já removido."); return; }
    setAdjustments(prev => prev.filter(a => a.id !== id));
    setAppsByAdj(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setHistoryOpen(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    toast.success("Ajuste excluído");
  };

  const fmtCompetence = (s: string | null) => {
    if (!s) return "—";
    const [y, m] = s.split("-");
    return m && y ? `${m}/${y}` : s;
  };
  const statusShort = (s: string) =>
    ({ rascunho: "rascunho", em_analise_ia: "em análise", revisao_analista: "revisão", aguardando_aprovacao: "aprovação", pedido_nf_enviado: "NF enviada", revisao_pos_aprovacao: "revisão pós-ap." } as Record<string, string>)[s] ?? s;

  const buildLoteLabel = (p: { id: string; reference?: string | null; competence_month: string | null; status: string }, liquido: number | null) => {
    const ref = p.reference ? `${p.reference} · ` : "";
    const base = `${ref}${fmtCompetence(p.competence_month)} · ${statusShort(p.status)}`;
    const liq = liquido == null ? "" : ` · Líq. ${brl(liquido)}`;
    const lock = GLOSA_SUGGESTABLE_STATUSES.has(p.status) ? "" : " · ⚠ já em validação/aprovação";
    return `${base}${liq}${lock}`;
  };

  const scoreLoteMatch = (lote: LoteOption, cc: string | null | undefined, track: string | null | undefined) => {
    let s = 0;
    if (cc && lote.cost_center_code && lote.cost_center_code === cc) s += 10;
    if (track && lote.payment_track && lote.payment_track === track) s += 3;
    return s;
  };

  const dominant = <T extends string | null | undefined>(vals: T[]): T | null => {
    const m = new Map<string, number>();
    vals.forEach(v => { if (v) m.set(v, (m.get(v) ?? 0) + 1); });
    let best: string | null = null; let n = 0;
    m.forEach((c, k) => { if (c > n) { best = k; n = c; } });
    return best as T | null;
  };

  const loadOpenLotes = async (companyId: string) => {
    setLoadingLotes(true);
    setOpenLotes([]);
    const { data: pcg } = await (supabase as any)
      .from("payment_company_groups").select("payment_id").eq("company_id", companyId);
    const ids = Array.from(new Set(((pcg as any[]) ?? []).map(r => r.payment_id))).filter(Boolean);
    if (!ids.length) { setLoadingLotes(false); return; }
    const [{ data: pays }, { data: fins }] = await Promise.all([
      supabase.from("payments").select("id, reference, competence_month, status, cost_center_code, payment_track")
        .in("id", ids).in("status", OPEN_PAYMENT_STATUSES)
        .order("competence_month", { ascending: false }),
      supabase.from("payment_company_financials").select("payment_id, liquido")
        .in("payment_id", ids).eq("company_id", companyId),
    ]);
    const liqMap = new Map<string, number>();
    ((fins as any[]) ?? []).forEach(f => liqMap.set(f.payment_id, Number(f.liquido ?? 0)));
    const opts: LoteOption[] = ((pays as any[]) ?? []).map(p => ({
      id: p.id,
      status: p.status,
      competence: p.competence_month,
      cost_center_code: p.cost_center_code ?? null,
      payment_track: p.payment_track ?? null,
      reference: p.reference ?? null,
      liquido: liqMap.has(p.id) ? (liqMap.get(p.id) as number) : null,
      label: buildLoteLabel(p, liqMap.has(p.id) ? (liqMap.get(p.id) as number) : null),
    }));
    setOpenLotes(opts);
    setPaymentLabels(prev => {
      const next = { ...prev };
      opts.forEach(o => { next[o.id] = o.label; });
      return next;
    });
    setLoadingLotes(false);
  };

  const openGlosa = (g: GlosaDebt) => {
    setEditingGlosa(g);
    setGlosaParc(g.parcelas_default && g.parcelas_default > 0 ? g.parcelas_default : 1);
    setLotePick(g.target_payment_id ?? "");
    loadOpenLotes(g.company_id);
  };
  const saveGlosa = async () => {
    if (!editingGlosa) return;
    if (glosaParc < 1 || glosaParc > 24) { toast.error("Parcelas entre 1 e 24"); return; }
    if (!lotePick) { toast.error("Escolha o lote-alvo onde este débito deve ser aplicado."); return; }
    setBusyGlosa(true);
    const { data: userData } = await supabase.auth.getUser();
    const patch: any = { parcelas_default: glosaParc, target_payment_id: lotePick };
    if (!editingGlosa.confirmed_at) {
      patch.confirmed_at = new Date().toISOString();
      patch.confirmed_by = userData.user?.id ?? null;
    }
    const { error } = await (supabase as any).from("glosa_debts").update(patch).eq("id", editingGlosa.id);
    setBusyGlosa(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    // Dispara aplicação imediata no lote-alvo (silencioso — se falhar, o botão "Reaplicar" cobre).
    // Sem await para não travar UI; o toast de sucesso reflete a confirmação, não a aplicação.
    if (lotePick && editingGlosa.company_id) {
      supabase.functions.invoke("apply-company-deductions", {
        body: { payment_id: lotePick, company_id: editingGlosa.company_id },
      }).catch((err) => console.warn("[saveGlosa] apply-company-deductions falhou:", err?.message));
      void logDeductionEvent({
        hospital_id: activeHospitalId,
        payment_id: lotePick,
        company_id: editingGlosa.company_id,
        debt_id: editingGlosa.id,
        action: "applied",
        reason: editingGlosa.confirmed_at ? "Reparcelamento — dispara aplicação no lote-alvo" : "Confirmação de débito — dispara aplicação no lote-alvo",
        metadata: { parcelas: glosaParc, total: editingGlosa.total_debt, source: "saveGlosa" },
      });
    }
    toast.success(editingGlosa.confirmed_at
      ? `Reparcelado para ${glosaParc}× de ${brl(editingGlosa.total_debt / glosaParc)}.`
      : `Débito confirmado em ${glosaParc}× de ${brl(editingGlosa.total_debt / glosaParc)}.`);
    setGlosaDebts(prev => prev.map(g => g.id === editingGlosa.id
      ? {
        ...g,
        parcelas_default: glosaParc,
        target_payment_id: lotePick,
        confirmed_at: editingGlosa.confirmed_at ?? patch.confirmed_at ?? new Date().toISOString(),
      }
      : g
    ));
    setEditingGlosa(null);

  };

  const reopenGlosa = async (g: GlosaDebt) => {
    if (!confirm(`Reabrir débito de ${g.doctor_name}? Sai de "em andamento" e volta para "a confirmar".`)) return;
    const { error } = await (supabase as any).from("glosa_debts").update({ confirmed_at: null, confirmed_by: null }).eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Débito reaberto");
    setGlosaDebts(prev => prev.map(item => item.id === g.id ? { ...item, confirmed_at: null } : item));
  };

  /** Estado do diálogo de reversão (substitui window.prompt, que é bloqueado no preview em iframe). */
  const [revertTarget, setRevertTarget] = useState<GlosaDebt | null>(null);
  const [revertReason, setRevertReason] = useState("");
  const [reverting, setReverting] = useState(false);

  /** Abre o diálogo de reversão. */
  const revertGlosa = (g: GlosaDebt) => {
    setRevertReason("");
    setRevertTarget(g);
  };

  /** Executa a reversão após confirmação no diálogo. */
  const confirmRevertGlosa = async () => {
    const g = revertTarget;
    if (!g) return;
    const trimmed = revertReason.trim();
    if (!trimmed) { toast.error("Motivo obrigatório para reverter."); return; }

    setReverting(true);
    const { data, error } = await (supabase as any).rpc("revert_glosa_debt", {
      p_debt_id: g.id,
      p_reason: trimmed,
    });
    setReverting(false);

    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("glosa_locked_in_finalized_payment")) {
        toast.error("Não é possível reverter: há aplicação confirmada em lote lançado/arquivado/pago. Use ajuste manual.");
      } else if (msg.includes("wrong_hospital_scope")) {
        toast.error("Glosa pertence a outro hospital.");
      } else if (msg.includes("debt_not_found")) {
        toast.error("Glosa não encontrada.");
      } else {
        toast.error(`Falha ao reverter: ${msg}`);
      }
      return;
    }

    const result = (data ?? {}) as {
      already_reverted?: boolean;
      reconciliation_item_reopened?: boolean;
      affected_payment_ids?: string[];
    };

    if (result.already_reverted) {
      toast.info("Esta glosa já estava revertida.");
    } else {
      toast.success(
        result.reconciliation_item_reopened
          ? "Glosa revertida e item devolvido à conciliação."
          : "Glosa revertida."
      );
    }

    // Recomputa o financeiro dos lotes afetados (fire-and-forget)
    const affected = Array.isArray(result.affected_payment_ids) ? result.affected_payment_ids : [];
    for (const pid of affected) {
      if (!pid || !g.company_id) continue;
      supabase.functions.invoke("compute-company-financials", {
        body: { payment_id: pid, company_id: g.company_id },
      }).catch((err) => console.warn("[revertGlosa] compute-company-financials falhou:", err?.message));
    }

    // Atualização otimista + fecha diálogo
    setGlosaDebts(prev => prev.filter(item => item.id !== g.id));
    setGlosaAppsByDebt(prev => {
      const next = { ...prev };
      delete next[g.id];
      return next;
    });
    setRevertTarget(null);
    setRevertReason("");
  };

  // ============ APLICAR FILTROS ============
  const { from: periodFrom, to: periodTo } = periodRange(period);
  const q = search.trim().toLowerCase();

  const filterGlosa = (g: GlosaDebt) => {
    if (pjFilter !== "all" && g.company_id !== pjFilter) return false;
    if (ccFilter !== "all" && (g._origem_cc || "—") !== ccFilter) return false;
    if (trackFilter !== "all" && (g._origem_track || "—") !== trackFilter) return false;
    if (!inRange(g.created_at, periodFrom, periodTo)) return false;
    if (q) {
      const hay = `${g.doctor_name} ${g.doctor_crm ?? ""} ${g._company_name ?? ""} ${paymentLabels[g.target_payment_id ?? ""] ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const filterAdj = (a: Adjustment) => {
    if (pjFilter !== "all" && a.company_id !== pjFilter) return false;
    if (tipoFilter !== "all" && a.tipo !== tipoFilter) return false;
    if (!inRange(a.data_inicio, periodFrom, periodTo)) return false;
    if (q) {
      const hay = `${a._company_name ?? ""} ${a.descricao} ${a.origem ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const pendentesAll = useMemo(() => glosaDebts.filter(g => !g.confirmed_at), [glosaDebts]);
  const emAndamentoAll = useMemo(() => glosaDebts.filter(g => !!g.confirmed_at), [glosaDebts]);
  const pendentes = useMemo(() => pendentesAll.filter(filterGlosa), [pendentesAll, pjFilter, ccFilter, trackFilter, periodFrom, periodTo, q, paymentLabels]);
  const emAndamento = useMemo(() => emAndamentoAll.filter(filterGlosa), [emAndamentoAll, pjFilter, ccFilter, trackFilter, periodFrom, periodTo, q, paymentLabels]);
  const ajustesFiltrados = useMemo(() => adjustments.filter(filterAdj), [adjustments, pjFilter, tipoFilter, periodFrom, periodTo, q]);

  // opções dinâmicas
  const ccOptions = useMemo(() => Array.from(new Set(glosaDebts.map(g => g._origem_cc || "—"))).sort(), [glosaDebts]);
  const trackOptions = useMemo(() => Array.from(new Set(glosaDebts.map(g => g._origem_track || "—"))).sort(), [glosaDebts]);
  const pjOptions = useMemo(() => {
    const ids = new Set<string>();
    glosaDebts.forEach(g => ids.add(g.company_id));
    adjustments.forEach(a => ids.add(a.company_id));
    return companies.filter(c => ids.has(c.id));
  }, [glosaDebts, adjustments, companies]);

  // KPIs
  const kpi = useMemo(() => {
    const now = new Date();
    const m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const totalPendente = pendentes.reduce((s, g) => s + Number(g.total_debt), 0);
    const totalAndamento = emAndamento.reduce((s, g) => s + Number(g.total_debt), 0);
    let aplicadoMes = 0;
    Object.values(appsByAdj).flat().forEach(ap => {
      if (ap.status === "revertido") return;
      const t = ap.confirmed_at ?? ap.applied_at;
      if (t && new Date(t).getTime() >= m0) aplicadoMes += Number(ap.valor_aplicado);
    });
    const semLote = emAndamento.filter(g => !g.target_payment_id).length;
    return { totalPendente, totalAndamento, aplicadoMes, semLote };
  }, [pendentes, emAndamento, appsByAdj]);

  // Histórico aplicado (flat)
  const historicoRows = useMemo(() => {
    const rows: (AdjApplication & { _adj?: Adjustment })[] = [];
    Object.entries(appsByAdj).forEach(([adjId, apps]) => {
      const adj = adjustments.find(x => x.id === adjId);
      apps.forEach(ap => rows.push({ ...ap, _adj: adj }));
    });
    return rows
      .filter(r => {
        if (pjFilter !== "all" && r._adj?.company_id !== pjFilter) return false;
        if (!inRange(r.confirmed_at ?? r.applied_at, periodFrom, periodTo)) return false;
        if (q) {
          const hay = `${r._adj?._company_name ?? ""} ${r._adj?.descricao ?? ""} ${paymentLabels[r.payment_id] ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ta = new Date(a.confirmed_at ?? a.applied_at ?? 0).getTime();
        const tb = new Date(b.confirmed_at ?? b.applied_at ?? 0).getTime();
        return tb - ta;
      });
  }, [appsByAdj, adjustments, pjFilter, periodFrom, periodTo, q, paymentLabels]);

  // ============ EXPORT (PDF/Excel) ============
  const [exporting, setExporting] = useState<null | "pdf" | "xlsx">(null);
  const { hospital } = useHospital();

  const buildFiltersSummary = (): ReportFiltersSummary => {
    const periodLabels: Record<PeriodPreset, string> = {
      all: "Todo o período",
      current_month: "Este mês",
      last_month: "Mês passado",
      last_90: "Últimos 90 dias",
      current_year: "Este ano",
    };
    const pjName = pjFilter === "all" ? "Todas as PJs" : (companies.find(c => c.id === pjFilter)?.name ?? pjFilter);
    return {
      periodLabel: periodLabels[period],
      pjLabel: pjName,
      ccLabel: ccFilter === "all" ? "Todos CCs" : ccFilter,
      trackLabel: trackFilter === "all" ? "Todas trilhas" : trackFilter,
      tipoLabel: tipoFilter === "all" ? "Todos os tipos" : tipoFilter,
      search: search.trim(),
      hospitalName: hospital?.name,
    };
  };

  const handleExport = async (format: "pdf" | "xlsx") => {
    try {
      setExporting(format);
      const data = await buildReportData({
        filters: buildFiltersSummary(),
        pendentes: pendentes as any,
        emAndamento: emAndamento as any,
        ajustes: ajustesFiltrados as any,
        appsByAdj: appsByAdj as any,
        paymentLabels,
      });
      const ts = new Date().toISOString().slice(0, 10);
      const suffix = hospital?.name ? `_${hospital.name.replace(/[^\w]+/g, "-")}` : "";
      if (format === "xlsx") {
        const blob = generateCreditosDebitosXlsx(data);
        downloadBlob(blob, `creditos-debitos${suffix}_${ts}.xlsx`);
      } else {
        const doc = await generateCreditosDebitosPdf(data);
        doc.save(`creditos-debitos${suffix}_${ts}.pdf`);
      }
      toast.success(`Relatório ${format.toUpperCase()} gerado.`);
    } catch (err: any) {
      console.error("[export creditos-debitos]", err);
      toast.error(err?.message ?? "Falha ao gerar relatório.");
    } finally {
      setExporting(null);
    }
  };

  // ============ Aplicar em massa no LOTE VIGENTE (Em andamento) ============
  const [applyingCurrent, setApplyingCurrent] = useState<string | null>(null); // pjId | "__all__"

  // Retorna a aplicação ativa desta dívida em um payment específico (se houver)
  const debtAppliedAt = (debtId: string, paymentId: string | null | undefined) => {
    if (!paymentId) return null;
    const apps = glosaAppsByDebt[debtId] ?? [];
    return apps.find(a => a.payment_id === paymentId) ?? null;
  };

  // Retorna TODAS as aplicações efetivas (proposto/confirmado/partial) da dívida,
  // em qualquer lote — usado para decidir "quitada", "arquivada" e mostrar
  // histórico cruzado quando o débito foi acrescido depois do 1º pagamento.
  const debtEffectiveApps = (debtId: string) => {
    const apps = glosaAppsByDebt[debtId] ?? [];
    return apps.filter(a => ["proposto", "confirmado", "partial"].includes(a.status));
  };
  const debtTotalApplied = (debtId: string) =>
    debtEffectiveApps(debtId).reduce((s, a) => s + Number(a.valor_aplicado || 0), 0);
  const debtAppliedInLiquidado = (debtId: string) =>
    debtEffectiveApps(debtId)
      .filter(a => isPaymentLiquidado(a.payment_id))
      .reduce((s, a) => s + Number(a.valor_aplicado || 0), 0);
  // Residual = o que ainda falta aplicar somando aplicações em QUALQUER lote.
  const debtResidual = (g: GlosaDebt) =>
    Math.max(0, Number(g.total_debt || 0) - debtTotalApplied(g.id));
  // "Pendente" = ainda tem algo a aplicar (residual > 1 centavo).
  const isDebtPending = (g: GlosaDebt) => debtResidual(g) > 0.005;
  // "Quitada": soma aplicada (em qualquer status ativo) cobre o total_debt.
  const isDebtSettled = (g: GlosaDebt) => !isDebtPending(g);
  // "Arquivável": o quitado veio de lotes já liquidados (pago/aprovado/etc).
  const isDebtArchivable = (g: GlosaDebt) =>
    debtAppliedInLiquidado(g.id) + 0.005 >= Number(g.total_debt || 0);


  // Abre o dialog obrigatório de seleção de lote para "Aplicar no lote vigente".
  // Sistema multi-usuário: nunca auto-seleciona lote — analista escolhe explicitamente.
  const openApplyCurrentDialog = async (pjId?: string) => {
    if (!activeHospitalId) { toast.error("Sem hospital ativo."); return; }
    const rawScope = pjId ? emAndamento.filter(g => g.company_id === pjId) : emAndamento;
    const scope = rawScope.filter(g => isDebtPending(g));
    if (!scope.length) { toast.info("Nada a aplicar — todos os débitos deste recorte já estão quitados."); return; }
    setApplyDialogScopePj(pjId ?? null);
    setApplyDialogOpen(true);
    setApplyLoading(true);
    setApplyLotesByPj({});
    setApplyPickByPj({});
    try {
      const byPj = new Map<string, GlosaDebt[]>();
      scope.forEach(g => { const arr = byPj.get(g.company_id) ?? []; arr.push(g); byPj.set(g.company_id, arr); });
      const pjIds = Array.from(byPj.keys());
      const results = await Promise.all(pjIds.map(async (pj) => {
        const { data: pcg } = await (supabase as any)
          .from("payment_company_groups").select("payment_id").eq("company_id", pj);
        const ids = Array.from(new Set(((pcg as any[]) ?? []).map(r => r.payment_id))).filter(Boolean);
        if (!ids.length) return [pj, [] as LoteOption[]] as const;
        const [{ data: pays }, { data: fins }] = await Promise.all([
          (supabase as any).from("payments").select("id, reference, competence_month, status, cost_center_code, payment_track")
            .in("id", ids).in("status", OPEN_PAYMENT_STATUSES as unknown as string[])
            .eq("hospital_id", activeHospitalId)
            .order("competence_month", { ascending: false }),
          (supabase as any).from("payment_company_financials").select("payment_id, liquido")
            .in("payment_id", ids).eq("company_id", pj),
        ]);
        const liqMap = new Map<string, number>();
        ((fins as any[]) ?? []).forEach((f: any) => liqMap.set(f.payment_id, Number(f.liquido ?? 0)));
        const opts: LoteOption[] = ((pays as any[]) ?? []).map((p: any) => ({
          id: p.id,
          status: p.status,
          competence: p.competence_month,
          cost_center_code: p.cost_center_code ?? null,
          payment_track: p.payment_track ?? null,
          reference: p.reference ?? null,
          liquido: liqMap.has(p.id) ? (liqMap.get(p.id) as number) : null,
          label: buildLoteLabel(p, liqMap.has(p.id) ? (liqMap.get(p.id) as number) : null),
        }));
        return [pj, opts] as const;
      }));
      const lotesMap: Record<string, LoteOption[]> = {};
      const pickMap: Record<string, string> = {};
      results.forEach(([pj, opts]) => {
        lotesMap[pj] = opts;
        // Escolha 100% manual (multi-usuário): analista SEMPRE confirma qual lote
        // recebe o débito, mesmo quando só há uma opção. Evita aplicação silenciosa.
      });
      setApplyLotesByPj(lotesMap);
      setApplyPickByPj(pickMap);
    } catch (err: any) {
      console.error("[openApplyCurrentDialog]", err);
      toast.error(err?.message ?? "Falha ao carregar lotes abertos.");
      setApplyDialogOpen(false);
    } finally {
      setApplyLoading(false);
    }
  };

  // Executa a aplicação com as escolhas explícitas do analista.
  const executeApplyCurrentLote = async (picksByPj: Record<string, string>, scopePjId: string | null) => {
    if (!activeHospitalId) { toast.error("Sem hospital ativo."); return; }
    const scope = scopePjId ? emAndamento.filter(g => g.company_id === scopePjId) : emAndamento;
    const key = scopePjId ?? "__all__";
    setApplyingCurrent(key);
    try {
      const byPj = new Map<string, GlosaDebt[]>();
      scope.forEach(g => { const arr = byPj.get(g.company_id) ?? []; arr.push(g); byPj.set(g.company_id, arr); });
      const pjIds = Array.from(byPj.keys());

      const currentByPj = new Map<string, string>();
      const labelPatch: Record<string, string> = {};
      for (const pj of pjIds) {
        const pick = picksByPj[pj];
        if (!pick) continue;
        currentByPj.set(pj, pick);
        const lote = applyLotesByPj[pj]?.find(o => o.id === pick);
        if (lote) labelPatch[pick] = lote.label;
      }

      // Débitos que precisam atualizar target
      const toUpdate: { id: string; company_id: string; target: string }[] = [];
      for (const [pj, debts] of byPj.entries()) {
        const target = currentByPj.get(pj);
        if (!target) continue;
        for (const d of debts) {
          if (d.target_payment_id !== target) toUpdate.push({ id: d.id, company_id: pj, target });
        }
      }

      const { computePairsToInvoke } = await import("@/lib/deductionDedup");
      const { pairsToInvoke, alreadyApplied } = computePairsToInvoke({
        debtsByPj: byPj,
        currentByPj,
        glosaAppsByDebt,
      });

      let appliedNow = 0;
      for (const [pj, debts] of byPj.entries()) {
        const target = currentByPj.get(pj);
        if (!target || !pairsToInvoke.has(`${target}|${pj}`)) continue;
        for (const d of debts) {
          if (!debtAppliedAt(d.id, target)) appliedNow += 1;
        }
      }

      let updated = 0;
      const auditEvents: Parameters<typeof logDeductionEvents>[0] = [];
      for (const u of toUpdate) {
        const { error } = await (supabase as any).from("glosa_debts").update({ target_payment_id: u.target }).eq("id", u.id);
        if (!error) {
          updated += 1;
          auditEvents.push({
            hospital_id: activeHospitalId,
            payment_id: u.target,
            company_id: u.company_id,
            debt_id: u.id,
            action: "target_updated",
            reason: "Lote-alvo alterado ao aplicar no lote vigente",
            metadata: { source: "executeApplyCurrentLote" },
          });
        }
      }

      // Logar débitos deduplicados (já aplicados no lote alvo escolhido)
      for (const [pj, debts] of byPj.entries()) {
        const target = currentByPj.get(pj);
        if (!target) continue;
        for (const d of debts) {
          if (debtAppliedAt(d.id, target)) {
            auditEvents.push({
              hospital_id: activeHospitalId,
              payment_id: target,
              company_id: pj,
              debt_id: d.id,
              action: "skipped_duplicate",
              reason: "Débito já aplicado neste lote — reexecução evitada",
              metadata: { source: "executeApplyCurrentLote" },
            });
          }
        }
      }

      if (pairsToInvoke.size === 0) {
        if (toUpdate.length) {
          const patch = new Map(toUpdate.map(u => [u.id, u.target]));
          setGlosaDebts(prev => prev.map(g => patch.has(g.id) ? { ...g, target_payment_id: patch.get(g.id)! } : g));
        }
        if (Object.keys(labelPatch).length) setPaymentLabels(prev => ({ ...prev, ...labelPatch }));
        toast.info(alreadyApplied > 0
          ? `Nada novo para aplicar — ${alreadyApplied} débito(s) já aplicado(s) no lote escolhido.`
          : "Nenhum débito pendente para o lote escolhido.");
        void logDeductionEvents(auditEvents.length ? auditEvents : [{
          hospital_id: activeHospitalId,
          company_id: scopePjId ?? null,
          action: alreadyApplied > 0 ? "skipped_duplicate" : "no_pending",
          reason: alreadyApplied > 0 ? `${alreadyApplied} débito(s) já aplicado(s)` : "Sem pendências no lote escolhido",
          metadata: { source: "executeApplyCurrentLote" },
        }]);
        setApplyDialogOpen(false);
        return;
      }

      // Cap concurrency: browsers (mobilesafari em especial) abortam fetches quando
      // dezenas de invokes disparam ao mesmo tempo, surfando "Failed to send a request
      // to the Edge Function" mesmo quando o backend rodou com sucesso.
      const invokeWithRetry = async (p: { payment_id: string; company_id: string }) => {
        let lastErr: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return await supabase.functions.invoke("apply-company-deductions", { body: p });
          } catch (err: any) {
            lastErr = err;
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        throw lastErr;
      };
      const pairsList = Array.from(pairsToInvoke.values());
      const invocations: PromiseSettledResult<any>[] = [];
      const CONCURRENCY = 4;
      for (let i = 0; i < pairsList.length; i += CONCURRENCY) {
        const chunk = pairsList.slice(i, i + CONCURRENCY);
        const res = await Promise.allSettled(chunk.map(p => invokeWithRetry(p)));
        invocations.push(...res);
      }
      const pairsArr = Array.from(pairsToInvoke.values());
      const outcomes: ApplyOutcome[] = [];
      invocations.forEach((res, idx) => {
        const p = pairsArr[idx];
        const debtsForPair = (byPj.get(p.company_id) ?? []).filter(d => !debtAppliedAt(d.id, p.payment_id));
        const pjName = (byPj.get(p.company_id)?.[0] as any)?._company_name ?? "PJ";
        const loteLabel = applyLotesByPj[p.company_id]?.find(o => o.id === p.payment_id)?.label
          ?? paymentLabels[p.payment_id] ?? p.payment_id.slice(0, 8);

        // Ler a resposta da edge (data.summary.glosas contém postponed/partial/capacidade_inicial)
        const data: any = res.status === "fulfilled" ? (res.value as any)?.data : null;
        const invokeError: any = res.status === "fulfilled" ? (res.value as any)?.error : (res as any).reason;
        const glosasSummary = data?.summary?.glosas ?? null;
        const applied = Number(glosasSummary?.proposed ?? 0);
        const postponed = Number(glosasSummary?.postponed ?? 0);
        const partial = Number(glosasSummary?.partial ?? 0);
        const already = Number(glosasSummary?.skipped_existing ?? 0);
        const capacidade = glosasSummary?.capacidade_inicial != null ? Number(glosasSummary.capacidade_inicial) : null;

        const ok = res.status === "fulfilled" && !invokeError && !data?.error;
        const errMsg = !ok
          ? (invokeError?.message ?? data?.error ?? "Falha desconhecida ao aplicar")
          : null;

        let hint: string | null = null;
        if (!ok) {
          hint = "Verifique se o lote-alvo permanece aberto e tente novamente. Se persistir, revise o vínculo médico→PJ e o cadastro do débito.";
        } else if (postponed > 0 && applied === 0 && partial === 0) {
          hint = `PJ sem líquido disponível no lote (capacidade R$ ${capacidade?.toFixed(2) ?? "0,00"}). O débito rola automaticamente para o próximo ciclo — nenhuma ação necessária agora.`;
        } else if (partial > 0) {
          hint = "Parte do débito foi aplicada até esgotar o líquido da PJ. O saldo remanescente segue como débito ativo e volta ao próximo lote.";
        }

        outcomes.push({
          pj_id: p.company_id, pj_name: pjName, payment_label: loteLabel,
          ok, applied, already, postponed, partial, capacidade, error: errMsg, hint,
        });

        const baseReason = ok ? "Aplicação disparada no lote-alvo" : `Falha ao aplicar: ${errMsg}`;
        const action = ok ? "applied" : "error";
        if (debtsForPair.length === 0) {
          auditEvents.push({ hospital_id: activeHospitalId, payment_id: p.payment_id, company_id: p.company_id, action, reason: baseReason, metadata: { source: "executeApplyCurrentLote", summary: glosasSummary } });
        } else {
          for (const d of debtsForPair) {
            auditEvents.push({ hospital_id: activeHospitalId, payment_id: p.payment_id, company_id: p.company_id, debt_id: d.id, action, reason: baseReason, metadata: { source: "executeApplyCurrentLote", total_debt: d.total_debt } });
          }
        }
      });
      void logDeductionEvents(auditEvents);
      const okInvocations = outcomes.filter(o => o.ok).length;
      const failedInvocations = outcomes.length - okInvocations;
      const anyPostponedOrPartial = outcomes.some(o => o.postponed > 0 || o.partial > 0);
      const missing = pjIds.length - currentByPj.size;

      if (toUpdate.length) {
        const patch = new Map(toUpdate.map(u => [u.id, u.target]));
        setGlosaDebts(prev => prev.map(g => patch.has(g.id) ? { ...g, target_payment_id: patch.get(g.id)! } : g));
      }
      if (Object.keys(labelPatch).length) {
        setPaymentLabels(prev => ({ ...prev, ...labelPatch }));
      }

      // Se houver falha, postpone ou parcial → abre painel vermelho detalhado.
      // Caso 100% ok e sem postpone/partial → toast de sucesso simples.
      if (failedInvocations > 0 || anyPostponedOrPartial) {
        setResultDialog({ open: true, outcomes });
      } else {
        const scopeLabel = scopePjId
          ? (byPj.get(scopePjId)?.[0] as any)?._company_name ?? "PJ"
          : `${okInvocations} PJ(s)`;
        const parts = [
          `✓ ${appliedNow} aplicado(s) agora`,
          alreadyApplied ? `↻ ${alreadyApplied} já aplicado(s)` : null,
          updated ? `${updated} lote-alvo atualizado(s)` : null,
          missing ? `${missing} sem escolha de lote` : null,
        ].filter(Boolean).join(" · ");
        toast.success(`${scopeLabel} — ${parts}`);
      }
      setApplyDialogOpen(false);
      void loadAll();
    } catch (err: any) {
      console.error("[executeApplyCurrentLote]", err);
      setResultDialog({
        open: true,
        outcomes: [{
          pj_id: scopePjId ?? "__scope__",
          pj_name: scopePjId
            ? (emAndamento.find(g => g.company_id === scopePjId)?._company_name ?? "PJ")
            : "Aplicação em massa",
          payment_label: "—",
          ok: false, applied: 0, already: 0, postponed: 0, partial: 0, capacidade: null,
          error: err?.message ?? "Falha ao aplicar no lote escolhido.",
          hint: "Verifique sua conexão e permissões no hospital ativo. Se persistir, recarregue a página e tente novamente.",
        }],
      });
    } finally {
      setApplyingCurrent(null);
    }
  };



  // ============ Mass actions ============
  const massTargets = massDialogPjId
    ? pendentesAll.filter(g => g.company_id === massDialogPjId && selectedPending.has(g.id))
    : [];
  const massTotal = massTargets.reduce((s, g) => s + Number(g.total_debt), 0);
  const massParcelaSoma = massParc > 0 ? massTotal / massParc : 0;
  const massLoteObj = openLotes.find(l => l.id === massLotePick);
  const massCabe = massLoteObj?.liquido == null ? null : (massLoteObj.liquido - massParcelaSoma);

  const confirmMass = async () => {
    if (!massDialogPjId || massTargets.length === 0) return;
    if (massParc < 1 || massParc > 24) { toast.error("Parcelas entre 1 e 24"); return; }
    if (!massLotePick) { toast.error("Escolha o lote-alvo"); return; }
    setBusyMass(true);
    const { data: userData } = await supabase.auth.getUser();
    const nowIso = new Date().toISOString();
    const uid = userData.user?.id ?? null;
    const errors: string[] = [];
    const successIds: string[] = [];
    for (const g of massTargets) {
      const { error } = await (supabase as any)
        .from("glosa_debts")
        .update({
          parcelas_default: massParc,
          target_payment_id: massLotePick,
          confirmed_at: g.confirmed_at ?? nowIso,
          confirmed_by: g.confirmed_at ? undefined : uid,
        })
        .eq("id", g.id);
      if (error) errors.push(`${g.doctor_name}: ${error.message}`);
      else successIds.push(g.id);
    }
    setBusyMass(false);
    if (errors.length) {
      toast.error(`${massTargets.length - errors.length} confirmadas · ${errors.length} falharam`);
      console.error("[mass confirm]", errors);
    } else {
      toast.success(`${massTargets.length} débitos confirmados em ${massParc}×.`);
    }
    setMassDialogPjId(null);
    setSelectedPending(prev => {
      const next = new Set(prev);
      successIds.forEach(id => next.delete(id));
      return next;
    });
    if (successIds.length) {
      setGlosaDebts(prev => prev.map(g => successIds.includes(g.id)
        ? { ...g, parcelas_default: massParc, target_payment_id: massLotePick, confirmed_at: g.confirmed_at ?? nowIso }
        : g
      ));
      // Dispara aplicação no lote-alvo (massDialogPjId = 1 PJ, massLotePick = 1 lote).
      supabase.functions.invoke("apply-company-deductions", {
        body: { payment_id: massLotePick, company_id: massDialogPjId },
      }).catch((err) => console.warn("[confirmMass] apply-company-deductions falhou:", err?.message));
      void logDeductionEvents(successIds.map(debtId => ({
        hospital_id: activeHospitalId,
        payment_id: massLotePick,
        company_id: massDialogPjId,
        debt_id: debtId,
        action: "applied" as const,
        reason: `Confirmação em massa (${massParc}×) — aplicação disparada`,
        metadata: { source: "confirmMass", parcelas: massParc },
      })));
    }

  };

  const openGlobalMass = async () => {
    const base = pendentes;
    if (base.length === 0) return;
    const selectedList = selectedPending.size > 0 ? base.filter(g => selectedPending.has(g.id)) : base;
    if (selectedList.length === 0) return;
    const pjIds = Array.from(new Set(selectedList.map(g => g.company_id)));
    setGlobalDialogOpen(true);
    setGlobalParc(1);

    const results = await Promise.all(pjIds.map(async (pjId) => {
      const { data: pcg } = await (supabase as any)
        .from("payment_company_groups").select("payment_id").eq("company_id", pjId);
      const ids = Array.from(new Set(((pcg as any[]) ?? []).map(r => r.payment_id))).filter(Boolean);
      if (!ids.length) return [pjId, [] as LoteOption[]] as const;
      const [{ data: pays }, { data: fins }] = await Promise.all([
        supabase.from("payments").select("id, reference, competence_month, status, cost_center_code, payment_track")
          .in("id", ids).in("status", OPEN_PAYMENT_STATUSES).order("competence_month", { ascending: false }),
        supabase.from("payment_company_financials").select("payment_id, liquido")
          .in("payment_id", ids).eq("company_id", pjId),
      ]);
      const liqMap = new Map<string, number>();
      ((fins as any[]) ?? []).forEach(f => liqMap.set(f.payment_id, Number(f.liquido ?? 0)));
      const opts: LoteOption[] = ((pays as any[]) ?? []).map(p => ({
        id: p.id,
        status: p.status,
        competence: p.competence_month,
        cost_center_code: p.cost_center_code ?? null,
        payment_track: p.payment_track ?? null,
        reference: p.reference ?? null,
        liquido: liqMap.has(p.id) ? (liqMap.get(p.id) as number) : null,
        label: buildLoteLabel(p, liqMap.has(p.id) ? (liqMap.get(p.id) as number) : null),
      }));
      return [pjId, opts] as const;
    }));

    const originByPj = new Map<string, { cc: string | null; track: string | null }>();
    pjIds.forEach(pjId => {
      const debtsPj = selectedList.filter(d => d.company_id === pjId);
      originByPj.set(pjId, {
        cc: dominant(debtsPj.map(d => d._origem_cc ?? null)),
        track: dominant(debtsPj.map(d => d._origem_track ?? null)),
      });
    });

    const lotesMap: Record<string, LoteOption[]> = {};
    const pickMap: Record<string, string> = {};
    results.forEach(([pjId, opts]) => {
      lotesMap[pjId] = opts;
      const origem = originByPj.get(pjId) ?? { cc: null, track: null };
      // Só sugere lotes que ainda não seguiram para validação/aprovação.
      const sugeriveis = opts.filter(o => GLOSA_SUGGESTABLE_STATUSES.has(o.status));
      const sug = [...sugeriveis].sort((a, b) => {
        const ds = scoreLoteMatch(b, origem.cc, origem.track) - scoreLoteMatch(a, origem.cc, origem.track);
        if (ds !== 0) return ds;
        return Number(b.liquido ?? 0) - Number(a.liquido ?? 0);
      })[0];
      if (sug) pickMap[pjId] = sug.id;
    });
    setGlobalLotesByPj(lotesMap);
    setGlobalLoteByPj(pickMap);
    Object.entries(pickMap).forEach(([pj, lid]) => { void ensureLoteLiquido(pj, lid, lotesMap[pj]); });
  };

  const ensureLoteLiquido = async (pjId: string, loteId: string, optsHint?: LoteOption[]) => {
    const currentOpts = optsHint ?? globalLotesByPj[pjId] ?? [];
    const target = currentOpts.find(o => o.id === loteId);
    if (!target || target.liquido != null) return;
    const { data: fin } = await (supabase as any)
      .from("payment_company_financials")
      .select("liquido").eq("payment_id", loteId).eq("company_id", pjId).maybeSingle();
    let liq: number | null = fin?.liquido != null ? Number(fin.liquido) : null;
    if (liq == null) {
      const { data: items } = await supabase
        .from("payment_items").select("gross_amount")
        .eq("payment_id", loteId).eq("company_id", pjId);
      if (items && items.length) {
        liq = (items as any[]).reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
      }
    }
    if (liq == null) return;
    setGlobalLotesByPj(prev => {
      const list = prev[pjId] ?? [];
      const next = list.map(o => o.id === loteId
        ? { ...o, liquido: liq, label: buildLoteLabel({ id: o.id, reference: o.reference ?? null, competence_month: o.competence, status: o.status }, liq) }
        : o);
      return { ...prev, [pjId]: next };
    });
  };

  // Elegibilidade por PJ no modal global: precisa de lote-alvo selecionado e de
  // líquido suficiente para a parcela. As demais PJs continuam PENDENTES.
  const globalPjEligibility = (list: GlosaDebt[], parc: number) => {
    const byPj = new Map<string, GlosaDebt[]>();
    list.forEach(g => { const arr = byPj.get(g.company_id) ?? []; arr.push(g); byPj.set(g.company_id, arr); });
    const eligible = new Set<string>();
    const skipped: { pjId: string; name: string; reason: "sem_lote" | "sem_liquido" }[] = [];
    byPj.forEach((debts, pjId) => {
      const name = debts[0]?._company_name ?? "PJ";
      const pick = globalLoteByPj[pjId];
      if (!pick) { skipped.push({ pjId, name, reason: "sem_lote" }); return; }
      const lote = (globalLotesByPj[pjId] ?? []).find(o => o.id === pick);
      const parcela = parc > 0 ? debts.reduce((s, g) => s + Number(g.total_debt), 0) / parc : 0;
      if (lote?.liquido != null && lote.liquido < parcela) {
        skipped.push({ pjId, name, reason: "sem_liquido" });
        return;
      }
      eligible.add(pjId);
    });
    return { eligible, skipped };
  };

  const confirmGlobalMass = async () => {
    if (globalParc < 1 || globalParc > 24) { toast.error("Parcelas entre 1 e 24"); return; }
    const base = pendentes;
    const allTargets = selectedPending.size > 0 ? base.filter(g => selectedPending.has(g.id)) : base;
    const { eligible, skipped } = globalPjEligibility(allTargets, globalParc);
    const targets = allTargets.filter(g => eligible.has(g.company_id));
    if (targets.length === 0) {
      toast.error("Nenhuma PJ com lote-alvo e líquido suficiente. Os débitos seguem pendentes.");
      return;
    }
    setBusyGlobal(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;
    const nowIso = new Date().toISOString();
    let ok = 0; const errors: string[] = [];
    const successIds: string[] = [];
    const nextPaymentLabels: Record<string, string> = {};
    for (const g of targets) {
      const target = globalLoteByPj[g.company_id];
      const { error } = await (supabase as any).from("glosa_debts").update({
        parcelas_default: globalParc,
        target_payment_id: target,
        confirmed_at: g.confirmed_at ?? nowIso,
        confirmed_by: g.confirmed_at ? undefined : uid,
      }).eq("id", g.id);
      if (error) errors.push(`${g.doctor_name}: ${error.message}`); else {
        ok++;
        successIds.push(g.id);
        const lote = globalLotesByPj[g.company_id]?.find(l => l.id === target);
        if (lote) nextPaymentLabels[target] = lote.label;
      }
    }
    setBusyGlobal(false);
    const pendMsg = skipped.length
      ? ` · ${skipped.length} PJ(s) seguem pendentes (${skipped.filter(s => s.reason === "sem_lote").length} sem lote em aberto, ${skipped.filter(s => s.reason === "sem_liquido").length} sem líquido suficiente)`
      : "";
    if (errors.length) {
      toast.error(`${ok} confirmadas · ${errors.length} falharam${pendMsg}`);
      console.error("[global mass confirm]", errors);
    } else {
      toast.success(`${ok} débito(s) confirmado(s) em ${globalParc}×${pendMsg}`);
    }
    setGlobalDialogOpen(false);
    setSelectedPending(prev => {
      const next = new Set(prev);
      successIds.forEach(id => next.delete(id));
      return next;
    });
    if (Object.keys(nextPaymentLabels).length) {
      setPaymentLabels(prev => ({ ...prev, ...nextPaymentLabels }));
    }
    if (successIds.length) {
      setGlosaDebts(prev => prev.map(g => successIds.includes(g.id)
        ? { ...g, parcelas_default: globalParc, target_payment_id: globalLoteByPj[g.company_id], confirmed_at: g.confirmed_at ?? nowIso }
        : g
      ));
      // Dispara apply-company-deductions em paralelo, deduplicado por (payment_id, company_id).
      const pairs = new Map<string, { payment_id: string; company_id: string }>();
      for (const g of targets) {
        if (!successIds.includes(g.id)) continue;
        const payId = globalLoteByPj[g.company_id];
        if (!payId) continue;
        pairs.set(`${payId}|${g.company_id}`, { payment_id: payId, company_id: g.company_id });
      }
      // Cap concurrency (mesmo motivo do executeApplyCurrentLote).
      void (async () => {
        const list = Array.from(pairs.values());
        const CONC = 4;
        for (let i = 0; i < list.length; i += CONC) {
          const chunk = list.slice(i, i + CONC);
          await Promise.allSettled(chunk.map(p =>
            supabase.functions.invoke("apply-company-deductions", { body: p })
              .catch((err) => console.warn("[confirmGlobalMass] apply-company-deductions falhou:", err?.message))
          ));
        }
      })();
      void logDeductionEvents(successIds
        .map(id => {
          const g = targets.find(t => t.id === id);
          const payId = g ? globalLoteByPj[g.company_id] : null;
          if (!g || !payId) return null;
          return {
            hospital_id: activeHospitalId,
            payment_id: payId,
            company_id: g.company_id,
            debt_id: g.id,
            action: "applied" as const,
            reason: `Confirmação global em massa (${globalParc}×)`,
            metadata: { source: "confirmGlobalMass", parcelas: globalParc },
          };
        })
        .filter(Boolean) as any);
    }

  };

  // ============ Agrupamento por PJ ============
  const groupByPj = (list: GlosaDebt[]) => {
    const m = new Map<string, GlosaDebt[]>();
    list.forEach(g => { const arr = m.get(g.company_id) ?? []; arr.push(g); m.set(g.company_id, arr); });
    return Array.from(m.entries()).sort((a, b) => {
      const na = a[1][0]?._company_name ?? ""; const nb = b[1][0]?._company_name ?? "";
      return na.localeCompare(nb);
    });
  };

  const isGroupOpen = (pjId: string, groupCount: number) => {
    if (openGroups[pjId] !== undefined) return openGroups[pjId];
    return groupCount <= 5; // auto-fecha quando muitas PJs
  };

  // Lote "liquidado" = a dedução já foi consumada (não recebe mais deduções novas);
  // débitos aplicados nele podem ser arquivados na visão de andamento.
  // NÃO inclui aprovado_em_revisao/revisao_pos_aprovacao (ainda recebe deduções)
  // nem cancelado/rejeitado (dedução não é consumada).
  // Valores conferidos contra o enum payment_status.
  const LOTE_LIQUIDADO_STATUSES = new Set([
    "aprovado", "aprovado_com_ressalva", "aprovado_parcial",
    "pago", "lancado", "arquivado",
    "pedido_nf_enviado", "nf_recebida", "nf_conciliada",
    "nf_questionada", "nf_divergente",
  ]);
  const isPaymentLiquidado = (payId: string | null | undefined) =>
    !!payId && LOTE_LIQUIDADO_STATUSES.has((paymentStatuses[payId] ?? "").toLowerCase());

  // Grupo (PJ) arquivado quando toda dívida está quitada em lote finalizado
  // (independe do target_payment_id atual — que pode ter migrado para lote
  // aberto após acréscimo via upsert de glosa).
  const isGroupArchived = (list: GlosaDebt[]) =>
    list.length > 0 && list.every(g => isDebtArchivable(g));


  // ============ RENDER ============
  const kpiCard = (label: string, value: string, tone?: string, hint?: string) => (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold font-mono ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Créditos e Débitos"
        description="Ajustes financeiros por PJ — aplicados nos próximos pagamentos."
        icon={Scale}
      />

      <div className="p-4 md:p-6 space-y-4">
        {/* Ações do relatório */}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => openAudit({ title: "Histórico de aplicações" })}>
            <History className="w-3.5 h-3.5 mr-1.5" />
            Histórico
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={exporting !== null}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {exporting === "pdf" ? "Gerando PDF…" : exporting === "xlsx" ? "Gerando Excel…" : "Exportar relatório"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => handleExport("xlsx")} disabled={exporting !== null}>
                <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" />
                <div className="flex-1">
                  <div className="text-sm font-medium">Excel (.xlsx)</div>
                  <div className="text-[11px] text-muted-foreground">Planilhas por seção</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExport("pdf")} disabled={exporting !== null}>
                <FileText className="w-4 h-4 mr-2 text-red-600" />
                <div className="flex-1">
                  <div className="text-sm font-medium">PDF executivo</div>
                  <div className="text-[11px] text-muted-foreground">KPIs + tabelas paginadas</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {kpiCard("A confirmar", brl(kpi.totalPendente), "text-destructive", `${pendentes.length} glosa(s)`)}
          {kpiCard("Em andamento", brl(kpi.totalAndamento), "text-amber-600", `${emAndamento.length} débito(s)`)}
          {kpiCard("Aplicado no mês", brl(kpi.aplicadoMes), "text-emerald-600")}
          {kpiCard("Sem lote-alvo", String(kpi.semLote), kpi.semLote > 0 ? "text-amber-600" : "", "risco de não aplicar")}
        </div>


        {/* Filtros */}
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar por PJ, médico, CRM, lote…"
                  value={search}
                  onChange={(e) => updateParam("q", e.target.value)}
                />
              </div>
              <Select value={period} onValueChange={(v) => updateParam("period", v)}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todo o período</SelectItem>
                  <SelectItem value="current_month">Este mês</SelectItem>
                  <SelectItem value="last_month">Mês passado</SelectItem>
                  <SelectItem value="last_90">Últimos 90 dias</SelectItem>
                  <SelectItem value="current_year">Este ano</SelectItem>
                </SelectContent>
              </Select>
              <Select value={pjFilter} onValueChange={(v) => updateParam("pj", v)}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="PJ" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as PJs</SelectItem>
                  {pjOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {(tab === "pendentes" || tab === "andamento") && (
                <>
                  <Select value={ccFilter} onValueChange={(v) => updateParam("cc", v)}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="Centro de custo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos CCs</SelectItem>
                      {ccOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={trackFilter} onValueChange={(v) => updateParam("track", v)}>
                    <SelectTrigger className="w-[140px]"><SelectValue placeholder="Trilha" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas trilhas</SelectItem>
                      {trackOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
              {tab === "ajustes" && (
                <Select value={tipoFilter} onValueChange={(v) => updateParam("tipo", v)}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="credito">Crédito</SelectItem>
                    <SelectItem value="debito">Débito</SelectItem>
                    <SelectItem value="glosa_parcelada">Glosa parcelada</SelectItem>
                    <SelectItem value="acordo">Acordo</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {hasAnyFilter && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="w-3.5 h-3.5 mr-1" /> Limpar filtros
                </Button>
              )}
            </div>
            {hasAnyFilter && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Filter className="w-3 h-3" /> Filtros ativos — resultados abaixo já são o recorte filtrado.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => updateParam("tab", v)}>
          <TabsList className="flex flex-wrap h-auto gap-1 justify-start">
            <TabsTrigger value="pendentes" className="group">
              A confirmar
              <Badge variant="outline" className="ml-1.5 bg-background/60 text-foreground border-border group-data-[state=active]:bg-primary-foreground/20 group-data-[state=active]:text-primary-foreground group-data-[state=active]:border-primary-foreground/40">
                {pendentes.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="andamento" className="group">
              Em andamento
              <Badge variant="outline" className="ml-1.5 bg-background/60 text-foreground border-border group-data-[state=active]:bg-primary-foreground/20 group-data-[state=active]:text-primary-foreground group-data-[state=active]:border-primary-foreground/40">
                {emAndamento.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="ajustes" className="group">
              Ajustes manuais
              <Badge variant="outline" className="ml-1.5 bg-background/60 text-foreground border-border group-data-[state=active]:bg-primary-foreground/20 group-data-[state=active]:text-primary-foreground group-data-[state=active]:border-primary-foreground/40">
                {ajustesFiltrados.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="historico" className="group">
              Histórico aplicado
              <Badge variant="outline" className="ml-1.5 bg-background/60 text-foreground border-border group-data-[state=active]:bg-primary-foreground/20 group-data-[state=active]:text-primary-foreground group-data-[state=active]:border-primary-foreground/40">
                {historicoRows.length}
              </Badge>
            </TabsTrigger>
          </TabsList>


          {/* === PENDENTES === */}
          <TabsContent value="pendentes" className="space-y-3 mt-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : pendentes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma glosa {hasAnyFilter ? "no recorte filtrado" : "pendente"}.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border border-primary/30 bg-primary/5 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedPending.size === pendentes.length && pendentes.length > 0}
                      onCheckedChange={(checked) => setSelectedPending(checked ? new Set(pendentes.map(g => g.id)) : new Set())}
                    />
                    <span className="text-sm font-medium">Selecionar todas ({pendentes.length})</span>
                    {selectedPending.size > 0 && (
                      <span className="text-xs text-muted-foreground">
                        · {selectedPending.size} sel. · {brl(pendentes.filter(g => selectedPending.has(g.id)).reduce((s, g) => s + Number(g.total_debt), 0))}
                      </span>
                    )}
                  </div>
                  <Button size="sm" onClick={openGlobalMass}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    Confirmar {selectedPending.size > 0 ? `${selectedPending.size} selecionadas` : "todas do recorte"} em massa
                  </Button>
                </div>

                {(() => {
                  const groups = groupByPj(pendentes);
                  return groups.map(([pjId, list]) => {
                    const pjName = list[0]?._company_name ?? "PJ";
                    const selectedHere = list.filter(g => selectedPending.has(g.id));
                    const allSelected = selectedHere.length === list.length && list.length > 0;
                    const totalGrupo = list.reduce((s, g) => s + Number(g.total_debt), 0);
                    const isOpen = isGroupOpen(pjId, groups.length);
                    return (
                      <Collapsible key={pjId} open={isOpen} onOpenChange={(o) => setOpenGroups(s => ({ ...s, [pjId]: o }))} className="border border-border rounded-md">
                        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b">
                          <div className="flex items-center gap-2 min-w-0">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={(checked) => setSelectedPending(prev => {
                                const next = new Set(prev);
                                list.forEach(g => checked ? next.add(g.id) : next.delete(g.id));
                                return next;
                              })}
                            />
                            <CollapsibleTrigger className="flex items-center gap-2 min-w-0 hover:opacity-80">
                              {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                              <span className="font-medium text-sm truncate">{pjName}</span>
                            </CollapsibleTrigger>
                            <Badge variant="outline">{list.length}</Badge>
                            <span className="text-xs text-muted-foreground font-mono">{brl(totalGrupo)}</span>
                            {selectedHere.length > 0 && (
                              <span className="text-xs text-primary">· {selectedHere.length} sel.</span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            disabled={selectedHere.length < 2}
                            onClick={() => { setMassDialogPjId(pjId); setMassParc(1); setMassLotePick(""); loadOpenLotes(pjId); }}
                            title={selectedHere.length < 2 ? "Selecione 2+ glosas desta PJ" : "Parcelar e confirmar em massa"}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Confirmar em massa ({selectedHere.length})
                          </Button>
                        </div>
                        <CollapsibleContent>
                          <div className="divide-y">
                            {list.map(g => {
                              const parc = g.parcelas_default ?? 1;
                              const checked = selectedPending.has(g.id);
                              return (
                                <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) => setSelectedPending(prev => {
                                      const next = new Set(prev);
                                      v ? next.add(g.id) : next.delete(g.id);
                                      return next;
                                    })}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-sm">{g.doctor_name}</span>
                                      {g.doctor_crm && <span className="text-xs text-muted-foreground">CRM {g.doctor_crm}</span>}
                                      {g._origem_cc && <Badge variant="outline" className="text-[10px]">CC {g._origem_cc}</Badge>}
                                    </div>
                                    <div className="text-xs mt-0.5">
                                      <span className="font-mono text-destructive">{brl(g.total_debt)}</span>
                                      {" · "}
                                      <span className="text-amber-600 font-medium">sugestão {parc}× de {brl(g.total_debt / parc)}</span>
                                    </div>
                                  </div>
                                  <div className="flex gap-1 shrink-0">
                                    <Button size="sm" onClick={() => openGlosa(g)}>
                                      <Pencil className="w-3.5 h-3.5 mr-1" /> Parcelar e confirmar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => revertGlosa(g)}
                                      title="Cancelar esta glosa e devolvê-la à conciliação"
                                    >
                                      Reverter
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  });
                })()}
              </>
            )}
          </TabsContent>

          {/* === EM ANDAMENTO === */}
          <TabsContent value="andamento" className="space-y-2 mt-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : emAndamento.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum débito em andamento {hasAnyFilter ? "no recorte filtrado" : ""}.</p>
            ) : (
              <>
                {(() => {
                  const pendingCount = emAndamento.filter(g => !isDebtSettled(g) && (!g.target_payment_id || !debtAppliedAt(g.id, g.target_payment_id))).length;
                  const appliedCount = emAndamento.length - pendingCount;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2 border border-emerald-500/30 bg-emerald-500/5 rounded-md px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Aplica no lote em aberto mais recente de cada PJ. Débitos já aplicados são ignorados automaticamente (idempotente).
                        {appliedCount > 0 && (
                          <span className="ml-2 text-emerald-700 dark:text-emerald-400 font-medium">
                            ✓ {appliedCount} já aplicado{appliedCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => openApplyCurrentDialog()}
                        disabled={applyingCurrent !== null || pendingCount === 0}
                      >
                        <Rocket className="w-3.5 h-3.5 mr-1" />
                        {applyingCurrent === "__all__"
                          ? "Aplicando…"
                          : pendingCount === 0
                            ? `Tudo aplicado (${appliedCount})`
                            : `Aplicar no lote vigente (${pendingCount}${appliedCount ? ` · ${appliedCount} já aplic.` : ""})`}
                      </Button>
                    </div>
                  );
                })()}
                {(() => {
                const allGroups = groupByPj(emAndamento);
                const activeGroups = allGroups.filter(([, list]) => !isGroupArchived(list));
                const archivedGroups = allGroups.filter(([, list]) => isGroupArchived(list));
                const renderGroup = (pjId: string, list: GlosaDebt[], groupCount: number, archived: boolean) => {
                  const pjName = list[0]?._company_name ?? "PJ";
                  const total = list.reduce((s, g) => s + Number(g.total_debt), 0);
                  // Arquivados: colapsados por default (ignora auto-open por cardinalidade)
                  const isOpen = openGroups[pjId] !== undefined ? openGroups[pjId] : (archived ? false : isGroupOpen(pjId, groupCount));
                  const pjPending = list.filter(g => !isDebtSettled(g) && (!g.target_payment_id || !debtAppliedAt(g.id, g.target_payment_id))).length;
                  const pjApplied = list.length - pjPending;

                  return (
                    <Collapsible key={pjId} open={isOpen} onOpenChange={(o) => setOpenGroups(s => ({ ...s, [pjId]: o }))} className={`border rounded-md ${archived ? "border-border/60 bg-muted/20" : "border-border"}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2 bg-muted/30 border-b">
                        <CollapsibleTrigger className="flex-1 flex items-center gap-2 min-w-0 hover:opacity-80 text-left">
                          {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                          <span className={`font-medium text-sm truncate flex-1 min-w-0 ${archived ? "text-muted-foreground" : ""}`}>{pjName}</span>
                          <Badge variant="outline" className="shrink-0">{list.length}</Badge>
                          {archived ? (
                            <Badge className="bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30 shrink-0 whitespace-nowrap">
                              🗄 Arquivado (lote finalizado)
                            </Badge>
                          ) : pjApplied > 0 && (
                            <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/30 shrink-0 whitespace-nowrap">
                              ✓ {pjApplied} aplicado{pjApplied > 1 ? "s" : ""}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground font-mono shrink-0 whitespace-nowrap">{brl(total)}</span>
                        </CollapsibleTrigger>
                        {!archived && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); openApplyCurrentDialog(pjId); }}
                            disabled={applyingCurrent !== null || pjPending === 0}
                            className="w-full sm:w-auto shrink-0 whitespace-nowrap"
                          >
                            <Rocket className="w-3.5 h-3.5 mr-1 shrink-0" />
                            {applyingCurrent === pjId
                              ? "Aplicando…"
                              : pjPending === 0
                                ? `Tudo aplicado (${pjApplied})`
                                : `Aplicar (${pjPending}${pjApplied ? ` · ${pjApplied} já aplic.` : ""})`}
                          </Button>
                        )}
                      </div>


                      <CollapsibleContent>
                        <div className="divide-y">
                          {list.map(g => {
                            const parc = g.parcelas_default ?? 1;
                            const applied = debtAppliedAt(g.id, g.target_payment_id);
                            const allApps = debtEffectiveApps(g.id);
                            const totalApplied = debtTotalApplied(g.id);
                            const residual = Math.max(0, Number(g.total_debt || 0) - totalApplied);
                            const settled = isDebtSettled(g);
                            const otherApps = allApps.filter(a => a.payment_id !== g.target_payment_id);
                            return (
                              <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-sm">{g.doctor_name}</span>
                                    {g.doctor_crm && <span className="text-xs text-muted-foreground">CRM {g.doctor_crm}</span>}
                                    {settled ? (
                                      <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/30 text-[10px]">
                                        ✓ Quitada ({brl(totalApplied)})
                                      </Badge>
                                    ) : applied ? (
                                      applied.status === "postponed" ? (
                                        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px]">
                                          ⏳ Adiada ({applied.postpone_reason === "sem_producao" ? "sem produção" : applied.postpone_reason === "insufficient_net" ? "saldo insuficiente" : applied.postpone_reason ?? "aguardando ciclo"})
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/30 text-[10px]">
                                          ✓ Aplicado ({applied.status})
                                        </Badge>
                                      )
                                    ) : totalApplied > 0 ? (
                                      <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 text-[10px]">
                                        ◐ Parcial ({brl(totalApplied)} de {brl(g.total_debt)})
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="text-xs mt-0.5">
                                    <span className="font-mono text-destructive">{brl(g.total_debt)}</span>{" · "}
                                    <span>{parc}× de {brl(g.total_debt / parc)}</span>
                                    {g.confirmed_at && (
                                      <span className="ml-2 text-[10px] text-muted-foreground">
                                        confirmado {new Date(g.confirmed_at).toLocaleDateString("pt-BR")}
                                      </span>
                                    )}
                                  </div>
                                  {otherApps.length > 0 && (
                                    <div className="text-[11px] mt-0.5 text-muted-foreground">
                                      Aplicações anteriores:{" "}
                                      {otherApps.map((a, i) => (
                                        <span key={a.payment_id + i}>
                                          {i > 0 && " · "}
                                          <span className="text-emerald-700 dark:text-emerald-400">
                                            {paymentLabels[a.payment_id] ?? a.payment_id.slice(0, 8)} — {brl(a.valor_aplicado)}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="text-[11px] mt-0.5">
                                    {settled ? (
                                      <span className="text-emerald-600">✓ dívida totalmente quitada</span>
                                    ) : g.target_payment_id ? (
                                      applied ? (
                                        <span className="text-emerald-600">
                                          ✓ aplicado em: {paymentLabels[g.target_payment_id] ?? g.target_payment_id.slice(0, 8)}
                                          {applied.valor_aplicado > 0 && ` — ${brl(applied.valor_aplicado)}`}
                                          {residual > 0 && (
                                            <span className="ml-1 text-amber-600">· residual {brl(residual)}</span>
                                          )}
                                        </span>
                                      ) : (
                                        <span className="text-emerald-600">
                                          → lote-alvo: {paymentLabels[g.target_payment_id] ?? g.target_payment_id.slice(0, 8)}
                                          {residual > 0 && residual < Number(g.total_debt) && (
                                            <span className="ml-1 text-amber-600">· residual a aplicar {brl(residual)}</span>
                                          )}
                                        </span>
                                      )

                                    ) : (
                                      <span className="text-amber-600">⚠ sem lote-alvo definido — não será aplicado</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="outline" onClick={() => openGlosa(g)}>
                                    <Pencil className="w-3.5 h-3.5 mr-1" /> Reparcelar
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => reopenGlosa(g)}>Reabrir</Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => revertGlosa(g)}
                                    title="Cancelar esta glosa e devolvê-la à conciliação"
                                  >
                                    Reverter
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                };
                return (
                  <>
                    {activeGroups.map(([pjId, list]) => renderGroup(pjId, list, activeGroups.length, false))}
                    {archivedGroups.length > 0 && (
                      <div className="flex items-center justify-between gap-2 mt-3 px-2 py-1.5 border-t border-dashed">
                        <span className="text-xs text-muted-foreground">
                          🗄 {archivedGroups.length} PJ{archivedGroups.length > 1 ? "s" : ""} arquivada{archivedGroups.length > 1 ? "s" : ""} (100% aplicado em lote finalizado)
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => setShowArchived(v => !v)} className="h-7 text-xs">
                          {showArchived ? "Ocultar arquivados" : "Mostrar arquivados"}
                        </Button>
                      </div>
                    )}
                    {showArchived && archivedGroups.map(([pjId, list]) => renderGroup(pjId, list, archivedGroups.length, true))}
                  </>
                );
              })()}
              </>
            )}
          </TabsContent>


          {/* === AJUSTES MANUAIS === */}
          <TabsContent value="ajustes" className="space-y-2 mt-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => openAdj()}><Plus className="w-4 h-4 mr-1" /> Novo ajuste</Button>
            </div>
            {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
              : ajustesFiltrados.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum ajuste {hasAnyFilter ? "no recorte filtrado" : "cadastrado"}.</p>
              : ajustesFiltrados.map(a => {
                const apps = appsByAdj[a.id] ?? [];
                const ativas = apps.filter(x => x.status !== "revertido");
                const aplicadasCount = ativas.length;
                const revertidasCount = apps.length - ativas.length;
                const isOpen = !!historyOpen[a.id];
                const deleting = deletingAdjIds.has(a.id);
                return (
                  <div key={a.id} className="border border-border rounded-md px-3 py-2">
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={a.tipo === "credito" ? "default" : "secondary"}>{a.tipo}</Badge>
                          <span className="font-medium text-sm">{a._company_name}</span>
                          {a.recorrente && <Badge variant="outline" className="text-[10px]">Fixo mensal</Badge>}
                          {a.cost_center?.code_p12 && (
                            <Badge variant="outline" className="text-[10px]" title={a.cost_center.level5 || a.cost_center.level4 || ""}>
                              Só no CC {a.cost_center.code_p12}
                            </Badge>
                          )}
                          {!a.ativo && <Badge variant="outline">Inativo</Badge>}
                          {(() => {
                            const ids = a.payment_model_ids ?? [];
                            if (ids.length === 0) return null;
                            return (
                              <Badge variant="outline" className="text-[10px]">
                                Só em: {ids.map(id => paymentModels.find(p => p.id === id)?.label ?? "—").join(", ")}
                              </Badge>
                            );
                          })()}
                        </div>
                        <p className="text-xs text-muted-foreground">{a.descricao}</p>
                        <p className="text-xs">
                          {a.recorrente
                            ? <>{brl(a.valor_total)} / mês{a.data_fim ? ` · até ${a.data_fim}` : " · sem fim definido"} · início {a.data_inicio} · <span className="text-muted-foreground">{aplicadasCount} mês(es) aplicado(s)</span></>
                            : <>{brl(a.valor_total)} · parc. <span className="font-medium">{aplicadasCount}/{a.parcelas_total}</span> aplicada(s) · início {a.data_inicio}</>}
                          {revertidasCount > 0 && <span className="text-muted-foreground"> · {revertidasCount} revertida(s)</span>}
                        </p>
                      </div>
                      <div className="flex gap-1 items-center">
                        <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(s => ({ ...s, [a.id]: !s[a.id] }))} title="Histórico">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          <span className="ml-1 text-xs">{apps.length}</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openAdj(a)} disabled={deleting}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => removeAdj(a.id)} disabled={deleting}>
                          <Trash2 className={`w-4 h-4 ${deleting ? "text-muted-foreground" : "text-destructive"}`} />
                        </Button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="mt-2 border-t pt-2 space-y-1">
                        {apps.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">Nenhuma aplicação registrada ainda.</p>
                        ) : apps.map(ap => {
                          const isRev = ap.status === "revertido";
                          return (
                            <div key={ap.id} className={`text-xs flex items-center justify-between gap-2 rounded px-2 py-1 ${isRev ? "bg-muted/30 line-through text-muted-foreground" : "bg-muted/10"}`}>
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <Badge variant={isRev ? "outline" : ap.status === "confirmado" || ap.status === "pago" ? "default" : "secondary"} className="text-[10px]">
                                  {ap.status}
                                </Badge>
                                <span className="font-mono">parc. {ap.parcela_numero ?? "—"}</span>
                                <span className="font-mono">{brl(Number(ap.valor_aplicado))}</span>
                                <span className="truncate">→ lote {paymentLabels[ap.payment_id] ?? ap.payment_id.slice(0, 8)}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {ap.confirmed_at ? `confirmado ${new Date(ap.confirmed_at).toLocaleDateString("pt-BR")}` :
                                  ap.reverted_at ? `revertido ${new Date(ap.reverted_at).toLocaleDateString("pt-BR")}` :
                                  ap.applied_at ? `proposto ${new Date(ap.applied_at).toLocaleDateString("pt-BR")}` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            }
          </TabsContent>

          {/* === HISTÓRICO APLICADO === */}
          <TabsContent value="historico" className="space-y-1 mt-3">
            {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
              : historicoRows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma aplicação {hasAnyFilter ? "no recorte filtrado" : "registrada"}.</p>
              : (
                <div className="border border-border rounded-md divide-y">
                  {historicoRows.slice(0, 500).map(ap => {
                    const isRev = ap.status === "revertido";
                    return (
                      <div key={ap.id} className={`text-xs flex items-center justify-between gap-2 px-3 py-2 ${isRev ? "bg-muted/20" : ""}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={isRev ? "outline" : "default"} className="text-[10px]">{ap.status}</Badge>
                            <span className="font-medium text-sm">{ap._adj?._company_name ?? "—"}</span>
                            <span className="text-muted-foreground">· {ap._adj?.descricao}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                            <span className="font-mono">{brl(Number(ap.valor_aplicado))}</span>
                            <span>· parc. {ap.parcela_numero ?? "—"}</span>
                            <span className="truncate">· lote {paymentLabels[ap.payment_id] ?? ap.payment_id.slice(0, 8)}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {ap.confirmed_at ? `confirmado ${new Date(ap.confirmed_at).toLocaleDateString("pt-BR")}` :
                            ap.reverted_at ? `revertido ${new Date(ap.reverted_at).toLocaleDateString("pt-BR")}` :
                            ap.applied_at ? `proposto ${new Date(ap.applied_at).toLocaleDateString("pt-BR")}` : ""}
                        </span>
                      </div>
                    );
                  })}
                  {historicoRows.length > 500 && (
                    <div className="text-xs text-muted-foreground p-3 text-center">
                      Mostrando 500 de {historicoRows.length} — refine os filtros para ver menos.
                    </div>
                  )}
                </div>
              )
            }
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialog: editar parcelas de glosa */}
      <Dialog open={!!editingGlosa} onOpenChange={(o) => !o && setEditingGlosa(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingGlosa?.confirmed_at ? "Reparcelar glosa" : "Confirmar débito"}</DialogTitle></DialogHeader>
          {editingGlosa && (
            <div className="space-y-3 text-sm">
              <div className="rounded border border-border bg-muted/30 px-3 py-2">
                <div className="font-medium">{editingGlosa.doctor_name}</div>
                <div className="text-xs text-muted-foreground">{editingGlosa._company_name}</div>
                <div className="mt-1 font-mono text-destructive">{brl(editingGlosa.total_debt)}</div>
              </div>
              <div>
                <Label>Parcelas (1–24)</Label>
                <Input type="number" min={1} max={24} value={glosaParc}
                  onChange={e => setGlosaParc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))} />
                <p className="text-xs text-muted-foreground mt-1">
                  Cada parcela: <span className="font-mono">{brl(editingGlosa.total_debt / glosaParc)}</span>
                </p>
              </div>
              <div>
                <Label>Lote-alvo (onde a parcela será aplicada)</Label>
                <Select value={lotePick} onValueChange={setLotePick} disabled={loadingLotes}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingLotes ? "Carregando lotes…" : "Selecione um lote em aberto"} />
                  </SelectTrigger>
                  <SelectContent>
                    {openLotes.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum lote em aberto encontrado para esta PJ.</div>
                    ) : (
                      openLotes.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  O motor só desconta a parcela quando o lote em execução for este.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGlosa(null)} disabled={busyGlosa}>Cancelar</Button>
            <Button onClick={saveGlosa} disabled={busyGlosa}>
              {busyGlosa ? "Salvando…" : (editingGlosa?.confirmed_at ? "Salvar parcelamento" : "Confirmar débito")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: confirmação em massa por PJ */}
      <Dialog open={!!massDialogPjId} onOpenChange={(o) => !o && setMassDialogPjId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirmar {massTargets.length} débitos em massa</DialogTitle>
          </DialogHeader>
          {massDialogPjId && (
            <div className="space-y-3 text-sm">
              <div className="rounded border border-border bg-muted/30 px-3 py-2">
                <div className="font-medium">{glosaDebts.find(g => g.company_id === massDialogPjId)?._company_name ?? "PJ"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{massTargets.length} médicos selecionados</div>
                <div className="mt-1 font-mono text-destructive">Total: {brl(massTotal)}</div>
              </div>
              <div>
                <Label>Parcelas (1–24) — aplicado a todos</Label>
                <Input type="number" min={1} max={24} value={massParc}
                  onChange={e => setMassParc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))} />
                <p className="text-xs text-muted-foreground mt-1">
                  Soma das parcelas por ciclo: <span className="font-mono">{brl(massParcelaSoma)}</span>
                </p>
              </div>
              <div>
                <Label>Lote-alvo (aplicado a todos)</Label>
                <Select value={massLotePick} onValueChange={setMassLotePick} disabled={loadingLotes}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingLotes ? "Carregando lotes…" : "Selecione um lote em aberto"} />
                  </SelectTrigger>
                  <SelectContent>
                    {openLotes.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum lote em aberto encontrado para esta PJ.</div>
                    ) : (
                      openLotes.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
                {massCabe != null && (
                  <p className={`text-xs mt-1 ${massCabe >= 0 ? "text-emerald-600" : "text-amber-600"}`}>
                    {massCabe >= 0
                      ? `Cabe no lote (sobra ${brl(massCabe)} de líquido).`
                      : `⚠ Não cabe: parcela excede o líquido em ${brl(-massCabe)}. O motor vai aplicar o que couber e postergar o resto.`}
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMassDialogPjId(null)} disabled={busyMass}>Cancelar</Button>
            <Button onClick={confirmMass} disabled={busyMass || !massLotePick}>
              {busyMass ? "Confirmando…" : `Confirmar ${massTargets.length} débitos`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: confirmação global (todas as PJs do recorte) */}
      <Dialog open={globalDialogOpen} onOpenChange={setGlobalDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirmar débitos em massa (recorte atual)</DialogTitle>
          </DialogHeader>
          {(() => {
            const base = pendentes;
            const targets = selectedPending.size > 0 ? base.filter(g => selectedPending.has(g.id)) : base;
            const byPj = new Map<string, GlosaDebt[]>();
            targets.forEach(g => { const arr = byPj.get(g.company_id) ?? []; arr.push(g); byPj.set(g.company_id, arr); });
            return (
              <div className="space-y-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  Aplicando em {targets.length} glosa(s) de {byPj.size} PJ(s), respeitando os filtros atuais.
                </div>
                <div>
                  <Label>Parcelas (1–24) — aplicado a todas as PJs</Label>
                  <Input type="number" min={1} max={24} value={globalParc}
                    onChange={e => setGlobalParc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))} />
                </div>
                <div className="border border-border rounded-md">
                  <div className="grid grid-cols-[1fr_auto_2fr_auto] gap-2 px-3 py-2 bg-muted/40 text-xs font-medium border-b">
                    <div>PJ</div><div className="text-right">Total</div><div>Lote-alvo</div><div>Cabe?</div>
                  </div>
                  <div className="divide-y max-h-[45vh] overflow-y-auto">
                    {Array.from(byPj.entries()).map(([pjId, list]) => {
                      const pjName = list[0]?._company_name ?? "PJ";
                      const total = list.reduce((s, g) => s + Number(g.total_debt), 0);
                      const parcelaSoma = globalParc > 0 ? total / globalParc : 0;
                      const opts = globalLotesByPj[pjId] ?? [];
                      const pick = globalLoteByPj[pjId] ?? "";
                      const loteObj = opts.find(o => o.id === pick);
                      const cabe = loteObj?.liquido == null ? null : (loteObj.liquido - parcelaSoma);
                      return (
                        <div key={pjId} className="grid grid-cols-[1fr_auto_2fr_auto] gap-2 px-3 py-2 items-center">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{pjName}</div>
                            <div className="text-[11px] text-muted-foreground">{list.length} médicos</div>
                          </div>
                          <div className="text-right font-mono text-destructive text-xs">{brl(total)}</div>
                          <div>
                            {opts.length === 0 ? (
                              <span className="text-xs text-amber-600">Sem lote em aberto</span>
                            ) : (
                              <Select value={pick} onValueChange={(v) => { setGlobalLoteByPj(prev => ({ ...prev, [pjId]: v })); void ensureLoteLiquido(pjId, v); }}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                                <SelectContent>
                                  {opts.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          <div className="text-xs">
                            {!pick ? (
                              <span className="text-amber-600">fica pendente</span>
                            ) : cabe == null ? "—" : cabe >= 0
                              ? <span className="text-emerald-600">✓ {brl(cabe)}</span>
                              : <span className="text-amber-600">⚠ falta {brl(-cabe)} · fica pendente</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  ⚠ PJs sem lote em aberto ou sem líquido suficiente para a parcela não são confirmadas — os débitos permanecem pendentes para o próximo ciclo. Lotes já em validação/aprovação não são sugeridos automaticamente (só se você escolher).
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGlobalDialogOpen(false)} disabled={busyGlobal}>Cancelar</Button>
            <Button onClick={confirmGlobalMass} disabled={busyGlobal}>
              {busyGlobal ? "Confirmando…" : (() => {
                const base = pendentes;
                const tg = selectedPending.size > 0 ? base.filter(g => selectedPending.has(g.id)) : base;
                const { eligible } = globalPjEligibility(tg, globalParc);
                const n = tg.filter(g => eligible.has(g.company_id)).length;
                return `Confirmar elegíveis (${n})`;
              })()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Aplicar no lote vigente — seleção obrigatória (multi-usuário) */}
      <Dialog open={applyDialogOpen} onOpenChange={(o) => { if (!applyingCurrent) setApplyDialogOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Selecionar lote-alvo</DialogTitle>
          </DialogHeader>
          {(() => {
            const scope = applyDialogScopePj
              ? emAndamento.filter(g => g.company_id === applyDialogScopePj)
              : emAndamento;
            const byPj = new Map<string, GlosaDebt[]>();
            scope.forEach(g => { const arr = byPj.get(g.company_id) ?? []; arr.push(g); byPj.set(g.company_id, arr); });
            const pjEntries = Array.from(byPj.entries());
            const anyMissingPick = pjEntries.some(([pj, list]) => {
              const opts = applyLotesByPj[pj] ?? [];
              return opts.length > 0 && !applyPickByPj[pj];
            });
            return (
              <div className="space-y-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  {applyLoading
                    ? "Carregando lotes abertos por PJ…"
                    : `Escolha o lote de destino para ${pjEntries.length} PJ(s). Nada é aplicado até você confirmar.`}
                </div>
                <div className="border border-border rounded-md">
                  <div className="grid grid-cols-[1.2fr_auto_2fr] gap-2 px-3 py-2 bg-muted/40 text-xs font-medium border-b">
                    <div>PJ</div><div className="text-right">Total dívida</div><div>Lote-alvo</div>
                  </div>
                  <div className="divide-y max-h-[50vh] overflow-y-auto">
                    {pjEntries.map(([pjId, list]) => {
                      const pjName = list[0]?._company_name ?? "PJ";
                      const total = list.reduce((s, g) => s + Number(g.total_debt), 0);
                      const opts = applyLotesByPj[pjId] ?? [];
                      const pick = applyPickByPj[pjId] ?? "";
                      return (
                        <div key={pjId} className="grid grid-cols-[1.2fr_auto_2fr] gap-2 px-3 py-2 items-center">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{pjName}</div>
                            <div className="text-[11px] text-muted-foreground">{list.length} débito(s)</div>
                          </div>
                          <div className="text-right font-mono text-destructive text-xs">{brl(total)}</div>
                          <div>
                            {applyLoading ? (
                              <span className="text-xs text-muted-foreground">Carregando…</span>
                            ) : opts.length === 0 ? (
                              <span className="text-xs text-amber-600">Sem lote em aberto</span>
                            ) : (
                              <Select
                                value={pick}
                                onValueChange={(v) => setApplyPickByPj(prev => ({ ...prev, [pjId]: v }))}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Selecionar lote…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {opts.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {anyMissingPick && (
                  <p className="text-xs text-amber-600">
                    ⚠ Selecione o lote-alvo para todas as PJs elegíveis antes de confirmar.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Débitos já aplicados no lote escolhido são ignorados automaticamente (idempotente).
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyDialogOpen(false)} disabled={!!applyingCurrent}>
              Cancelar
            </Button>
            <Button
              onClick={() => executeApplyCurrentLote(applyPickByPj, applyDialogScopePj)}
              disabled={
                applyLoading ||
                !!applyingCurrent ||
                Object.keys(applyPickByPj).length === 0
              }
            >
              {applyingCurrent ? "Aplicando…" : "Confirmar e aplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Resultado detalhado da aplicação (vermelho quando há erro/postpone/partial) */}
      <Dialog
        open={resultDialog.open}
        onOpenChange={(o) => setResultDialog(s => ({ ...s, open: o }))}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {(() => {
            const hasFail = resultDialog.outcomes.some(o => !o.ok);
            const hasPend = resultDialog.outcomes.some(o => o.postponed > 0 || o.partial > 0);
            const isRed = hasFail;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className={isRed ? "text-destructive" : "text-amber-700 dark:text-amber-500"}>
                    {isRed ? "Erro ao aplicar débito no lote" : "Aplicação concluída com pendências"}
                  </DialogTitle>
                </DialogHeader>
                <div className={`rounded-md border p-3 text-sm ${isRed ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
                  {isRed
                    ? "Uma ou mais aplicações falharam. Nenhum débito é aplicado à revelia — revise os detalhes abaixo e a ação recomendada por PJ antes de tentar novamente."
                    : "Todas as aplicações foram processadas, mas há PJs sem líquido suficiente no lote escolhido. Os saldos rolam automaticamente para o próximo ciclo."}
                </div>
                <div className="mt-3 divide-y border rounded-md max-h-[55vh] overflow-y-auto">
                  {resultDialog.outcomes.map((o) => (
                    <div key={`${o.pj_id}-${o.payment_label}`} className="px-3 py-2 text-sm space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{o.pj_name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">Lote: {o.payment_label}</div>
                        </div>
                        <Badge variant={o.ok ? (o.postponed > 0 || o.partial > 0 ? "secondary" : "default") : "destructive"}>
                          {o.ok ? (o.postponed > 0 && o.applied === 0 && o.partial === 0 ? "Adiado" : o.partial > 0 ? "Parcial" : "Aplicado") : "Erro"}
                        </Badge>
                      </div>
                      <div className="text-xs flex flex-wrap gap-x-3 gap-y-0.5">
                        {o.applied > 0 && <span>✓ {o.applied} aplicado(s)</span>}
                        {o.partial > 0 && <span className="text-amber-600">◐ {o.partial} parcial</span>}
                        {o.postponed > 0 && <span className="text-amber-600">↷ {o.postponed} adiado(s)</span>}
                        {o.already > 0 && <span className="text-muted-foreground">↻ {o.already} já aplicado(s)</span>}
                        {o.capacidade != null && <span className="text-muted-foreground">líquido disp.: {brl(o.capacidade)}</span>}
                      </div>
                      {o.error && (
                        <div className="text-xs text-destructive font-mono bg-destructive/5 border border-destructive/20 rounded px-2 py-1">
                          {o.error}
                        </div>
                      )}
                      {o.hint && (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">O que fazer:</span> {o.hint}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setResultDialog({ open: false, outcomes: [] })}>Fechar</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>




      {/* Dialog: novo/editar ajuste manual */}
      <Dialog open={adjDialogOpen} onOpenChange={setAdjDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingAdj?.id ? "Editar ajuste" : "Novo crédito/débito"}</DialogTitle></DialogHeader>
          {editingAdj && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Empresa</Label>
                <Select value={editingAdj.company_id ?? ""} onValueChange={v => setEditingAdj({ ...editingAdj, company_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={editingAdj.tipo} onValueChange={(v: any) => setEditingAdj({ ...editingAdj, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credito">Crédito</SelectItem>
                    <SelectItem value="debito">Débito</SelectItem>
                    <SelectItem value="glosa_parcelada">Glosa parcelada</SelectItem>
                    <SelectItem value="acordo">Acordo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data início</Label>
                <DateInput value={editingAdj.data_inicio || ""} onChange={(v) => setEditingAdj({ ...editingAdj, data_inicio: v })} />
              </div>
              <div className="col-span-2">
                <Label>Descrição</Label>
                <Input value={editingAdj.descricao || ""} onChange={e => setEditingAdj({ ...editingAdj, descricao: e.target.value })} />
              </div>
              <div className="col-span-2 rounded-md border bg-muted/30 p-3 space-y-1.5">
                <Label className="text-xs">Centro de custos (filtro — opcional)</Label>
                <CostCenterCombobox
                  value={editingAdj._cc_code ?? null}
                  onChange={(code) => setEditingAdj({ ...editingAdj, _cc_code: code })}
                  placeholder="Qualquer centro (sem filtro)"
                />
                <p className="text-[11px] text-muted-foreground">
                  Vazio = aplica em qualquer lote da empresa. Preenchido = só será
                  sugerido em lotes deste centro de custos (uma única vez por competência).
                </p>
              </div>

              <div className="col-span-2 rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Switch checked={!!editingAdj.recorrente} onCheckedChange={v => setEditingAdj({ ...editingAdj, recorrente: v })} />
                  <Label className="cursor-pointer">Fixo mensal (recorrente, sem fim definido)</Label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {editingAdj.recorrente
                    ? "Aplica o valor abaixo como mensalidade fixa em todo lote elegível, até a data fim (se informada)."
                    : "Lançamento finito: divide o valor total em N parcelas e encerra ao final."}
                </p>
              </div>
              {editingAdj.recorrente ? (
                <>
                  <div>
                    <Label>Valor mensal (R$)</Label>
                    <CurrencyInput value={editingAdj.valor_total} onChange={(v) => setEditingAdj({ ...editingAdj, valor_total: v ?? 0 })} />
                  </div>
                  <div>
                    <Label>Data fim (opcional)</Label>
                    <DateInput value={editingAdj.data_fim || ""} onChange={(v) => setEditingAdj({ ...editingAdj, data_fim: v || null })} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label>Valor total (R$)</Label>
                    <CurrencyInput value={editingAdj.valor_total} onChange={(v) => setEditingAdj({ ...editingAdj, valor_total: v ?? 0 })} />
                  </div>
                  <div>
                    <Label>Parcelas total</Label>
                    <Input type="number" min={1} value={editingAdj.parcelas_total ?? 1} onChange={e => setEditingAdj({ ...editingAdj, parcelas_total: parseInt(e.target.value) || 1 })} />
                  </div>
                  <div>
                    <Label>Parcelas pagas</Label>
                    <Input type="number" min={0} value={editingAdj.parcelas_pagas ?? 0} onChange={e => setEditingAdj({ ...editingAdj, parcelas_pagas: parseInt(e.target.value) || 0 })} />
                  </div>
                </>
              )}
              <div className={editingAdj.recorrente ? "" : "col-span-2"}>
                <Label>Origem</Label>
                <Input value={editingAdj.origem || ""} onChange={e => setEditingAdj({ ...editingAdj, origem: e.target.value })} placeholder="ex: manual, glosa 03/2025" />
              </div>
              <div className="col-span-2 rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Aplicar somente em lotes do tipo</Label>
                  {(editingAdj.payment_model_ids?.length ?? 0) > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
                      onClick={() => setEditingAdj({ ...editingAdj, payment_model_ids: null })}>
                      Limpar (qualquer tipo)
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Vazio = aplica em qualquer lote da empresa. Marque para restringir somente aos tipos selecionados.
                </p>
                <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                  {paymentModels.map(pt => {
                    const cur = editingAdj.payment_model_ids ?? [];
                    const checked = cur.includes(pt.id);
                    return (
                      <label key={pt.id} className="flex items-center gap-2 text-xs rounded px-2 py-1 hover:bg-muted/50 cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => setEditingAdj({
                            ...editingAdj,
                            payment_model_ids: v
                              ? Array.from(new Set([...cur, pt.id]))
                              : cur.filter(id => id !== pt.id),
                          })}
                        />
                        <span className="truncate">{pt.label}</span>
                      </label>
                    );
                  })}
                  {paymentModels.length === 0 && (
                    <p className="text-xs text-muted-foreground italic col-span-2">Nenhum tipo de lote ativo cadastrado.</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <Switch checked={editingAdj.ativo ?? true} onCheckedChange={v => setEditingAdj({ ...editingAdj, ativo: v })} />
                <Label>Ativo (aplica em próximos pagamentos)</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjDialogOpen(false)} disabled={savingAdj}>Cancelar</Button>
            <Button onClick={saveAdj} disabled={savingAdj}>{savingAdj ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeductionAuditDialog
        open={auditOpen}
        onOpenChange={setAuditOpen}
        filter={{ hospital_id: activeHospitalId, ...auditFilter }}
        title={auditTitle}
        companyNameById={Object.fromEntries(companies.map(c => [c.id, c.name]))}
        paymentLabelById={paymentLabels}
      />

      {/* Diálogo de reversão de glosa — substitui window.prompt, bloqueado no preview em iframe. */}
      <Dialog open={!!revertTarget} onOpenChange={(o) => { if (!o && !reverting) { setRevertTarget(null); setRevertReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reverter glosa</DialogTitle>
          </DialogHeader>
          {revertTarget && (
            <div className="space-y-3 text-sm">
              <p>
                Reverter glosa de <strong>{revertTarget.doctor_name}</strong> ({brl(revertTarget.total_debt)}).
              </p>
              <p className="text-muted-foreground text-xs">
                A dívida e todas as deduções ativas serão canceladas. Se veio da conciliação e o lote de origem
                ainda está em análise, o item volta para "Só no Exacta".
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="revert-reason">Motivo (obrigatório)</Label>
                <Textarea
                  id="revert-reason"
                  value={revertReason}
                  onChange={(e) => setRevertReason(e.target.value)}
                  placeholder="Ex.: reclassificar como cancelamento de item na conciliação"
                  rows={3}
                  autoFocus
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevertTarget(null); setRevertReason(""); }} disabled={reverting}>
              Cancelar
            </Button>
            <Button onClick={confirmRevertGlosa} disabled={reverting || !revertReason.trim()}>
              {reverting ? "Revertendo…" : "Reverter glosa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
