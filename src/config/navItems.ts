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
  Scale,
  Pencil,
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
  FolderKanban,
  GitCompare,
  HeadsetIcon,
  ListChecksIcon,
  ChatsIcon,
  Handshake,
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
      { to: "/notas-fiscais", label: "Notas Fiscais", icon: Receipt, iconName: "Receipt", roles: ALL_ROLES },
      { to: "/glosas", label: "Glosas", icon: ShieldX, iconName: "ShieldX", roles: ["diretor", "admin", "analista", "validador"] as const },
      { to: "/financeiro/conciliacao", label: "Conciliação", icon: GitCompare, iconName: "GitCompare", roles: ["diretor", "admin", "analista", "validador"] as const },
      { to: "/financeiro/creditos-debitos", label: "Créditos e Débitos", icon: Scale, iconName: "Scale", roles: ["admin", "diretor", "analista"] as const },
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
      { to: "/casos-especiais", label: "Casos Especiais", icon: ShieldCheck, iconName: "ShieldCheck", roles: ["admin", "diretor", "analista", "validador"] as const },
      { to: "/conversas", label: "Conversas", icon: ChatsIcon, iconName: "ChatsIcon", roles: ALL_ROLES },
      { to: "/comunicacao", label: "Comunicação", icon: Megaphone, iconName: "Megaphone", roles: ["admin", "diretor", "analista", "validador"] as const },
    ],
  },
  {
    label: "Relacionamento",
    icon: Handshake,
    iconName: "Handshake",
    roles: ALL_ROLES,
    children: [
      { to: "/relacionamento", label: "Simulador de Margem", icon: TrendingUp, iconName: "TrendingUp", roles: ALL_ROLES },
    ],
  },
  {
    label: "Relatórios",
    icon: FileBarChart,
    iconName: "FileBarChart",
    roles: ALL_ROLES,
    children: [
      { to: "/relatorios/central", label: "Central de Relatórios", icon: FileBarChart, iconName: "FileBarChart", roles: ALL_ROLES },
      { to: "/bi/diretoria", label: "BI · Diretoria", icon: BarChart3, iconName: "BarChart3", roles: ALL_ROLES },
      { to: "/bi/pagamentos", label: "BI · Pagamentos", icon: Wallet, iconName: "Wallet", roles: ALL_ROLES },
      { to: "/kpis", label: "KPIs", icon: BarChart2, iconName: "BarChart2", roles: ALL_ROLES },
      { to: "/relatorios/intervencoes", label: "Ajustes por intervenção", icon: Scale, iconName: "Scale", roles: ["diretor", "admin", "validador", "analista"] as const },
      { to: "/auditoria/sobreposicao-assistencial", label: "Sobreposição assistencial", icon: AlertTriangle, iconName: "AlertTriangle", roles: ["diretor", "admin", "validador", "analista"] as const },
      { to: "/saude?tab=processo", label: "Saúde do Processo", icon: Activity, iconName: "Activity", roles: ["diretor", "admin"] as const },
      { to: "/recebiveis", label: "Contas a Pagar", icon: TrendingDown, iconName: "TrendingDown", roles: ["diretor", "admin", "analista", "validador"] as const },
      { to: "/inteligencia-financeira", label: "Inteligência Financeira", icon: TrendingUp, iconName: "TrendingUp", roles: ALL_ROLES },
      { to: "/aprendizado/padroes", label: "Aprendizado de padrões", icon: BrainCircuit, iconName: "BrainCircuit", roles: ["diretor", "admin", "analista"] as const },
    ],
  },
  {
    label: "Configurações",
    icon: SlidersHorizontal,
    iconName: "SlidersHorizontal",
    roles: ALL_ROLES,
    children: [
      { to: "/regras", label: "Regras (Pagamento, Validação, Simuladores)", icon: BadgeDollarSign, iconName: "BadgeDollarSign", roles: ["admin"] },
      { to: "/tabelas", label: "Tabelas de referência", icon: Table, iconName: "Table", roles: ["admin"] },
      { to: "/cadastros", label: "Cadastros", icon: FolderKanban, iconName: "FolderKanban", roles: ["admin", "diretor"] },
      { to: "/configuracoes/tabela-tuss", label: "Tabela TUSS", icon: BookOpen, iconName: "BookOpen", roles: ["admin", "diretor"] },
      { to: "/configuracoes/motivos-intervencao", label: "Motivos de intervenção", icon: ClipboardList, iconName: "ClipboardList", roles: ["admin", "diretor"] },
      { to: "/padroes-lote", label: "Padrões de Lote", icon: FolderKanban, iconName: "FolderKanban", roles: ["admin", "diretor", "analista"] },
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
      { to: "/saude", label: "Saúde (Motor, Portais, Processo)", icon: Activity, iconName: "Activity", roles: ["diretor", "admin"] as const },
      { to: "/auditoria", label: "Auditoria", icon: History, iconName: "History", roles: ["diretor", "admin", "validador"] },
      { to: "/sistema", label: "Sistema (Versões, Flags, Parâmetros)", icon: Rocket, iconName: "Rocket", roles: ["admin", "diretor"] },
      
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
  { label: "Notas Fiscais", iconName: "Receipt" },
  { label: "Glosas", iconName: "ShieldX" },
  { label: "Conciliação", iconName: "GitCompare" },
  { label: "Créditos e Débitos", iconName: "Scale" },
  { label: "Livro Contábil", iconName: "BookOpen" },
  { label: "Pendências", iconName: "ListChecksIcon" },
  { label: "Casos Especiais", iconName: "ShieldCheck" },
  { label: "Conversas", iconName: "ChatsIcon" },
  { label: "Comunicação", iconName: "Megaphone" },
  { label: "Simulador de Margem", iconName: "TrendingUp" },
  { label: "Central de Relatórios", iconName: "FileBarChart" },
  { label: "BI · Diretoria", iconName: "BarChart3" },
  { label: "BI · Pagamentos", iconName: "Wallet" },
  { label: "KPIs", iconName: "BarChart2" },
  { label: "Ajustes por intervenção", iconName: "Scale" },
  { label: "Sobreposição assistencial", iconName: "AlertTriangle" },
  { label: "Saúde do Processo", iconName: "Activity" },
  { label: "Contas a Pagar", iconName: "TrendingDown" },
  { label: "Inteligência Financeira", iconName: "TrendingUp" },
  { label: "Aprendizado de padrões", iconName: "BrainCircuit" },
  { label: "Regras (Pagamento, Validação, Simuladores)", iconName: "BadgeDollarSign" },
  { label: "Tabelas de referência", iconName: "Table" },
  { label: "Cadastros", iconName: "FolderKanban" },
  { label: "Tabela TUSS", iconName: "BookOpen" },
  { label: "Motivos de intervenção", iconName: "ClipboardList" },
  { label: "Padrões de Lote", iconName: "FolderKanban" },
  { label: "Hospitais", iconName: "Building2" },
  { label: "Pools de rateio", iconName: "Split" },
  { label: "Prazos e SLA", iconName: "Timer" },
  { label: "Piso de repasse", iconName: "ShieldCheck" },
  { label: "Usuários", iconName: "Users" },
  { label: "Acessos dos Portais", iconName: "Building2" },
  { label: "Saúde (Motor, Portais, Processo)", iconName: "Activity" },
  { label: "Auditoria", iconName: "History" },
  { label: "Sistema (Versões, Flags, Parâmetros)", iconName: "Rocket" },
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
