import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, formatCompetence, type PaymentStatus } from "@/lib/status";
import { ArrowRight, FileUp, ListChecks, Sparkles, ShieldCheck } from "lucide-react";

interface PaymentRow {
  id: string;
  reference: string;
  status: PaymentStatus;
  total_amount: number | string;
  items_count: number;
  created_at: string;
  competence_month: string | null;
}

const Dashboard = () => {
  const { roles, user } = useAuth();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [counts, setCounts] = useState({ analise: 0, validacao: 0, aprovacao: 0, aprovados: 0 });

  useEffect(() => {
    document.title = "Dashboard | MedPay Approval";
    const load = async () => {
      const { data } = await supabase
        .from("payments")
        .select("id,reference,status,total_amount,items_count,created_at,competence_month")
        .order("created_at", { ascending: false })
        .limit(8);
      setPayments((data ?? []) as PaymentRow[]);

      const { data: all } = await supabase.from("payments").select("status");
      const c = { analise: 0, validacao: 0, aprovacao: 0, aprovados: 0 };
      (all ?? []).forEach((p: { status: PaymentStatus }) => {
        if (p.status === "em_analise_ia") c.analise++;
        else if (p.status === "aguardando_validacao" || p.status === "devolvido_validador") c.validacao++;
        else if (p.status === "aguardando_aprovacao") c.aprovacao++;
        else if (["aprovado", "pedido_nf_enviado", "nf_recebida", "nf_conciliada", "pago"].includes(p.status)) c.aprovados++;
      });
      setCounts(c);
    };
    load();
  }, []);

  const isAnalista = roles.includes("analista") || roles.includes("admin");

  return (
    <>
      <PageHeader
        title={`Olá, ${user?.user_metadata?.full_name?.split(" ")[0] ?? "bem-vindo"}`}
        description="Acompanhe o fluxo de aprovação de pagamentos médicos em tempo real."
        actions={
          isAnalista && (
            <Button asChild>
              <Link to="/pagamentos/novo"><FileUp className="h-4 w-4 mr-2" /> Nova base de pagamento</Link>
            </Button>
          )
        }
      />

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Sparkles} label="Em análise por IA" value={counts.analise} tone="info" />
          <StatCard icon={ListChecks} label="Aguardando validação" value={counts.validacao} tone="warning" />
          <StatCard icon={ShieldCheck} label="Aguardando aprovação" value={counts.aprovacao} tone="warning" />
          <StatCard icon={FileUp} label="Aprovados / em NF" value={counts.aprovados} tone="success" />
        </div>

        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Pagamentos recentes</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/pagamentos">Ver todos <ArrowRight className="h-4 w-4 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {payments.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                Nenhum pagamento ainda. {isAnalista && (
                  <Link to="/pagamentos/novo" className="text-primary font-medium hover:underline">Subir a primeira base →</Link>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {payments.map((p) => (
                  <Link
                    key={p.id}
                    to={`/pagamentos/${p.id}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{p.reference}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="capitalize">{formatCompetence(p.competence_month)}</span> · {p.items_count} itens · {formatCurrency(p.total_amount)} · {formatDate(p.created_at)}
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

const toneBg: Record<string, string> = {
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning-foreground",
  success: "bg-success-soft text-success",
};

const StatCard = ({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: "info" | "warning" | "success";
}) => (
  <Card className="shadow-soft">
    <CardContent className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-semibold mt-2 tabular-nums">{value}</p>
        </div>
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${toneBg[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </CardContent>
  </Card>
);

export default Dashboard;