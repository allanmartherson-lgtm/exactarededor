import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, FileText, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateBR } from "@/lib/dateUtils";

type ReportRow = {
  id: string;
  source_filename: string | null;
  row_count: number | null;
  period_start: string | null;
  period_end: string | null;
  imported_at: string | null;
};

type ItemRow = {
  id: string;
  attendance_number: string | null;
  patient_name: string | null;
  convenio_slug: string | null;

  doctor_name: string | null;
  specialty: string | null;
  procedure_date: string | null;
  ai_status: string | null;
  manual_intervention_source: string | null;
  manual_intervention_notes: string | null;
  parecer_evidence: string | null;
  parecer_evidence_weak: boolean | null;
  parecer_checked_at: string | null;
  parecer_report_row_id: string | null;
  reclassified_from_parecer: boolean | null;
};


export function ParecerCrossReferencePanel({
  paymentId,
  companyName,
  enabled,
}: {
  paymentId: string;
  companyName?: string | null;
  enabled: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [actualRows, setActualRows] = useState(0);
  const [items, setItems] = useState<ItemRow[]>([]);

  const load = async () => {
    if (!enabled || !paymentId) return;
    setLoading(true);
    try {
      const { data: reportData } = await supabase
        .from("payment_parecer_reports")
        .select("id,source_filename,row_count,period_start,period_end,imported_at")
        .eq("payment_id", paymentId)
        .order("imported_at", { ascending: false });
      const reportRows = (reportData ?? []) as ReportRow[];
      setReports(reportRows);

      if (reportRows.length) {
        const { count } = await supabase
          .from("payment_parecer_report_rows")
          .select("id", { count: "exact", head: true })
          .in("report_id", reportRows.map((r) => r.id));
        setActualRows(count ?? 0);
      } else {
        setActualRows(0);
      }

      let q = supabase
        .from("payment_items")
        .select(
          "id,attendance_number,patient_name,convenio_slug,doctor_name,specialty,procedure_date,ai_status,manual_intervention_source,manual_intervention_notes,parecer_evidence,parecer_evidence_weak,parecer_checked_at,parecer_report_row_id,reclassified_from_parecer",
        )
        .eq("payment_id", paymentId)
        .order("created_at");
      if (companyName) q = q.eq("company_name", companyName);
      const { data: itemData } = await q;
      setItems((itemData ?? []) as ItemRow[]);

    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId, companyName, enabled]);

  const summary = useMemo(() => {
    const total = items.length;
    const checked = items.filter((i) => !!i.parecer_evidence).length;
    const confirmed = items.filter((i) => i.parecer_evidence === "confirmed").length;
    const missing = items.filter((i) => i.parecer_evidence === "not_found").length;
    const weak = items.filter((i) => i.parecer_evidence === "confirmed" && i.parecer_evidence_weak).length;
    const autoTreated = items.filter((i) => i.manual_intervention_source === "auto_parecer_report").length;
    const reclassified = items.filter((i) => i.reclassified_from_parecer === true).length;
    return { total, checked, confirmed, missing, weak, autoTreated, reclassified };
  }, [items]);

  const reclassifiedItems = items.filter((i) => i.reclassified_from_parecer === true);


  const issues = items
    .filter((i) => i.parecer_evidence === "not_found" || (i.parecer_evidence === "confirmed" && i.parecer_evidence_weak))
    .slice(0, 25);

  if (!enabled) return null;

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Cruzamento do parecer
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Raio-X do vínculo por atendimento, data e médico gravado no banco.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
          <Metric label="Itens" value={summary.total} />
          <Metric label="Verificados" value={summary.checked} />
          <Metric label="Cruzados" value={summary.confirmed} tone="success" />
          <Metric label="Sem parecer" value={summary.missing} tone={summary.missing ? "warning" : "muted"} />
          <Metric label="Divergentes" value={summary.weak} tone={summary.weak ? "warning" : "muted"} />
          <Metric label="Auto-tratados" value={summary.autoTreated} tone="success" />
          <Metric label="Reclassificados" value={summary.reclassified} tone={summary.reclassified ? "warning" : "muted"} />
        </div>


        <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Relatório importado:</span>
            <Badge variant="outline">{reports.length} arquivo{reports.length !== 1 ? "s" : ""}</Badge>
            <Badge variant="outline">{actualRows} linha{actualRows !== 1 ? "s" : ""} lida{actualRows !== 1 ? "s" : ""}</Badge>
          </div>
          {reports.map((r) => (
            <div key={r.id} className="text-muted-foreground">
              {r.source_filename ?? "(sem nome)"} · {r.period_start ?? "—"} → {r.period_end ?? "—"} · declarado: {r.row_count ?? 0}
            </div>
          ))}
          {reports.length > 0 && actualRows === 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/25 dark:text-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Há cabeçalho de relatório importado, mas nenhuma linha de parecer foi gravada. O cruzamento não tem base real para confirmar atendimento/data/médico.</span>
            </div>
          )}
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Atendimento</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Médico</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Status parecer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    <CheckCircle2 className="h-4 w-4 inline mr-1" /> Nenhuma pendência de parecer nesta visão.
                  </TableCell>
                </TableRow>
              ) : (
                issues.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.attendance_number ?? "—"}</TableCell>
                    <TableCell className="text-xs">{it.patient_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{it.doctor_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{formatDateBR(it.procedure_date)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          it.parecer_evidence === "not_found"
                            ? "border-amber-300 text-amber-800 bg-amber-50"
                            : "border-amber-300 text-amber-800 bg-amber-50",
                        )}
                      >
                        {it.parecer_evidence === "not_found" ? "Sem parecer cruzado" : "Parecer divergente"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {reclassifiedItems.length > 0 && (
          <div className="rounded-md border border-amber-300/40 bg-amber-50/30 dark:bg-amber-950/10 overflow-hidden">
            <div className="px-3 py-2 border-b border-amber-300/40 text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
              Reclassificados de Parecer → Visita ({reclassifiedItems.length})
              <span className="text-muted-foreground font-normal">
                · convênio não paga 2 pareceres seguidos da mesma especialidade
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Atendimento</TableHead>
                  <TableHead>Especialidade</TableHead>
                  <TableHead>Convênio</TableHead>
                  <TableHead>Médico</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reclassifiedItems.slice(0, 50).map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.attendance_number ?? "—"}</TableCell>
                    <TableCell className="text-xs">{it.specialty ?? "—"}</TableCell>
                    <TableCell className="text-xs">{it.convenio_slug ?? "—"}</TableCell>
                    <TableCell className="text-xs">{it.doctor_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{formatDateBR(it.procedure_date)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{it.manual_intervention_notes ?? "—"}</TableCell>
                  </TableRow>
                ))}

              </TableBody>
            </Table>
            {reclassifiedItems.length > 50 && (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t">
                +{reclassifiedItems.length - 50} item(ns) adicionais não mostrados.
              </div>
            )}
          </div>
        )}
      </CardContent>

    </Card>
  );
}

function Metric({ label, value, tone = "muted" }: { label: string; value: number; tone?: "success" | "warning" | "muted" }) {
  return (
    <div className={cn("rounded-md border p-3", tone === "success" && "bg-success-soft border-success/20", tone === "warning" && "bg-warning-soft border-warning/30", tone === "muted" && "bg-muted/20")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}