// cross-reference-parecer
// Cruza payment_items de um lote 'parecer' contra payment_parecer_report_rows
// importados. Marca parecer_evidence em cada item e, quando confirmado e o
// item ainda não tem tratamento manual, aplica automaticamente o motivo
// 'visita_sequencial_parecer' com source='auto_parecer_report'.
//
// Após o cruzamento, dispara reanalise via dispatch-payment-analysis para
// que o motor recompute com os novos motivos manuais.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const norm = (s: any) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const onlyDigits = (s: any) => String(s ?? "").replace(/\D+/g, "");

function crmDigits(crm: string | null) {
  if (!crm) return "";
  return onlyDigits(crm);
}

// Compara apenas a porção YYYY-MM-DD em UTC, ignorando hora/timezone.
// Chave do parecer = atendimento + médico + DATA (sem hora).
function sameDayUtc(a: string | null, b: string | null) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(+da) || isNaN(+db)) return false;
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
}

// O item pode ter sido lançado tanto na data da SOLICITAÇÃO do parecer
// (consulta beira-leito) quanto na data da RESPOSTA. Aceita match contra
// qualquer uma das duas.
function matchesParecerDate(row: any, procedureDate: string | null) {
  return (
    sameDayUtc(row.dt_resposta_parecer, procedureDate) ||
    sameDayUtc(row.dt_solic_parecer, procedureDate)
  );
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  try {
    const { payment_id, trigger_reanalysis = true } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Tipo do lote (parecer_adulto, normalmente) e tipo Visita (alvo da reclassificação)
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("payment_type_id")
      .eq("id", payment_id)
      .maybeSingle();
    const lotePaymentTypeId = (paymentRow as any)?.payment_type_id ?? null;
    const { data: visitaType } = await supabase
      .from("payment_types")
      .select("id")
      .eq("code", "visita")
      .maybeSingle();
    const visitaPaymentTypeId = (visitaType as any)?.id ?? null;

    // Reports do lote
    const { data: reports, error: repErr } = await supabase
      .from("payment_parecer_reports")
      .select("id, period_start, period_end")
      .eq("payment_id", payment_id);
    if (repErr) throw repErr;
    const hasReport = (reports ?? []).length > 0;

    if (!hasReport) {
      return new Response(
        JSON.stringify({
          error: "Nenhum relatório de parecer importado para este lote.",
          code: "no_report",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let allRows: any[] = [];
    if (hasReport) {
      const ids = reports!.map((r) => r.id);
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: page, error } = await supabase
          .from("payment_parecer_report_rows")
          .select(
            "id, report_id, atendimento, medico_resposta, medico_resposta_crm, dt_resposta_parecer, situacao",
          )
          .in("report_id", ids)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        allRows.push(...(page ?? []));
        if (!page || page.length < pageSize) break;
      }
    }

    if (allRows.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Relatório de parecer importado, mas sem linhas gravadas. Reimporte o arquivo — o cabeçalho está vazio.",
          code: "empty_report",
          reports: reports?.length ?? 0,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Indexa por (atendimento + médico). A confirmação final também exige
    // mesma data de resposta/procedimento; sem data, o item permanece not_found.
    const byAttendCrm = new Map<string, any[]>();
    const byAttendName = new Map<string, any[]>();
    for (const r of allRows) {
      const att = onlyDigits(r.atendimento);
      if (!att) continue;
      const cd = crmDigits(r.medico_resposta_crm);
      if (cd) {
        const k = `${att}|${cd}`;
        (byAttendCrm.get(k) ?? byAttendCrm.set(k, []).get(k))!.push(r);
      }
      const nm = norm(r.medico_resposta);
      if (nm) {
        const k = `${att}|${nm}`;
        (byAttendName.get(k) ?? byAttendName.set(k, []).get(k))!.push(r);
      }
    }

    // Motivo auto
    const { data: autoReason } = await supabase
      .from("manual_intervention_reasons")
      .select("id, code")
      .eq("code", "visita_sequencial_parecer")
      .maybeSingle();
    const autoReasonId = (autoReason as any)?.id ?? null;

    // Carrega itens do lote
    const items: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data: page, error } = await supabase
        .from("payment_items")
        .select(
          "id, attendance_number, doctor_name, doctor_id, procedure_date, procedure_amount, manual_intervention_reason_id, manual_intervention_source, payment_type_id, payment_type_source",
        )
        .eq("payment_id", payment_id)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      items.push(...(page ?? []));
      if (!page || page.length < pageSize) break;
    }

    // Carrega CRMs dos médicos referenciados
    const doctorIds = Array.from(
      new Set(items.map((i) => i.doctor_id).filter(Boolean)),
    );
    const crmByDoctor = new Map<string, string>();
    if (doctorIds.length) {
      const { data: docs } = await supabase
        .from("doctors")
        .select("id, crm, crm_uf")
        .in("id", doctorIds);
      for (const d of (docs ?? []) as any[]) {
        if (d.crm) crmByDoctor.set(d.id, onlyDigits(d.crm));
      }
    }

    const updates: Array<{
      id: string;
      evidence: "confirmed" | "not_found" | "no_report";
      row_id: string | null;
      weak: boolean;
      apply_auto_reason: boolean;
      procedure_amount: number | null;
    }> = [];

    for (const it of items) {
      const procAmt =
        it.procedure_amount == null ? null : Number(it.procedure_amount);
      if (!hasReport) {
        updates.push({
          id: it.id,
          evidence: "no_report",
          row_id: null,
          weak: false,
          apply_auto_reason: false,
          procedure_amount: procAmt,
        });
        continue;
      }
      const att = onlyDigits(it.attendance_number);
      const cd = crmByDoctor.get(it.doctor_id ?? "") ?? "";
      const nm = norm(it.doctor_name);
      let hit: any = null;
      let weak = false;

      if (att && cd) {
        const list = byAttendCrm.get(`${att}|${cd}`) ?? [];
        hit =
          list.find((r) =>
            sameDayUtc(r.dt_resposta_parecer, it.procedure_date) &&
            String(r.situacao ?? "").toLowerCase().includes("com parecer"),
          ) ?? list.find((r) =>
            sameDayUtc(r.dt_resposta_parecer, it.procedure_date),
          ) ?? null;
      }
      if (!hit && att && nm) {
        const list = byAttendName.get(`${att}|${nm}`) ?? [];
        // fallback exige mesma data (parecer respondido no dia do lançamento)
        hit =
          list.find((r) =>
            sameDayUtc(r.dt_resposta_parecer, it.procedure_date),
          ) ?? null;
        if (hit) weak = true;
      }

      if (hit) {
        // Já tratado manualmente? Não sobrescreve.
        const alreadyManual = !!it.manual_intervention_reason_id;
        updates.push({
          id: it.id,
          evidence: "confirmed",
          row_id: hit.id,
          weak,
          apply_auto_reason: !alreadyManual && !!autoReasonId,
          procedure_amount: procAmt,
        });
      } else {
        updates.push({
          id: it.id,
          evidence: "not_found",
          row_id: null,
          weak: false,
          apply_auto_reason: false,
          procedure_amount: procAmt,
        });
      }
    }

    // Aplica em batches agrupados por patch (reduz deadlocks e overhead de triggers)
    const now = new Date().toISOString();
    let confirmed = 0;
    let notFound = 0;
    let autoApplied = 0;
    const PROTECTED_SOURCES = new Set(["manual", "company_override"]);
    const itemById = new Map(items.map((i: any) => [i.id, i]));
    let subtypeParecer = 0;
    let subtypeVisita = 0;

    console.log(
      `[cross-reference-parecer] reclass_ready loteType=${lotePaymentTypeId} visitaType=${visitaPaymentTypeId} updates=${updates.length}`,
    );

    // Agrupa updates por chave-de-patch (mesmo conjunto de colunas/valores)
    // para fazer 1 update batch por grupo via .in("id", [...]).
    type Group = { patch: Record<string, any>; ids: string[]; evidence: string };
    const groups = new Map<string, Group>();
    for (const u of updates) {
      const patch: Record<string, any> = {
        parecer_evidence: u.evidence,
        parecer_report_row_id: u.row_id,
        parecer_evidence_weak: u.weak,
        parecer_checked_at: now,
      };
      const current = itemById.get(u.id) as any;
      const currentSource = current?.payment_type_source ?? null;
      const protectedType = PROTECTED_SOURCES.has(currentSource);
      if (!protectedType && lotePaymentTypeId && visitaPaymentTypeId) {
        if (u.evidence === "confirmed") {
          patch.payment_type_id = lotePaymentTypeId;
          patch.payment_type_source = "report_cross";
          subtypeParecer++;
        } else if (u.evidence === "not_found") {
          patch.payment_type_id = visitaPaymentTypeId;
          patch.payment_type_source = "report_cross";
          subtypeVisita++;
        }
      }
      if (u.apply_auto_reason) {
        patch.manual_intervention_reason_id = autoReasonId;
        patch.manual_intervention_source = "auto_parecer_report";
        patch.manual_intervention_notes =
          "Aplicado automaticamente: item confirmado no relatório de parecer.";
        if (u.procedure_amount != null && Number.isFinite(u.procedure_amount)) {
          patch.expected_amount = u.procedure_amount;
        }
        patch.ai_status = "aprovado";
        autoApplied++;
      }
      // Chave: stringify do patch (ignora ordem das keys pequena variação)
      const key = JSON.stringify(patch);
      let g = groups.get(key);
      if (!g) {
        g = { patch, ids: [], evidence: u.evidence };
        groups.set(key, g);
      }
      g.ids.push(u.id);
    }

    console.log(
      `[cross-reference-parecer] grouped into ${groups.size} batch(es); subtypeParecer=${subtypeParecer} subtypeVisita=${subtypeVisita}`,
    );

    const CHUNK = 200;
    for (const g of groups.values()) {
      for (let i = 0; i < g.ids.length; i += CHUNK) {
        const slice = g.ids.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("payment_items")
          .update(g.patch as any)
          .in("id", slice);
        if (error) {
          console.error(
            `[cross-reference-parecer] batch update fail (${slice.length} ids)`,
            error.message,
          );
          continue;
        }
        if (g.evidence === "confirmed") confirmed += slice.length;
        else if (g.evidence === "not_found") notFound += slice.length;
      }
    }


    // Sempre dispara reanálise após cruzamento bem-sucedido — mesmo com 0
    // auto-aplicados, o lote pode estar bloqueado pelo gate de parecer.
    if (trigger_reanalysis && hasReport) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/dispatch-payment-analysis`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            payment_id,
            force_fresh_rules: true,
          }),
        });
      } catch (e) {
        console.warn("[cross-reference-parecer] dispatch falhou", e);
      }
    }


    return new Response(
      JSON.stringify({
        ok: true,
        items_total: items.length,
        report_rows: allRows.length,
        has_report: hasReport,
        confirmed,
        not_found: notFound,
        auto_applied: autoApplied,
        subtype_parecer: subtypeParecer,
        subtype_visita: subtypeVisita,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[cross-reference-parecer]", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
