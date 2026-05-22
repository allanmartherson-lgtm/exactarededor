import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { Users } from "lucide-react";
import { formatBRL } from "@/lib/financialStats";

interface ItemRow {
  payment_id: string;
  doctor_name: string;
  gross_amount: number;
  payments?: { reference: string | null; title: string | null; status: string } | null;
}

interface Concentration {
  payment_id: string;
  reference: string;
  doctor_name: string;
  amount: number;
  total: number;
  pct: number;
}

export const DoctorConcentrationTab = () => {
  const [rows, setRows] = useState<ItemRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);
      const { data } = await supabase
        .from("payment_items")
        .select("payment_id,doctor_name,gross_amount,payments!inner(reference,title,status)")
        .gt("gross_amount", 0)
        .gte("created_at", cutoff.toISOString())
        .not("payments.status", "in", '("rascunho","cancelado","rejeitado")')
        .limit(50000);
      setRows((data as unknown as ItemRow[]) ?? []);
    })();
  }, []);

  const concentrations = useMemo<Concentration[]>(() => {
    if (!rows) return [];
    const totals = new Map<string, number>();
    const refMap = new Map<string, string>();
    const perDoctor = new Map<string, number>();
    for (const r of rows) {
      const v = Number(r.gross_amount);
      totals.set(r.payment_id, (totals.get(r.payment_id) ?? 0) + v);
      refMap.set(r.payment_id, r.payments?.reference ?? r.payments?.title ?? "Sem referência");
      const k = `${r.payment_id}|||${r.doctor_name}`;
      perDoctor.set(k, (perDoctor.get(k) ?? 0) + v);
    }
    const out: Concentration[] = [];
    for (const [k, amount] of perDoctor) {
      const [paymentId, doctor] = k.split("|||");
      const total = totals.get(paymentId) ?? 0;
      if (total <= 0) continue;
      const pct = (amount / total) * 100;
      if (pct > 30) {
        out.push({
          payment_id: paymentId,
          reference: refMap.get(paymentId) ?? "Sem referência",
          doctor_name: doctor,
          amount,
          total,
          pct,
        });
      }
    }
    return out.sort((a, b) => b.pct - a.pct);
  }, [rows]);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Concentração por médico"
        icon={Users}
        iconColor="red"
        subtitle="Lotes onde um único médico representa mais de 30% do valor"
      />
      <div className="p-4">
        {!rows ? (
          <Skeleton className="h-40 w-full" />
        ) : concentrations.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">
            Nenhum lote com concentração acima de 30% nos últimos 6 meses.
          </p>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lote</TableHead>
                    <TableHead>Médico</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Total lote</TableHead>
                    <TableHead className="text-right">% do lote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {concentrations.slice(0, 100).map((c) => (
                    <TableRow key={`${c.payment_id}-${c.doctor_name}`}>
                      <TableCell>
                        <Link to={`/pagamentos/${c.payment_id}`} className="text-primary hover:underline font-medium">
                          {c.reference}
                        </Link>
                      </TableCell>
                      <TableCell>{c.doctor_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBRL(c.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatBRL(c.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={c.pct > 50 ? "destructive" : "secondary"}>{c.pct.toFixed(1)}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Exibindo os {concentrations.length} casos de concentração encontrados nos últimos 6 meses.
            </p>
          </>
        )}
      </div>
    </SurfaceCard>
  );
};
