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

type TabValue = "versoes" | "feature-flags" | "copiloto" | "avisos";

const TABS: { value: TabValue; label: string }[] = [
  { value: "versoes", label: "Versões" },
  { value: "feature-flags", label: "Feature Flags" },
  { value: "copiloto", label: "Telemetria do Copiloto" },
  { value: "avisos", label: "Avisos do Sistema" },
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
    }
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Sistema"
        description="Releases e changelog, feature flags, telemetria do copiloto e avisos globais."
        icon={Settings}
      />
      <div className="p-4 md:p-6 space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="Seções de Sistema">
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
