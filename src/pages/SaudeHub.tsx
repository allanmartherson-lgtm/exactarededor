// Hub unificado de Saúde — agrupa Motor, Portais e Processo.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { Activity } from "lucide-react";
import HealthMonitoring from "./HealthMonitoring";
import PortalHealth from "./PortalHealth";
import ProcessHealth from "./ProcessHealth";

type TabValue = "motor" | "portais" | "processo";

const TABS: { value: TabValue; label: string }[] = [
  { value: "motor", label: "Motor" },
  { value: "portais", label: "Portais" },
  { value: "processo", label: "Processo" },
];

const VALID = new Set(TABS.map((t) => t.value));

export default function SaudeHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabValue | null;
  const active: TabValue = raw && VALID.has(raw) ? raw : "motor";

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const content = useMemo(() => {
    switch (active) {
      case "motor": return <HealthMonitoring embedded />;
      case "portais": return <PortalHealth embedded />;
      case "processo": return <ProcessHealth embedded />;
    }
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Saúde"
        description="Visão unificada da saúde do motor, dos portais de acesso e do processo (produtividade, IA, SLA)."
        icon={Activity}
      />
      <div className="p-4 md:p-6 space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="Seções de Saúde">
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
                    : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-pressed={isActive}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        {content}
      </div>
    </div>
  );
}
