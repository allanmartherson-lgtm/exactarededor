import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { SpecialCaseRetroactiveAdjustDialog } from "./SpecialCaseRetroactiveAdjustDialog";

const CLOSED_STATUSES = new Set([
  "pago", "fechado", "concluido", "aprovado_diretor", "aprovado",
]);

interface Props {
  paymentId: string;
  paymentStatus: string;
  paymentUpdatedAt?: string | null;
  hospitalId?: string | null;
}

interface MarkRow {
  id: string;
  attendance_number: string | null;
  item_id: string | null;
  special_case_type_code: string;
  doctor_id: string | null;
  approved_at: string | null;
  updated_at: string;
  retro_adjustment_id: string | null;
}

export function SpecialCaseRetroactiveBanner({ paymentId, paymentStatus, paymentUpdatedAt, hospitalId }: Props) {
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const isClosed = CLOSED_STATUSES.has(paymentStatus);

  const load = async () => {
    // Momento real de fechamento: último status_history que entrou em algum CLOSED_STATUSES.
    const { data: history } = await supabase
      .from("payment_status_history")
      .select("status_to, changed_at")
      .eq("payment_id", paymentId)
      .order("changed_at", { ascending: false })
      .limit(50);
    const closedEvent = (history ?? []).find((h: any) => CLOSED_STATUSES.has(h.status_to));
    const cutoffStr = closedEvent?.changed_at ?? paymentUpdatedAt ?? null;
    const cutoff = cutoffStr ? new Date(cutoffStr).getTime() : 0;

    const { data } = await supabase
      .from("special_case_marks")
      .select("id, attendance_number, item_id, special_case_type_code, doctor_id, approved_at, updated_at, retro_adjustment_id")
      .eq("payment_id", paymentId)
      .eq("status", "approved");
    const after = ((data as MarkRow[] | null) ?? []).filter((m) => {
      if (m.retro_adjustment_id) return false; // já materializadas em ajuste
      const t = new Date(m.approved_at || m.updated_at).getTime();
      return cutoff === 0 || t > cutoff;
    });
    setMarks(after);
  };

  useEffect(() => {
    if (!paymentId || !isClosed) return;
    let alive = true;
    (async () => { await load(); if (!alive) return; })();
    return () => { alive = false; };
  }, [paymentId, isClosed, paymentUpdatedAt]);

  if (!isClosed || marks.length === 0) return null;

  return (
    <>
      <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
        <Sparkles className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-900 dark:text-amber-200">
          {marks.length} caso{marks.length > 1 ? "s" : ""} especial{marks.length > 1 ? "is" : ""} aprovado{marks.length > 1 ? "s" : ""} após o fechamento
        </AlertTitle>
        <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
          O pagamento já está fechado e <strong>não</strong> será recalculado.
          Gere um ajuste retroativo formal (complemento ou dedução) por PJ.
          Reduções exigem confirmação explícita.
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              Gerar ajuste retroativo
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/casos-especiais">Ver marcações</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>

      <SpecialCaseRetroactiveAdjustDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        paymentId={paymentId}
        hospitalId={hospitalId}
        marks={marks.map((m) => ({
          id: m.id,
          attendance_number: m.attendance_number,
          special_case_type_code: m.special_case_type_code,
          doctor_id: m.doctor_id,
          item_id: m.item_id,
        }))}
        onApplied={load}
      />
    </>
  );
}
