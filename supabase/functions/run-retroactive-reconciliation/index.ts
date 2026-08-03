// Edge function: cruza a lista alegada pelo médico contra payment_items
// já pagos no período, classifica cada item e persiste em
// retroactive_reconciliation_items. Atualiza o summary do pai.
//
// Cruzamento agrega TODOS os payment_items que casam (atendimento + TUSS),
// somando quantidade e valor — assim, se o médico alegou 2 vias e só 1 foi
// paga, a diferença de quantidade aparece como pago_a_menos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";


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
  procedure_name?: string | null;
  claimed_amount?: number | null;
  claimed_quantity?: number | null;
  raw?: Record<string, unknown>;
};

type Classification =
  | "ok_pago"
  | "pago_a_menos"
  | "pago_a_mais"
  | "nao_pago"
  | "pago_outro_mes"
  | "tuss_divergente"
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

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

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
      .select("id, hospital_id, doctor_id, company_id, period_start, period_end, summary")
      .eq("id", reconciliation_id)
      .single();
    if (reconErr || !recon) {
      return new Response(JSON.stringify({ error: "apuração não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Gate de hospital: apuração de outro hospital não pode ser reprocessada.
    if (!assertCallerHospital(auth, recon.hospital_id ?? "")) {
      return new Response(JSON.stringify({ error: "hospital_scope_denied", message: "Sem acesso a este hospital." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!recon.doctor_id && !recon.company_id) {
      return new Response(
        JSON.stringify({ error: "apuração precisa de médico ou PJ" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if ((recon.summary as Record<string, unknown> | null)?.mode === "tasy_vs_repasse") {
      return new Response(
        JSON.stringify({
          error: "TASY vs Repasse deve ser reprocessado pelo motor com lote selecionado.",
          detail: "A função retroativa legada usa janela ampliada e não garante isolamento por selected_payment_ids.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Janela ampliada para detectar "pago em outro mês" (±90 dias)
    const startDate = new Date(recon.period_start);
    const endDate = new Date(recon.period_end);
    const wideStart = new Date(startDate);
    wideStart.setDate(wideStart.getDate() - 90);
    const wideEnd = new Date(endDate);
    wideEnd.setDate(wideEnd.getDate() + 90);

    let paidQ = supabase
      .from("payment_items")
      .select(
        "id, payment_id, attendance_number, procedure_code, procedure_date, doctor_id, company_id, quantity, gross_amount, expected_amount, procedure_amount",
      )
      .gte("procedure_date", wideStart.toISOString().slice(0, 10))
      .lte("procedure_date", wideEnd.toISOString().slice(0, 10))
      .limit(20000);
    if (recon.doctor_id) paidQ = paidQ.eq("doctor_id", recon.doctor_id);
    if (recon.company_id) paidQ = paidQ.eq("company_id", recon.company_id);
    const { data: paid, error: paidErr } = await paidQ;
    if (paidErr) throw paidErr;

    const paidByKey = new Map<string, typeof paid>();
    const paidByAttendance = new Map<string, typeof paid>();
    for (const p of paid ?? []) {
      const att = normAtt(p.attendance_number);
      const k = `${att}|${normCode(p.procedure_code)}`;
      if (!paidByKey.has(k)) paidByKey.set(k, []);
      paidByKey.get(k)!.push(p);
      if (att) {
        if (!paidByAttendance.has(att)) paidByAttendance.set(att, []);
        paidByAttendance.get(att)!.push(p);
      }
    }

    await supabase
      .from("retroactive_reconciliation_items")
      .delete()
      .eq("reconciliation_id", reconciliation_id);

    const rowsToInsert: Array<Record<string, unknown>> = [];
    const summary = {
      total: items.length,
      ok_pago: 0,
      pago_a_menos: 0,
      pago_a_mais: 0,
      nao_pago: 0,
      pago_outro_mes: 0,
      sem_lastro: 0,
      tuss_divergente: 0,
      total_claimed: 0,
      total_paid: 0,
      total_gap: 0,
      total_excess: 0,
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
      let paid_quantity: number | null = null;
      let matched_payment_date: string | null = null;

      const claimedQty = it.claimed_quantity != null ? Number(it.claimed_quantity) : 1;
      const claimedAmt = it.claimed_amount != null ? Number(it.claimed_amount) : 0;

      if (matches.length > 0) {
        const inWindow = matches.filter((m) => {
          if (!m.procedure_date) return false;
          const d = new Date(m.procedure_date);
          return d >= startDate && d <= endDate;
        });
        const scope = inWindow.length > 0 ? inWindow : matches;

        // Agrega todos os matches do mesmo (atend+tuss). Para esta fase
        // (pendência alegada pelo médico) só interessa PRESENÇA e
        // QUANTIDADE — o médico não está questionando valor de repasse.
        // Guardamos gross/expected apenas como informação.
        const aggPaid = scope.reduce((s, m) => s + Number(m.gross_amount ?? 0), 0);
        const aggExpected = scope.reduce((s, m) => s + Number(m.expected_amount ?? 0), 0);
        const aggQty = scope.reduce((s, m) => s + Number(m.quantity ?? 1), 0);
        const chosen = scope[0];
        payment_id = chosen.payment_id;
        payment_item_id = chosen.id;
        paid_amount = aggPaid;
        expected_amount = aggExpected;
        paid_quantity = aggQty;
        matched_payment_date = chosen.procedure_date ?? null;

        const qtyDiff = claimedQty - aggQty;

        if (inWindow.length === 0) {
          classification = "pago_outro_mes";
          reason = `Item encontrado em ${chosen.procedure_date ?? "data fora do período"}.`;
          gap_amount = 0;
        } else if (qtyDiff > 0.001) {
          // Faltou quantidade — gap = valor cru alegado pela qtd faltante.
          classification = "pago_a_menos";
          const unitClaimed = claimedAmt / Math.max(claimedQty, 1);
          gap_amount = unitClaimed * qtyDiff;
          reason = `Qtd alegada ${claimedQty} / paga ${aggQty}. Faltam ${qtyDiff.toFixed(0)} unidade(s) × R$ ${unitClaimed.toFixed(2)}.`;
        } else if (qtyDiff < -0.001) {
          // Pago a mais — quantidade paga supera a alegada pelo médico.
          // Mesma ideia da conciliação do lote: sinaliza excedente para
          // o analista revisar (possível duplicidade ou cobrança incorreta).
          classification = "pago_a_mais";
          const excessQty = -qtyDiff;
          const unitClaimed = claimedAmt > 0 ? claimedAmt / Math.max(claimedQty, 1) : 0;
          // gap negativo = excedente pago ao médico (a recuperar/revisar)
          gap_amount = -(unitClaimed * excessQty);
          reason = `Qtd alegada ${claimedQty} / paga ${aggQty}. Pago ${excessQty.toFixed(0)} unidade(s) a mais — revisar duplicidade.`;
        } else {
          // Presente e quantidade ok — fase de pendência considera conciliado.
          // Eventual divergência de valor de repasse será tratada quando a
          // regra recalcular, não aqui.
          classification = "ok_pago";
          reason = `Pago (qtd ${aggQty}). Valor não é avaliado nesta fase.`;
          gap_amount = 0;
        }
      } else {
        // Sem match exato (atend+TUSS). Verifica se o atendimento existe nos
        // pagamentos — quando existe, é TUSS divergente (lançado com código
        // diferente do alegado), não "não pago".
        const attKey = normAtt(it.attendance);
        const attMatches = attKey ? paidByAttendance.get(attKey) ?? [] : [];
        if (attMatches.length > 0) {
          const tussList = Array.from(
            new Set(attMatches.map((m) => normCode(m.procedure_code)).filter(Boolean)),
          );
          const totalPagoAtend = attMatches.reduce((s, m) => s + Number(m.gross_amount ?? 0), 0);
          classification = "tuss_divergente";
          reason = `Atendimento ${it.attendance} foi pago (R$ ${totalPagoAtend.toFixed(2)}) com TUSS ${tussList.join(", ")} — alegado ${it.tuss_code} não localizado.`;
          paid_amount = 0;
          gap_amount = claimedAmt || 0;
        } else if (claimedAmt > 0) {
          classification = "nao_pago";
          reason = `Atendimento ${it.attendance ?? "—"} não localizado em pagamentos. Alegado ${claimedAmt.toFixed(2)} (qtd ${claimedQty}).`;
          gap_amount = claimedAmt;
        } else {
          classification = "sem_lastro";
          reason = "Sem match em pagamentos e sem valor alegado.";
        }
      }


      summary[classification] += 1;
      summary.total_claimed += claimedAmt;
      summary.total_paid += paid_amount ?? 0;
      if (
        (classification === "nao_pago" ||
          classification === "pago_a_menos" ||
          classification === "tuss_divergente") &&
        gap_amount
      ) {
        summary.total_gap += gap_amount;
      }
      if (classification === "pago_a_mais" && gap_amount) {
        // gap_amount é negativo; total_excess armazena o módulo do excedente.
        summary.total_excess += Math.abs(gap_amount);
      }


      rowsToInsert.push({
        reconciliation_id,
        source: it.source ?? "form",
        attendance: it.attendance ?? null,
        tuss_code: it.tuss_code ?? null,
        procedure_date: it.procedure_date ?? null,
        patient_name: it.patient_name ?? null,
        function_label: it.function_label ?? null,
        procedure_name: it.procedure_name ?? null,
        claimed_amount: claimedAmt || null,
        claimed_quantity: claimedQty,
        paid_amount,
        paid_quantity,
        expected_amount,
        gap_amount,
        payment_id,
        payment_item_id,
        matched_payment_date,
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
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    console.error("run-retroactive-reconciliation error:", msg, e);
    return new Response(
      JSON.stringify({ error: msg, detail: e instanceof Error ? e.stack : null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

});
