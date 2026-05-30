import ConveniosManager from "@/components/ConveniosManager";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";

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
        <ConveniosManager canManage={canManage} />
      </div>
    </div>
  );
}
