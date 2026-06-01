import { useMemo, useState, useEffect } from "react";
import { Building2, Check, ChevronsUpDown, Star, Search, MapPin, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useHospital } from "@/contexts/HospitalContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Seletor de hospital ativo.
 * - Esconde-se se houver só 1 hospital (mostra label estático).
 * - Agrupa por UF, marca o hospital principal com estrela.
 * - Atalho ⌘K / Ctrl+K abre o seletor.
 * - Mostra toast ao trocar para reforçar feedback visual.
 */
export const HospitalSwitcher = ({ className }: { className?: string }) => {
  const { hospital, availableHospitals, primaryHospitalId, switchHospital, loading } =
    useHospital();
  const [open, setOpen] = useState(false);

  // Atalho de teclado para abrir
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof availableHospitals>();
    for (const h of availableHospitals) {
      const uf = h.state_uf || "—";
      if (!map.has(uf)) map.set(uf, []);
      map.get(uf)!.push(h);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [availableHospitals]);

  if (loading || !hospital) return null;

  // Caso só haja 1 hospital: chip informativo, sem dropdown
  if (availableHospitals.length <= 1) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm",
          className,
        )}
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{hospital.name}</span>
        <Badge variant="outline" className="text-[10px] font-normal">
          {hospital.state_uf}
        </Badge>
      </div>
    );
  }

  const handleSelect = (id: string, name: string) => {
    if (id === hospital.id) {
      setOpen(false);
      return;
    }
    switchHospital(id);
    setOpen(false);
    toast.success(`Hospital ativo: ${name}`, {
      icon: <ArrowLeftRight className="h-4 w-4" />,
      description: "Todos os dados exibidos agora são deste hospital.",
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-2 pl-2 pr-2 border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-colors",
            className,
          )}
          aria-label="Trocar hospital ativo"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
            <Building2 className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col items-start leading-tight">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Hospital
            </span>
            <span className="truncate max-w-[180px] text-sm font-medium">
              {hospital.name}
            </span>
          </div>
          <Badge variant="secondary" className="ml-1 text-[10px] font-normal">
            {hospital.state_uf}
          </Badge>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60 ml-0.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[340px] p-0 overflow-hidden"
        sideOffset={6}
      >
        <div className="px-3 py-2.5 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Trocar hospital
            </span>
            <kbd className="hidden md:inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {availableHospitals.length} hospitais disponíveis
          </p>
        </div>
        <Command>
          <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              placeholder="Buscar por nome ou UF..."
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 border-0 focus:ring-0"
            />
          </div>
          <CommandList className="max-h-[320px]">
            <CommandEmpty>Nenhum hospital encontrado.</CommandEmpty>
            {grouped.map(([uf, hospitals]) => (
              <CommandGroup
                key={uf}
                heading={
                  <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
                    <MapPin className="h-3 w-3" />
                    {uf}
                    <span className="text-muted-foreground/60">
                      ({hospitals.length})
                    </span>
                  </span>
                }
              >
                {hospitals.map((h) => {
                  const isActive = h.id === hospital.id;
                  const isPrimary = h.id === primaryHospitalId;
                  return (
                    <CommandItem
                      key={h.id}
                      value={`${h.name} ${h.state_uf}`}
                      onSelect={() => handleSelect(h.id, h.name)}
                      className={cn(
                        "flex items-center gap-2 cursor-pointer py-2",
                        isActive && "bg-primary/10 data-[selected=true]:bg-primary/15",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded shrink-0",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Building2 className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-medium truncate">{h.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {h.state_uf}
                          {isPrimary && " · Padrão"}
                        </span>
                      </div>
                      {isPrimary && (
                        <Star
                          className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0"
                          aria-label="Hospital principal"
                        />
                      )}
                      {isActive && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <div className="px-3 py-2 border-t bg-muted/20 text-[11px] text-muted-foreground">
          A troca isola os dados — cada hospital tem visão independente.
        </div>
      </PopoverContent>
    </Popover>
  );
};
