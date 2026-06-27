import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRightLeft, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MISMATCH_THRESHOLD = 0.2; // ≥20% dos itens fora da competência → sugere remessa
const DISMISS_KEY = (id: string) => `descompasso_dismissed:${id}`;

/**
 * Diagnóstico de descompasso entre data de atendimento dos itens e a
 * competência declarada no lote. Disparado APENAS quando o regime é
 * 'producao' — a regra é: se muitos itens caem fora do mês da competência,
 * o lote provavelmente é uma remessa (envio agregando meses anteriores).
 *
 * Por que aqui (e não no relatório de parecer): relatório com range maior
 * que a competência é cenário normal (analista sobe base anual). O sinal
 * confiável é a data dos próprios itens da base de pagamento.
 */
export function ProducaoDescompassoBanner({
  paymentId,
  competenceRegime,
  competenceMonth,
  onRegimeChanged,
}: {
  paymentId: string;
  competenceRegime: string | null;
  competenceMonth: string | null;
  onRegimeChanged?: () => void;
}) {
  const { toast } = useToast();
  const [stats, setStats] = useState<{ total: number; fora: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY(paymentId)) === "1");
  }, [paymentId]);

  useEffect(() => {
    let cancelled = false;
    if (competenceRegime !== "producao" || !competenceMonth) {
      setStats(null);
      return;
    }
    (async () => {
      const monthKey = String(competenceMonth).slice(0, 7); // YYYY-MM
      const { data, error } = await supabase
        .from("payment_items")
        .select("procedure_date")
        .eq("payment_id", paymentId)
        .not("procedure_date", "is", null)
        .limit(5000);
      if (cancelled || error) return;
      const rows = (data ?? []) as { procedure_date: string | null }[];
      const total = rows.length;
      const fora = rows.filter((r) => {
        const k = String(r.procedure_date ?? "").slice(0, 7);
        return k && k !== monthKey;
      }).length;
      setStats({ total, fora });
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId, competenceRegime, competenceMonth]);

  if (
    dismissed ||
    !stats ||
    stats.total < 10 ||
    stats.fora / stats.total < MISMATCH_THRESHOLD ||
    competenceRegime !== "producao"
  ) {
    return null;
  }

  const pct = Math.round((stats.fora / stats.total) * 100);
  const competenceLabel = (() => {
    const [y, m] = String(competenceMonth ?? "").slice(0, 7).split("-");
    if (!y || !m) return "competência";
    const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${meses[Number(m) - 1]}/${y}`;
  })();

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY(paymentId), "1");
    setDismissed(true);
  };

  const mudarParaRemessa = async () => {
    setChanging(true);
    try {
      const { error } = await supabase
        .from("payments")
        .update({ competence_regime: "remessa" } as any)
        .eq("id", paymentId);
      if (error) throw error;
      toast({
        title: "Regime alterado para remessa",
        description: "O rateio e a DRE passam a usar a competência do lote como envio agregado. Recalcule se necessário.",
      });
      onRegimeChanged?.();
    } catch (e: any) {
      toast({ title: "Falha ao alterar regime", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setChanging(false);
    }
  };

  return (
    <Card className="border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/15 p-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">
            Zeev detectou descompasso de competência
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            <strong>{stats.fora}</strong> de {stats.total} itens ({pct}%) têm data de atendimento fora de{" "}
            <strong>{competenceLabel}</strong>. Esse lote parece ser uma <strong>remessa</strong>{" "}
            (envio agregando competências anteriores). Mudar o regime garante que rateio e DRE
            reflitam o mês correto.
          </p>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={mudarParaRemessa} disabled={changing}>
              {changing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
              )}
              Mudar para remessa
            </Button>
            <Button size="sm" variant="outline" onClick={dismiss}>
              Manter produção
            </Button>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={dismiss} title="Dispensar">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
