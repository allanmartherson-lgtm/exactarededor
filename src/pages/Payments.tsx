import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, type PaymentStatus } from "@/lib/status";
import { FileUp, Search } from "lucide-react";

interface Row {
  id: string;
  reference: string;
  status: PaymentStatus;
  total_amount: number | string;
  items_count: number;
  created_at: string;
}

const Payments = () => {
  const { roles } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    document.title = "Pagamentos | MedPay Approval";
    supabase
      .from("payments")
      .select("id,reference,status,total_amount,items_count,created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as Row[]));
  }, []);

  const filtered = rows.filter((r) => r.reference.toLowerCase().includes(q.toLowerCase()));
  const isAnalista = roles.includes("analista") || roles.includes("admin");

  return (
    <>
      <PageHeader
        title="Pagamentos"
        description="Todos os lotes de pagamento e seu status no fluxo."
        actions={
          isAnalista && (
            <Button asChild>
              <Link to="/pagamentos/novo"><FileUp className="h-4 w-4 mr-2" /> Nova base</Link>
            </Button>
          )
        }
      />
      <div className="p-8 space-y-4">
        <div className="relative max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por referência..." className="pl-9" />
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">Nenhum pagamento encontrado.</div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((p) => (
                  <Link key={p.id} to={`/pagamentos/${p.id}`} className="flex items-center justify-between px-6 py-4 hover:bg-muted/40 transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{p.reference}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {p.items_count} itens · {formatCurrency(p.total_amount)} · {formatDate(p.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default Payments;