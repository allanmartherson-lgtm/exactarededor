// Versionamento de arquivos de NF — NUNCA apagar o arquivo enviado pela empresa.
// Antes de limpar os campos de recebimento da invoice, movemos o arquivo atual
// para um caminho versionado ({payment_id}/{invoice_id}/v{n}.{ext}) e gravamos
// uma linha em invoice_file_versions com o snapshot dos dados.

// deno-lint-ignore-file no-explicit-any
export type InvoiceVersionSource = "reenvio_empresa" | "correcao_solicitada";

export type InvoiceSnapshot = {
  id: string;
  payment_id: string;
  hospital_id?: string | null;
  file_path?: string | null;
  invoice_number?: string | null;
  received_amount?: number | null;
  ai_validation?: unknown;
  ai_extracted_amount?: number | null;
  ai_extracted_number?: string | null;
  ai_extracted_cnpj?: string | null;
};

export type VersionResult = {
  ok: boolean;
  version: number | null;
  archived_path: string | null;
  error?: string;
};

/**
 * Arquiva a versão atual do arquivo da NF (move no storage + registra linha).
 * Nunca deleta: se o move falhar, mantém o caminho original no registro.
 */
export async function archiveInvoiceFileVersion(
  supabase: any,
  invoice: InvoiceSnapshot,
  opts: { source: InvoiceVersionSource; reason?: string | null; hospitalId?: string | null },
): Promise<VersionResult> {
  try {
    const hospitalId = opts.hospitalId ?? invoice.hospital_id ?? null;
    if (!hospitalId) return { ok: false, version: null, archived_path: null, error: "hospital_id ausente" };

    const { data: last } = await supabase
      .from("invoice_file_versions")
      .select("version")
      .eq("invoice_id", invoice.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = Number(last?.version ?? 0) + 1;

    let archivedPath: string | null = invoice.file_path ?? null;
    if (invoice.file_path) {
      const ext = invoice.file_path.split(".").pop() || "pdf";
      const target = `${invoice.payment_id}/${invoice.id}/v${nextVersion}.${ext}`;
      const { error: moveErr } = await supabase.storage
        .from("invoices")
        .move(invoice.file_path, target);
      if (moveErr) {
        console.warn("[invoiceVersioning] falha ao mover arquivo:", moveErr.message ?? moveErr);
      } else {
        archivedPath = target;
      }
    }

    const { error: insErr } = await supabase.from("invoice_file_versions").insert({
      invoice_id: invoice.id,
      payment_id: invoice.payment_id,
      hospital_id: hospitalId,
      version: nextVersion,
      file_path: archivedPath,
      invoice_number: invoice.invoice_number ?? null,
      received_amount: invoice.received_amount ?? null,
      ai_validation: invoice.ai_validation ?? null,
      ai_extracted_amount: invoice.ai_extracted_amount ?? null,
      ai_extracted_number: invoice.ai_extracted_number ?? null,
      ai_extracted_cnpj: invoice.ai_extracted_cnpj ?? null,
      reason: opts.reason ?? null,
      source: opts.source,
    });
    if (insErr) {
      console.error("[invoiceVersioning] insert error", insErr);
      return { ok: false, version: nextVersion, archived_path: archivedPath, error: insErr.message };
    }

    return { ok: true, version: nextVersion, archived_path: archivedPath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[invoiceVersioning] erro", msg);
    return { ok: false, version: null, archived_path: null, error: msg };
  }
}
