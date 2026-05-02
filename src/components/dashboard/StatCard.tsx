import { StatTile, StatTileSkeleton, type StatTileProps } from "@/components/ui/stat-tile";
import { TONE_CLASSES } from "@/lib/status";

export type StatCardTone = "info" | "warning" | "success";

const toneBg: Record<StatCardTone, string> = {
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning-foreground",
  success: "bg-success-soft text-success",
};

export interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: StatCardTone;
  hint?: string;
  /** Quando verdadeiro, mostra o selo "Sua vez" no rodapé. */
  mine?: boolean;
  to?: string;
}

/**
 * StatCard — variante de domínio do StatTile usada no Dashboard.
 * Aplica o ícone com tom (info/warning/success) e converte `mine`
 * no selo "Sua vez". Toda padronização de altura/tipografia/foco
 * vem do StatTile, garantindo alinhamento idêntico em qualquer tela.
 */
export const StatCard = ({ icon: Icon, label, value, tone, hint, mine, to }: StatCardProps) => {
  const iconNode = (
    <div
      className={`h-8 w-8 sm:h-10 sm:w-10 rounded-lg flex items-center justify-center ${toneBg[tone]}`}
    >
      <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
    </div>
  );

  const badge: StatTileProps["badge"] = mine ? (
    <span
      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 leading-none ${TONE_CLASSES.info}`}
    >
      Sua vez
    </span>
  ) : undefined;

  return (
    <StatTile
      label={label}
      value={value}
      icon={iconNode}
      hint={hint}
      badge={badge}
      highlighted={mine}
      to={to}
      ariaLabel={[label, `valor ${value}`, mine ? "sua vez" : hint].filter(Boolean).join(", ")}
    />
  );
};

export const StatCardSkeleton = StatTileSkeleton;
