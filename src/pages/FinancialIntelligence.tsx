import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { TrendingUp } from "lucide-react";
import { BenchmarkTab } from "@/components/financial-intelligence/BenchmarkTab";
import { LossTrendTab } from "@/components/financial-intelligence/LossTrendTab";
import { ProjectionTab } from "@/components/financial-intelligence/ProjectionTab";
import { DoctorConcentrationTab } from "@/components/financial-intelligence/DoctorConcentrationTab";

export default function FinancialIntelligence() {
  return (
    <div>
      <PageHeader
        title="Inteligência Financeira"
        description="Benchmark, tendências e projeções a partir do histórico de pagamentos"
        icon={TrendingUp}
        showBack={false}
      />
      <div className="p-6">
        <Tabs defaultValue="benchmark" className="space-y-4">
          <TabsList>
            <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
            <TabsTrigger value="tendencia">Tendência</TabsTrigger>
            <TabsTrigger value="projecao">Projeção</TabsTrigger>
            <TabsTrigger value="concentracao">Concentração</TabsTrigger>
          </TabsList>
          <TabsContent value="benchmark"><BenchmarkTab /></TabsContent>
          <TabsContent value="tendencia"><LossTrendTab /></TabsContent>
          <TabsContent value="projecao"><ProjectionTab /></TabsContent>
          <TabsContent value="concentracao"><DoctorConcentrationTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
