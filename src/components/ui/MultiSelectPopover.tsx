import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectPopoverProps {
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  searchable?: boolean;
  width?: string;
  className?: string;
  /**
   * Rótulo compacto mostrado no trigger.
   * Ex: "Todos", "3 selecionados", ou o label único.
   */
  allLabel?: string;
}

/**
 * Multi-select com popover + checkboxes.
 * Lógica OR dentro do filtro (any-of), AND entre filtros (aplicado pelo consumidor).
 * Vazio = "todos" (não filtra).
 */
export function MultiSelectPopover({
  options,
  values,
  onChange,
  placeholder = "Selecionar…",
  emptyLabel = "Sem opções",
  searchable = true,
  width = "w-[220px]",
  className,
  allLabel = "Todos",
}: MultiSelectPopoverProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };

  const summary =
    values.length === 0
      ? allLabel
      : values.length === 1
      ? options.find((o) => o.value === values[0])?.label ?? "1 selecionado"
      : `${values.length} selecionados`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(width, "justify-between font-normal", className)}
        >
          <span className="truncate text-left">{summary}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        {searchable && (
          <div className="p-2 border-b">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              className="h-8 text-sm"
            />
          </div>
        )}
        {values.length > 0 && (
          <div className="p-2 border-b flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
              {values.slice(0, 6).map((v) => {
                const opt = options.find((o) => o.value === v);
                return (
                  <Badge
                    key={v}
                    variant="secondary"
                    className="text-[10px] gap-1 pr-1"
                  >
                    <span className="truncate max-w-[120px]">
                      {opt?.label ?? v}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(v)}
                      className="hover:text-destructive"
                      aria-label="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              {values.length > 6 && (
                <Badge variant="outline" className="text-[10px]">
                  +{values.length - 6}
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px] shrink-0"
              onClick={() => onChange([])}
            >
              Limpar
            </Button>
          </div>
        )}
        <div className="max-h-[260px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground text-center">
              {emptyLabel}
            </div>
          )}
          {filtered.map((o) => {
            const active = values.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm rounded-md hover:bg-muted transition-colors",
                  active && "bg-primary/5",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center h-4 w-4 rounded border shrink-0",
                    active
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/40",
                  )}
                >
                  {active && <Check className="h-3 w-3" />}
                </div>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
