// Hub unificado de Casos Especiais — agrupa Fila, Relatório e Tipos.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { Stethoscope } from "lucide-react";
import SpecialCases from "./SpecialCases";
import SpecialCasesReport from "./SpecialCasesReport";
import SpecialCaseTypesAdmin from "./SpecialCaseTypesAdmin";

type TabValue = "fila" | "relatorio" | "tipos";

const TABS: { value: TabValue; label: string }[] = [
  { value: "fila", label: "Fila" },
  { value: "relatorio", label: "Relatório" },
  { value: "tipos", label: "Tipos" },
];

const VALID = new Set(TABS.map((t) => t.value));

export default function SpecialCasesHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabValue | null;
  const active: TabValue = raw && VALID.has(raw) ? raw : "fila";

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const content = useMemo(() => {
    switch (active) {
      case "fila": return <SpecialCases embedded />;
      case "relatorio": return <SpecialCasesReport embedded />;
      case "tipos": return <SpecialCaseTypesAdmin embedded />;
    }
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Casos Especiais"
        description="Marcações de patologias com tratamento diferenciado — fila de aprovação, relatório e catálogo de tipos."
        icon={Stethoscope}
      />
      <div className="p-4 md:p-6 space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="Seções de Casos Especiais">
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
