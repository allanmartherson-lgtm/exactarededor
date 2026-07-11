import { useEffect, useState } from "react";
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
import { Trash2, Plus, Pencil, Scale, Receipt, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Checkbox } from "@/components/ui/checkbox";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { useActiveHospitalId } from "@/contexts/HospitalContext";

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
  /** Canônico (D3.e.4). */
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

export default function CreditosDebitos() {
  // D3.e: CFA filtra por payment_model do lote.
  const { list: paymentModels } = usePaymentTypes({ onlyActive: true, origin: "payment_model" });
  const activeHospitalId = useActiveHospitalId();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [glosaDebts, setGlosaDebts] = useState<GlosaDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjDialogOpen, setAdjDialogOpen] = useState(false);
  const [editingAdj, setEditingAdj] = useState<Partial<Adjustment> | null>(null);
  const [editingGlosa, setEditingGlosa] = useState<GlosaDebt | null>(null);
  const [glosaParc, setGlosaParc] = useState<number>(1);
  const [busyGlosa, setBusyGlosa] = useState(false);
  const [openLotes, setOpenLotes] = useState<LoteOption[]>([]);
  const [loadingLotes, setLoadingLotes] = useState(false);
  const [lotePick, setLotePick] = useState<string>("");
  const [paymentLabels, setPaymentLabels] = useState<Record<string, string>>({});
  const [appsByAdj, setAppsByAdj] = useState<Record<string, AdjApplication[]>>({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});

  // Confirmação em massa (agrupada por PJ)
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [massDialogPjId, setMassDialogPjId] = useState<string | null>(null);
  const [massParc, setMassParc] = useState<number>(1);
  const [massLotePick, setMassLotePick] = useState<string>("");
  const [busyMass, setBusyMass] = useState(false);

  // Confirmação global (todas as PJs de uma vez)
  const [globalDialogOpen, setGlobalDialogOpen] = useState(false);
  const [globalParc, setGlobalParc] = useState<number>(1);
  const [globalLoteByPj, setGlobalLoteByPj] = useState<Record<string, string>>({});
  const [globalLotesByPj, setGlobalLotesByPj] = useState<Record<string, LoteOption[]>>({});
  const [busyGlobal, setBusyGlobal] = useState(false);

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
    // Enriquece cada débito com CC + track do lote de origem, para casar "igual com igual" ao sugerir lote-alvo
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

    // Carrega histórico real de aplicações por ajuste
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

    // Resolve rótulos dos lotes-alvo (glosas + aplicações de ajustes)
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
    const { error } = editingAdj.id
      ? await supabase.from("company_financial_adjustments").update(payload).eq("id", editingAdj.id)
      : await supabase.from("company_financial_adjustments").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Ajuste salvo");
    setAdjDialogOpen(false); setEditingAdj(null); loadAll();

  };
  const removeAdj = async (id: string) => {
    if (!confirm("Excluir este ajuste?")) return;
    const { error } = await supabase.from("company_financial_adjustments").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    loadAll();
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

  const trackShort = (t: string | null | undefined) =>
    t === "prioritaria" ? "prioritária" : t === "habitual" ? "habitual" : t ?? "";

  /** Pontua compatibilidade do lote-alvo com a origem do débito. CC vale mais que trilha. */
  const scoreLoteMatch = (lote: LoteOption, cc: string | null | undefined, track: string | null | undefined) => {
    let s = 0;
    if (cc && lote.cost_center_code && lote.cost_center_code === cc) s += 10;
    if (track && lote.payment_track && lote.payment_track === track) s += 3;
    return s;
  };

  /** Dominante entre uma lista de débitos (para PJ com origens mistas). */
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
    // Lotes em aberto que contêm a PJ do débito (via payment_company_groups).
    const { data: pcg } = await (supabase as any)
      .from("payment_company_groups")
      .select("payment_id")
      .eq("company_id", companyId);
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
    if (glosaParc < 1 || glosaParc > 24) {
      toast.error("Parcelas entre 1 e 24"); return;
    }
    if (!lotePick) {
      toast.error("Escolha o lote-alvo onde este débito deve ser aplicado."); return;
    }
    setBusyGlosa(true);
    const { data: userData } = await supabase.auth.getUser();
    const patch: any = { parcelas_default: glosaParc, target_payment_id: lotePick };
    // Confirma se ainda não estava confirmado
    if (!editingGlosa.confirmed_at) {
      patch.confirmed_at = new Date().toISOString();
      patch.confirmed_by = userData.user?.id ?? null;
    }
    const { error } = await (supabase as any)
      .from("glosa_debts")
      .update(patch)
      .eq("id", editingGlosa.id);
    setBusyGlosa(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(
      editingGlosa.confirmed_at
        ? `Reparcelado para ${glosaParc}× de ${brl(editingGlosa.total_debt / glosaParc)}.`
        : `Débito confirmado em ${glosaParc}× de ${brl(editingGlosa.total_debt / glosaParc)}.`
    );
    setEditingGlosa(null);
    loadAll();
  };

  const reopenGlosa = async (g: GlosaDebt) => {
    if (!confirm(`Reabrir débito de ${g.doctor_name}? Sai de "em andamento" e volta para "a confirmar".`)) return;
    const { error } = await (supabase as any)
      .from("glosa_debts")
      .update({ confirmed_at: null, confirmed_by: null })
      .eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Débito reaberto");
    loadAll();
  };

  const massTargets = massDialogPjId
    ? glosaDebts.filter(g => !g.confirmed_at && g.company_id === massDialogPjId && selectedPending.has(g.id))
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
      massTargets.forEach(g => next.delete(g.id));
      return next;
    });
    loadAll();
  };

  const openGlobalMass = async () => {
    const pendentes = glosaDebts.filter(g => !g.confirmed_at);
    if (pendentes.length === 0) return;
    // Se nada selecionado, considera TODAS as pendentes
    const selectedList = selectedPending.size > 0
      ? pendentes.filter(g => selectedPending.has(g.id))
      : pendentes;
    if (selectedList.length === 0) return;
    const pjIds = Array.from(new Set(selectedList.map(g => g.company_id)));
    setGlobalDialogOpen(true);
    setGlobalParc(1);

    // Carrega lotes em aberto de cada PJ em paralelo
    const results = await Promise.all(pjIds.map(async (pjId) => {
      const { data: pcg } = await (supabase as any)
        .from("payment_company_groups").select("payment_id").eq("company_id", pjId);
      const ids = Array.from(new Set(((pcg as any[]) ?? []).map(r => r.payment_id))).filter(Boolean);
      if (!ids.length) return [pjId, [] as LoteOption[]] as const;
      const [{ data: pays }, { data: fins }] = await Promise.all([
        supabase.from("payments").select("id, reference, competence_month, status")
          .in("id", ids).in("status", OPEN_PAYMENT_STATUSES)
          .order("competence_month", { ascending: false }),
        supabase.from("payment_company_financials").select("payment_id, liquido")
          .in("payment_id", ids).eq("company_id", pjId),
      ]);
      const liqMap = new Map<string, number>();
      ((fins as any[]) ?? []).forEach(f => liqMap.set(f.payment_id, Number(f.liquido ?? 0)));
      const opts: LoteOption[] = ((pays as any[]) ?? []).map(p => ({
        id: p.id,
        status: p.status,
        competence: p.competence_month,
        liquido: liqMap.has(p.id) ? (liqMap.get(p.id) as number) : null,
        label: buildLoteLabel(p, liqMap.has(p.id) ? (liqMap.get(p.id) as number) : null),
      }));
      return [pjId, opts] as const;
    }));

    const lotesMap: Record<string, LoteOption[]> = {};
    const pickMap: Record<string, string> = {};
    results.forEach(([pjId, opts]) => {
      lotesMap[pjId] = opts;
      // Sugere o lote com MAIOR líquido disponível; empate → mais recente
      const sug = [...opts].sort((a, b) => (Number(b.liquido ?? 0) - Number(a.liquido ?? 0)))[0];
      if (sug) pickMap[pjId] = sug.id;
    });
    setGlobalLotesByPj(lotesMap);
    setGlobalLoteByPj(pickMap);
  };

  const confirmGlobalMass = async () => {
    if (globalParc < 1 || globalParc > 24) { toast.error("Parcelas entre 1 e 24"); return; }
    const pendentes = glosaDebts.filter(g => !g.confirmed_at);
    const targets = selectedPending.size > 0
      ? pendentes.filter(g => selectedPending.has(g.id))
      : pendentes;
    const pjsSemLote = Array.from(new Set(targets.map(g => g.company_id)))
      .filter(pj => !globalLoteByPj[pj]);
    if (pjsSemLote.length) {
      toast.error(`${pjsSemLote.length} PJ(s) sem lote-alvo selecionado`);
      return;
    }
    setBusyGlobal(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;
    const nowIso = new Date().toISOString();
    let ok = 0; const errors: string[] = [];
    for (const g of targets) {
      const target = globalLoteByPj[g.company_id];
      const { error } = await (supabase as any)
        .from("glosa_debts")
        .update({
          parcelas_default: globalParc,
          target_payment_id: target,
          confirmed_at: g.confirmed_at ?? nowIso,
          confirmed_by: g.confirmed_at ? undefined : uid,
        })
        .eq("id", g.id);
      if (error) errors.push(`${g.doctor_name}: ${error.message}`); else ok++;
    }
    setBusyGlobal(false);
    if (errors.length) {
      toast.error(`${ok} confirmadas · ${errors.length} falharam`);
      console.error("[global mass confirm]", errors);
    } else {
      toast.success(`${ok} débitos confirmados em ${globalParc}× (todas as PJs).`);
    }
    setGlobalDialogOpen(false);
    setSelectedPending(new Set());
    loadAll();
  };



  return (
    <div>
      <PageHeader
        title="Créditos e Débitos"
        description="Ajustes financeiros recorrentes por empresa — aplicados nos próximos pagamentos."
        icon={Scale}
      />
      <div className="p-6 space-y-6">
        {/* Glosas a confirmar (de auditoria, ainda sem aceite do analista) */}
        {(() => {
          const pendentes = glosaDebts.filter(g => !g.confirmed_at);
          const emAndamento = glosaDebts.filter(g => !!g.confirmed_at);
          return (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Receipt className="w-4 h-4" />
                    Glosas a confirmar <Badge variant="outline">{pendentes.length}</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Saldos gerados por auditoria. Defina o parcelamento e confirme — o próximo lote da PJ só desconta o que estiver confirmado.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loading ? (
                    <p className="text-sm text-muted-foreground">Carregando…</p>
                  ) : pendentes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma glosa pendente de confirmação.</p>
                  ) : (
                    <>
                    {/* Barra de ação global (todas as PJs) */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border border-primary/30 bg-primary/5 rounded-md px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={selectedPending.size === pendentes.length && pendentes.length > 0}
                          onCheckedChange={(checked) => {
                            setSelectedPending(checked ? new Set(pendentes.map(g => g.id)) : new Set());
                          }}
                        />
                        <span className="text-sm font-medium">Selecionar todas ({pendentes.length})</span>
                        {selectedPending.size > 0 && (
                          <span className="text-xs text-muted-foreground">
                            · {selectedPending.size} sel. · {brl(
                              pendentes.filter(g => selectedPending.has(g.id))
                                .reduce((s, g) => s + Number(g.total_debt), 0)
                            )}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={openGlobalMass}
                        title="Confirma todas as glosas selecionadas (ou todas as pendentes se nada estiver marcado), aplicando parcelamento global e escolhendo o melhor lote de cada PJ"
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        Confirmar {selectedPending.size > 0 ? `${selectedPending.size} selecionadas` : "todas"} em massa
                      </Button>
                    </div>
                    {(() => {
                      const byPj = new Map<string, GlosaDebt[]>();
                      pendentes.forEach(g => {
                        const arr = byPj.get(g.company_id) ?? [];
                        arr.push(g); byPj.set(g.company_id, arr);
                      });
                      return Array.from(byPj.entries()).map(([pjId, list]) => {
                        const pjName = list[0]?._company_name ?? "PJ";
                        const selectedHere = list.filter(g => selectedPending.has(g.id));
                        const allSelected = selectedHere.length === list.length && list.length > 0;
                        const someSelected = selectedHere.length > 0;
                        const totalSelected = selectedHere.reduce((s, g) => s + Number(g.total_debt), 0);
                        return (
                          <div key={pjId} className="border border-border rounded-md">
                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b">
                              <div className="flex items-center gap-2 min-w-0">
                                <Checkbox
                                  checked={allSelected}
                                  onCheckedChange={(checked) => {
                                    setSelectedPending(prev => {
                                      const next = new Set(prev);
                                      list.forEach(g => checked ? next.add(g.id) : next.delete(g.id));
                                      return next;
                                    });
                                  }}
                                />
                                <span className="font-medium text-sm truncate">{pjName}</span>
                                <Badge variant="outline">{list.length}</Badge>
                                {someSelected && (
                                  <span className="text-xs text-muted-foreground">
                                    · {selectedHere.length} sel. · {brl(totalSelected)}
                                  </span>
                                )}
                              </div>
                              <Button
                                size="sm"
                                disabled={selectedHere.length < 2}
                                onClick={() => {
                                  setMassDialogPjId(pjId);
                                  setMassParc(1);
                                  setMassLotePick("");
                                  loadOpenLotes(pjId);
                                }}
                                title={selectedHere.length < 2 ? "Selecione 2+ glosas desta PJ" : "Parcelar e confirmar em massa"}
                              >
                                <Pencil className="w-3.5 h-3.5 mr-1" /> Confirmar em massa ({selectedHere.length})
                              </Button>
                            </div>
                            <div className="divide-y">
                              {list.map(g => {
                                const parc = g.parcelas_default ?? 1;
                                const checked = selectedPending.has(g.id);
                                return (
                                  <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(v) => {
                                        setSelectedPending(prev => {
                                          const next = new Set(prev);
                                          v ? next.add(g.id) : next.delete(g.id);
                                          return next;
                                        });
                                      }}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-sm">{g.doctor_name}</span>
                                        {g.doctor_crm && <span className="text-xs text-muted-foreground">CRM {g.doctor_crm}</span>}
                                      </div>
                                      <div className="text-xs mt-0.5">
                                        <span className="font-mono text-destructive">{brl(g.total_debt)}</span>
                                        {" · "}
                                        <span className="text-amber-600 font-medium">
                                          sugestão {parc}× de {brl(g.total_debt / parc)}
                                        </span>
                                      </div>
                                    </div>
                                    <Button size="sm" onClick={() => openGlosa(g)}>
                                      <Pencil className="w-3.5 h-3.5 mr-1" /> Parcelar e confirmar
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Débitos em andamento (já confirmados) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Scale className="w-4 h-4" />
                    Débitos em andamento <Badge variant="outline">{emAndamento.length}</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Confirmados — entram no próximo <code>apply-company-deductions</code> da PJ, parcela a parcela.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {loading ? (
                    <p className="text-sm text-muted-foreground">Carregando…</p>
                  ) : emAndamento.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum débito em andamento.</p>
                  ) : (
                    emAndamento.map(g => {
                      const parc = g.parcelas_default ?? 1;
                      return (
                        <div key={g.id} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{g.doctor_name}</span>
                              {g.doctor_crm && <span className="text-xs text-muted-foreground">CRM {g.doctor_crm}</span>}
                              <span className="text-xs text-muted-foreground">·</span>
                              <span className="text-xs text-muted-foreground truncate">{g._company_name ?? "—"}</span>
                            </div>
                            <div className="text-xs mt-0.5">
                              <span className="font-mono text-destructive">{brl(g.total_debt)}</span>
                              {" · "}
                              <span>{parc}× de {brl(g.total_debt / parc)}</span>
                              {g.confirmed_at && (
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                  confirmado {new Date(g.confirmed_at).toLocaleDateString("pt-BR")}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] mt-0.5">
                              {g.target_payment_id ? (
                                <span className="text-emerald-600">
                                  → lote-alvo: {paymentLabels[g.target_payment_id] ?? g.target_payment_id.slice(0, 8)}
                                </span>
                              ) : (
                                <span className="text-amber-600">⚠ sem lote-alvo definido — não será aplicado</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => openGlosa(g)}>
                              <Pencil className="w-3.5 h-3.5 mr-1" /> Reparcelar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => reopenGlosa(g)}>
                              Reabrir
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </>
          );
        })()}



        {/* Ajustes manuais */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Scale className="w-4 h-4" />
                Ajustes manuais <Badge variant="outline">{adjustments.length}</Badge>
              </span>
              <Button size="sm" onClick={() => openAdj()}><Plus className="w-4 h-4 mr-1" /> Novo</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
              : adjustments.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum ajuste cadastrado.</p>
              : adjustments.map(a => {
                const apps = appsByAdj[a.id] ?? [];
                const ativas = apps.filter(x => x.status !== "revertido");
                const aplicadasCount = ativas.length; // proposto+confirmado+pago contam como "aplicada"
                const revertidasCount = apps.length - ativas.length;
                const isOpen = !!historyOpen[a.id];
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
                              Só em: {ids
                                .map(id => paymentModels.find(p => p.id === id)?.label ?? "—")
                                .join(", ")}
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
                      <Button size="sm" variant="ghost" onClick={() => openAdj(a)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => removeAdj(a.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
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

          </CardContent>
        </Card>
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
                <Input
                  type="number" min={1} max={24}
                  value={glosaParc}
                  onChange={e => setGlosaParc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))}
                />
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
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhum lote em aberto encontrado para esta PJ.
                      </div>
                    ) : (
                      openLotes.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  O motor só desconta a parcela quando o lote em execução for este. Se a PJ tem outros lotes em paralelo, eles serão ignorados.
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
                <div className="font-medium">
                  {glosaDebts.find(g => g.company_id === massDialogPjId)?._company_name ?? "PJ"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {massTargets.length} médicos selecionados
                </div>
                <div className="mt-1 font-mono text-destructive">Total: {brl(massTotal)}</div>
              </div>

              <div>
                <Label>Parcelas (1–24) — aplicado a todos</Label>
                <Input
                  type="number" min={1} max={24}
                  value={massParc}
                  onChange={e => setMassParc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))}
                />
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
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhum lote em aberto encontrado para esta PJ.
                      </div>
                    ) : (
                      openLotes.map(l => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.label}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {massCabe != null && (
                  <p className={`text-xs mt-1 ${massCabe >= 0 ? "text-emerald-600" : "text-amber-600"}`}>
                    {massCabe >= 0
                      ? `Cabe no lote (sobra ${brl(massCabe)} de líquido).`
                      : `⚠ Não cabe: parcela excede o líquido em ${brl(-massCabe)}. O motor vai aplicar o que couber e postergar o resto para o próximo ciclo.`}
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

      {/* Dialog: confirmação global (todas as PJs) */}
      <Dialog open={globalDialogOpen} onOpenChange={setGlobalDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirmar débitos em massa (todas as PJs)</DialogTitle>
          </DialogHeader>
          {(() => {
            const pendentes = glosaDebts.filter(g => !g.confirmed_at);
            const targets = selectedPending.size > 0
              ? pendentes.filter(g => selectedPending.has(g.id))
              : pendentes;
            const byPj = new Map<string, GlosaDebt[]>();
            targets.forEach(g => {
              const arr = byPj.get(g.company_id) ?? [];
              arr.push(g); byPj.set(g.company_id, arr);
            });
            return (
              <div className="space-y-3 text-sm">
                <div>
                  <Label>Parcelas (1–24) — aplicado a todas as PJs</Label>
                  <Input
                    type="number" min={1} max={24}
                    value={globalParc}
                    onChange={e => setGlobalParc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))}
                  />
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
                              <Select
                                value={pick}
                                onValueChange={(v) => setGlobalLoteByPj(prev => ({ ...prev, [pjId]: v }))}
                              >
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
                  ⚠ Quando o líquido do lote não cobrir a parcela, o motor aplica o que couber e posterga o saldo para o próximo ciclo (não bloqueia a confirmação).
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

              {/* Modo: parcelado x fixo mensal */}
              <div className="col-span-2 rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!editingAdj.recorrente}
                    onCheckedChange={v => setEditingAdj({ ...editingAdj, recorrente: v })}
                  />
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

              {/* Restrição por tipo de lote */}
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
            <Button variant="outline" onClick={() => setAdjDialogOpen(false)}>Cancelar</Button>
            <Button onClick={saveAdj}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

