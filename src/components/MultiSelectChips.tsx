import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  values: string[];
  onChange: (next: string[]) => void;
  options: string[];
  placeholder?: string;
  allowCustom?: boolean;
  emptyHint?: string;
}

/**
 * Multi-select com chips. Aceita valores fora da lista quando allowCustom=true.
 * Usado em Regras (especialidades) e Pagamentos (especialidades).
 */
export function MultiSelectChips({ values, onChange, options, placeholder = "Selecionar…", allowCustom = true, emptyHint = "Vazio = aplica a todos." }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const merged = useMemo(() => {
    const set = new Set(options);
    values.forEach((v) => set.add(v));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [options, values]);

  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };

  const addCustom = () => {
    const v = query.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setQuery("");
  };

  const showAddCustom = allowCustom && query.trim().length > 0 && !merged.some((m) => m.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className={cn("w-full justify-between font-normal", !values.length && "text-muted-foreground")}>
            {values.length ? `${values.length} selecionada${values.length > 1 ? "s" : ""}` : placeholder}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter>
            <CommandInput value={query} onValueChange={setQuery} placeholder="Buscar ou digitar nova…" />
            <CommandList>
              <CommandEmpty>{showAddCustom ? null : "Nenhum item."}</CommandEmpty>
              <CommandGroup>
                {merged.map((opt) => {
                  const checked = values.includes(opt);
                  return (
                    <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)}>
                      <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                      {opt}
                    </CommandItem>
                  );
                })}
                {showAddCustom && (
                  <CommandItem value={`__add_${query}`} onSelect={addCustom}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar “{query.trim()}”
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1">
              {v}
              <button type="button" onClick={() => toggle(v)} className="rounded-sm hover:bg-muted-foreground/20 p-0.5" aria-label={`Remover ${v}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{emptyHint}</p>
    </div>
  );
}

import { DoctorCombobox, type DoctorOption } from "./DoctorCombobox";

/** Editor de médicos nomeados (nome + CRM). */
export function DoctorsEditor({ value, onChange }: { value: { name: string; crm?: string }[]; onChange: (next: { name: string; crm?: string }[]) => void }) {
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorOption | null>(null);

  const add = () => {
    if (!selectedDoctor) return;
    const crmStr = selectedDoctor.crm ? `${selectedDoctor.crm}${selectedDoctor.crm_uf ? `/${selectedDoctor.crm_uf}` : ""}` : undefined;
    
    // Evita duplicados
    if (value.some(v => v.name === selectedDoctor.name && v.crm === crmStr)) {
      setSelectedDoctor(null);
      return;
    }

    onChange([...value, { name: selectedDoctor.name, crm: crmStr }]);
    setSelectedDoctor(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {value.map((d, i) => (
          <Badge key={`${d.name}-${i}`} variant="secondary" className="gap-1 pr-1">
            {d.name}{d.crm ? ` · CRM ${d.crm}` : ""}
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="rounded-sm hover:bg-muted-foreground/20 p-0.5" aria-label="Remover">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {value.length === 0 && <span className="text-xs text-muted-foreground">Nenhum médico selecionado.</span>}
      </div>
      <div className="flex gap-2">
        <DoctorCombobox
          className="flex-1"
          value={selectedDoctor}
          onChange={setSelectedDoctor}
          placeholder="Buscar no cadastro de médicos..."
        />
        <Button type="button" variant="outline" onClick={add} disabled={!selectedDoctor}>
          <Plus className="h-4 w-4 mr-2" /> Adicionar
        </Button>
      </div>
    </div>
  );
}