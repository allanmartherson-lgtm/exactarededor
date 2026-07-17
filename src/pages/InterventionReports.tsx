/**
 * Relatórios de Intervenção — página única com subtabs, no padrão de
 * Inteligência Financeira. Consolida Ajustes e Auditoria. As correções
 * do analista deixaram de ter tela dedicada: aparecem em "Ajustes" com
 * o filtro "Papel do autor = Analista" (deep link legado redireciona).
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import InterventionAdjustments from "./InterventionAdjustments";
import InterventionAudit from "./InterventionAudit";

type TabValue = "ajustes" | "auditoria";

interface TabDef {
  value: TabValue;
  label: string;
  roles: ReadonlyArray<"admin" | "diretor" | "validador" | "analista">;
  render: () => JSX.Element;
}

const GROUPS: { label: string; items: TabDef[] }[] = [
  {
    label: "Impacto",
    items: [
      {
        value: "ajustes",
        label: "Ajustes por intervenção",
        roles: ["diretor", "admin", "validador", "analista"] as const,
        render: () => <InterventionAdjustments />,
      },
    ],
  },
  {
    label: "Rastreabilidade",
    items: [
      {
        value: "auditoria",
        label: "Auditoria de intervenções",
        roles: ["diretor", "admin", "validador"] as const,
        render: () => <InterventionAudit />,
      },
    ],
  },
];

export default function InterventionReports() {
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();

  const visibleGroups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.roles.some((r) => hasRole(r))),
      })).filter((g) => g.items.length > 0),
    [hasRole],
  );

  const allItems = visibleGroups.flatMap((g) => g.items);
  const requested = params.get("view") as TabValue | null;
  const active: TabValue =
    requested && allItems.some((i) => i.value === requested)
      ? requested
      : (allItems[0]?.value ?? "ajustes");
  const activeItem = allItems.find((i) => i.value === active);

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("view", v);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Relatórios de Intervenção"
        description="Ajustes, correções do analista, auditoria de eventos e pagamentos cancelados — em uma visão unificada."
        icon={Scale}
        showBack={false}
      />
      <div className="p-6 space-y-6">
        <nav className="flex flex-wrap gap-x-8 gap-y-4" aria-label="Seções de Relatórios de Intervenção">
          {visibleGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground/90 font-semibold">
                {group.label}
              </span>
              <div className="flex flex-wrap gap-2">
                {group.items.map((item) => {
                  const isActive = active === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setActive(item.value)}
                      className={cn(
                        "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      aria-pressed={isActive}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div>{activeItem?.render()}</div>
      </div>
    </div>
  );
}
