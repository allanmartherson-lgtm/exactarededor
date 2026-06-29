import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpecialties } from "@/hooks/useSpecialties";

interface Props {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Multi-select de especialidades (catálogo `specialties`). Mesmo padrão visual
 * de `SectorMultiSelect`. Persistência: o cálculo guarda os NOMES (string[]),
 * comparados via `normName` no motor.
 */
export function SpecialtyMultiSelect({ values, onChange, placeholder = "Selecionar especialidades…", disabled }: Props) {
  const [open, setOpen] = useState(false);
  const { specialties, loading } = useSpecialties();

  const options = useMemo(() => {
    // Garante que selecionadas órfãs (não no catálogo) continuem visíveis.
    const set = new Set(specialties.map((s) => s.toLowerCase()));
    const orphans = values.filter((v) => !set.has(v.toLowerCase()));
    return [...specialties, ...orphans];
  }, [specialties, values]);

  const toggle = (name: string) => {
    if (values.includes(name)) onChange(values.filter((x) => x !== name));
    else onChange([...values, name]);
  };

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className={cn("w-full justify-between font-normal h-9", !values.length && "text-muted-foreground")}
          >
            <span className="truncate text-xs">
              {loading ? "Carregando especialidades…" : values.length ? `${values.length} especialidade${values.length > 1 ? "s" : ""} selecionada${values.length > 1 ? "s" : ""}` : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar especialidade…" />
            <CommandList>
              <CommandEmpty>Nenhuma especialidade.</CommandEmpty>
              <CommandGroup>
                {options.map((name) => {
                  const checked = values.includes(name);
                  return (
                    <CommandItem key={name} value={name} onSelect={() => toggle(name)}>
                      <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                      <span className="text-xs font-medium truncate">{name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((name) => (
            <button
              key={name}
              type="button"
              disabled={disabled}
              onClick={() => toggle(name)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-primary/40 bg-accent text-primary hover:bg-accent/70 disabled:opacity-50"
              title="Remover"
            >
              <span className="truncate max-w-[200px]">{name}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
