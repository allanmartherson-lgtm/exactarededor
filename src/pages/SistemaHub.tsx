// Hub unificado de Sistema — agrupa Versões, Feature Flags, Telemetria do Copiloto e Avisos.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { Settings } from "lucide-react";
import SystemReleases from "./SystemReleases";
import FeatureFlagsAdmin from "./FeatureFlagsAdmin";
import CopilotTelemetry from "./CopilotTelemetry";
import SystemAnnouncementsAdmin from "./SystemAnnouncementsAdmin";
import SystemParameters from "./SystemParameters";

type TabValue = "versoes" | "feature-flags" | "copiloto" | "avisos" | "parametros";

const TABS: { value: TabValue; label: string }[] = [
  { value: "versoes", label: "Versões" },
  { value: "feature-flags", label: "Feature Flags" },
  { value: "copiloto", label: "Telemetria do Copiloto" },
  { value: "avisos", label: "Avisos do Sistema" },
  { value: "parametros", label: "Parâmetros" },
];

const VALID = new Set(TABS.map((t) => t.value));

export default function SistemaHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabValue | null;
  const active: TabValue = raw && VALID.has(raw) ? raw : "versoes";

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const content = useMemo(() => {
    switch (active) {
      case "versoes": return <SystemReleases embedded />;
      case "feature-flags": return <FeatureFlagsAdmin embedded />;
      case "copiloto": return <CopilotTelemetry embedded />;
      case "avisos": return <SystemAnnouncementsAdmin embedded />;
      case "parametros": return <SystemParameters embedded />;
    }
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Sistema"
        description="Parâmetros, releases, feature flags, telemetria do copiloto e avisos globais."
        icon={Settings}
      />
      <div className="p-4 md:p-6 space-y-6">
        <nav className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1" aria-label="Seções de Sistema">
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
        {content}
      </div>
    </div>
  );
}
