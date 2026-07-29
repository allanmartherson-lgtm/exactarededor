// Hub unificado de Cadastros — substitui entradas separadas no menu
// (Empresas / Médicos / Convênios / Setores e Centros / Tipos de pagamento / Diretores).
// As rotas antigas continuam funcionando, redirecionando para a aba correspondente.
// Hospitais NÃO ficam aqui — administrar hospital é via /hospitais (HospitaisHub),
// que traz dados cadastrais + piso + reaprovação + módulo de fluxo no mesmo lugar.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { FolderKanban } from "lucide-react";
import Companies from "./Companies";
import Doctors from "./Doctors";
import ProcedureSpecialtyMap from "./ProcedureSpecialtyMap";
import Convenios from "./Convenios";
import CostCenters from "./CostCenters";
import PaymentTypes from "./PaymentTypes";
import PaymentModels from "./PaymentModels";
import ItemTypes from "./ItemTypes";
import ManualInterventionReasons from "./ManualInterventionReasons";
import PayoutModels from "./PayoutModels";
import Specialties from "./Specialties";

type TabValue =
  | "empresas"
  | "medicos"
  | "convenios"
  | "centros-de-custo"
  | "modelos-pagamento"
  | "tipos-item"
  | "tipos-pagamento"
  | "motivos-intervencao-manual"
  | "mapa-especialidades"
  | "especialidades"
  | "modelos-repasse";

const TABS: { value: TabValue; label: string }[] = [
  { value: "empresas", label: "Empresas" },
  { value: "medicos", label: "Médicos" },
  { value: "convenios", label: "Convênios" },
  { value: "centros-de-custo", label: "Setores e Centros" },
  { value: "modelos-pagamento", label: "Modelos de Pagamento" },
  { value: "tipos-item", label: "Tipos de Item" },
  { value: "motivos-intervencao-manual", label: "Motivos de Tratamento Manual" },
  { value: "especialidades", label: "Especialidades" },
  { value: "mapa-especialidades", label: "Mapa de Especialidades" },
  { value: "modelos-repasse", label: "Modelos de Repasse" },
];

const VALID = new Set(TABS.map((t) => t.value));

export default function CadastrosHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabValue | null;
  const active: TabValue = raw && VALID.has(raw) ? raw : "empresas";

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const content = useMemo(() => {
    switch (active) {
      case "empresas": return <Companies embedded />;
      case "medicos": return <Doctors embedded />;
      case "convenios": return <Convenios embedded />;
      case "centros-de-custo": return <CostCenters embedded />;
      case "modelos-pagamento": return <PaymentModels embedded />;
      case "tipos-item": return <ItemTypes embedded />;
      case "tipos-pagamento": return <PaymentTypes embedded />;
      case "motivos-intervencao-manual": return <ManualInterventionReasons embedded />;
      case "especialidades": return <Specialties embedded />;
      case "mapa-especialidades": return <ProcedureSpecialtyMap embedded />;
      case "modelos-repasse": return <PayoutModels embedded />;
    }
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Cadastros"
        description="Empresas, médicos, convênios, setores, tipos de pagamento e diretores aprovadores — tudo em um só lugar."
        icon={FolderKanban}
      />

      <div className="p-4 md:p-6 space-y-6">
        <nav className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1" aria-label="Seções de Cadastros">
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
