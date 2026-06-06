import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { TrendingUp } from "lucide-react";
import { LossTrendTab } from "@/components/financial-intelligence/LossTrendTab";
import { ProjectionTab } from "@/components/financial-intelligence/ProjectionTab";
import { DoctorConcentrationTab } from "@/components/financial-intelligence/DoctorConcentrationTab";


export default function FinancialIntelligence() {
  const triggerClass =
    "font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

  return (
    <div>
      <PageHeader
        title="Inteligência Financeira"
        description="Tendências de gasto, projeção e concentração de risco"
        icon={TrendingUp}
        showBack={false}
      />
      <div className="p-6">
        <Tabs defaultValue="tendencia" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap items-center gap-1 p-1">
            <TabsTrigger value="tendencia" className={triggerClass}>Tendência</TabsTrigger>
            <TabsTrigger value="projecao" className={triggerClass}>Projeção</TabsTrigger>
            <TabsTrigger value="concentracao" className={triggerClass}>Concentração</TabsTrigger>
          </TabsList>
          <TabsContent value="tendencia"><LossTrendTab /></TabsContent>
          <TabsContent value="projecao"><ProjectionTab /></TabsContent>
          <TabsContent value="concentracao"><DoctorConcentrationTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
