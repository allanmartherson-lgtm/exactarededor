import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { AlertTriangle } from "lucide-react";

interface Row {
  id: string;
  payment_id: string;
  company_name: string | null;
  payments?: { reference: string | null; approved_at: string | null } | null;
}

export const FiscalDeadlineAlerts = () => {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("invoices")
        .select("id,payment_id,company_name,payments(reference,approved_at)")
        .eq("status", "aguardando")
        .not("sent_at", "is", null);
      setRows((data as Row[]) ?? []);
    })();
  }, []);

  const alerts = useMemo(() => {
    if (!rows) return [];
    const now = Date.now();
    return rows
      .map((r) => {
        const approvedAt = r.payments?.approved_at ? new Date(r.payments.approved_at).getTime() : null;
        if (!approvedAt) return null;
        const days = Math.floor((now - approvedAt) / 86400000);
        return { ...r, days, approvedAt };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null && r.days > 25)
      .sort((a, b) => b.days - a.days);
  }, [rows]);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Alertas de prazo fiscal"
        icon={AlertTriangle}
        iconColor="red"
        subtitle="NF deve ser emitida em até 30 dias após aprovação"
        countPill={alerts.length}
      />
      <div className="p-4">
        {!rows ? (
          <Skeleton className="h-32 w-full" />
        ) : alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">
            Nenhuma NF próxima do prazo fiscal de 30 dias.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Aprovado em</TableHead>
                  <TableHead>Dias decorridos</TableHead>
                  <TableHead>Urgência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.company_name ?? "—"}</TableCell>
                    <TableCell>
                      <Link to={`/pagamentos/${a.payment_id}`} className="text-primary hover:underline">
                        {a.payments?.reference ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(a.approvedAt).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="tabular-nums">{a.days}d</TableCell>
                    <TableCell>
                      <Badge variant={a.days >= 30 ? "destructive" : "default"}>
                        {a.days >= 30 ? "Vencido" : "Atenção"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
};
