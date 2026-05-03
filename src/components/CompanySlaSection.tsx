import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DUE_RULE_LABELS, type CompanySlaOverride, type DueRule } from "@/lib/sla";
import { toast } from "@/hooks/use-toast";
import { Save } from "lucide-react";

/** Editor compacto de prazo específico por empresa. */
export function CompanySlaSection({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(true);
  const [ov, setOv] = useState<CompanySlaOverride | null>(null);
  const [inherit, setInherit] = useState(true);
  const [rule, setRule] = useState<DueRule>("dias_apos_aprovacao");
  const [day, setDay] = useState<number | "">("");
  const [offset, setOffset] = useState<number | "">("");
  const [priority, setPriority] = useState<"alta" | "normal" | "baixa">("normal");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    supabase.from("company_sla_overrides").select("*").eq("company_id", companyId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          const o = data as any as CompanySlaOverride;
          setOv(o); setInherit(o.inherit_default); setRule(o.due_rule);
          setDay(o.due_day ?? ""); setOffset(o.due_offset_days ?? "");
          setPriority(o.priority); setNotes(o.notes ?? "");
        } else {
          setOv(null); setInherit(true);
        }
        setLoading(false);
      });
  }, [companyId]);

  const save = async () => {
    setSaving(true);
    const payload: any = {
      company_id: companyId,
      inherit_default: inherit,
      due_rule: rule,
      due_day: day === "" ? null : Number(day),
      due_offset_days: offset === "" ? null : Number(offset),
      priority,
      notes: notes || null,
    };
    const { error } = ov
      ? await supabase.from("company_sla_overrides").update(payload).eq("id", ov.id)
      : await supabase.from("company_sla_overrides").insert(payload);
    setSaving(false);
    if (error) return toast({ title: "Erro ao salvar SLA", description: error.message, variant: "destructive" });
    toast({ title: "Prazo da empresa salvo" });
  };

  if (!companyId) {
    return <p className="text-xs text-muted-foreground">Salve a empresa para configurar prazos específicos.</p>;
  }
  if (loading) return <p className="text-xs text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-3 rounded-md border p-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Herdar SLA padrão</Label>
        <Switch checked={inherit} onCheckedChange={setInherit} />
      </div>
      {!inherit && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Regra de vencimento</Label>
            <Select value={rule} onValueChange={(v) => setRule(v as DueRule)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(DUE_RULE_LABELS) as DueRule[]).map((k) => (
                  <SelectItem key={k} value={k}>{DUE_RULE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rule === "dia_fixo" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Dia do mês (1-31)</Label>
              <Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          )}
          {(rule === "dias_apos_fechamento" || rule === "dias_apos_aprovacao") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Dias úteis</Label>
              <Input type="number" min={0} value={offset} onChange={(e) => setOffset(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          )}
        </>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs">Prioridade da empresa</Label>
        <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="baixa">Baixa</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Observação</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: pagar até último dia útil do mês" />
      </div>
      <Button size="sm" variant="outline" onClick={save} disabled={saving}>
        <Save className="h-3.5 w-3.5 mr-1" /> Salvar prazo
      </Button>
    </div>
  );
}