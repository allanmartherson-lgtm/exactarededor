import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Network, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface CC {
  code_p12: string;
  level2: string | null;
  level3: string | null;
  level4: string | null;
  level5: string | null;
}

interface Props {
  value: string | null;
  onChange: (code: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
}

export const CostCenterCombobox = ({ value, onChange, placeholder = "Selecione um centro…", allowClear = true }: Props) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CC[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    supabase
      .from("cost_centers")
      .select("code_p12, level2, level3, level4, level5")
      .eq("active", true)
      .order("code_p12")
      .limit(5000)
      .then(({ data }) => setItems((data ?? []) as CC[]));
  }, []);

  const selected = useMemo(() => items.find((i) => i.code_p12 === value) ?? null, [items, value]);

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 100);
    const q = query.toLowerCase();
    return items
      .filter((i) =>
        [i.code_p12, i.level2, i.level3, i.level4, i.level5].some((v) => v && v.toLowerCase().includes(q))
      )
      .slice(0, 100);
  }, [items, query]);

  const renderLabel = (it: CC) => it.level5 || it.level4 || it.level3 || it.code_p12;
  const renderHint = (it: CC) => [it.level3, it.level4].filter(Boolean).join(" · ");

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="flex items-center gap-2 truncate">
              <Network className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              {selected ? (
                <span className="truncate">
                  <span className="font-mono text-xs text-muted-foreground">{selected.code_p12}</span>
                  <span className="mx-2">·</span>
                  {renderLabel(selected)}
                </span>
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Digite código ou nome…" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>
                {items.length === 0
                  ? "Nenhum centro cadastrado. Importe a base na página Centros de custo."
                  : "Nada encontrado."}
              </CommandEmpty>
              <CommandGroup>
                {filtered.map((it) => (
                  <CommandItem
                    key={it.code_p12}
                    value={it.code_p12}
                    onSelect={() => { onChange(it.code_p12); setOpen(false); setQuery(""); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === it.code_p12 ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{it.code_p12}</span>
                        <span className="font-medium truncate">{renderLabel(it)}</span>
                      </div>
                      {renderHint(it) && <div className="text-xs text-muted-foreground truncate">{renderHint(it)}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {allowClear && value && (
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} title="Limpar">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};