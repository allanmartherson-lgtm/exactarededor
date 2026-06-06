import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import Invoices from "./Invoices";
import NfCycle from "./NfCycle";

type TabValue = "pedidos" | "ciclo";

const TABS: { value: TabValue; label: string }[] = [
  { value: "pedidos", label: "Pedidos" },
  { value: "ciclo", label: "Ciclo de NF" },
];

export default function NotasFiscaisHub() {
  const [active, setActive] = useState<TabValue>("pedidos");

  return (
    <div>
      <PageHeader
        title="Notas Fiscais"
        description="Pedidos enviados, notas recebidas e gestão do ciclo fiscal."
        icon={FileText}
        showBack={false}
      />
      <div className="p-6 space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="Seções de Notas Fiscais">
          {TABS.map((item) => {
            const isActive = active === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setActive(item.value)}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-pressed={isActive}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {active === "pedidos" && <Invoices embedded />}
        {active === "ciclo" && <NfCycle embedded />}
      </div>
    </div>
  );
}
