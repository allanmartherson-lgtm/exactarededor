import { useEffect, useRef, useState } from "react";
import { Pin, Clock, Check, StickyNote } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserCompanyMarker } from "@/hooks/useUserCompanyNotes";

interface Props {
  note: string;
  marker: UserCompanyMarker;
  waitingInfo: string;
  onNoteChange: (v: string) => void;
  onMarkerChange: (m: UserCompanyMarker) => void;
  onWaitingInfoChange: (v: string) => void;
}

/**
 * Bloco compacto de nota privada + 3 marcadores pessoais.
 *
 * Performance: textareas/inputs mantêm estado LOCAL e só propagam para o
 * pai após 700ms de digitação ociosa. Sem isso, cada tecla disparava
 * setByGroup no hook, que re-renderizava toda a PaymentDetail (cálculo de
 * visibleGroups/sortedGroups/pivot/etc.) e travava a digitação.
 */
export function PrivateCompanyNote({
  note,
  marker,
  waitingInfo,
  onNoteChange,
  onMarkerChange,
  onWaitingInfoChange,
}: Props) {
  const [localNote, setLocalNote] = useState(note);
  const [localWaiting, setLocalWaiting] = useState(waitingInfo);
  const [open, setOpen] = useState(!!note);

  // Sincroniza com props quando mudam por fora (carga inicial, save remoto).
  // Só sobrescreve o local se o usuário não tem digitação em buffer.
  const dirtyNoteRef = useRef(false);
  const dirtyWaitingRef = useRef(false);
  useEffect(() => {
    if (!dirtyNoteRef.current) setLocalNote(note);
  }, [note]);
  useEffect(() => {
    if (!dirtyWaitingRef.current) setLocalWaiting(waitingInfo);
  }, [waitingInfo]);

  // Debounce upstream — só chama onNoteChange após o usuário parar de digitar.
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNoteChange = (v: string) => {
    setLocalNote(v);
    dirtyNoteRef.current = true;
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => {
      dirtyNoteRef.current = false;
      onNoteChange(v);
    }, 700);
  };

  const handleWaitingChange = (v: string) => {
    setLocalWaiting(v);
    dirtyWaitingRef.current = true;
    if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
    waitingTimerRef.current = setTimeout(() => {
      dirtyWaitingRef.current = false;
      onWaitingInfoChange(v);
    }, 700);
  };

  // Flush ao desmontar para não perder o que foi digitado.
  useEffect(() => {
    return () => {
      if (noteTimerRef.current) {
        clearTimeout(noteTimerRef.current);
        if (dirtyNoteRef.current) onNoteChange(localNote);
      }
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
        if (dirtyWaitingRef.current) onWaitingInfoChange(localWaiting);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      className={cn("h-7 px-2 text-[11px] gap-1", marker === key && activeClass)}
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
          {markerBtn(
            "pinned",
            Pin,
            "Fixar",
            "bg-[hsl(var(--warning-soft))] border-[hsl(var(--warning-soft))] text-[hsl(var(--warning-text))] hover:bg-[hsl(var(--warning-soft))]",
          )}
          {markerBtn(
            "waiting",
            Clock,
            "Aguardando Info",
            "bg-[hsl(var(--info-soft))] border-[hsl(var(--info-soft))] text-[hsl(var(--info-text))] hover:bg-[hsl(var(--info-soft))]",
          )}
          {markerBtn(
            "reviewed",
            Check,
            "Já revisei",
            "bg-[hsl(var(--success-soft))] border-[hsl(var(--success-soft))] text-[hsl(var(--success-text))] hover:bg-[hsl(var(--success-soft))]",
          )}
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

      {marker === "waiting" && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">Aguardando:</span>
          <Input
            value={localWaiting}
            onChange={(e) => handleWaitingChange(e.target.value)}
            placeholder="Ex.: Faturamento — confirmar lançamento; Dra. Ana — autorização"
            className="h-7 text-[12px] bg-background"
          />
        </div>
      )}

      {open && (
        <Textarea
          value={localNote}
          onChange={(e) => handleNoteChange(e.target.value)}
          placeholder="Anote o que viu aqui — só você verá esta nota."
          className="mt-2 min-h-[56px] text-[12.5px] bg-background"
        />
      )}
    </div>
  );
}
