import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Download, FileSpreadsheet, ShieldCheck, Loader2 } from "lucide-react";

type SourceFile = {
  id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  bucket_role: string;
  is_legacy: boolean;
  uploaded_at: string;
};

const ROLE_LABEL: Record<string, string> = {
  sat: "SAT",
  sat_geral: "SAT Geral",
  bonus: "Bônus",
  sobreaviso: "Sobreaviso",
  outros: "Outros",
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function PaymentSourceFilesList({ paymentId }: { paymentId: string }) {
  const [files, setFiles] = useState<SourceFile[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("payment_source_files")
        .select("*")
        .eq("payment_id", paymentId)
        .order("uploaded_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.warn("[PaymentSourceFilesList] load error:", error);
        setFiles([]);
        return;
      }
      setFiles(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [paymentId]);

  const handleDownload = async (f: SourceFile) => {
    setDownloadingId(f.id);
    try {
      const { data, error } = await supabase.storage
        .from(f.storage_bucket)
        .createSignedUrl(f.storage_path, 300);
      if (error || !data?.signedUrl) throw error ?? new Error("URL vazia");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({
        title: "Não foi possível baixar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  if (files === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Arquivos originais
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" /> Arquivos originais
        </CardTitle>
        <CardDescription>
          Planilhas enviadas neste lote — preservadas para auditoria e reprocessamento.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum arquivo original registrado para este lote.
          </p>
        ) : (
          <ul className="divide-y">
            {files.map((f) => (
              <li key={f.id} className="py-2 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{f.original_filename}</span>
                    <Badge variant="outline" className="text-xs">
                      {ROLE_LABEL[f.bucket_role] ?? f.bucket_role}
                    </Badge>
                    {f.is_legacy && (
                      <Badge variant="secondary" className="text-xs">legado</Badge>
                    )}
                    {f.sha256 && (
                      <span
                        className="text-[10px] font-mono text-muted-foreground flex items-center gap-1"
                        title={`SHA-256: ${f.sha256}`}
                      >
                        <ShieldCheck className="h-3 w-3" /> {f.sha256.slice(0, 10)}…
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatSize(f.size_bytes)} · {new Date(f.uploaded_at).toLocaleString("pt-BR")}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownload(f)}
                  disabled={downloadingId === f.id}
                >
                  {downloadingId === f.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  <span className="ml-1">Baixar</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
