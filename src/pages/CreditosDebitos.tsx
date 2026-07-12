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
import { Trash2, Plus, Pencil, Scale, Receipt, ChevronDown, ChevronRight, Search, X, Filter, Download, FileSpreadsheet, FileText, Rocket } from "lucide-react";
import { toast } from "sonner";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { useActiveHospitalId, useHospital } from "@/contexts/HospitalContext";
import { buildReportData, generateCreditosDebitosPdf, generateCreditosDebitosXlsx, downloadBlob, type ReportFiltersSummary } from "@/lib/creditosDebitosReport";

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
  const [appsByAdj, setAppsByAdj] = useState<Record<string, AdjApplication[]>>({});
  // Aplicações de glosa por debt_id → usado para sinalizar "já aplicado neste lote"
  // e evitar reinvocar apply-company-deductions em (payment_id, company_id) já processados.
  const [glosaAppsByDebt, setGlosaAppsByDebt] = useState<Record<string, { payment_id: string; status: string; valor_aplicado: number; applied_at: string | null }[]>>({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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
      supabase.from("company_financial_adjustments").select("*").order("created_at", { ascending: false }),
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

    // Aplicações de glosas por debt_id (ativas — ignora revertido/postponed sem valor)
    const debtIds = debts.map(d => d.id);
    const gpaMap: Record<string, { payment_id: string; status: string; valor_aplicado: number; applied_at: string | null }[]> = {};
    if (debtIds.length) {
      const { data: gpaRows } = await (supabase as any)
        .from("glosa_payment_applications")
        .select("glosa_debt_id, payment_id, status, valor_aplicado, applied_at")
        .in("glosa_debt_id", debtIds)
        .in("status", ["proposto", "confirmado", "partial", "pending_manual_resolution"]);
      ((gpaRows as any[]) ?? []).forEach(r => {
        (gpaMap[r.glosa_debt_id] ??= []).push({
          payment_id: r.payment_id,
          status: r.status,
          valor_aplicado: Number(r.valor_aplicado ?? 0),
          applied_at: r.applied_at ?? null,
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
      ((pays as any[]) ?? []).forEach(p => {
        labels[p.id] = `${p.reference} · ${fmtCompetence(p.competence_month)} · ${statusShort(p.status)}`;
      });
      setPaymentLabels(prev => ({ ...prev, ...labels }));
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
    setEditingAdj(a ? { ...a } : {
      tipo: "credito", descricao: "", valor_total: 0, parcelas_total: 1,
      parcelas_pagas: 0, data_inicio: new Date().toISOString().slice(0, 10), ativo: true, origem: "",
      payment_model_ids: null, recorrente: false, data_fim: null,
    });
    setAdjDialogOpen(true);
  };
  const saveAdj = async () => {
    if (savingAdj) return;
    if (!editingAdj?.company_id || !editingAdj.descricao || !editingAdj.valor_total) {
      toast.error("Preencha empresa, descrição e valor"); return;
    }
    const recorrente = !!editingAdj.recorrente;
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
    };
    setSavingAdj(true);
    const result = editingAdj.id
      ? await supabase.from("company_financial_adjustments").update(payload).eq("id", editingAdj.id).select("*").single()
      : await supabase.from("company_financial_adjustments").insert(payload).select("*").single();
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
    ({ rascunho: "rascunho", em_analise_ia: "análise IA", revisao_analista: "revisão", aguardando_aprovacao: "aprovação", pedido_nf_enviado: "NF enviada", revisao_pos_aprovacao: "revisão pós-ap." } as Record<string, string>)[s] ?? s;

  const buildLoteLabel = (p: { id: string; reference?: string | null; competence_month: string | null; status: string }, liquido: number | null) => {
    const ref = p.reference ? `${p.reference} · ` : "";
    const base = `${ref}${fmtCompetence(p.competence_month)} · ${statusShort(p.status)}`;
    const liq = liquido == null ? "" : ` · Líq. ${brl(liquido)}`;
    return `${base}${liq}`;
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

  const applyToCurrentLote = async (pjId?: string) => {
    if (!activeHospitalId) { toast.error("Sem hospital ativo."); return; }
    const scope = pjId ? emAndamento.filter(g => g.company_id === pjId) : emAndamento;
    if (!scope.length) { toast.info("Nada para aplicar."); return; }
    const key = pjId ?? "__all__";
    setApplyingCurrent(key);
    try {
      // 1. Lotes abertos por PJ (mais recente por competência)
      const byPj = new Map<string, GlosaDebt[]>();
      scope.forEach(g => { const arr = byPj.get(g.company_id) ?? []; arr.push(g); byPj.set(g.company_id, arr); });
      const pjIds = Array.from(byPj.keys());
      // payments não tem company_id — usamos payment_company_groups como ponte.
      const { data: pcgRows, error: pcgErr } = await (supabase as any)
        .from("payment_company_groups")
        .select("payment_id, company_id")
        .in("company_id", pjIds);
      if (pcgErr) throw pcgErr;
      const payIds = Array.from(new Set(((pcgRows as any[]) ?? []).map(r => r.payment_id)));
      const { data: openPays, error: payErr } = payIds.length ? await (supabase as any)
        .from("payments")
        .select("id, reference, competence_month, status")
        .in("id", payIds)
        .in("status", OPEN_PAYMENT_STATUSES as unknown as string[])
        .eq("hospital_id", activeHospitalId)
        .order("competence_month", { ascending: false }) : { data: [], error: null };
      if (payErr) throw payErr;
      const payById = new Map<string, any>();
      ((openPays as any[]) ?? []).forEach(p => payById.set(p.id, p));
      // Ordena pares PCG pela ordem dos lotes abertos (mais recente primeiro).
      const orderedPairs = ((pcgRows as any[]) ?? [])
        .filter(r => payById.has(r.payment_id))
        .sort((a, b) => {
          const ca = payById.get(a.payment_id)?.competence_month ?? "";
          const cb = payById.get(b.payment_id)?.competence_month ?? "";
          return cb.localeCompare(ca);
        });
      const currentByPj = new Map<string, string>();
      const labelPatch: Record<string, string> = {};
      orderedPairs.forEach(r => {
        if (!currentByPj.has(r.company_id)) {
          currentByPj.set(r.company_id, r.payment_id);
          const p = payById.get(r.payment_id);
          const comp = p?.competence_month ? (() => { const [y, m] = p.competence_month.split("-"); return `${m}/${y}`; })() : "";
          labelPatch[r.payment_id] = `${p?.reference ?? r.payment_id.slice(0, 8)}${comp ? ` · ${comp}` : ""}`;
        }
      });

      // 2. Debts que precisam atualizar target
      const toUpdate: { id: string; company_id: string; target: string }[] = [];
      for (const [pj, debts] of byPj.entries()) {
        const target = currentByPj.get(pj);
        if (!target) continue;
        for (const d of debts) {
          if (d.target_payment_id !== target) toUpdate.push({ id: d.id, company_id: pj, target });
        }
      }
      // 2b. Dedup canônico (ver src/lib/deductionDedup.ts + testes) — evita
      // reinvocar apply-company-deductions em pares (payment, company) já processados.
      const { computePairsToInvoke } = await import("@/lib/deductionDedup");
      const { pairsToInvoke, alreadyApplied } = computePairsToInvoke({
        debtsByPj: byPj,
        currentByPj,
        glosaAppsByDebt,
      });

      // Débitos que serão efetivamente enviados (aplicados agora) = pendentes nos pares invocados.
      let appliedNow = 0;
      for (const [pj, debts] of byPj.entries()) {
        const target = currentByPj.get(pj);
        if (!target || !pairsToInvoke.has(`${target}|${pj}`)) continue;
        for (const d of debts) {
          if (!debtAppliedAt(d.id, target)) appliedNow += 1;
        }
      }

      let updated = 0;
      for (const u of toUpdate) {
        const { error } = await (supabase as any).from("glosa_debts").update({ target_payment_id: u.target }).eq("id", u.id);
        if (!error) updated += 1;
      }

      // Se nada resta para invocar, evita gasto de créditos e sinaliza claramente.
      if (pairsToInvoke.size === 0) {
        if (toUpdate.length) {
          const patch = new Map(toUpdate.map(u => [u.id, u.target]));
          setGlosaDebts(prev => prev.map(g => patch.has(g.id) ? { ...g, target_payment_id: patch.get(g.id)! } : g));
        }
        if (Object.keys(labelPatch).length) setPaymentLabels(prev => ({ ...prev, ...labelPatch }));
        toast.info(alreadyApplied > 0
          ? `Nada novo para aplicar — ${alreadyApplied} débito(s) já aplicado(s) no lote vigente.`
          : "Nenhum lote em aberto disponível para aplicar.");
        return;
      }

      // 3. Invoca apply-company-deductions apenas para pares com pendência
      const invocations = await Promise.allSettled(
        Array.from(pairsToInvoke.values()).map(p => supabase.functions.invoke("apply-company-deductions", { body: p }))
      );
      const okInvocations = invocations.filter(r => r.status === "fulfilled").length;
      const failedInvocations = invocations.length - okInvocations;
      const missing = pjIds.length - currentByPj.size;

      // 4. Otimista: atualiza state local
      if (toUpdate.length) {
        const patch = new Map(toUpdate.map(u => [u.id, u.target]));
        setGlosaDebts(prev => prev.map(g => patch.has(g.id) ? { ...g, target_payment_id: patch.get(g.id)! } : g));
      }
      if (Object.keys(labelPatch).length) {
        setPaymentLabels(prev => ({ ...prev, ...labelPatch }));
      }
      const scopeLabel = pjId
        ? (byPj.get(pjId)?.[0] as any)?._company_name
          ?? (pjIds.length === 1 ? "PJ" : `${okInvocations} PJ(s)`)
        : `${okInvocations} PJ(s)`;
      const parts = [
        `✓ ${appliedNow} aplicado(s) agora`,
        alreadyApplied ? `↻ ${alreadyApplied} já aplicado(s)` : null,
        updated ? `${updated} lote-alvo atualizado(s)` : null,
        missing ? `${missing} sem lote em aberto` : null,
        failedInvocations ? `⚠ ${failedInvocations} falha(s)` : null,
      ].filter(Boolean).join(" · ");
      const msg = `${scopeLabel} — ${parts}`;
      if (failedInvocations) toast.warning(msg); else toast.success(msg);
      // Recarrega aplicações para refletir novo estado
      void loadAll();
    } catch (err: any) {
      console.error("[applyToCurrentLote]", err);
      toast.error(err?.message ?? "Falha ao aplicar no lote vigente.");
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
      const sug = [...opts].sort((a, b) => {
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

  const confirmGlobalMass = async () => {
    if (globalParc < 1 || globalParc > 24) { toast.error("Parcelas entre 1 e 24"); return; }
    const base = pendentes;
    const targets = selectedPending.size > 0 ? base.filter(g => selectedPending.has(g.id)) : base;
    const pjsSemLote = Array.from(new Set(targets.map(g => g.company_id))).filter(pj => !globalLoteByPj[pj]);
    if (pjsSemLote.length) { toast.error(`${pjsSemLote.length} PJ(s) sem lote-alvo selecionado`); return; }
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
    if (errors.length) {
      toast.error(`${ok} confirmadas · ${errors.length} falharam`);
      console.error("[global mass confirm]", errors);
    } else {
      toast.success(`${ok} débitos confirmados em ${globalParc}× (todas as PJs).`);
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
      for (const p of pairs.values()) {
        supabase.functions.invoke("apply-company-deductions", { body: p })
          .catch((err) => console.warn("[confirmGlobalMass] apply-company-deductions falhou:", err?.message));
      }
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
        <div className="flex justify-end">
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
                                  <Button size="sm" onClick={() => openGlosa(g)}>
                                    <Pencil className="w-3.5 h-3.5 mr-1" /> Parcelar e confirmar
                                  </Button>
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
                  const pendingCount = emAndamento.filter(g => !g.target_payment_id || !debtAppliedAt(g.id, g.target_payment_id)).length;
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
                        onClick={() => applyToCurrentLote()}
                        disabled={applyingCurrent !== null || pendingCount === 0}
                      >
                        <Rocket className="w-3.5 h-3.5 mr-1" />
                        {applyingCurrent === "__all__"
                          ? "Aplicando…"
                          : pendingCount === 0
                            ? "Tudo aplicado"
                            : `Aplicar no lote vigente (${pendingCount})`}
                      </Button>
                    </div>
                  );
                })()}
                {(() => {
                const groups = groupByPj(emAndamento);
                return groups.map(([pjId, list]) => {
                  const pjName = list[0]?._company_name ?? "PJ";
                  const total = list.reduce((s, g) => s + Number(g.total_debt), 0);
                  const isOpen = isGroupOpen(pjId, groups.length);
                  const pjPending = list.filter(g => !g.target_payment_id || !debtAppliedAt(g.id, g.target_payment_id)).length;
                  const pjApplied = list.length - pjPending;
                  return (
                    <Collapsible key={pjId} open={isOpen} onOpenChange={(o) => setOpenGroups(s => ({ ...s, [pjId]: o }))} className="border border-border rounded-md">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b">
                        <CollapsibleTrigger className="flex-1 flex items-center gap-2 min-w-0 hover:opacity-80">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          <span className="font-medium text-sm truncate">{pjName}</span>
                          <Badge variant="outline">{list.length}</Badge>
                          {pjApplied > 0 && (
                            <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/30">
                              ✓ {pjApplied} aplicado{pjApplied > 1 ? "s" : ""}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground font-mono">{brl(total)}</span>
                        </CollapsibleTrigger>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); applyToCurrentLote(pjId); }}
                          disabled={applyingCurrent !== null || pjPending === 0}
                        >
                          <Rocket className="w-3.5 h-3.5 mr-1" />
                          {applyingCurrent === pjId
                            ? "Aplicando…"
                            : pjPending === 0
                              ? "Tudo aplicado"
                              : `Aplicar (${pjPending})`}
                        </Button>
                      </div>

                      <CollapsibleContent>
                        <div className="divide-y">
                          {list.map(g => {
                            const parc = g.parcelas_default ?? 1;
                            const applied = debtAppliedAt(g.id, g.target_payment_id);
                            return (
                              <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-sm">{g.doctor_name}</span>
                                    {g.doctor_crm && <span className="text-xs text-muted-foreground">CRM {g.doctor_crm}</span>}
                                    {applied && (
                                      <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/30 text-[10px]">
                                        ✓ Aplicado ({applied.status})
                                      </Badge>
                                    )}
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
                                  <div className="text-[11px] mt-0.5">
                                    {g.target_payment_id ? (
                                      applied ? (
                                        <span className="text-emerald-600">
                                          ✓ aplicado em: {paymentLabels[g.target_payment_id] ?? g.target_payment_id.slice(0, 8)}
                                          {applied.valor_aplicado > 0 && ` — ${brl(applied.valor_aplicado)}`}
                                        </span>
                                      ) : (
                                        <span className="text-emerald-600">→ lote-alvo: {paymentLabels[g.target_payment_id] ?? g.target_payment_id.slice(0, 8)}</span>
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
                            {cabe == null ? "—" : cabe >= 0
                              ? <span className="text-emerald-600">✓ {brl(cabe)}</span>
                              : <span className="text-amber-600">⚠ falta {brl(-cabe)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  ⚠ Quando o líquido do lote não cobrir a parcela, o motor aplica o que couber e posterga o saldo para o próximo ciclo.
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGlobalDialogOpen(false)} disabled={busyGlobal}>Cancelar</Button>
            <Button onClick={confirmGlobalMass} disabled={busyGlobal}>
              {busyGlobal ? "Confirmando…" : "Confirmar todos"}
            </Button>
          </DialogFooter>
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
    </div>
  );
}
