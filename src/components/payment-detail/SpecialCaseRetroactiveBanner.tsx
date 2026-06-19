import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

const CLOSED_STATUSES = new Set([
  "pago",
  "fechado",
  "concluido",
  "aprovado_diretor",
  "aprovado",
]);

interface Props {
  paymentId: string;
  paymentStatus: string;
  paymentUpdatedAt?: string | null;
}

interface MarkRow {
  id: string;
  attendance_number: string | null;
  item_id: string | null;
  special_case_type_code: string;
  approved_at: string | null;
  updated_at: string;
}

export function SpecialCaseRetroactiveBanner({ paymentId, paymentStatus, paymentUpdatedAt }: Props) {
  const { toast } = useToast();
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [recomputing, setRecomputing] = useState(false);

  const isClosed = CLOSED_STATUSES.has(paymentStatus);

  useEffect(() => {
    if (!paymentId || !isClosed) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("special_case_marks")
        .select("id, attendance_number, item_id, special_case_type_code, approved_at, updated_at")
        .eq("payment_id", paymentId)
        .eq("status", "approved");
      if (!alive) return;
      const cutoff = paymentUpdatedAt ? new Date(paymentUpdatedAt).getTime() : 0;
      const after = ((data as MarkRow[] | null) ?? []).filter((m) => {
        const t = new Date(m.approved_at || m.updated_at).getTime();
        return cutoff === 0 || t > cutoff;
      });
      setMarks(after);
    })();
    return () => {
      alive = false;
    };
  }, [paymentId, isClosed, paymentUpdatedAt]);

  if (!isClosed || marks.length === 0) return null;

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const { error } = await supabase.functions.invoke("analyze-payment", {
        body: { paymentId, mode: "recompute" },
      });
      if (error) throw error;
      toast({
        title: "Reanálise enfileirada",
        description: "O motor vai reaplicar as regras considerando os casos especiais aprovados.",
      });
    } catch (e: any) {
      toast({
        title: "Falha ao reanalisar",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setRecomputing(false);
    }
  };

  return (
    <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
      <Sparkles className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-900 dark:text-amber-200">
        {marks.length} caso{marks.length > 1 ? "s" : ""} especial{marks.length > 1 ? "is" : ""} aprovado{marks.length > 1 ? "s" : ""} após o fechamento
      </AlertTitle>
      <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
        Este pagamento já está fechado. As regras diferenciadas para casos especiais
        não foram aplicadas automaticamente. Decida manualmente se deve recalcular e
        gerar ajuste retroativo.
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleRecompute} disabled={recomputing}>
            {recomputing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Recalcular com casos especiais
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/casos-especiais">Ver marcações</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
