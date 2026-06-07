/**
 * Painel de anexos da pendência.
 *
 * - Lista todos os anexos vinculados à pendência (enviados por analista,
 *   empresa ou médico) em ordem cronológica.
 * - Permite ao analista logado fazer upload de novos anexos.
 * - Realtime: assina INSERT em `pendencia_attachments` filtrado por pendencia_id.
 *
 * Bucket: `pendencia-attachments`. Caminho: `<pendencia_id>/<uuid>_<filename>`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Paperclip, Download, Upload, FileText, Loader2, Stethoscope, Building2, UserCog } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type Attachment = {
  id: string;
  pendencia_id: string;
  uploaded_by_type: "analista" | "empresa" | "medico" | "sistema";
  uploaded_by_name: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

const BUCKET = "pendencia-attachments";
const MAX_BYTES = 20 * 1024 * 1024; // 20MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForAuthor(type: Attachment["uploaded_by_type"]) {
  if (type === "medico") return <Stethoscope className="h-3 w-3" />;
  if (type === "empresa") return <Building2 className="h-3 w-3" />;
  return <UserCog className="h-3 w-3" />;
}

interface Props {
  pendenciaId: string;
  /** Tipo do autor que está usando o painel (default: analista). */
  uploaderType?: "analista" | "empresa" | "medico";
}

export function PendenciaAttachmentsPanel({ pendenciaId, uploaderType = "analista" }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [authorName, setAuthorName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    void supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setAuthorName((data?.full_name as string | null) ?? user.email ?? "Equipe");
      });
  }, [user?.id, user?.email]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pendencia_attachments" as never)
      .select("*")
      .eq("pendencia_id", pendenciaId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Falha ao carregar anexos: " + error.message);
      setItems([]);
    } else {
      setItems((data ?? []) as unknown as Attachment[]);
    }
    setLoading(false);
  }, [pendenciaId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`pend-attach-${pendenciaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pendencia_attachments", filter: `pendencia_id=eq.${pendenciaId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, pendenciaId]);

  const onPick = () => fileRef.current?.click();

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user?.id) return;
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo acima de 20MB.");
      return;
    }
    setUploading(true);
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${pendenciaId}/${crypto.randomUUID()}_${safe}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setUploading(false);
      toast.error("Falha no upload: " + upErr.message);
      return;
    }
    const { error: insErr } = await supabase.from("pendencia_attachments" as never).insert({
      pendencia_id: pendenciaId,
      uploaded_by_user_id: user.id,
      uploaded_by_type: uploaderType,
      uploaded_by_name: authorName || user.email || "Equipe",
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    } as never);
    setUploading(false);
    if (insErr) {
      toast.error("Falha ao registrar anexo: " + insErr.message);
      // Best-effort: limpa o objeto órfão do storage.
      void supabase.storage.from(BUCKET).remove([path]);
      return;
    }
    toast.success("Anexo enviado.");
    void load();
  };

  const download = async (att: Attachment) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(att.storage_path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível gerar link de download.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Anexos
          {items.length > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">({items.length})</span>
          )}
        </h2>
        <Button size="sm" variant="outline" className="gap-1.5 h-7 text-[12px]" onClick={onPick} disabled={uploading}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? "Enviando…" : "Anexar"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => void onUpload(e)}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-[12px] text-muted-foreground py-2">
          Nenhum anexo. Envie um arquivo para anexar à pendência (até 20MB).
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/40">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2">
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[12.5px] text-foreground truncate" title={a.file_name}>
                  {a.file_name}
                </span>
                <span className="text-[10.5px] text-muted-foreground flex items-center gap-1.5">
                  {iconForAuthor(a.uploaded_by_type)}
                  <span className="truncate">{a.uploaded_by_name}</span>
                  <span>·</span>
                  <span>{formatSize(a.size_bytes)}</span>
                  <span>·</span>
                  <span>{format(new Date(a.created_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                </span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 flex-shrink-0"
                onClick={() => void download(a)}
                aria-label="Baixar anexo"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
