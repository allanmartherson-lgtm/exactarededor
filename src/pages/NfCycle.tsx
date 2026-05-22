import { PageHeader } from "@/components/PageHeader";
import { FileWarning } from "lucide-react";
import { InvoiceAgingSection } from "@/components/nf-cycle/InvoiceAgingSection";
import { FiscalDeadlineAlerts } from "@/components/nf-cycle/FiscalDeadlineAlerts";
import { ResendHistorySection } from "@/components/nf-cycle/ResendHistorySection";

export default function NfCycle() {
  return (
    <div>
      <PageHeader
        title="Ciclo de NF"
        description="Gestão de notas fiscais pendentes, prazos e reenvios"
        icon={FileWarning}
        showBack={false}
      />
      <div className="p-6 space-y-6">
        <InvoiceAgingSection />
        <FiscalDeadlineAlerts />
        <ResendHistorySection />
      </div>
    </div>
  );
}
