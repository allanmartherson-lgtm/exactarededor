// import-parecer-report
// Recebe um relatório de Parecer Solicitado/Respondido exportado do Tasy
// (xls/xlsx em base64), parseia e grava o cabeçalho + linhas para uso do
// motor (cross-reference-parecer). Sem este relatório, lotes de Parecer
// não passam pelo gate em dispatch-payment-analysis.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Normaliza header de coluna do Tasy: lowercase, sem acento, alfanumérico.
const normHeader = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

// Tenta achar a coluna pelo nome (lista de aliases possíveis no Tasy).
function pick(row: Record<string, any>, aliases: string[]): any {
  for (const a of aliases) {
    const key = normHeader(a);
    if (key in row && row[key] !== "" && row[key] != null) return row[key];
  }
  return null;
}

// Extrai dígitos + UF de uma string tipo "12345/DF" ou "CRM 12345 DF".
function normalizeCrm(input: any): string | null {
  if (input == null) return null;
  const s = String(input).toUpperCase();
  const m = s.match(/(\d{2,7})\s*[\/\-\s]*([A-Z]{2})/);
  if (m) return `${m[1]}/${m[2]}`;
  const onlyDigits = s.match(/\d{2,7}/);
  if (onlyDigits) return onlyDigits[0];
  return null;
}

function parseExcelDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = v * 86400 * 1000;
    return new Date(epoch.getTime() + ms).toISOString();
  }
  const s = String(v).trim();
  // dd/mm/yyyy[ hh:mm[:ss]]
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    const [_, d, mo, y, h = "0", mi = "0", se = "0"] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(
      Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)),
    );
    return isNaN(+dt) ? null : dt.toISOString();
  }
  const dt = new Date(s);
  return isNaN(+dt) ? null : dt.toISOString();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const {
      payment_id,
      file_base64,
      filename,
      period_start,
      period_end,
      notes,
    } = body ?? {};

    if (!payment_id || !file_base64 || !period_start || !period_end) {
      return new Response(
        JSON.stringify({
          error:
            "payment_id, file_base64, period_start, period_end são obrigatórios",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("authorization") ?? "";
    const userClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await userClient.auth.getUser();

    // Decode base64 (pode vir como data URL)
    const b64 = file_base64.includes(",")
      ? file_base64.split(",")[1]
      : file_base64;
    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fileHash = await sha256Hex(binary);

    // Idempotência: mesmo hash já importado para este pagamento → 409
    const { data: existing } = await supabase
      .from("payment_parecer_reports")
      .select("id")
      .eq("payment_id", payment_id)
      .eq("source_file_hash", fileHash)
      .maybeSingle();
    if (existing) {
      return new Response(
        JSON.stringify({
          ok: false,
          duplicate: true,
          report_id: existing.id,
          message: "Este arquivo já foi importado para este lote.",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const wb = XLSX.read(binary, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: "",
      raw: false,
    });

    if (!raw.length) {
      return new Response(
        JSON.stringify({ error: "Planilha vazia ou sem cabeçalho" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Hospital do pagamento
    const { data: payRow } = await supabase
      .from("payments")
      .select("hospital_id")
      .eq("id", payment_id)
      .maybeSingle();

    // Cabeçalho
    const { data: header, error: headerErr } = await supabase
      .from("payment_parecer_reports")
      .insert({
        payment_id,
        hospital_id: (payRow as any)?.hospital_id ?? null,
        period_start,
        period_end,
        source_filename: filename ?? null,
        source_file_hash: fileHash,
        row_count: 0,
        imported_by: user?.id ?? null,
        notes: notes ?? null,
      })
      .select("id")
      .single();
    if (headerErr) throw headerErr;
    const reportId = header.id as string;

    // Normaliza linhas
    const rowsToInsert = raw.map((rec) => {
      const norm: Record<string, any> = {};
      for (const k of Object.keys(rec)) norm[normHeader(k)] = rec[k];

      const medicoResp =
        pick(norm, [
          "medico_resposta",
          "medico_que_respondeu",
          "medico_responde",
          "medico_executor",
          "responsavel",
        ]) ?? null;
      const crm = normalizeCrm(
        pick(norm, [
          "crm_resposta",
          "crm_medico_resposta",
          "crm",
          "conselho",
          "conselho_resposta",
        ]) ?? medicoResp,
      );

      return {
        report_id: reportId,
        atendimento:
          pick(norm, ["atendimento", "nr_atendimento", "atend", "nr_atend"]) ??
          null,
        paciente: pick(norm, ["paciente", "nome_paciente"]) ?? null,
        medico_solicitante:
          pick(norm, [
            "medico_solicitante",
            "solicitante",
            "medico_solic",
          ]) ?? null,
        medico_resposta: medicoResp,
        medico_resposta_crm: crm,
        espec_origem: pick(norm, ["espec_origem", "especialidade_origem"]) ?? null,
        espec_destino:
          pick(norm, ["espec_destino", "especialidade_destino"]) ?? null,
        dt_solic_parecer: parseExcelDate(
          pick(norm, ["dt_solic_parecer", "data_solicitacao", "dt_solicitacao"]),
        ),
        dt_resposta_parecer: parseExcelDate(
          pick(norm, [
            "dt_resposta_parecer",
            "data_resposta",
            "dt_resposta",
          ]),
        ),
        situacao: pick(norm, ["situacao", "status", "situacao_parecer"]) ?? null,
        raw: rec,
      };
    });

    // Insert em chunks de 500
    let inserted = 0;
    for (let i = 0; i < rowsToInsert.length; i += 500) {
      const chunk = rowsToInsert.slice(i, i + 500);
      const { error: insErr } = await supabase
        .from("payment_parecer_report_rows")
        .insert(chunk as any);
      if (insErr) throw insErr;
      inserted += chunk.length;
    }

    await supabase
      .from("payment_parecer_reports")
      .update({ row_count: inserted } as any)
      .eq("id", reportId);

    return new Response(
      JSON.stringify({
        ok: true,
        report_id: reportId,
        rows: inserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[import-parecer-report]", e);
    return new Response(
      JSON.stringify({ error: e?.message ?? String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
