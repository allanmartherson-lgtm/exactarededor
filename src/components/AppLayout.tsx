import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/status";
import {
  Sun,
  Moon,
  Plus,
  LogOut,
  PanelLeft,
  PanelTop,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Settings,
  Menu,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { NotificationBell } from "@/components/NotificationBell";
import { InvoiceRetryMonitor } from "@/components/InvoiceRetryMonitor";
import { SystemAnnouncementBanner } from "@/components/SystemAnnouncementBanner";
import { useCurrentVersion } from "@/hooks/useSystemVersion";
import { Link } from "react-router-dom";

// Re-export for backward compatibility with existing importers (tests, diagnostic page).
export { NAV_ITEMS, isGroup, flattenNav, filterNav, ALL_ROLES } from "@/config/navItems";
export type { Role, NavLeaf, NavGroup, NavItem } from "@/config/navItems";

const AVATAR_GRADIENT = "linear-gradient(135deg, hsl(var(--secondary-foreground)), hsl(var(--foreground)))";

function getInitials(name?: string | null, email?: string | null) {
  const source = (name && name.trim()) || (email ? email.split("@")[0].replace(/[._-]+/g, " ") : "");
  if (!source) return "AA";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const Logo = ({ compact = false }: { compact?: boolean }) => (
  <NavLink
    to="/"
    className="flex items-center gap-3 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
    aria-label="Exacta — início"
  >
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        background: "hsl(var(--primary))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      aria-hidden
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="hsl(var(--accent))"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="5 12.5 10 17.5 19 7" />
      </svg>
    </div>
    {!compact && (
      <div className="min-w-0 leading-tight">
        <p
          className="font-wordmark"
          style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 400, letterSpacing: "0.04em", color: "hsl(var(--foreground))", lineHeight: 1 }}
        >
          E<span className="text-[#8A6830] dark:text-[#C8A96E]">x</span>acta
        </p>
        <p
          style={{
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "hsl(var(--muted-foreground))",
            marginTop: 4,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          Pagamento Médico
          <br />
          Rede D'Or
        </p>
      </div>
    )}
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
          className="h-11 w-11 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
          aria-label="Alternar layout"
        >
          <NextIcon className="h-[22px] w-[22px]" />
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
      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
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
      className="flex-1 min-w-0 flex items-center gap-0.5"
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
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-[15px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <item.icon className="size-[22px] flex-shrink-0" strokeWidth={1.75} />
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
                "inline-flex items-center gap-2 rounded-md px-3 py-2 text-[15px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                groupActive || isOpen
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="size-[22px] flex-shrink-0" strokeWidth={1.75} />
              <span>{item.label}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 flex-shrink-0 transition-transform duration-150",
                  isOpen && "rotate-180",
                )}
                strokeWidth={1.75}
              />
            </button>

            {isOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1 animate-fade-in"
                style={{
                  minWidth: 192,
                  zIndex: 200,
                  background: "hsl(var(--card))",
                  border: "0.5px solid hsl(var(--border))",
                  borderRadius: 8,
                  boxShadow: "var(--shadow-elevated)",
                  padding: 4,
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
                        "flex items-center gap-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        !childActive && "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      style={{
                        padding: "7px 10px",
                        borderRadius: 6,
                        fontSize: 13.5,
                        fontWeight: childActive ? 500 : 400,
                        background: childActive ? "hsl(var(--accent))" : undefined,
                        color: childActive ? "hsl(var(--accent-foreground))" : undefined,
                      }}
                    >
                      <c.icon
                        size={17}
                        strokeWidth={1.75}
                        className="flex-shrink-0"
                        style={{ color: "inherit" }}
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

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p
    style={{
      fontSize: 11,
      fontWeight: 500,
      color: "hsl(var(--muted-foreground))",
      letterSpacing: "0.07em",
      textTransform: "uppercase",
      padding: "12px 12px 4px",
      lineHeight: 1,
    }}
  >
    {children}
  </p>
);

export const AppLayout = () => {
  const { user, roles, signOut } = useAuth();
  // Notificações realtime de fila/devolução para o usuário logado.
  useQueueNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const { layout } = useNavLayout();
  const primaryRole = (["admin", "diretor", "validador", "analista"] as const).find((r) => roles.includes(r));
  const getRoleBadgeStyle = (role: string | undefined): React.CSSProperties => {
    const map: Record<string, { bg: string; fg: string }> = {
      admin: { bg: "hsl(var(--bubble-purple-bg))", fg: "hsl(var(--bubble-purple-fg))" },
      diretor: { bg: "hsl(var(--bubble-yellow-bg))", fg: "hsl(var(--bubble-yellow-fg))" },
      validador: { bg: "hsl(var(--bubble-blue-bg))", fg: "hsl(var(--bubble-blue-fg))" },
      analista: { bg: "hsl(var(--bubble-teal-bg))", fg: "hsl(var(--bubble-teal-fg))" },
    };
    const c = (role && map[role]) || { bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" };
    return {
      background: c.bg,
      color: c.fg,
      fontSize: 9,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      padding: "2px 7px",
      borderRadius: 20,
      lineHeight: 1.4,
      display: "inline-block",
    };
  };
  const [fullName, setFullName] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.id) { setFullName(null); return; }
    let cancelled = false;
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setFullName((data?.full_name as string | null) ?? null); });
    return () => { cancelled = true; };
  }, [user?.id]);
  const displayName = fullName || user?.email || "";
  const initials = getInitials(fullName, user?.email);
  const canCreate = roles.some((r) => (["analista", "admin", "diretor"] as const).includes(r as never));
  const canRetryInvoices = roles.includes("analista") || roles.includes("admin");
  const visibleTopNav = filterNav(NAV_ITEMS, roles);
  // Sidebar: flat list of ALL leaves in fixed order, filtered only by leaf-level roles.
  const visibleSideNav = flattenNav(NAV_ITEMS).filter((c) =>
    c.roles.some((r) => roles.includes(r)),
  );
  // Grouped variant for sidebar with section labels (preserves NAV_ITEMS structure).
  const groupedSideNav = filterNav(NAV_ITEMS, roles);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sidebar collapsed state (persisted in localStorage)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("exacta:sidebar-collapsed") === "1";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("exacta:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
    } catch {}
  }, [sidebarCollapsed]);

  // Detect mobile (<768px) to force topbar layout on small screens regardless of saved preference.
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // Close mobile drawer on route change
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  const effectiveLayout = isMobile ? "top" : layout;
  const sidebarWidth = sidebarCollapsed ? 68 : 260;

  const renderSideLink = (
    to: string,
    label: string,
    Icon: NavItem extends infer T ? T extends { icon: infer I } ? I : never : never,
    onClick?: () => void,
    collapsed = false,
  ) => {
    const isActive =
      to === "/"
        ? location.pathname === "/"
        : location.pathname === to || location.pathname.startsWith(to + "/");
    const linkStyle: React.CSSProperties = {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: collapsed ? 0 : 11,
      padding: collapsed ? "8px 0" : "8px 12px",
      paddingLeft: collapsed ? 0 : isActive ? 9 : 12,
      justifyContent: collapsed ? "center" : "flex-start",
      borderRadius: 6,
      fontSize: 13.5,
      lineHeight: 1.25,
      cursor: "pointer",
      textDecoration: "none",
      transition: "all 0.12s ease",
      borderLeft:
        !collapsed && isActive
          ? "3px solid hsl(var(--sidebar-primary))"
          : !collapsed
            ? "3px solid transparent"
            : undefined,
      background: isActive ? "hsl(var(--sidebar-accent))" : "transparent",
      color: isActive
        ? "hsl(var(--sidebar-accent-foreground))"
        : "hsl(var(--sidebar-muted-foreground))",
      fontWeight: isActive ? 500 : 400,
    };
    const IconCmp = Icon as unknown as React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties; "aria-hidden"?: boolean }>;
    return (
      <Tooltip key={to}>
        <TooltipTrigger asChild>
          <NavLink
            to={to}
            end={to === "/"}
            onClick={onClick}
            aria-label={label}
            className="outline-none focus-visible:ring-2 focus-visible:ring-ring sidebar-nav-link"
            style={linkStyle}
          >
            <IconCmp
              size={20}
              strokeWidth={1.75}
              aria-hidden
              style={{ width: 20, height: 20, flexShrink: 0, color: "inherit" }}
            />
            {!collapsed && (
              <span
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  wordBreak: "break-word",
                  minWidth: 0,
                  flex: 1,
                  color: "inherit",
                }}
              >
                {label}
              </span>
            )}
          </NavLink>
        </TooltipTrigger>
        {(collapsed || label.length > 22) && (
          <TooltipContent side="right">{label}</TooltipContent>
        )}
      </Tooltip>
    );
  };

  const MobileNavDrawer = (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 md:hidden text-muted-foreground hover:text-foreground"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[260px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="text-left text-sm">Menu</SheetTitle>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {visibleSideNav.map((item) => {
            const isActive =
              item.to === "/"
                ? location.pathname === "/"
                : location.pathname === item.to || location.pathname.startsWith(item.to + "/");
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon size={20} strokeWidth={1.75} className="flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-border p-3 flex items-center gap-2">
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: AVATAR_GRADIENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 600,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium truncate text-foreground">{displayName}</p>
            <span style={getRoleBadgeStyle(primaryRole)}>
              {primaryRole ? ROLE_LABELS[primaryRole] : "—"}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sair" className="h-8 w-8">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );

  async function handleSignOut() {
    await signOut();
    navigate("/auth", { replace: true });
  }

  /* ============================ TOPBAR MODE ============================ */
  if (effectiveLayout === "top") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {canRetryInvoices && <InvoiceRetryMonitor />}
        <header
          className="sticky top-0 z-40"
          style={{
            height: 60,
            background: "hsl(var(--card))",
            borderBottom: "0.5px solid hsl(var(--border))",
          }}
        >
          <div className="h-full max-w-[1600px] mx-auto px-3 md:px-5 flex items-center gap-2 md:gap-5">
            {MobileNavDrawer}
            <Logo />
            <div className="hidden md:flex flex-1 min-w-0">
              <TopbarNav items={visibleTopNav} />
            </div>
            <div className="flex-1 md:hidden" />

            <div className="flex items-center gap-1 md:gap-1.5 flex-shrink-0">
              {canCreate && (
                <Button
                  onClick={() => navigate("/pagamentos/novo")}
                  className="h-8 w-8 md:w-auto md:px-3 text-[12px] font-medium gap-1.5"
                  style={{
                    borderRadius: 6,
                    background: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    border: "none",
                  }}
                  aria-label="Nova base"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Nova base</span>
                </Button>
              )}
              <NotificationBell />
              <div className="hidden md:flex items-center gap-1">
                <ThemeToggle />
                <LayoutToggle />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: AVATAR_GRADIENT,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    className="focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Menu do usuário"
                  >
                    {initials}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-[13px] font-medium truncate">{displayName}</p>
                      <span style={getRoleBadgeStyle(primaryRole)}>
                        {primaryRole ? ROLE_LABELS[primaryRole] : "—"}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/perfil")}>
                    <Settings className="h-4 w-4 mr-2" /> Meu Perfil
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="h-4 w-4 mr-2" /> Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <SystemAnnouncementBanner />

        <main
          className="flex-1 min-w-0 nav-main"
          style={{ transition: "margin-left 0.2s ease, opacity 0.2s ease" }}
        >
          <div className="mx-auto w-full max-w-[1600px] px-3 py-4 md:px-6 md:py-5">
            <div className="mb-4"><Breadcrumbs /></div>
            <Outlet />
          </div>
        </main>
      </div>
    );
  }

  /* ============================ SIDEBAR MODE ============================ */
  return (
    <div className="min-h-screen bg-background">
      {canRetryInvoices && <InvoiceRetryMonitor />}
      <aside
        className="fixed top-0 left-0 h-screen flex flex-col"
        style={{
          width: 260,
          background: "hsl(var(--sidebar-background))",
          borderRight: "1px solid hsl(var(--sidebar-border))",
          zIndex: 40,
        }}
        aria-label="Navegação lateral"
      >
        {/* Header / Logo */}
        <div
          className="flex items-center"
          style={{
            height: 64,
            padding: "0 16px",
            borderBottom: "1px solid hsl(var(--sidebar-border))",
          }}
        >
          <Logo />
        </div>

        {/* Nav list (grouped with section labels) */}
        <nav
          className="flex-1 overflow-y-auto"
          style={{ padding: "8px 10px 12px", display: "flex", flexDirection: "column", gap: 1 }}
        >
          {groupedSideNav.map((item, idx) => {
            if (!isGroup(item)) {
              return renderSideLink(item.to, item.label, item.icon as never);
            }
            return (
              <div key={item.label} style={{ marginTop: idx === 0 ? 0 : 6 }}>
                <SectionLabel>{item.label}</SectionLabel>
                {item.children.map((c) =>
                  renderSideLink(c.to, c.label, c.icon as never),
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className="flex flex-col gap-2"
          style={{
            padding: 12,
            borderTop: "1px solid hsl(var(--sidebar-border))",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: AVATAR_GRADIENT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 600,
                color: "#fff",
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: "hsl(var(--foreground))",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {displayName}
              </p>
              <span style={getRoleBadgeStyle(primaryRole)}>
                {primaryRole ? ROLE_LABELS[primaryRole] : "—"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              aria-label="Sair"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LayoutToggle />
          </div>
          <SidebarVersionFooter />
        </div>
      </aside>

      <div
        className="nav-main flex flex-col min-h-screen"
        style={{ marginLeft: 260, transition: "margin-left 0.2s ease, opacity 0.2s ease" }}
      >
        {/* Slim top bar */}
        <header
          className="sticky top-0 z-30"
          style={{
            height: 64,
            background: "hsl(var(--card))",
            borderBottom: "1px solid hsl(var(--border))",
          }}
        >
          <div
            className="h-full flex items-center gap-3"
            style={{ padding: "0 24px" }}
          >
            <div className="flex-1 min-w-0 flex items-center">
              <Breadcrumbs />
            </div>
            <div className="flex items-center gap-2">
              {canCreate && (
                <Button
                  onClick={() => navigate("/pagamentos/novo")}
                  className="h-11 px-5 text-[14px] font-medium gap-2"
                  style={{
                    borderRadius: 8,
                    background: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    border: "none",
                  }}
                >
                  <Plus className="h-[18px] w-[18px]" />
                  <span className="hidden md:inline">Nova base</span>
                </Button>
              )}
              <NotificationBell />
              <LayoutToggle />
            </div>
          </div>
        </header>
        <SystemAnnouncementBanner />

        <main className="flex-1 min-w-0">
          <div style={{ padding: "20px 28px", maxWidth: 1600, margin: "0 auto" }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

/** Mostra a versão atual do Exacta no rodapé do sidebar, linkando para /sobre. */
function SidebarVersionFooter() {
  const { release } = useCurrentVersion();
  if (!release) return null;
  return (
    <Link
      to="/sobre"
      className="text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/50"
      title={`${release.title} — clique para ver o histórico`}
    >
      Exacta v{release.version}
    </Link>
  );
}
