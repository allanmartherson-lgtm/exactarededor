import { useEffect, useState } from "react";
import { Shield, ShieldCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/status";

type Application = {
  id: string;
  rule_id: string;
  competence_month: string;
  producao_calculada: number;
  piso_aplicado: number;
  complemento_valor: number;
  status: string;
  applied_at: string;
  rules?: { name?: string | null } | null;
};

interface Props {
  paymentId: string;
  companyId: string;
  canRecalc?: boolean;
}

export function MinimumGuaranteeCard({ paymentId, companyId, canRecalc = false }: Props) {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalc, setRecalc] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("minimum_guarantee_applications")
      .select("id, rule_id, competence_month, producao_calculada, piso_aplicado, complemento_valor, status, applied_at, rules(name)")
      .eq("payment_id", paymentId)
      .eq("company_id", companyId)
      .eq("status", "aplicado")
      .order("applied_at", { ascending: false });
    setApps((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [paymentId, companyId]);

  const handleRecalc = async () => {
    setRecalc(true);
    try {
      const { error } = await supabase.functions.invoke("apply-minimum-guarantee", {
        body: { payment_id: paymentId },
      });
      if (error) throw error;
      toast({ title: "Mínimo garantido recalculado" });
      await load();
    } catch (e: any) {
      toast({ title: "Falha ao recalcular", description: e?.message, variant: "destructive" });
    } finally {
      setRecalc(false);
    }
  };

  if (loading || apps.length === 0) return null;

  return (
    <Card className="p-3 space-y-2 border-l-4 border-l-primary">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Complemento de mínimo garantido
          <Badge variant="secondary" className="ml-1">{apps.length}</Badge>
        </div>
        {canRecalc && (
          <Button size="sm" variant="ghost" onClick={handleRecalc} disabled={recalc}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${recalc ? "animate-spin" : ""}`} />
            Recalcular
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        {apps.map((a) => (
          <div key={a.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center text-xs border-t pt-1.5 first:border-t-0 first:pt-0">
            <div className="min-w-0">
              <div className="font-medium truncate flex items-center gap-1">
                <Shield className="h-3 w-3 text-muted-foreground" />
                {a.rules?.name ?? "Regra"}
              </div>
              <div className="text-muted-foreground text-[11px]">
                Competência {a.competence_month}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase text-muted-foreground">Produção</div>
              <div>{formatCurrency(a.producao_calculada)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase text-muted-foreground">Piso</div>
              <div>{formatCurrency(a.piso_aplicado)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase text-muted-foreground">Complemento</div>
              <div className="font-semibold text-primary">+ {formatCurrency(a.complemento_valor)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
