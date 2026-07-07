import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";

type ConvenioRow = { slug: string; name: string; aliases: string[]; active: boolean };

// Cache por hospital: convênio exclusivo de outro hospital não pode aparecer
// na regra do hospital atual.
const cacheByHospital = new Map<string, ConvenioRow[]>();
const pendingByHospital = new Map<string, Promise<ConvenioRow[]>>();

async function loadConvenios(hospitalId: string | null): Promise<ConvenioRow[]> {
  const key = hospitalId ?? "__global__";
  const cached = cacheByHospital.get(key);
  if (cached) return cached;
  const inflight = pendingByHospital.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    let q = supabase.from("convenios").select("slug,name,aliases,active,hospital_id").order("name");
    q = hospitalId
      ? q.or(`hospital_id.is.null,hospital_id.eq.${hospitalId}`)
      : q.is("hospital_id", null);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data || []) as ConvenioRow[];
    cacheByHospital.set(key, rows);
    return rows;
  })();
  pendingByHospital.set(key, promise);
  try { return await promise; } finally { pendingByHospital.delete(key); }
}

interface Props {
  values: string[];                       // mix de slugs cadastrados e textos legados
  onChange: (next: string[]) => void;
  matchMode: "whitelist" | "blacklist";
  onMatchModeChange: (v: "whitelist" | "blacklist") => void;
  placeholder?: string;
}

export function ConvenioMultiSelect({ values, onChange, matchMode, onMatchModeChange, placeholder = "Selecionar convênios…" }: Props) {
  const { hospital } = useHospital() as { hospital: { id: string } | null };
  const activeId = hospital?.id ?? null;
  const cacheKey = activeId ?? "__global__";
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ConvenioRow[]>(cacheByHospital.get(cacheKey) || []);
  const [loading, setLoading] = useState(!cacheByHospital.get(cacheKey));

  useEffect(() => {
    let alive = true;
    setLoading(!cacheByHospital.get(cacheKey));
    loadConvenios(activeId)
      .then((d) => { if (alive) { setRows(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeId, cacheKey]);

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
            <CommandList className="max-h-[320px] overflow-y-auto overscroll-contain">
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
