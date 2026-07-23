import { useEffect, useRef, useState } from "react";
import {
  Pin,
  Clock,
  Check,
  StickyNote,
  Paperclip,
  Download,
  Trash2,
  Loader2,
  CheckCircle2 as CloudCheck,
  AlertCircle as CloudAlert,
  FileText,
} from "lucide-react";
import { alertDialog } from "@/lib/confirm";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  UserCompanyMarker,
  NoteAttachment,
  NoteSaveStatus,
} from "@/hooks/useUserCompanyNotes";

interface Props {
  note: string;
  marker: UserCompanyMarker;
  waitingInfo: string;
  attachments?: NoteAttachment[];
  saveStatus?: NoteSaveStatus;
  onNoteChange: (v: string) => void;
  onMarkerChange: (m: UserCompanyMarker) => void;
  onWaitingInfoChange: (v: string) => void;
  onUploadAttachment?: (file: File) => Promise<void> | void;
  onDeleteAttachment?: (id: string) => Promise<void> | void;
  onDownloadAttachment?: (att: NoteAttachment) => Promise<void> | void;
}

function formatBytes(n: number) {
  if (!n) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${sizes[i]}`;
}

/**
 * Bloco compacto de nota privada + 3 marcadores pessoais + anexos.
 *
 * - Textareas/inputs locais com debounce de 700ms para evitar re-render do pai
 *   a cada tecla.
 * - Indicador de salvamento (salvando / salvo / erro).
 * - Anexos (PDF/planilha) ficam vinculados à nota; download via URL assinada.
 * - Responsivo: empilha em telas pequenas, mostra ícone-only nos botões.
 */
export function PrivateCompanyNote({
  note,
  marker,
  waitingInfo,
  attachments = [],
  saveStatus = "idle",
  onNoteChange,
  onMarkerChange,
  onWaitingInfoChange,
  onUploadAttachment,
  onDeleteAttachment,
  onDownloadAttachment,
}: Props) {
  const [localNote, setLocalNote] = useState(note);
  const [localWaiting, setLocalWaiting] = useState(waitingInfo);
  const [open, setOpen] = useState(!!note || attachments.length > 0);
  const [uploading, setUploading] = useState(false);

  const dirtyNoteRef = useRef(false);
  const dirtyWaitingRef = useRef(false);
  useEffect(() => {
    if (!dirtyNoteRef.current) setLocalNote(note);
  }, [note]);
  useEffect(() => {
    if (!dirtyWaitingRef.current) setLocalWaiting(waitingInfo);
  }, [waitingInfo]);

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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handlePickFile = () => fileInputRef.current?.click();
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onUploadAttachment) return;
    if (file.size > 20 * 1024 * 1024) {
      await alertDialog({
        title: "Arquivo muito grande",
        description: "O anexo excede o limite de 20 MB. Compacte o arquivo antes de tentar novamente.",
        tone: "warning",
      });
      return;
    }
    setUploading(true);
    try {
      await onUploadAttachment(file);
      setOpen(true);
    } finally {
      setUploading(false);
    }
  };

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
        "h-7 px-2 text-[11px] gap-1 shrink-0",
        marker === key && activeClass,
      )}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </Button>
  );

  const renderStatus = () => {
    if (saveStatus === "saving" || uploading) {
      return (
        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Salvando…
        </span>
      );
    }
    if (saveStatus === "saved") {
      return (
        <span className="inline-flex items-center gap-1 text-[10.5px] text-[hsl(var(--success-text,142_72%_29%))]">
          <CloudCheck className="h-3 w-3" /> Salvo
        </span>
      );
    }
    if (saveStatus === "error") {
      return (
        <span className="inline-flex items-center gap-1 text-[10.5px] text-destructive">
          <CloudAlert className="h-3 w-3" /> Erro ao salvar
        </span>
      );
    }
    return null;
  };

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-1.5">
      {/* Cabeçalho: rótulo + status + marcadores. Em telas pequenas vira coluna. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
            <StickyNote className="h-3.5 w-3.5" />
            Privado (só você vê)
          </div>
          {renderStatus()}
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
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
          {onUploadAttachment && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePickFile}
              disabled={uploading}
              className="h-7 px-2 text-[11px] gap-1 shrink-0"
              title="Anexar arquivo (PDF, planilha, imagem)"
            >
              <Paperclip className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Anexar</span>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] shrink-0"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Ocultar" : note || attachments.length > 0 ? "Editar" : "+ Nota"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx"
            onChange={handleFileSelected}
          />
        </div>
      </div>

      {marker === "waiting" && (
        <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            Aguardando:
          </span>
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
          placeholder="Anote o que viu aqui — só você verá esta nota. Salvamento automático."
          className="mt-2 min-h-[64px] text-[12.5px] bg-background"
        />
      )}

      {open && attachments.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-2 rounded-sm border bg-background px-2 py-1 text-[11.5px]"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1" title={att.file_name}>
                {att.file_name}
              </span>
              <span className="text-[10.5px] text-muted-foreground shrink-0 hidden sm:inline">
                {formatBytes(att.size_bytes)}
              </span>
              {onDownloadAttachment && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => onDownloadAttachment(att)}
                  title="Baixar"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              )}
              {onDeleteAttachment && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => onDeleteAttachment(att.id)}
                  title="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
