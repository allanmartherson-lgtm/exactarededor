import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MatchLevel } from "@/lib/companyMatching";

export type MappingRow = {
  /** Identificador único da linha (ex.: texto do "terceiro" ou id da PJ). */
  key: string;
  /** Rótulo exibido à esquerda. */
  rawLabel: string;
  /** Nível de confiança do auto-match (null = sem sugestão). */
  level: MatchLevel;
};

export type MappingOption = {
  /** Valor gravado no mapping (nome canônico OU id — depende do consumidor). */
  id: string;
  label: string;
};

export interface CompanyMappingListProps {
  rows: MappingRow[];
  /** Opções do select. Ignorado em variant="checkbox". */
  options?: MappingOption[];
  /** Mapping row.key → option.id (ou null = "Ignorar"). Em checkbox mode, valor não-null = incluído. */
  value: Record<string, string | null>;
  onChange: (key: string, optionId: string | null) => void;
  /** Chamado quando o analista aceita uma sugestão "medium". */
  onConfirm?: (key: string) => void;
  /** Coluna extra opcional à direita de cada linha (ex.: seleção de médicos). */
  extraColumn?: (row: MappingRow) => React.ReactNode;
  /** Rótulo do slot "sem vínculo". Default: "— Ignorar —". */
  ignoreLabel?: string;
  /** Altura máxima da lista rolável. Default: 420px. */
  maxHeight?: number;
  /** Rodapé com contadores customizado. Se ausente, exibe o padrão. */
  footer?: React.ReactNode;
  /**
   * "select" (default): dropdown de opções por linha, uso clássico do batch.
   * "checkbox": só liga/desliga a linha (usado quando não há mapeamento N-para-1).
   */
  variant?: "select" | "checkbox";
  className?: string;
}

/**
 * Lista de mapeamento "linha → PJ" no mesmo padrão visual do modal do
 * cruzamento do lote (PaymentConciliationModal). 100% controlado — quem
 * consome decide se o `onChange` grava alias, dispara auditoria etc.
 */
export function CompanyMappingList({
  rows,
  options,
  value,
  onChange,
  onConfirm,
  extraColumn,
  ignoreLabel = "— Ignorar —",
  maxHeight = 420,
  footer,
  className,
}: CompanyMappingListProps) {
  const exactCount = rows.filter((r) => value[r.key] && (r.level === "exact" || r.level === "high")).length;
  const confirmCount = rows.filter((r) => value[r.key] && r.level === "medium").length;
  const emptyCount = rows.filter((r) => !value[r.key]).length;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-success" /> Auto-vinculado
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-warning" /> Confirmar sugestão
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/40" /> Não encontrado
        </span>
      </div>

      <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight }}>
        {rows.map((row) => {
          const mapped = value[row.key];
          const level = row.level;

          const cardStyle = mapped
            ? level === "exact" || level === "high"
              ? "border-success/30 bg-success/5"
              : "border-warning/30 bg-warning/5"
            : "border-border bg-muted/30";

          const dotColor = mapped
            ? level === "exact" || level === "high"
              ? "bg-success"
              : "bg-warning"
            : "bg-muted-foreground/40";

          const badge = mapped ? (
            level === "exact" ? (
              <span className="text-[10px] font-semibold text-success bg-success/10 border border-success/30 px-1.5 py-0.5 rounded-full shrink-0">Auto ✓</span>
            ) : level === "high" ? (
              <span className="text-[10px] font-semibold text-success bg-success/10 border border-success/30 px-1.5 py-0.5 rounded-full shrink-0">Match ✓</span>
            ) : (
              <span className="text-[10px] font-semibold text-warning-text bg-warning/10 border border-warning/30 px-1.5 py-0.5 rounded-full shrink-0">Confirmar</span>
            )
          ) : (
            <span className="text-[10px] font-semibold text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded-full shrink-0">Ignorar</span>
          );

          return (
            <div
              key={row.key}
              className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg border", cardStyle)}
            >
              <div className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
              <p className="text-xs flex-1 min-w-0 truncate font-medium" title={row.rawLabel}>
                {row.rawLabel}
              </p>
              {badge}
              {level === "medium" && mapped && onConfirm && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] border-warning/40 text-warning-text hover:bg-warning/10 shrink-0"
                  onClick={() => onConfirm(row.key)}
                  title="Aceitar a sugestão deste vínculo. Sem confirmar, esta linha NÃO entra no cruzamento."
                >
                  Confirmar
                </Button>
              )}
              <select
                value={mapped ?? "__ignore__"}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange(row.key, val === "__ignore__" ? null : val);
                }}
                className="h-8 text-xs border border-border rounded-md bg-background px-2 shrink-0 w-[260px]"
              >
                <option value="__ignore__">{ignoreLabel}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {extraColumn && <div className="shrink-0">{extraColumn(row)}</div>}
            </div>
          );
        })}
      </div>

      {footer ?? (
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            <span className="text-success font-semibold">{exactCount}</span> confirmadas ·{" "}
            <span className="text-warning-text font-semibold">{confirmCount}</span> sugestões pendentes (não entram no cruzamento) ·{" "}
            <span className="text-muted-foreground">{emptyCount}</span> sem match
          </p>
        </div>
      )}
    </div>
  );
}
