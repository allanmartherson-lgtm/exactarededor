/**
 * Widget "Convênios defasados por piso".
 *
 * Consulta v_piso_recorrencia (view SQL) para os últimos 3 meses e ranqueia
 * regras/convênios em que o piso mínimo garantido está prevalecendo com
 * frequência — sinal de que a tabela do convênio ficou defasada e vale
 * renegociar. RLS respeita o hospital ativo (security_invoker na view).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { useHospital } from "@/contexts/HospitalContext";
import { formatCurrency } from "@/lib/status";

type Row = {
  rule_id: string;
  competencia: string;
  items_com_piso: number;
  items_piso_aplicado: number;
  total_complementado: number;
  pct_piso_aplicado: number;
};

type Aggregated = {
  rule_id: string;
  rule_name: string;
  months: number;
  total_items_piso: number;
  total_items_com_piso: number;
  total_complementado: number;
  pct_medio: number;
};

// Umbrais definidos com o negócio: ≥30% dos itens com piso vencedor por
// ao menos 2 meses caracteriza defasagem que merece renegociação.
const PCT_THRESHOLD = 30;
const MONTHS_THRESHOLD = 2;

export function PisoDefasagemCard({ onSelectRule }: { onSelectRule?: (id: string) => void }) {
  const { hospital } = useHospital();
  const activeHospitalId = hospital?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Aggregated[]>([]);

  useEffect(() => {
    if (!activeHospitalId) return;
    (async () => {
      setLoading(true);
      try {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 3);
        cutoff.setDate(1);
        const { data } = await supabase
          .from("v_piso_recorrencia" as any)
          .select("*")
          .eq("hospital_id", activeHospitalId)
          .gte("competencia", cutoff.toISOString().slice(0, 10));

        const raw = (data ?? []) as unknown as Row[];
        if (raw.length === 0) {
          setRows([]);
          return;
        }

        // Buscar nomes das regras
        const ruleIds = Array.from(new Set(raw.map((r) => r.rule_id).filter(Boolean)));
        const { data: rules } = await supabase
          .from("rules")
          .select("id, name")
          .in("id", ruleIds);
        const nameByRule = new Map((rules ?? []).map((r: any) => [r.id, r.name as string]));

        // Agrega por rule_id
        const byRule = new Map<string, Row[]>();
        for (const r of raw) {
          const arr = byRule.get(r.rule_id) ?? [];
          arr.push(r);
          byRule.set(r.rule_id, arr);
        }

        const aggregated: Aggregated[] = Array.from(byRule.entries())
          .map(([rule_id, arr]) => {
            const months = arr.filter((a) => a.pct_piso_aplicado >= PCT_THRESHOLD).length;
            const total_items_piso = arr.reduce((s, a) => s + a.items_piso_aplicado, 0);
            const total_items_com_piso = arr.reduce((s, a) => s + a.items_com_piso, 0);
            const total_complementado = arr.reduce((s, a) => s + Number(a.total_complementado || 0), 0);
            const pct_medio = total_items_com_piso === 0
              ? 0
              : Math.round((100 * total_items_piso) / total_items_com_piso);
            return {
              rule_id,
              rule_name: nameByRule.get(rule_id) ?? "(regra removida)",
              months,
              total_items_piso,
              total_items_com_piso,
              total_complementado,
              pct_medio,
            };
          })
          .filter((a) => a.months >= MONTHS_THRESHOLD && a.pct_medio >= PCT_THRESHOLD)
          .sort((a, b) => b.total_complementado - a.total_complementado)
          .slice(0, 8);

        setRows(aggregated);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeHospitalId]);

  if (loading || rows.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-amber-900">
          <TrendingUp className="h-4 w-4" />
          Convênios possivelmente defasados
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800">
            piso venceu em ≥{PCT_THRESHOLD}% dos itens por {MONTHS_THRESHOLD}+ meses
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-amber-900/80">
          Nestas regras o piso mínimo garantido está prevalecendo sobre o valor do convênio de forma recorrente.
          Vale reavaliar a tabela negociada com o convênio.
        </p>
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.rule_id}
              className="flex items-center gap-2 rounded-md border border-amber-200 bg-white/70 px-2 py-1.5 text-xs"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{r.rule_name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {r.pct_medio}% dos itens com piso · {r.total_items_piso}/{r.total_items_com_piso} procedimentos · {r.months} mês(es) acima do limite
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-amber-900">{formatCurrency(r.total_complementado)}</p>
                <p className="text-[9px] text-muted-foreground uppercase">complementado</p>
              </div>
              {onSelectRule && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => onSelectRule(r.rule_id)}
                >
                  Abrir
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
