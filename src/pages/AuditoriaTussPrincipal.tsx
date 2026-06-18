import { PageHeader } from "@/components/PageHeader";
import { TussPrincipalAuditPanel } from "@/components/payment-detail/TussPrincipalAuditPanel";

export default function AuditoriaTussPrincipal() {
  return (
    <div className="container mx-auto py-4 space-y-4">
      <PageHeader
        title="Auditoria de TUSS principal"
        description="Itens em que o motor não usou o TUSS principal do procedimento como chave para selecionar a regra/cálculo. Pagamentos com pendência aqui ficam bloqueados para aprovação."
      />
      <TussPrincipalAuditPanel />
    </div>
  );
}
