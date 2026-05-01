import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/status";
import { LayoutDashboard, FileText, ScrollText, Users, LogOut, ShieldCheck, Receipt, Table2, Building2, Network } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/pagamentos", label: "Pagamentos", icon: FileText, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/notas-fiscais", label: "Notas Fiscais", icon: Receipt, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/regras", label: "Regras", icon: ScrollText, roles: ["diretor", "admin"] as const },
  { to: "/tabelas", label: "Tabelas de referência", icon: Table2, roles: ["diretor", "admin"] as const },
  { to: "/empresas", label: "Empresas", icon: Building2, roles: ["diretor", "admin"] as const },
  { to: "/centros-de-custo", label: "Centros de custo", icon: Network, roles: ["analista", "validador", "diretor", "admin"] as const },
  { to: "/usuarios", label: "Usuários", icon: Users, roles: ["admin"] as const },
];

export const AppLayout = () => {
  const { user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const primaryRole = (["admin", "diretor", "validador", "analista"] as const).find((r) => roles.includes(r));

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex-shrink-0 flex flex-col border-r border-sidebar-border">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-gradient-brand flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight text-sidebar-accent-foreground">MedPay</p>
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Approval Flow</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav
            .filter((item) => item.roles.some((r) => roles.includes(r)))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
        </nav>

        <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
          <div className="px-2 py-2 rounded-md bg-sidebar-accent/40">
            <p className="text-xs font-medium text-sidebar-accent-foreground truncate">{user?.email}</p>
            <p className="text-[10px] text-sidebar-foreground/70 mt-0.5">
              {primaryRole ? ROLE_LABELS[primaryRole] : "—"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
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