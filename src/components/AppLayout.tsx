import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/status";
import { LayoutDashboard, FileText, ScrollText, Users, LogOut, ShieldCheck, Receipt, Table2, Building2, Network, History, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/pagamentos", label: "Pagamentos", icon: FileText, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/notas-fiscais", label: "Notas Fiscais", icon: Receipt, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/regras", label: "Regras", icon: ScrollText, roles: ["diretor", "admin"] as const },
  { to: "/tabelas", label: "Tabelas de referência", icon: Table2, roles: ["diretor", "admin"] as const },
  { to: "/empresas", label: "Empresas", icon: Building2, roles: ["diretor", "admin"] as const },
  { to: "/centros-de-custo", label: "Centros de custo", icon: Network, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/usuarios", label: "Usuários", icon: Users, roles: ["admin"] as const },
  { to: "/auditoria", label: "Auditoria", icon: History, roles: ["diretor", "admin"] as const },
];

export const AppLayout = () => {
  const { user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const primaryRole = (["admin", "diretor", "validador", "analista"] as const).find((r) => roles.includes(r));

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-56 lg:w-64 xl:w-72 bg-sidebar text-sidebar-foreground flex-shrink-0 flex flex-col border-r border-sidebar-border shadow-[1px_0_3px_0_hsl(var(--foreground)/0.04),4px_0_12px_-6px_hsl(var(--foreground)/0.06)] dark:shadow-[1px_0_0_0_hsl(var(--sidebar-border))]">
        <div className="px-4 lg:px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-gradient-brand flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-tight text-sidebar-foreground truncate">MedPay</p>
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/75 truncate">Approval Flow</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 lg:px-3 py-4 space-y-0.5 overflow-y-auto">
          {nav
            .filter((item) => item.roles.some((r) => roles.includes(r)))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center gap-2.5 pl-3 pr-2.5 lg:pr-3 py-2 rounded-md text-[13px] lg:text-sm leading-tight transition-all outline-none",
                    "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm hover:bg-sidebar-accent/90 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-full before:bg-sidebar-primary"
                      : "text-sidebar-foreground/85 hover:bg-sidebar-hover hover:text-sidebar-hover-foreground hover:translate-x-0.5 focus-visible:bg-sidebar-hover focus-visible:text-sidebar-hover-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={cn(
                        "h-4 w-4 flex-shrink-0 transition-colors",
                        isActive
                          ? "text-sidebar-primary"
                          : "text-sidebar-foreground/60 group-hover:text-sidebar-hover-foreground group-focus-visible:text-sidebar-hover-foreground",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
        </nav>

        <div className="px-2 lg:px-3 py-3 border-t border-sidebar-border space-y-2">
          <div className="px-2 py-2 rounded-md bg-sidebar-hover min-w-0">
            <p className="text-[12px] font-medium text-sidebar-foreground truncate" title={user?.email ?? undefined}>{user?.email}</p>
            <p className="text-[10px] text-sidebar-muted-foreground mt-0.5 truncate">
              {primaryRole ? ROLE_LABELS[primaryRole] : "—"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className="w-full justify-start text-[13px] text-sidebar-foreground/85 hover:bg-sidebar-hover hover:text-sidebar-hover-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            aria-label={theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
            {theme === "dark" ? "Modo claro" : "Modo escuro"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="w-full justify-start text-[13px] text-sidebar-foreground/85 hover:bg-sidebar-hover hover:text-sidebar-hover-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          >
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-x-auto">
        <Outlet />
      </main>
    </div>
  );
};