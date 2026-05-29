import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, RefreshCw } from "lucide-react";

type JournalEntry = {
  id: string;
  operation_id: string;
  tipo: string;
  sinal: number;
  valor: number;
  payment_id: string | null;
  company_id: string | null;
  doctor_id: string | null;
  competencia: string | null;
  referencia: string | null;
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
  reason: string | null;
  created_at: string;
};

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export default function FinancialJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterTipo, setFilterTipo] = useState("");
  const [filterPayment, setFilterPayment] = useState("");

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("financial_journal" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filterTipo) q = q.ilike("tipo", `%${filterTipo}%`);
    if (filterPayment) q = q.eq("payment_id", filterPayment);
    const { data, error } = await q;
    if (!error && data) setEntries(data as unknown as JournalEntry[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalCredito = entries.filter((e) => e.sinal === 1).reduce((s, e) => s + Number(e.valor), 0);
  const totalDebito = entries.filter((e) => e.sinal === -1).reduce((s, e) => s + Number(e.valor), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Livro Contábil</h1>
          <p className="text-sm text-muted-foreground">
            Registro append-only de todas as movimentações financeiras com idempotência e reversão auditável.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Entradas (200 últimas)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{entries.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-green-600">Créditos</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-green-600">{fmtMoney(totalCredito)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600">Débitos</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-red-600">{fmtMoney(totalDebito)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Tipo</Label>
            <Input value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)} placeholder="ex: glosa, repasse" />
          </div>
          <div>
            <Label>Payment ID</Label>
            <Input value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)} placeholder="UUID do pagamento" />
          </div>
          <div className="flex items-end">
            <Button onClick={load} disabled={loading} className="w-full">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Movimentações</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Operação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Referência</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhuma movimentação registrada ainda.
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">{new Date(e.created_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell><Badge variant="outline">{e.tipo}</Badge></TableCell>
                    <TableCell className="text-xs font-mono">{e.operation_id}</TableCell>
                    <TableCell className={`text-right font-medium ${e.sinal === 1 ? "text-green-600" : "text-red-600"}`}>
                      {e.sinal === 1 ? "+" : "-"}{fmtMoney(Number(e.valor))}
                    </TableCell>
                    <TableCell className="text-xs">{e.referencia ?? "—"}</TableCell>
                    <TableCell>
                      {e.reverses_entry_id ? (
                        <Badge variant="secondary">Reversão</Badge>
                      ) : e.reversed_by_entry_id ? (
                        <Badge variant="destructive">Revertida</Badge>
                      ) : (
                        <Badge>Ativa</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
