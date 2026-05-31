import { useEffect, useState } from "react";
import { Pin, Clock, Check, StickyNote } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserCompanyMarker } from "@/hooks/useUserCompanyNotes";

interface Props {
  note: string;
  marker: UserCompanyMarker;
  onNoteChange: (v: string) => void;
  onMarkerChange: (m: UserCompanyMarker) => void;
}

/**
 * Bloco compacto de nota privada + 3 marcadores pessoais.
 * - Só o próprio usuário enxerga.
 * - Marker controla prioridade na fila (pinned ↑ topo, waiting/reviewed ↓ fim).
 */
export function PrivateCompanyNote({ note, marker, onNoteChange, onMarkerChange }: Props) {
  const [local, setLocal] = useState(note);
  const [open, setOpen] = useState(!!note);
  useEffect(() => setLocal(note), [note]);

  const toggle = (m: UserCompanyMarker) => onMarkerChange(marker === m ? null : m);

  const markerBtn = (
    key: Exclude<UserCompanyMarker, null>,
    Icon: typeof Pin,
    label: string,
    activeClass: string,
  ) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => toggle(key)}
      className={cn(
        "h-7 px-2 text-[11px] gap-1",
        marker === key && activeClass,
      )}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <StickyNote className="h-3.5 w-3.5" />
          Privado (só você vê)
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {markerBtn("pinned", Pin, "Fixar", "bg-[hsl(var(--warning-soft))] border-[hsl(var(--warning-soft))] text-[hsl(var(--warning-text))] hover:bg-[hsl(var(--warning-soft))]")}
          {markerBtn("waiting", Clock, "Aguardando Info", "bg-[hsl(var(--info-soft))] border-[hsl(var(--info-soft))] text-[hsl(var(--info-text))] hover:bg-[hsl(var(--info-soft))]")}
          {markerBtn("reviewed", Check, "Já revisei", "bg-[hsl(var(--success-soft))] border-[hsl(var(--success-soft))] text-[hsl(var(--success-text))] hover:bg-[hsl(var(--success-soft))]")}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Ocultar nota" : note ? "Editar nota" : "+ Nota"}
          </Button>
        </div>
      </div>
      {open && (
        <Textarea
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            onNoteChange(e.target.value);
          }}
          placeholder="Anote o que viu aqui — só você verá esta nota."
          className="mt-2 min-h-[56px] text-[12.5px] bg-background"
        />
      )}
    </div>
  );
}
