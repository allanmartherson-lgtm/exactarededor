import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Network, X } from "lucide-react";
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
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CC | null>(null);
  const reqIdRef = useRef(0);
  const PAGE_SIZE = 50;

  // Busca o centro selecionado para exibir o rótulo (independente da lista)
  useEffect(() => {
    if (!value) { setSelected(null); return; }
    if (selected?.code_p12 === value) return;
    let alive = true;
    supabase
      .from("cost_centers")
      .select("code_p12, level2, level3, level4, level5")
      .eq("code_p12", value)
      .maybeSingle()
      .then(({ data }) => { if (alive) setSelected((data as CC) ?? null); });
    return () => { alive = false; };
  }, [value, selected?.code_p12]);

  // Busca server-side com debounce, só quando o popover está aberto
  useEffect(() => {
    if (!open) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      let q = supabase
        .from("cost_centers")
        .select("code_p12, level2, level3, level4, level5")
        .eq("active", true)
        .order("code_p12")
        .limit(PAGE_SIZE);
      const term = query.trim().replace(/[%,]/g, " ");
      if (term) {
        const like = `%${term}%`;
        q = q.or(
          [
            `code_p12.ilike.${like}`,
            `code_p10.ilike.${like}`,
            `level2.ilike.${like}`,
            `level3.ilike.${like}`,
            `level4.ilike.${like}`,
            `level5.ilike.${like}`,
          ].join(","),
        );
      }
      const { data } = await q;
      if (reqId !== reqIdRef.current) return;
      setItems((data ?? []) as CC[]);
      setLoading(false);
    }, query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [open, query]);

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
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                </div>
              ) : (
                <CommandEmpty>
                  {query ? "Nada encontrado." : "Digite para buscar (ou selecione abaixo)."}
                </CommandEmpty>
              )}
              <CommandGroup>
                {!loading && items.map((it) => (
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
                {!loading && items.length === PAGE_SIZE && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    Mostrando os primeiros {PAGE_SIZE} resultados — refine a busca para ver mais.
                  </p>
                )}
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