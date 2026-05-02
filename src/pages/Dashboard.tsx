import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatCardSkeleton } from "@/components/dashboard/StatCard";
import { StatCardsGrid } from "@/components/dashboard/StatCardsGrid";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Header, HeaderName } from "@carbon/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, formatCompetence, type PaymentStatus, TONE_CLASSES } from "@/lib/status";
import {
  ArrowRight,
  FileUp,
  ListChecks,
  Sparkles,
  ShieldCheck,
  Inbox,
  Users,
  Receipt,
  Bot,
  Send,
  CheckCircle2,
  Wallet,
  AlertTriangle,
  RotateCcw,
  MessageCircleQuestion,
  FileWarning,
} from "lucide-react";

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

/** Contagens agregadas usadas pelos cards do dashboard. */
interface DashboardCounts {
  // "Suas tarefas" — depende do papel logado
  mineAnalista: number;
  mineValidador: number;
  mineDiretor: number;
  mineInvoicesDivergentes: number;
  mineInvoicesQuestionadas: number;
  mineRessalvas: number;
  // Time
  teamAnalise: number;
  teamValidacao: number;
  teamAprovacao: number;
  teamInvoicesDivergentes: number;
  // Pipeline (visão de funil)
  pipeAnaliseIA: number;        // em_analise_ia + revisao_analista
  pipeValidacao: number;         // aguardando_validacao
  pipeAprovacao: number;         // aguardando_aprovacao
  pipeNFSolicitada: number;      // aprovado + pedido_nf_enviado
  pipeNFRecebida: number;        // nf_recebida
  pipeNFConciliada: number;      // nf_conciliada
  pipePago: number;              // pago
  // Atenção (exceções)
  attDevolvidoAnalista: number;
  attRessalvas: number;
  attNFQuestionada: number;
  attNFDivergente: number;
  attRejeitados: number;
}

const initialCounts: DashboardCounts = {
  mineAnalista: 0, mineValidador: 0, mineDiretor: 0,
  mineInvoicesDivergentes: 0, mineInvoicesQuestionadas: 0, mineRessalvas: 0,
  teamAnalise: 0, teamValidacao: 0, teamAprovacao: 0, teamInvoicesDivergentes: 0,
  pipeAnaliseIA: 0, pipeValidacao: 0, pipeAprovacao: 0,
  pipeNFSolicitada: 0, pipeNFRecebida: 0, pipeNFConciliada: 0, pipePago: 0,
  attDevolvidoAnalista: 0, attRessalvas: 0, attNFQuestionada: 0,
  attNFDivergente: 0, attRejeitados: 0,
};

const Dashboard = () => {
  const { roles, user } = useAuth();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<DashboardCounts>(initialCounts);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Dashboard | MedPay Approval";
    const load = async () => {
      setLoading(true);
      const [{ data }, { data: pr }, { data: all }, { data: invDiv }, { data: invQuest }] = await Promise.all([
        supabase
        .from("payments")
          .select("id,reference,status,total_amount,items_count,created_at,competence_month,competence_months,created_by,validated_by")
        .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("profiles").select("id,full_name,email"),
        supabase.from("payments").select("status,created_by,validated_by"),
        supabase
          .from("invoices")
          .select("id, payment:payments!inner(created_by)")
          .eq("status", "divergente"),
        // NFs questionadas: a definir tabela definitiva; por enquanto contamos
        // pagamentos no novo status nf_questionada (vem do array `all`).
        Promise.resolve({ data: [] as Array<{ payment: { created_by: string | null } | null }> }),
      ]);
      setPayments((data ?? []) as PaymentRow[]);
      const pmap: Record<string, string> = {};
      (pr ?? []).forEach((x: any) => { pmap[x.id] = x.full_name || x.email; });
      setProfiles(pmap);

      const uid = user?.id;
      const c: DashboardCounts = { ...initialCounts };
      (all ?? []).forEach((p: { status: PaymentStatus; created_by: string | null; validated_by: string | null }) => {
        // — contadores "minhas tarefas" + "time"
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
        }

        // — contadores do pipeline (visão de funil)
        switch (p.status) {
          case "em_analise_ia":
          case "revisao_analista":
            c.pipeAnaliseIA++;
            break;
          case "aguardando_validacao":
            c.pipeValidacao++;
            break;
          case "aguardando_aprovacao":
            c.pipeAprovacao++;
            break;
          case "aprovado":
          case "pedido_nf_enviado":
            c.pipeNFSolicitada++;
            break;
          case "nf_recebida":
            c.pipeNFRecebida++;
            break;
          case "nf_conciliada":
            c.pipeNFConciliada++;
            break;
          case "pago":
            c.pipePago++;
            break;
        }

        // — exceções (linha "Atenção")
        if (p.status === "devolvido_analista" || p.status === "devolvido_validador") {
          c.attDevolvidoAnalista++;
        }
        if (p.status === "aprovado_com_ressalva") {
          c.attRessalvas++;
          if (uid && p.created_by === uid) c.mineRessalvas++;
        }
        if (p.status === "nf_questionada") {
          c.attNFQuestionada++;
          if (uid && p.created_by === uid) c.mineInvoicesQuestionadas++;
        }
        if (p.status === "rejeitado") {
          c.attRejeitados++;
        }
      });

      // NFs divergentes (precisam de lançamento manual no financeiro)
      (invDiv ?? []).forEach((row: any) => {
        c.teamInvoicesDivergentes++;
        c.attNFDivergente++;
        if (uid && row.payment?.created_by === uid) c.mineInvoicesDivergentes++;
      });
      // Reservado para futura tabela de questionamentos por invoice
      void invQuest;

      setCounts(c);
      setLoading(false);
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

  // Conta minhas tarefas pendentes total (inclui NFs/ressalvas que dependem de mim)
  const myPending =
    (isAnalista ? counts.mineAnalista + counts.mineInvoicesDivergentes + counts.mineInvoicesQuestionadas + counts.mineRessalvas : 0) +
    (isValidador ? counts.mineValidador : 0) +
    (isDiretor ? counts.mineDiretor : 0);

  // Quantos cards aparecem na faixa "Suas tarefas" (para o skeleton casar)
  const mineCardCount =
    (isAnalista ? 1 : 0) +
    (isValidador ? 1 : 0) +
    (isDiretor ? 1 : 0) +
    (isAnalista ? 2 : 0) + // NFs divergentes + NFs questionadas
    (isAnalista ? 1 : 0);  // Ressalvas a aplicar

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

      <div className="p-4 sm:p-6 lg:p-8 space-y-8">
        {/* ============================== */}
        {/* FAIXA 1 — Suas tarefas         */}
        {/* ============================== */}
        <section aria-labelledby="suas-tarefas-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 id="suas-tarefas-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Suas tarefas
            </h2>
            {!loading && myPending === 0 && (
              <span className="text-xs text-muted-foreground">Nada esperando por você 🎉</span>
            )}
          </div>
          <StatCardsGrid>
            {loading ? (
              Array.from({ length: Math.max(mineCardCount, 3) }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))
            ) : (
              <>
                {isAnalista && (
                  <StatCard
                    icon={Sparkles}
                    label="Suas bases (analista)"
                    value={counts.mineAnalista}
                    tone="info"
                    hint={counts.teamAnalise !== counts.mineAnalista ? `${counts.teamAnalise} no time` : undefined}
                    mine={counts.mineAnalista > 0}
                    to="/pagamentos?owner=me&status=analista"
                  />
                )}
                {isValidador && (
                  <StatCard
                    icon={ListChecks}
                    label="Para você validar"
                    value={counts.mineValidador}
                    tone="warning"
                    mine={counts.mineValidador > 0}
                    to="/pagamentos?status=aguardando_validacao"
                  />
                )}
                {isDiretor && (
                  <StatCard
                    icon={ShieldCheck}
                    label="Para você aprovar"
                    value={counts.mineDiretor}
                    tone="warning"
                    mine={counts.mineDiretor > 0}
                    to="/pagamentos?status=aguardando_aprovacao"
                  />
                )}
                {isAnalista && (
                  <StatCard
                    icon={RotateCcw}
                    label="Ressalvas a aplicar"
                    value={counts.mineRessalvas}
                    tone="warning"
                    hint="aprovado com ressalva"
                    mine={counts.mineRessalvas > 0}
                    to="/pagamentos?status=aprovado_com_ressalva"
                  />
                )}
                {isAnalista && (
                  <StatCard
                    icon={MessageCircleQuestion}
                    label="NFs questionadas"
                    value={counts.mineInvoicesQuestionadas}
                    tone="warning"
                    hint="recebedor pediu retorno"
                    mine={counts.mineInvoicesQuestionadas > 0}
                    to="/pagamentos?status=nf_questionada"
                  />
                )}
                {isAnalista && (
                  <StatCard
                    icon={Receipt}
                    label="NFs divergentes (suas)"
                    value={counts.mineInvoicesDivergentes}
                    tone="warning"
                    hint={
                      counts.teamInvoicesDivergentes !== counts.mineInvoicesDivergentes
                        ? `${counts.teamInvoicesDivergentes} no time · lançar no financeiro`
                        : "lançar no financeiro"
                    }
                    mine={counts.mineInvoicesDivergentes > 0}
                    to="/notas-fiscais"
                  />
                )}
              </>
            )}
          </StatCardsGrid>
        </section>

        {/* ============================== */}
        {/* FAIXA 2 — Pipeline (funil)     */}
        {/* ============================== */}
        <section aria-labelledby="pipeline-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 id="pipeline-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Pipeline da equipe
            </h2>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              da análise ao pagamento
            </span>
          </div>
          <div
            data-testid="pipeline-grid"
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 sm:gap-4 items-stretch auto-rows-fr"
          >
            {loading ? (
              Array.from({ length: 7 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <StatCard icon={Bot} label="1. Análise IA" value={counts.pipeAnaliseIA} tone="info"
                  to="/pagamentos?status=em_analise_ia" />
                <StatCard icon={ListChecks} label="2. Validação" value={counts.pipeValidacao} tone="warning"
                  to="/pagamentos?status=aguardando_validacao" />
                <StatCard icon={ShieldCheck} label="3. Aprovação" value={counts.pipeAprovacao} tone="warning"
                  to="/pagamentos?status=aguardando_aprovacao" />
                <StatCard icon={Send} label="4. NF solicitada" value={counts.pipeNFSolicitada} tone="info"
                  to="/pagamentos?status=pedido_nf_enviado" />
                <StatCard icon={Receipt} label="5. NF recebida" value={counts.pipeNFRecebida} tone="info"
                  to="/pagamentos?status=nf_recebida" />
                <StatCard icon={CheckCircle2} label="6. NF conciliada" value={counts.pipeNFConciliada} tone="success"
                  to="/pagamentos?status=nf_conciliada" />
                <StatCard icon={Wallet} label="7. Pago" value={counts.pipePago} tone="success"
                  to="/pagamentos?status=pago" />
              </>
            )}
          </div>
        </section>

        {/* ============================== */}
        {/* FAIXA 3 — Atenção (exceções)   */}
        {/* ============================== */}
        {!loading && (
          counts.attDevolvidoAnalista + counts.attRessalvas + counts.attNFQuestionada +
          counts.attNFDivergente + counts.attRejeitados > 0
        ) && (
          <section aria-labelledby="atencao-heading" className="space-y-3">
            <h2 id="atencao-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Atenção
            </h2>
            <div className="flex flex-wrap gap-2">
              <AttChip
                icon={RotateCcw}
                label="Devolvidos ao analista"
                count={counts.attDevolvidoAnalista}
                tone="destructive"
                to="/pagamentos?status=devolvido_analista"
              />
              <AttChip
                icon={AlertTriangle}
                label="Ressalvas pendentes"
                count={counts.attRessalvas}
                tone="warning"
                to="/pagamentos?status=aprovado_com_ressalva"
              />
              <AttChip
                icon={MessageCircleQuestion}
                label="NFs questionadas"
                count={counts.attNFQuestionada}
                tone="warning"
                to="/pagamentos?status=nf_questionada"
              />
              <AttChip
                icon={FileWarning}
                label="NFs divergentes"
                count={counts.attNFDivergente}
                tone="destructive"
                to="/notas-fiscais"
              />
              <AttChip
                icon={AlertTriangle}
                label="Rejeitados"
                count={counts.attRejeitados}
                tone="muted"
                to="/pagamentos?status=rejeitado"
              />
            </div>
          </section>
        )}

        {/* Suas tarefas */}
        <Card className="shadow-card border-primary/30">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Suas tarefas — pagamentos recentes</CardTitle>
              <span className="text-xs text-muted-foreground">{myPending} pendente{myPending === 1 ? "" : "s"}</span>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/pagamentos">Ver todos <ArrowRight className="h-4 w-4 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <PaymentRowsSkeleton count={3} />
            ) : myPayments.length === 0 ? (
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
            {loading ? (
              <PaymentRowsSkeleton count={4} />
            ) : teamPayments.length === 0 ? (
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

/** Chip compacto usado na linha "Atenção". */
const AttChip = ({
  icon: Icon,
  label,
  count,
  tone,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  tone: "warning" | "destructive" | "muted";
  to: string;
}) => {
  if (count === 0) return null;
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${TONE_CLASSES[tone]}`}
      aria-label={`${label}: ${count}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <span className="rounded-full bg-background/60 px-1.5 py-0.5 tabular-nums">{count}</span>
    </Link>
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

const PaymentRowsSkeleton = ({ count = 3 }: { count?: number }) => (
  <div className="divide-y divide-border" aria-hidden>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="flex items-center justify-between px-6 py-4 gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
        <Skeleton className="h-5 w-24 rounded-full flex-shrink-0" />
      </div>
    ))}
  </div>
);

export default Dashboard;