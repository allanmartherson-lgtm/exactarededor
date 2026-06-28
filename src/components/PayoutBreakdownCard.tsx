/**
 * Renderização universal de `payments.payout_breakdown` (Onda 3).
 *
 * Lê a estrutura JSON gravada por NewManualPaymentComposicao e mostra a memória
 * de cálculo em qualquer lugar — portal do médico, detalhe do pagamento, DRE
 * expandido, PDF, etc. Tolerante a payloads parciais (campos faltando).
 *
 * Não tem nada específico de fisio: o componente é dirigido pela lista de
 * `rubrics` que veio do modelo aplicado.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { formatBRL, type BreakdownLine } from "@/lib/payoutComposition";

interface BreakdownShape {
  model_id?: string;
  model_version?: number;
  model_name?: string;
  company_name?: string;
  computed_at?: string;
  rubrics?: BreakdownLine[];
  total_bases?: number;
  total_descontos?: number;
  total_acrescimos?: number;
  total_retencoes?: number;
  total_nf?: number;
}

interface Props {
  breakdown: BreakdownShape | null | undefined;
  /** Renderização compacta para portal/email (sem totais por categoria). */
  compact?: boolean;
  className?: string;
}

export function PayoutBreakdownCard({ breakdown, compact = false, className }: Props) {
  if (!breakdown || !Array.isArray(breakdown.rubrics) || breakdown.rubrics.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Memória de cálculo
          {breakdown.model_name && (
            <span className="text-xs font-normal text-muted-foreground">
              · {breakdown.model_name}
              {breakdown.model_version != null && <> (v{breakdown.model_version})</>}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="space-y-1">
          {breakdown.rubrics.map((l) => (
            <div key={l.order} className="flex justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                <span className="font-mono">{l.order}.</span> {l.label}
                {l.pct != null && <span className="ml-1 text-[10px]">({l.pct}%)</span>}
                {l.tier_quantity != null && l.tier_quantity > 0 && (
                  <span className="ml-1 text-[10px]">({l.tier_quantity})</span>
                )}
              </span>
              <span className={l.value < 0 ? "text-destructive" : "text-foreground"}>
                {formatBRL(l.value)}
              </span>
            </div>
          ))}
        </div>

        {!compact && (
          <div className="border-t pt-2 space-y-1 text-xs">
            {breakdown.total_bases != null && <Row label="Bases" value={breakdown.total_bases} />}
            {breakdown.total_acrescimos != null && <Row label="Acréscimos" value={breakdown.total_acrescimos} />}
            {breakdown.total_descontos != null && <Row label="Descontos" value={breakdown.total_descontos} />}
            {breakdown.total_retencoes != null && <Row label="Retenções" value={breakdown.total_retencoes} />}
          </div>
        )}

        {breakdown.total_nf != null && (
          <div className="border-t pt-2 flex justify-between font-semibold text-success">
            <span>Valor a faturar em NF</span>
            <span>{formatBRL(breakdown.total_nf)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span>{formatBRL(value)}</span>
    </div>
  );
}
