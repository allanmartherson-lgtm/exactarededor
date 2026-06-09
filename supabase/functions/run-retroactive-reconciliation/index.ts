// Edge function: cruza a lista alegada pelo médico contra payment_items
// já pagos no período, classifica cada item e persiste em
// retroactive_reconciliation_items. Atualiza o summary do pai.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InputItem = {
  source?: "form" | "upload" | "paste";
  attendance?: string | null;
  tuss_code?: string | null;
  procedure_date?: string | null;
  patient_name?: string | null;
  function_label?: string | null;
  claimed_amount?: number | null;
  raw?: Record<string, unknown>;
};

type Classification =
  | "ok_pago"
  | "pago_a_menos"
  | "nao_pago"
  | "pago_outro_mes"
  | "sem_lastro";

const TOL = 0.05;

function normCode(s: string | null | undefined): string {
  if (!s) return "";
  const digits = String(s).replace(/\D+/g, "");
  return digits.slice(0, 8);
}
function normAtt(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).trim().replace(/\D+/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const reconciliation_id: string = body.reconciliation_id;
    const items: InputItem[] = Array.isArray(body.items) ? body.items : [];

    if (!reconciliation_id) {
      return new Response(
        JSON.stringify({ error: "reconciliation_id obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: recon, error: reconErr } = await supabase
      .from("retroactive_reconciliations")
      .select("id, hospital_id, doctor_id, period_start, period_end")
      .eq("id", reconciliation_id)
      .single();
    if (reconErr || !recon) {
      return new Response(JSON.stringify({ error: "apuração não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Janela ampliada para detectar "pago em outro mês" (±90 dias)
    const startDate = new Date(recon.period_start);
    const endDate = new Date(recon.period_end);
    const wideStart = new Date(startDate);
    wideStart.setDate(wideStart.getDate() - 90);
    const wideEnd = new Date(endDate);
    wideEnd.setDate(wideEnd.getDate() + 90);

    // Carrega payment_items do médico na janela ampliada
    const { data: paid, error: paidErr } = await supabase
      .from("payment_items")
      .select(
        "id, payment_id, attendance_number, procedure_code, procedure_date, doctor_id, gross_amount, expected_amount, procedure_amount",
      )
      .eq("doctor_id", recon.doctor_id)
      .gte("procedure_date", wideStart.toISOString().slice(0, 10))
      .lte("procedure_date", wideEnd.toISOString().slice(0, 10))
      .limit(20000);
    if (paidErr) throw paidErr;

    // Index por chave (atendimento + tuss)
    const paidByKey = new Map<string, typeof paid>();
    for (const p of paid ?? []) {
      const k = `${normAtt(p.attendance_number)}|${normCode(p.procedure_code)}`;
      if (!paidByKey.has(k)) paidByKey.set(k, []);
      paidByKey.get(k)!.push(p);
    }

    // Limpa itens antigos da apuração antes de reprocessar
    await supabase
      .from("retroactive_reconciliation_items")
      .delete()
      .eq("reconciliation_id", reconciliation_id);

    const rowsToInsert: Array<Record<string, unknown>> = [];
    const summary = {
      total: items.length,
      ok_pago: 0,
      pago_a_menos: 0,
      nao_pago: 0,
      pago_outro_mes: 0,
      sem_lastro: 0,
      total_claimed: 0,
      total_paid: 0,
      total_gap: 0,
    };

    for (const it of items) {
      const key = `${normAtt(it.attendance)}|${normCode(it.tuss_code)}`;
      const matches = key ? paidByKey.get(key) ?? [] : [];

      let classification: Classification = "sem_lastro";
      let reason = "";
      let paid_amount: number | null = null;
      let expected_amount: number | null = null;
      let gap_amount: number | null = null;
      let payment_id: string | null = null;
      let payment_item_id: string | null = null;

      if (matches.length > 0) {
        // Pega o que está dentro da janela do período primeiro
        const inWindow = matches.filter((m) => {
          if (!m.procedure_date) return false;
          const d = new Date(m.procedure_date);
          return d >= startDate && d <= endDate;
        });
        const chosen = (inWindow[0] ?? matches[0]) as (typeof matches)[number];
        payment_id = chosen.payment_id;
        payment_item_id = chosen.id;
        paid_amount = Number(chosen.gross_amount ?? 0);
        expected_amount = Number(chosen.expected_amount ?? 0);
        const diff = expected_amount - paid_amount;

        if (inWindow.length === 0) {
          classification = "pago_outro_mes";
          reason = "Item encontrado em pagamento fora do período informado.";
          gap_amount = 0;
        } else if (Math.abs(diff) <= TOL) {
          classification = "ok_pago";
          reason = "Pago conforme esperado.";
          gap_amount = 0;
        } else if (diff > TOL) {
          classification = "pago_a_menos";
          reason = `Esperado ${expected_amount.toFixed(2)} / pago ${paid_amount.toFixed(2)}.`;
          gap_amount = diff;
        } else {
          // pago a mais — não gera complemento, marca como ok_pago com gap negativo
          classification = "ok_pago";
          reason = "Pago acima do esperado.";
          gap_amount = 0;
        }
      } else {
        // Nada encontrado nos pagamentos: marcamos como nao_pago se o médico
        // alegou valor; sem valor alegado vira sem_lastro para revisão manual.
        const claimed = Number(it.claimed_amount ?? 0);
        if (claimed > 0) {
          classification = "nao_pago";
          reason = "Não localizado em pagamentos. Valor alegado pelo médico.";
          gap_amount = claimed;
        } else {
          classification = "sem_lastro";
          reason = "Sem match em pagamentos e sem valor alegado.";
        }
      }

      summary[classification] += 1;
      summary.total_claimed += Number(it.claimed_amount ?? 0);
      summary.total_paid += paid_amount ?? 0;
      if (
        (classification === "nao_pago" || classification === "pago_a_menos") &&
        gap_amount
      ) {
        summary.total_gap += gap_amount;
      }

      rowsToInsert.push({
        reconciliation_id,
        source: it.source ?? "form",
        attendance: it.attendance ?? null,
        tuss_code: it.tuss_code ?? null,
        procedure_date: it.procedure_date ?? null,
        patient_name: it.patient_name ?? null,
        function_label: it.function_label ?? null,
        claimed_amount: it.claimed_amount ?? null,
        paid_amount,
        expected_amount,
        gap_amount,
        payment_id,
        payment_item_id,
        classification,
        classification_reason: reason,
        raw: it.raw ?? {},
      });
    }

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await supabase
        .from("retroactive_reconciliation_items")
        .insert(rowsToInsert);
      if (insErr) throw insErr;
    }

    await supabase
      .from("retroactive_reconciliations")
      .update({ summary, status: "em_analise" })
      .eq("id", reconciliation_id);

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
