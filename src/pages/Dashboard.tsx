import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Header, HeaderName } from "@carbon/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, formatCompetence, type PaymentStatus, TONE_CLASSES } from "@/lib/status";
import { ArrowRight, FileUp, ListChecks, Sparkles, ShieldCheck, Inbox, Users } from "lucide-react";

interface PaymentRow {
  id: string;
  reference: string;
  status: PaymentStatus;
  total_amount: number | string;
  items_count: number;
  created_at: string;
  competence_month: string | null;
  competence_months: string[] | null;
  created_by: string | null;
  validated_by: string | null;
}

/** Papel responsável por agir no status atual. */
type OwnerRole = "analista" | "validador" | "diretor" | "—";
const ownerRoleFor = (status: PaymentStatus): OwnerRole => {
  switch (status) {
    case "rascunho":
    case "em_analise_ia":
    case "revisao_analista":
    case "devolvido_analista":
      return "analista";
    case "aguardando_validacao":
    case "devolvido_validador":
      return "validador";
    case "aguardando_aprovacao":
      return "diretor";
    default:
      return "—";
  }
};
const ownerLabel: Record<OwnerRole, string> = {
  analista: "Analista",
  validador: "Validador",
  diretor: "Diretor",
  "—": "—",
};

const Dashboard = () => {
  const { roles, user } = useAuth();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState({
    mineAnalista: 0, mineValidador: 0, mineDiretor: 0,
    teamAnalise: 0, teamValidacao: 0, teamAprovacao: 0, aprovados: 0,
  });

  useEffect(() => {
    document.title = "Dashboard | MedPay Approval";
    const load = async () => {
      const [{ data }, { data: pr }, { data: all }] = await Promise.all([
        supabase
        .from("payments")
          .select("id,reference,status,total_amount,items_count,created_at,competence_month,competence_months,created_by,validated_by")
        .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("profiles").select("id,full_name,email"),
        supabase.from("payments").select("status,created_by,validated_by"),
      ]);
      setPayments((data ?? []) as PaymentRow[]);
      const pmap: Record<string, string> = {};
      (pr ?? []).forEach((x: any) => { pmap[x.id] = x.full_name || x.email; });
      setProfiles(pmap);

      const uid = user?.id;
      const c = { mineAnalista: 0, mineValidador: 0, mineDiretor: 0, teamAnalise: 0, teamValidacao: 0, teamAprovacao: 0, aprovados: 0 };
      (all ?? []).forEach((p: { status: PaymentStatus; created_by: string | null; validated_by: string | null }) => {
        const owner = ownerRoleFor(p.status);
        if (owner === "analista") {
          c.teamAnalise++;
          if (uid && p.created_by === uid) c.mineAnalista++;
        } else if (owner === "validador") {
          c.teamValidacao++;
          // "minha tarefa de validador" = qualquer um aguardando validação (papel coletivo)
          c.mineValidador++;
        } else if (owner === "diretor") {
          c.teamAprovacao++;
          c.mineDiretor++;
        } else if (["aprovado", "pedido_nf_enviado", "nf_recebida", "nf_conciliada", "pago"].includes(p.status)) {
          c.aprovados++;
        }
      });
      setCounts(c);
    };
    load();
  }, [user?.id]);

  const isAnalista = roles.includes("analista") || roles.includes("admin");
  const isValidador = roles.includes("validador") || roles.includes("admin");
  const isDiretor = roles.includes("diretor") || roles.includes("admin");

  const isMine = (p: PaymentRow): boolean => {
    const owner = ownerRoleFor(p.status);
    if (owner === "analista") return !!user?.id && p.created_by === user.id && (isAnalista || roles.includes("admin"));
    if (owner === "validador") return isValidador;
    if (owner === "diretor") return isDiretor;
    return false;
  };

  const myPayments = payments.filter(isMine).slice(0, 6);
  const teamPayments = payments.filter((p) => !isMine(p)).slice(0, 8);

  // Conta minhas tarefas pendentes total
  const myPending =
    (isAnalista ? counts.mineAnalista : 0) +
    (isValidador ? counts.mineValidador : 0) +
    (isDiretor ? counts.mineDiretor : 0);

  return (
    <>
      <Header aria-label="MedPay Dashboard" className="!static">
        <HeaderName prefix="MedPay">
          {`Olá, ${user?.user_metadata?.full_name?.split(" ")[0] ?? "bem-vindo"}`}
        </HeaderName>
      </Header>

      <div className="px-8 pt-6 flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {myPending > 0
            ? `Você tem ${myPending} ${myPending === 1 ? "tarefa pendente" : "tarefas pendentes"} para agir.`
            : "Nenhuma tarefa pendente para você. Acompanhe o fluxo da equipe abaixo."}
        </p>
        {isAnalista && (
          <Button asChild>
            <Link to="/pagamentos/novo"><FileUp className="h-4 w-4 mr-2" /> Nova base de pagamento</Link>
          </Button>
        )}
      </div>

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          {isAnalista && (
            <StatCard
              icon={Sparkles}
              label="Suas bases (analista)"
              value={counts.mineAnalista}
              tone="info"
              hint={`${counts.teamAnalise} no time`}
              mine={counts.mineAnalista > 0}
              to="/pagamentos?owner=me&status=analista"
            />
          )}
          <StatCard
            icon={ListChecks}
            label={isValidador ? "Para você validar" : "Aguardando validação"}
            value={isValidador ? counts.mineValidador : counts.teamValidacao}
            tone="warning"
            hint={isValidador && counts.teamValidacao !== counts.mineValidador ? `${counts.teamValidacao} no time` : undefined}
            mine={isValidador && counts.mineValidador > 0}
            to="/pagamentos?status=aguardando_validacao"
          />
          <StatCard
            icon={ShieldCheck}
            label={isDiretor ? "Para você aprovar" : "Aguardando aprovação"}
            value={isDiretor ? counts.mineDiretor : counts.teamAprovacao}
            tone="warning"
            hint={isDiretor && counts.teamAprovacao !== counts.mineDiretor ? `${counts.teamAprovacao} no time` : undefined}
            mine={isDiretor && counts.mineDiretor > 0}
            to="/pagamentos?status=aguardando_aprovacao"
          />
          <StatCard icon={FileUp} label="Aprovados / em NF" value={counts.aprovados} tone="success" />
        </div>

        {/* Suas tarefas */}
        <Card className="shadow-card border-primary/30">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Suas tarefas</CardTitle>
              <span className="text-xs text-muted-foreground">{myPending} pendente{myPending === 1 ? "" : "s"}</span>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/pagamentos">Ver todos <ArrowRight className="h-4 w-4 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {myPayments.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Nada esperando por você no momento. 🎉
              </div>
            ) : (
              <div className="divide-y divide-border">
                {myPayments.map((p) => (
                  <PaymentRowItem key={p.id} p={p} mine profiles={profiles} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Acompanhamento da equipe */}
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Acompanhamento da equipe</CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/pagamentos">Ver todos <ArrowRight className="h-4 w-4 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {teamPayments.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                Sem pagamentos em outras etapas. {isAnalista && (
                  <Link to="/pagamentos/novo" className="text-primary font-medium hover:underline">Subir a primeira base →</Link>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {teamPayments.map((p) => (
                  <PaymentRowItem key={p.id} p={p} mine={false} profiles={profiles} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

const PaymentRowItem = ({ p, mine, profiles }: { p: PaymentRow; mine: boolean; profiles: Record<string, string> }) => {
  const owner = ownerRoleFor(p.status);
  const creator = p.created_by ? profiles[p.created_by] : null;
  return (
    <Link
      to={`/pagamentos/${p.id}`}
      className={`flex items-center justify-between px-6 py-4 hover:bg-muted/40 transition-colors ${mine ? "bg-primary/5" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {mine ? (
            <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${TONE_CLASSES.info}`}>
              Sua vez
            </span>
          ) : owner !== "—" ? (
            <span className={`text-[10px] font-medium uppercase tracking-wide rounded-full border px-2 py-0.5 ${TONE_CLASSES.muted}`}>
              Com {ownerLabel[owner]}
            </span>
          ) : null}
          <p className="font-medium text-sm truncate">{p.reference}</p>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          <span className="capitalize">{formatCompetence(p.competence_months?.length ? p.competence_months : p.competence_month)}</span>
          {" · "}{p.items_count} itens
          {" · "}{formatCurrency(p.total_amount)}
          {creator && <> · criado por <span className="text-foreground/80">{creator}</span></>}
          {" · "}{formatDate(p.created_at)}
        </p>
      </div>
      <StatusBadge status={p.status} />
    </Link>
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
  hint,
  mine,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: "info" | "warning" | "success";
  hint?: string;
  mine?: boolean;
  to?: string;
}) => {
  const inner = (
    <Card className={`shadow-soft transition h-full ${mine ? "ring-1 ring-primary/40" : ""} ${to ? "hover:shadow-card cursor-pointer" : ""}`}>
      <CardContent className="p-5 h-full flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-0">{label}</p>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${toneBg[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="text-3xl font-semibold mt-2 tabular-nums">{value}</p>
        <div className="mt-auto pt-2 min-h-[22px]">
          {mine ? (
            <span className={`inline-flex text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${TONE_CLASSES.info}`}>
              Sua vez
            </span>
          ) : hint ? (
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
};

export default Dashboard;