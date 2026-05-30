import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type ConvenioRow = { slug: string; name: string; aliases: string[]; active: boolean };

let _cache: ConvenioRow[] | null = null;
let _pending: Promise<ConvenioRow[]> | null = null;

async function loadConvenios(): Promise<ConvenioRow[]> {
  if (_cache) return _cache;
  if (_pending) return _pending;
  _pending = (async () => {
    const { data, error } = await supabase
      .from("convenios")
      .select("slug,name,aliases,active")
      .order("name");
    if (error) throw error;
    _cache = ((data || []) as ConvenioRow[]);
    return _cache;
  })();
  return _pending;
}

interface Props {
  values: string[];                       // mix de slugs cadastrados e textos legados
  onChange: (next: string[]) => void;
  matchMode: "whitelist" | "blacklist";
  onMatchModeChange: (v: "whitelist" | "blacklist") => void;
  placeholder?: string;
}

export function ConvenioMultiSelect({ values, onChange, matchMode, onMatchModeChange, placeholder = "Selecionar convênios…" }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ConvenioRow[]>(_cache || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    let alive = true;
    loadConvenios()
      .then((d) => { if (alive) { setRows(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const bySlug = useMemo(() => {
    const m = new Map<string, ConvenioRow>();
    rows.forEach((r) => m.set(r.slug, r));
    return m;
  }, [rows]);

  const visible = useMemo(() => {
    const active = rows.filter((r) => r.active);
    const selectedInactive = rows.filter((r) => !r.active && values.includes(r.slug));
    return [...active, ...selectedInactive];
  }, [rows, values]);

  const labelFor = (v: string): string => bySlug.get(v)?.name ?? v;
  const isLegacy = (v: string): boolean => !bySlug.has(v);

  const toggle = (slug: string) => {
    if (values.includes(slug)) onChange(values.filter((x) => x !== slug));
    else onChange([...values, slug]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Modo</Label>
        <Select value={matchMode} onValueChange={(v) => onMatchModeChange(v as "whitelist" | "blacklist")}>
          <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="whitelist">Apenas estes convênios</SelectItem>
            <SelectItem value="blacklist">Todos exceto estes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className={cn("w-full justify-between font-normal h-8", !values.length && "text-muted-foreground")}
          >
            <span className="truncate text-xs">
              {loading
                ? "Carregando convênios…"
                : values.length
                  ? `${values.length} convênio${values.length > 1 ? "s" : ""} selecionado${values.length > 1 ? "s" : ""}`
                  : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar por nome ou alias…" />
            <CommandList>
              <CommandEmpty>Nenhum convênio. Cadastre em Convênios.</CommandEmpty>
              <CommandGroup>
                {visible.map((r) => {
                  const checked = values.includes(r.slug);
                  const searchValue = `${r.name} ${r.slug} ${(r.aliases || []).join(" ")}`;
                  return (
                    <CommandItem key={r.slug} value={searchValue} onSelect={() => toggle(r.slug)}>
                      <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-xs font-medium truncate">
                          {r.name}
                          {!r.active && <span className="ml-1 text-[10px] text-muted-foreground">(inativo)</span>}
                        </span>
                        {r.aliases?.length > 0 && (
                          <span className="text-[10px] text-muted-foreground truncate">
                            {r.aliases.slice(0, 3).join(", ")}{r.aliases.length > 3 ? "…" : ""}
                          </span>
                        )}
                      </div>
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
          {values.map((v) => {
            const legacy = isLegacy(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border",
                  legacy
                    ? "border-amber-400/60 bg-amber-100/40 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                    : "border-primary/40 bg-accent text-primary hover:bg-accent/70"
                )}
                title={legacy ? "Texto legado — não está cadastrado em Convênios" : "Remover"}
              >
                <span className="truncate max-w-[200px]">{labelFor(v)}{legacy ? " (texto)" : ""}</span>
                <X className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
