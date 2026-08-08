import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS, type NavItem, type NavLeaf } from "@/config/navItems";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Mantido por compatibilidade; não renderiza mais o quadradinho de ícone. */
  icon?: LucideIcon;
  /** Mostra botão "Voltar" à esquerda do título. Default: false (navegação via breadcrumb). */
  showBack?: boolean;
  backFallback?: string;
  /** Mantidos por compatibilidade; o novo header não fica mais sticky por default. */
  sticky?: boolean;
  stickyOffset?: number;
  /** Sobrescreve/desliga o breadcrumb derivado do nav. Use `false` para ocultar. */
  breadcrumb?: Array<{ label: string; to?: string }> | false;
}

type Crumb = { label: string; to?: string };

function isLeaf(item: NavItem): item is NavLeaf {
  return (item as NavLeaf).to !== undefined;
}

/** Deriva breadcrumb a partir do NAV_ITEMS com base no pathname atual. */
function deriveCrumbs(pathname: string): Crumb[] {
  let best: { leaf: NavLeaf; parentLabel?: string; score: number } | null = null;
  for (const item of NAV_ITEMS) {
    if (isLeaf(item)) {
      const score =
        item.to === pathname ? 1000 : pathname.startsWith(item.to + "/") ? item.to.length : 0;
      if (score && (!best || score > best.score)) best = { leaf: item, score };
    } else {
      for (const child of item.children) {
        const score =
          child.to === pathname
            ? 1000
            : pathname.startsWith(child.to + "/")
              ? child.to.length
              : 0;
        if (score && (!best || score > best.score))
          best = { leaf: child, parentLabel: item.label, score };
      }
    }
  }
  const crumbs: Crumb[] = [{ label: "Dashboard", to: "/" }];
  if (!best) return crumbs;
  if (best.parentLabel) crumbs.push({ label: best.parentLabel });
  crumbs.push({ label: best.leaf.label });
  return crumbs;
}

/**
 * PageHeader — Padrão visual unificado (Padrão BI).
 *
 * Breadcrumb derivado do nav + título grande (text-[34px]) + subtítulo discreto.
 * Sem botão voltar por default — a navegação para trás fica a cargo do breadcrumb.
 */
export const PageHeader = ({
  title,
  description,
  actions,
  showBack = false,
  backFallback = "/",
  breadcrumb,
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

  // O <Breadcrumbs /> global do AppLayout cobre a navegação por padrão.
  // Esta prop só é usada quando a página passa um breadcrumb explícito (override).
  const crumbs: Crumb[] | null =
    breadcrumb === false ? null : breadcrumb && breadcrumb.length ? breadcrumb : null;

  return (
    <div className="px-6 pt-6 pb-4">
      {crumbs && crumbs.length > 1 && (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2"
        >
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3 w-3 opacity-60" />}
                {c.to && !isLast ? (
                  <Link to={c.to} className="hover:text-foreground transition-colors">
                    {c.label}
                  </Link>
                ) : (
                  <span className={isLast ? "text-foreground" : ""}>{c.label}</span>
                )}
              </span>
            );
          })}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap min-w-0">
        <div className="flex items-start gap-3 min-w-0 flex-1">
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
          <div className="min-w-0 w-full">
            <h1 className="text-[34px] font-semibold tracking-tight text-foreground leading-none truncate">
              {title}
            </h1>
            {description && (
              typeof description === "string"
                ? <p className="text-sm text-muted-foreground mt-2">{description}</p>
                : <div className="mt-2">{description}</div>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap justify-end min-w-0 max-w-full">{actions}</div>
        )}
      </div>
    </div>
  );
};
