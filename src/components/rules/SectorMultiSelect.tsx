import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type SectorRow = { slug: string; name: string; codigo: string | null; classificacao: string | null; active: boolean };

let _cache: SectorRow[] | null = null;
let _pending: Promise<SectorRow[]> | null = null;

async function loadSectors(): Promise<SectorRow[]> {
  if (_cache) return _cache;
  if (_pending) return _pending;
  _pending = (async () => {
    const { data, error } = await supabase
      .from("sectors")
      .select("slug,name,tasy_code,classification,active")
      .order("name");
    if (error) throw error;
    _cache = ((data || []) as Array<{ slug: string; name: string; tasy_code: string | null; classification: string | null; active: boolean }>).map((r) => ({
      slug: r.slug,
      name: r.name,
      codigo: r.tasy_code,
      classificacao: r.classification,
      active: r.active,
    }));
    return _cache;
  })();
  return _pending;
}

interface Props {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function SectorMultiSelect({ values, onChange, placeholder = "Selecionar setores…" }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SectorRow[]>(_cache || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    let alive = true;
    loadSectors()
      .then((d) => { if (alive) { setRows(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const bySlug = useMemo(() => {
    const m = new Map<string, SectorRow>();
    rows.forEach((r) => m.set(r.slug, r));
    return m;
  }, [rows]);

  const visible = useMemo(() => {
    // Mostra todos ativos + os já selecionados (mesmo que inativos)
    const active = rows.filter((r) => r.active);
    const selectedInactive = rows.filter((r) => !r.active && values.includes(r.slug));
    return [...active, ...selectedInactive];
  }, [rows, values]);

  const labelFor = (slug: string): string => {
    const r = bySlug.get(slug);
    if (!r) return slug;
    return r.codigo ? `${r.codigo} · ${r.name}` : r.name;
  };

  const toggle = (slug: string) => {
    if (values.includes(slug)) onChange(values.filter((x) => x !== slug));
    else onChange([...values, slug]);
  };

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className={cn("w-full justify-between font-normal h-9", !values.length && "text-muted-foreground")}
          >
            <span className="truncate text-xs">
              {loading ? "Carregando setores…" : values.length ? `${values.length} setor${values.length > 1 ? "es" : ""} selecionado${values.length > 1 ? "s" : ""}` : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar por código, nome ou alias…" />
            <CommandList>
              <CommandEmpty>Nenhum setor.</CommandEmpty>
              <CommandGroup>
                {visible.map((r) => {
                  const checked = values.includes(r.slug);
                  const searchValue = `${r.codigo ?? ""} ${r.name} ${r.slug} ${r.classificacao ?? ""}`;
                  return (
                    <CommandItem key={r.slug} value={searchValue} onSelect={() => toggle(r.slug)}>
                      <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-xs font-medium truncate">
                          {r.codigo ? `${r.codigo} · ` : ""}{r.name}
                          {!r.active && <span className="ml-1 text-[10px] text-muted-foreground">(inativo)</span>}
                        </span>
                        {r.classificacao && (
                          <span className="text-[10px] text-muted-foreground truncate">{r.classificacao}</span>
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
          {values.map((slug) => (
            <button
              key={slug}
              type="button"
              onClick={() => toggle(slug)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-primary/40 bg-accent text-primary hover:bg-accent/70"
              title="Remover"
            >
              <span className="truncate max-w-[200px]">{labelFor(slug)}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
