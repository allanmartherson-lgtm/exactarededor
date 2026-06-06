import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { TrendingUp } from "lucide-react";
import { BenchmarkTab } from "@/components/financial-intelligence/BenchmarkTab";
import { LossTrendTab } from "@/components/financial-intelligence/LossTrendTab";
import { ProjectionTab } from "@/components/financial-intelligence/ProjectionTab";
import { DoctorConcentrationTab } from "@/components/financial-intelligence/DoctorConcentrationTab";
import { FunnelTab } from "@/components/financial-intelligence/FunnelTab";
import { StuckCompaniesTab } from "@/components/financial-intelligence/StuckCompaniesTab";

export default function FinancialIntelligence() {
  return (
    <div>
      <PageHeader
        title="Inteligência Financeira"
        description="Hub único do ciclo financeiro: funil e PJs travadas (ciclo) + benchmark, tendências, projeções e concentração (análise)"
        icon={TrendingUp}
        showBack={false}
      />
      <div className="p-6">
        <Tabs defaultValue="funil" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap items-center gap-1 p-1">
            <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/90">
              Ciclo
            </span>
            <TabsTrigger
              value="funil"
              className="font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              Funil
            </TabsTrigger>
            <TabsTrigger
              value="pjs-travadas"
              className="font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              PJs travadas
            </TabsTrigger>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/90">
              Análise
            </span>
            <TabsTrigger
              value="benchmark"
              className="font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              Benchmark
            </TabsTrigger>
            <TabsTrigger
              value="tendencia"
              className="font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              Tendência
            </TabsTrigger>
            <TabsTrigger
              value="projecao"
              className="font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              Projeção
            </TabsTrigger>
            <TabsTrigger
              value="concentracao"
              className="font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              Concentração
            </TabsTrigger>
          </TabsList>
          <TabsContent value="funil"><FunnelTab /></TabsContent>
          <TabsContent value="pjs-travadas"><StuckCompaniesTab /></TabsContent>
          <TabsContent value="benchmark"><BenchmarkTab /></TabsContent>
          <TabsContent value="tendencia"><LossTrendTab /></TabsContent>
          <TabsContent value="projecao"><ProjectionTab /></TabsContent>
          <TabsContent value="concentracao"><DoctorConcentrationTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
