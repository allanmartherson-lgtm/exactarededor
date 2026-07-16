// Hub de Relacionamento — agrupa Simulador de Margem e (futuramente) Acordos.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { Handshake } from "lucide-react";
import { AurumMargemUpload } from "@/components/relacionamento/AurumMargemUpload";
import { SimuladorMargem } from "@/components/relacionamento/SimuladorMargem";
import { ProcedureAliasManager } from "@/components/relacionamento/ProcedureAliasManager";

type TabValue = "simulador-margem" | "bases-aurum" | "aliases";

const TABS: { value: TabValue; label: string }[] = [
  { value: "simulador-margem", label: "Simulador de Margem" },
  { value: "bases-aurum", label: "Bases Aurum" },
  { value: "aliases", label: "Aliases Procedimento" },
];


const VALID = new Set(TABS.map((t) => t.value));

export default function RelacionamentoHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabValue | null;
  const active: TabValue = raw && VALID.has(raw) ? raw : "simulador-margem";

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const content = useMemo(() => {
    switch (active) {
      case "bases-aurum":
        return (
          <div className="space-y-6">
            <AurumMargemUpload />
          </div>
        );
      case "aliases":
        return <ProcedureAliasManager />;
      case "simulador-margem":
        return <SimuladorMargem />;
    }
  }, [active]);


  return (
    <div>
      <PageHeader
        title="Relacionamento"
        description="Gestão de acordos comerciais e simulação de margem cirúrgica"
        icon={Handshake}
      />
      <div className="p-4 md:p-6 space-y-6">
        <nav
          className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1"
          aria-label="Seções de Relacionamento"
        >
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
