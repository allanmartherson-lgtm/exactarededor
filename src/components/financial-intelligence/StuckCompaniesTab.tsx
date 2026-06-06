import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";

type StuckCompany = {
  company_id: string;
  company_name: string;
  stuck_count: number;
  total_stuck_value: number;
  max_age_days: number;
  worst_status: string;
};

export const StuckCompaniesTab = () => {
  const [stuck, setStuck] = useState<StuckCompany[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc("get_stuck_companies", { p_limit: 10 });
        if (error) throw error;
        setStuck((data ?? []) as StuckCompany[]);
      } catch (e) {
        toast.error("Erro ao carregar PJs travadas");
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 10 PJs com pagamentos travados (&gt;7 dias)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead className="text-right">Pagtos travados</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Idade máx (d)</TableHead>
              <TableHead>Pior status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5}>Carregando…</TableCell></TableRow>
            )}
            {!loading && stuck.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sem PJs travadas. 🎉</TableCell></TableRow>
            )}
            {stuck.map((c) => (
              <TableRow key={c.company_id}>
                <TableCell className="font-medium">{c.company_name}</TableCell>
                <TableCell className="text-right">{c.stuck_count}</TableCell>
                <TableCell className="text-right">{formatCurrency(c.total_stuck_value)}</TableCell>
                <TableCell className="text-right">{c.max_age_days}</TableCell>
                <TableCell><Badge variant="outline">{c.worst_status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
