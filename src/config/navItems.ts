import {
  Activity,
  LayoutDashboard,
  Wallet,
  Receipt,
  BarChart2,
  BarChart3,
  ShieldCheck,
  Table,
  Building2,
  Network,
  Users,
  History,
  Settings,
  Timer,
  BadgeDollarSign,
  Stethoscope,
  AlertTriangle,
  FlaskConical,
  Layers,
  TrendingDown,
  TrendingUp,
  ShieldX,
  FileWarning,
  FileBarChart,
  MessageSquare,
  Tag,
  Split,
  BrainCircuit,
  ClipboardList,
  SlidersHorizontal,
  Rocket,
  Flag,
  Megaphone,
  Info,
  BookOpen,
  HeadsetIcon,
  ListChecksIcon,
  ChatsIcon,
} from "@/config/icons/navIcons";

export type Role = "analista" | "validador" | "diretor" | "admin";

export type NavLeaf = {
  to: string;
  label: string;
  /** Lucide icon name — kept as a string-identifiable component for auditing. */
  icon: typeof LayoutDashboard;
  iconName: string;
  roles: readonly Role[];
};

export type NavGroup = {
  label: string;
  icon: typeof LayoutDashboard;
  iconName: string;
  roles: readonly Role[];
  children: NavLeaf[];
};

export type NavItem = NavLeaf | NavGroup;

export const ALL_ROLES = ["analista", "validador", "diretor", "admin"] as const;

/**
 * SINGLE SOURCE OF TRUTH for app navigation.
 * Read by both the topbar (with grouping) and the sidebar (flattened).
 *
 * The flattened order MUST match `EXPECTED_SIDEBAR_ORDER` below — enforced by
 * `scripts/audit-nav.ts` (run via `bun run audit:nav`).
 *
 * NOTE: "Apelidos aprendidos" (/empresas/apelidos) é uma rota acessível
 * via página de Empresas, mas NÃO aparece no menu (decisão de UX).
 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, iconName: "LayoutDashboard", roles: ALL_ROLES },
  {
    label: "Financeiro",
    icon: Wallet,
    iconName: "Wallet",
    roles: ALL_ROLES,
    children: [
      { to: "/pagamentos", label: "Pagamentos", icon: Wallet, iconName: "Wallet", roles: ALL_ROLES },
      { to: "/notas-fiscais", label: "Pedidos de NF", icon: Receipt, iconName: "Receipt", roles: ALL_ROLES },
      { to: "/ciclo-nf", label: "Ciclo de NF", icon: FileWarning, iconName: "FileWarning", roles: ALL_ROLES },
      { to: "/glosas", label: "Glosas e Conciliação", icon: ShieldX, iconName: "ShieldX", roles: ["diretor", "admin", "analista", "validador"] as const },
      { to: "/sistema/journal", label: "Livro Contábil", icon: BookOpen, iconName: "BookOpen", roles: ["admin", "diretor"] },
    ],
  },
  {
    label: "Atendimento",
    icon: HeadsetIcon,
    iconName: "HeadsetIcon",
    roles: ALL_ROLES,
    children: [
      { to: "/pendencias", label: "Pendências", icon: ListChecksIcon, iconName: "ListChecksIcon", roles: ALL_ROLES },
      { to: "/conversas", label: "Conversas", icon: ChatsIcon, iconName: "ChatsIcon", roles: ALL_ROLES },
      { to: "/comunicacao/supervisao", label: "Supervisão de Atendimento", icon: ShieldCheck, iconName: "ShieldCheck", roles: ["admin", "diretor"] as const },
    ],
  },
  {
    label: "Relatórios",
    icon: FileBarChart,
    iconName: "FileBarChart",
    roles: ALL_ROLES,
    children: [
      { to: "/kpis", label: "KPIs", icon: BarChart2, iconName: "BarChart2", roles: ALL_ROLES },
      { to: "/saude-processo", label: "Saúde do Processo", icon: Activity, iconName: "Activity", roles: ["diretor", "admin"] as const },
      { to: "/recebiveis", label: "Contas a Pagar", icon: TrendingDown, iconName: "TrendingDown", roles: ["diretor", "admin", "analista", "validador"] as const },
      { to: "/inteligencia-financeira", label: "Inteligência Financeira", icon: TrendingUp, iconName: "TrendingUp", roles: ALL_ROLES },
    ],
  },
  {
    label: "Configurações",
    icon: SlidersHorizontal,
    iconName: "SlidersHorizontal",
    roles: ALL_ROLES,
    children: [
      { to: "/regras/pagamento", label: "Regras de Pagamento", icon: BadgeDollarSign, iconName: "BadgeDollarSign", roles: ["admin"] },
      { to: "/regras/validacao", label: "Regras de Validação", icon: ShieldCheck, iconName: "ShieldCheck", roles: ["admin"] },
      { to: "/regras/simulador", label: "Simulador de Regras", icon: FlaskConical, iconName: "FlaskConical", roles: ["admin"] },
      { to: "/tabelas", label: "Tabelas de referência", icon: Table, iconName: "Table", roles: ["admin"] },
      { to: "/empresas", label: "Empresas", icon: Building2, iconName: "Building2", roles: ["admin"] },
      { to: "/medicos", label: "Médicos", icon: Stethoscope, iconName: "Stethoscope", roles: ["admin"] },
      { to: "/centros-de-custo", label: "Setores e Centros de Custos", icon: Network, iconName: "Network", roles: ALL_ROLES },
      { to: "/convenios", label: "Convênios", icon: ShieldCheck, iconName: "ShieldCheck", roles: ["admin", "diretor"] },
      { to: "/tipos-pagamento", label: "Tipos de pagamento", icon: Tag, iconName: "Tag", roles: ["admin", "diretor"] },
      { to: "/pools", label: "Pools de rateio", icon: Split, iconName: "Split", roles: ["admin", "diretor"] },
      { to: "/prazos-sla", label: "Prazos e SLA", icon: Timer, iconName: "Timer", roles: ["admin"] },
    ],
  },
  {
    label: "Administração",
    icon: Settings,
    iconName: "Settings",
    roles: ALL_ROLES,
    children: [
      { to: "/usuarios", label: "Usuários", icon: Users, iconName: "Users", roles: ["admin"] },
      { to: "/portal-usuarios", label: "Acessos dos Portais", icon: Building2, iconName: "Building2", roles: ["admin"] },
      { to: "/portal-saude", label: "Saúde dos Portais", icon: Activity, iconName: "Activity", roles: ["admin"] },
      { to: "/saude", label: "Saúde do Motor", icon: Activity, iconName: "Activity", roles: ["diretor", "admin"] as const },
      { to: "/auditoria", label: "Auditoria", icon: History, iconName: "History", roles: ["diretor", "admin", "validador"] },
      { to: "/auditoria/hospitais", label: "Trocas de Hospital", icon: ShieldCheck, iconName: "ShieldCheck", roles: ["admin", "diretor"] },
      { to: "/anomalias-status", label: "Anomalias de status", icon: AlertTriangle, iconName: "AlertTriangle", roles: ["diretor", "admin", "validador"] },
      { to: "/insights-observacoes", label: "Insights de Observações", icon: MessageSquare, iconName: "MessageSquare", roles: ["diretor", "admin", "validador"] },
      { to: "/sistema/versoes", label: "Versões e Releases", icon: Rocket, iconName: "Rocket", roles: ["admin", "diretor"] },
      { to: "/sistema/feature-flags", label: "Feature Flags", icon: Flag, iconName: "Flag", roles: ["admin", "diretor"] },
      { to: "/sistema/avisos", label: "Avisos do Sistema", icon: Megaphone, iconName: "Megaphone", roles: ["admin", "diretor"] },
      { to: "/sistema/integracoes", label: "Integrações de Comunicação", icon: MessageSquare, iconName: "MessageSquare", roles: ["admin", "diretor"] },
      { to: "/sobre", label: "Sobre o Exacta", icon: Info, iconName: "Info", roles: ALL_ROLES },
    ],
  },
];

/**
 * Fixed flat order the sidebar MUST render. Both the label and the icon
 * (lucide name) are validated by the auditor.
 */
export const EXPECTED_SIDEBAR_ORDER: ReadonlyArray<{ label: string; iconName: string }> = [
  { label: "Dashboard", iconName: "LayoutDashboard" },
  { label: "Pagamentos", iconName: "Wallet" },
  { label: "Pedidos de NF", iconName: "Receipt" },
  { label: "Ciclo de NF", iconName: "FileWarning" },
  { label: "Glosas e Conciliação", iconName: "ShieldX" },
  { label: "Livro Contábil", iconName: "BookOpen" },
  { label: "Pendências", iconName: "ListChecksIcon" },
  { label: "Conversas", iconName: "ChatsIcon" },
  { label: "Supervisão de Atendimento", iconName: "ShieldCheck" },
  { label: "KPIs", iconName: "BarChart2" },
  { label: "Executivo", iconName: "BarChart3" },
  { label: "Saúde do Processo", iconName: "Activity" },
  { label: "Contas a Pagar", iconName: "TrendingDown" },
  { label: "Inteligência Financeira", iconName: "TrendingUp" },
  { label: "Regras de Pagamento", iconName: "BadgeDollarSign" },
  { label: "Regras de Validação", iconName: "ShieldCheck" },
  { label: "Simulador de Regras", iconName: "FlaskConical" },
  { label: "Tabelas de referência", iconName: "Table" },
  { label: "Empresas", iconName: "Building2" },
  { label: "Médicos", iconName: "Stethoscope" },
  { label: "Setores e Centros de Custos", iconName: "Network" },
  { label: "Convênios", iconName: "ShieldCheck" },
  { label: "Tipos de pagamento", iconName: "Tag" },
  { label: "Pools de rateio", iconName: "Split" },
  { label: "Prazos e SLA", iconName: "Timer" },
  { label: "Usuários", iconName: "Users" },
  { label: "Acessos dos Portais", iconName: "Building2" },
  { label: "Saúde dos Portais", iconName: "Activity" },
  { label: "Saúde do Motor", iconName: "Activity" },
  { label: "Auditoria", iconName: "History" },
  { label: "Trocas de Hospital", iconName: "ShieldCheck" },
  { label: "Anomalias de status", iconName: "AlertTriangle" },
  { label: "Insights de Observações", iconName: "MessageSquare" },
  { label: "Versões e Releases", iconName: "Rocket" },
  { label: "Feature Flags", iconName: "Flag" },
  { label: "Avisos do Sistema", iconName: "Megaphone" },
  { label: "Integrações de Comunicação", iconName: "MessageSquare" },
  { label: "Sobre o Exacta", iconName: "Info" },
];


export const isGroup = (n: NavItem): n is NavGroup => "children" in n;

/** Flatten groups into a single list for sidebar mode. */
export function flattenNav(items: NavItem[]): NavLeaf[] {
  const out: NavLeaf[] = [];
  for (const it of items) {
    if (isGroup(it)) out.push(...it.children);
    else out.push(it);
  }
  return out;
}

/** Filter visible items by user roles, recursively for groups. */
export function filterNav(items: NavItem[], roles: string[]): NavItem[] {
  return items
    .map((it) => {
      if (isGroup(it)) {
        const kids = it.children.filter((c) => c.roles.some((r) => roles.includes(r)));
        if (kids.length === 0) return null;
        return { ...it, children: kids };
      }
      return it.roles.some((r) => roles.includes(r)) ? it : null;
    })
    .filter(Boolean) as NavItem[];
}
