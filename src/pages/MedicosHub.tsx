import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import Doctors from "./Doctors";
import ProcedureSpecialtyMap from "./ProcedureSpecialtyMap";

type TabValue = "medicos" | "mapa-especialidades";

const TABS: { value: TabValue; label: string }[] = [
  { value: "medicos", label: "Médicos" },
  { value: "mapa-especialidades", label: "Mapa de Especialidades" },
];

export default function MedicosHub() {
  const [active, setActive] = useState<TabValue>("medicos");

  return (
    <div>
      <PageHeader
        title="Médicos"
        description="Cadastro de médicos, vínculos com PJs e mapa de código → especialidade."
        icon={Stethoscope}
      />
      <div className="p-6 space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="Seções de Médicos">
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

        {active === "medicos" && <Doctors embedded />}
        {active === "mapa-especialidades" && <ProcedureSpecialtyMap embedded />}
      </div>
    </div>
  );
}
