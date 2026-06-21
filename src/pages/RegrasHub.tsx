// Hub unificado de Regras — agrupa Pagamento, Validação, Simulador e Simulador em lote.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { BadgeDollarSign } from "lucide-react";
import Rules from "./Rules";
import ValidationRules from "./ValidationRules";
import RuleSimulator from "./RuleSimulator";
import RuleSimulatorBatch from "./RuleSimulatorBatch";

type TabValue = "pagamento" | "validacao" | "simulador" | "simulador-lote";

const TABS: { value: TabValue; label: string }[] = [
  { value: "pagamento", label: "Pagamento" },
  { value: "validacao", label: "Validação" },
  { value: "simulador", label: "Simulador" },
  { value: "simulador-lote", label: "Simulador em lote" },
];

const VALID = new Set(TABS.map((t) => t.value));

export default function RegrasHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabValue | null;
  const active: TabValue = raw && VALID.has(raw) ? raw : "pagamento";

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const content = useMemo(() => {
    switch (active) {
      case "pagamento": return <Rules embedded />;
      case "validacao": return <ValidationRules embedded />;
      case "simulador": return <RuleSimulator embedded />;
      case "simulador-lote": return <RuleSimulatorBatch embedded />;
    }
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Regras"
        description="Regras de pagamento e validação aplicadas pela IA, com simuladores para testar cenários antes de publicar."
        icon={BadgeDollarSign}
      />
      <div className="p-4 md:p-6 space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="Seções de Regras">
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
