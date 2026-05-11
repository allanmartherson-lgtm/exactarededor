import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "@/hooks/use-toast";
import { GitBranch, Plus, Trash2, Save, ArrowRight } from "lucide-react";

type Rule = {
  id: string;
  name: string;
};

type ReferenceTable = {
  id: string;
  name: string;
};

type AccessRouteMatrix = {
  id: string;
  name: string;
  description: string | null;
  rule_id: string | null;
  primary_route_table_id: string | null;
  primary_route_multiplier: number;
  secondary_route_type: "convenio_percentage" | "fixed_amount" | "reference_table";
  secondary_route_value: number;
  secondary_route_table_id: string | null;
};

export default function AccessRouteMatrices() {
  const [matrices, setMatrices] = useState<AccessRouteMatrix[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [tables, setTables] = useState<ReferenceTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [matricesRes, rulesRes, tablesRes] = await Promise.all([
      supabase.from("access_route_matrices").select("*").order("created_at", { ascending: false }),
      supabase.from("rules").select("id, name").eq("active", true),
      supabase.from("reference_tables").select("id, name")
    ]);

    if (matricesRes.data) setMatrices(matricesRes.data as AccessRouteMatrix[]);
    if (rulesRes.data) setRules(rulesRes.data);
    if (tablesRes.data) setTables(tablesRes.data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleAdd = async () => {
    const { data, error } = await supabase
      .from("access_route_matrices")
      .insert([{ name: "Nova Matriz de Via" }])
      .select()
      .single();

    if (error) {
      toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
      return;
    }

    setMatrices([data as AccessRouteMatrix, ...matrices]);
  };

  const handleSave = async (m: AccessRouteMatrix) => {
    setSaving(true);
    const { error } = await supabase
      .from("access_route_matrices")
      .update({
        name: m.name,
        description: m.description,
        rule_id: m.rule_id,
        primary_route_table_id: m.primary_route_table_id,
        primary_route_multiplier: m.primary_route_multiplier,
        secondary_route_type: m.secondary_route_type,
        secondary_route_value: m.secondary_route_value,
        secondary_route_table_id: m.secondary_route_table_id
      })
      .eq("id", m.id);

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Matriz salva com sucesso" });
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("access_route_matrices").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      setMatrices(matrices.filter(m => m.id !== id));
      toast({ title: "Matriz excluída" });
    }
  };

  const updateMatrix = (id: string, patch: Partial<AccessRouteMatrix>) => {
    setMatrices(matrices.map(m => m.id === id ? { ...m, ...patch } : m));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Matriz de Vias de Acesso"
        description="Configure como o sistema deve se comportar dependendo da via de acesso do procedimento. Ideal para valores fixos na via principal e fallback no convênio para as demais."
        icon={GitBranch}
      />

      <div className="flex justify-end">
        <Button onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-2" /> Nova Matriz
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {loading ? (
          <p className="text-center py-10 text-muted-foreground">Carregando matrizes...</p>
        ) : matrices.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Nenhuma matriz configurada. Crie uma para começar.
            </CardContent>
          </Card>
        ) : (
          matrices.map(m => (
            <Card key={m.id} className="border-primary/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 space-y-1">
                    <Input
                      value={m.name}
                      onChange={e => updateMatrix(m.id, { name: e.target.value })}
                      className="text-lg font-bold bg-transparent border-none p-0 focus-visible:ring-0 h-auto"
                    />
                    <Input
                      value={m.description ?? ""}
                      onChange={e => updateMatrix(m.id, { description: e.target.value })}
                      placeholder="Descrição opcional..."
                      className="text-sm text-muted-foreground bg-transparent border-none p-0 focus-visible:ring-0 h-auto"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleSave(m)} disabled={saving}>
                      <Save className="h-4 w-4 mr-2" /> Salvar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)} className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Via Principal */}
                  <div className="space-y-4 p-4 rounded-lg bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-2 font-semibold text-primary">
                      <ArrowRight className="h-4 w-4" />
                      Via Única ou Principal
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Tabela de Referência (Valor Fixo)</label>
                      <Select
                        value={m.primary_route_table_id || "__none"}
                        onValueChange={v => updateMatrix(m.id, { primary_route_table_id: v === "__none" ? null : v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecionar tabela..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Não aplicar tabela</SelectItem>
                          {tables.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Multiplicador</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={m.primary_route_multiplier}
                        onChange={e => updateMatrix(m.id, { primary_route_multiplier: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  {/* Demais Vias */}
                  <div className="space-y-4 p-4 rounded-lg bg-muted/50 border border-border">
                    <div className="flex items-center gap-2 font-semibold text-muted-foreground">
                      <ArrowRight className="h-4 w-4" />
                      Demais Vias (Mesma via / Outras)
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Comportamento</label>
                      <Select
                        value={m.secondary_route_type}
                        onValueChange={v => updateMatrix(m.id, { secondary_route_type: v as any })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="convenio_percentage">Seguir Convênio (%)</SelectItem>
                          <SelectItem value="fixed_amount">Valor Fixo (R$)</SelectItem>
                          <SelectItem value="reference_table">Outra Tabela</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {m.secondary_route_type === "reference_table" ? (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Tabela de Referência</label>
                        <Select
                          value={m.secondary_route_table_id || "__none"}
                          onValueChange={v => updateMatrix(m.id, { secondary_route_table_id: v === "__none" ? null : v })}
                        >
                          <SelectTrigger><SelectValue placeholder="Selecionar tabela..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Selecionar tabela...</SelectItem>
                            {tables.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">
                          {m.secondary_route_type === "convenio_percentage" ? "Percentual (%)" : "Valor (R$)"}
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          value={m.secondary_route_value}
                          onChange={e => updateMatrix(m.id, { secondary_route_value: Number(e.target.value) })}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Vincular à Regra de Pagamento</label>
                      <Select
                        value={m.rule_id || "__none"}
                        onValueChange={v => updateMatrix(m.id, { rule_id: v === "__none" ? null : v })}
                      >
                        <SelectTrigger className="border-primary/30"><SelectValue placeholder="Selecione a regra..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Sem vínculo (regra informativa)</SelectItem>
                          {rules.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground italic">
                        Ao vincular, esta matriz controlará automaticamente os itens de cálculo da regra selecionada.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
