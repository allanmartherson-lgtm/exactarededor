import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Adjustment = {
  id: string;
  company_id: string;
  tipo: string;
  descricao: string;
  valor_total: number;
  parcelas_total: number;
  parcelas_pagas: number;
  data_inicio: string;
  origem: string | null;
  ativo: boolean;
  created_at: string;
};

const TIPOS = [
  { v: "credito", l: "Crédito (favor empresa)" },
  { v: "debito", l: "Débito (favor hospital)" },
  { v: "glosa_parcelada", l: "Glosa parcelada" },
  { v: "acordo", l: "Acordo" },
];

const brl = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CompanyFinancialAdjustmentsDialog({
  open, onOpenChange, companyId, companyName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  companyName: string;
}) {
  const [items, setItems] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    tipo: "credito",
    descricao: "",
    valor_total: "",
    parcelas_total: "1",
    data_inicio: new Date().toISOString().slice(0, 10),
    origem: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("company_financial_adjustments")
      .select("*").eq("company_id", companyId).order("created_at", { ascending: false });
    setItems((data as Adjustment[]) ?? []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const save = async () => {
    const valor = Number(form.valor_total.replace(",", "."));
    const parc = Number(form.parcelas_total);
    if (!form.descricao.trim() || !valor || !parc) {
      toast({ title: "Preencha descrição, valor e parcelas", variant: "destructive" });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("company_financial_adjustments").insert({
      company_id: companyId,
      tipo: form.tipo,
      descricao: form.descricao.trim(),
      valor_total: valor,
      parcelas_total: parc,
      parcelas_pagas: 0,
      data_inicio: form.data_inicio,
      origem: form.origem.trim() || null,
      ativo: true,
      created_by: user?.id ?? null,
    } as any);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    setForm({ tipo: "credito", descricao: "", valor_total: "", parcelas_total: "1", data_inicio: new Date().toISOString().slice(0, 10), origem: "" });
    setCreating(false);
    await load();
    toast({ title: "Ajuste cadastrado" });
  };

  const toggleAtivo = async (a: Adjustment) => {
    await supabase.from("company_financial_adjustments")
      .update({ ativo: !a.ativo }).eq("id", a.id);
    await load();
  };

  const remove = async (a: Adjustment) => {
    if (!confirm("Remover este ajuste? Aplicações já feitas em pagamentos não serão revertidas.")) return;
    const { error } = await supabase.from("company_financial_adjustments").delete().eq("id", a.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    await load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Financeiro — {companyName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Créditos, débitos e parcelamentos aplicados nos pagamentos desta empresa.
            </p>
            <Button size="sm" onClick={() => setCreating(v => !v)} variant={creating ? "outline" : "default"}>
              <Plus className="h-3.5 w-3.5 mr-1" /> {creating ? "Cancelar" : "Novo ajuste"}
            </Button>
          </div>

          {creating && (
            <div className="rounded-md border p-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select value={form.tipo} onValueChange={v => setForm(f => ({ ...f, tipo: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TIPOS.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Data de início</Label>
                  <Input type="date" value={form.data_inicio} onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Descrição</Label>
                <Input placeholder="Ex: Crédito devolução plantão fev/26" value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Valor total (R$)</Label>
                  <Input placeholder="6000.00" value={form.valor_total} onChange={e => setForm(f => ({ ...f, valor_total: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Parcelas</Label>
                  <Input type="number" min="1" value={form.parcelas_total} onChange={e => setForm(f => ({ ...f, parcelas_total: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Origem (opcional)</Label>
                  <Input placeholder="acordo, glosa..." value={form.origem} onChange={e => setForm(f => ({ ...f, origem: e.target.value }))} />
                </div>
              </div>
              <DialogFooter>
                <Button size="sm" onClick={save}>Cadastrar</Button>
              </DialogFooter>
            </div>
          )}

          {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
            : items.length === 0 ? <p className="text-sm text-muted-foreground italic">Nenhum ajuste cadastrado.</p>
            : (
              <div className="space-y-2">
                {items.map(a => {
                  const parcelaValor = a.valor_total / a.parcelas_total;
                  const restantes = a.parcelas_total - a.parcelas_pagas;
                  return (
                    <div key={a.id} className="rounded-md border p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={a.tipo === "credito" ? "default" : a.tipo === "debito" ? "destructive" : "secondary"}>
                            {TIPOS.find(t => t.v === a.tipo)?.l ?? a.tipo}
                          </Badge>
                          {!a.ativo && <Badge variant="outline">Inativo</Badge>}
                          <span className="text-xs text-muted-foreground">desde {new Date(a.data_inicio).toLocaleDateString("pt-BR")}</span>
                        </div>
                        <p className="text-sm">{a.descricao}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {brl(a.valor_total)} em {a.parcelas_total}x de {brl(parcelaValor)} · {a.parcelas_pagas}/{a.parcelas_total} aplicadas · {restantes} restante(s)
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={a.ativo} onCheckedChange={() => toggleAtivo(a)} />
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(a)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
