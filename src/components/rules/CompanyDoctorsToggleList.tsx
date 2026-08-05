import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface CompanyDoctorOption {
  id: string;
  full_name: string;
  crm?: string | null;
  crm_uf?: string | null;
}

interface CompanyDoctorsToggleListProps {
  /** Médicos vinculados à PJ (doctor_companies, vínculo ativo). */
  doctors: CompanyDoctorOption[];
  loading?: boolean;
  /** Ids dos médicos habilitados no acordo/regra. */
  enabledIds: string[];
  onChange: (nextEnabledIds: string[]) => void;
  label?: string;
  emptyHint?: string;
  footnote?: string;
}

/**
 * Lista de médicos vinculados a uma PJ com switch individual Sim/Não.
 * Mesmo padrão visual usado no escopo "Grupo" do Cadastro de Regras.
 */
export function CompanyDoctorsToggleList({
  doctors,
  loading = false,
  enabledIds,
  onChange,
  label = "Médicos vinculados à PJ",
  emptyHint = "Nenhum médico vinculado a esta PJ no cadastro (doctor_companies).",
  footnote,
}: CompanyDoctorsToggleListProps) {
  const enabledSet = new Set(enabledIds);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {doctors.length > 0 && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => onChange(doctors.map((d) => d.id))}
            >
              Habilitar todos
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => onChange([])}
            >
              Desabilitar todos
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground italic">Carregando médicos…</p>
      ) : doctors.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{emptyHint}</p>
      ) : (
        <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background/40">
          {doctors.map((d) => {
            const enabled = enabledSet.has(d.id);
            return (
              <label
                key={d.id}
                className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <span className={cn("truncate", !enabled && "text-muted-foreground line-through")}>
                    {d.full_name}
                  </span>
                  {d.crm && (
                    <span className="ml-1 text-[10px] text-muted-foreground cell-mono">
                      · {d.crm}
                      {d.crm_uf ? `/${d.crm_uf}` : ""}
                    </span>
                  )}
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...enabledIds.filter((x) => x !== d.id), d.id]
                        : enabledIds.filter((x) => x !== d.id),
                    )
                  }
                />
              </label>
            );
          })}
        </div>
      )}

      {footnote && <p className="text-[11px] text-muted-foreground">{footnote}</p>}
    </div>
  );
}
