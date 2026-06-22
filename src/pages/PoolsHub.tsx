import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Split } from "lucide-react";
import { cn } from "@/lib/utils";
import Pools from "./Pools";
import PoolsReport from "./PoolsReport";

type TabValue = "pools" | "relatorio";

const TABS: { value: TabValue; label: string }[] = [
  { value: "pools", label: "Pools" },
  { value: "relatorio", label: "Relatório" },
];

export default function PoolsHub() {
  const [active, setActive] = useState<TabValue>("pools");

  return (
    <div>
      <PageHeader
        title="Pools de rateio"
        description="Configuração de pools, ajustes financeiros e histórico de execuções."
        icon={Split}
      />
      <div className="p-6 space-y-6">
        <nav className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1" aria-label="Seções de Pools">
          {TABS.map((item) => {
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
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
                aria-pressed={isActive}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {active === "pools" && <Pools embedded />}
        {active === "relatorio" && <PoolsReport embedded />}
      </div>
    </div>
  );
}
