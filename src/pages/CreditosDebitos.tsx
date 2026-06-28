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
  payment_type_ids: string[] | null;
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
  _company_name?: string;
};

type LoteOption = {
  id: string;
  label: string;
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
  const { list: paymentTypes } = usePaymentTypes({ onlyActive: true });
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
        .select("id, company_id, doctor_id, doctor_name, doctor_crm, total_debt, parcelas_default, status, created_at, confirmed_at, target_payment_id")
        .eq("status", "ativo")
        .order("created_at", { ascending: false }),

    ]);
    setCompanies(companiesAll.filter((c) => !c.name.trim().toUpperCase().startsWith("__E2E")));
    const cMap = new Map(companiesAll.map((x) => [x.id, x.name]));
    const adjs = (a.data || []) as Adjustment[];
    setAdjustments(adjs.map(x => ({ ...x, _company_name: cMap.get(x.company_id) })));
    const debts = ((g as any).data || []) as GlosaDebt[];
    setGlosaDebts(debts.map(x => ({ ...x, _company_name: cMap.get(x.company_id) })));
    // Resolve rótulos dos lotes-alvo já referenciados
    const tgtIds = Array.from(new Set(debts.map(d => d.target_payment_id).filter(Boolean))) as string[];
    if (tgtIds.length) {
      const { data: pays } = await supabase
        .from("payments").select("id, competence_month, status").in("id", tgtIds);
      const labels: Record<string, string> = {};
      ((pays as any[]) ?? []).forEach(p => {
        labels[p.id] = `${fmtCompetence(p.competence_month)} · ${statusShort(p.status)}`;
      });
      setPaymentLabels(prev => ({ ...prev, ...labels }));
    }
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, []);

  const openAdj = (a?: Adjustment) => {
    setEditingAdj(a ? { ...a } : {
      tipo: "credito", descricao: "", valor_total: 0, parcelas_total: 1,
      parcelas_pagas: 0, data_inicio: new Date().toISOString().slice(0, 10), ativo: true, origem: "",
      payment_type_ids: null, recorrente: false, data_fim: null,
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
      payment_type_ids: (editingAdj.payment_type_ids && editingAdj.payment_type_ids.length > 0) ? editingAdj.payment_type_ids : null,
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

  const loadOpenLotes = async (g: GlosaDebt) => {
    setLoadingLotes(true);
    setOpenLotes([]);
    // Lotes em aberto que contêm a PJ do débito (via payment_company_groups).
    const { data: pcg } = await (supabase as any)
      .from("payment_company_groups")
      .select("payment_id")
      .eq("company_id", g.company_id);
    const ids = Array.from(new Set(((pcg as any[]) ?? []).map(r => r.payment_id))).filter(Boolean);
    if (!ids.length) { setLoadingLotes(false); return; }
    const { data: pays } = await supabase
      .from("payments")
      .select("id, competence_month, status")
      .in("id", ids)
      .in("status", OPEN_PAYMENT_STATUSES)
      .order("competence_month", { ascending: false });
    const opts: LoteOption[] = ((pays as any[]) ?? []).map(p => ({
      id: p.id,
      label: `${fmtCompetence(p.competence_month)} · ${statusShort(p.status)}`,
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
    loadOpenLotes(g);
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
                <CardContent className="space-y-2">
                  {loading ? (
                    <p className="text-sm text-muted-foreground">Carregando…</p>
                  ) : pendentes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma glosa pendente de confirmação.</p>
                  ) : (
                    pendentes.map(g => {
                      const parc = g.parcelas_default ?? 1;
                      return (
                        <div key={g.id} className="flex items-center justify-between border border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10 rounded-md px-3 py-2">
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
                              <span className="text-amber-600 font-medium">
                                sugestão {parc}× de {brl(g.total_debt / parc)}
                              </span>
                              <span className="ml-1 text-[10px] text-amber-600">(aguardando confirmação)</span>
                            </div>
                          </div>
                          <Button size="sm" onClick={() => openGlosa(g)}>
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Parcelar e confirmar
                          </Button>
                        </div>
                      );
                    })
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
              : adjustments.map(a => (
                <div key={a.id} className="flex justify-between items-center border border-border rounded-md px-3 py-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={a.tipo === "credito" ? "default" : "secondary"}>{a.tipo}</Badge>
                      <span className="font-medium text-sm">{a._company_name}</span>
                      {a.recorrente && <Badge variant="outline" className="text-[10px]">Fixo mensal</Badge>}
                      {!a.ativo && <Badge variant="outline">Inativo</Badge>}
                      {a.payment_type_ids && a.payment_type_ids.length > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          Só em: {a.payment_type_ids
                            .map(id => paymentTypes.find(p => p.id === id)?.label ?? "—")
                            .join(", ")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{a.descricao}</p>
                    <p className="text-xs">
                      {a.recorrente
                        ? <>{brl(a.valor_total)} / mês{a.data_fim ? ` · até ${a.data_fim}` : " · sem fim definido"} · início {a.data_inicio}</>
                        : <>{brl(a.valor_total)} · parc. {a.parcelas_pagas}/{a.parcelas_total} · início {a.data_inicio}</>}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openAdj(a)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => removeAdj(a.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </div>
              ))
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
                  {(editingAdj.payment_type_ids?.length ?? 0) > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
                      onClick={() => setEditingAdj({ ...editingAdj, payment_type_ids: null })}>
                      Limpar (qualquer tipo)
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Vazio = aplica em qualquer lote da empresa. Marque para restringir somente aos tipos selecionados.
                </p>
                <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                  {paymentTypes.map(pt => {
                    const cur = editingAdj.payment_type_ids ?? [];
                    const checked = cur.includes(pt.id);
                    return (
                      <label key={pt.id} className="flex items-center gap-2 text-xs rounded px-2 py-1 hover:bg-muted/50 cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => setEditingAdj({
                            ...editingAdj,
                            payment_type_ids: v
                              ? Array.from(new Set([...cur, pt.id]))
                              : cur.filter(id => id !== pt.id),
                          })}
                        />
                        <span className="truncate">{pt.label}</span>
                      </label>
                    );
                  })}
                  {paymentTypes.length === 0 && (
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

