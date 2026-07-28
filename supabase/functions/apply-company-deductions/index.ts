// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

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

    // === TRAVA DE CONCORRÊNCIA ===
    // Serializa execuções simultâneas para o mesmo (payment_id, company_id).
    // Sem isso, cliques repetidos ou reprocessamentos paralelos aplicavam a
    // mesma glosa múltiplas vezes (sobre-aplicação → duplicidade).
    const { data: lockOk, error: lockErr } = await supabase.rpc("try_acquire_deduction_lock", {
      _payment_id: payment_id,
      _company_id: company_id,
    });
    if (lockErr) {
      console.error("[apply-company-deductions] lock rpc failed", lockErr);
      return new Response(JSON.stringify({ error: "lock_rpc_failed", detail: lockErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!lockOk) {
      return new Response(JSON.stringify({
        ok: false,
        error: "locked",
        message: "Outra execução de aplicar deduções já está em andamento para esta PJ neste lote. Aguarde alguns segundos e tente novamente.",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
    //
    // ⚠️ MANTER SINCRONIZADO com a lista FINAL_STATUSES replicada na migration
    // do claim_ai_retry_batch (ai_retry_queue lifecycle hardening). Alterar aqui
    // exige alterar lá também — as duas listas precisam concordar.
    const FINAL_STATUSES = new Set([
      "aprovado", "aprovado_com_ressalva", "aprovado_parcial",
      "pedido_nf_enviado", "nf_recebida", "nf_conciliada", "nf_questionada", "nf_divergente",
      "lancado", "pago", "arquivado", "cancelado", "rejeitado",
    ]);
    const { data: paymentStatusRow } = await supabase
      .from("payments")
      .select("status, payment_model_id, hospital_id, competence_month")
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

    // hospital_id é NOT NULL em company_adjustment_applications e glosa_payment_applications
    // (isolamento multi-tenant). Sem ele, todos os inserts abaixo falhariam silenciosamente.
    const paymentHospitalId: string | null = (paymentStatusRow?.hospital_id as string) ?? null;
    if (!paymentHospitalId) {
      return new Response(JSON.stringify({
        ok: false,
        error: "payment_hospital_missing",
        message: "Lote sem hospital_id — impossível gravar deduções (viola isolamento multi-tenant).",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!auth.is_internal && !assertCallerHospital(auth, paymentHospitalId)) {
      return new Response(JSON.stringify({
        error: "hospital_scope_denied",
        message: "Seu hospital ativo não corresponde ao hospital deste registro.",
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Garante que a linha de snapshot financeiro (PCF) exista para esta PJ neste lote.
    // Sem ela, o trigger de recompute rodava um UPDATE que não atingia nenhuma linha e
    // o Panorama do lote mostrava "Apurado glosas = R$ 0,00" mesmo com aplicações válidas.
    await supabase.rpc("ensure_payment_company_financials_row", {
      p_payment_id: payment_id,
      p_company_id: company_id,
    });


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
          payment_id, company_id, hospital_id: paymentHospitalId, adjustment_id: adj.id,
          valor_aplicado: parcelaValor, parcela_numero: parcelaNumero,
          applied_by: user_id, status: "proposto", source: "auto",
        });
      if (insErr) {
        console.error(`[apply-company-deductions] insert adj ${adj.id} falhou`, insErr);
        throw insErr;
      }
      summary.debitos.proposed++;
      summary.debitos.items.push({ adjustment_id: adj.id, descricao: adj.descricao, tipo: adj.tipo, valor: parcelaValor, parcela: parcelaLabel });
     } catch (err) {
      console.error(`[apply-company-deductions] adj ${adj?.id} falhou`, err);
      throw err;
     }
    });
    if (adjResult.errors.length) summary.debitos.errors = adjResult.errors.length;


    // ============ GLOSAS ============
    // hospital_id foi obtido no topo (paymentHospitalId). É crítico porque a edge function
    // usa service_role e bypassa RLS — precisamos filtrar hospital explicitamente para não
    // vazar dívidas de outras unidades quando a médica atende em múltiplos hospitais.
    const competenceDate: string = (paymentStatusRow?.competence_month as string)
      || new Date().toISOString().slice(0, 10);

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
        .select("id, glosa_debt_id, status, valor_aplicado")
        .eq("payment_id", payment_id)
        .eq("company_id", company_id)
        .in("status", ["proposto", "confirmado", "pending_manual_resolution", "partial"]);

      // Agregado por débito: quanto já foi aplicado neste lote (proposto+confirmado+partial)
      // e a maior parcela_numero registrada. Usamos para detectar débitos que tiveram o
      // total_debt aumentado depois da primeira aplicação (append via RPC), calcular o
      // delta ainda devido e completar a diferença em vez de ignorar o débito.
      const existingByDebt = new Map<string, { applied: number; maxParcela: number }>();
      for (const r of existingGpa ?? []) {
        if (!["proposto", "confirmado", "partial"].includes(r.status)) continue;
        const cur = existingByDebt.get(r.glosa_debt_id) ?? { applied: 0, maxParcela: 0 };
        cur.applied = round2(cur.applied + Number(r.valor_aplicado || 0));
        cur.maxParcela = Math.max(cur.maxParcela, Number(r.parcela_numero || 0));
        existingByDebt.set(r.glosa_debt_id, cur);
      }

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
         const prevAppliedHere = existingByDebt.get(debt.id);
         const alreadyAppliedHere = prevAppliedHere?.applied ?? 0;

         // NOTA: NÃO bloqueamos por "médico sem produção no lote". A glosa é dívida
         // da PJ (para fins de pagamento, PJ e médico são inseparáveis) e desconta
         // do líquido da PJ neste lote — independente de o médico específico ter
         // ou não itens de produção aqui. Só a capacidade da PJ importa abaixo.

        const debtCompanyId = debt.company_id ? String(debt.company_id) : null;
        const debtIsLinked = debtCompanyId && debt.resolution_status === "vinculada";

        // Quando a glosa já foi confirmada/vinculada, a PJ gravada em glosa_debts é
        // a fonte canônica. Não revalide contra doctor_companies pela competência do
        // lote: o vínculo pode ter sido criado depois para resolver uma glosa antiga.
        if (debtIsLinked) {
          if (debtCompanyId !== company_id) continue;

          const stalePendingRows = (existingGpa ?? []).filter((r: any) =>
            r.glosa_debt_id === debt.id && r.status === "pending_manual_resolution"
          );
          for (const stale of stalePendingRows) {
            const { error: deletePendingErr } = await supabase
              .from("glosa_payment_applications")
              .delete()
              .eq("id", stale.id);
            if (deletePendingErr) {
              console.error(`[glosa cleanup pending] ${debt.id}`, deletePendingErr);
              throw deletePendingErr;
            }
          }
        } else {
          const { data: vinculos } = await supabase
            .rpc("companies_for_doctor_at", {
              _doctor_id: debt.doctor_id,
              _on_date: competenceDate,
            });

          const vinculadas = (vinculos ?? []).map((v: any) => v.company_id);
          const matchEmpresa = vinculadas.includes(company_id);

          if (vinculadas.length === 0) {
          const { error: e1 } = await supabase.from("glosa_payment_applications").insert({
            payment_id, company_id, hospital_id: paymentHospitalId,
            glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
            parcela_numero: 0, valor_aplicado: 0,
            status: "pending_manual_resolution", source: "auto",
            resolution_note: "Médico sem PJ vinculada",
            applied_by: user_id,
          });
          if (e1) { console.error(`[glosa sem_pj] ${debt.id}`, e1); throw e1; }
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
            const { error: e2 } = await supabase.from("glosa_payment_applications").insert({
              payment_id, company_id, hospital_id: paymentHospitalId,
              glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
              parcela_numero: 0, valor_aplicado: 0,
              status: "pending_manual_resolution", source: "auto",
              resolution_note: `Médico tem produção em ${empresasComProd.length} PJs vinculadas no mesmo lote — resolver manualmente`,
              applied_by: user_id,
            });
            if (e2) { console.error(`[glosa ambiguous] ${debt.id}`, e2); throw e2; }
            summary.glosas.ambiguous++;
            continue;
          }
          }
        }

        const parcelas = debt.parcelas_default ?? 12;
        const parcelaFull = round2(Number(debt.total_debt) / parcelas);

        // Total já aplicado em QUALQUER lote (confirmado/proposto/partial) para
        // este débito. Sem esse cap, um débito cujo total_debt cresceu via
        // upsert (create_glosa_debt_with_items append) depois de já ter sido
        // aplicado num lote finalizado tentaria aplicar "parcelaFull" no novo
        // lote e cobraria a PJ em duplicidade. O cap real é o saldo devedor.
        const { data: allDebtApps } = await supabase
          .from("glosa_payment_applications")
          .select("valor_aplicado, status")
          .eq("glosa_debt_id", debt.id)
          .in("status", ["proposto", "confirmado", "partial"]);
        const totalAppliedAllLotes = round2(
          (allDebtApps ?? []).reduce((s: number, r: any) => s + Number(r.valor_aplicado || 0), 0)
        );
        const saldoDevedor = round2(Number(debt.total_debt) - totalAppliedAllLotes);
        if (saldoDevedor <= 0.01) {
          summary.glosas.skipped_existing++;
          continue;
        }

        // Se já existe aplicação neste lote para o débito, este ciclo pode ser
        // um COMPLEMENTO (o total_debt cresceu depois — ex.: append via RPC)
        // em vez de uma nova parcela. Reutilizamos a mesma numeração para não
        // estourar parcelas_default e aplicamos só o delta ainda devido.
        let parcelaNumero: number;
        let parcelaPrevista: number;
        if (alreadyAppliedHere > 0.01) {
          const pendingHere = round2(Math.min(parcelaFull - alreadyAppliedHere, saldoDevedor));
          if (pendingHere <= 0.01) { summary.glosas.skipped_existing++; continue; }
          parcelaNumero = prevAppliedHere?.maxParcela ?? 1;
          parcelaPrevista = pendingHere;
        } else {
          const { count: aplicadas } = await supabase
            .from("glosa_payment_applications").select("*", { count: "exact", head: true })
            .eq("glosa_debt_id", debt.id).eq("status", "confirmado");
          parcelaNumero = (aplicadas ?? 0) + 1;
          if (parcelaNumero > parcelas) continue;
          // Cap por saldo devedor: nunca cobrar mais do que a PJ ainda deve,
          // mesmo que a "parcela cheia" (total/parcelas) seja maior — cenário
          // típico quando aplicações anteriores em outros lotes já cobriram
          // parte do débito e o resíduo é menor que uma parcela inteira.
          parcelaPrevista = round2(Math.min(parcelaFull, saldoDevedor));
        }

        // === REGRA DE CAPACIDADE ===
        if (capacidadeRestante <= 0.01) {
          const { error: e3 } = await supabase.from("glosa_payment_applications").insert({
            payment_id, company_id, hospital_id: paymentHospitalId,
            glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
            parcela_numero: parcelaNumero, valor_aplicado: 0,
            status: "postponed", source: "auto",
            postpone_reason: "insufficient_net",
            resolution_note: `Lote sem líquido disponível para a PJ (capacidade R$ ${capacidadeRestante.toFixed(2)}). Débito rola para o próximo ciclo.`,
            applied_by: user_id,
          });
          if (e3) { console.error(`[glosa postponed] ${debt.id}`, e3); throw e3; }
          summary.glosas.postponed = (summary.glosas.postponed ?? 0) + 1;
          summary.glosas.items.push({ debt_id: debt.id, doctor_name: debt.doctor_name, valor: 0, parcela: `${parcelaNumero}/${parcelas}`, action: "postponed" });
          continue;
        }

        if (parcelaPrevista > capacidadeRestante) {
          // Regra de negócio (07/2026): NUNCA aplicar parcial.
          // Se a PJ não tem líquido suficiente para cobrir a parcela inteira,
          // o débito rola integralmente para o próximo ciclo. Parcial gerava
          // resíduos de conciliação difíceis de auditar e confundia analistas.
          const { error: e4 } = await supabase.from("glosa_payment_applications").insert({
            payment_id, company_id, hospital_id: paymentHospitalId,
            glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
            parcela_numero: parcelaNumero, valor_aplicado: 0,
            status: "postponed", source: "auto",
            postpone_reason: "insufficient_net",
            resolution_note: `Líquido insuficiente: parcela prevista R$ ${parcelaPrevista.toFixed(2)}, capacidade R$ ${capacidadeRestante.toFixed(2)}. Débito rola integralmente para o próximo ciclo (sem aplicação parcial).`,
            applied_by: user_id,
          });
          if (e4) { console.error(`[glosa postponed-insufficient] ${debt.id}`, e4); throw e4; }
          summary.glosas.postponed = (summary.glosas.postponed ?? 0) + 1;
          summary.glosas.items.push({ debt_id: debt.id, doctor_name: debt.doctor_name, valor: 0, parcela: `${parcelaNumero}/${parcelas}`, action: "postponed" });
          continue;
        }

        // Débito já está confirmado na origem (glosa_debts.confirmed_at IS NOT NULL,
        // filtrado na query). Gravamos direto como 'confirmado' — antes ficava
        // 'proposto' e nunca era promovido, criando descompasso entre C&D e Panorama.
        const { error: e5 } = await supabase.from("glosa_payment_applications").insert({
          payment_id, company_id, hospital_id: paymentHospitalId,
          glosa_debt_id: debt.id, doctor_id: debt.doctor_id,
          parcela_numero: parcelaNumero, valor_aplicado: parcelaPrevista,
          status: "confirmado", source: "auto", applied_by: user_id,
          confirmed_at: new Date().toISOString(), confirmed_by: user_id,
        });
        if (e5) { console.error(`[glosa confirmado] ${debt.id}`, e5); throw e5; }

        capacidadeRestante = round2(capacidadeRestante - parcelaPrevista);
        summary.glosas.proposed++;
        summary.glosas.items.push({ debt_id: debt.id, doctor_name: debt.doctor_name, valor: parcelaPrevista, parcela: `${parcelaNumero}/${parcelas}` });
       } catch (err: any) {
        console.error(`[apply-company-deductions] glosa ${debt?.id} falhou`, err);
        summary.glosas.errors = (summary.glosas.errors ?? 0) + 1;
        summary.glosas.error_details = summary.glosas.error_details ?? [];
        summary.glosas.error_details.push({ debt_id: debt?.id, message: err?.message ?? String(err) });
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
