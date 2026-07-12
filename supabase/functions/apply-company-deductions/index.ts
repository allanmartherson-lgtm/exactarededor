// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Executa `worker` em lotes de `concurrency` para evitar wall-time linear em
// empresas grandes (muitos ajustes/glosas). Erros em uma iteração não abortam
// as demais — são acumulados em `errors` para inspeção posterior.
async function runInBatches<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<{ errors: unknown[] }> {
  const errors: unknown[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(worker));
    for (const r of results) if (r.status === "rejected") errors.push(r.reason);
  }
  return { errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

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

    // Gate: lote já finalizado/pago não recebe novas propostas automáticas.
    // Ajustes/glosas em lotes desses status devem rolar para o próximo ciclo.
    const FINAL_STATUSES = new Set([
      "aprovado", "aprovado_com_ressalva", "aprovado_parcial",
      "pedido_nf_enviado", "nf_recebida", "nf_conciliada", "nf_questionada", "nf_divergente",
      "lancado", "pago", "arquivado", "cancelado", "rejeitado",
    ]);
    const { data: paymentStatusRow } = await supabase
      .from("payments")
      .select("status, payment_model_id")
      .eq("id", payment_id)
      .maybeSingle();
    const paymentCurrentStatus: string | null = (paymentStatusRow?.status as string) ?? null;
    if (paymentCurrentStatus && FINAL_STATUSES.has(paymentCurrentStatus)) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: `payment_status=${paymentCurrentStatus} — lote finalizado, deduções não são propostas automaticamente`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============ DÉBITOS (company_financial_adjustments) ============
    // Carrega payment_model_id deste lote para filtrar ajustes restritos a modelos específicos.
    const lotePaymentModelId: string | null = (paymentStatusRow?.payment_model_id as string) ?? null;


    const { data: adjustmentsRaw } = await supabase
      .from("company_financial_adjustments")
      .select("*")
      .eq("company_id", company_id)
      .eq("ativo", true);

    // Filtro canônico: payment_model_ids (D3.e.4 — coluna única após drop de payment_type_ids).
    // NULL/vazio = qualquer lote; senão exige match com o modelo do lote.
    const adjustments = (adjustmentsRaw ?? []).filter((a: any) => {
      const ids: string[] | null = a.payment_model_ids ?? null;
      if (!ids || ids.length === 0) return true;
      return lotePaymentModelId ? ids.includes(lotePaymentModelId) : false;
    });

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

    // Competência do lote (usada para encerrar ajustes recorrentes com data_fim)
    const { data: paymentRowForDate } = await supabase
      .from("payments")
      .select("competence_month")
      .eq("id", payment_id)
      .maybeSingle();
    const loteCompetence: string | null = (paymentRowForDate?.competence_month as string) ?? null;

    const adjResult = await runInBatches(adjustments ?? [], 5, async (adj: any) => {
     try {
      const isRecorrente = !!adj.recorrente;
      const existingRows = existingByAdj.get(adj.id) ?? [];

      // Encerramento: recorrente com data_fim já ultrapassada OU parcelado já com tudo pago
      const expiredRecorrente = isRecorrente && adj.data_fim && loteCompetence && loteCompetence > adj.data_fim;
      const restantes = isRecorrente ? 1 : (adj.parcelas_total ?? 1) - (adj.parcelas_pagas ?? 0);
      if (expiredRecorrente || restantes <= 0) {
        for (const row of existingRows.filter((r: any) => r.status === "proposto" && r.source === "auto")) {
          await supabase.from("company_adjustment_applications")
            .update({ status: "revertido", reverted_at: new Date().toISOString(), reverted_by: user_id, reverted_reason: expiredRecorrente ? "Ajuste recorrente encerrado (data_fim ultrapassada)" : "Ajuste sem parcelas pendentes antes da reaplicação" })
            .eq("id", row.id);
          summary.debitos.reverted_stale++;
        }
        return;
      }

      const parcelaValor = isRecorrente
        ? round2(Number(adj.valor_total))
        : round2(Number(adj.valor_total) / Number(adj.parcelas_total));
      const parcelaNumero = (adj.parcelas_pagas ?? 0) + 1;
      const parcelaLabel = isRecorrente ? "mensal" : `${parcelaNumero}/${adj.parcelas_total}`;

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
            summary.debitos.items.push({ adjustment_id: adj.id, descricao: adj.descricao, tipo: adj.tipo, valor: parcelaValor, parcela: parcelaLabel, action: "updated" });
          }
        } else {
          summary.debitos.skipped_existing++;
        }
        return;
      }

      const activeExisting = existingRows.find((r: any) => ["proposto", "confirmado"].includes(r.status));
      if (activeExisting) { summary.debitos.skipped_existing++; return; }

      const reusableReverted = existingRows.find((r: any) => r.status === "revertido" && Number(r.parcela_numero ?? 0) === parcelaNumero);
      if (reusableReverted) {
        const { error: reviveErr } = await supabase
          .from("company_adjustment_applications")
          .update({ valor_aplicado: parcelaValor, parcela_numero: parcelaNumero, applied_by: user_id, status: "proposto", source: "auto", reverted_at: null, reverted_by: null, reverted_reason: null })
          .eq("id", reusableReverted.id);
        if (!reviveErr) {
          summary.debitos.proposed++;
          summary.debitos.items.push({ adjustment_id: adj.id, descricao: adj.descricao, tipo: adj.tipo, valor: parcelaValor, parcela: parcelaLabel, action: "revived" });
        }
        return;
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
        summary.debitos.items.push({ adjustment_id: adj.id, descricao: adj.descricao, tipo: adj.tipo, valor: parcelaValor, parcela: parcelaLabel });
      }
     } catch (err) {
      console.error(`[apply-company-deductions] adj ${adj?.id} falhou`, err);
      throw err;
     }
    });
    if (adjResult.errors.length) summary.debitos.errors = adjResult.errors.length;


    // ============ GLOSAS ============
    // Competência + hospital do lote (hospital_id é crítico: edge function usa service_role
    // e bypassa RLS, então precisamos filtrar hospital explicitamente para não vazar dívidas
    // de outras unidades quando a médica atende em múltiplos hospitais).
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("competence_month, hospital_id")
      .eq("id", payment_id)
      .maybeSingle();
    const competenceDate: string = (paymentRow?.competence_month as string)
      || new Date().toISOString().slice(0, 10);
    const paymentHospitalId: string | null = (paymentRow?.hospital_id as string) ?? null;

    // Doctors with production in this lote/company
    const { data: items } = await supabase
      .from("payment_items")
      .select("doctor_id, gross_amount")
      .eq("payment_id", payment_id)
      .eq("company_id", company_id)
      .not("doctor_id", "is", null);

    const doctorIdsComProducao = new Set(
      (items ?? []).map((i: any) => i.doctor_id).filter(Boolean),
    );

    // Buscamos TODAS as dívidas ativas apontadas para este lote (ou residuais),
    // independentemente de o médico ter produção aqui. Se não tiver produção,
    // registramos "postponed" (sem_producao) para dar rastro na UI — assim o
    // botão "Aplicar" não fica preso em pendente indefinidamente.
    {
      let debtsQ = supabase
        .from("glosa_debts")
        .select("*")
        .eq("status", "ativo")
        .not("confirmed_at", "is", null)
        .or(`target_payment_id.eq.${payment_id},origem.eq.conciliacao_residual`)
        .or("resolution_status.is.null,resolution_status.neq.ignorado");
      if (paymentHospitalId) debtsQ = debtsQ.eq("hospital_id", paymentHospitalId);
      const { data: debts } = await debtsQ;



      const { data: existingGpa } = await supabase
        .from("glosa_payment_applications")
        .select("glosa_debt_id, status, valor_aplicado")
        .eq("payment_id", payment_id)
        .eq("company_id", company_id)
        .in("status", ["proposto", "confirmado", "pending_manual_resolution", "partial"]);

      const existingDebtIds = new Set((existingGpa ?? []).map((r: any) => r.glosa_debt_id));

      // Capacidade da PJ neste lote: líquido previsto (snapshot em payment_company_financials)
      // menos o que já foi consumido por outras deduções deste ciclo.
      const { data: pcf } = await supabase
        .from("payment_company_financials")
        .select("liquido, glosas")
        .eq("payment_id", payment_id)
        .eq("company_id", company_id)
        .maybeSingle();
      const snapshotLiquido = Number(pcf?.liquido ?? 0);
      const snapshotGlosas = Number(pcf?.glosas ?? 0);
      // liquido já vem descontado de glosas snapshotadas; capacidade "livre" para
      // novas glosas = liquido + glosas_snapshotadas − glosas_deste_ciclo.
      let capacidadeRestante = round2(snapshotLiquido + snapshotGlosas
        - (existingGpa ?? [])
            .filter((r: any) => ["proposto", "confirmado", "partial"].includes(r.status))
            .reduce((s: number, r: any) => s + Number(r.valor_aplicado || 0), 0));
      summary.glosas.capacidade_inicial = capacidadeRestante;

      // Sequencial (não paralelo) para respeitar capacidade decrementalmente.
      // Ordena FIFO por created_at do débito para que os mais antigos entrem primeiro.
      const debtsOrdenadas = [...(debts ?? [])].sort((a: any, b: any) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));

      for (const debt of debtsOrdenadas) {
       try {
         if (existingDebtIds.has(debt.id)) { summary.glosas.skipped_existing++; continue; }

         // Médico sem produção neste lote → registra postponed(sem_producao)
         // para o UI mostrar "Adiada" em vez de manter "pendente" indefinidamente.
         if (debt.doctor_id && !doctorIdsComProducao.has(debt.doctor_id)) {
           await supabase.from("glosa_payment_applications").insert({
             payment_id, company_id, glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
             parcela_numero: 0, valor_aplicado: 0,
             status: "postponed", source: "auto",
             postpone_reason: "sem_producao",
             resolution_note: "Médico sem produção neste lote — débito aguarda próximo ciclo com produção.",
             applied_by: user_id,
           });
           summary.glosas.postponed = (summary.glosas.postponed ?? 0) + 1;
           summary.glosas.items.push({ debt_id: debt.id, doctor_name: debt.doctor_name, valor: 0, parcela: "0/0", action: "postponed_sem_producao" });
           continue;
         }

        const { data: vinculos } = await supabase
          .rpc("companies_for_doctor_at", {
            _doctor_id: debt.doctor_id,
            _on_date: competenceDate,
          });

        const vinculadas = (vinculos ?? []).map((v: any) => v.company_id);
        const matchEmpresa = vinculadas.includes(company_id);

        if (vinculadas.length === 0) {
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
        if (!matchEmpresa) continue;

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

        const parcelas = debt.parcelas_default ?? 12;
        const { count: aplicadas } = await supabase
          .from("glosa_payment_applications").select("*", { count: "exact", head: true })
          .eq("glosa_debt_id", debt.id).eq("status", "confirmado");
        const parcelaNumero = (aplicadas ?? 0) + 1;
        if (parcelaNumero > parcelas) continue;
        const parcelaPrevista = round2(Number(debt.total_debt) / parcelas);

        // === REGRA DE CAPACIDADE ===
        if (capacidadeRestante <= 0.01) {
          await supabase.from("glosa_payment_applications").insert({
            payment_id, company_id, glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
            parcela_numero: parcelaNumero, valor_aplicado: 0,
            status: "postponed", source: "auto",
            postpone_reason: "insufficient_net",
            resolution_note: `Lote sem líquido disponível para a PJ (capacidade R$ ${capacidadeRestante.toFixed(2)}). Débito rola para o próximo ciclo.`,
            applied_by: user_id,
          });
          summary.glosas.postponed = (summary.glosas.postponed ?? 0) + 1;
          summary.glosas.items.push({ debt_id: debt.id, doctor_name: debt.doctor_name, valor: 0, parcela: `${parcelaNumero}/${parcelas}`, action: "postponed" });
          continue;
        }

        if (parcelaPrevista > capacidadeRestante) {
          const parcial = round2(capacidadeRestante);
          await supabase.from("glosa_payment_applications").insert({
            payment_id, company_id, glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
            parcela_numero: parcelaNumero, valor_aplicado: parcial,
            status: "partial", source: "auto",
            postpone_reason: "partial_capacity",
            resolution_note: `Aplicado parcialmente: R$ ${parcial.toFixed(2)} de R$ ${parcelaPrevista.toFixed(2)} previstos. Saldo continua no débito.`,
            applied_by: user_id,
          });
          capacidadeRestante = 0;
          summary.glosas.partial = (summary.glosas.partial ?? 0) + 1;
          summary.glosas.items.push({ debt_id: debt.id, doctor_name: debt.doctor_name, valor: parcial, parcela: `${parcelaNumero}/${parcelas}`, action: "partial" });
          continue;
        }

        await supabase.from("glosa_payment_applications").insert({
          payment_id, company_id, glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
          parcela_numero: parcelaNumero, valor_aplicado: parcelaPrevista,
          status: "proposto", source: "auto", applied_by: user_id,
        });
        capacidadeRestante = round2(capacidadeRestante - parcelaPrevista);
        summary.glosas.proposed++;
        summary.glosas.items.push({ debt_id: debt.id, doctor_name: debt.doctor_name, valor: parcelaPrevista, parcela: `${parcelaNumero}/${parcelas}` });
       } catch (err) {
        console.error(`[apply-company-deductions] glosa ${debt?.id} falhou`, err);
       }
      }
      summary.glosas.capacidade_restante = capacidadeRestante;
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
