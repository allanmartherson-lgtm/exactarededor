// import-parecer-report
// Endpoint multi-modo para importar o relatório de Parecer Solicitado/Respondido
// do Tasy. O PARSING do xlsx é feito no cliente (browser) para evitar estouro
// de memória/CPU no worker. A função apenas:
//   - mode=init     → cria/encontra o cabeçalho (idempotente por source_file_hash)
//   - mode=append   → insere um chunk de linhas já normalizadas
//   - mode=finalize → atualiza row_count
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);
    return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const mode = (body?.mode ?? "init") as "init" | "append" | "finalize";

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (mode === "init") {
      const {
        payment_id,
        filename,
        file_hash,
        period_start,
        period_end,
        notes,
      } = body ?? {};
      // period_start/period_end são derivados automaticamente no cliente
      // (min/max das datas do arquivo). Mantidos como obrigatórios aqui
      // como guard-rail — colunas no banco são NOT NULL.
      if (!payment_id || !file_hash || !period_start || !period_end) {
        return json(
          { error: "payment_id, file_hash, period_start, period_end são obrigatórios" },
          400,
        );
      }

      const { data: existing } = await supabase
        .from("payment_parecer_reports")
        .select("id,row_count")
        .eq("payment_id", payment_id)
        .eq("source_file_hash", file_hash)
        .maybeSingle();
      if (existing) {
        // Header órfão de tentativa anterior (rows nunca chegaram) → reusa.
        if ((existing as any).row_count === 0) {
          // Limpa qualquer linha parcial e libera append
          await supabase
            .from("payment_parecer_report_rows")
            .delete()
            .eq("report_id", (existing as any).id);
          return json({ ok: true, report_id: (existing as any).id, resumed: true });
        }
        return json(
          {
            ok: false,
            duplicate: true,
            report_id: existing.id,
            message: "Este arquivo já foi importado para este lote.",
          },
          409,
        );
      }


      const authHeader = req.headers.get("authorization") ?? "";
      const userClient = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const {
        data: { user },
      } = await userClient.auth.getUser();

      const { data: payRow } = await supabase
        .from("payments")
        .select("hospital_id")
        .eq("id", payment_id)
        .maybeSingle();
      const hospitalId = (payRow as any)?.hospital_id;
      if (!hospitalId) {
        return json({ error: "Pagamento sem hospital vinculado — não é possível importar relatório de parecer." }, 400);
      }
      if (!_auth.is_internal && !assertCallerHospital(_auth, hospitalId)) {
        return json({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }, 403);
      }

      const { data: header, error: headerErr } = await supabase
        .from("payment_parecer_reports")
        .insert({
          payment_id,
          hospital_id: hospitalId,
          period_start,
          period_end,
          source_filename: filename ?? null,
          source_file_hash: file_hash,
          row_count: 0,
          imported_by: user?.id ?? null,
          notes: notes ?? null,
        })
        .select("id")
        .single();
      if (headerErr) throw headerErr;

      return json({ ok: true, report_id: header.id });
    }

    if (mode === "append") {
      const { report_id, rows } = body ?? {};
      if (!report_id || !Array.isArray(rows)) {
        return json({ error: "report_id e rows[] são obrigatórios" }, 400);
      }
      if (rows.length === 0) return json({ ok: true, inserted: 0 });

      const payload = rows.map((r: any) => ({
        report_id,
        atendimento: r.atendimento ?? null,
        paciente: r.paciente ?? null,
        medico_solicitante: r.medico_solicitante ?? null,
        medico_resposta: r.medico_resposta ?? null,
        medico_resposta_crm: r.medico_resposta_crm ?? null,
        espec_origem: r.espec_origem ?? null,
        espec_destino: r.espec_destino ?? null,
        dt_solic_parecer: r.dt_solic_parecer ?? null,
        dt_resposta_parecer: r.dt_resposta_parecer ?? null,
        situacao: r.situacao ?? null,
        raw: r.raw ?? null,
      }));

      const { error: insErr } = await supabase
        .from("payment_parecer_report_rows")
        .insert(payload as any);
      if (insErr) throw insErr;

      return json({ ok: true, inserted: payload.length });
    }

    if (mode === "finalize") {
      const { report_id, row_count } = body ?? {};
      if (!report_id) return json({ error: "report_id obrigatório" }, 400);
      await supabase
        .from("payment_parecer_reports")
        .update({ row_count: Number(row_count) || 0 } as any)
        .eq("id", report_id);

      // Dispara cruzamento automático com os itens do lote — reclassifica
      // Parecer × Visita e enriquece evidências sem ação manual do analista.
      let crossRef: any = null;
      try {
        const { data: rep } = await supabase
          .from("payment_parecer_reports")
          .select("payment_id")
          .eq("id", report_id)
          .maybeSingle();
        const paymentId = (rep as any)?.payment_id ?? null;
        if (paymentId) {
          const { data: cr, error: crErr } = await supabase.functions.invoke(
            "cross-reference-parecer",
            { body: { payment_id: paymentId } },
          );
          if (crErr) {
            console.warn("[import-parecer-report] cross-reference falhou", crErr);
          } else {
            crossRef = cr;
          }
        }
      } catch (e) {
        console.warn("[import-parecer-report] cross-reference erro", e);
      }

      return json({
        ok: true,
        report_id,
        row_count: Number(row_count) || 0,
        cross_reference: crossRef,
      });
    }


    return json({ error: `mode inválido: ${mode}` }, 400);
  } catch (e: any) {
    console.error("[import-parecer-report]", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
