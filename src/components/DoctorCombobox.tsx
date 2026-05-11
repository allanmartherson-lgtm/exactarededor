import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface DoctorOption {
  id: string;
  name: string;
  crm: string | null;
  crm_uf: string | null;
}

interface Props {
  value: DoctorOption | null;
  onChange: (d: DoctorOption | null) => void;
  placeholder?: string;
  className?: string;
  pageSize?: number;
}

const PAGE = 20;

/**
 * Combobox de médicos com busca incremental no servidor (debounce),
 * paginação e cache.
 */
export function DoctorCombobox({
  value,
  onChange,
  placeholder = "Buscar médico por nome ou CRM...",
  className,
  pageSize = PAGE,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<DoctorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    setPage(0);
  }, [debounced, open]);

  useEffect(() => {
    if (!open) return;
    const myId = ++reqId.current;
    setLoading(true);
    const from = page * pageSize;
    const to = from + pageSize - 1;
    
    let q = supabase.from("doctors").select("id, full_name, crm, crm_uf", { count: "exact" });
    const term = debounced.trim();
    
    if (term) {
      const safe = term.replace(/[%,]/g, " ");
      const ors: string[] = [`full_name.ilike.%${safe}%`];
      // Se parecer um CRM (números), buscar por CRM também
      if (/^\d+$/.test(term)) {
        ors.push(`crm.ilike.%${term}%`);
      }
      q = q.or(ors.join(","));
    }
    
    q.order("full_name").range(from, to).then(({ data, count }) => {
      if (reqId.current !== myId) return;
      const next = (data ?? []).map(d => ({
        id: d.id,
        name: d.full_name,
        crm: d.crm,
        crm_uf: d.crm_uf
      })) as DoctorOption[];
      
      setItems((prev) => (page === 0 ? next : [...prev, ...next]));
      setHasMore((count ?? 0) > to + 1);
      setLoading(false);
    });
  }, [debounced, page, open, pageSize]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className={cn("justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate text-left">
            {value ? `${value.name}${value.crm ? ` · CRM ${value.crm}/${value.crm_uf || ""}` : ""}` : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[400px] p-0 max-w-[calc(100vw-2rem)]")} align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome ou CRM..."
              className="border-0 shadow-none focus-visible:ring-0 h-9"
            />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <CommandList>
            {!loading && items.length === 0 && <CommandEmpty>Nenhum médico encontrado.</CommandEmpty>}
            <CommandGroup>
              {items.map((d) => {
                const checked = value?.id === d.id;
                const crmLabel = d.crm ? `CRM ${d.crm}/${d.crm_uf || ""}` : "Sem CRM";
                return (
                  <CommandItem
                    key={d.id}
                    value={d.id}
                    onSelect={() => { onChange(d); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate font-medium">{d.name}</span>
                      <span className="text-xs text-muted-foreground">{crmLabel}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {hasMore && (
              <div className="p-2 border-t">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}
                  Carregar mais
                </Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
