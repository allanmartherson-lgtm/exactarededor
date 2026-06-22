import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Mantido por compatibilidade; não renderiza mais o quadradinho de ícone. */
  icon?: LucideIcon;
  /** Mostra botão "Voltar" à esquerda do título. Default: false (navegação via breadcrumb). */
  showBack?: boolean;
  backFallback?: string;
  /** Mantidos por compatibilidade; o novo header não fica mais sticky por default. */
  sticky?: boolean;
  stickyOffset?: number;
}

/**
 * PageHeader — Padrão visual unificado (Padrão BI).
 *
 * Renderizado transparente sobre o fundo da página, com título grande
 * (text-3xl) e subtítulo discreto. Sem botão voltar por default — a
 * navegação para trás fica a cargo do breadcrumb global. Ícone fica
 * preservado na API mas não é renderizado para manter a estética limpa
 * das telas de BI.
 */
export const PageHeader = ({
  title,
  description,
  actions,
  showBack = false,
  backFallback = "/",
}: PageHeaderProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    const forced = (location.state as { backTo?: string } | null)?.backTo;
    if (forced) {
      navigate(forced);
      return;
    }
    if (window.history.length > 1) navigate(-1);
    else navigate(backFallback);
  };

  return (
    <div className="px-6 pt-6 pb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          {showBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Voltar"
              className="-ml-2 mt-1 h-9 w-9 shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground leading-tight">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
};
