import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

type ReportRow = {
  id: string;
  period_start: string;
  period_end: string;
  source_filename: string | null;
  row_count: number;
  imported_at: string;
};

/**
 * Card de Relatório de Parecer — exibido somente em lotes do tipo Parecer.
 * Bloqueia o início da análise enquanto não houver relatório importado e
 * permite cruzar items↔linhas após o upload.
 */
export function ParecerReportCard({
  paymentId,
  competenceMonth,
  competenceMonths,
}: {
  paymentId: string;
  competenceMonth: string | null;
  competenceMonths: string[] | null;
}) {
  const { toast } = useToast();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [crossing, setCrossing] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  // Defaults de período baseados na competência do lote
  const defaultStart = (() => {
    const m = competenceMonths?.[0] ?? competenceMonth;
    if (!m) return "";
    return m.slice(0, 10);
  })();
  const defaultEnd = (() => {
    const m =
      competenceMonths?.[competenceMonths.length - 1] ?? competenceMonth;
    if (!m) return "";
    const d = new Date(m);
    // último dia do mês
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return last.toISOString().slice(0, 10);
  })();
  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("payment_parecer_reports")
      .select("id,period_start,period_end,source_filename,row_count,imported_at")
      .eq("payment_id", paymentId)
      .order("imported_at", { ascending: false });
    setReports((data ?? []) as ReportRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  const upload = async () => {
    if (!file) {
      toast({ title: "Selecione um arquivo .xls/.xlsx", variant: "destructive" });
      return;
    }
    if (!periodStart || !periodEnd) {
      toast({ title: "Informe o período do relatório", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // base64
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + 0x8000)) as any,
        );
      }
      const b64 = btoa(bin);

      const { data, error } = await supabase.functions.invoke(
        "import-parecer-report",
        {
          body: {
            payment_id: paymentId,
            file_base64: b64,
            filename: file.name,
            period_start: periodStart,
            period_end: periodEnd,
          },
        },
      );
      if (error) throw error;
      if ((data as any)?.duplicate) {
        toast({
          title: "Arquivo já importado",
          description: "Este relatório já foi enviado para este lote.",
        });
      } else {
        toast({
          title: "Relatório importado",
          description: `${(data as any)?.rows ?? 0} linhas carregadas.`,
        });
        setFile(null);
      }
      await load();
      await cross();
    } catch (e: any) {
      toast({
        title: "Falha ao importar",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const cross = async () => {
    setCrossing(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "cross-reference-parecer",
        { body: { payment_id: paymentId, trigger_reanalysis: true } },
      );
      if (error) throw error;
      const d = data as any;
      toast({
        title: "Cruzamento concluído",
        description: `Confirmados: ${d?.confirmed ?? 0} · Não encontrados: ${
          d?.not_found ?? 0
        } · Auto-tratados: ${d?.auto_applied ?? 0}`,
      });
    } catch (e: any) {
      toast({
        title: "Falha no cruzamento",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setCrossing(false);
    }
  };

  const hasReport = reports.length > 0;

  return (
    <Card
      className={
        hasReport
          ? "border-emerald-300/60 bg-emerald-50/30 dark:bg-emerald-950/15"
          : "border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/15"
      }
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Relatório de Parecer (Tasy)
          {hasReport ? (
            <Badge variant="outline" className="border-emerald-400 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Importado
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              <AlertTriangle className="h-3 w-3 mr-1" /> Pendente
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasReport && (
          <p className="text-sm text-muted-foreground">
            Lotes de Parecer exigem o relatório de <em>Parecer Solicitado /
            Respondido</em> do Tasy antes de iniciar a análise. O sistema
            cruza cada item com o relatório para identificar visitas
            sequenciais geradas por parecer.
          </p>
        )}

        {hasReport && (
          <ul className="text-sm space-y-1">
            {reports.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 border-b border-border/40 last:border-0 py-1"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {r.source_filename ?? "(sem nome)"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.period_start} → {r.period_end} · {r.row_count} linhas
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(r.imported_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">Arquivo (.xls/.xlsx)</Label>
            <Input
              type="file"
              accept=".xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
          </div>
          <div>
            <Label className="text-xs">Período início</Label>
            <Input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              disabled={uploading}
            />
          </div>
          <div>
            <Label className="text-xs">Período fim</Label>
            <Input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              disabled={uploading}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={upload} disabled={uploading || !file}>
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              Importar
            </Button>
            {hasReport && (
              <Button
                variant="outline"
                onClick={cross}
                disabled={crossing}
                title="Recruza items × relatórios e reaplica motivos automáticos"
              >
                {crossing ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Recruzar
              </Button>
            )}
          </div>
        </div>

        {loading && (
          <p className="text-xs text-muted-foreground">Carregando relatórios…</p>
        )}
      </CardContent>
    </Card>
  );
}
