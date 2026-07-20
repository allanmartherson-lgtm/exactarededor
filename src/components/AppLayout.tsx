import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/status";
import {
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
import { AccessibilityMenu } from "@/components/AccessibilityMenu";
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
import { InboxBadge } from "@/components/InboxBadge";
import { ExactaLogo } from "@/components/brand/ExactaLogo";



import { PortalUnreadBadge } from "@/components/portal/PortalUnreadBadge";
import { InvoiceRetryMonitor } from "@/components/InvoiceRetryMonitor";
import { SystemAnnouncementBanner } from "@/components/SystemAnnouncementBanner";
import { useCurrentVersion } from "@/hooks/useSystemVersion";
import { useConversasUnread } from "@/hooks/useConversasUnread";
import { Link } from "react-router-dom";
import { HospitalSwitcher } from "@/components/HospitalSwitcher";
import { PaymentModeSelectModal } from "@/components/PaymentModeSelectModal";
import { ZeevGlobalMount } from "@/components/copilot/ZeevGlobalMount";

/** Bolinha vermelha de não lidas para o item Conversas. */
const ConversasBadgeDot = ({ count, absolute = false }: { count: number; absolute?: boolean }) => {
  if (count <= 0) return null;
  const label = count > 9 ? "9+" : String(count);
  if (absolute) {
    return (
      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none flex items-center justify-center px-1">
        {label}
      </span>
    );
  }
  return (
    <span className="ml-auto min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none flex items-center justify-center px-1">
      {label}
    </span>
  );
};

// Re-export for backward compatibility with existing importers (tests, diagnostic page).
export { NAV_ITEMS, isGroup, flattenNav, filterNav, ALL_ROLES } from "@/config/navItems";
export type { Role, NavLeaf, NavGroup, NavItem } from "@/config/navItems";

// Avatar CURA: laranja Rede D'Or (referência dos apps mobile) — contraste AA
// tanto sobre o header navy quanto sobre superfícies claras dos menus.
const AVATAR_GRADIENT = "linear-gradient(135deg, #F26722 0%, #D9531E 100%)";


function getInitials(name?: string | null, email?: string | null) {
  const source = (name && name.trim()) || (email ? email.split("@")[0].replace(/[._-]+/g, " ") : "");
  if (!source) return "AA";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const Logo = ({ compact = false, onDark = false, preserveIconColors = false }: { compact?: boolean; onDark?: boolean; preserveIconColors?: boolean }) => (
  <ExactaLogo
    variant={compact ? "icon" : "full"}
    iconSize={compact ? 34 : 36}
    wordmarkSize={20}
    onDark={onDark}
    preserveIconColors={preserveIconColors}
  />
);


const LayoutToggle = () => {
  const { layout, toggleLayout } = useNavLayout();
  const NextIcon = layout === "top" ? PanelLeft : PanelTop;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggleLayout}
          className="size-8 grid place-items-center rounded-md border border-border/60 bg-background hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Alternar layout"
        >
          <NextIcon className="size-4" strokeWidth={1.7} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Alternar layout</TooltipContent>
    </Tooltip>
  );
};


/* ============================================================
 * Topbar nav (with dropdown groups). Only one dropdown open at
 * a time. Closes on outside click and on route change.
 * ============================================================ */
const TopbarNav = ({ items, conversasUnread }: { items: NavItem[]; conversasUnread: number }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // Close dropdowns on route change
  useEffect(() => {
    setOpenKey(null);
    setMoreOpen(false);
  }, [location.pathname]);

  // ---------- Overflow measurement ----------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const widthsRef = useRef<number[]>([]);
  const [containerW, setContainerW] = useState(0);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const MORE_BTN_WIDTH = 78;
  const GAP = 2;

  // Measure each item's natural width (hidden row mirrors real items 1:1).
  useLayoutEffect(() => {
    if (!measureRef.current) return;
    widthsRef.current = Array.from(measureRef.current.children).map(
      (c) => (c as HTMLElement).offsetWidth,
    );
  }, [items]);

  // Track container width
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Recompute visible count when widths or container change
  useLayoutEffect(() => {
    const widths = widthsRef.current;
    if (!widths.length || !containerW) return;
    const total = widths.reduce((s, w) => s + w, 0) + GAP * (widths.length - 1);
    if (total <= containerW) {
      setVisibleCount(items.length);
      return;
    }
    let used = 0;
    let count = 0;
    const budget = containerW - MORE_BTN_WIDTH - GAP;
    for (let i = 0; i < widths.length; i++) {
      const next = used + widths[i] + (i > 0 ? GAP : 0);
      if (next > budget) break;
      used = next;
      count = i + 1;
    }
    setVisibleCount(Math.max(0, count));
  }, [containerW, items.length]);

  const renderLeaf = (item: Extract<NavItem, { to: string }>) => {
    const showBadge = item.to === "/conversas" && conversasUnread > 0;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === "/"}
        className={({ isActive }) =>
          cn(
            "relative inline-flex flex-col items-center justify-center gap-1 rounded-md px-3 py-1 min-w-[72px] text-[11px] leading-tight font-bold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isActive
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )
        }
      >
        <item.icon size={20} weight="fill" strokeWidth={2.25} className="flex-shrink-0" style={{ width: 20, height: 20 }} />
        <span>{item.label}</span>
        {showBadge && <ConversasBadgeDot count={conversasUnread} absolute />}
      </NavLink>
    );
  };

  const renderItem = (item: NavItem, measuring = false) => {
    if (!isGroup(item)) return renderLeaf(item);
    const groupActive = item.children.some((c) =>
      c.to === "/" ? location.pathname === "/" : location.pathname.startsWith(c.to),
    );
    const isOpen = !measuring && openKey === item.label;
    return (
      <TopbarGroup
        key={item.label}
        item={item}
        isOpen={isOpen}
        isAnyOpen={!measuring && openKey !== null}
        groupActive={groupActive}
        onOpen={measuring ? () => {} : () => setOpenKey(item.label)}
        onToggle={measuring ? () => {} : () => setOpenKey(isOpen ? null : item.label)}
        onClose={measuring ? () => {} : () => setOpenKey(null)}
        currentPath={location.pathname}
      />
    );
  };

  const visibleItems = items.slice(0, visibleCount);
  const overflowItems = items.slice(visibleCount);

  return (
    <div ref={containerRef} className="flex-1 min-w-0 relative">
      {/* Hidden measurement row — never visible, no layout impact */}
      <div
        ref={measureRef}
        aria-hidden
        className="flex items-center gap-0.5"
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          left: -99999,
          top: 0,
        }}
      >
        {items.map((it) => renderItem(it, true))}
      </div>

      <nav
        className="flex items-center gap-0.5 flex-nowrap overflow-hidden"
        aria-label="Navegação principal"
      >
        {visibleItems.map((it) => renderItem(it))}

        {overflowItems.length > 0 && (
          <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex flex-col items-center justify-center gap-1 rounded-md px-3 py-1 min-w-[72px] text-[11px] leading-tight font-bold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  moreOpen
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-label="Mais menus"
              >
                <Menu size={20} strokeWidth={2.25} className="flex-shrink-0" style={{ width: 20, height: 20 }} />
                <span className="inline-flex items-center gap-0.5">
                  Mais
                  <ChevronDown
                    className={cn("size-3 transition-transform duration-150", moreOpen && "rotate-180")}
                    strokeWidth={1.75}
                  />
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-[70vh] overflow-y-auto">
              {overflowItems.map((it, idx) => {
                if (!isGroup(it)) {
                  return (
                    <DropdownMenuItem
                      key={it.to}
                      onClick={() => {
                        setMoreOpen(false);
                        navigate(it.to);
                      }}
                    >
                      <it.icon size={16} className="mr-2 flex-shrink-0" />
                      <span className="truncate">{it.label}</span>
                    </DropdownMenuItem>
                  );
                }
                return (
                  <div key={it.label}>
                    {idx > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                      {it.label}
                    </DropdownMenuLabel>
                    {it.children.map((c) => (
                      <DropdownMenuItem
                        key={c.to}
                        onClick={() => {
                          setMoreOpen(false);
                          navigate(c.to);
                        }}
                      >
                        <c.icon size={16} className="mr-2 flex-shrink-0" />
                        <span className="truncate">{c.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </div>
  );
};

type TopbarGroupItem = Extract<NavItem, { children: unknown }>;

const TopbarGroup = ({
  item,
  isOpen,
  isAnyOpen,
  groupActive,
  onOpen,
  onToggle,
  onClose,
  currentPath,
}: {
  item: TopbarGroupItem;
  isOpen: boolean;
  isAnyOpen: boolean;
  groupActive: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onClose: () => void;
  currentPath: string;
}) => {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openedByHoverRef = useRef(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        const menuWidth = menuRef.current?.offsetWidth ?? 224;
        const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
        setPos({ left: Math.min(Math.max(8, r.left), maxLeft), top: r.bottom + 4 });
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen]);

  // Close on outside click (portal escapes the nav's outside-click handler)
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen, onClose]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={() => {
          if (isAnyOpen && !isOpen) {
            openedByHoverRef.current = true;
            onOpen();
          }
        }}
        onClick={() => {
          if (isOpen && openedByHoverRef.current) {
            openedByHoverRef.current = false;
            return;
          }
          openedByHoverRef.current = false;
          onToggle();
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={cn(
          "inline-flex flex-col items-center justify-center gap-1 rounded-md px-3 py-1 min-w-[72px] text-[11px] leading-tight font-bold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          groupActive || isOpen
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <item.icon size={20} weight="fill" strokeWidth={2.25} className="flex-shrink-0" style={{ width: 20, height: 20 }} />
        <span className="inline-flex items-center gap-0.5">
          {item.label}
          <ChevronDown
            className={cn(
              "size-3 flex-shrink-0 transition-transform duration-150",
              isOpen && "rotate-180",
            )}
            strokeWidth={1.75}
          />
        </span>
      </button>

      {isOpen && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="animate-fade-in"
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            minWidth: 192,
            zIndex: 9999,
            background: "hsl(var(--card))",
            border: "0.5px solid hsl(var(--border))",
            borderRadius: 8,
            boxShadow: "var(--shadow-elevated)",
            padding: 4,
          }}
        >
          {item.children.map((c) => {
            const childActive =
              c.to === "/" ? currentPath === "/" : currentPath.startsWith(c.to);
            return (
              <NavLink
                key={c.to}
                to={c.to}
                role="menuitem"
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !childActive && "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                style={{
                  padding: "7px 10px",
                  borderRadius: 6,
                  fontSize: 13.5,
                  fontWeight: childActive ? 500 : 400,
                  background: childActive ? "hsl(var(--primary))" : undefined,
                  color: childActive ? "hsl(var(--primary-foreground))" : undefined,
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
        </div>,
        document.body,
      )}
    </div>
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

/* ============================================================
 * Sidebar group item — clickable label that expands inline to
 * reveal child links (expanded sidebar), or opens a flyout
 * popover (collapsed sidebar), mirroring the topbar dropdown.
 * ============================================================ */
function SidebarGroupItem({
  group,
  collapsed,
  renderSideLink,
  isFirst,
}: {
  group: Extract<NavItem, { children: unknown }>;
  collapsed: boolean;
  renderSideLink: (
    to: string,
    label: string,
    Icon: never,
    onClick?: () => void,
    collapsed?: boolean,
  ) => React.ReactNode;
  isFirst: boolean;
}) {
  const location = useLocation();
  const groupActive = group.children.some((c) =>
    c.to === "/" ? location.pathname === "/" : location.pathname === c.to || location.pathname.startsWith(c.to + "/"),
  );
  const storageKey = `exacta:sidebar-group:${group.label}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return groupActive;
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "1") return true;
    if (saved === "0") return false;
    return groupActive;
  });
  // Auto-open when a child becomes active via navigation.
  useEffect(() => {
    if (groupActive) setOpen(true);
  }, [groupActive]);
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, open ? "1" : "0"); } catch {}
  }, [open, storageKey]);

  // Collapsed sidebar: render an icon button with a flyout popover on click.
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!flyoutOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!flyoutRef.current?.contains(e.target as Node)) setFlyoutOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [flyoutOpen]);
  useEffect(() => { setFlyoutOpen(false); }, [location.pathname]);

  const GroupIcon = group.icon as unknown as React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;

  if (collapsed) {
    return (
      <div ref={flyoutRef} className="relative" style={{ marginTop: isFirst ? 0 : 4 }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setFlyoutOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={flyoutOpen}
              aria-label={group.label}
              className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "8px 0",
                borderRadius: 6,
                background: groupActive || flyoutOpen ? "hsl(var(--sidebar-accent))" : "transparent",
                color: groupActive || flyoutOpen
                  ? "hsl(var(--sidebar-accent-foreground))"
                  : "hsl(var(--sidebar-muted-foreground))",
                border: "none",
                cursor: "pointer",
                transition: "all 0.12s ease",
              }}
            >
              <GroupIcon size={20} strokeWidth={1.75} style={{ color: "inherit" }} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{group.label}</TooltipContent>
        </Tooltip>
        {flyoutOpen && (
          <div
            role="menu"
            className="animate-fade-in"
            style={{
              position: "absolute",
              left: "calc(100% + 6px)",
              top: 0,
              minWidth: 200,
              zIndex: 200,
              background: "hsl(var(--card))",
              border: "0.5px solid hsl(var(--border))",
              borderRadius: 8,
              boxShadow: "var(--shadow-elevated)",
              padding: 4,
            }}
          >
            <p
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "hsl(var(--muted-foreground))",
                padding: "6px 10px 4px",
              }}
            >
              {group.label}
            </p>
            {group.children.map((c) => {
              const childActive =
                c.to === "/" ? location.pathname === "/" : location.pathname === c.to || location.pathname.startsWith(c.to + "/");
              const CIcon = c.icon as unknown as React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
              return (
                <NavLink
                  key={c.to}
                  to={c.to}
                  role="menuitem"
                  onClick={() => setFlyoutOpen(false)}
                  className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderRadius: 6,
                    fontSize: 13.5,
                    textDecoration: "none",
                    fontWeight: childActive ? 500 : 400,
                    background: childActive ? "hsl(var(--accent))" : undefined,
                    color: childActive ? "hsl(var(--accent-foreground))" : "hsl(var(--muted-foreground))",
                  }}
                >
                  <CIcon size={17} strokeWidth={1.75} style={{ color: "inherit", flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                </NavLink>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Expanded sidebar: clickable header that toggles inline children.
  return (
    <div style={{ marginTop: isFirst ? 0 : 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "8px 12px",
          borderRadius: 6,
          background: groupActive && !open ? "hsl(var(--sidebar-accent))" : "transparent",
          color: groupActive
            ? "hsl(var(--sidebar-accent-foreground))"
            : "hsl(var(--sidebar-muted-foreground))",
          border: "none",
          cursor: "pointer",
          fontSize: 13.5,
          fontWeight: groupActive ? 500 : 400,
          textAlign: "left",
          transition: "background 0.12s ease",
        }}
      >
        <GroupIcon size={20} strokeWidth={1.75} style={{ color: "inherit", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, color: "inherit" }}>{group.label}</span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          style={{
            color: "inherit",
            flexShrink: 0,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
      </button>
      {open && (
        <div style={{ marginTop: 2, marginLeft: 10, paddingLeft: 8, borderLeft: "1px solid hsl(var(--sidebar-border))", display: "flex", flexDirection: "column", gap: 1 }}>
          {group.children.map((c) =>
            renderSideLink(c.to, c.label, c.icon as never, undefined, false),
          )}
        </div>
      )}
    </div>
  );
}

export const AppLayout = () => {
  const { user, roles, signOut } = useAuth();
  // Notificações realtime de fila/devolução para o usuário logado.
  useQueueNotifications();
  const conversasUnread = useConversasUnread();
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
  const [modeModalOpen, setModeModalOpen] = useState(false);

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

  // Fluxo "expandir ao clicar, recolher após selecionar" (modo recolhido).
  // - Clique em ícone (leaf ou grupo) enquanto recolhido → expande + foca o item.
  // - Ao navegar para uma rota logo em seguida → recolhe automaticamente.
  const autoCollapseAfterNavRef = useRef(false);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const [expandedGroupSignal, setExpandedGroupSignal] = useState<string | null>(null);
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;
    if (autoCollapseAfterNavRef.current) {
      autoCollapseAfterNavRef.current = false;
      setExpandedGroupSignal(null);
      setSidebarCollapsed(true);
    }
  }, [location.pathname]);
  useEffect(() => {
    if (!pendingFocusKey || sidebarCollapsed) return;
    const id = window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-nav-key="${pendingFocusKey.replace(/"/g, '\\"')}"]`,
      );
      el?.focus({ preventScroll: false });
      el?.scrollIntoView({ block: "nearest" });
      setPendingFocusKey(null);
    });
    return () => window.cancelAnimationFrame(id);
  }, [pendingFocusKey, sidebarCollapsed]);
  const expandFromCollapsedIcon = (key: string, groupLabel?: string) => {
    autoCollapseAfterNavRef.current = true;
    setSidebarCollapsed(false);
    if (groupLabel) setExpandedGroupSignal(groupLabel);
    setPendingFocusKey(key);
  };

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
  // Largura dinâmica: colapsado mostra só ícones; expandido acomoda logo + tagline
  // "Pagamento Médico · Rede D'Or" + botão de recolher sem overflow.
  const sidebarWidth = sidebarCollapsed ? 68 : 296;

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
      position: "relative",
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
            {to === "/conversas" && conversasUnread > 0 && (
              <ConversasBadgeDot count={conversasUnread} absolute={collapsed} />
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
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] transition-colors disabled:opacity-50 disabled:pointer-events-none",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon size={20} strokeWidth={1.75} className="flex-shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.to === "/conversas" && conversasUnread > 0 && (
                  <ConversasBadgeDot count={conversasUnread} />
                )}
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
          className="sticky top-0 z-40 border-b border-white/10 text-white"
          style={{
            height: 60,
            // Header CURA: fundo navy CURA (#003DA5 = hsl 214 100% 32%) HARD-CODED
            // aqui porque nas linhas abaixo invertemos --primary→branco no
            // escopo do header (para pills/chips ficarem legíveis). Se usarmos
            // hsl(var(--primary)) o próprio header vira branco.
            background: "hsl(214 100% 32%)",
            ["--cura-font-color" as string]: "#ffffff",
            ["--foreground" as string]: "0 0% 100%",
            ["--muted-foreground" as string]: "0 0% 100%",
            ["--border" as string]: "0 0% 100% / 0.22",
            ["--input" as string]: "0 0% 100% / 0.22",
            ["--background" as string]: "0 0% 100% / 0",
            ["--card" as string]: "0 0% 100% / 0.10",
            ["--secondary" as string]: "0 0% 100% / 0.14",
            ["--secondary-foreground" as string]: "0 0% 100%",
            ["--muted" as string]: "0 0% 100% / 0.16",
            ["--accent" as string]: "0 0% 100% / 0.20",
            ["--accent-foreground" as string]: "0 0% 100%",
            // Inverte primary dentro do header: pills e ícones ativos usam
            // branco sobre navy; botões "primary" viram pílulas brancas com
            // texto navy (contraste AAA sobre o header).
            ["--primary" as string]: "0 0% 100%",
            ["--primary-foreground" as string]: "214 100% 32%",
            ["--ring" as string]: "0 0% 100%",
          } as React.CSSProperties}
        >
          {/* Overrides pontuais para chips/pills que usam bg-primary/10 dentro
              do header — a mistura white/10 sobre navy fica ilegível; elevamos
              alpha e reforçamos texto branco para contraste AA em todos eles. */}
          <style>{`
            header .bg-primary\\/10 { background-color: rgb(255 255 255 / 0.22) !important; }
            header .bg-primary\\/5  { background-color: rgb(255 255 255 / 0.14) !important; }
            header .border-primary\\/20 { border-color: rgb(255 255 255 / 0.28) !important; }
            header .border-primary\\/40 { border-color: rgb(255 255 255 / 0.45) !important; }
            header .text-primary { color: #ffffff !important; }
            header .bg-muted, header .bg-muted\\/40, header .bg-muted\\/30, header .bg-muted\\/20 {
              background-color: rgb(255 255 255 / 0.14) !important;
            }
            /* Padrão Rede D'Or: ícones do header sem moldura — apenas o glifo.
               Cobrimos size-8 (tailwind), .border (fallback) e h-8/w-8 legados. */
            header button.size-8:not(.nova-base-btn),
            header button.border:not(.nova-base-btn),
            header button.h-8.w-8:not(.nova-base-btn) {
              border-color: transparent !important;
              background-color: transparent !important;
              color: #ffffff !important;
              box-shadow: none !important;
            }
            header button.size-8:not(.nova-base-btn):hover,
            header button.border:not(.nova-base-btn):hover,
            header button.h-8.w-8:not(.nova-base-btn):hover {
              background-color: rgb(255 255 255 / 0.12) !important;
              color: #ffffff !important;
            }
            /* Nova base: cor de destaque CURA (accent-base #FF8200 / laranja Rede D'Or). */
            header button.nova-base-btn { background-color: #FF8200 !important; color: #ffffff !important; border-color: transparent !important; }
            header button.nova-base-btn:hover { background-color: #D7720A !important; color: #ffffff !important; }


          `}</style>


          <div className="h-full max-w-[1600px] mx-auto px-2 md:px-5 flex items-center gap-1.5 md:gap-5 overflow-hidden">
            {MobileNavDrawer}
            <Logo onDark preserveIconColors />


            <div className="hidden md:flex flex-1 min-w-0">
              <TopbarNav items={visibleTopNav} conversasUnread={conversasUnread} />
            </div>
            <div className="flex-1 md:hidden" />

            <div className="flex items-center gap-0.5 md:gap-1.5 flex-shrink-0">
              {canCreate && (
                <Button
                  onClick={() => setModeModalOpen(true)}
                  className="nova-base-btn h-8 w-8 md:w-auto md:px-3 text-[12px] font-medium gap-1.5 shadow-sm border-transparent hover:opacity-90"
                  aria-label="Nova base"
                  style={{
                    // CTA em accent-base CURA (#FF8200) — laranja Rede D'Or.
                    // Style inline vence o bg-primary do shadcn Button no header.
                    backgroundColor: "#FF8200",
                    color: "#ffffff",
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Nova base</span>
                </Button>
              )}
              <HospitalSwitcher className="hidden lg:inline-flex" />
              <PortalUnreadBadge />
              <InboxBadge />
              <NotificationBell />
              <div className="hidden lg:flex items-center gap-1">
                <AccessibilityMenu />
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
        <PaymentModeSelectModal open={modeModalOpen} onOpenChange={setModeModalOpen} />
        <ZeevGlobalMount />
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
          width: sidebarWidth,
          background: "hsl(var(--sidebar-background))",
          borderRight: "1px solid hsl(var(--sidebar-border))",
          zIndex: 40,
          transition: "width 0.18s ease",
        }}
        aria-label="Navegação lateral"
      >
        {/* Header / Logo + collapse toggle — pintado em navy para se conectar
            visualmente com a top bar (a marca fica "colada" ao header navy,
            e o corpo do sidebar permanece branco). */}
        <div
          className="flex items-center text-white"
          style={{
            height: 64,
            padding: sidebarCollapsed ? "0 8px" : "0 12px 0 16px",
            background: "hsl(214 100% 32%)",
            borderBottom: "1px solid rgb(255 255 255 / 0.12)",
            justifyContent: sidebarCollapsed ? "center" : "space-between",
            gap: 8,
          }}
        >
          {!sidebarCollapsed && (
            <div className="flex-1 min-w-0 overflow-hidden">
              <Logo onDark preserveIconColors />
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarCollapsed((v) => !v)}
                aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
                className="h-8 w-8 rounded-md flex-shrink-0 hover:bg-white/15"
                style={{ color: "#ffffff" }}
              >
                {sidebarCollapsed ? (
                  <ChevronsRight className="h-4 w-4" />
                ) : (
                  <ChevronsLeft className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Nav list (collapsible groups, like topbar dropdowns but inline) */}
        <nav
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ padding: sidebarCollapsed ? "8px 6px 12px" : "8px 10px 12px", display: "flex", flexDirection: "column", gap: 1 }}
        >
          {groupedSideNav.map((item, idx) => {
            if (!isGroup(item)) {
              return renderSideLink(item.to, item.label, item.icon as never, undefined, sidebarCollapsed);
            }
            return (
              <SidebarGroupItem
                key={item.label}
                group={item}
                collapsed={sidebarCollapsed}
                renderSideLink={renderSideLink}
                isFirst={idx === 0}
              />
            );
          })}
        </nav>

        {/* Hospital switcher (sidebar) */}
        {!sidebarCollapsed && (
          <div
            style={{
              padding: "8px 10px",
              borderTop: "1px solid hsl(var(--sidebar-border))",
            }}
          >
            <HospitalSwitcher className="w-full justify-start" />
          </div>
        )}

        {/* Footer */}
        <div
          className="flex flex-col gap-2"
          style={{
            padding: sidebarCollapsed ? 8 : 12,
            borderTop: "1px solid hsl(var(--sidebar-border))",
            alignItems: sidebarCollapsed ? "center" : "stretch",
          }}
        >

          {sidebarCollapsed ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => navigate("/perfil")}
                    aria-label={displayName || "Meu perfil"}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: AVATAR_GRADIENT,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                    }}
                    className="focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {initials}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{displayName}</TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSignOut}
                aria-label="Sair"
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
                <AccessibilityMenu />
              <LayoutToggle />
            </>
          ) : (
            <>
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
                <AccessibilityMenu />
            <LayoutToggle />
          </div>
          <SidebarVersionFooter />
            </>
          )}
        </div>
      </aside>

      <div
        className="nav-main flex flex-col min-h-screen"
        style={{ marginLeft: sidebarWidth, transition: "margin-left 0.2s ease, opacity 0.2s ease" }}
      >
        {/* Slim top bar */}
        <header
          className="sticky top-0 z-30 text-white"
          style={{
            height: 64,
            // Padrão Rede D'Or/CURA: header institucional em azul navy
            // (primary-700 = #003DA5). Escopa --primary→branco para que
            // pills/ícones ativos usem branco sobre navy.
            background: "hsl(214 100% 32%)",
            borderBottom: "1px solid rgb(255 255 255 / 0.12)",
            ["--cura-font-color" as string]: "#ffffff",
            ["--foreground" as string]: "0 0% 100%",
            ["--muted-foreground" as string]: "0 0% 100%",
            ["--border" as string]: "0 0% 100% / 0.22",
            ["--primary" as string]: "0 0% 100%",
            ["--primary-foreground" as string]: "214 100% 32%",
            ["--ring" as string]: "0 0% 100%",
          } as React.CSSProperties}
        >
          {/* Overrides pontuais para legibilidade sobre navy — espelha o
              tratamento do topbar mode: ícones sem moldura, chips brancos,
              links do breadcrumb com hover branco. */}
          <style>{`
            header nav[aria-label="Breadcrumb"] a { color: rgb(255 255 255 / 0.78); }
            header nav[aria-label="Breadcrumb"] a:hover { color: #ffffff; }
            header nav[aria-label="Breadcrumb"] [aria-current="page"] { color: #ffffff; }
            header .bg-primary\\/10 { background-color: rgb(255 255 255 / 0.22) !important; }
            header .bg-primary\\/5  { background-color: rgb(255 255 255 / 0.14) !important; }
            header .border-primary\\/20 { border-color: rgb(255 255 255 / 0.28) !important; }
            header .text-primary { color: #ffffff !important; }
            header .bg-muted, header .bg-muted\\/40, header .bg-muted\\/30, header .bg-muted\\/20 {
              background-color: rgb(255 255 255 / 0.14) !important;
            }
            header button.size-8:not(.nova-base-btn),
            header button.border:not(.nova-base-btn),
            header button.h-8.w-8:not(.nova-base-btn),
            header button.h-9.w-9:not(.nova-base-btn),
            header button.size-9:not(.nova-base-btn) {
              border-color: transparent !important;
              background-color: transparent !important;
              color: #ffffff !important;
              box-shadow: none !important;
            }
            header button.size-8:not(.nova-base-btn):hover,
            header button.border:not(.nova-base-btn):hover,
            header button.h-8.w-8:not(.nova-base-btn):hover,
            header button.h-9.w-9:not(.nova-base-btn):hover,
            header button.size-9:not(.nova-base-btn):hover {
              background-color: rgb(255 255 255 / 0.14) !important;
              color: #ffffff !important;
            }
          `}</style>

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
                  onClick={() => setModeModalOpen(true)}
                  className="nova-base-btn h-11 px-5 text-[14px] font-medium gap-2"
                  style={{
                    backgroundColor: "#FF8200",
                    color: "#ffffff",
                    borderColor: "transparent",
                  }}
                >
                  <Plus className="h-[18px] w-[18px]" />
                  <span className="hidden md:inline">Nova base</span>
                </Button>
              )}
              <PortalUnreadBadge />
              <InboxBadge />
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
      <PaymentModeSelectModal open={modeModalOpen} onOpenChange={setModeModalOpen} />
      <ZeevGlobalMount />
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
