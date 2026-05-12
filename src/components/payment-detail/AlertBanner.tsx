import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertSeverity = "critico" | "alerta" | "informativo";

/**
 * Hierarquia visual padrão para alertas e informações.
 *
 * - critico:    cor forte, ícone de escudo, posição prioritária. Não pode passar despercebido.
 * - alerta:     destaque moderado, badge âmbar, visível sem interromper o fluxo.
 * - informativo: visual discreto, baixa saturação. Idealmente dentro de accordion/drawer.
 *
 * Use sempre que renderizar:
 *  - validações
 *  - resultados de análise
 *  - logs / detalhes de cálculo
 *  - explicações da IA
 *
 * Regra: o conteúdo principal (valor, status, ação) deve sempre ter prioridade visual.
 */
export const SEVERITY_CLASSES: Record<AlertSeverity, string> = {
  critico:
    "border-destructive/40 bg-destructive-soft text-destructive ring-1 ring-destructive/20",
  alerta:
    "border-warning/30 bg-warning-soft text-warning-foreground",
  informativo:
    "border-border/60 bg-muted/40 text-muted-foreground",
};

const SEVERITY_ICON = {
  critico: ShieldAlert,
  alerta: AlertTriangle,
  informativo: Info,
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critico: "Crítico",
  alerta: "Alerta",
  informativo: "Informativo",
};

export function AlertBanner({
  severity,
  title,
  children,
  className,
  compact,
}: {
  severity: AlertSeverity;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <div
      className={cn(
        "rounded-md border flex gap-3 overflow-hidden break-words whitespace-normal [overflow-wrap:anywhere] [word-break:break-word] min-w-0 max-w-full",
        compact ? "p-2 text-xs" : "px-4 py-3 text-xs",
        SEVERITY_CLASSES[severity],
        className,
      )}
      role={severity === "critico" ? "alert" : "status"}
    >
      <Icon
        className={cn(
          "shrink-0 mt-0.5",
          severity === "critico" ? "h-4 w-4" : "h-3.5 w-3.5",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && (
          <p className={cn("font-semibold leading-tight", severity === "critico" && "text-destructive")}>
            {title}
          </p>
        )}
        {children && <div className="leading-snug">{children}</div>}
      </div>
    </div>
  );
}

/** Badge inline de severidade — útil em listas/tabelas. */
export function SeverityBadge({ severity, label }: { severity: AlertSeverity; label?: string }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        SEVERITY_CLASSES[severity],
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden />
      {label ?? SEVERITY_LABEL[severity]}
    </span>
  );
}