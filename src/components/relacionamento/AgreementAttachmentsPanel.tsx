/**
 * Anexos do Cadastro de Acordos (tabelas de códigos/valores em PDF ou planilha).
 *
 * Bucket: `company-attachments` (mesmo dos anexos de empresa).
 * Caminho: `acordos/<agreement_id>/<uuid>_<filename>`.
 *
 * Usado no wizard (upload) e nas filas de Supervisor/Diretor/Analista (somente leitura),
 * para consulta durante a validação e o cadastro da regra.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

const BUCKET = "company-attachments";
const MAX_BYTES = 20 * 1024 * 1024; // 20MB
const ACCEPT = ".pdf,.xls,.xlsx,.csv,application/pdf";

export interface AgreementAttachment {
  id: string;
  agreement_id: string;
  file_name: string;
  file_path: string;
  file_mime: string | null;
  file_size_bytes: number | null;
  uploaded_at: string;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  agreementId: string | null;
  /** Nas filas de aprovação o painel é apenas consulta. */
  readOnly?: boolean;
}

export function AgreementAttachmentsPanel({ agreementId, readOnly = false }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<AgreementAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!agreementId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("agreement_registration_attachments")
      .select("id,agreement_id,file_name,file_path,file_mime,file_size_bytes,uploaded_at")
      .eq("agreement_id", agreementId)
      .order("uploaded_at", { ascending: true });
    if (error) {
      toast.error("Falha ao carregar anexos: " + error.message);
      setItems([]);
    } else {
      setItems((data ?? []) as AgreementAttachment[]);
    }
    setLoading(false);
  }, [agreementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0 || !agreementId || !user?.id) return;
    setUploading(true);
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        toast.error(`"${file.name}" excede 20MB.`);
        continue;
      }
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `acordos/${agreementId}/${crypto.randomUUID()}_${safe}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) {
        toast.error(`Falha no upload de "${file.name}": ${upErr.message}`);
        continue;
      }
      const { error: insErr } = await supabase.from("agreement_registration_attachments").insert({
        agreement_id: agreementId,
        file_name: file.name,
        file_path: path,
        file_mime: file.type || null,
        file_size_bytes: file.size,
        uploaded_by: user.id,
      });
      if (insErr) {
        toast.error(`Falha ao registrar "${file.name}": ${insErr.message}`);
        // Remove o objeto órfão para não deixar lixo no bucket
        void supabase.storage.from(BUCKET).remove([path]);
      }
    }
    setUploading(false);
    await load();
  };

  const onDownload = async (item: AgreementAttachment) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(item.file_path, 60, { download: item.file_name });
    if (error || !data?.signedUrl) {
      toast.error("Falha ao gerar link de download.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const onRemove = async (item: AgreementAttachment) => {
    // Exclusão de anexo não pode ser desfeita
    if (!window.confirm(`Remover o anexo "${item.file_name}"?`)) return;
    const { error } = await supabase
      .from("agreement_registration_attachments")
      .delete()
      .eq("id", item.id);
    if (error) {
      toast.error("Falha ao remover anexo: " + error.message);
      return;
    }
    void supabase.storage.from(BUCKET).remove([item.file_path]);
    toast.success("Anexo removido.");
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="h-4 w-4" />
          Anexos do acordo
        </p>
        {!readOnly && (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={onUpload}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!agreementId || uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              Anexar arquivos
            </Button>
          </>
        )}
      </div>

      {!readOnly && !agreementId && (
        <p className="text-xs text-muted-foreground">
          Salve o rascunho (avance uma etapa) para habilitar o envio de anexos.
        </p>
      )}

      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum anexo enviado.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background p-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.file_name}</p>
                <p className="text-xs text-muted-foreground">{formatSize(item.file_size_bytes)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Baixar ${item.file_name}`}
                onClick={() => void onDownload(item)}
              >
                <Download className="h-4 w-4" />
              </Button>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remover ${item.file_name}`}
                  onClick={() => void onRemove(item)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
