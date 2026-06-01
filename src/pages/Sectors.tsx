import SectorsManager from "@/components/SectorsManager";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RegistryAliasesPanel } from "@/components/RegistryAliasesPanel";

/**
 * Página standalone de Setores — mantida para compatibilidade de URL/links.
 * A experiência principal agora vive como sub-aba em /centros-de-custo.
 */
export default function Sectors() {
  return (
    <div className="flex flex-col h-full w-full">
      <PageHeader title="Setores" description="Padronização dos nomes de setor que vêm da base." />
      <div className="p-4 md:p-8 w-full mx-auto">
        <Tabs defaultValue="list" className="w-full">
          <TabsList>
            <TabsTrigger value="list">Cadastro</TabsTrigger>
            <TabsTrigger value="aliases">Aliases</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="mt-4">
            <SectorsManager />
          </TabsContent>
          <TabsContent value="aliases" className="mt-4">
            <RegistryAliasesPanel kind="sector" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
