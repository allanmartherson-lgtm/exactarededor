import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatCardSkeleton } from "@/components/dashboard/StatCard";
import { StatCardsGrid } from "@/components/dashboard/StatCardsGrid";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Header, HeaderName } from "@carbon/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, formatCompetence, type PaymentStatus, TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ArrowRightCircle,
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

/** Modos de layout do pipeline (responsivos a telas estreitas). */
type PipelineLayout = "auto" | "rows2" | "rows3";
const PIPELINE_LAYOUT_KEY = "dashboard.pipelineLayout";
const PIPELINE_GRID_CLASS: Record<PipelineLayout, string> = {
  // Auto: comportamento original responsivo.
  auto: "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7",
  // 2 linhas: 4 colunas → 4 + 3 itens.
  rows2: "grid-cols-4",
  // 3 linhas: 3 colunas → 3 + 3 + 1 itens.
  rows3: "grid-cols-3",
};
const PIPELINE_LAYOUT_LABEL: Record<PipelineLayout, string> = {
  auto: "Auto",
  rows2: "2 linhas",
  rows3: "3 linhas",
};

/** Filtros rápidos do pipeline. */
type PipelineOwnerFilter = "all" | "analista" | "validador" | "diretor";
type PipelineWindowFilter = "7" | "30" | "90" | "all";
const PIPELINE_OWNER_KEY = "dashboard.pipelineOwner";
const PIPELINE_WINDOW_KEY = "dashboard.pipelineWindow";
const PIPELINE_OWNER_LABEL: Record<PipelineOwnerFilter, string> = {
  all: "Todos",
  analista: "Analista",
  validador: "Validador",
  diretor: "Diretor",
};
const PIPELINE_WINDOW_LABEL: Record<PipelineWindowFilter, string> = {
  "7": "7 dias",
  "30": "30 dias",
  "90": "90 dias",
  all: "Tudo",
};
const PIPELINE_WINDOW_DAYS: Record<PipelineWindowFilter, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null,
};
/** Status que cada papel é responsável por agir. */
const STATUSES_BY_OWNER: Record<Exclude<PipelineOwnerFilter, "all">, PaymentStatus[]> = {
  analista: ["rascunho", "em_analise_ia", "revisao_analista", "devolvido_analista"],
  validador: ["aguardando_validacao", "devolvido_validador"],
  diretor: ["aguardando_aprovacao"],
};

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
  /** Lista crua de pagamentos (com created_at) para recomputar o pipeline ao filtrar. */
  const [allPayments, setAllPayments] = useState<
    Array<{ status: PaymentStatus; created_by: string | null; validated_by: string | null; created_at: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [pipelineLayout, setPipelineLayout] = useState<PipelineLayout>(() => {
    if (typeof window === "undefined") return "auto";
    const saved = window.localStorage.getItem(PIPELINE_LAYOUT_KEY);
    return saved === "rows2" || saved === "rows3" || saved === "auto" ? saved : "auto";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PIPELINE_LAYOUT_KEY, pipelineLayout);
    }
  }, [pipelineLayout]);
  const [pipelineOwner, setPipelineOwner] = useState<PipelineOwnerFilter>(() => {
    if (typeof window === "undefined") return "all";
    const saved = window.localStorage.getItem(PIPELINE_OWNER_KEY);
    return saved === "analista" || saved === "validador" || saved === "diretor" || saved === "all" ? saved : "all";
  });
  const [pipelineWindow, setPipelineWindow] = useState<PipelineWindowFilter>(() => {
    if (typeof window === "undefined") return "all";
    const saved = window.localStorage.getItem(PIPELINE_WINDOW_KEY);
    return saved === "7" || saved === "30" || saved === "90" || saved === "all" ? saved : "all";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PIPELINE_OWNER_KEY, pipelineOwner);
    }
  }, [pipelineOwner]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PIPELINE_WINDOW_KEY, pipelineWindow);
    }
  }, [pipelineWindow]);

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
        supabase.from("payments").select("status,created_by,validated_by,created_at"),
        supabase
          .from("invoices")
          .select("id, payment:payments!inner(created_by)")
          .eq("status", "divergente"),
        // NFs questionadas: a definir tabela definitiva; por enquanto contamos
        // pagamentos no novo status nf_questionada (vem do array `all`).
        Promise.resolve({ data: [] as Array<{ payment: { created_by: string | null } | null }> }),
      ]);
      setPayments((data ?? []) as PaymentRow[]);
      setAllPayments(
        (all ?? []) as Array<{
          status: PaymentStatus;
          created_by: string | null;
          validated_by: string | null;
          created_at: string;
        }>,
      );
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

  /** Contagens do pipeline filtradas por papel responsável + janela de datas. */
  const pipeCounts = useMemo(() => {
    const days = PIPELINE_WINDOW_DAYS[pipelineWindow];
    const cutoff = days != null ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
    const allowedStatuses =
      pipelineOwner === "all" ? null : new Set<PaymentStatus>(STATUSES_BY_OWNER[pipelineOwner]);
    const c = {
      pipeAnaliseIA: 0, pipeValidacao: 0, pipeAprovacao: 0,
      pipeNFSolicitada: 0, pipeNFRecebida: 0, pipeNFConciliada: 0, pipePago: 0,
    };
    for (const p of allPayments) {
      if (cutoff != null && new Date(p.created_at).getTime() < cutoff) continue;
      if (allowedStatuses && !allowedStatuses.has(p.status)) continue;
      switch (p.status) {
        case "em_analise_ia":
        case "revisao_analista":
          c.pipeAnaliseIA++; break;
        case "aguardando_validacao":
          c.pipeValidacao++; break;
        case "aguardando_aprovacao":
          c.pipeAprovacao++; break;
        case "aprovado":
        case "pedido_nf_enviado":
          c.pipeNFSolicitada++; break;
        case "nf_recebida":
          c.pipeNFRecebida++; break;
        case "nf_conciliada":
          c.pipeNFConciliada++; break;
        case "pago":
          c.pipePago++; break;
      }
    }
    return c;
  }, [allPayments, pipelineOwner, pipelineWindow]);

  /** Querystring extra a propagar nos links das etapas (forward-compatível). */
  const pipelineQuery = useMemo(() => {
    const parts: string[] = [];
    if (pipelineOwner !== "all") parts.push(`owner=${pipelineOwner}`);
    if (pipelineWindow !== "all") parts.push(`days=${pipelineWindow}`);
    return parts.length ? `&${parts.join("&")}` : "";
  }, [pipelineOwner, pipelineWindow]);

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
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-muted-foreground hidden sm:inline">
                da análise ao pagamento
              </span>
              <div
                role="radiogroup"
                aria-label="Filtrar pipeline por papel"
                className="inline-flex rounded-md border border-border bg-card p-0.5"
              >
                {(["all", "analista", "validador", "diretor"] as PipelineOwnerFilter[]).map((opt) => {
                  const active = pipelineOwner === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPipelineOwner(opt)}
                      className={cn(
                        "px-2.5 py-1 text-[11px] font-medium rounded-[5px] transition-colors",
                        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                      )}
                    >
                      {PIPELINE_OWNER_LABEL[opt]}
                    </button>
                  );
                })}
              </div>
              <div
                role="radiogroup"
                aria-label="Janela de datas do pipeline"
                className="inline-flex rounded-md border border-border bg-card p-0.5"
              >
                {(["7", "30", "90", "all"] as PipelineWindowFilter[]).map((opt) => {
                  const active = pipelineWindow === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPipelineWindow(opt)}
                      className={cn(
                        "px-2.5 py-1 text-[11px] font-medium rounded-[5px] transition-colors",
                        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                      )}
                    >
                      {PIPELINE_WINDOW_LABEL[opt]}
                    </button>
                  );
                })}
              </div>
              <div
                role="radiogroup"
                aria-label="Layout do pipeline"
                className="inline-flex rounded-md border border-border bg-card p-0.5"
              >
                {(["auto", "rows2", "rows3"] as PipelineLayout[]).map((opt) => {
                  const active = pipelineLayout === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPipelineLayout(opt)}
                      className={cn(
                        "px-2.5 py-1 text-[11px] font-medium rounded-[5px] transition-colors",
                        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        active
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                      )}
                    >
                      {PIPELINE_LAYOUT_LABEL[opt]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div
            data-testid="pipeline-grid"
            role="list"
            aria-label="Etapas do pipeline de pagamento"
            className={cn(
              "grid gap-2 sm:gap-3 items-stretch auto-rows-fr",
              PIPELINE_GRID_CLASS[pipelineLayout],
            )}
          >
            {loading ? (
              Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))
            ) : (
              <>
                <PipelineStep step={1} totalSteps={7} icon={Bot} label="Análise" value={pipeCounts.pipeAnaliseIA} tone="info"
                  to={`/pagamentos?status=em_analise_ia${pipelineQuery}`} />
                <PipelineStep step={2} totalSteps={7} icon={ListChecks} label="Validação" value={pipeCounts.pipeValidacao} tone="warning"
                  to={`/pagamentos?status=aguardando_validacao${pipelineQuery}`} />
                <PipelineStep step={3} totalSteps={7} icon={ShieldCheck} label="Aprovação" value={pipeCounts.pipeAprovacao} tone="warning"
                  to={`/pagamentos?status=aguardando_aprovacao${pipelineQuery}`} />
                <PipelineStep step={4} totalSteps={7} icon={Send} label="NF solicitada" value={pipeCounts.pipeNFSolicitada} tone="info"
                  to={`/pagamentos?status=pedido_nf_enviado${pipelineQuery}`} />
                <PipelineStep step={5} totalSteps={7} icon={Receipt} label="NF recebida" value={pipeCounts.pipeNFRecebida} tone="info"
                  to={`/pagamentos?status=nf_recebida${pipelineQuery}`} />
                <PipelineStep step={6} totalSteps={7} icon={CheckCircle2} label="Conciliada" value={pipeCounts.pipeNFConciliada} tone="success"
                  to={`/pagamentos?status=nf_conciliada${pipelineQuery}`} />
                <PipelineStep step={7} totalSteps={7} icon={Wallet} label="Pago" value={pipeCounts.pipePago} tone="success"
                  to={`/pagamentos?status=pago${pipelineQuery}`} />
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

/** Descrição completa de cada etapa do pipeline (mostrada no tooltip). */
const PIPELINE_STEP_DESCRIPTION: Record<number, { full: string; helper: string }> = {
  1: { full: "Análise da IA", helper: "Bases enviadas que a IA está revisando ou que voltaram para o analista corrigir." },
  2: { full: "Aguardando validação", helper: "Aprovado pelo analista; aguardando o validador conferir antes de seguir para o diretor." },
  3: { full: "Aguardando aprovação", helper: "Validado; aguardando aprovação final do diretor." },
  4: { full: "Pedido de NF enviado", helper: "Aprovado pelo diretor; pedido de nota fiscal enviado ao recebedor (clínica/médico)." },
  5: { full: "Nota fiscal recebida", helper: "NF anexada pelo recebedor; aguardando IA conferir e analista validar." },
  6: { full: "Nota fiscal conciliada", helper: "NF bate com o pedido; pronta para lançamento no sistema financeiro." },
  7: { full: "Pago", helper: "Pagamento liquidado no sistema financeiro." },
};

/**
 * PipelineStep — variante compacta do StatTile usada no funil do dashboard.
 * Compartilha tipografia, espaçamento, foco e skeleton com o StatCard via
 * `density="compact"`. Adiciona apenas:
 *  - selo de etapa "1/7" no rodapé (badge)
 *  - tooltip rico com descrição completa + contagem em prosa
 */
const PipelineStep = ({
  step,
  totalSteps,
  icon: Icon,
  label,
  value,
  tone,
  to,
}: {
  step: number;
  totalSteps: number;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: StatCardTone;
  to: string;
}) => {
  const toneBg: Record<StatCardTone, string> = {
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning-foreground",
    success: "bg-success-soft text-success",
  };
  const itemCount = `${value} ${value === 1 ? "pagamento" : "pagamentos"}`;
  const desc = PIPELINE_STEP_DESCRIPTION[step] ?? { full: label, helper: "" };
  const iconNode = (
    <div className={cn("h-7 w-7 rounded-md flex items-center justify-center", toneBg[tone])}>
      <Icon className="h-4 w-4" />
    </div>
  );
  const stepBadge = (
    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full border border-border px-2 py-0.5 leading-none text-muted-foreground tabular-nums">
      Etapa {step}/{totalSteps}
    </span>
  );
  const tooltipNode = (
    <div className="space-y-1">
      <p className="font-semibold">
        <span className="text-muted-foreground tabular-nums">Etapa {step}/{totalSteps} · </span>
        {desc.full}
      </p>
      <p className="tabular-nums">
        <span className="font-semibold">{value}</span> {value === 1 ? "pagamento" : "pagamentos"} nesta etapa
      </p>
      {desc.helper && <p className="text-muted-foreground leading-snug">{desc.helper}</p>}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
        Clique para abrir a lista
      </p>
    </div>
  );
  return (
    <div role="listitem" className="h-full">
      <StatTile
        label={label}
        value={value}
        icon={iconNode}
        badge={stepBadge}
        density="compact"
        to={to}
        tooltip={tooltipNode}
        ariaLabel={`Etapa ${step} de ${totalSteps}: ${desc.full}. ${itemCount}. ${desc.helper} Abrir lista filtrada.`}
      />
    </div>
  );
};

// silencia import não usado
void ArrowRightCircle;

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