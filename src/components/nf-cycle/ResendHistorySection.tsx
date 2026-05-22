import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { History } from "lucide-react";

interface ObservationRow {
  id: string;
  payment_id: string;
  message: string;
  created_at: string;
  author_type: string;
}

export const ResendHistorySection = () => {
  const [rows, setRows] = useState<ObservationRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("payment_observations")
        .select("id,payment_id,message,created_at,author_type")
        .or("message.ilike.%reenvi%,message.ilike.%NF enviada%,message.ilike.%solicit%NF%")
        .order("created_at", { ascending: false })
        .limit(50);
      setRows((data as ObservationRow[]) ?? []);
    })();
  }, []);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Histórico de envios de NF"
        icon={History}
        iconColor="teal"
        subtitle="Últimas 50 ações relacionadas a envio/reenvio"
      />
      <div className="p-4">
        {!rows ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">Sem histórico registrado.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Mensagem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <Link to={`/pagamentos/${r.payment_id}`} className="text-primary hover:underline text-sm">
                        ver lote
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.message}</TableCell>
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
