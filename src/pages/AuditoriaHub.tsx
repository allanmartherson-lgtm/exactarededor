// Hub unificado de Auditoria — agrupa log geral, trocas de hospital, exportações, anomalias, insights e TUSS principal.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";
import AuditLog from "./AuditLog";
import HospitalSwitchLog from "./HospitalSwitchLog";
import ExportAudit from "./ExportAudit";
import StatusAnomalies from "./StatusAnomalies";
import ObservationInsights from "./ObservationInsights";
import AuditoriaTussPrincipal from "./AuditoriaTussPrincipal";
import IsolationEvents from "./IsolationEvents";

type TabValue = "log" | "hospitais" | "exportacoes" | "anomalias" | "insights" | "tuss" | "isolamento";

const TABS: { value: TabValue; label: string }[] = [
  { value: "log", label: "Log geral" },
  { value: "isolamento", label: "Isolamento de hospitais" },
  { value: "anomalias", label: "Anomalias de status" },
  { value: "tuss", label: "TUSS principal" },
  { value: "exportacoes", label: "Exportações" },
  { value: "hospitais", label: "Trocas de hospital" },
  { value: "insights", label: "Insights de observações" },
];

const VALID = new Set(TABS.map((t) => t.value));

export default function AuditoriaHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabValue | null;
  const active: TabValue = raw && VALID.has(raw) ? raw : "log";

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const content = useMemo(() => {
    switch (active) {
      case "log": return <AuditLog embedded />;
      case "isolamento": return <IsolationEvents embedded />;
      case "hospitais": return <HospitalSwitchLog embedded />;
      case "exportacoes": return <ExportAudit embedded />;
      case "anomalias": return <StatusAnomalies embedded />;
      case "insights": return <ObservationInsights embedded />;
      case "tuss": return <AuditoriaTussPrincipal embedded />;
    }
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Auditoria"
        description="Histórico de alterações, anomalias de status, exportações, trocas de hospital, TUSS principal e insights de observações."
        icon={ShieldCheck}
      />
      <div className="p-4 md:p-6 space-y-6">
        <nav className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1" aria-label="Seções de Auditoria">
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
