import { PageHeader } from "@/components/PageHeader";

export default function ValidationRules() {
  return (
    <div>
      <PageHeader
        title="Regras de Validação"
        description="Estrutura inicial — em breve."
      />
      <div className="mt-6 rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        Nenhuma regra de validação configurada ainda.
      </div>
    </div>
  );
}