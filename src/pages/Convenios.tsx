import ConveniosManager from "@/components/ConveniosManager";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RegistryAliasesPanel } from "@/components/RegistryAliasesPanel";

export default function Convenios() {
  const { roles } = useAuth() as { roles?: string[] };
  const canManage = !!roles?.some(r => r === "admin" || r === "diretor");
  return (
    <div className="flex flex-col h-full w-full">
      <PageHeader
        title="Convênios"
        description="Cadastro central de convênios/operadoras com aliases para padronização das planilhas."
      />
      <div className="p-4 md:p-8 w-full mx-auto">
        <Tabs defaultValue="list" className="w-full">
          <TabsList>
            <TabsTrigger value="list">Cadastro</TabsTrigger>
            <TabsTrigger value="aliases">Aliases</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="mt-4">
            <ConveniosManager canManage={canManage} />
          </TabsContent>
          <TabsContent value="aliases" className="mt-4">
            <RegistryAliasesPanel kind="convenio" canManage={canManage} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
