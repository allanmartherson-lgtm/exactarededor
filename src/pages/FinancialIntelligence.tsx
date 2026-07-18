import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { TrendingUp } from "lucide-react";
import { TrendProjectionTab } from "@/components/financial-intelligence/TrendProjectionTab";
import { DoctorConcentrationTab } from "@/components/financial-intelligence/DoctorConcentrationTab";
import { ValidationRiskSection } from "@/components/financial-intelligence/ValidationRiskSection";
import {
  useDreData,
  DreFilters,
  DreKpis,
  DreConsolidadoSection,
  PosicaoAbertoSection,
} from "@/components/financial-intelligence/DreResultadoShared";
import { cn } from "@/lib/utils";

type TabValue = "dre-consolidado" | "posicao-aberto" | "tendencia-projecao" | "concentracao" | "em-risco";

const RESULT_TABS: TabValue[] = ["dre-consolidado", "posicao-aberto"];

const GROUPS: { label: string; items: { value: TabValue; label: string }[] }[] = [
  {
    label: "Resultado",
    items: [
      { value: "dre-consolidado", label: "DRE Consolidado" },
      { value: "posicao-aberto", label: "Posição em Aberto" },
    ],
  },
  {
    label: "Análise",
    items: [
      { value: "tendencia-projecao", label: "Tendência e Projeção" },
      { value: "concentracao", label: "Concentração" },
      { value: "em-risco", label: "Em risco" },
    ],
  },
];

export default function FinancialIntelligence() {
  const [active, setActive] = useState<TabValue>("dre-consolidado");
  const dreData = useDreData();
  const showResultShared = RESULT_TABS.includes(active);

  return (
    <div>
      <PageHeader
        title="Inteligência Financeira"
        description="Resultado (DRE e posição em aberto) e análise (tendências, projeção e concentração)"
        icon={TrendingUp}
        showBack={false}
      />
      <div className="p-6 space-y-6">
        <nav className="flex flex-wrap gap-x-8 gap-y-4" aria-label="Seções de Inteligência Financeira">
          {GROUPS.map((group) => (
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

        {showResultShared && (
          <div className="space-y-4">
            <DreFilters
              from={dreData.from}
              setFrom={dreData.setFrom}
              to={dreData.to}
              setTo={dreData.setTo}
              track={dreData.track}
              setTrack={dreData.setTrack}
              loading={dreData.loading}
              onReload={dreData.load}
            />
            <DreKpis dre={dreData.dre} open={dreData.open} />
          </div>
        )}

        {active === "dre-consolidado" && <DreConsolidadoSection dre={dreData.dre} track={dreData.track} />}
        {active === "posicao-aberto" && <PosicaoAbertoSection open={dreData.open} />}
        {active === "tendencia-projecao" && <TrendProjectionTab track={dreData.track} />}
        {active === "concentracao" && <DoctorConcentrationTab track={dreData.track} />}
        {active === "em-risco" && <ValidationRiskSection track={dreData.track} />}
      </div>
    </div>
  );
}
