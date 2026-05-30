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
  { to: "/perfil", label: "Meu Perfil", icon: Settings, iconName: "Settings", roles: ALL_ROLES },
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
    ],
  },
  {
    label: "Relatórios",
    icon: FileBarChart,
    iconName: "FileBarChart",
    roles: ALL_ROLES,
    children: [
      { to: "/kpis", label: "KPIs", icon: BarChart2, iconName: "BarChart2", roles: ALL_ROLES },
      { to: "/executivo", label: "Executivo", icon: BarChart3, iconName: "BarChart3", roles: ["diretor", "admin"] as const },
      { to: "/relatorios/dre", label: "DRE & Posição em Aberto", icon: TrendingUp, iconName: "TrendingUp", roles: ["diretor", "admin", "analista", "validador"] as const },
      { to: "/relatorios/saude-dinheiro", label: "Saúde do Dinheiro", icon: Activity, iconName: "Activity", roles: ["diretor", "admin", "analista", "validador"] as const },
      { to: "/relatorios/observabilidade", label: "Observabilidade de Negócio", icon: BrainCircuit, iconName: "BrainCircuit", roles: ["diretor", "admin"] as const },
      { to: "/recebiveis", label: "Recebíveis", icon: TrendingDown, iconName: "TrendingDown", roles: ["diretor", "admin", "analista", "validador"] as const },
      { to: "/inteligencia-financeira", label: "Inteligência Financeira", icon: TrendingUp, iconName: "TrendingUp", roles: ALL_ROLES },
    ],
  },
  {
    label: "Inteligência de Regras",
    icon: BrainCircuit,
    iconName: "BrainCircuit",
    roles: ["admin"],
    children: [
      { to: "/regras/pagamento", label: "Regras de Pagamento", icon: BadgeDollarSign, iconName: "BadgeDollarSign", roles: ["admin"] },
      { to: "/regras/validacao", label: "Regras de Validação", icon: ShieldCheck, iconName: "ShieldCheck", roles: ["admin"] },
      { to: "/regras/simulador", label: "Simulador de Regras", icon: FlaskConical, iconName: "FlaskConical", roles: ["admin"] },
      { to: "/tabelas", label: "Tabelas de referência", icon: Table, iconName: "Table", roles: ["admin"] },
    ],
  },
  {
    label: "Cadastros",
    icon: ClipboardList,
    iconName: "ClipboardList",
    roles: ["admin", "diretor"],
    children: [
      { to: "/empresas", label: "Empresas", icon: Building2, iconName: "Building2", roles: ["admin"] },
      { to: "/medicos", label: "Médicos", icon: Stethoscope, iconName: "Stethoscope", roles: ["admin"] },
      { to: "/mapa-especialidades", label: "Mapa Especialidades", icon: Stethoscope, iconName: "Stethoscope", roles: ["admin"] },
      { to: "/centros-de-custo", label: "Setores e Centros de Custos", icon: Network, iconName: "Network", roles: ALL_ROLES },
      { to: "/convenios", label: "Convênios", icon: ShieldCheck, iconName: "ShieldCheck", roles: ["admin", "diretor"] },
      { to: "/tipos-pagamento", label: "Tipos de pagamento", icon: Tag, iconName: "Tag", roles: ["admin", "diretor"] },
    ],
  },
  {
    label: "Parametrização",
    icon: SlidersHorizontal,
    iconName: "SlidersHorizontal",
    roles: ["admin", "diretor"],
    children: [
      { to: "/pools", label: "Pools de rateio", icon: Split, iconName: "Split", roles: ["admin", "diretor"] },
      { to: "/pools/relatorios", label: "Relatório de pools", icon: Split, iconName: "Split", roles: ["admin", "diretor"] },
      { to: "/prazos-sla", label: "Prazos e SLA", icon: Timer, iconName: "Timer", roles: ["admin"] },
    ],
  },
  {
    label: "Acesso",
    icon: Users,
    iconName: "Users",
    roles: ["diretor", "admin", "validador"],
    children: [
      { to: "/usuarios", label: "Usuários", icon: Users, iconName: "Users", roles: ["admin"] },
      { to: "/produtividade-analistas", label: "Produtividade da Equipe", icon: BarChart2, iconName: "BarChart2", roles: ["diretor", "admin", "validador"] },
      { to: "/saude", label: "Saúde do Motor", icon: Activity, iconName: "Activity", roles: ["diretor", "admin"] as const },
      { to: "/auditoria", label: "Auditoria", icon: History, iconName: "History", roles: ["diretor", "admin", "validador"] },
      { to: "/anomalias-status", label: "Anomalias de status", icon: AlertTriangle, iconName: "AlertTriangle", roles: ["diretor", "admin", "validador"] },
      { to: "/insights-observacoes", label: "Insights de Observações", icon: MessageSquare, iconName: "MessageSquare", roles: ["diretor", "admin", "validador"] },
    ],
  },
  {
    label: "Sistema",
    icon: Settings,
    iconName: "Settings",
    roles: ["admin", "diretor"],
    children: [
      { to: "/sistema/versoes", label: "Versões e Releases", icon: Rocket, iconName: "Rocket", roles: ["admin", "diretor"] },
      { to: "/sistema/feature-flags", label: "Feature Flags", icon: Flag, iconName: "Flag", roles: ["admin", "diretor"] },
      { to: "/sistema/avisos", label: "Avisos do Sistema", icon: Megaphone, iconName: "Megaphone", roles: ["admin", "diretor"] },
      { to: "/sistema/journal", label: "Livro Contábil", icon: BookOpen, iconName: "BookOpen", roles: ["admin", "diretor"] },
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
  { label: "Meu Perfil", iconName: "Settings" },
  { label: "Pagamentos", iconName: "Wallet" },
  { label: "Pedidos de NF", iconName: "Receipt" },
  { label: "Ciclo de NF", iconName: "FileWarning" },
  { label: "Glosas e Conciliação", iconName: "ShieldX" },
  { label: "Pendências", iconName: "ListChecksIcon" },
  { label: "Conversas", iconName: "ChatsIcon" },
  { label: "KPIs", iconName: "BarChart2" },
  { label: "Executivo", iconName: "BarChart3" },
  { label: "DRE & Posição em Aberto", iconName: "TrendingUp" },
  { label: "Saúde do Dinheiro", iconName: "Activity" },
  { label: "Observabilidade de Negócio", iconName: "BrainCircuit" },
  { label: "Recebíveis", iconName: "TrendingDown" },
  { label: "Inteligência Financeira", iconName: "TrendingUp" },
  { label: "Regras de Pagamento", iconName: "BadgeDollarSign" },
  { label: "Regras de Validação", iconName: "ShieldCheck" },
  { label: "Simulador de Regras", iconName: "FlaskConical" },
  { label: "Tabelas de referência", iconName: "Table" },
  { label: "Empresas", iconName: "Building2" },
  { label: "Médicos", iconName: "Stethoscope" },
  { label: "Mapa Especialidades", iconName: "Stethoscope" },
  { label: "Setores e Centros de Custos", iconName: "Network" },
  { label: "Tipos de pagamento", iconName: "Tag" },
  { label: "Pools de rateio", iconName: "Split" },
  { label: "Relatório de pools", iconName: "Split" },
  { label: "Prazos e SLA", iconName: "Timer" },
  { label: "Usuários", iconName: "Users" },
  { label: "Produtividade da Equipe", iconName: "BarChart2" },
  { label: "Saúde do Motor", iconName: "Activity" },
  { label: "Auditoria", iconName: "History" },
  { label: "Anomalias de status", iconName: "AlertTriangle" },
  { label: "Insights de Observações", iconName: "MessageSquare" },
  { label: "Versões e Releases", iconName: "Rocket" },
  { label: "Feature Flags", iconName: "Flag" },
  { label: "Avisos do Sistema", iconName: "Megaphone" },
  { label: "Livro Contábil", iconName: "BookOpen" },
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
