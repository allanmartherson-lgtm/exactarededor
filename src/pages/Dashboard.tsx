import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { TERMINAL_STATUSES } from "@/lib/paymentFlow";
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
  Building2,
  MessageCircle,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { usePaymentRisk } from "@/hooks/usePaymentRisk";
import { RiskBadge } from "@/components/payment-detail/RiskBadge";
import { SafeCard } from "@/components/ui/SafeCard";
import RecentQuestionsPanel from "@/components/dashboard/RecentQuestionsPanel";

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
    case "aprovado_em_revisao":
      return "analista";
    case "aguardando_validacao":
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
  mineAnalistaCompanies: number;
  mineValidador: number;
  mineValidadorCompanies: number;
  mineDiretor: number;
  mineDiretorCompanies: number;
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
  /** Acompanhamento do diretor: lotes já aprovados aguardando revisão final do analista. Somente leitura. */
  diretorAprovadoEmRevisao: number;
}

const initialCounts: DashboardCounts = {
  mineAnalista: 0, mineAnalistaCompanies: 0,
  mineValidador: 0, mineValidadorCompanies: 0,
  mineDiretor: 0, mineDiretorCompanies: 0,
  mineInvoicesDivergentes: 0, mineInvoicesQuestionadas: 0, mineRessalvas: 0,
  teamAnalise: 0, teamValidacao: 0, teamAprovacao: 0, teamInvoicesDivergentes: 0,
  pipeAnaliseIA: 0, pipeValidacao: 0, pipeAprovacao: 0,
  pipeAguardandoEnvio: 0, pipeNFSolicitada: 0, pipeNFRecebida: 0, pipeNFConciliada: 0, pipePago: 0,
  pipeDivergente: 0,
  attDevolvidoAnalista: 0, attRessalvas: 0, attNFQuestionada: 0,
  attNFDivergente: 0, attRejeitados: 0,
  diretorAprovadoEmRevisao: 0,
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
  devolvido_analista: "Devolvido p/ analista",
  aguardando_aprovacao: "Aprovação diretoria",
  aprovado_em_revisao: "Em revisão p/ analista",
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
  companiesCount?: number;
}
const BigStatCard = ({ label, value, icon: Icon, color, hint, mine, to, companiesCount }: BigStatCardProps) => {
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
          className="big-stat-icon"
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
        className="big-stat-value"
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
      {companiesCount !== undefined && companiesCount > 0 && (
        <div style={{ marginTop: 2, marginBottom: -4 }}>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground"
            style={{ 
              background: "hsl(var(--muted))", 
              color: "hsl(var(--muted-foreground))",
              fontWeight: 500
            }}
          >
            {companiesCount} {companiesCount === 1 ? "empresa" : "empresas"}
          </span>
        </div>
      )}
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
        className="big-stat-card hover-card-lift outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`${label}: ${value}${mine ? ", sua vez" : hint ? `, ${hint}` : ""}`}
      >
        {inner}
      </Link>
    );
  }
  return <div className="big-stat-card" style={cardStyle}>{inner}</div>;
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

/* ----------------------------------------------------------------
   CompactStatChip — versão enxuta do BigStatCard usada na nova KPI bar
   ---------------------------------------------------------------- */
interface CompactStatChipProps {
  label: string;
  value: number;
  icon: LucideIcon;
  color: BubbleColor;
  mine?: boolean;
  to?: string;
  accent?: "amber" | "rose" | null;
  index?: number;
}

// Conta de 0 → value com easing — dá vida ao número do KPI.
const useCountUp = (target: number, duration = 900) => {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (target - from) * eased);
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
};

const CompactStatChip = ({ label, value, icon: Icon, color, mine, to, accent, index = 0 }: CompactStatChipProps) => {
  const animated = useCountUp(value);
  const accentBorder =
    accent === "amber"
      ? "1px solid hsl(var(--warning) / 0.45)"
      : accent === "rose"
      ? "1px solid hsl(var(--destructive) / 0.45)"
      : mine
      ? "1px solid hsl(var(--primary) / 0.6)"
      : "1px solid hsl(var(--border))";
  const valueColor =
    accent === "amber"
      ? "hsl(var(--warning-text))"
      : accent === "rose"
      ? "hsl(var(--destructive))"
      : "hsl(var(--foreground))";
  const glowColor =
    accent === "amber"
      ? "hsl(var(--warning) / 0.35)"
      : accent === "rose"
      ? "hsl(var(--destructive) / 0.35)"
      : mine
      ? "hsl(var(--primary) / 0.35)"
      : "hsl(var(--foreground) / 0.18)";
  const style: CSSProperties = {
    background: "hsl(var(--card))",
    border: accentBorder,
    borderRadius: 14,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    textDecoration: "none",
    color: "inherit",
    minHeight: 92,
    position: "relative",
    overflow: "hidden",
    // A entrada (stat-chip-in) é aplicada via classe; chips com alerta usam
    // `stat-chip-attention` que combina entrada + pulinho + halo periódico.
    transition:
      "transform 0.25s cubic-bezier(0.22,1,0.36,1), box-shadow 0.25s ease, border-color 0.25s ease",
    "--chip-glow": glowColor,
    willChange: "transform",
  } as CSSProperties;
  const chipClass = mine
    ? "stat-chip-interactive stat-chip-mine"
    : "stat-chip-interactive";
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div
          className={mine ? "stat-chip-icon-pulse" : undefined}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            ...bubbleStyle(color),
          }}
        >
          <Icon size={15} strokeWidth={2} />
        </div>
        {mine && (
          <span
            style={{
              background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              borderRadius: 20,
              fontSize: 9,
              fontWeight: 700,
              padding: "2px 7px",
              lineHeight: 1.3,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              boxShadow: "0 0 0 0 hsl(var(--primary) / 0.6)",
              animation: "stat-chip-badge-pulse 2.4s ease-in-out infinite",
            }}
          >
            Sua vez
          </span>
        )}
      </div>
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: "hsl(var(--muted-foreground))",
            textTransform: "uppercase",
            lineHeight: 1.3,
            marginBottom: 4,
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: valueColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {animated}
        </span>
      </div>
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        style={style}
        className={`${chipClass} outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
        aria-label={`${label}: ${value}${mine ? ", sua vez" : ""}`}
      >
        {inner}
      </Link>
    );
  }
  return <div style={style} className={chipClass}>{inner}</div>;
};


const CompactStatSkeleton = () => (
  <div
    style={{
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 14,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      minHeight: 92,
    }}
  >
    <Skeleton className="h-7 w-7 rounded-lg" />
    <Skeleton className="h-3 w-20" />
    <Skeleton className="h-6 w-10" />
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
    className="chip-group inline-flex"
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
  const [groupStatusesByPayment, setGroupStatusesByPayment] = useState<Record<string, PaymentStatus[]>>({});
  const [companyOverrides, setCompanyOverrides] = useState<Record<string, CompanySlaOverride>>({});
  // Tempo médio agregado por status (gargalos)
  const [avgTimeByStatus, setAvgTimeByStatus] = useState<Record<string, { avgMs: number; count: number }>>({});
  const [loading, setLoading] = useState(true);
  const [openQuestionCount, setOpenQuestionCount] = useState<Record<string, number>>({});
  const [anomaliesOpen, setAnomaliesOpen] = useState(0);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [recentApprovedData, setRecentApprovedData] = useState<Array<{ id: string; total_amount: number | null; approved_at: string | null }>>([]);
  const [recentRejectedCount, setRecentRejectedCount] = useState(0);
  const [teamOpenQuestionsCount, setTeamOpenQuestionsCount] = useState(0);
  const {
    owner: pipelineOwner,
    window: pipelineWindow,
    density: pipelineDensity,
    setOwner: setPipelineOwner,
    setWindow: setPipelineWindow,
    setDensity: setPipelineDensity,
  } = usePipelinePreferences();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: pr }, { data: all }, { data: invDiv }, { data: invQuest }, { data: openQs }] = await Promise.all([
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
      supabase.from("payment_observations").select("payment_id").eq("is_question", true).is("resolved_at", null).limit(2000),
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

    const qcounts: Record<string, number> = {};
    (openQs ?? []).forEach((r: any) => {
      if (r.payment_id) qcounts[r.payment_id] = (qcounts[r.payment_id] ?? 0) + 1;
    });
    setOpenQuestionCount(qcounts);
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
        ? supabase.from("payment_company_groups").select("payment_id,company_id,status").in("payment_id", allIds)
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
    const gByP: Record<string, PaymentStatus[]> = {};
    (groups ?? []).forEach((g: any) => {
      if (g.company_id && !cByP[g.payment_id]) cByP[g.payment_id] = g.company_id;
      if (g.status) (gByP[g.payment_id] = gByP[g.payment_id] ?? []).push(g.status as PaymentStatus);
    });
    setCompanyByPayment(cByP);
    setGroupStatusesByPayment(gByP);
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
    // Separação estrita: "minhas" = pagamentos efetivamente atribuídos ao
    // usuário logado (created_by/validated_by). A fila coletiva do papel
    // aparece em "Tarefas em aberto" e no Pipeline da equipe.
    const c: DashboardCounts = { ...initialCounts };
    const ANALISTA_PENDING_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
      "em_analise_ia", "revisao_analista", "devolvido_analista", "nf_questionada",
    ]);

    // Mapeia empresas por pagamento para contagem distinta nos cards de ação
    const paymentCompaniesMap: Record<string, string[]> = {};
    (groups ?? []).forEach((g: any) => {
      if (g.payment_id && g.company_id) {
        (paymentCompaniesMap[g.payment_id] = paymentCompaniesMap[g.payment_id] ?? []).push(g.company_id);
      }
    });

    const mineAnalistaCompaniesSet = new Set<string>();
    const mineValidadorCompaniesSet = new Set<string>();
    const mineDiretorCompaniesSet = new Set<string>();

    (all ?? []).forEach((p: { id: string; status: PaymentStatus; created_by: string | null; validated_by: string | null }) => {
      const owner = ownerRoleFor(p.status);
      const groupStatuses = gByP[p.id] ?? [];
      const hasGroupInValidacao = groupStatuses.some((s) => s === "aguardando_validacao");
      const hasGroupInAprovacao = groupStatuses.some((s) => s === "aguardando_aprovacao");
      // "Minha pendência" considera tanto status do lote quanto status por
      // empresa — basta UMA empresa do lote estar na fase do papel.
      const isValidadorRole = roles.includes("validador") || roles.includes("admin");
      const isDiretorRole = roles.includes("diretor") || roles.includes("admin");
      const isMineRow =
        !!uid && (
          (owner === "analista" && ANALISTA_PENDING_STATUSES.has(p.status) && p.created_by === uid) ||
          hasGroupInValidacao ||
          (p.status === "aguardando_aprovacao" || hasGroupInAprovacao)
        );

      if (isMineRow) {
        const companies = paymentCompaniesMap[p.id] ?? [];
        if (owner === "analista" && ANALISTA_PENDING_STATUSES.has(p.status) && p.created_by === uid) {
          companies.forEach(id => mineAnalistaCompaniesSet.add(id));
        }
        if (isValidadorRole && hasGroupInValidacao) {
          companies.forEach(id => mineValidadorCompaniesSet.add(id));
        }
        if (p.status === "aguardando_aprovacao" || hasGroupInAprovacao) {
          companies.forEach(id => mineDiretorCompaniesSet.add(id));
        }
      }

      if (owner === "analista") {
        c.teamAnalise++;
        if (ANALISTA_PENDING_STATUSES.has(p.status) && p.created_by === uid) c.mineAnalista++;
      } else if (owner === "validador") {
        c.teamValidacao++;
      } else if (owner === "diretor") {
        c.teamAprovacao++;
      }
      if (isDiretorRole && (p.status === "aguardando_aprovacao" || hasGroupInAprovacao)) {
        c.mineDiretor++;
      }

      // Validação por empresa: conta qualquer lote que tenha pelo menos uma
      // empresa em aguardando_validacao (mesmo que o status do lote esteja
      // em revisao_analista — situação normal em lotes mistos).
      if (hasGroupInValidacao) {
        c.mineValidador++;
        if (owner !== "validador") c.teamValidacao++;
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
        case "aprovado_em_revisao":
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
      // Pipeline: lotes mistos também aparecem em Validação/Aprovação
      if (p.status !== "aguardando_validacao" && hasGroupInValidacao) c.pipeValidacao++;
      if (p.status !== "aguardando_aprovacao" && hasGroupInAprovacao) c.pipeAprovacao++;

      if (p.status === "devolvido_analista") c.attDevolvidoAnalista++;
      if (p.status === "aprovado_com_ressalva") {
        c.attRessalvas++;
        if (isMineRow) c.mineRessalvas++;
      }
      if (p.status === "nf_questionada") {
        c.attNFQuestionada++;
        if (isMineRow) c.mineInvoicesQuestionadas++;
      }
      if (p.status === "rejeitado") c.attRejeitados++;
      if (p.status === "aprovado_em_revisao") c.diretorAprovadoEmRevisao++;
    });

    c.mineAnalistaCompanies = mineAnalistaCompaniesSet.size;
    c.mineValidadorCompanies = mineValidadorCompaniesSet.size;
    c.mineDiretorCompanies = mineDiretorCompaniesSet.size;

    (invDiv ?? []).forEach((row: any) => {
      c.teamInvoicesDivergentes++;
      c.attNFDivergente++;
      const cb = row?.payment?.created_by ?? null;
      if (uid && cb === uid) c.mineInvoicesDivergentes++;
    });
    void invQuest;
    void uid;

    // Queries adicionais para validador/diretor (visão da equipe)
    const isElevated =
      roles.includes("validador") || roles.includes("diretor") || roles.includes("admin");
    if (isElevated) {
      const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: rApproved }, { data: rRejected }, { data: tQuestions }] = await Promise.all([
        supabase
          .from("payments")
          .select("id,total_amount,approved_at")
          .not("approved_at", "is", null)
          .gte("approved_at", sinceIso),
        supabase
          .from("payments")
          .select("id")
          .eq("status", "rejeitado")
          .gte("updated_at", sinceIso),
        supabase
          .from("payment_observations")
          .select("payment_id")
          .eq("is_question", true)
          .is("resolved_at", null),
      ]);
      setRecentApprovedData((rApproved ?? []) as Array<{ id: string; total_amount: number | null; approved_at: string | null }>);
      setRecentRejectedCount((rRejected ?? []).length);
      setTeamOpenQuestionsCount((tQuestions ?? []).length);
    }

    setCounts(c);
    setLoading(false);
  }, [user?.id, initialCounts, roles]);

  useEffect(() => {
    document.title = "Dashboard | MedPay Approval";
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => { load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_company_groups" }, () => { load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_observations" }, () => { load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_items" }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

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
      analista: new Set<PaymentStatus>(["em_analise_ia", "revisao_analista", "nf_questionada", "aprovado_em_revisao"]),
      // "Validação" = aguardando_validacao
      validador: new Set<PaymentStatus>(["aguardando_validacao"]),
      // "Aprovação" = aguardando_aprovacao
      diretor: new Set<PaymentStatus>(["aguardando_aprovacao"]),
    };
    const matchesOwner = (p: { status: PaymentStatus }) =>
      pipelineOwner === "all"
        ? true
        : ACTION_QUEUE[pipelineOwner].has(p.status);
    const c = { ...initialCounts };
    for (const p of allPayments) {
      if (deletingIds.has(p.id)) continue;
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
        case "aprovado_em_revisao":
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
  }, [allPayments, pipelineOwner, pipelineWindow, deletingIds]);

  const pipelineQuery = useMemo(() => {
    const parts: string[] = [];
    if (pipelineOwner !== "all") parts.push(`owner=${pipelineOwner}`);
    if (pipelineWindow !== "all") parts.push(`days=${pipelineWindow}`);
    return parts.length ? `&${parts.join("&")}` : "";
  }, [pipelineOwner, pipelineWindow]);

  const isAnalista = roles.includes("analista") || roles.includes("admin");
  const isValidador = roles.includes("validador") || roles.includes("admin");
  const isDiretor = roles.includes("diretor") || roles.includes("admin");

  // Anomalias de status (admin/diretor): contagem em aberto + realtime.
  useEffect(() => {
    if (!isDiretor) return;
    let cancelled = false;
    const fetchCount = async () => {
      const { count } = await supabase
        .from("status_anomalies")
        .select("id", { count: "exact", head: true })
        .is("resolved_at", null);
      if (!cancelled) setAnomaliesOpen(count ?? 0);
    };
    fetchCount();
    const ch = supabase
      .channel("dash_anomalies")
      .on("postgres_changes", { event: "*", schema: "public", table: "status_anomalies" }, () => {
        fetchCount();
      })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [isDiretor]);

  // Questionamentos pendentes para o analista (lotes criados por ele com empresa em em_questionamento).
  const [pendingQuestions, setPendingQuestions] = useState<
    Array<{ payment_id: string; reference: string; count: number }>
  >([]);
  useEffect(() => {
    if (!isAnalista || !user?.id) return;
    let cancelled = false;
    const fetchPending = async () => {
      const { data } = await supabase
        .from("payment_company_groups")
        .select("id, payment_id, company_name, payments!inner(reference, created_by)")
        .eq("status", "em_questionamento")
        .eq("payments.created_by", user.id);
      if (cancelled) return;
      const byPayment = new Map<string, { reference: string; count: number }>();
      ((data ?? []) as Array<{ payment_id: string; payments: { reference: string } | null }>).forEach((r) => {
        const ref = r.payments?.reference ?? "—";
        const cur = byPayment.get(r.payment_id) ?? { reference: ref, count: 0 };
        cur.count += 1;
        byPayment.set(r.payment_id, cur);
      });
      setPendingQuestions(
        Array.from(byPayment.entries()).map(([payment_id, v]) => ({ payment_id, ...v })),
      );
    };
    fetchPending();
    const ch = supabase
      .channel("dash_pending_questions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_company_groups" },
        () => fetchPending(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_questions" },
        () => fetchPending(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [isAnalista, user?.id]);
  const totalPendingQuestions = pendingQuestions.reduce((sum, p) => sum + p.count, 0);

  // Empresas aprovadas pelo diretor aguardando liberação de pedido de NF pelo analista.
  const [pendingReleaseNf, setPendingReleaseNf] = useState<
    Array<{ payment_id: string; reference: string; count: number }>
  >([]);
  useEffect(() => {
    if (!isAnalista || !user?.id) return;
    let cancelled = false;
    const fetchPending = async () => {
      const { data } = await supabase
        .from("payment_company_groups")
        .select("id, payment_id, payments!inner(reference, created_by)")
        .eq("status", "revisao_pos_aprovacao")
        .eq("payments.created_by", user.id);
      if (cancelled) return;
      const byPayment = new Map<string, { reference: string; count: number }>();
      ((data ?? []) as Array<{ payment_id: string; payments: { reference: string } | null }>).forEach((r) => {
        const ref = r.payments?.reference ?? "—";
        const cur = byPayment.get(r.payment_id) ?? { reference: ref, count: 0 };
        cur.count += 1;
        byPayment.set(r.payment_id, cur);
      });
      setPendingReleaseNf(
        Array.from(byPayment.entries()).map(([payment_id, v]) => ({ payment_id, ...v })),
      );
    };
    fetchPending();
    const ch = supabase
      .channel("dash_pending_release_nf")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_company_groups" },
        () => fetchPending(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [isAnalista, user?.id]);
  const totalPendingReleaseNf = pendingReleaseNf.reduce((sum, p) => sum + p.count, 0);

  // Perguntas da EMPRESA (recebedor) na NF — não lidas pelo time interno
  const [companyInvoiceQuestions, setCompanyInvoiceQuestions] = useState<{ count: number; firstPaymentId: string | null }>({ count: 0, firstPaymentId: null });
  useEffect(() => {
    if (!isAnalista || !user?.id) return;
    let cancelled = false;
    const fetchIQ = async () => {
      const { data } = await supabase
        .from("invoice_questions")
        .select("id, payment_id, payment:payments!inner(created_by)")
        .eq("author_type", "recebedor")
        .is("read_at", null)
        .eq("payments.created_by", user.id);
      if (cancelled) return;
      const rows = (data ?? []) as Array<{ id: string; payment_id: string }>;
      setCompanyInvoiceQuestions({
        count: rows.length,
        firstPaymentId: rows[0]?.payment_id ?? null,
      });
    };
    fetchIQ();
    const ch = supabase
      .channel("dash_invoice_questions")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_questions" }, () => fetchIQ())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [isAnalista, user?.id]);



  // Contagem de invoices por status de NF para o analista
  const [pendingNfAguardando, setPendingNfAguardando] = useState<number>(0);
  const [pendingNfRecebida, setPendingNfRecebida] = useState<number>(0);
  const [pendingNfConciliar, setPendingNfConciliar] = useState<number>(0);
  useEffect(() => {
    if (!isAnalista || !user?.id) return;
    let cancelled = false;
    const fetchNfCounts = async () => {
      const { data: aguardando } = await supabase
        .from("invoices")
        .select("id, payment:payments!inner(created_by)")
        .eq("status", "aguardando")
        .eq("payments.created_by", user.id);

      const { data: recebida } = await supabase
        .from("invoices")
        .select("id, payment:payments!inner(created_by)")
        .eq("status", "recebida")
        .eq("payments.created_by", user.id);

      const { data: conciliar } = await supabase
        .from("invoices")
        .select("id, payment:payments!inner(created_by)")
        .eq("status", "conciliada")
        .eq("payments.created_by", user.id);

      if (cancelled) return;
      setPendingNfAguardando((aguardando ?? []).length);
      setPendingNfRecebida((recebida ?? []).length);
      setPendingNfConciliar((conciliar ?? []).length);
    };
    fetchNfCounts();
    const ch = supabase
      .channel("dash_nf_counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => fetchNfCounts())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [isAnalista, user?.id]);

  // Atividade recente — últimas transições de status do time (sidebar)
  const [recentActivity, setRecentActivity] = useState<
    Array<{
      id: string;
      payment_id: string;
      reference: string | null;
      status_to: PaymentStatus | null;
      status_from: PaymentStatus | null;
      changed_at: string;
      actor_name: string | null;
    }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    const fetchActivity = async () => {
      const { data } = await supabase
        .from("payment_status_history")
        .select("id,payment_id,status_to,status_from,changed_at,changed_by,payments(reference)")
        .order("changed_at", { ascending: false })
        .limit(8);
      if (cancelled || !data) return;
      const actorIds = Array.from(
        new Set((data as any[]).map((r) => r.changed_by).filter(Boolean)),
      ) as string[];
      let actorMap: Record<string, string> = {};
      if (actorIds.length) {
        const { data: pr } = await supabase
          .from("profiles")
          .select("id,full_name,email")
          .in("id", actorIds);
        (pr ?? []).forEach((p: any) => {
          actorMap[p.id] = p.full_name || p.email || "—";
        });
      }
      setRecentActivity(
        (data as any[]).map((r) => ({
          id: r.id,
          payment_id: r.payment_id,
          reference: r.payments?.reference ?? null,
          status_to: r.status_to,
          status_from: r.status_from,
          changed_at: r.changed_at,
          actor_name: r.changed_by ? actorMap[r.changed_by] ?? null : null,
        })),
      );
    };
    fetchActivity();
    const ch = supabase
      .channel("dash_recent_activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "payment_status_history" },
        () => fetchActivity(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, []);


  // "Pendente para mim" = papel atual do lote bate com um papel que o
  // usuário exerce E ele tem vínculo legítimo com o lote.
  // - Analista: lote em status de analista E criado por ele.
  // - Validador: lote em aguardando_validacao atribuído a ele/grupo/fila geral.
  // - Diretor: lote em aguardando_aprovacao (qualquer diretor age).
  // Status pós-aprovação (aprovado, pedido_nf_*, nf_*, lancado, pago) e
  // terminais (rejeitado, cancelado) NUNCA aparecem como pendência aqui,
  // mesmo que o usuário tenha criado/validado/aprovado o lote.
  const ANALISTA_PENDING: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
    "em_analise_ia", "revisao_analista", "devolvido_analista", "nf_questionada",
  ]);
  const isMine = (p: PaymentRow): boolean => {
    const uid = user?.id;
    if (!uid) return false;
    const owner = ownerRoleFor(p.status);
    const gs = groupStatusesByPayment[p.id] ?? [];
    if (owner === "analista" && isAnalista && ANALISTA_PENDING.has(p.status) && p.created_by === uid) return true;
    if (isValidador && (p.status === "aguardando_validacao" || gs.some((s) => s === "aguardando_validacao"))) return true;
    if (isDiretor && (p.status === "aguardando_aprovacao" || gs.some((s) => s === "aguardando_aprovacao"))) return true;
    return false;
  };

  const myPayments = payments.filter(isMine).slice(0, 6);

  // Fila coletiva (qualquer pagamento em status acionável, do time todo)
  const ACTIONABLE_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
    "em_analise_ia", "revisao_analista", "aguardando_validacao",
    "aguardando_aprovacao", "devolvido_analista",
    "nf_questionada", "aprovado_com_ressalva",
  ]);
  const teamOpenPayments = payments
    .filter((p) => {
      if (ACTIONABLE_STATUSES.has(p.status)) return true;
      const gs = groupStatusesByPayment[p.id] ?? [];
      return gs.some((s) => ACTIONABLE_STATUSES.has(s));
    })
    .slice(0, 8);
  const teamOpenTotal =
    counts.teamAnalise + counts.teamValidacao + counts.teamAprovacao;

  // ============================================================
  // CÁLCULO DE SLA + URGÊNCIA
  // Usa a definição canônica de TERMINAL_STATUSES (paymentFlow.ts).
  // Lotes terminais (lancado/pago/rejeitado/cancelado) não têm SLA.
  // `aprovado` NÃO é terminal — segue para fluxo de NF e tem SLA próprio.
  // ============================================================

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

  // SLA em risco — pagamentos do time todo cujo SLA está vencido ou em alerta preventivo
  const slaAtRisk = useMemo(() => {
    const enriched = allPayments
      .map((p) => {
        const r = slaForPayment({ id: p.id, status: p.status, created_at: p.created_at });
        if (!r) return null;
        if (r.level !== "vencido" && r.level !== "preventivo") return null;
        const meta = payments.find((x) => x.id === p.id);
        return {
          id: p.id,
          status: p.status,
          level: r.level,
          ms: r.ms,
          reference: meta?.reference ?? null,
          total_amount: meta?.total_amount ?? null,
          created_by: p.created_by,
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        status: PaymentStatus;
        level: SlaLevel;
        ms: number;
        reference: string | null;
        total_amount: number | string | null;
        created_by: string | null;
      }>;
    return enriched
      .sort((a, b) => {
        const la = a.level === "vencido" ? 2 : 1;
        const lb = b.level === "vencido" ? 2 : 1;
        if (la !== lb) return lb - la;
        return b.ms - a.ms;
      })
      .slice(0, 4);
  }, [allPayments, payments, statusEnteredAt, slaSettings, companyByPayment, companyOverrides]);


  const myPending =
    (isAnalista ? counts.mineAnalista + counts.mineInvoicesDivergentes + counts.mineInvoicesQuestionadas + counts.mineRessalvas : 0) +
    (isValidador ? counts.mineValidador : 0) +
    (isDiretor ? counts.mineDiretor : 0);

  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? "bem-vindo";

  // Modo de dashboard por perfil — admin vê o do diretor (visão máxima)
  const dashboardMode: "analista" | "validador" | "diretor" =
    isDiretor || roles.includes("admin")
      ? "diretor"
      : isValidador
      ? "validador"
      : "analista";

  // ============================================================
  // VIEW: VALIDADOR
  // ============================================================
  if (dashboardMode === "validador") {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", lineHeight: 1.2 }}>
            Olá, <span style={{ fontWeight: 700 }}>{firstName}</span>
          </h1>
          <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Visão da equipe · {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>

        {anomaliesOpen > 0 && (
          <Link to="/anomalias-status" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive-soft px-4 py-3 hover:bg-destructive/10 transition-colors">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span className="font-semibold">{anomaliesOpen}</span>
              anomalia{anomaliesOpen > 1 ? "s" : ""} de status pendente{anomaliesOpen > 1 ? "s" : ""} — clique para revisar.
            </div>
            <span className="text-xs text-destructive/80">Abrir →</span>
          </Link>
        )}

        {counts.mineValidador > 0 && (
          <section>
            <SectionLabel>Sua fila de validação</SectionLabel>
            <div style={{ background: "hsl(var(--card))", border: "0.5px solid hsl(var(--border))", borderRadius: 10, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, borderRight: "0.5px solid hsl(var(--border))", display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: "hsl(var(--accent-foreground))", letterSpacing: "0.07em", textTransform: "uppercase", padding: "8px 14px", background: "hsl(var(--accent))", borderBottom: "0.5px solid hsl(var(--border))", textAlign: "center" }}>
                  Para validar
                </div>
                <Link to="/pagamentos?status=aguardando_validacao" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", textDecoration: "none", color: "inherit", flex: 1 }} className="hover:bg-muted/50">
                  <span style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", letterSpacing: "0.04em", textTransform: "uppercase" }}>Lotes aguardando</span>
                  <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: "hsl(var(--sidebar-primary))", fontVariantNumeric: "tabular-nums" }}>{counts.mineValidador}</span>
                  <span style={{ fontSize: 9, fontWeight: 500, color: "hsl(var(--accent-foreground))" }}>↑ ação necessária</span>
                </Link>
              </div>
              {slaTotals.vencido > 0 && (
                <div style={{ flex: 1, borderRight: "0.5px solid hsl(var(--border))", display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "hsl(var(--destructive))", letterSpacing: "0.07em", textTransform: "uppercase", padding: "8px 14px", background: "hsl(var(--destructive-soft))", borderBottom: "0.5px solid hsl(var(--border))", textAlign: "center" }}>
                    SLA vencido
                  </div>
                  <Link to="/pagamentos?filter=sla_vencido" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", textDecoration: "none", color: "inherit", flex: 1 }} className="hover:bg-muted/50">
                    <span style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", letterSpacing: "0.04em", textTransform: "uppercase" }}>Lotes fora do prazo</span>
                    <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>{slaTotals.vencido}</span>
                  </Link>
                </div>
              )}
              {slaTotals.preventivo > 0 && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "hsl(var(--warning))", letterSpacing: "0.07em", textTransform: "uppercase", padding: "8px 14px", background: "hsl(var(--warning-soft))", borderBottom: "0.5px solid hsl(var(--border))", textAlign: "center" }}>
                    SLA em risco
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", flex: 1 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", letterSpacing: "0.04em", textTransform: "uppercase" }}>Próximos do prazo</span>
                    <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: "hsl(var(--warning))", fontVariantNumeric: "tabular-nums" }}>{slaTotals.preventivo}</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="pipeline-equipe-validador">
          <SectionLabel>Pipeline da equipe</SectionLabel>
          <SurfaceCard>
            <SurfaceCardHeader
              title="Distribuição de lotes por etapa"
              icon={Users}
              iconColor="purple"
              countPill={teamOpenTotal}
              rightAction={
                <Link to="/pagamentos" style={{ fontSize: 12, color: "hsl(var(--accent-foreground))", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Ver todos <ArrowRight size={13} />
                </Link>
              }
            />
            {(() => {
              const cols = [
                { icon: FileText, color: "purple" as BubbleColor, label: "Análise IA", value: counts.pipeAnaliseIA, to: "/pagamentos?status=em_analise_ia" },
                { icon: ListChecks, color: "yellow" as BubbleColor, label: "Validação", value: counts.pipeValidacao, to: "/pagamentos?status=aguardando_validacao" },
                { icon: ShieldCheck, color: "blue" as BubbleColor, label: "Aprovação", value: counts.pipeAprovacao, to: "/pagamentos?status=aguardando_aprovacao" },
                { icon: Send, color: "teal" as BubbleColor, label: "Aguard. NF", value: counts.pipeAguardandoEnvio, to: "/pagamentos?status=aprovado" },
                { icon: FileText, color: "green" as BubbleColor, label: "NF Solicitada", value: counts.pipeNFSolicitada, to: "/pagamentos?status=pedido_nf_enviado" },
                { icon: AlertCircle, color: "red" as BubbleColor, label: "Divergente", value: counts.pipeDivergente, to: "/pagamentos?status=nf_questionada" },
              ];
              return (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`, padding: "18px 22px", gap: 0 }}>
                  {cols.map((col, i) => (
                    <PipelineCol
                      key={col.label}
                      {...col}
                      density="comfortable"
                      separated={i > 0}
                      delayed={
                        col.label === "Análise IA"
                          ? (slaTotals.perStatusVencido["em_analise_ia"] ?? 0) + (slaTotals.perStatusVencido["revisao_analista"] ?? 0)
                          : col.label === "Validação"
                          ? slaTotals.perStatusVencido["aguardando_validacao"] ?? 0
                          : col.label === "Aprovação"
                          ? slaTotals.perStatusVencido["aguardando_aprovacao"] ?? 0
                          : 0
                      }
                    />
                  ))}
                </div>
              );
            })()}
          </SurfaceCard>
        </section>

        {slaAtRisk.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "hsl(var(--destructive))" }} />
              <h2 style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>
                SLA em risco <span style={{ color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>· equipe toda</span>
              </h2>
              <span style={{ background: "hsl(var(--destructive-soft))", color: "hsl(var(--destructive))", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>{slaAtRisk.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {slaAtRisk.map((s) => {
                const isVencido = s.level === "vencido";
                const statusLabel = PAYMENT_STATUS_SHORT[s.status] ?? s.status;
                return (
                  <Link
                    key={s.id}
                    to={`/pagamentos/${s.id}`}
                    className="flex items-center justify-between gap-3 hover-card-lift outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    style={{
                      background: isVencido ? "hsl(var(--destructive) / 0.04)" : "hsl(var(--card))",
                      border: isVencido ? "1px solid hsl(var(--destructive) / 0.3)" : "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      padding: "12px 14px",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: isVencido ? "hsl(var(--destructive))" : "hsl(var(--muted))", color: isVencido ? "hsl(var(--destructive-foreground))" : "hsl(var(--muted-foreground))" }}>
                        <Timer size={16} />
                      </div>
                      <div className="min-w-0">
                        <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: 2 }} className="truncate">{s.reference ?? "Lote"} · {statusLabel}</p>
                        <p style={{ fontSize: 11, fontWeight: 600, color: isVencido ? "hsl(var(--destructive))" : "hsl(var(--warning-foreground))" }}>
                          {isVencido ? "Vencido há " : "Há "}{formatShortDuration(s.ms)}
                          {s.created_by && profiles[s.created_by] && ` · Analista: ${profiles[s.created_by]}`}
                        </p>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-muted-foreground flex-shrink-0" />
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SurfaceCard>
            <SurfaceCardHeader title="Perguntas abertas da equipe" icon={MessageCircle} iconColor="yellow" countPill={teamOpenQuestionsCount} />
            <div style={{ padding: "16px 22px" }}>
              {teamOpenQuestionsCount === 0 ? (
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Nenhuma pergunta em aberto.</p>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: "hsl(var(--foreground))", fontWeight: 500 }}>
                    {teamOpenQuestionsCount} pergunta{teamOpenQuestionsCount > 1 ? "s" : ""} aguardando resposta
                  </p>
                  <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
                    Verifique os lotes com questionamentos pendentes.
                  </p>
                  <Link to="/pagamentos?filter=com_pergunta" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 12, fontSize: 12, fontWeight: 500, color: "hsl(var(--accent-foreground))", textDecoration: "none" }}>
                    Ver lotes com perguntas <ArrowRight size={13} />
                  </Link>
                </div>
              )}
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

        <section>
          <SectionLabel>Atividade recente da equipe</SectionLabel>
          <SurfaceCard style={{ padding: 20 }}>
            {recentActivity.length === 0 ? (
              <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "20px 0" }}>Sem atividade recente.</p>
            ) : (
              <div className="relative flex flex-col gap-5">
                <div className="absolute top-2 bottom-2 w-px" style={{ left: 11, background: "hsl(var(--border))" }} />
                {recentActivity.map((a) => {
                  const isDevol = a.status_to === "devolvido_analista";
                  const isApprov = a.status_to === "aprovado" || a.status_to === "aprovado_com_ressalva";
                  const dotColor = isDevol ? "hsl(var(--destructive))" : isApprov ? "hsl(var(--success))" : "hsl(var(--info))";
                  const dotBg = isDevol ? "hsl(var(--destructive) / 0.12)" : isApprov ? "hsl(var(--success) / 0.12)" : "hsl(var(--info) / 0.12)";
                  const statusLabel = a.status_to ? (PAYMENT_STATUS_SHORT[a.status_to] ?? a.status_to) : "—";
                  const elapsed = Date.now() - new Date(a.changed_at).getTime();
                  return (
                    <Link key={a.id} to={`/pagamentos/${a.payment_id}`} className="relative pl-8 block hover:bg-muted/30 -mx-2 px-2 py-1 rounded-md transition-colors" style={{ textDecoration: "none", color: "inherit" }}>
                      <div className="absolute top-1" style={{ left: 0, width: 24, height: 24, borderRadius: "50%", background: dotBg, border: "4px solid hsl(var(--card))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor }} />
                      </div>
                      <p style={{ fontSize: 12, color: "hsl(var(--foreground))", lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 600 }}>{a.actor_name ?? "Sistema"}</span>{" "}
                        <span style={{ color: "hsl(var(--muted-foreground))" }}>→</span>{" "}
                        <span style={{ fontWeight: 500 }}>{statusLabel}</span>
                        {a.reference && <span style={{ color: "hsl(var(--muted-foreground))" }}> · {a.reference}</span>}
                      </p>
                      <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Há {formatShortDuration(elapsed)}</p>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link to="/auditoria" className="block w-full mt-5 py-2 text-center rounded-lg transition-colors hover:bg-muted/50" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase", border: "1px solid hsl(var(--border))", textDecoration: "none" }}>
              Ver histórico completo
            </Link>
          </SurfaceCard>
        </section>
      </div>
    );
  }

  // ============================================================
  // VIEW: DIRETOR
  // ============================================================
  if (dashboardMode === "diretor") {
    const paymentTotalsById = new Map(payments.map((p) => [p.id, Number(p.total_amount ?? 0)]));
    const totalValorEmProcessamento = allPayments
      .filter((p) => !TERMINAL_STATUSES.has(p.status))
      .reduce((sum, p) => sum + (paymentTotalsById.get(p.id) ?? 0), 0);

    const totalAprovados30d = recentApprovedData.length;
    const valorAprovado30d = recentApprovedData.reduce((s, p) => s + Number(p.total_amount ?? 0), 0);
    const taxaAprovacao =
      totalAprovados30d + recentRejectedCount > 0
        ? Math.round((totalAprovados30d / Math.max(totalAprovados30d + recentRejectedCount, 1)) * 100)
        : null;
    const lotesEmAberto = counts.teamAnalise + counts.teamValidacao + counts.teamAprovacao;

    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", lineHeight: 1.2 }}>
              Olá, <span style={{ fontWeight: 700 }}>{firstName}</span>
            </h1>
            <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
              Visão executiva · {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
        </div>

        {anomaliesOpen > 0 && (
          <Link to="/anomalias-status" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive-soft px-4 py-3 hover:bg-destructive/10 transition-colors">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span className="font-semibold">{anomaliesOpen}</span>
              anomalia{anomaliesOpen > 1 ? "s" : ""} de status pendente{anomaliesOpen > 1 ? "s" : ""} — requer atenção.
            </div>
            <span className="text-xs text-destructive/80">Revisar →</span>
          </Link>
        )}

        <section>
          <SectionLabel>Visão geral do processo</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <div style={{ background: "hsl(var(--card))", border: "0.5px solid hsl(var(--border))", borderRadius: 8, padding: "16px 18px" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "hsl(var(--bubble-blue-bg))", color: "hsl(var(--bubble-blue-fg))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <FileText size={15} />
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>Em andamento</div>
              <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{lotesEmAberto}</div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>lotes no fluxo</div>
            </div>

            <div style={{ background: "hsl(var(--card))", border: "0.5px solid hsl(var(--border))", borderRadius: 8, padding: "16px 18px" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "hsl(var(--bubble-purple-bg))", color: "hsl(var(--bubble-purple-fg))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <CreditCard size={15} />
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>Em processamento</div>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(totalValorEmProcessamento)}</div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>valor total pendente</div>
            </div>

            <div style={{ background: "hsl(var(--card))", border: "0.5px solid hsl(var(--border))", borderRadius: 8, padding: "16px 18px" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "hsl(var(--bubble-green-bg))", color: "hsl(var(--bubble-green-fg))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <CheckCircle size={15} />
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>Aprovados (30d)</div>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(valorAprovado30d)}</div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>{totalAprovados30d} lotes aprovados</div>
            </div>

            <div style={{ background: "hsl(var(--card))", border: "0.5px solid hsl(var(--border))", borderRadius: 8, padding: "16px 18px" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: taxaAprovacao !== null && taxaAprovacao >= 90 ? "hsl(var(--bubble-green-bg))" : "hsl(var(--bubble-yellow-bg))", color: taxaAprovacao !== null && taxaAprovacao >= 90 ? "hsl(var(--bubble-green-fg))" : "hsl(var(--bubble-yellow-fg))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <CheckCircle2 size={15} />
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>Taxa aprovação</div>
              <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: taxaAprovacao !== null && taxaAprovacao >= 90 ? "hsl(var(--success))" : "hsl(var(--warning))", fontVariantNumeric: "tabular-nums" }}>
                {taxaAprovacao !== null ? `${taxaAprovacao}%` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>últimos 30 dias</div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <section className="lg:col-span-7">
            <SectionLabel>Distribuição do pipeline</SectionLabel>
            <SurfaceCard>
              {(() => {
                const cols = [
                  { icon: FileText, color: "purple" as BubbleColor, label: "Análise", value: counts.pipeAnaliseIA, to: "/pagamentos?status=em_analise_ia" },
                  { icon: ListChecks, color: "yellow" as BubbleColor, label: "Validação", value: counts.pipeValidacao, to: "/pagamentos?status=aguardando_validacao" },
                  { icon: ShieldCheck, color: "blue" as BubbleColor, label: "Aprovação", value: counts.pipeAprovacao, to: "/pagamentos?status=aguardando_aprovacao" },
                  { icon: Send, color: "teal" as BubbleColor, label: "NF", value: counts.pipeNFSolicitada + counts.pipeAguardandoEnvio, to: "/pagamentos?status=pedido_nf_enviado" },
                  { icon: CheckCircle, color: "green" as BubbleColor, label: "Concluído", value: counts.pipePago + counts.pipeNFConciliada, to: "/pagamentos?status=pago" },
                ];
                return (
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`, padding: "18px 16px", gap: 0 }}>
                    {cols.map((col, i) => (
                      <PipelineCol
                        key={col.label}
                        {...col}
                        density="comfortable"
                        separated={i > 0}
                        delayed={
                          col.label === "Análise"
                            ? (slaTotals.perStatusVencido["em_analise_ia"] ?? 0) + (slaTotals.perStatusVencido["revisao_analista"] ?? 0)
                            : col.label === "Validação"
                            ? slaTotals.perStatusVencido["aguardando_validacao"] ?? 0
                            : col.label === "Aprovação"
                            ? slaTotals.perStatusVencido["aguardando_aprovacao"] ?? 0
                            : 0
                        }
                      />
                    ))}
                  </div>
                );
              })()}
            </SurfaceCard>
          </section>

          <aside className="lg:col-span-5">
            <SectionLabel>Alertas críticos</SectionLabel>
            <SurfaceCard style={{ height: "100%" }}>
              {slaTotals.vencido === 0 && slaTotals.preventivo === 0 ? (
                <div style={{ padding: "32px 22px", textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
                  ✓ Nenhum lote com SLA em risco
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", gap: 0 }}>
                    <div style={{ flex: 1, padding: "16px 20px", borderRight: "0.5px solid hsl(var(--border))" }}>
                      <div style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>SLA vencido</div>
                      <div style={{ fontSize: 28, fontWeight: 600, color: "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{slaTotals.vencido}</div>
                      <Link to="/pagamentos?filter=sla_vencido" style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 8, fontSize: 11, color: "hsl(var(--destructive))", textDecoration: "none", fontWeight: 500 }}>
                        Ver lotes <ArrowRight size={11} />
                      </Link>
                    </div>
                    <div style={{ flex: 1, padding: "16px 20px" }}>
                      <div style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Em risco</div>
                      <div style={{ fontSize: 28, fontWeight: 600, color: "hsl(var(--warning))", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{slaTotals.preventivo}</div>
                    </div>
                  </div>
                  <div style={{ borderTop: "0.5px solid hsl(var(--border))", padding: "12px 20px" }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>Etapas mais atrasadas</div>
                    {Object.entries(slaTotals.perStatusVencido).slice(0, 3).map(([status, count]) => (
                      <div key={status} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: "hsl(var(--foreground))" }}>{PAYMENT_STATUS_SHORT[status as PaymentStatus] ?? status}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--destructive))" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SurfaceCard>
          </aside>
        </div>

        <section>
          <SectionLabel>Onde o processo mais trava</SectionLabel>
          <SurfaceCard>
            <SurfaceCardHeader title="Gargalos por etapa (tempo médio)" icon={Flame} iconColor="red" />
            {loading ? (
              <div style={{ padding: 22 }}>
                <Skeleton className="h-4 w-1/2 mb-3" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : (
              <BottlenecksList rows={bottlenecks} />
            )}
          </SurfaceCard>
        </section>

        {counts.mineDiretor > 0 && (
          <section>
            <SectionLabel>Aguardando sua aprovação</SectionLabel>
            <SurfaceCard>
              <SurfaceCardHeader
                title={`${counts.mineDiretor} lote${counts.mineDiretor > 1 ? "s" : ""} aguardando aprovação`}
                icon={ShieldCheck}
                iconColor="teal"
                rightAction={
                  <Link to="/pagamentos?status=aguardando_aprovacao" style={{ fontSize: 12, color: "hsl(var(--accent-foreground))", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Ver todos <ArrowRight size={13} />
                  </Link>
                }
              />
              {myPayments.length > 0 && (
                <div>
                  {myPayments.slice(0, 4).map((p) => {
                    const sla = slaForPayment({ id: p.id, status: p.status, created_at: p.created_at });
                    return (
                      <TaskRow key={p.id} p={p} mine profiles={profiles} timeMs={sla?.ms} slaLevel={sla?.level} qCount={openQuestionCount[p.id]} />
                    );
                  })}
                </div>
              )}
            </SurfaceCard>
          </section>
        )}
      </div>
    );
  }

  // ============================================================
  // VIEW: ANALISTA (default — JSX abaixo intacto)
  // ============================================================
  return (
    <div className="flex flex-col gap-4 md:gap-8">
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
      {/* ANOMALIAS DE STATUS (admin/diretor) */}
      {isDiretor && anomaliesOpen > 0 && (
        <Link
          to="/anomalias-status"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive-soft px-4 py-3 hover:bg-destructive/10 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span className="font-semibold">{anomaliesOpen}</span>
            anomalia{anomaliesOpen > 1 ? "s" : ""} de status pendente{anomaliesOpen > 1 ? "s" : ""} — clique para revisar.
          </div>
          <span className="text-xs text-destructive/80">Abrir →</span>
        </Link>
      )}

      {/* SUAS TAREFAS — Scorecard agrupado */}
      <section aria-labelledby="suas-tarefas-heading">
        <SectionLabel>Suas tarefas</SectionLabel>
        {loading ? (
          <div style={{
            background: 'hsl(var(--card))',
            border: '0.5px solid hsl(var(--border))',
            borderRadius: 10,
            display: 'flex',
            gap: 0,
            overflow: 'hidden',
          }}>
            {['Ações — sua vez', 'Em trânsito', 'Alertas'].map((g, gi) => (
              <div key={g} style={{
                flex: gi === 0 ? 2 : 1,
                borderRight: gi < 2 ? '0.5px solid hsl(var(--border))' : undefined,
                display: 'flex',
                flexDirection: 'column',
              }}>
                <div style={{
                  fontSize: 9, fontWeight: 600, color: 'hsl(var(--muted-foreground))',
                  letterSpacing: '0.07em', textTransform: 'uppercase',
                  padding: '8px 12px', background: 'hsl(var(--muted))',
                  borderBottom: '0.5px solid hsl(var(--border))',
                }}>{g}</div>
                <div style={{ display: 'flex' }}>
                  {Array.from({ length: gi === 0 ? 3 : gi === 1 ? 1 : 2 }).map((_, i) => (
                    <div key={i} style={{
                      flex: 1, padding: '10px 12px',
                      borderRight: i < (gi === 0 ? 2 : 0) ? '0.5px solid hsl(var(--border))' : undefined,
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      <Skeleton className="h-2.5 w-16" />
                      <Skeleton className="h-6 w-8" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          (() => {
            type ScoreItemData = {
              label: string;
              value: number;
              to: string;
              icon: LucideIcon;
              color: BubbleColor;
              accent?: 'amber' | 'rose';
            };

            const acaoItems: ScoreItemData[] = [];
            if (isAnalista && totalPendingQuestions > 0) acaoItems.push({
              label: 'Questionam. internos', value: totalPendingQuestions,
              to: `/pagamentos/${pendingQuestions[0]?.payment_id ?? ''}`,
              icon: MessageCircle, color: 'yellow',
            });
            if (isAnalista && companyInvoiceQuestions.count > 0) acaoItems.push({
              label: 'Pergunta empresa (NF)', value: companyInvoiceQuestions.count,
              to: companyInvoiceQuestions.firstPaymentId ? `/notas-fiscais?payment=${companyInvoiceQuestions.firstPaymentId}` : '/notas-fiscais',
              icon: MessageCircle, color: 'red',
            });
            if (isAnalista && totalPendingReleaseNf > 0) acaoItems.push({
              label: 'Liberar NF', value: totalPendingReleaseNf,
              to: `/pagamentos/${pendingReleaseNf[0]?.payment_id ?? ''}`,
              icon: CheckCircle2, color: 'teal',
            });
            if (isAnalista && pendingNfRecebida > 0) acaoItems.push({
              label: 'NF p/ conciliar', value: pendingNfRecebida,
              to: '/notas-fiscais', icon: FileCheck, color: 'green',
            });
            if (isAnalista && pendingNfConciliar > 0) acaoItems.push({
              label: 'Pronta p/ lançar', value: pendingNfConciliar,
              to: '/notas-fiscais', icon: CheckCircle2, color: 'green',
            });
            if (isAnalista && counts.mineAnalista > 0) acaoItems.push({
              label: 'Suas bases', value: counts.mineAnalista,
              to: '/pagamentos?owner=me&status=analista', icon: Landmark, color: 'purple',
            });
            if (isValidador && counts.mineValidador > 0) acaoItems.push({
              label: 'Para validar', value: counts.mineValidador,
              to: '/pagamentos?status=aguardando_validacao', icon: ListChecks, color: 'yellow',
            });
            if (isDiretor && counts.mineDiretor > 0) acaoItems.push({
              label: 'Para aprovar', value: counts.mineDiretor,
              to: '/pagamentos?status=aguardando_aprovacao', icon: ShieldCheck, color: 'teal',
            });

            const transitoItems: ScoreItemData[] = [];
            if (isAnalista && pendingNfAguardando > 0) transitoItems.push({
              label: 'NF aguard. retorno', value: pendingNfAguardando,
              to: '/notas-fiscais', icon: Send, color: 'blue',
            });
            if (isDiretor && counts.diretorAprovadoEmRevisao > 0) transitoItems.push({
              label: 'Pós-aprovação', value: counts.diretorAprovadoEmRevisao,
              to: '/pagamentos?status=aprovado_em_revisao', icon: FileText, color: 'blue',
            });

            const alertaItems: ScoreItemData[] = [];
            if (isAnalista) alertaItems.push({
              label: 'Ressalvas', value: counts.mineRessalvas,
              to: '/pagamentos?status=aprovado_com_ressalva', icon: AlertCircle, color: 'red', accent: 'amber',
            });
            if (isAnalista) alertaItems.push({
              label: 'NFs divergentes', value: counts.mineInvoicesDivergentes,
              to: '/notas-fiscais', icon: FileWarning, color: 'red', accent: 'rose',
            });

            const hasAcoes = acaoItems.length > 0;
            const hasTransito = transitoItems.length > 0;
            const hasAlertas = alertaItems.length > 0;

            if (!hasAcoes && !hasTransito && !hasAlertas) {
              return (
                <div style={{
                  background: 'hsl(var(--card))',
                  border: '0.5px solid hsl(var(--border))',
                  borderRadius: 10,
                  padding: '20px',
                  textAlign: 'center',
                  fontSize: 13,
                  color: 'hsl(var(--muted-foreground))',
                }}>
                  Nenhuma tarefa pendente. 🎉
                </div>
              );
            }

            const ScoreItem = ({ item, isHighlighted }: { item: ScoreItemData; isHighlighted: boolean }) => {
              const isZero = item.value === 0;
              const valueColor = isZero
                ? 'hsl(var(--muted-foreground))'
                : isHighlighted
                ? 'hsl(var(--sidebar-primary))'
                : 'hsl(var(--foreground))';
              return (
                <Link
                  to={item.to}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 4,
                    padding: '10px 14px', textDecoration: 'none', color: 'inherit',
                    background: isHighlighted && !isZero ? 'hsl(var(--accent))' : 'transparent',
                    transition: 'background 0.12s',
                    height: '100%',
                  }}
                  className="hover:bg-muted/50"
                >
                  <span style={{
                    fontSize: 9.5, fontWeight: 500,
                    color: 'hsl(var(--muted-foreground))',
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {item.label}
                  </span>
                  <span style={{
                    fontSize: 22, fontWeight: 600, lineHeight: 1,
                    color: valueColor,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {item.value}
                  </span>
                  {isHighlighted && !isZero && (
                    <span style={{ fontSize: 9, fontWeight: 500, color: 'hsl(var(--accent-foreground))' }}>
                      ↑ aguardando você
                    </span>
                  )}
                </Link>
              );
            };

            const ScoreGroup = ({ title, items, highlighted, flex, isLast }: {
              title: string;
              items: ScoreItemData[];
              highlighted: boolean;
              flex: number;
              isLast: boolean;
            }) => (
              <div style={{
                flex,
                display: 'flex',
                flexDirection: 'column',
                borderRight: isLast ? undefined : '0.5px solid hsl(var(--border))',
              }}>
                <div style={{
                  fontSize: 9, fontWeight: 600,
                  color: highlighted ? 'hsl(var(--accent-foreground))' : 'hsl(var(--muted-foreground))',
                  letterSpacing: '0.07em', textTransform: 'uppercase',
                  padding: '8px 14px',
                  background: highlighted ? 'hsl(var(--accent))' : 'hsl(var(--muted))',
                  borderBottom: '0.5px solid hsl(var(--border))',
                  textAlign: 'center' as const,
                }}>
                  {title}
                </div>
                <div style={{ display: 'flex', flex: 1 }}>
                  {items.map((item, i) => (
                    <div key={item.label} style={{
                      flex: 1,
                      borderRight: i < items.length - 1 ? '0.5px solid hsl(var(--border))' : undefined,
                    }}>
                      {highlighted ? (
                        <ScoreItem item={item} isHighlighted={highlighted} />
                      ) : (
                        <Link
                          to={item.to}
                          style={{
                            display: 'flex', flexDirection: 'column', gap: 4,
                            padding: '10px 14px', textDecoration: 'none', color: 'inherit',
                            transition: 'background 0.12s',
                            height: '100%',
                          }}
                          className="hover:bg-muted/50"
                        >
                          <span style={{
                            fontSize: 9.5, fontWeight: 500,
                            color: 'hsl(var(--muted-foreground))',
                            letterSpacing: '0.04em', textTransform: 'uppercase',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {item.label}
                          </span>
                          <span style={{
                            fontSize: 22, fontWeight: 600, lineHeight: 1,
                            fontVariantNumeric: 'tabular-nums',
                            color: item.value > 0
                              ? (item.accent === 'rose' ? 'hsl(var(--destructive))'
                                : item.accent === 'amber' ? 'hsl(var(--warning))'
                                : 'hsl(var(--foreground))')
                              : 'hsl(var(--muted-foreground))',
                          }}>
                            {item.value}
                          </span>
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );

            return (
              <div style={{
                background: 'hsl(var(--card))',
                border: '0.5px solid hsl(var(--border))',
                borderRadius: 10,
                display: 'flex',
                overflow: 'hidden',
              }}>
                {hasAcoes && (
                  <ScoreGroup
                    title="Ações — sua vez"
                    items={acaoItems}
                    highlighted={true}
                    flex={Math.max(acaoItems.length, 2)}
                    isLast={!hasTransito && !hasAlertas}
                  />
                )}
                {hasTransito && (
                  <ScoreGroup
                    title="Em trânsito"
                    items={transitoItems}
                    highlighted={false}
                    flex={Math.max(transitoItems.length, 1)}
                    isLast={!hasAlertas}
                  />
                )}
                {hasAlertas && (
                  <ScoreGroup
                    title="Alertas"
                    items={alertaItems}
                    highlighted={false}
                    flex={Math.max(alertaItems.length, 1)}
                    isLast={true}
                  />
                )}
              </div>
            );
          })()
        )}
      </section>

      {/* SLA EM RISCO — feed de ação imediata */}
      {!loading && slaAtRisk.length > 0 && (
        <section aria-labelledby="sla-risco-heading">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-block w-2 h-2 rounded-full animate-pulse"
              style={{ background: "hsl(var(--destructive))" }}
            />
            <h2
              id="sla-risco-heading"
              style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}
            >
              SLA em risco{" "}
              <span style={{ color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>
                · próximas 24h
              </span>
            </h2>
            <span
              style={{
                background: "hsl(var(--destructive-soft))",
                color: "hsl(var(--destructive))",
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 20,
              }}
            >
              {slaAtRisk.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {slaAtRisk.map((s) => {
              const isVencido = s.level === "vencido";
              const statusLabel = PAYMENT_STATUS_SHORT[s.status] ?? s.status;
              return (
                <Link
                  key={s.id}
                  to={`/pagamentos/${s.id}`}
                  className="flex items-center justify-between gap-3 hover-card-lift outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  style={{
                    background: isVencido ? "hsl(var(--destructive) / 0.04)" : "hsl(var(--card))",
                    border: isVencido
                      ? "1px solid hsl(var(--destructive) / 0.3)"
                      : "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    padding: "12px 14px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        background: isVencido ? "hsl(var(--destructive))" : "hsl(var(--muted))",
                        color: isVencido ? "hsl(var(--destructive-foreground))" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      <Timer size={16} />
                    </div>
                    <div className="min-w-0">
                      <p
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "hsl(var(--foreground))",
                          marginBottom: 2,
                        }}
                        className="truncate"
                      >
                        {s.reference ?? "Lote"} · {statusLabel}
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: isVencido ? "hsl(var(--destructive))" : "hsl(var(--warning-foreground))",
                        }}
                      >
                        {isVencido ? "Vencido há " : "Há "}{formatShortDuration(s.ms)}
                        {s.total_amount != null && ` · ${formatCurrency(Number(s.total_amount))}`}
                      </p>
                    </div>
                  </div>
                  <ArrowRight size={16} className="text-muted-foreground flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* GRID PRINCIPAL: 8 (tarefas) + 4 (atividade) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
        {/* TASK LIST — minhas (col-span-8) */}
        <section aria-labelledby="lista-tarefas-heading" className="lg:col-span-8">
          <SectionLabel>Pagamentos esperando você</SectionLabel>
          <SurfaceCard>
            <SurfaceCardHeader
              title="Suas tarefas pendentes"
              icon={FileText}
              iconColor="teal"
              countPill={myPending}
              rightAction={
                <Link
                  to="/pagamentos?owner=me"
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
                      qCount={openQuestionCount[p.id]}
                    />
                  );
                })}
              </div>
            )}
          </SurfaceCard>
        </section>

        {/* ATIVIDADE RECENTE — sidebar (col-span-4) */}
        <aside aria-labelledby="atividade-recente-heading" className="lg:col-span-4">
          <SectionLabel>Atividade recente</SectionLabel>
          <SurfaceCard style={{ padding: 20 }}>
            {recentActivity.length === 0 ? (
              <p
                style={{
                  fontSize: 12,
                  color: "hsl(var(--muted-foreground))",
                  textAlign: "center",
                  padding: "20px 0",
                }}
              >
                Sem atividade recente.
              </p>
            ) : (
              <div className="relative flex flex-col gap-5">
                <div
                  className="absolute top-2 bottom-2 w-px"
                  style={{ left: 11, background: "hsl(var(--border))" }}
                />
                {recentActivity.map((a) => {
                  const isDevol = a.status_to === "devolvido_analista";
                  const isApprov = a.status_to === "aprovado" || a.status_to === "aprovado_com_ressalva";
                  const isPaid = a.status_to === "pago" || a.status_to === "nf_conciliada";
                  const dotColor = isDevol
                    ? "hsl(var(--destructive))"
                    : isApprov
                    ? "hsl(var(--success))"
                    : isPaid
                    ? "hsl(var(--success))"
                    : "hsl(var(--info))";
                  const dotBg = isDevol
                    ? "hsl(var(--destructive) / 0.12)"
                    : isApprov || isPaid
                    ? "hsl(var(--success) / 0.12)"
                    : "hsl(var(--info) / 0.12)";
                  const statusLabel = a.status_to ? (PAYMENT_STATUS_SHORT[a.status_to] ?? a.status_to) : "—";
                  const elapsed = Date.now() - new Date(a.changed_at).getTime();
                  return (
                    <Link
                      key={a.id}
                      to={`/pagamentos/${a.payment_id}`}
                      className="relative pl-8 block hover:bg-muted/30 -mx-2 px-2 py-1 rounded-md transition-colors"
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <div
                        className="absolute top-1"
                        style={{
                          left: 0,
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: dotBg,
                          border: "4px solid hsl(var(--card))",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: dotColor,
                          }}
                        />
                      </div>
                      <p style={{ fontSize: 12, color: "hsl(var(--foreground))", lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 600 }}>{a.actor_name ?? "Sistema"}</span>{" "}
                        <span style={{ color: "hsl(var(--muted-foreground))" }}>→</span>{" "}
                        <span style={{ fontWeight: 500 }}>{statusLabel}</span>
                        {a.reference && (
                          <span style={{ color: "hsl(var(--muted-foreground))" }}> · {a.reference}</span>
                        )}
                      </p>
                      <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                        Há {formatShortDuration(elapsed)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link
              to="/auditoria"
              className="block w-full mt-5 py-2 text-center rounded-lg transition-colors hover:bg-muted/50"
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "hsl(var(--muted-foreground))",
                textTransform: "uppercase",
                border: "1px solid hsl(var(--border))",
                textDecoration: "none",
              }}
            >
              Ver histórico completo
            </Link>
          </SurfaceCard>
        </aside>
      </div>


      {/* TAREFAS EM ABERTO — equipe */}
      <section aria-labelledby="tarefas-equipe-heading">
        <SectionLabel>Tarefas em aberto (equipe)</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Pagamentos em andamento na equipe"
            icon={Users}
            iconColor="purple"
            countPill={teamOpenTotal}
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
          ) : teamOpenPayments.length === 0 ? (
            <div
              style={{
                padding: "40px 22px",
                textAlign: "center",
                fontSize: 13,
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Nenhum pagamento em andamento na equipe.
            </div>
          ) : (
            <div>
              {teamOpenPayments.map((p) => {
                const sla = slaForPayment({ id: p.id, status: p.status, created_at: p.created_at });
                return (
                  <TaskRow
                    key={p.id}
                    p={p}
                    mine={false}
                    profiles={profiles}
                    timeMs={sla?.ms}
                    slaLevel={sla?.level}
                    qCount={openQuestionCount[p.id]}
                  />
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </section>

      {/* ÚLTIMOS QUESTIONAMENTOS */}
      <RecentQuestionsPanel />

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
              <div className="pipeline-scroll">
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
              </div>
            );
          })()}
        </SurfaceCard>
      </section>

      {/* PROGRESSO POR LOTE */}
      <section aria-labelledby="progresso-lotes-heading">
        <SectionLabel>Progresso por lote</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Onde cada lote está no fluxo"
            icon={ListChecks}
            iconColor="purple"
            rightAction={
              <Link
                to="/pagamentos"
                style={{ fontSize: 12, color: "hsl(var(--accent-foreground))", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                Ver todos <ArrowRight size={13} />
              </Link>
            }
          />
          {loading ? (
            <div style={{ padding: 22 }}>
              <Skeleton className="h-4 w-2/3 mb-3" />
              <Skeleton className="h-4 w-1/2 mb-3" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : payments.length === 0 ? (
            <div style={{ padding: "40px 22px", textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
              Nenhum lote recente.
            </div>
          ) : (
            <div>
              {payments.slice(0, 8).map((p) => (
                <BatchProgressRow
                  key={p.id}
                  p={p}
                  qCount={openQuestionCount[p.id]}
                  groupStatuses={groupStatusesByPayment[p.id] ?? []}
                />
              ))}
            </div>
          )}
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
   BATCH PROGRESS — IA → Validação → Aprovação → Pago
   ================================================================ */

type BatchStage = "ia" | "validacao" | "aprovacao" | "pago";
const STAGE_LABELS: Record<BatchStage, string> = {
  ia: "IA",
  validacao: "Validação",
  aprovacao: "Aprovação",
  pago: "Pago",
};

interface StageState {
  state: "done" | "current" | "returned" | "todo" | "rejected";
}

const computeStages = (status: PaymentStatus): Record<BatchStage, StageState> => {
  const s: Record<BatchStage, StageState> = {
    ia: { state: "todo" }, validacao: { state: "todo" },
    aprovacao: { state: "todo" }, pago: { state: "todo" },
  };
  switch (status) {
    case "rascunho":
    case "em_analise_ia":
    case "revisao_analista":
      s.ia.state = "current"; break;
    case "devolvido_analista":
      s.ia.state = "returned"; s.validacao.state = "todo"; break;
    case "aguardando_validacao":
      s.ia.state = "done"; s.validacao.state = "current"; break;
    case "aguardando_aprovacao":
      s.ia.state = "done"; s.validacao.state = "done"; s.aprovacao.state = "current"; break;
    case "aprovado":
    case "aprovado_com_ressalva":
    case "pedido_nf_enviado":
    case "nf_recebida":
    case "nf_questionada":
    case "nf_conciliada":
    case "nf_divergente":
      s.ia.state = "done"; s.validacao.state = "done"; s.aprovacao.state = "done";
      s.pago.state = status === "nf_questionada" || status === "nf_divergente" ? "returned" : "current";
      break;
    case "pago":
      s.ia.state = "done"; s.validacao.state = "done"; s.aprovacao.state = "done"; s.pago.state = "done";
      break;
    case "rejeitado":
    case "cancelado":
      s.ia.state = "rejected"; break;
  }
  return s;
};

const stageIndexOfStatus = (s: PaymentStatus): number => {
  switch (s) {
    case "rascunho":
    case "em_analise_ia":
    case "revisao_analista":
    case "devolvido_analista":
      return 0;
    case "aguardando_validacao":
      return 1;
    case "aguardando_aprovacao":
    case "aprovado_em_revisao":
      return 2;
    case "aprovado":
    case "aprovado_com_ressalva":
    case "pedido_nf_enviado":
    case "nf_recebida":
    case "nf_questionada":
    case "nf_conciliada":
    case "nf_divergente":
    case "pago":
    case "lancado":
      return 3;
    default:
      return 0;
  }
};

const computeAggregatedStages = (
  groupStatuses: PaymentStatus[],
  fallback: PaymentStatus,
): Record<BatchStage, StageState> => {
  if (!groupStatuses.length) return computeStages(fallback);
  const order: BatchStage[] = ["ia", "validacao", "aprovacao", "pago"];
  const s: Record<BatchStage, StageState> = {
    ia: { state: "todo" }, validacao: { state: "todo" },
    aprovacao: { state: "todo" }, pago: { state: "todo" },
  };
  const idxs = groupStatuses.map(stageIndexOfStatus);
  const hasReturned = groupStatuses.some((g) => g === "devolvido_analista");
  for (let i = 0; i < order.length; i++) {
    const anyHere = idxs.some((x) => x === i);
    const anyPast = idxs.some((x) => x > i);
    const allPast = idxs.every((x) => x > i);
    if (anyHere) s[order[i]].state = "current";
    else if (allPast || anyPast) s[order[i]].state = "done";
  }
  if (hasReturned && s.ia.state !== "current") s.ia.state = "returned";
  return s;
};

const stageColor = (st: StageState["state"]): { bg: string; fg: string; border: string } => {
  switch (st) {
    case "done": return { bg: "hsl(var(--bubble-green-bg))", fg: "hsl(var(--bubble-green-fg))", border: "hsl(var(--bubble-green-fg) / 0.3)" };
    case "current": return { bg: "hsl(var(--primary))", fg: "hsl(var(--primary-foreground))", border: "hsl(var(--primary))" };
    case "returned": return { bg: "hsl(var(--destructive) / 0.12)", fg: "hsl(var(--destructive))", border: "hsl(var(--destructive) / 0.4)" };
    case "rejected": return { bg: "hsl(var(--destructive))", fg: "hsl(var(--destructive-foreground))", border: "hsl(var(--destructive))" };
    case "todo":
    default: return { bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))", border: "hsl(var(--border))" };
  }
};

const BatchProgressRow = ({ p, qCount = 0, groupStatuses = [] }: { p: PaymentRow; qCount?: number; groupStatuses?: PaymentStatus[] }) => {
  const risk = usePaymentRisk(p.id);
  const stages = computeAggregatedStages(groupStatuses, p.status);
  const order: BatchStage[] = ["ia", "validacao", "aprovacao", "pago"];
  return (
    <Link
      to={`/pagamentos/${p.id}`}
      className="task-row payment-task-row"
      style={{
        borderBottom: "1px solid hsl(var(--border-light, var(--border)))",
        textDecoration: "none", color: "inherit", transition: "background 0.15s ease",
      }}
    >
      <div className="ptr-header min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <p style={{ fontSize: 13, fontWeight: 500 }} className="truncate">{p.reference}</p>
          {risk && risk.score > 0 && (
            <RiskBadge 
              level={risk.level} 
              score={risk.score} 
              financialData={risk}
              showLabel={false}
              className="scale-90 shrink-0"
            />
          )}
          {qCount > 0 && (
            <span
              title={`${qCount} questionamento(s) aguardando resposta`}
              style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: "hsl(var(--warning-soft))",
                color: "hsl(var(--warning-foreground))",
                border: "1px solid hsl(var(--warning) / 0.4)",
                borderRadius: 20,
                padding: "2px 6px",
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={9} /> Questionamento
            </span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
          {p.items_count} itens · {formatCurrency(p.total_amount)}
        </p>
      </div>
      <div className="ptr-stages flex items-center" style={{ gap: 6, justifyContent: "center" }}>
        {order.map((stage, idx) => {
          const c = stageColor(stages[stage].state);
          const label = stages[stage].state === "returned" ? `${STAGE_LABELS[stage]} • devolvido` : STAGE_LABELS[stage];
          return (
            <div key={stage} className="flex items-center" style={{ gap: 6 }}>
              <span
                title={label}
                style={{
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                  background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
                  borderRadius: 999, padding: "4px 10px", lineHeight: 1, whiteSpace: "nowrap",
                }}
              >
                {STAGE_LABELS[stage]}
                {stages[stage].state === "returned" && " ↩"}
                {stages[stage].state === "current" && " •"}
              </span>
              {idx < order.length - 1 && (
                <span style={{ width: 14, height: 2, background: "hsl(var(--border))", borderRadius: 2 }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="ptr-status" style={{ flex: "0 0 auto" }}>
        <StatusBadge status={p.status} />
      </div>
    </Link>
  );
};


const TaskRow = ({
  p,
  mine,
  profiles,
  timeMs,
  slaLevel,
  qCount = 0,
}: {
  p: PaymentRow;
  mine: boolean;
  profiles: Record<string, string>;
  timeMs?: number;
  slaLevel?: SlaLevel;
  qCount?: number;
}) => {
  const risk = usePaymentRisk(p.id);
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
        <SafeCard className="p-0 border-none bg-transparent shadow-none space-y-3">
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
            {qCount > 0 && (
              <span
                title={`${qCount} questionamento(s) aguardando resposta`}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "hsl(var(--warning-soft))",
                  color: "hsl(var(--warning-foreground))",
                  border: "1px solid hsl(var(--warning) / 0.4)",
                  borderRadius: 20,
                  padding: "3px 8px",
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <AlertTriangle size={11} /> Questionamento ({qCount})
              </span>
            )}
            
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <p style={{ fontSize: 14, fontWeight: 500, color: "hsl(var(--foreground))" }} className="truncate">
                  {p.reference}
                </p>
                {risk && risk.score > 0 && (
                  <RiskBadge 
                    level={risk.level} 
                    score={risk.score} 
                    financialData={risk}
                    showLabel={false}
                    className="scale-90 shrink-0"
                  />
                )}
              </div>
            </div>

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
          <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            <span className="capitalize">
              {formatCompetence(p.competence_months?.length ? p.competence_months : p.competence_month)}
            </span>
            {" · "}{p.items_count} itens
            {" · "}<span className="font-semibold text-foreground whitespace-nowrap">{formatCurrency(p.total_amount)}</span>
            {creator && <> · criado por <span style={{ color: "hsl(var(--foreground))" }}>{creator}</span></>}
            {p.payment_type && <> · <span className="capitalize">{p.payment_type}</span></>}
            {" · "}{formatDate(p.created_at)}
          </p>
        </SafeCard>
      </div>
      <StatusBadge status={p.status} className="shrink-0" />
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
      className="pipeline-col min-w-0"
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
        letterSpacing: "0.05em",
        color: "hsl(var(--muted-foreground))",
        textAlign: "center",
        lineHeight: 1.2,
        whiteSpace: "nowrap",
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
          border: "hsl(var(--warning) / 0.45)",
          bg: "hsl(var(--warning) / 0.08)",
          icon: "hsl(var(--warning))",
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
