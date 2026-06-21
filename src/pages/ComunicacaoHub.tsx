// Hub unificado de Comunicação — agrupa Supervisão, Comunicação em massa, Aprovações e Integrações.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { MessageSquare } from "lucide-react";
import CommunicationSupervision from "./CommunicationSupervision";
import MassCommunication from "./MassCommunication";
import CampaignApprovalQueue from "./CampaignApprovalQueue";
import IntegrationsAdmin from "./IntegrationsAdmin";

type TabValue = "supervisao" | "massa" | "aprovacoes" | "integracoes";

const TABS: { value: TabValue; label: string }[] = [
  { value: "supervisao", label: "Supervisão" },
  { value: "massa", label: "Comunicação em massa" },
  { value: "aprovacoes", label: "Aprovações" },
  { value: "integracoes", label: "Integrações" },
];

const VALID = new Set(TABS.map((t) => t.value));

export default function ComunicacaoHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabValue | null;
  const active: TabValue = raw && VALID.has(raw) ? raw : "supervisao";

  const setActive = (v: TabValue) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const content = useMemo(() => {
    switch (active) {
      case "supervisao": return <CommunicationSupervision embedded />;
      case "massa": return <MassCommunication embedded />;
      case "aprovacoes": return <CampaignApprovalQueue embedded />;
      case "integracoes": return <IntegrationsAdmin embedded />;
    }
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Comunicação"
        description="Supervisão de atendimento, comunicação em massa, fila de aprovações e integrações de canais (e-mail, WhatsApp, portal)."
        icon={MessageSquare}
      />
      <div className="p-4 md:p-6 space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="Seções de Comunicação">
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
        {content}
      </div>
    </div>
  );
}
