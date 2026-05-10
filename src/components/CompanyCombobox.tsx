import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCNPJ, onlyDigits } from "@/lib/cnpj";
import { cn } from "@/lib/utils";

export interface CompanyOption {
  id: string;
  name: string;
  document: string | null;
}

interface Props {
  value: CompanyOption | null;
  onChange: (c: CompanyOption | null) => void;
  placeholder?: string;
  className?: string;
  pageSize?: number;
  /** Display selected as "Nome · CNPJ". When false shows only name. */
  showDocumentInTrigger?: boolean;
}

const PAGE = 20;

/**
 * Combobox de empresas com busca incremental no servidor (debounce),
 * paginação ("Carregar mais") e cache do item selecionado.
 * Suporta milhares de cadastros sem travar.
 */
export function CompanyCombobox({
  value,
  onChange,
  placeholder = "Selecionar empresa…",
  className,
  pageSize = PAGE,
  showDocumentInTrigger = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const reqId = useRef(0);

  // Debounce 250ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset paginação ao mudar busca / abrir
  useEffect(() => {
    if (!open) return;
    setPage(0);
  }, [debounced, open]);

  // Fetch incremental
  useEffect(() => {
    if (!open) return;
    const myId = ++reqId.current;
    setLoading(true);
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let q = supabase.from("companies").select("id,name,document", { count: "exact" });
    const term = debounced.trim();
    if (term) {
      const digits = onlyDigits(term);
      const safe = term.replace(/[%,]/g, " ");
      const ors: string[] = [`name.ilike.%${safe}%`];
      if (digits) ors.push(`document.ilike.%${digits}%`);
      q = q.or(ors.join(","));
    }
    q.order("name").range(from, to).then(({ data, count }) => {
      if (reqId.current !== myId) return;
      const next = (data ?? []) as CompanyOption[];
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
          <span className="truncate text-left" title={value ? (showDocumentInTrigger && value.document ? `${value.name} · ${formatCNPJ(value.document)}` : value.name) : placeholder}>
            {value
              ? showDocumentInTrigger && value.document
                ? `${value.name} · ${formatCNPJ(value.document)}`
                : value.name
              : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[360px] p-0 max-w-[calc(100vw-2rem)]", className?.includes("w-") && "w-auto")} align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou CNPJ…"
              className="border-0 shadow-none focus-visible:ring-0 h-9"
            />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <CommandList>
            {!loading && items.length === 0 && <CommandEmpty>Nenhuma empresa encontrada.</CommandEmpty>}
            <CommandGroup>
              {items.map((c) => {
                const checked = value?.id === c.id;
                const docMasked = c.document ? formatCNPJ(c.document) : "—";
                return (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => { onChange(c); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate" title={c.name}>{c.name}</span>
                      <span className="text-xs text-muted-foreground truncate" title={`CNPJ ${docMasked}`}>CNPJ {docMasked}</span>
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