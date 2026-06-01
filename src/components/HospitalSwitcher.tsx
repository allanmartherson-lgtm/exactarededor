import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHospital } from "@/contexts/HospitalContext";
import { cn } from "@/lib/utils";

export const HospitalSwitcher = ({ className }: { className?: string }) => {
  const { hospital, availableHospitals, switchHospital, loading } = useHospital();

  if (loading || !hospital) return null;
  // Esconde se só tem 1 hospital disponível
  if (availableHospitals.length <= 1) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Building2 className="h-4 w-4" />
        <span className="font-medium text-foreground">{hospital.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-2", className)}>
          <Building2 className="h-4 w-4" />
          <span className="truncate max-w-[180px]">{hospital.name}</span>
          <span className="text-xs text-muted-foreground">({hospital.state_uf})</span>
          <ChevronsUpDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Hospital ativo</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableHospitals.map((h) => (
          <DropdownMenuItem
            key={h.id}
            onClick={() => switchHospital(h.id)}
            className="flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {h.name}
              <span className="text-xs text-muted-foreground">{h.state_uf}</span>
            </span>
            {h.id === hospital.id && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
