import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Mostra o botão "Voltar" à esquerda do título. Default: true. */
  showBack?: boolean;
  /** Rota de fallback caso não haja histórico (ex: usuário entrou direto via URL). */
  backFallback?: string;
  /** Fixa o cabeçalho no topo da viewport ao rolar. Default: false. */
  sticky?: boolean;
  /** Offset (em px) onde o header deve "grudar". Útil quando há topbar global. Default: 56. */
  stickyOffset?: number;
}

export const PageHeader = ({
  title,
  description,
  actions,
  showBack = true,
  backFallback = "/",
  sticky = false,
  stickyOffset = 56,
}: PageHeaderProps) => {
  const navigate = useNavigate();

  const handleBack = () => {
    // Se há histórico nesta sessão, volta. Senão, vai pro fallback.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(backFallback);
    }
  };

  return (
    <div
      className={
        sticky
          ? "border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 px-8 py-4 sticky z-30 shadow-sm"
          : "border-b border-border bg-card px-8 py-6"
      }
      style={sticky ? { top: stickyOffset } : undefined}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          {showBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Voltar"
              className="-ml-2 mt-0.5 h-8 w-8 shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className={sticky ? "text-xl font-semibold tracking-tight" : "text-2xl font-semibold tracking-tight"}>{title}</h1>
            {description && (
              <p className={sticky ? "text-xs text-muted-foreground mt-0.5" : "text-sm text-muted-foreground mt-1"}>{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
};