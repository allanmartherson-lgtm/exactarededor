import SectorsManager from "@/components/SectorsManager";
import { PageHeader } from "@/components/PageHeader";

/**
 * Página standalone de Setores — mantida para compatibilidade de URL/links.
 * A experiência principal agora vive como sub-aba em /centros-de-custo.
 */
export default function Sectors() {
  return (
    <div className="flex flex-col h-full w-full">
      <PageHeader title="Setores" description="Padronização dos nomes de setor que vêm da base." />
      <div className="p-4 md:p-8 w-full mx-auto">
        <SectorsManager />
      </div>
    </div>
  );
}
