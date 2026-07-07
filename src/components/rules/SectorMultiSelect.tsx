import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";

type SectorRow = { slug: string; name: string; codigo: string | null; classificacao: string | null; active: boolean };

// Cache por hospital: setor exclusivo de outro hospital não deve aparecer em
// regras do hospital atual. Chave = hospital.id || "__global__".
const cacheByHospital = new Map<string, SectorRow[]>();
const pendingByHospital = new Map<string, Promise<SectorRow[]>>();

async function loadSectors(hospitalId: string | null): Promise<SectorRow[]> {
  const key = hospitalId ?? "__global__";
  const cached = cacheByHospital.get(key);
  if (cached) return cached;
  const inflight = pendingByHospital.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    let q = supabase.from("sectors").select("slug,name,tasy_code,classification,active,hospital_id").order("name");
    q = hospitalId
      ? q.or(`hospital_id.is.null,hospital_id.eq.${hospitalId}`)
      : q.is("hospital_id", null);
    const { data, error } = await q;
    if (error) throw error;
    const rows = ((data || []) as Array<{ slug: string; name: string; tasy_code: string | null; classification: string | null; active: boolean }>).map((r) => ({
      slug: r.slug,
      name: r.name,
      codigo: r.tasy_code,
      classificacao: r.classification,
      active: r.active,
    }));
    cacheByHospital.set(key, rows);
    return rows;
  })();
  pendingByHospital.set(key, promise);
  try { return await promise; } finally { pendingByHospital.delete(key); }
}

interface Props {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function SectorMultiSelect({ values, onChange, placeholder = "Selecionar setores…" }: Props) {
  const { hospital } = useHospital() as { hospital: { id: string } | null };
  const activeId = hospital?.id ?? null;
  const cacheKey = activeId ?? "__global__";
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SectorRow[]>(cacheByHospital.get(cacheKey) || []);
  const [loading, setLoading] = useState(!cacheByHospital.get(cacheKey));

  useEffect(() => {
    let alive = true;
    setLoading(!cacheByHospital.get(cacheKey));
    loadSectors(activeId)
      .then((d) => { if (alive) { setRows(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeId, cacheKey]);

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
