import { forwardRef, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  usePipelinePreferences,
  type PipelineOwnerFilter,
  type PipelineWindowFilter,
  type PipelineDensity,
} from "@/hooks/use-pipeline-preferences";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, formatCompetence, type PaymentStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { evaluateSla, type SlaSetting, type CompanySlaOverride, type SlaLevel } from "@/lib/sla";
import {
  ArrowRight,
  FileText,
  FileCheck,
  Landmark,
  CreditCard,
  AlertCircle,
  CheckCircle,
  ListChecks,
  ShieldCheck,
  Users,
  Send,
  FileWarning,
  Flame,
  Timer,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

const PIPELINE_OWNER_LABEL: Record<PipelineOwnerFilter, string> = {
  all: "Todos",
  analista: "Analista",
  validador: "Validador",
  diretor: "Diretor",
};
const PIPELINE_WINDOW_LABEL: Record<PipelineWindowFilter, string> = {
  "7": "7d",
  "30": "30d",
  "90": "90d",
  all: "Tudo",
};
const PIPELINE_WINDOW_DAYS: Record<PipelineWindowFilter, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null,
};
const PIPELINE_DENSITY_LABEL: Record<PipelineDensity, string> = {
  compact: "Compacto",
  comfortable: "Confortável",
};
/**
 * Quando um papel específico é selecionado no filtro, mostramos apenas as
 * colunas onde aquele papel precisa agir. "Todos" mostra o pipeline completo.
 */
const QUEUE_COLUMNS: Record<Exclude<PipelineOwnerFilter, "all">, ReadonlySet<string>> = {
  analista: new Set(["Análise", "Divergente"]),
  validador: new Set(["Validação"]),
  diretor: new Set(["Aprovação"]),
};
/**
 * Status que indicam que o pagamento já chegou (ou passou) pela alçada do diretor.
 * Usado para filtrar a visão "Diretor" do pipeline, pois não temos `approved_by`
 * carregado no payload leve.
 */
const DIRETOR_REACHED_STATUSES: PaymentStatus[] = [
  "aguardando_aprovacao",
  "aprovado",
  "aprovado_com_ressalva",
  "pedido_nf_enviado",
  "nf_recebida",
  "nf_questionada",
  "nf_conciliada",
  "pago",
];

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
  payment_type?: string | null;
}

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

interface DashboardCounts {
  mineAnalista: number;
  mineValidador: number;
  mineDiretor: number;
  mineInvoicesDivergentes: number;
  mineInvoicesQuestionadas: number;
  mineRessalvas: number;
  teamAnalise: number;
  teamValidacao: number;
  teamAprovacao: number;
  teamInvoicesDivergentes: number;
  pipeAnaliseIA: number;
  pipeValidacao: number;
  pipeAprovacao: number;
  pipeAguardandoEnvio: number;
  pipeNFSolicitada: number;
  pipeNFRecebida: number;
  pipeNFConciliada: number;
  pipePago: number;
  pipeDivergente: number;
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
  pipeAguardandoEnvio: 0, pipeNFSolicitada: 0, pipeNFRecebida: 0, pipeNFConciliada: 0, pipePago: 0,
  pipeDivergente: 0,
  attDevolvidoAnalista: 0, attRessalvas: 0, attNFQuestionada: 0,
  attNFDivergente: 0, attRejeitados: 0,
};

// ===== util: formato compacto de duração =====
const formatShortDuration = (ms: number) => {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

const PAYMENT_STATUS_SHORT: Partial<Record<PaymentStatus, string>> = {
  em_analise_ia: "Análise IA",
  revisao_analista: "Revisão analista",
  aguardando_validacao: "Validação",
  devolvido_validador: "Devolvido p/ validador",
  devolvido_analista: "Devolvido p/ analista",
  aguardando_aprovacao: "Aprovação diretoria",
  aprovado: "Aprovado",
  pedido_nf_enviado: "NF solicitada",
  nf_recebida: "NF recebida",
  nf_questionada: "NF questionada",
  nf_conciliada: "NF conciliada",
  pago: "Pago",
};

/* ================================================================
   PRESENTATION PRIMITIVES
   ================================================================ */

type BubbleColor = "purple" | "yellow" | "teal" | "red" | "blue" | "green";

const bubbleStyle = (color: BubbleColor): CSSProperties => ({
  background: `hsl(var(--bubble-${color}-bg))`,
  color: `hsl(var(--bubble-${color}-fg))`,
});

/** Section label: 11px, 600, uppercase, muted, with a horizontal line. */
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 mb-3">
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.07em",
        color: "hsl(var(--muted-foreground))",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
    <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
  </div>
);

/** "SUA VEZ" badge */
const SuaVezBadge = () => (
  <span
    style={{
      background: "hsl(var(--primary))",
      color: "hsl(var(--primary-foreground))",
      borderRadius: 20,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.05em",
      padding: "3px 8px",
      lineHeight: 1,
      textTransform: "uppercase",
    }}
  >
    Sua vez
  </span>
);

/** Generic stat card per spec. */
interface BigStatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  color: BubbleColor;
  hint?: string;
  mine?: boolean;
  to?: string;
}
const BigStatCard = ({ label, value, icon: Icon, color, hint, mine, to }: BigStatCardProps) => {
  const cardStyle: CSSProperties = {
    background: mine
      ? `linear-gradient(135deg, hsl(var(--accent)), hsl(var(--card)))`
      : "hsl(var(--card))",
    border: `1px solid ${mine ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
    borderRadius: 12,
    padding: 22,
    transition: "all 0.15s ease",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    height: "100%",
    textDecoration: "none",
    color: "inherit",
  };
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.07em",
            color: "hsl(var(--muted-foreground))",
            textTransform: "uppercase",
            lineHeight: 1.4,
          }}
        >
          {label}
        </span>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            ...bubbleStyle(color),
          }}
        >
          <Icon size={18} strokeWidth={2} />
        </div>
      </div>
      <div
        style={{
          fontSize: 36,
          fontWeight: 300,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: "hsl(var(--foreground))",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div className="mt-auto flex items-center min-h-[20px]">
        {mine ? (
          <SuaVezBadge />
        ) : hint ? (
          <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{hint}</span>
        ) : (
          <span style={{ fontSize: 12, color: "transparent" }}>&nbsp;</span>
        )}
      </div>
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        style={cardStyle}
        className="hover-card-lift outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`${label}: ${value}${mine ? ", sua vez" : hint ? `, ${hint}` : ""}`}
      >
        {inner}
      </Link>
    );
  }
  return <div style={cardStyle}>{inner}</div>;
};

const BigStatSkeleton = () => (
  <div
    style={{
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 12,
      padding: 22,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}
  >
    <div className="flex items-start justify-between">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-9 w-9 rounded-lg" />
    </div>
    <Skeleton className="h-9 w-16" />
    <Skeleton className="h-3 w-20" />
  </div>
);

/** Surface card used for task list, pipeline, and bottom row. */
const SurfaceCard = ({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}) => (
  <div
    className={className}
    style={{
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 12,
      ...style,
    }}
  >
    {children}
  </div>
);

const SurfaceCardHeader = ({
  title,
  icon: Icon,
  iconColor = "teal",
  countPill,
  rightAction,
}: {
  title: string;
  icon?: LucideIcon;
  iconColor?: BubbleColor;
  countPill?: number;
  rightAction?: React.ReactNode;
}) => (
  <div
    className="flex items-center justify-between gap-3"
    style={{ padding: "18px 22px", borderBottom: "1px solid hsl(var(--border))" }}
  >
    <div className="flex items-center gap-2.5 min-w-0">
      {Icon && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...bubbleStyle(iconColor),
          }}
        >
          <Icon size={14} />
        </div>
      )}
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "hsl(var(--foreground))",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      {countPill !== undefined && countPill > 0 && (
        <span
          style={{
            background: "hsl(var(--destructive))",
            color: "hsl(var(--destructive-foreground))",
            borderRadius: 20,
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            lineHeight: 1.4,
          }}
        >
          {countPill}
        </span>
      )}
    </div>
    {rightAction}
  </div>
);

/** Filter chip group */
const ChipGroup = <T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) => (
  <div
    role="radiogroup"
    aria-label={ariaLabel}
    className="inline-flex"
    style={{
      background: "hsl(var(--muted))",
      borderRadius: 8,
      padding: 3,
      gap: 2,
    }}
  >
    {options.map((opt) => {
      const active = value === opt.v;
      return (
        <button
          key={opt.v}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(opt.v)}
          style={{
            padding: "5px 11px",
            fontSize: 12,
            // Mantém o mesmo peso ativo/inativo para evitar reflow
            // (o chip selecionado mudava de largura e "empurrava" os vizinhos).
            fontWeight: 600,
            borderRadius: 6,
            transition: "all 0.15s ease",
            background: active ? "hsl(var(--primary))" : "transparent",
            color: active ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
            border: "none",
            cursor: "pointer",
          }}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

/* ================================================================
   PAGE
   ================================================================ */

const Dashboard = () => {
  const { roles, user } = useAuth();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<DashboardCounts>(initialCounts);
  const [allPayments, setAllPayments] = useState<
    Array<{ id: string; status: PaymentStatus; created_by: string | null; validated_by: string | null; created_at: string; updated_at?: string | null }>
  >([]);
  // Mapas para cálculo de SLA
  const [statusEnteredAt, setStatusEnteredAt] = useState<Record<string, string>>({});
  const [allStatusEnteredAt, setAllStatusEnteredAt] = useState<Record<string, { status: PaymentStatus; changed_at: string }>>({});
  const [slaSettings, setSlaSettings] = useState<Record<string, SlaSetting>>({});
  const [companyByPayment, setCompanyByPayment] = useState<Record<string, string | null>>({});
  const [companyOverrides, setCompanyOverrides] = useState<Record<string, CompanySlaOverride>>({});
  // Tempo médio agregado por status (gargalos)
  const [avgTimeByStatus, setAvgTimeByStatus] = useState<Record<string, { avgMs: number; count: number }>>({});
  const [loading, setLoading] = useState(true);
  const {
    owner: pipelineOwner,
    window: pipelineWindow,
    density: pipelineDensity,
    setOwner: setPipelineOwner,
    setWindow: setPipelineWindow,
    setDensity: setPipelineDensity,
  } = usePipelinePreferences();

  useEffect(() => {
    document.title = "Dashboard | MedPay Approval";
    const load = async () => {
      setLoading(true);
      const [{ data }, { data: pr }, { data: all }, { data: invDiv }, { data: invQuest }] = await Promise.all([
        supabase
          .from("payments")
          .select("id,reference,status,total_amount,items_count,created_at,competence_month,competence_months,created_by,validated_by,payment_type")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("profiles").select("id,full_name,email"),
        supabase.from("payments").select("id,status,created_by,validated_by,created_at,updated_at"),
        supabase
          .from("invoices")
          .select("id, payment:payments!inner(created_by)")
          .eq("status", "divergente"),
        Promise.resolve({ data: [] as Array<{ payment: { created_by: string | null } | null }> }),
      ]);
      setPayments((data ?? []) as PaymentRow[]);
      setAllPayments(
        (all ?? []) as Array<{
          id: string;
          status: PaymentStatus;
          created_by: string | null;
          validated_by: string | null;
          created_at: string;
          updated_at?: string | null;
        }>,
      );
      const pmap: Record<string, string> = {};
      (pr ?? []).forEach((x: any) => { pmap[x.id] = x.full_name || x.email; });
      setProfiles(pmap);

      // Carrega histórico de status, SLA settings, empresas e overrides — em paralelo
      const allIds = ((all ?? []) as Array<{ id: string }>).map((p) => p.id).filter(Boolean);
      const [{ data: hist }, { data: slas }, { data: groups }] = await Promise.all([
        allIds.length
          ? supabase
              .from("payment_status_history")
              .select("payment_id,status_to,changed_at")
              .in("payment_id", allIds)
              .order("changed_at", { ascending: false })
          : Promise.resolve({ data: [] as any[] } as any),
        supabase.from("sla_settings").select("*").eq("active", true),
        allIds.length
          ? supabase.from("payment_company_groups").select("payment_id,company_id").in("payment_id", allIds)
          : Promise.resolve({ data: [] as any[] } as any),
      ]);
      const seen: Record<string, string> = {};
      const seenWithStatus: Record<string, { status: PaymentStatus; changed_at: string }> = {};
      // Tempos médios entre transições por status (gargalos)
      const byPayment: Record<string, Array<{ status_to: PaymentStatus; changed_at: string }>> = {};
      (hist ?? []).forEach((h: any) => {
        if (!seen[h.payment_id]) {
          seen[h.payment_id] = h.changed_at;
          seenWithStatus[h.payment_id] = { status: h.status_to as PaymentStatus, changed_at: h.changed_at };
        }
        (byPayment[h.payment_id] = byPayment[h.payment_id] ?? []).push({ status_to: h.status_to, changed_at: h.changed_at });
      });
      setStatusEnteredAt(seen);
      setAllStatusEnteredAt(seenWithStatus);
      const sMap: Record<string, SlaSetting> = {};
      (slas ?? []).forEach((s: any) => { sMap[s.status] = s; });
      setSlaSettings(sMap);
      const cByP: Record<string, string | null> = {};
      (groups ?? []).forEach((g: any) => { if (g.company_id && !cByP[g.payment_id]) cByP[g.payment_id] = g.company_id; });
      setCompanyByPayment(cByP);
      const compIds = Array.from(new Set(Object.values(cByP).filter(Boolean))) as string[];
      if (compIds.length) {
        const { data: ovs } = await supabase.from("company_sla_overrides").select("*").in("company_id", compIds);
        const oMap: Record<string, CompanySlaOverride> = {};
        (ovs ?? []).forEach((o: any) => { oMap[o.company_id] = o; });
        setCompanyOverrides(oMap);
      }
      // Tempo médio em cada status (concluído → próximo) — usa intervalos do histórico
      const accum: Record<string, { sum: number; count: number }> = {};
      Object.values(byPayment).forEach((entries) => {
        // entries vêm desc; reordena asc
        const asc = [...entries].sort((a, b) => +new Date(a.changed_at) - +new Date(b.changed_at));
        for (let i = 0; i < asc.length - 1; i++) {
          const s = asc[i].status_to;
          const dt = +new Date(asc[i + 1].changed_at) - +new Date(asc[i].changed_at);
          if (dt > 0 && s) {
            accum[s] = accum[s] ?? { sum: 0, count: 0 };
            accum[s].sum += dt;
            accum[s].count += 1;
          }
        }
      });
      const avg: Record<string, { avgMs: number; count: number }> = {};
      Object.entries(accum).forEach(([s, v]) => { avg[s] = { avgMs: v.sum / v.count, count: v.count }; });
      setAvgTimeByStatus(avg);

      const uid = user?.id;
      // Visão coletiva por perfil: para o analista, "minhas tarefas" é a fila
      // do papel inteiro — qualquer analista pode assumir qualquer lote em
      // status do analista. Validador/diretor já funcionavam assim.
      const c: DashboardCounts = { ...initialCounts };
      (all ?? []).forEach((p: { status: PaymentStatus; created_by: string | null; validated_by: string | null }) => {
        const owner = ownerRoleFor(p.status);
        if (owner === "analista") {
          c.teamAnalise++;
          c.mineAnalista++;
        } else if (owner === "validador") {
          c.teamValidacao++;
          c.mineValidador++;
        } else if (owner === "diretor") {
          c.teamAprovacao++;
          c.mineDiretor++;
        }

        switch (p.status) {
          case "em_analise_ia":
          case "revisao_analista":
            c.pipeAnaliseIA++; break;
          case "aguardando_validacao":
            c.pipeValidacao++; break;
          case "aguardando_aprovacao":
            c.pipeAprovacao++; break;
          case "aprovado":
            c.pipeAguardandoEnvio++; break;
          case "pedido_nf_enviado":
            c.pipeNFSolicitada++; break;
          case "nf_recebida":
            c.pipeNFRecebida++; break;
          case "nf_conciliada":
            c.pipeNFConciliada++; break;
          case "pago":
            c.pipePago++; break;
          case "nf_questionada":
            c.pipeDivergente++; break;
        }

        if (p.status === "devolvido_analista" || p.status === "devolvido_validador") c.attDevolvidoAnalista++;
        if (p.status === "aprovado_com_ressalva") {
          c.attRessalvas++;
          c.mineRessalvas++;
        }
        if (p.status === "nf_questionada") {
          c.attNFQuestionada++;
          c.mineInvoicesQuestionadas++;
        }
        if (p.status === "rejeitado") c.attRejeitados++;
      });

      (invDiv ?? []).forEach((row: any) => {
        c.teamInvoicesDivergentes++;
        c.attNFDivergente++;
        c.mineInvoicesDivergentes++;
      });
      void invQuest;
      void uid;

      setCounts(c);
      setLoading(false);
    };
    load();
  }, [user?.id]);

  const pipeCounts = useMemo(() => {
    const days = PIPELINE_WINDOW_DAYS[pipelineWindow];
    const cutoff = days != null ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
    /**
     * Quando um papel é selecionado, contamos APENAS os status mapeados nas
     * colunas visíveis daquele papel (ver `QUEUE_COLUMNS`). Isso garante
     * que a soma dos números no pipeline = total de cards renderizados.
     */
    const ACTION_QUEUE: Record<Exclude<typeof pipelineOwner, "all">, Set<PaymentStatus>> = {
      // "Análise" agrega em_analise_ia + revisao_analista; "Divergente" = nf_questionada
      analista: new Set<PaymentStatus>(["em_analise_ia", "revisao_analista", "nf_questionada"]),
      // "Validação" = aguardando_validacao
      validador: new Set<PaymentStatus>(["aguardando_validacao"]),
      // "Aprovação" = aguardando_aprovacao
      diretor: new Set<PaymentStatus>(["aguardando_aprovacao"]),
    };
    const matchesOwner = (p: { status: PaymentStatus }) =>
      pipelineOwner === "all"
        ? true
        : ACTION_QUEUE[pipelineOwner].has(p.status);
    const c = {
      pipeAnaliseIA: 0, pipeValidacao: 0, pipeAprovacao: 0,
      pipeAguardandoEnvio: 0, pipeNFSolicitada: 0, pipeNFRecebida: 0, pipeNFConciliada: 0, pipePago: 0,
      pipeDivergente: 0,
    };
    for (const p of allPayments) {
      if (cutoff != null && new Date(p.created_at).getTime() < cutoff) continue;
      if (!matchesOwner(p)) continue;
      switch (p.status) {
        case "em_analise_ia":
        case "revisao_analista":
          c.pipeAnaliseIA++; break;
        case "aguardando_validacao":
          c.pipeValidacao++; break;
        case "aguardando_aprovacao":
          c.pipeAprovacao++; break;
        case "aprovado":
          c.pipeAguardandoEnvio++; break;
        case "pedido_nf_enviado":
          c.pipeNFSolicitada++; break;
        case "nf_recebida":
          c.pipeNFRecebida++; break;
        case "nf_conciliada":
          c.pipeNFConciliada++; break;
        case "pago":
          c.pipePago++; break;
        case "nf_questionada":
          c.pipeDivergente++; break;
      }
    }
    return c;
  }, [allPayments, pipelineOwner, pipelineWindow]);

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
    // Status "extras" que também são tarefa do analista, mas não caem em
    // ownerRoleFor() porque o fluxo principal já passou (NF questionada,
    // aprovado com ressalva). Devem aparecer na lista para bater com o badge.
    const ANALYST_EXTRA: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
      "nf_questionada",
      "aprovado_com_ressalva",
    ]);
    if (isAnalista && ANALYST_EXTRA.has(p.status)) {
      return !!user?.id && p.created_by === user.id;
    }
    const owner = ownerRoleFor(p.status);
    if (owner === "analista") {
      return !!user?.id && p.created_by === user.id && (isAnalista || roles.includes("admin"));
    }
    if (owner === "validador") return isValidador;
    if (owner === "diretor") return isDiretor;
    return false;
  };

  const myPayments = payments.filter(isMine).slice(0, 6);

  // ============================================================
  // CÁLCULO DE SLA + URGÊNCIA
  // ============================================================
  const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
    "aprovado", "pago", "rejeitado", "cancelado", "nf_conciliada",
  ]);

  const slaForPayment = (p: { id: string; status: PaymentStatus; created_at: string }): { level: SlaLevel; ms: number } | null => {
    if (TERMINAL_STATUSES.has(p.status)) return null;
    const enteredAt = new Date(statusEnteredAt[p.id] ?? p.created_at);
    const setting = slaSettings[p.status] ?? null;
    const compId = companyByPayment[p.id] ?? null;
    const ov = compId ? companyOverrides[compId] ?? null : null;
    const ev = evaluateSla({ status: p.status, enteredAt, defaultSettings: setting, override: ov });
    const ms = Date.now() - enteredAt.getTime();
    if (!ev) return null;
    return { level: ev.level, ms };
  };

  // Atenção imediata: contagem global por nível de SLA
  const slaTotals = useMemo(() => {
    let vencido = 0;
    let preventivo = 0;
    const perStatusVencido: Record<string, number> = {};
    for (const p of allPayments) {
      const r = slaForPayment(p);
      if (!r) continue;
      if (r.level === "vencido") {
        vencido++;
        perStatusVencido[p.status] = (perStatusVencido[p.status] ?? 0) + 1;
      } else if (r.level === "preventivo") preventivo++;
    }
    return { vencido, preventivo, perStatusVencido };
  }, [allPayments, statusEnteredAt, slaSettings, companyByPayment, companyOverrides]);

  // Ordena "Pagamentos esperando você" por urgência: vencidos > preventivos > tempo
  const myPaymentsRanked = useMemo(() => {
    const score = (p: PaymentRow) => {
      const r = slaForPayment({ id: p.id, status: p.status, created_at: p.created_at });
      if (!r) return { lvl: 0, ms: 0 };
      const lvl = r.level === "vencido" ? 2 : r.level === "preventivo" ? 1 : 0;
      return { lvl, ms: r.ms };
    };
    return [...myPayments].sort((a, b) => {
      const sa = score(a); const sb = score(b);
      if (sa.lvl !== sb.lvl) return sb.lvl - sa.lvl;
      return sb.ms - sa.ms;
    });
  }, [myPayments, statusEnteredAt, slaSettings, companyByPayment, companyOverrides]);

  // Gargalos: status com maior tempo médio
  const bottlenecks = useMemo(() => {
    return Object.entries(avgTimeByStatus)
      .filter(([s]) => !TERMINAL_STATUSES.has(s as PaymentStatus))
      .map(([s, v]) => ({ status: s as PaymentStatus, avgMs: v.avgMs, count: v.count }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 5);
  }, [avgTimeByStatus]);

  const myPending =
    (isAnalista ? counts.mineAnalista + counts.mineInvoicesDivergentes + counts.mineInvoicesQuestionadas + counts.mineRessalvas : 0) +
    (isValidador ? counts.mineValidador : 0) +
    (isDiretor ? counts.mineDiretor : 0);

  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? "bem-vindo";

  return (
    <div className="flex flex-col gap-8">
      {/* PAGE HEADER */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 300,
              letterSpacing: "-0.02em",
              color: "hsl(var(--foreground))",
              lineHeight: 1.2,
            }}
          >
            Olá, <span style={{ fontWeight: 700 }}>{firstName}</span>
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "hsl(var(--muted-foreground))",
              marginTop: 4,
            }}
          >
            {myPending > 0
              ? `Você tem ${myPending} ${myPending === 1 ? "tarefa pendente" : "tarefas pendentes"} para agir.`
              : "Nenhuma tarefa pendente para você. Acompanhe o fluxo da equipe abaixo."}
          </p>
        </div>
      </div>

      {/* ATENÇÃO IMEDIATA */}
      {!loading && (slaTotals.vencido > 0 || slaTotals.preventivo > 0) && (
        <section aria-labelledby="atencao-imediata-heading">
          <SectionLabel>Atenção imediata</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 14 }}>
            <AttentionTile
              tone="critical"
              icon={Flame}
              label="Itens fora do SLA"
              value={slaTotals.vencido}
              hint="vencidos — agir agora"
              to="/pagamentos?delayed=1"
            />
            <AttentionTile
              tone="warning"
              icon={Timer}
              label="Próximos do SLA"
              value={slaTotals.preventivo}
              hint="dentro do prazo, mas perto do limite"
              to="/pagamentos?delayed=1"
            />
          </div>
        </section>
      )}

      {/* SUAS TAREFAS */}
      <section aria-labelledby="suas-tarefas-heading">
        <SectionLabel>Suas tarefas</SectionLabel>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 14 }}>
            {Array.from({ length: 3 }).map((_, i) => <BigStatSkeleton key={i} />)}
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 14 }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 14 }}>
              {isAnalista && (
                <BigStatCard
                  icon={Landmark}
                  color="purple"
                  label="Suas bases"
                  value={counts.mineAnalista}
                  hint={
                    slaTotals.vencido > 0
                      ? `${slaTotals.vencido} fora do SLA`
                      : slaTotals.preventivo > 0
                      ? `${slaTotals.preventivo} perto do SLA`
                      : counts.teamAnalise !== counts.mineAnalista ? `${counts.teamAnalise} no time` : "em análise"
                  }
                  mine={counts.mineAnalista > 0}
                  to="/pagamentos?owner=me&status=analista"
                />
              )}
              {isValidador && (
                <BigStatCard
                  icon={ListChecks}
                  color="yellow"
                  label="Para validar"
                  value={counts.mineValidador}
                  mine={counts.mineValidador > 0}
                  to="/pagamentos?status=aguardando_validacao"
                />
              )}
              {isDiretor && (
                <BigStatCard
                  icon={ShieldCheck}
                  color="teal"
                  label="Para aprovar"
                  value={counts.mineDiretor}
                  mine={counts.mineDiretor > 0}
                  to="/pagamentos?status=aguardando_aprovacao"
                />
              )}
            </div>
            {isAnalista && (counts.mineRessalvas + counts.mineInvoicesQuestionadas + counts.mineInvoicesDivergentes > 0 || true) && (
              <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 14 }}>
                <BigStatCard
                  icon={AlertCircle}
                  color="red"
                  label="Ressalvas"
                  value={counts.mineRessalvas}
                  hint="aprovado com ressalva"
                  mine={counts.mineRessalvas > 0}
                  to="/pagamentos?status=aprovado_com_ressalva"
                />
                <BigStatCard
                  icon={FileWarning}
                  color="blue"
                  label="NFs divergentes"
                  value={counts.mineInvoicesDivergentes}
                  hint={
                    counts.teamInvoicesDivergentes !== counts.mineInvoicesDivergentes
                      ? `${counts.teamInvoicesDivergentes} no time`
                      : "lançar no financeiro"
                  }
                  mine={counts.mineInvoicesDivergentes > 0}
                  to="/notas-fiscais"
                />
              </div>
            )}
          </div>
        )}
      </section>

      {/* TASK LIST */}
      <section aria-labelledby="lista-tarefas-heading">
        <SectionLabel>Tarefas em aberto</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Pagamentos esperando você"
            icon={FileText}
            iconColor="teal"
            countPill={myPending}
            rightAction={
              <Link
                to="/pagamentos"
                style={{
                  fontSize: 12,
                  color: "hsl(var(--accent-foreground))",
                  fontWeight: 500,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Ver todos <ArrowRight size={13} />
              </Link>
            }
          />
          {loading ? (
            <PaymentRowsSkeleton count={3} />
          ) : myPayments.length === 0 ? (
            <div
              style={{
                padding: "40px 22px",
                textAlign: "center",
                fontSize: 13,
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Nada esperando por você no momento. 🎉
            </div>
          ) : (
            <div>
              {myPaymentsRanked.map((p) => {
                const sla = slaForPayment({ id: p.id, status: p.status, created_at: p.created_at });
                return (
                  <TaskRow
                    key={p.id}
                    p={p}
                    mine
                    profiles={profiles}
                    timeMs={sla?.ms}
                    slaLevel={sla?.level}
                  />
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </section>

      {/* PIPELINE */}
      <section aria-labelledby="pipeline-heading">
        <SectionLabel>Pipeline da equipe</SectionLabel>
        <SurfaceCard>
          <div
            className="flex items-center justify-between gap-3 flex-wrap"
            style={{ padding: "18px 22px", borderBottom: "1px solid hsl(var(--border))" }}
          >
            <h3
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "hsl(var(--foreground))",
                letterSpacing: "-0.01em",
              }}
            >
              Da análise ao pagamento
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <ChipGroup
                ariaLabel="Filtrar por papel"
                value={pipelineOwner}
                onChange={setPipelineOwner}
                options={(["all", "analista", "validador", "diretor"] as PipelineOwnerFilter[]).map((v) => ({
                  v,
                  label: PIPELINE_OWNER_LABEL[v],
                }))}
              />
              <ChipGroup
                ariaLabel="Janela de datas"
                value={pipelineWindow}
                onChange={setPipelineWindow}
                options={(["7", "30", "90"] as PipelineWindowFilter[]).map((v) => ({
                  v,
                  label: PIPELINE_WINDOW_LABEL[v],
                }))}
              />
              <ChipGroup
                ariaLabel="Densidade"
                value={pipelineDensity}
                onChange={setPipelineDensity}
                options={(["compact", "comfortable"] as PipelineDensity[]).map((v) => ({
                  v,
                  label: PIPELINE_DENSITY_LABEL[v],
                }))}
              />
            </div>
          </div>
          {(() => {
            const allCols = [
              { icon: FileText, color: "purple" as const, label: "Análise", value: pipeCounts.pipeAnaliseIA, to: `/pagamentos?status=em_analise_ia${pipelineQuery}` },
              { icon: ListChecks, color: "yellow" as const, label: "Validação", value: pipeCounts.pipeValidacao, to: `/pagamentos?status=aguardando_validacao${pipelineQuery}` },
              { icon: ShieldCheck, color: "blue" as const, label: "Aprovação", value: pipeCounts.pipeAprovacao, to: `/pagamentos?status=aguardando_aprovacao${pipelineQuery}` },
              { icon: Send, color: "red" as const, label: "Aguardando", value: pipeCounts.pipeAguardandoEnvio, to: `/pagamentos?status=aprovado${pipelineQuery}` },
              { icon: FileText, color: "purple" as const, label: "NF solicitada", value: pipeCounts.pipeNFSolicitada, to: `/pagamentos?status=pedido_nf_enviado${pipelineQuery}` },
              { icon: FileCheck, color: "green" as const, label: "NF recebida", value: pipeCounts.pipeNFRecebida, to: `/pagamentos?status=nf_recebida${pipelineQuery}` },
              { icon: AlertCircle, color: "red" as const, label: "Divergente", value: pipeCounts.pipeDivergente, to: `/pagamentos?status=nf_questionada${pipelineQuery}` },
              { icon: CheckCircle, color: "green" as const, label: "Conciliada", value: pipeCounts.pipeNFConciliada, to: `/pagamentos?status=nf_conciliada${pipelineQuery}` },
              { icon: CreditCard, color: "blue" as const, label: "Pago", value: pipeCounts.pipePago, to: `/pagamentos?status=pago${pipelineQuery}` },
            ];
            const visibleCols =
              pipelineOwner !== "all"
                ? allCols.filter((c) => QUEUE_COLUMNS[pipelineOwner].has(c.label))
                : allCols;
            const colCount = Math.max(visibleCols.length, 1);
            return (
              <div
                style={{
                  padding: pipelineDensity === "comfortable" ? "28px 22px" : "18px 22px",
                  display: "grid",
                  gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
                  gap: 0,
                  minWidth: 0,
                }}
              >
                {loading ? (
                  Array.from({ length: colCount }).map((_, i) => (
                    <PipelineColSkeleton key={i} density={pipelineDensity} separated={i > 0} />
                  ))
                ) : visibleCols.length === 0 ? (
                  <div
                    style={{
                      padding: "24px",
                      textAlign: "center",
                      color: "hsl(var(--muted-foreground))",
                      fontSize: 13,
                    }}
                  >
                    Nenhuma coluna nesta fila.
                  </div>
                ) : (
                  visibleCols.map((item, index) => (
                    <PipelineCol
                      key={item.label}
                      {...item}
                      delayed={
                        // mapeia label de coluna -> status equivalente p/ contar atrasados
                        item.label === "Análise" ? (slaTotals.perStatusVencido["em_analise_ia"] ?? 0) + (slaTotals.perStatusVencido["revisao_analista"] ?? 0)
                        : item.label === "Validação" ? (slaTotals.perStatusVencido["aguardando_validacao"] ?? 0)
                        : item.label === "Aprovação" ? (slaTotals.perStatusVencido["aguardando_aprovacao"] ?? 0)
                        : item.label === "Aguardando" ? (slaTotals.perStatusVencido["aprovado"] ?? 0)
                        : item.label === "NF solicitada" ? (slaTotals.perStatusVencido["pedido_nf_enviado"] ?? 0)
                        : item.label === "NF recebida" ? (slaTotals.perStatusVencido["nf_recebida"] ?? 0)
                        : item.label === "Divergente" ? (slaTotals.perStatusVencido["nf_questionada"] ?? 0)
                        : 0
                      }
                      density={pipelineDensity}
                      separated={index > 0}
                    />
                  ))
                )}
              </div>
            );
          })()}
        </SurfaceCard>
      </section>

      {/* BOTTOM ROW */}
      <section>
        <SectionLabel>Visão geral</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 14 }}>
          <SurfaceCard>
            <SurfaceCardHeader title="Acompanhamento da equipe" icon={Users} iconColor="teal" />
            <div
              style={{
                padding: "48px 22px",
                textAlign: "center",
                fontSize: 13,
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Em breve: linha do tempo de atividades da equipe.
            </div>
          </SurfaceCard>
          <SurfaceCard>
            <SurfaceCardHeader title="Gargalos do processo" icon={Flame} iconColor="red" />
            {loading ? (
              <div style={{ padding: 22 }}>
                <Skeleton className="h-4 w-1/2 mb-3" />
                <Skeleton className="h-4 w-2/3 mb-3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ) : (
              <BottlenecksList rows={bottlenecks} />
            )}
          </SurfaceCard>
        </div>
      </section>
    </div>
  );
};

/* ================================================================
   ROW / PIPELINE
   ================================================================ */

const TaskRow = ({
  p,
  mine,
  profiles,
  timeMs,
  slaLevel,
}: {
  p: PaymentRow;
  mine: boolean;
  profiles: Record<string, string>;
  timeMs?: number;
  slaLevel?: SlaLevel;
}) => {
  const owner = ownerRoleFor(p.status);
  const creator = p.created_by ? profiles[p.created_by] : null;
  const slaTone =
    slaLevel === "vencido"
      ? { bg: "hsl(var(--destructive) / 0.12)", fg: "hsl(var(--destructive))", label: "Vencido" }
      : slaLevel === "preventivo"
      ? { bg: "hsl(var(--warning, 38 92% 50%) / 0.15)", fg: "hsl(var(--warning, 38 92% 50%))", label: "Perto do SLA" }
      : null;
  return (
    <Link
      to={`/pagamentos/${p.id}`}
      className="task-row"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 22px",
        borderBottom: "1px solid hsl(var(--border-light, var(--border)))",
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.15s ease",
        background: slaLevel === "vencido" ? "hsl(var(--destructive) / 0.04)" : undefined,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {mine ? (
            <SuaVezBadge />
          ) : owner !== "—" ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: "hsl(var(--muted))",
                color: "hsl(var(--muted-foreground))",
                borderRadius: 20,
                padding: "3px 8px",
                lineHeight: 1,
              }}
            >
              Com {ownerLabel[owner]}
            </span>
          ) : null}
          <p style={{ fontSize: 14, fontWeight: 500, color: "hsl(var(--foreground))" }} className="truncate">
            {p.reference}
          </p>
          {slaTone && (
            <span
              style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                background: slaTone.bg, color: slaTone.fg, borderRadius: 20, padding: "3px 8px", lineHeight: 1,
              }}
            >
              {slaTone.label}
            </span>
          )}
          {timeMs != null && (
            <span
              style={{
                fontSize: 11, color: "hsl(var(--muted-foreground))",
                display: "inline-flex", alignItems: "center", gap: 3,
              }}
              title="Tempo no status atual"
            >
              <Timer size={11} aria-hidden /> {formatShortDuration(timeMs)}
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
          <span className="capitalize">
            {formatCompetence(p.competence_months?.length ? p.competence_months : p.competence_month)}
          </span>
          {" · "}{p.items_count} itens
          {" · "}{formatCurrency(p.total_amount)}
          {creator && <> · criado por <span style={{ color: "hsl(var(--foreground))" }}>{creator}</span></>}
          {p.payment_type && <> · <span className="capitalize">{p.payment_type}</span></>}
          {" · "}{formatDate(p.created_at)}
        </p>
      </div>
      <StatusBadge status={p.status} />
    </Link>
  );
};

const PipelineCol = forwardRef<HTMLAnchorElement, {
  icon: LucideIcon;
  color: BubbleColor;
  label: string;
  value: number;
  to: string;
  density: PipelineDensity;
  separated: boolean;
  delayed?: number;
}>(({
  icon: Icon,
  color,
  label,
  value,
  to,
  density,
  separated,
  delayed = 0,
}, ref) => {
  const comfortable = density === "comfortable";
  return (
    <Link
      ref={ref}
      to={to}
      className="pipeline-col"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: comfortable ? 12 : 8,
        padding: comfortable ? "18px 10px" : "10px 6px",
        borderRadius: 10,
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.15s ease",
        boxShadow: separated ? "inset 1px 0 0 hsl(var(--border) / 0.8)" : undefined,
        minWidth: 0,
        position: "relative",
      }}
    >
    {delayed > 0 && (
      <span
        title={`${delayed} fora do SLA`}
        style={{
          position: "absolute", top: 6, right: 6,
          background: "hsl(var(--destructive))",
          color: "hsl(var(--destructive-foreground))",
          fontSize: 10, fontWeight: 700, lineHeight: 1,
          padding: "3px 6px", borderRadius: 999,
          display: "inline-flex", alignItems: "center", gap: 3,
        }}
      >
        <AlertTriangle size={9} aria-hidden /> {delayed}
      </span>
    )}
    <div
      style={{
        width: comfortable ? 40 : 32,
        height: comfortable ? 40 : 32,
        borderRadius: comfortable ? 10 : 9,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...bubbleStyle(color),
      }}
    >
      <Icon size={comfortable ? 18 : 17} strokeWidth={2} />
    </div>
    <div
      style={{
        fontSize: comfortable ? 30 : 24,
        fontWeight: 300,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        color: "hsl(var(--foreground))",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </div>
    <div
      style={{
        fontSize: comfortable ? 10 : 9,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        color: "hsl(var(--muted-foreground))",
        textAlign: "center",
        lineHeight: 1.3,
      }}
    >
      {label}
    </div>
    </Link>
  );
});
PipelineCol.displayName = "PipelineCol";

const PipelineColSkeleton = forwardRef<HTMLDivElement, { density: PipelineDensity; separated: boolean }>(
  ({ density, separated }, ref) => (
  <div
    ref={ref}
    className="flex flex-col items-center"
    style={{
      gap: density === "comfortable" ? 12 : 8,
      padding: density === "comfortable" ? "18px 10px" : "10px 6px",
      boxShadow: separated ? "inset 1px 0 0 hsl(var(--border) / 0.8)" : undefined,
    }}
  >
    <Skeleton className={cn(density === "comfortable" ? "h-10 w-10" : "h-8 w-8", "rounded-lg")} />
    <Skeleton className={cn(density === "comfortable" ? "h-8 w-10" : "h-6 w-9")} />
    <Skeleton className="h-2.5 w-16" />
  </div>
  ),
);
PipelineColSkeleton.displayName = "PipelineColSkeleton";

const PaymentRowsSkeleton = ({ count = 3 }: { count?: number }) => (
  <div aria-hidden>
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="flex items-center justify-between gap-4"
        style={{ padding: "14px 22px", borderBottom: "1px solid hsl(var(--border))" }}
      >
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

/* ================================================================
   ATENÇÃO IMEDIATA + GARGALOS
   ================================================================ */

const AttentionTile = ({
  tone,
  icon: Icon,
  label,
  value,
  hint,
  to,
}: {
  tone: "critical" | "warning";
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
  to: string;
}) => {
  const tokens =
    tone === "critical"
      ? {
          border: "hsl(var(--destructive) / 0.45)",
          bg: "hsl(var(--destructive) / 0.08)",
          icon: "hsl(var(--destructive))",
          value: "hsl(var(--destructive))",
        }
      : {
          border: "hsl(var(--warning, 38 92% 50%) / 0.45)",
          bg: "hsl(var(--warning, 38 92% 50%) / 0.08)",
          icon: "hsl(var(--warning, 38 92% 50%))",
          value: "hsl(var(--foreground))",
        };
  return (
    <Link
      to={to}
      className="hover-card-lift outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{
        background: tokens.bg,
        border: `1px solid ${tokens.border}`,
        borderRadius: 12,
        padding: 18,
        display: "flex",
        alignItems: "center",
        gap: 14,
        textDecoration: "none",
        color: "inherit",
      }}
      aria-label={`${label}: ${value}${hint ? `, ${hint}` : ""}`}
    >
      <div
        style={{
          width: 40, height: 40, borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: tokens.bg, color: tokens.icon, flexShrink: 0,
          border: `1px solid ${tokens.border}`,
        }}
      >
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>
          {label}
        </div>
        <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.1, color: tokens.value, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </div>
        {hint && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{hint}</div>}
      </div>
      <ArrowRight size={16} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} aria-hidden />
    </Link>
  );
};

const BottlenecksList = ({
  rows,
}: {
  rows: Array<{ status: PaymentStatus; avgMs: number; count: number }>;
}) => {
  if (!rows.length) {
    return (
      <div style={{ padding: "28px 22px", textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
        Sem dados suficientes para identificar gargalos.
      </div>
    );
  }
  const max = rows[0]?.avgMs ?? 1;
  return (
    <div>
      {rows.map((r, i) => {
        const pct = Math.max(8, Math.round((r.avgMs / max) * 100));
        return (
          <div
            key={r.status}
            style={{
              display: "grid",
              gridTemplateColumns: "20px 1fr auto",
              alignItems: "center",
              gap: 12,
              padding: "12px 22px",
              borderTop: i === 0 ? undefined : "1px solid hsl(var(--border))",
            }}
          >
            <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>
              {i + 1}
            </span>
            <div className="min-w-0">
              <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))" }} className="truncate">
                {PAYMENT_STATUS_SHORT[r.status] ?? r.status}
              </div>
              <div
                aria-hidden
                style={{
                  marginTop: 6,
                  height: 4,
                  borderRadius: 4,
                  background: "hsl(var(--muted))",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${pct}%`,
                    background: i === 0 ? "hsl(var(--destructive))" : "hsl(var(--primary))",
                    borderRadius: 4,
                  }}
                />
              </div>
            </div>
            <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "hsl(var(--foreground))", fontWeight: 600 }}>
              {formatShortDuration(r.avgMs)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// silence unused (some imports used conditionally)
void cn;

export default Dashboard;
