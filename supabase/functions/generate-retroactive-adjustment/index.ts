// v2: respeita excluir_do_encaminhamento (Tópico 2 opt-out)
// Edge function: gera company_financial_adjustments (tipo
// complemento_retroativo) a partir dos itens nao_pago / pago_a_menos
// de uma apuração retroativa. Agrupa por PJ vinculada ao médico.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { reconciliation_id, company_id: forceCompanyId } = await req.json();
    if (!reconciliation_id) {
      return new Response(JSON.stringify({ error: "reconciliation_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: recon, error: rErr } = await supabase
      .from("retroactive_reconciliations")
      .select("id, doctor_id, company_id, hospital_id, period_start, period_end, title, status")
      .eq("id", reconciliation_id)
      .single();
    if (rErr || !recon) {
      return new Response(JSON.stringify({ error: "apuração não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Gate de hospital: escrita financeira só no hospital do chamador.
    if (!assertCallerHospital(auth, recon.hospital_id ?? "")) {
      return new Response(JSON.stringify({ error: "hospital_scope_denied", message: "Sem acesso a este hospital." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (recon.status === "concluida") {
      return new Response(
        JSON.stringify({ error: "apuração já concluída" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: items, error: itErr } = await supabase
      .from("retroactive_reconciliation_items")
      .select("id, gap_amount, classification, company_id")
      .eq("reconciliation_id", reconciliation_id)
      .eq("excluir_do_encaminhamento", false)
      .in("classification", ["nao_pago", "pago_a_menos", "tuss_divergente"]);

    if (itErr) throw itErr;

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "Nenhum item elegível para complemento após aplicar exclusões manuais." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve a PJ alvo: forçada > escopo da apuração > única PJ ativa do médico.
    let targetCompanyId: string | null = forceCompanyId ?? recon.company_id ?? null;
    if (!targetCompanyId) {
      if (!recon.doctor_id) {
        return new Response(
          JSON.stringify({ error: "Informe company_id ou vincule a apuração a um médico." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: links } = await supabase
        .from("doctor_companies")
        .select("company_id, end_date")
        .eq("doctor_id", recon.doctor_id);
      const active = (links ?? []).filter((l) => !l.end_date);
      if (active.length === 0) {
        return new Response(
          JSON.stringify({
            error:
              "Médico sem PJ ativa vinculada. Vincule uma PJ ou informe company_id manualmente.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (active.length > 1) {
        return new Response(
          JSON.stringify({
            error: "Médico tem múltiplas PJs ativas. Informe company_id manualmente.",
            companies: active.map((a) => a.company_id),
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      targetCompanyId = active[0].company_id;
    }

    const total = items.reduce((s, i) => s + Number(i.gap_amount ?? 0), 0);
    if (total <= 0) {
      return new Response(
        JSON.stringify({ error: "Total a complementar é zero." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const title =
      recon.title ?? `Complemento retroativo ${recon.period_start} a ${recon.period_end}`;

    const { data: adj, error: adjErr } = await supabase
      .from("company_financial_adjustments")
      .insert({
        company_id: targetCompanyId,
        tipo: "complemento_retroativo",
        descricao: title,
        valor_total: total,
        parcelas_total: 1,
        parcelas_pagas: 0,
        data_inicio: new Date().toISOString().slice(0, 10),
        ativo: true,
        origem: `retro_recon:${reconciliation_id}`,
        hospital_id: recon.hospital_id,
      })
      .select("id")
      .single();
    if (adjErr) throw adjErr;

    // Marca itens como vinculados ao ajuste
    await supabase
      .from("retroactive_reconciliation_items")
      .update({ generated_adjustment_id: adj.id })
      .eq("reconciliation_id", reconciliation_id)
      .eq("excluir_do_encaminhamento", false)
      .in("classification", ["nao_pago", "pago_a_menos", "tuss_divergente"]);

    await supabase
      .from("retroactive_reconciliations")
      .update({
        status: "concluida",
        concluded_at: new Date().toISOString(),
        adjustment_ids: [adj.id],
      })
      .eq("id", reconciliation_id);

    return new Response(
      JSON.stringify({
        ok: true,
        adjustment_id: adj.id,
        company_id: targetCompanyId,
        total,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
