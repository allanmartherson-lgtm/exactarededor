import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { Clock, Send } from "lucide-react";
import { formatBRL } from "@/lib/financialStats";

interface InvoiceRow {
  id: string;
  payment_id: string;
  company_name: string | null;
  expected_amount: number;
  sent_at: string;
  recipient_email: string;
  payments?: { reference: string | null } | null;
}

const bucketOf = (days: number) => {
  if (days <= 7) return { label: "0-7d", variant: "secondary" as const, order: 0 };
  if (days <= 14) return { label: "8-14d", variant: "secondary" as const, order: 1 };
  if (days <= 30) return { label: "15-30d", variant: "default" as const, order: 2 };
  return { label: "30+d", variant: "destructive" as const, order: 3 };
};

export const InvoiceAgingSection = () => {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("invoices")
      .select("id,payment_id,company_name,expected_amount,sent_at,recipient_email,payments(reference)")
      .eq("status", "aguardando")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: true });
    setRows((data as InvoiceRow[]) ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const enriched = useMemo(() => {
    if (!rows) return [];
    const now = Date.now();
    return rows
      .map((r) => {
        const days = Math.floor((now - new Date(r.sent_at).getTime()) / 86400000);
        return { ...r, days, bucket: bucketOf(days) };
      })
      .sort((a, b) => b.bucket.order - a.bucket.order || b.days - a.days);
  }, [rows]);

  const handleResend = async (id: string) => {
    setSending(id);
    try {
      const { error } = await supabase.functions.invoke("send-invoice-request", { body: { invoice_id: id } });
      if (error) throw error;
      toast({ title: "Reenvio disparado" });
      await load();
    } catch (e) {
      toast({ title: "Falha no reenvio", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSending(null);
    }
  };

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Aging de NF pendentes"
        icon={Clock}
        iconColor="yellow"
        subtitle="NFs solicitadas e ainda não recebidas"
        countPill={enriched.length}
      />
      <div className="p-4">
        {!rows ? (
          <Skeleton className="h-40 w-full" />
        ) : enriched.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">Nenhuma NF aguardando.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead className="text-right">Valor esperado</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead>Aguardando</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enriched.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.company_name ?? "—"}</TableCell>
                    <TableCell>
                      <Link to={`/pagamentos/${r.payment_id}`} className="text-primary hover:underline">
                        {r.payments?.reference ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(Number(r.expected_amount))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(r.sent_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.bucket.variant}>
                        {r.bucket.label} · {r.days}d
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResend(r.id)}
                        disabled={sending === r.id}
                      >
                        <Send className="h-3.5 w-3.5 mr-1" />
                        Reenviar
                      </Button>
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
