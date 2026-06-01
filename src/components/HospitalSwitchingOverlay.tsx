import { useHospital } from "@/contexts/HospitalContext";
import { Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Overlay full-screen exibido durante a troca de hospital.
 * Bloqueia cliques (pointer-events) e dá feedback visual de que os dados
 * estão sendo recarregados, evitando que o usuário interaja com tela "suja".
 */
export const HospitalSwitchingOverlay = () => {
  const { switching, hospital } = useHospital();

  return (
    <div
      aria-hidden={!switching}
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-200",
        switching ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
      <div className="relative flex flex-col items-center gap-4 rounded-xl border bg-card px-8 py-6 shadow-xl">
        <div className="relative">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-primary" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold">Trocando hospital…</p>
          {hospital && (
            <p className="text-xs text-muted-foreground">
              Carregando dados de <span className="font-medium">{hospital.name}</span>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/80">Aguarde — ações temporariamente bloqueadas.</p>
        </div>
      </div>
    </div>
  );
};
