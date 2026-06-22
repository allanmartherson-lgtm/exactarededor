// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { payment_id, company_id } = await req.json();
    if (!payment_id || !company_id) {
      return new Response(JSON.stringify({ error: "payment_id and company_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Identity for auditing
    const authHeader = req.headers.get("Authorization");
    let user_id: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      user_id = user?.id ?? null;
    }

    const summary: any = {
      debitos: { proposed: 0, updated_existing: 0, skipped_existing: 0, reverted_stale: 0, items: [] as any[] },
      glosas:  { proposed: 0, skipped_existing: 0, ambiguous: 0, sem_pj: 0, items: [] as any[] },
    };

    // ============ DÉBITOS (company_financial_adjustments) ============
    const { data: adjustments } = await supabase
      .from("company_financial_adjustments")
      .select("*")
      .eq("company_id", company_id)
      .eq("ativo", true);

    const { data: existingCaa } = await supabase
      .from("company_adjustment_applications")
      .select("id, adjustment_id, status, source, valor_aplicado, parcela_numero")
      .eq("payment_id", payment_id)
      .eq("company_id", company_id);

    const existingByAdj = new Map<string, any[]>();
    for (const row of existingCaa ?? []) {
      const rows = existingByAdj.get((row as any).adjustment_id) ?? [];
      rows.push(row);
      existingByAdj.set((row as any).adjustment_id, rows);
    }

    const activeAdjustmentIds = new Set((adjustments ?? []).map((a: any) => a.id));
    for (const row of existingCaa ?? []) {
      if ((row as any).status === "proposto" && (row as any).source === "auto" && !activeAdjustmentIds.has((row as any).adjustment_id)) {
        await supabase.from("company_adjustment_applications")
          .update({ status: "revertido", reverted_at: new Date().toISOString(), reverted_by: user_id, reverted_reason: "Ajuste financeiro inativo/removido antes da reaplicação" })
          .eq("id", (row as any).id);
        summary.debitos.reverted_stale++;
      }
    }

    for (const adj of adjustments ?? []) {
      const restantes = (adj.parcelas_total ?? 1) - (adj.parcelas_pagas ?? 0);
      const existingRows = existingByAdj.get(adj.id) ?? [];
      if (restantes <= 0) {
        for (const row of existingRows.filter((r: any) => r.status === "proposto" && r.source === "auto")) {
          await supabase.from("company_adjustment_applications")
            .update({ status: "revertido", reverted_at: new Date().toISOString(), reverted_by: user_id, reverted_reason: "Ajuste sem parcelas pendentes antes da reaplicação" })
            .eq("id", row.id);
          summary.debitos.reverted_stale++;
        }
        continue;
      }
      const parcelaValor = round2(Number(adj.valor_total) / Number(adj.parcelas_total));
      const parcelaNumero = (adj.parcelas_pagas ?? 0) + 1;

      const autoProposto = existingRows.find((r: any) => r.status === "proposto" && r.source === "auto");
      if (autoProposto) {
        const needsUpdate = Number(autoProposto.valor_aplicado ?? 0) !== parcelaValor
          || Number(autoProposto.parcela_numero ?? 0) !== parcelaNumero;
        if (needsUpdate) {
          const { error: updErr } = await supabase
            .from("company_adjustment_applications")
            .update({ valor_aplicado: parcelaValor, parcela_numero: parcelaNumero, applied_by: user_id })
            .eq("id", autoProposto.id);
          if (!updErr) {
            summary.debitos.updated_existing++;
            summary.debitos.items.push({ adjustment_id: adj.id, descricao: adj.descricao, tipo: adj.tipo, valor: parcelaValor, parcela: `${parcelaNumero}/${adj.parcelas_total}`, action: "updated" });
          }
        } else {
          summary.debitos.skipped_existing++;
        }
        continue;
      }

      const activeExisting = existingRows.find((r: any) => ["proposto", "confirmado"].includes(r.status));
      if (activeExisting) { summary.debitos.skipped_existing++; continue; }

      const reusableReverted = existingRows.find((r: any) => r.status === "revertido" && Number(r.parcela_numero ?? 0) === parcelaNumero);
      if (reusableReverted) {
        const { error: reviveErr } = await supabase
          .from("company_adjustment_applications")
          .update({ valor_aplicado: parcelaValor, parcela_numero: parcelaNumero, applied_by: user_id, status: "proposto", source: "auto", reverted_at: null, reverted_by: null, reverted_reason: null })
          .eq("id", reusableReverted.id);
        if (!reviveErr) {
          summary.debitos.proposed++;
          summary.debitos.items.push({ adjustment_id: adj.id, descricao: adj.descricao, tipo: adj.tipo, valor: parcelaValor, parcela: `${parcelaNumero}/${adj.parcelas_total}`, action: "revived" });
        }
        continue;
      }

      const { error: insErr } = await supabase
        .from("company_adjustment_applications")
        .insert({
          payment_id, company_id, adjustment_id: adj.id,
          valor_aplicado: parcelaValor, parcela_numero: parcelaNumero,
          applied_by: user_id, status: "proposto", source: "auto",
        });
      if (!insErr) {
        summary.debitos.proposed++;
        summary.debitos.items.push({ adjustment_id: adj.id, descricao: adj.descricao, tipo: adj.tipo, valor: parcelaValor, parcela: `${parcelaNumero}/${adj.parcelas_total}` });
      }
    }

    // ============ GLOSAS ============
    // Competência do lote para resolver a PJ vigente do médico na data correta
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("competence_month")
      .eq("id", payment_id)
      .maybeSingle();
    const competenceDate: string = (paymentRow?.competence_month as string)
      || new Date().toISOString().slice(0, 10);

    // Doctors with production in this lote/company
    const { data: items } = await supabase
      .from("payment_items")
      .select("doctor_id, gross_amount")
      .eq("payment_id", payment_id)
      .eq("company_id", company_id)
      .not("doctor_id", "is", null);

    const doctorIds = Array.from(new Set((items ?? []).map((i: any) => i.doctor_id).filter(Boolean)));

    if (doctorIds.length > 0) {
      const { data: debts } = await supabase
        .from("glosa_debts")
        .select("*")
        .eq("status", "ativo")
        .not("confirmed_at", "is", null)
        .eq("target_payment_id", payment_id)
        .in("doctor_id", doctorIds)
        .or("resolution_status.is.null,resolution_status.neq.ignorado");


      const { data: existingGpa } = await supabase
        .from("glosa_payment_applications")
        .select("glosa_debt_id, status")
        .eq("payment_id", payment_id)
        .eq("company_id", company_id)
        .in("status", ["proposto", "confirmado", "pending_manual_resolution"]);

      const existingDebtIds = new Set((existingGpa ?? []).map((r: any) => r.glosa_debt_id));

      for (const debt of debts ?? []) {
        if (existingDebtIds.has(debt.id)) { summary.glosas.skipped_existing++; continue; }

        // Resolve doctor → PJs vigentes na competência do pagamento.
        // Vínculos sem start_date contam como "sempre vigentes" (fallback retroativo).
        const { data: vinculos } = await supabase
          .rpc("companies_for_doctor_at", {
            _doctor_id: debt.doctor_id,
            _on_date: competenceDate,
          });


        const vinculadas = (vinculos ?? []).map((v: any) => v.company_id);
        const matchEmpresa = vinculadas.includes(company_id);

        if (vinculadas.length === 0) {
          // Sem PJ vinculada — alerta
          await supabase.from("glosa_payment_applications").insert({
            payment_id, company_id, glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
            parcela_numero: 0, valor_aplicado: 0,
            status: "pending_manual_resolution", source: "auto",
            resolution_note: "Médico sem PJ vinculada",
            applied_by: user_id,
          });
          summary.glosas.sem_pj++;
          continue;
        }
        if (!matchEmpresa) continue; // glosa não pertence a esta PJ

        // Se médico tem múltiplas PJs vinculadas E todas têm produção no lote → ambíguo
        if (vinculadas.length > 1) {
          const { data: outrasProd } = await supabase
            .from("payment_items").select("company_id")
            .eq("payment_id", payment_id).eq("doctor_id", debt.doctor_id)
            .in("company_id", vinculadas);
          const empresasComProd = Array.from(new Set((outrasProd ?? []).map((i: any) => i.company_id)));
          if (empresasComProd.length > 1) {
            await supabase.from("glosa_payment_applications").insert({
              payment_id, company_id, glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
              parcela_numero: 0, valor_aplicado: 0,
              status: "pending_manual_resolution", source: "auto",
              resolution_note: `Médico tem produção em ${empresasComProd.length} PJs vinculadas no mesmo lote — resolver manualmente`,
              applied_by: user_id,
            });
            summary.glosas.ambiguous++;
            continue;
          }
        }

        // OK: aplica parcela
        const parcelas = debt.parcelas_default ?? 12;
        const { count: aplicadas } = await supabase
          .from("glosa_payment_applications").select("*", { count: "exact", head: true })
          .eq("glosa_debt_id", debt.id).eq("status", "confirmado");
        const parcelaNumero = (aplicadas ?? 0) + 1;
        if (parcelaNumero > parcelas) continue;
        const parcelaValor = Number(debt.total_debt) / parcelas;

        await supabase.from("glosa_payment_applications").insert({
          payment_id, company_id, glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
          parcela_numero: parcelaNumero, valor_aplicado: parcelaValor,
          status: "proposto", source: "auto", applied_by: user_id,
        });
        summary.glosas.proposed++;
        summary.glosas.items.push({ debt_id: debt.id, doctor_name: debt.doctor_name, valor: parcelaValor, parcela: `${parcelaNumero}/${parcelas}` });
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
