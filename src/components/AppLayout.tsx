import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/status";
import {
  LayoutDashboard,
  ShieldCheck,
  Sun,
  Moon,
  Plus,
  LogOut,
  PanelLeft,
  PanelTop,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { useNavLayout } from "@/contexts/NavLayoutContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { NAV_ITEMS, isGroup, flattenNav, filterNav, type NavItem } from "@/config/navItems";
import { useQueueNotifications } from "@/hooks/useQueueNotifications";

// Re-export for backward compatibility with existing importers (tests, diagnostic page).
export { NAV_ITEMS, isGroup, flattenNav, filterNav, ALL_ROLES } from "@/config/navItems";
export type { Role, NavLeaf, NavGroup, NavItem } from "@/config/navItems";

function getInitials(email?: string | null) {
  if (!email) return "AA";
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const Logo = () => (
  <NavLink
    to="/"
    className="flex items-center gap-2.5 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
  >
    <div
      className="flex items-center justify-center flex-shrink-0 bg-primary"
      style={{ width: 30, height: 30, borderRadius: 8 }}
    >
      <ShieldCheck className="h-4 w-4 text-primary-foreground" />
    </div>
    <div className="min-w-0 leading-tight">
      <p className="font-bold text-[13px] text-foreground leading-none">MedPay</p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5 leading-none">
        Approval Flow
      </p>
    </div>
  </NavLink>
);

const LayoutToggle = () => {
  const { layout, toggleLayout } = useNavLayout();
  const NextIcon = layout === "top" ? PanelLeft : PanelTop;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleLayout}
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          aria-label="Alternar layout"
        >
          <NextIcon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Alternar layout</TooltipContent>
    </Tooltip>
  );
};

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-9 w-9 text-muted-foreground hover:text-foreground"
      aria-label={theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
};

/* ============================================================
 * Topbar nav (with dropdown groups). Only one dropdown open at
 * a time. Closes on outside click and on route change.
 * ============================================================ */
const TopbarNav = ({ items }: { items: NavItem[] }) => {
  const location = useLocation();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (openKey === null) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpenKey(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openKey]);

  // Close on route change
  useEffect(() => {
    setOpenKey(null);
  }, [location.pathname]);

  return (
    <nav
      ref={containerRef}
      className="flex-1 min-w-0 flex items-center"
      style={{ gap: 1 }}
      aria-label="Navegação principal"
    >
      {items.map((item) => {
        if (!isGroup(item)) {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring border-b-2",
                  isActive
                    ? "text-primary border-primary font-medium"
                    : "text-muted-foreground border-transparent hover:text-foreground",
                )
              }
              style={{ padding: "6px 4px", marginRight: 14, fontSize: 13 }}
            >
              <item.icon size={15} strokeWidth={1.75} className="flex-shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        }

        const groupActive = item.children.some((c) =>
          c.to === "/" ? location.pathname === "/" : location.pathname.startsWith(c.to),
        );
        const isOpen = openKey === item.label;

        return (
          <div key={item.label} className="relative">
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : item.label)}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring border-b-2",
                groupActive
                  ? "text-primary border-primary font-medium"
                  : "text-muted-foreground border-transparent hover:text-foreground",
              )}
              style={{ padding: "6px 4px", marginRight: 14, fontSize: 13 }}
            >
              <item.icon size={15} strokeWidth={1.75} className="flex-shrink-0" />
              <span>{item.label}</span>
              <ChevronDown
                size={13}
                strokeWidth={1.75}
                className={cn(
                  "flex-shrink-0 transition-transform duration-150",
                  isOpen && "rotate-180",
                )}
              />
            </button>

            {isOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1 animate-fade-in"
                style={{
                  minWidth: 200,
                  zIndex: 200,
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 10,
                  boxShadow: "0 8px 24px hsl(var(--foreground) / 0.08)",
                  padding: 6,
                }}
              >
                {item.children.map((c) => {
                  const childActive =
                    c.to === "/"
                      ? location.pathname === "/"
                      : location.pathname.startsWith(c.to);
                  return (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      role="menuitem"
                      onClick={() => setOpenKey(null)}
                      className={cn(
                        "flex items-center gap-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring relative",
                        childActive
                          ? "font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      style={{
                        padding: "8px 12px",
                        paddingLeft: childActive ? 18 : 12,
                        borderRadius: 7,
                        fontSize: 13,
                        background: childActive ? "hsl(var(--accent))" : undefined,
                        color: childActive ? "hsl(var(--accent-foreground))" : undefined,
                      }}
                    >
                      {childActive && (
                        <span
                          aria-hidden
                          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full"
                          style={{
                            width: 5,
                            height: 5,
                            background: "hsl(var(--primary))",
                          }}
                        />
                      )}
                      <c.icon
                        size={16}
                        strokeWidth={1.75}
                        className="flex-shrink-0"
                        style={{ color: childActive ? "hsl(var(--accent-foreground))" : "hsl(var(--muted-foreground))" }}
                      />
                      <span className="truncate">{c.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
};

export const AppLayout = () => {
  const { user, roles, signOut } = useAuth();
  // Notificações realtime de fila/devolução para o usuário logado.
  useQueueNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const { layout } = useNavLayout();
  const primaryRole = (["admin", "diretor", "validador", "analista"] as const).find((r) => roles.includes(r));
  const initials = getInitials(user?.email);
  const canCreate = roles.some((r) => (["analista", "admin", "diretor"] as const).includes(r as never));
  const visibleTopNav = filterNav(NAV_ITEMS, roles);
  // Sidebar: flat list of ALL leaves in fixed order, filtered only by leaf-level roles.
  // Groups (Financeiro / Configurações / Acesso) are ignored here — sidebar never groups.
  const visibleSideNav = flattenNav(NAV_ITEMS).filter((c) =>
    c.roles.some((r) => roles.includes(r)),
  );

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  /* ============================ TOPBAR MODE ============================ */
  if (layout === "top") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header
          className="sticky top-0 z-40 bg-card border-b border-border shadow-soft"
          style={{ height: 56 }}
        >
          <div className="h-full max-w-[1600px] mx-auto px-5 flex items-center gap-5">
            <Logo />
            <TopbarNav items={visibleTopNav} />

            <div className="flex items-center gap-2 flex-shrink-0">
              {canCreate && (
                <Button
                  onClick={() => navigate("/pagamentos/novo")}
                  className="h-9 px-3 text-[13px] font-medium gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                  style={{ borderRadius: 7 }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Nova base</span>
                </Button>
              )}
              <ThemeToggle />
              <LayoutToggle />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-9 w-9 rounded-full bg-primary text-primary-foreground text-[12px] font-medium flex items-center justify-center hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Menu do usuário"
                  >
                    {initials}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-[13px] font-medium truncate">{user?.email}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {primaryRole ? ROLE_LABELS[primaryRole] : "—"}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="h-4 w-4 mr-2" /> Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main
          className="flex-1 min-w-0 nav-main"
          style={{ marginLeft: 0, transition: "margin-left 0.2s ease, opacity 0.2s ease" }}
        >
          <div className="mx-auto w-full" style={{ maxWidth: 1600, padding: "20px 24px" }}>
            <Breadcrumbs />
            <Outlet />
          </div>
        </main>
      </div>
    );
  }

  /* ============================ SIDEBAR MODE ============================ */
  return (
    <div className="min-h-screen bg-background">
      <aside
        className="fixed top-0 left-0 h-screen flex flex-col"
        style={{
          width: 240,
          background: "hsl(var(--card))",
          borderRight: "1px solid hsl(var(--border))",
          zIndex: 40,
        }}
        aria-label="Navegação lateral"
      >
        {/* Header / Logo */}
        <div
          className="flex items-center"
          style={{
            height: 56,
            padding: "0 16px",
            borderBottom: "1px solid hsl(var(--border))",
          }}
        >
          <Logo />
        </div>

        {/* Nav list */}
        <nav
          className="flex-1 overflow-y-auto"
          style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2 }}
        >
          {visibleSideNav.map((item) => {
            const isActive =
              item.to === "/"
                ? location.pathname === "/"
                : location.pathname === item.to ||
                  location.pathname.startsWith(item.to + "/");
            const linkStyle: React.CSSProperties = {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 11,
              padding: "10px 12px",
              paddingLeft: isActive ? 9 : 12,
              borderRadius: 8,
              fontSize: 13.5,
              lineHeight: 1.2,
              cursor: "pointer",
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "all 0.12s ease",
              borderLeft: isActive
                ? "3px solid hsl(var(--primary))"
                : "3px solid transparent",
              background: isActive ? "hsl(var(--accent))" : "transparent",
              color: isActive
                ? "hsl(var(--accent-foreground))"
                : "hsl(var(--secondary-foreground))",
              fontWeight: isActive ? 500 : 400,
            };
            return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  aria-label={item.label}
                  className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={linkStyle}
                >
                  <item.icon
                    size={18}
                    strokeWidth={1.75}
                    aria-hidden
                    style={{ width: 18, height: 18, flexShrink: 0, color: "inherit" }}
                  />
                  <span
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                      color: "inherit",
                    }}
                  >
                    {item.label}
                  </span>
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className="flex flex-col gap-2"
          style={{
            padding: 12,
            borderTop: "1px solid hsl(var(--border))",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="h-8 w-8 rounded-full bg-accent text-accent-foreground text-[11px] font-semibold flex items-center justify-center flex-shrink-0"
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium truncate text-foreground">{user?.email}</p>
              <p className="text-[10px] text-muted-foreground">
                {primaryRole ? ROLE_LABELS[primaryRole] : "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="text-[12px] h-9 text-muted-foreground hover:text-foreground gap-1.5"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </Button>
          </div>
        </div>
      </aside>

      <div
        className="nav-main flex flex-col min-h-screen"
        style={{ marginLeft: 240, transition: "margin-left 0.2s ease, opacity 0.2s ease" }}
      >
        {/* Slim top bar */}
        <header
          className="sticky top-0 z-30 bg-card border-b border-border"
          style={{ height: 56 }}
        >
          <div className="h-full flex items-center justify-end gap-2" style={{ padding: "0 32px" }}>
            {canCreate && (
              <Button
                onClick={() => navigate("/pagamentos/novo")}
                className="h-9 px-3 text-[13px] font-medium gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                style={{ borderRadius: 7 }}
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Nova base</span>
              </Button>
            )}
            <LayoutToggle />
          </div>
        </header>

        <main className="flex-1 min-w-0">
          <div style={{ padding: "20px 28px", maxWidth: 1600, margin: "0 auto" }}>
            <Breadcrumbs />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
