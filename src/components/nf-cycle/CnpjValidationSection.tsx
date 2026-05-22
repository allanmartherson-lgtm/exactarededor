import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { formatCNPJ, onlyDigits } from "@/lib/cnpj";

interface Row {
  id: string;
  payment_id: string;
  company_id: string | null;
  company_name: string | null;
  ai_extracted_cnpj: string | null;
  status: string;
  payments?: { reference: string | null } | null;
  companies?: { document: string | null } | null;
}

export const CnpjValidationSection = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("invoices")
      .select("id,payment_id,company_id,company_name,ai_extracted_cnpj,status,payments(reference),companies(document)")
      .eq("status", "recebida")
      .not("ai_extracted_cnpj", "is", null)
      .order("received_at", { ascending: false })
      .limit(200);
    setRows((data as Row[]) ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const handleMarkDivergent = async (id: string) => {
    setMarking(id);
    try {
      const { error } = await supabase.from("invoices").update({ status: "divergente" }).eq("id", id);
      if (error) throw error;
      toast({ title: "NF marcada como divergente" });
      await load();
    } catch (e) {
      toast({ title: "Erro ao atualizar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setMarking(null);
    }
  };

  const matches = (a?: string | null, b?: string | null) =>
    !!a && !!b && onlyDigits(a) === onlyDigits(b);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Validação de CNPJ emitente"
        icon={ShieldCheck}
        iconColor="green"
        subtitle="Confronto entre CNPJ extraído da NF e o cadastro da empresa"
      />
      <div className="p-4">
        {!rows ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">Sem NFs recebidas para conferir.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>CNPJ NF</TableHead>
                  <TableHead>CNPJ cadastro</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const ok = matches(r.ai_extracted_cnpj, r.companies?.document);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.company_name ?? "—"}</TableCell>
                      <TableCell>
                        <Link to={`/pagamentos/${r.payment_id}`} className="text-primary hover:underline">
                          {r.payments?.reference ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {r.ai_extracted_cnpj ? formatCNPJ(r.ai_extracted_cnpj) : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {r.companies?.document ? formatCNPJ(r.companies.document) : (
                          <span className="text-muted-foreground italic">sem cadastro</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {ok ? (
                          <Badge variant="outline" className="border-success/40 text-success bg-success-soft">
                            <ShieldCheck className="h-3 w-3 mr-1" /> CNPJ conferido
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <ShieldAlert className="h-3 w-3 mr-1" /> divergente
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!ok && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleMarkDivergent(r.id)}
                            disabled={marking === r.id}
                          >
                            Marcar divergente
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
};
