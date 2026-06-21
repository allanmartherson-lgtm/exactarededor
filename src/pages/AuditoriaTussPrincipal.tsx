import { PageHeader } from "@/components/PageHeader";
import { TussPrincipalAuditPanel } from "@/components/payment-detail/TussPrincipalAuditPanel";

export default function AuditoriaTussPrincipal({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <div className={embedded ? "space-y-4" : "container mx-auto py-4 space-y-4"}>
      {!embedded && (
        <PageHeader
          title="Auditoria de TUSS principal"
          description="Itens em que o motor não usou o TUSS principal do procedimento como chave para selecionar a regra/cálculo. Pagamentos com pendência aqui ficam bloqueados para aprovação."
        />
      )}
      <TussPrincipalAuditPanel />
    </div>
  );
}
