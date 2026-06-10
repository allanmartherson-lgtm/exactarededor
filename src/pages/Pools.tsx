import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Pencil, Calculator, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";

type Pool = {
  id: string;
  nome: string;
  descricao: string | null;
  base_calculo: "soma_convenio_100" | "soma_expected" | "soma_bruto";
  ativo: boolean;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
};
type Deduction = {
  id?: string;
  pool_id?: string;
  ordem: number;
  tipo: "fixo_mensal" | "plantao" | "ajuste_credito" | "ajuste_debito" | "glosa_parcelada" | "valor_referencia_externa";
  descricao: string;
  valor: number | null;
  company_id: string | null;
  obrigatoria: boolean;
};
type Participant = {
  id?: string;
  pool_id?: string;
  participant_type: "company" | "hospital_nao_paga";
  company_id: string | null;
  percentual: number;
  ordem_exibicao: number;
  _label?: string;
};
type Company = { id: string; name: string };


const BASE_LABELS: Record<string, string> = {
  soma_convenio_100: "Soma 100% convênio",
  soma_expected: "Soma de valor esperado (pós-regras)",
  soma_bruto: "Soma de valor bruto",
};
const DED_LABELS: Record<string, string> = {
  fixo_mensal: "Fixo mensal",
  plantao: "Plantão",
  ajuste_credito: "Ajuste — crédito",
  ajuste_debito: "Ajuste — débito",
  glosa_parcelada: "Glosa parcelada",
  valor_referencia_externa: "Valor referência externa",
};

export default function Pools({ embedded = false }: { embedded?: boolean } = {}) {
  const [pools, setPools] = useState<Pool[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Pool | null>(null);
  const [editDeds, setEditDeds] = useState<Deduction[]>([]);
  const [editParts, setEditParts] = useState<Participant[]>([]);
  const [showPoolDialog, setShowPoolDialog] = useState(false);
  const [adjDialogOpen, setAdjDialogOpen] = useState(false);
  const [editingAdj, setEditingAdj] = useState<Partial<Adjustment> | null>(null);

  const loadAll = async () => {
    setLoading(true);
    const [p, c, a] = await Promise.all([
      supabase.from("pools").select("*").order("created_at", { ascending: false }),
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("company_financial_adjustments").select("*").order("created_at", { ascending: false }),
    ]);
    setPools((p.data || []) as Pool[]);
    setCompanies(c.data || []);
    const adjs = (a.data || []) as Adjustment[];
    const cMap = new Map((c.data || []).map((x: any) => [x.id, x.name]));
    setAdjustments(adjs.map(x => ({ ...x, _company_name: cMap.get(x.company_id) })));
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, []);

  const openPool = async (pool: Pool | null) => {
    setEditing(pool ?? {
      id: "", nome: "", descricao: "", base_calculo: "soma_convenio_100",
      ativo: true, vigencia_inicio: null, vigencia_fim: null,
    });
    if (pool?.id) {
      const [d, pp] = await Promise.all([
        supabase.from("pool_deductions").select("*").eq("pool_id", pool.id).order("ordem"),
        supabase.from("pool_participants").select("*").eq("pool_id", pool.id).order("ordem_exibicao"),
      ]);
      setEditDeds((d.data || []) as Deduction[]);
      const cMap = new Map(companies.map(c => [c.id, c.name]));
      setEditParts(((pp.data || []) as Participant[]).map(x => ({
        ...x, _label: x.participant_type === "hospital_nao_paga" ? "Hospital (não paga)" : (x.company_id ? cMap.get(x.company_id) : ""),
      })));
    } else {
      setEditDeds([]);
      setEditParts([]);
    }
    setShowPoolDialog(true);
  };

  const sumPct = useMemo(() => editParts.reduce((s, p) => s + (Number(p.percentual) || 0), 0), [editParts]);

  const savePool = async () => {
    if (!editing) return;
    if (!editing.nome.trim()) { toast.error("Nome obrigatório"); return; }
    if (Math.round(sumPct * 100) !== 10000) { toast.error("Soma dos percentuais deve ser 100"); return; }

    let poolId = editing.id;
    if (!poolId) {
      const { data, error } = await supabase.from("pools").insert({
        nome: editing.nome, descricao: editing.descricao, base_calculo: editing.base_calculo,
        ativo: editing.ativo, vigencia_inicio: editing.vigencia_inicio, vigencia_fim: editing.vigencia_fim,
      }).select().single();
      if (error) { toast.error(error.message); return; }
      poolId = data.id;
    } else {
      const { error } = await supabase.from("pools").update({
        nome: editing.nome, descricao: editing.descricao, base_calculo: editing.base_calculo,
        ativo: editing.ativo, vigencia_inicio: editing.vigencia_inicio, vigencia_fim: editing.vigencia_fim,
      }).eq("id", poolId);
      if (error) { toast.error(error.message); return; }
    }

    await supabase.from("pool_deductions").delete().eq("pool_id", poolId);
    if (editDeds.length) {
      const rows = editDeds.map((d, i) => ({
        pool_id: poolId, ordem: i, tipo: d.tipo, descricao: d.descricao,
        valor: d.valor, company_id: d.company_id, obrigatoria: d.obrigatoria,
      }));
      const { error } = await supabase.from("pool_deductions").insert(rows);
      if (error) { toast.error(error.message); return; }
    }

    await supabase.from("pool_participants").delete().eq("pool_id", poolId);
    if (editParts.length) {
      const rows = editParts.map((p, i) => ({
        pool_id: poolId, participant_type: p.participant_type,
        company_id: p.participant_type === "company" ? p.company_id : null,
        percentual: p.percentual, ordem_exibicao: i,
      }));
      const { error } = await supabase.from("pool_participants").insert(rows);
      if (error) { toast.error(error.message); return; }
    }

    toast.success("Pool salvo");
    setShowPoolDialog(false);
    setEditing(null);
    loadAll();
  };

  const removePool = async (id: string) => {
    if (!confirm("Excluir este pool?")) return;
    const { error } = await supabase.from("pools").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pool excluído");
    loadAll();
  };

  // --- Simulador ---
  const [simBase, setSimBase] = useState<string>("");
  const simBolo = useMemo(() => {
    const b = parseFloat(simBase) || 0;
    let dedTotal = 0;
    const lines = editDeds.map(d => ({ desc: d.descricao || DED_LABELS[d.tipo], val: Number(d.valor) || 0 }));
    dedTotal = lines.reduce((s, l) => s + l.val, 0);
    const liquido = b - dedTotal;
    const quotas = editParts.map(p => ({
      label: p._label || (p.participant_type === "hospital_nao_paga" ? "Hospital (não paga)" : "—"),
      tipo: p.participant_type, pct: p.percentual, val: liquido * (Number(p.percentual) || 0) / 100,
    }));
    return { b, lines, dedTotal, liquido, quotas };
  }, [simBase, editDeds, editParts]);

  // --- Ajustes ---
  const openAdj = (a?: Adjustment) => {
    setEditingAdj(a ? { ...a } : {
      tipo: "credito", descricao: "", valor_total: 0, parcelas_total: 1,
      parcelas_pagas: 0, data_inicio: new Date().toISOString().slice(0, 10), ativo: true, origem: "",
    });
    setAdjDialogOpen(true);
  };
  const saveAdj = async () => {
    if (!editingAdj?.company_id || !editingAdj.descricao || !editingAdj.valor_total) {
      toast.error("Preencha empresa, descrição e valor"); return;
    }
    const payload: any = {
      company_id: editingAdj.company_id, tipo: editingAdj.tipo, descricao: editingAdj.descricao,
      valor_total: editingAdj.valor_total, parcelas_total: editingAdj.parcelas_total ?? 1,
      parcelas_pagas: editingAdj.parcelas_pagas ?? 0, data_inicio: editingAdj.data_inicio,
      ativo: editingAdj.ativo ?? true, origem: editingAdj.origem || null,
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

  return (
    <div className={embedded ? "space-y-6" : "p-6 space-y-6 max-w-7xl mx-auto"}>
      {!embedded && (
        <div>
          <h1 className="text-3xl font-bold">Pools de rateio</h1>
          <p className="text-muted-foreground">Configure rateio de produção entre empresas e ajustes financeiros recorrentes.</p>
        </div>
      )}

      <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openPool(null)}><Plus className="w-4 h-4 mr-1" /> Novo pool</Button>
          </div>
          {loading ? <p>Carregando…</p> : pools.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum pool cadastrado.</CardContent></Card>
          ) : (
            <div className="grid gap-3">
              {pools.map(p => (
                <Card key={p.id}>
                  <CardContent className="flex justify-between items-center py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{p.nome}</span>
                        {p.ativo ? <Badge variant="default">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{BASE_LABELS[p.base_calculo]} · {p.descricao || "—"}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openPool(p)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => removePool(p.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
      </div>


      {/* ===== Dialog Pool ===== */}
      <Dialog open={showPoolDialog} onOpenChange={setShowPoolDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar pool" : "Novo pool"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome</Label>
                  <Input value={editing.nome} onChange={e => setEditing({ ...editing, nome: e.target.value })} placeholder="Infecto BSB — split hospital" />
                </div>
                <div>
                  <Label>Base de cálculo</Label>
                  <Select value={editing.base_calculo} onValueChange={(v: any) => setEditing({ ...editing, base_calculo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(BASE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Descrição</Label>
                  <Textarea value={editing.descricao || ""} onChange={e => setEditing({ ...editing, descricao: e.target.value })} rows={2} />
                </div>
                <div>
                  <Label>Vigência início</Label>
                  <Input type="date" value={editing.vigencia_inicio || ""} onChange={e => setEditing({ ...editing, vigencia_inicio: e.target.value || null })} />
                </div>
                <div>
                  <Label>Vigência fim</Label>
                  <Input type="date" value={editing.vigencia_fim || ""} onChange={e => setEditing({ ...editing, vigencia_fim: e.target.value || null })} />
                </div>
                <div className="flex items-center gap-2 col-span-2">
                  <Switch checked={editing.ativo} onCheckedChange={v => setEditing({ ...editing, ativo: v })} />
                  <Label>Ativo</Label>
                </div>
              </div>

              {/* Deduções */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-base">Deduções (aplicadas em ordem)</Label>
                  <Button size="sm" variant="outline" onClick={() => setEditDeds([...editDeds, { ordem: editDeds.length, tipo: "fixo_mensal", descricao: "", valor: 0, company_id: null, obrigatoria: true }])}>
                    <Plus className="w-4 h-4 mr-1" />Dedução
                  </Button>
                </div>
                <div className="space-y-2">
                  {editDeds.map((d, i) => (
                    <Card key={i}><CardContent className="py-3 grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3">
                        <Label className="text-xs">Tipo</Label>
                        <Select value={d.tipo} onValueChange={(v: any) => { const n = [...editDeds]; n[i] = { ...d, tipo: v }; setEditDeds(n); }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(DED_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-4">
                        <Label className="text-xs">Descrição</Label>
                        <Input value={d.descricao} onChange={e => { const n = [...editDeds]; n[i] = { ...d, descricao: e.target.value }; setEditDeds(n); }} />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Valor (R$)</Label>
                        <Input type="number" step="0.01" value={d.valor ?? ""} onChange={e => { const n = [...editDeds]; n[i] = { ...d, valor: e.target.value === "" ? null : parseFloat(e.target.value) }; setEditDeds(n); }} />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Empresa origem</Label>
                        <Select value={d.company_id ?? "none"} onValueChange={v => { const n = [...editDeds]; n[i] = { ...d, company_id: v === "none" ? null : v }; setEditDeds(n); }}>
                          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-1 flex gap-1">
                        {i > 0 && <Button size="icon" variant="ghost" onClick={() => { const n = [...editDeds]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setEditDeds(n); }}><ArrowUp className="w-3 h-3" /></Button>}
                        {i < editDeds.length - 1 && <Button size="icon" variant="ghost" onClick={() => { const n = [...editDeds]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setEditDeds(n); }}><ArrowDown className="w-3 h-3" /></Button>}
                        <Button size="icon" variant="ghost" onClick={() => setEditDeds(editDeds.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                      </div>
                    </CardContent></Card>
                  ))}
                </div>
              </div>

              {/* Participantes */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-base">Participantes — soma <span className={Math.round(sumPct * 100) === 10000 ? "text-green-600" : "text-destructive"}>{sumPct.toFixed(2)}%</span></Label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditParts([...editParts, { participant_type: "company", company_id: null, percentual: 0, ordem_exibicao: editParts.length }])}>
                      <Plus className="w-4 h-4 mr-1" />Empresa
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditParts([...editParts, { participant_type: "hospital_nao_paga", company_id: null, percentual: 0, ordem_exibicao: editParts.length, _label: "Hospital (não paga)" }])}>
                      <Plus className="w-4 h-4 mr-1" />Hospital (não paga)
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {editParts.map((p, i) => (
                    <Card key={i}><CardContent className="py-3 grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-7">
                        <Label className="text-xs">Participante</Label>
                        {p.participant_type === "hospital_nao_paga" ? (
                          <div className="h-9 flex items-center px-3 border rounded-md bg-muted text-sm">Hospital (não paga) — sentinela informativa</div>
                        ) : (
                          <Select value={p.company_id ?? ""} onValueChange={v => { const n = [...editParts]; const company = companies.find(c => c.id === v); n[i] = { ...p, company_id: v, _label: company?.name }; setEditParts(n); }}>
                            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                            <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="col-span-3">
                        <Label className="text-xs">Percentual (%)</Label>
                        <Input type="number" step="0.01" value={p.percentual} onChange={e => { const n = [...editParts]; n[i] = { ...p, percentual: parseFloat(e.target.value) || 0 }; setEditParts(n); }} />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <Button size="icon" variant="ghost" onClick={() => setEditParts(editParts.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </CardContent></Card>
                  ))}
                </div>
              </div>

              {/* Simulador */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" />Simulador</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label>Base ({BASE_LABELS[editing.base_calculo]})</Label>
                      <Input type="number" step="0.01" value={simBase} onChange={e => setSimBase(e.target.value)} placeholder="115332.19" />
                    </div>
                  </div>
                  {simBase && (
                    <div className="text-sm font-mono space-y-1 pt-2 border-t">
                      <div className="flex justify-between"><span>Base</span><span>R$ {simBolo.b.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
                      {simBolo.lines.map((l, i) => <div key={i} className="flex justify-between text-muted-foreground"><span>(−) {l.desc}</span><span>−R$ {l.val.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>)}
                      <div className="flex justify-between font-semibold border-t pt-1"><span>Bolo líquido</span><span>R$ {simBolo.liquido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
                      <div className="pt-2 border-t">Rateio:</div>
                      {simBolo.quotas.map((q, i) => (
                        <div key={i} className={`flex justify-between ${q.tipo === "hospital_nao_paga" ? "text-muted-foreground italic" : ""}`}>
                          <span>{q.label} ({q.pct}%){q.tipo === "hospital_nao_paga" ? " — não paga" : ""}</span>
                          <span>R$ {q.val.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPoolDialog(false)}>Cancelar</Button>
            <Button onClick={savePool}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
