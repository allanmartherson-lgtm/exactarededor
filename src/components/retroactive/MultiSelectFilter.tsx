import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

export function MultiSelectFilter({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: Array<{ key: string; label: string }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);
  const summary =
    selected.size === 0
      ? allLabel
      : selected.size === 1
      ? options.find((o) => o.key === Array.from(selected)[0])?.label ?? `${label}: 1`
      : `${label}: ${selected.size} selecionados`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-[180px] text-xs justify-between font-normal">
          <span className="truncate">{summary}</span>
          <ChevronsUpDownIcon className="h-3.5 w-3.5 opacity-50 ml-1 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-2" align="end">
        <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-border">
          <span className="text-[11px] font-medium text-muted-foreground">Filtrar por {label.toLowerCase()}</span>
          {selected.size > 0 && (
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={() => onChange(new Set())}
            >
              Limpar
            </button>
          )}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Buscar ${label.toLowerCase()}…`}
          className="h-7 text-xs mb-1"
        />
        <div className="flex flex-col gap-0.5 max-h-[260px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-[11px] text-muted-foreground px-2 py-2 text-center">Nenhum resultado</div>
          )}
          {filtered.map((o) => {
            const checked = selected.has(o.key);
            return (
              <label
                key={o.key}
                className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(o.key);
                    else next.delete(o.key);
                    onChange(next);
                  }}
                />
                <span className="truncate" title={o.label}>{o.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}


