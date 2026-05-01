import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS_PT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];
const MONTHS_FULL_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const toKey = (year: number, monthIdx: number) =>
  `${year}-${String(monthIdx + 1).padStart(2, "0")}`;

const labelFor = (key: string) => {
  const [y, m] = key.split("-");
  return `${MONTHS_FULL_PT[Number(m) - 1]} ${y}`;
};

const shortLabelFor = (key: string) => {
  const [y, m] = key.split("-");
  return `${MONTHS_PT[Number(m) - 1]}/${y.slice(2)}`;
};

interface MonthMultiSelectProps {
  /** Valores no formato "YYYY-MM" */
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

/**
 * Seletor de meses (calendário fechado por mês) com seleção múltipla.
 * Cada valor é "YYYY-MM". Permite navegar por ano e selecionar um ou
 * vários meses. Não emite dia.
 */
export const MonthMultiSelect = ({
  value,
  onChange,
  placeholder = "Selecione um ou mais meses",
  className,
  id,
}: MonthMultiSelectProps) => {
  const today = new Date();
  const initialYear = value.length
    ? Number([...value].sort()[value.length - 1].slice(0, 4))
    : today.getFullYear();
  const [year, setYear] = useState<number>(initialYear);
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => [...value].sort(), [value]);
  const selectedSet = useMemo(() => new Set(value), [value]);

  const toggle = (key: string) => {
    if (selectedSet.has(key)) {
      onChange(value.filter((v) => v !== key));
    } else {
      onChange([...value, key]);
    }
  };

  const remove = (key: string) => onChange(value.filter((v) => v !== key));

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <span className="flex items-center gap-2 truncate">
              <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
              {sorted.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : sorted.length === 1 ? (
                <span>{labelFor(sorted[0])}</span>
              ) : (
                <span>{sorted.length} meses selecionados</span>
              )}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-3" align="start">
          <div className="flex items-center justify-between mb-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Ano anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-semibold">{year}</div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setYear((y) => y + 1)}
              aria-label="Próximo ano"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MONTHS_PT.map((label, idx) => {
              const key = toKey(year, idx);
              const isSelected = selectedSet.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className={cn(
                    "rounded-md border px-2 py-2 text-sm transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              disabled={value.length === 0}
            >
              Limpar
            </button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Concluir
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((key) => (
            <Badge key={key} variant="secondary" className="gap-1 pl-2 pr-1 py-1 font-normal">
              {shortLabelFor(key)}
              <button
                type="button"
                onClick={() => remove(key)}
                className="rounded-sm hover:bg-background/60 p-0.5"
                aria-label={`Remover ${labelFor(key)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};