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
import { Trash2, Plus, Pencil, Scale, Receipt } from "lucide-react";
import { toast } from "sonner";

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
  _company_name?: string;
};

type GlosaDebt = {
  id: string;
  company_id: string;
  doctor_name: string;
  doctor_crm: string | null;
  total_debt: number;
  parcelas_default: number | null;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  _company_name?: string;
};


const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export default function CreditosDebitos() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [glosaDebts, setGlosaDebts] = useState<GlosaDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjDialogOpen, setAdjDialogOpen] = useState(false);
  const [editingAdj, setEditingAdj] = useState<Partial<Adjustment> | null>(null);
  const [editingGlosa, setEditingGlosa] = useState<GlosaDebt | null>(null);
  const [glosaParc, setGlosaParc] = useState<number>(1);
  const [busyGlosa, setBusyGlosa] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [c, a, g] = await Promise.all([
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("company_financial_adjustments").select("*").order("created_at", { ascending: false }),
      (supabase as any)
        .from("glosa_debts")
        .select("id, company_id, doctor_name, doctor_crm, total_debt, parcelas_default, status, created_at, confirmed_at")
        .eq("status", "ativo")
        .order("created_at", { ascending: false }),

    ]);
    setCompanies(c.data || []);
    const cMap = new Map((c.data || []).map((x: any) => [x.id, x.name]));
    const adjs = (a.data || []) as Adjustment[];
    setAdjustments(adjs.map(x => ({ ...x, _company_name: cMap.get(x.company_id) })));
    const debts = ((g as any).data || []) as GlosaDebt[];
    setGlosaDebts(debts.map(x => ({ ...x, _company_name: cMap.get(x.company_id) })));
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, []);

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

  const openGlosa = (g: GlosaDebt) => {
    setEditingGlosa(g);
    setGlosaParc(g.parcelas_default && g.parcelas_default > 0 ? g.parcelas_default : 1);
  };
  const saveGlosa = async () => {
    if (!editingGlosa) return;
    if (glosaParc < 1 || glosaParc > 24) {
      toast.error("Parcelas entre 1 e 24"); return;
    }
    setBusyGlosa(true);
    const { data: userData } = await supabase.auth.getUser();
    const patch: any = { parcelas_default: glosaParc };
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
        {/* Glosas ativas (de auditoria) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="w-4 h-4" />
              Glosas ativas <Badge variant="outline">{glosaDebts.length}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Saldos devedores gerados por auditoria/conciliação. Edite o parcelamento antes do próximo lote da PJ.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : glosaDebts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma glosa ativa.</p>
            ) : (
              glosaDebts.map(g => {
                const parc = g.parcelas_default ?? 1;
                const semDef = !g.parcelas_default || g.parcelas_default <= 1;
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
                        <span className={semDef ? "text-amber-600 font-medium" : ""}>
                          {parc}× de {brl(g.total_debt / parc)}
                        </span>
                        {semDef && <span className="ml-1 text-[10px] text-amber-600">(definir parcelas)</span>}
                      </div>
                    </div>
                    <Button size="sm" variant={semDef ? "default" : "outline"} onClick={() => openGlosa(g)}>
                      <Pencil className="w-3.5 h-3.5 mr-1" /> Parcelar
                    </Button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

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
                    <div className="flex items-center gap-2">
                      <Badge variant={a.tipo === "credito" ? "default" : "secondary"}>{a.tipo}</Badge>
                      <span className="font-medium text-sm">{a._company_name}</span>
                      {!a.ativo && <Badge variant="outline">Inativo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{a.descricao}</p>
                    <p className="text-xs">
                      {brl(a.valor_total)} · parc. {a.parcelas_pagas}/{a.parcelas_total} · início {a.data_inicio}
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
          <DialogHeader><DialogTitle>Parcelar glosa</DialogTitle></DialogHeader>
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
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGlosa(null)} disabled={busyGlosa}>Cancelar</Button>
            <Button onClick={saveGlosa} disabled={busyGlosa}>{busyGlosa ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: novo/editar ajuste manual */}
      <Dialog open={adjDialogOpen} onOpenChange={setAdjDialogOpen}>
        <DialogContent className="max-w-xl">
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
                <Input type="date" value={editingAdj.data_inicio || ""} onChange={e => setEditingAdj({ ...editingAdj, data_inicio: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Descrição</Label>
                <Input value={editingAdj.descricao || ""} onChange={e => setEditingAdj({ ...editingAdj, descricao: e.target.value })} />
              </div>
              <div>
                <Label>Valor total (R$)</Label>
                <Input type="number" step="0.01" value={editingAdj.valor_total ?? ""} onChange={e => setEditingAdj({ ...editingAdj, valor_total: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Parcelas total</Label>
                <Input type="number" min={1} value={editingAdj.parcelas_total ?? 1} onChange={e => setEditingAdj({ ...editingAdj, parcelas_total: parseInt(e.target.value) || 1 })} />
              </div>
              <div>
                <Label>Parcelas pagas</Label>
                <Input type="number" min={0} value={editingAdj.parcelas_pagas ?? 0} onChange={e => setEditingAdj({ ...editingAdj, parcelas_pagas: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Origem</Label>
                <Input value={editingAdj.origem || ""} onChange={e => setEditingAdj({ ...editingAdj, origem: e.target.value })} placeholder="ex: manual, glosa 03/2025" />
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
