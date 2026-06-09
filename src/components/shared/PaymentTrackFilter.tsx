import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Valores aceitos pelas RPCs (param p_track):
 *  - null/"all"            → não filtra (todos os lotes)
 *  - "prioritario"         → só lotes com trilha Prioritário
 *  - "habitual"            → só lotes com trilha Habitual
 *  - "nao_classificado"    → só lotes sem trilha definida
 */
export type TrackFilterValue = "all" | "prioritario" | "habitual" | "nao_classificado";

export function toRpcTrack(v: TrackFilterValue): string | null {
  return v === "all" ? null : v;
}

interface Props {
  value: TrackFilterValue;
  onChange: (v: TrackFilterValue) => void;
  label?: string;
  className?: string;
  showLabel?: boolean;
}

export function PaymentTrackFilter({
  value,
  onChange,
  label = "Trilha",
  className,
  showLabel = true,
}: Props) {
  return (
    <div className={className}>
      {showLabel && <Label className="text-xs">{label}</Label>}
      <Select value={value} onValueChange={(v) => onChange(v as TrackFilterValue)}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder="Todas as trilhas" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as trilhas</SelectItem>
          <SelectItem value="habitual">Pagamento Habitual</SelectItem>
          <SelectItem value="prioritario">Pagamento Prioritário</SelectItem>
          <SelectItem value="nao_classificado">Sem trilha definida</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
