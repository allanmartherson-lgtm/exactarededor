import {
  LayoutDashboard,
  Wallet,
  Receipt,
  BarChart2,
  ShieldCheck,
  Table,
  Building2,
  Network,
  Users,
  History,
  ScrollText,
  
  Timer,
  BadgeDollarSign,
  Stethoscope,
} from "lucide-react";

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
      { to: "/kpis", label: "KPIs", icon: BarChart2, iconName: "BarChart2", roles: ALL_ROLES },
    ],
  },
  {
    label: "Configurações",
    icon: ScrollText,
    iconName: "ScrollText",
    roles: ["diretor", "admin"],
    children: [
      { to: "/regras/pagamento", label: "Regras de Pagamento", icon: BadgeDollarSign, iconName: "BadgeDollarSign", roles: ["diretor", "admin"] },
      { to: "/regras/validacao", label: "Regras de Validação", icon: ShieldCheck, iconName: "ShieldCheck", roles: ["diretor", "admin"] },
      { to: "/tabelas", label: "Tabelas de referência", icon: Table, iconName: "Table", roles: ["diretor", "admin"] },
      { to: "/empresas", label: "Empresas", icon: Building2, iconName: "Building2", roles: ["diretor", "admin"] },
      { to: "/empresas/apelidos", label: "Apelidos aprendidos", icon: Sparkles, iconName: "Sparkles", roles: ["diretor", "admin"] },
      { to: "/medicos", label: "Médicos", icon: Stethoscope, iconName: "Stethoscope", roles: ["diretor", "admin"] },
      { to: "/mapa-especialidades", label: "Mapa Especialidades", icon: Stethoscope, iconName: "Stethoscope", roles: ["diretor", "admin"] },
      { to: "/centros-de-custo", label: "Centros de custo", icon: Network, iconName: "Network", roles: ALL_ROLES },
      { to: "/prazos-sla", label: "Prazos e SLA", icon: Timer, iconName: "Timer", roles: ["diretor", "admin"] },
    ],
  },
  {
    label: "Acesso",
    icon: Users,
    iconName: "Users",
    roles: ["diretor", "admin"],
    children: [
      { to: "/usuarios", label: "Usuários", icon: Users, iconName: "Users", roles: ["admin"] },
      { to: "/auditoria", label: "Auditoria", icon: History, iconName: "History", roles: ["diretor", "admin"] },
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
  { label: "KPIs", iconName: "BarChart2" },
  { label: "Regras de Pagamento", iconName: "BadgeDollarSign" },
  { label: "Regras de Validação", iconName: "ShieldCheck" },
  { label: "Tabelas de referência", iconName: "Table" },
  { label: "Empresas", iconName: "Building2" },
  { label: "Médicos", iconName: "Stethoscope" },
  { label: "Mapa Especialidades", iconName: "Stethoscope" },
  { label: "Centros de custo", iconName: "Network" },
  { label: "Prazos e SLA", iconName: "Timer" },
  { label: "Usuários", iconName: "Users" },
  { label: "Auditoria", iconName: "History" },
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