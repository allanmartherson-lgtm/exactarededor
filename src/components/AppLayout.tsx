import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/status";
import {
  LayoutDashboard,
  Wallet,
  Receipt,
  BarChart2,
  ShieldCheck,
  Table,
  Building2,
  Users,
  History,
  Sun,
  Moon,
  Plus,
  LogOut,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/pagamentos", label: "Pagamentos", icon: Wallet, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/notas-fiscais", label: "Notas Fiscais", icon: Receipt, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/kpis", label: "KPIs", icon: BarChart2, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/regras", label: "Regras", icon: ScrollText, roles: ["diretor", "admin"] as const },
  { to: "/tabelas", label: "Tabelas", icon: Table, roles: ["diretor", "admin"] as const },
  { to: "/empresas", label: "Empresas", icon: Building2, roles: ["diretor", "admin"] as const },
  { to: "/usuarios", label: "Usuários", icon: Users, roles: ["admin"] as const },
  { to: "/auditoria", label: "Auditoria", icon: History, roles: ["diretor", "admin"] as const },
];

function getInitials(email?: string | null) {
  if (!email) return "AA";
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const AppLayout = () => {
  const { user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const primaryRole = (["admin", "diretor", "validador", "analista"] as const).find((r) => roles.includes(r));
  const initials = getInitials(user?.email);
  const canCreate = roles.some((r) => (["analista", "admin", "diretor"] as const).includes(r as never));

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header
        className="sticky top-0 z-40 h-14 bg-card border-b border-border shadow-soft"
        style={{ height: "56px" }}
      >
        <div className="h-full max-w-[1400px] mx-auto px-5 flex items-center gap-5">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2.5 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
            <div
              className="flex items-center justify-center flex-shrink-0 bg-primary"
              style={{ width: 30, height: 30, borderRadius: 8 }}
            >
              <ShieldCheck className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 leading-tight hidden sm:block">
              <p className="font-bold text-[13px] text-foreground leading-none">MedPay</p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5 leading-none">
                Approval Flow
              </p>
            </div>
          </NavLink>

          {/* Center nav */}
          <nav
            className="flex-1 min-w-0 flex items-center overflow-x-auto scrollbar-none"
            style={{ gap: "1px" }}
            aria-label="Navegação principal"
          >
            {nav
              .filter((item) => item.roles.some((r) => roles.includes(r)))
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                  style={{ padding: "6px 11px", borderRadius: 6, fontSize: 13 }}
                >
                  <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
          </nav>

          {/* Right cluster */}
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
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              aria-label={theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-9 w-9 rounded-full bg-accent text-accent-foreground text-[12px] font-semibold flex items-center justify-center hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <main className="flex-1 min-w-0">
        <div
          className="mx-auto w-full"
          style={{ maxWidth: "1080px", padding: "32px 28px" }}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
};