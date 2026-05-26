// recalc-payment-pools
// Pass 2 do motor: aplica cálculo de pools em um payment.
// - Identifica payment_company_groups participantes de pools ativos
// - Soma base (gross/expected) por pool
// - Aplica pool_deductions na ordem
// - Distribui residual pelos participantes
// - Atualiza total_amount dos grupos reais
// - Cria/atualiza grupo sintético para participantes "hospital_nao_paga" (total=0, auditoria)
// - Persiste snapshot em pool_calculation_runs (1 por payment+pool)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { payment_id } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth do chamador (para audit)
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    }

    // 1. Carrega payment + grupos atuais
    const { data: payment, error: payErr } = await supabase
      .from("payments").select("id, reference, competence_month").eq("id", payment_id).single();
    if (payErr || !payment) {
      return new Response(JSON.stringify({ error: "payment não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: groups } = await supabase
      .from("payment_company_groups")
      .select("id, company_id, company_name, total_amount")
      .eq("payment_id", payment_id);

    const realGroups = (groups ?? []).filter(g => g.company_id);
    const groupByCompany = new Map<string, typeof realGroups[number]>();
    for (const g of realGroups) if (g.company_id) groupByCompany.set(g.company_id, g);
    const presentCompanyIds = Array.from(groupByCompany.keys());

    if (presentCompanyIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, pools_processed: 0, reason: "sem grupos com company_id" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Pools ativos cujos participantes incluem alguma empresa presente
    const { data: matchedParts } = await supabase
      .from("pool_participants")
      .select("pool_id, company_id, percentual, ordem_exibicao, participant_type")
      .in("company_id", presentCompanyIds);

    const candidatePoolIds = Array.from(new Set((matchedParts ?? []).map(p => p.pool_id)));
    if (candidatePoolIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, pools_processed: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: pools } = await supabase
      .from("pools").select("*")
      .in("id", candidatePoolIds).eq("ativo", true);

    const activePools = (pools ?? []).filter(p => {
      if (p.vigencia_inicio && p.vigencia_inicio > today) return false;
      if (p.vigencia_fim && p.vigencia_fim < today) return false;
      return true;
    });

    const results: any[] = [];

    for (const pool of activePools) {
      // Todos os participantes deste pool (inclui hospital_nao_paga)
      const { data: allParts } = await supabase
        .from("pool_participants").select("*").eq("pool_id", pool.id).order("ordem_exibicao");
      const participants = allParts ?? [];

      const realParticipants = participants.filter(p => p.participant_type !== "hospital_nao_paga" && p.company_id);
      const participantCompanyIds = realParticipants.map(p => p.company_id!).filter(Boolean);

      // Itens elegíveis: payment_items cujo company_id está entre os participantes reais
      const { data: items } = await supabase
        .from("payment_items")
        .select("id, company_id, gross_amount, expected_amount")
        .eq("payment_id", payment_id)
        .in("company_id", participantCompanyIds);

      const elig = items ?? [];
      const baseField = pool.base_calculo === "soma_expected" ? "expected_amount" : "gross_amount";
      const base = elig.reduce((acc, it) => acc + Number((it as any)[baseField] ?? 0), 0);

      // Deduções (mistas: valor fixo + lookup dinâmico em ajustes ativos)
      const { data: dedRows } = await supabase
        .from("pool_deductions").select("*").eq("pool_id", pool.id).order("ordem");
      const deductionsApplied: Array<{
        ordem: number; tipo: string; descricao: string; valor: number;
        adjustment_id?: string; parcela?: number;
      }> = [];
      const adjustmentApplications: Array<{ adjustment_id: string; parcela_numero: number; valor: number }> = [];
      let bolo = base;
      for (const d of (dedRows ?? [])) {
        const dynTypes = new Set(["ajuste_credito", "ajuste_debito", "glosa_parcelada"]);
        if (dynTypes.has(d.tipo) && d.company_id) {
          // Busca ajuste ativo com parcelas pendentes
          const adjTipo = d.tipo === "ajuste_credito" ? "credito"
            : d.tipo === "ajuste_debito" ? "debito"
            : "glosa_parcelada";
          const { data: adjs } = await supabase
            .from("company_financial_adjustments")
            .select("*")
            .eq("company_id", d.company_id)
            .eq("tipo", adjTipo)
            .eq("ativo", true)
            .order("created_at", { ascending: true });
          for (const adj of (adjs ?? [])) {
            const pagas = Number(adj.parcelas_pagas ?? 0);
            const total = Number(adj.parcelas_total ?? 1);
            if (pagas >= total) continue;
            // Já aplicado neste payment? (idempotência)
            const { data: existingApp } = await supabase
              .from("company_adjustment_applications")
              .select("id, valor_aplicado, parcela_numero")
              .eq("adjustment_id", adj.id).eq("payment_id", payment_id)
              .maybeSingle();
            const parcelaValor = round2(Number(adj.valor_total) / total);
            const parcelaNum = existingApp?.parcela_numero ?? (pagas + 1);
            bolo -= parcelaValor;
            deductionsApplied.push({
              ordem: d.ordem, tipo: d.tipo,
              descricao: `${d.descricao} — ${adj.descricao} (parc. ${parcelaNum}/${total})`,
              valor: parcelaValor,
              adjustment_id: adj.id,
              parcela: parcelaNum,
            });
            if (!existingApp) {
              adjustmentApplications.push({
                adjustment_id: adj.id, parcela_numero: parcelaNum, valor: parcelaValor,
              });
            }
          }
        } else {
          const v = Number(d.valor ?? 0);
          bolo -= v;
          deductionsApplied.push({
            ordem: d.ordem, tipo: d.tipo, descricao: d.descricao, valor: round2(v),
          });
        }
      }
      bolo = round2(bolo);

      // Quotas
      const quotas = participants.map(p => {
        const quota = round2(bolo * (Number(p.percentual) / 100));
        const isRetido = p.participant_type === "hospital_nao_paga";
        return {
          participant_id: p.id,
          company_id: p.company_id,
          participant_type: p.participant_type,
          percentual: Number(p.percentual),
          quota,
          paga: !isRetido,
        };
      });

      // Atualiza grupos reais
      for (const q of quotas) {
        if (!q.paga) continue;
        const grp = q.company_id ? groupByCompany.get(q.company_id) : null;
        if (!grp) continue;
        await supabase
          .from("payment_company_groups")
          .update({ total_amount: q.quota })
          .eq("id", grp.id);
      }

      // Grupo sintético para hospital_nao_paga (auditoria, total=0)
      const retidos = quotas.filter(q => !q.paga);
      for (const r of retidos) {
        const labelName = `${pool.nome} — hospital (retido ${r.percentual}%)`;
        // upsert manual: procura por payment_id + company_id null + company_name == labelName
        const { data: existing } = await supabase
          .from("payment_company_groups")
          .select("id")
          .eq("payment_id", payment_id)
          .is("company_id", null)
          .eq("company_name", labelName)
          .maybeSingle();
        if (existing?.id) {
          await supabase.from("payment_company_groups")
            .update({ total_amount: 0, items_count: 0 }).eq("id", existing.id);
        } else {
          await supabase.from("payment_company_groups").insert({
            payment_id, company_id: null, company_name: labelName,
            status: "aprovado", total_amount: 0, items_count: 0,
          } as any);
        }
      }

      // Persiste run (1 por payment+pool — substitui anterior)
      await supabase.from("pool_calculation_runs")
        .delete().eq("payment_id", payment_id).eq("pool_id", pool.id);
      await supabase.from("pool_calculation_runs").insert({
        payment_id, pool_id: pool.id,
        base_amount: round2(base),
        bolo_liquido: bolo,
        deductions_applied: deductionsApplied,
        quotas,
        snapshot: {
          pool_nome: pool.nome,
          base_calculo: pool.base_calculo,
          items_count: elig.length,
          executed_at: new Date().toISOString(),
        },
        created_by: userId,
      } as any);

      results.push({
        pool_id: pool.id, pool_nome: pool.nome,
        base: round2(base), bolo, quotas_count: quotas.length,
      });
    }

    return new Response(JSON.stringify({ ok: true, pools_processed: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[recalc-payment-pools] erro", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
