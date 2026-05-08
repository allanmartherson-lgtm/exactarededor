import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/lib/status";
import type { SlaSetting, SlaSeverity } from "@/lib/sla";
import { toast } from "@/hooks/use-toast";
import { Save, Plus } from "lucide-react";

const RELEVANT_STATUSES: PaymentStatus[] = [
  "em_analise_ia", "revisao_analista", "aguardando_validacao", "devolvido_analista",
  "aguardando_aprovacao", "aprovado_em_revisao", "pedido_nf_enviado", "nf_recebida",
  "nf_divergente", "pago",
];

const SEVERITY_OPTIONS: { value: SlaSeverity; label: string }[] = [
  { value: "informativo", label: "Informativo" },
  { value: "alerta", label: "Alerta" },
  { value: "critico", label: "Crítico" },
];

const SlaSettings = () => {
  const [items, setItems] = useState<SlaSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Prazos e SLA | MedPay Approval";
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("sla_settings").select("*");
    setItems((data ?? []) as any);
    setLoading(false);
  };

  const byStatus = useMemo(() => {
    const m = new Map<string, SlaSetting>();
    items.forEach((i) => m.set(i.status, i));
    return m;
  }, [items]);

  const upsert = async (status: PaymentStatus, patch: Partial<SlaSetting>) => {
    setSaving(status);
    const existing = byStatus.get(status);
    const payload: any = {
      status,
      business_days: existing?.business_days ?? 5,
      warning_pct: existing?.warning_pct ?? 80,
      severity: existing?.severity ?? "alerta",
      active: existing?.active ?? true,
      ...patch,
    };
    if (existing) {
      const { error } = await supabase.from("sla_settings").update(payload).eq("id", existing.id);
      if (error) toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      else toast({ title: "SLA atualizado" });
    } else {
      const { error } = await supabase.from("sla_settings").insert(payload);
      if (error) toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
      else toast({ title: "SLA criado" });
    }
    setSaving(null);
    load();
  };

  return (
    <>
      <PageHeader title="Prazos e SLA" description="Defina o prazo padrão (em dias úteis) para cada status do fluxo." />
      <div className="p-8 space-y-3 max-w-5xl">
        <Card>
          <CardContent className="p-0">
            <div className="grid grid-cols-[2fr_110px_110px_140px_90px_110px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground border-b">
              <span>Status</span>
              <span>Dias úteis</span>
              <span>Alerta (%)</span>
              <span>Severidade ao vencer</span>
              <span>Ativo</span>
              <span>Ação</span>
            </div>
            {loading ? (
              <div className="px-4 py-10 text-sm text-muted-foreground text-center">Carregando…</div>
            ) : (
              RELEVANT_STATUSES.map((status) => {
                const it = byStatus.get(status);
                return (
                  <SlaRow
                    key={status}
                    status={status}
                    item={it}
                    saving={saving === status}
                    onSave={(patch) => upsert(status, patch)}
                  />
                );
              })
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Os prazos são em dias úteis (sábados, domingos não contam). Empresas podem ter regras específicas que sobrepõem o padrão.
        </p>
      </div>
    </>
  );
};

function SlaRow({ status, item, saving, onSave }: {
  status: PaymentStatus;
  item?: SlaSetting;
  saving: boolean;
  onSave: (patch: Partial<SlaSetting>) => void;
}) {
  const [days, setDays] = useState(item?.business_days ?? 5);
  const [pct, setPct] = useState(item?.warning_pct ?? 80);
  const [sev, setSev] = useState<SlaSeverity>(item?.severity ?? "alerta");
  const [active, setActive] = useState(item?.active ?? true);

  useEffect(() => {
    setDays(item?.business_days ?? 5);
    setPct(item?.warning_pct ?? 80);
    setSev(item?.severity ?? "alerta");
    setActive(item?.active ?? true);
  }, [item?.id]);

  return (
    <div className="grid grid-cols-[2fr_110px_110px_140px_90px_110px] gap-3 px-4 py-2 items-center border-b last:border-0 text-sm">
      <span className="truncate">{PAYMENT_STATUS_LABELS[status]}</span>
      <Input type="number" min={0} value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8" />
      <Input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="h-8" />
      <Select value={sev} onValueChange={(v) => setSev(v as SlaSeverity)}>
        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          {SEVERITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Switch checked={active} onCheckedChange={setActive} />
      <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave({ business_days: days, warning_pct: pct, severity: sev, active })}>
        {item ? <Save className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
        {item ? "Salvar" : "Criar"}
      </Button>
    </div>
  );
}

export default SlaSettings;