import { supabase } from "@/integrations/supabase/client";

export type ExportFormat = "csv" | "pdf" | "print" | "view";

export interface LogExportInput {
  reportKey: string;
  reportLabel: string;
  format: ExportFormat;
  filters?: Record<string, unknown>;
  hospitalId?: string | null;
  rowCount?: number | null;
}

/**
 * Registra um evento de exportação/visualização de relatório.
 * Falhas são silenciosas (não bloqueiam o download para o usuário).
 */
export async function logExport(input: LogExportInput): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return;

    await (supabase.from("export_log" as any) as any).insert({
      user_id: user.id,
      user_email: user.email ?? null,
      user_name: (user.user_metadata as any)?.full_name ?? null,
      report_key: input.reportKey,
      report_label: input.reportLabel,
      format: input.format,
      filters: input.filters ?? {},
      hospital_id: input.hospitalId ?? null,
      row_count: input.rowCount ?? null,
    });
  } catch {
    // silencioso
  }
}

/** Util: dispara janela de impressão com um HTML formatado. */
export function printHtml(title: string, bodyHtml: string) {
  const w = window.open("", "_blank", "noopener,noreferrer,width=1024,height=768");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:24px}
  h1{font-size:18px;margin:0 0 4px}
  .meta{color:#555;font-size:11px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f5f5f5;font-weight:600}
  tr:nth-child(even) td{background:#fafafa}
  @media print { @page { size: A4 landscape; margin: 10mm } }
</style></head><body>${bodyHtml}<script>window.onload=()=>{setTimeout(()=>window.print(),250)}</script></body></html>`);
  w.document.close();
}
