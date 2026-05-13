// Sub-Onda 2C — Painel mínimo de resolução de duplicidade entre cálculos da mesma regra.
// Visível apenas quando ai_status === 'erro_duplicidade_calculo'. Permite ao analista,
// validador, diretor ou admin escolher qual cálculo aplicar com justificativa ≥ 20 chars.
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ShieldAlert } from "lucide-react";

type MatchedCalc = {
  calc_id: string | null;
  label: string;
  calculation_type: string;
  expected: number;
};

export interface CalcDuplicityResolverPanelProps {
  itemId: string;
  matchedCalculations: MatchedCalc[];
  resolutionStale?: boolean;
  onResolved?: () => void;
}

const fmtCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CalcDuplicityResolverPanel({
  itemId,
  matchedCalculations,
  resolutionStale,
  onResolved,
}: CalcDuplicityResolverPanelProps) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => !!selected && justification.trim().length >= 20 && !submitting,
    [selected, justification, submitting],
  );

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-calc-duplicity", {
        body: { item_id: itemId, chosen_calc_id: selected, justification: justification.trim() },
      });
      if (error) throw error;
      toast({
        title: "Duplicidade resolvida",
        description: `Cálculo aplicado. Valor esperado: ${
          (data as any)?.expected_amount != null
            ? fmtCurrency(Number((data as any).expected_amount))
            : "—"
        }`,
      });
      onResolved?.();
    } catch (e: any) {
      toast({
        title: "Falha ao resolver duplicidade",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-primary font-medium text-sm">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        Resolver duplicidade de cálculo
      </div>

      {resolutionStale && (
        <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-soft px-2 py-1.5 text-warning-foreground text-xs">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>A regra foi alterada desde a resolução anterior. Confirme novamente qual cálculo aplicar.</span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Esta regra possui {matchedCalculations.length} cálculos que se aplicam simultaneamente
        a este item. Escolha qual cálculo deve ser aplicado:
      </p>

      <RadioGroup value={selected ?? ""} onValueChange={setSelected} className="gap-2">
        {matchedCalculations.map((c, i) => {
          const id = c.calc_id ?? `idx-${i}`;
          return (
            <Label
              key={id}
              htmlFor={`calc-${id}`}
              className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/10"
            >
              <RadioGroupItem value={id} id={`calc-${id}`} className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium break-words">{c.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {c.calculation_type} · esperado{" "}
                  <span className="tabular-nums font-medium text-foreground">
                    {fmtCurrency(Number(c.expected))}
                  </span>
                </div>
              </div>
            </Label>
          );
        })}
      </RadioGroup>

      <Textarea
        placeholder="Explique a escolha (mín. 20 caracteres)"
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        rows={3}
        className="text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {justification.trim().length}/20 caracteres mínimos
        </span>
        <Button size="sm" onClick={submit} disabled={!canSubmit}>
          {submitting ? "Resolvendo…" : "Resolver duplicidade"}
        </Button>
      </div>
    </div>
  );
}
