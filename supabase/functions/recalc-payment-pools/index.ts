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
      .from("payments").select("id, reference, competence_month, hospital_id").eq("id", payment_id).single();
    if (payErr || !payment) {
      return new Response(JSON.stringify({ error: "payment não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normaliza competence_month para o dia 01 (date) para casar com pool_deduction_values
    const competenceDate: string | null = payment.competence_month
      ? String(payment.competence_month).slice(0, 7) + "-01"
      : null;

    const { data: groups } = await supabase
      .from("payment_company_groups")
      .select("id, company_id, company_name, total_amount")
      .eq("payment_id", payment_id);

    const realGroups = (groups ?? []).filter(g => g.company_id);
    const groupByCompany = new Map<string, typeof realGroups[number]>();
    for (const g of realGroups) if (g.company_id) groupByCompany.set(g.company_id, g);
    const presentCompanyIds = Array.from(groupByCompany.keys());

    // 2. Pools ativos: (a) cujos participantes incluem alguma empresa presente
    //                   OU (b) escopo_producao='filtrado' do mesmo hospital
    const { data: matchedParts } = presentCompanyIds.length
      ? await supabase
          .from("pool_participants")
          .select("pool_id")
          .in("company_id", presentCompanyIds)
      : { data: [] as Array<{ pool_id: string }> };

    const candidatePoolIds = new Set<string>((matchedParts ?? []).map(p => p.pool_id));

    // Filtered pools do hospital
    if (payment.hospital_id) {
      const { data: filteredPools } = await supabase
        .from("pools")
        .select("id")
        .eq("hospital_id", payment.hospital_id)
        .eq("escopo_producao", "filtrado")
        .eq("ativo", true);
      for (const p of filteredPools ?? []) candidatePoolIds.add(p.id);
    }

    if (candidatePoolIds.size === 0) {
      return new Response(JSON.stringify({ ok: true, pools_processed: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: pools } = await supabase
      .from("pools").select("*")
      .in("id", Array.from(candidatePoolIds)).eq("ativo", true);

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

      // Itens elegíveis: por escopo do pool
      let elig: any[] = [];
      const isFiltered = pool.escopo_producao === "filtrado";

      if (isFiltered) {
        const filtrosRaw = (pool.filtros_captura ?? {}) as Record<string, any>;
        // Normalização defensiva: trim + dedupe; slugs em lowercase; funções preservam case (case-insensitive abaixo).
        const norm = (arr: any, opts: { lower?: boolean } = {}) => {
          if (!Array.isArray(arr)) return [] as string[];
          const out = arr
            .flatMap((v: any) => String(v ?? "").split(","))
            .map((s: string) => s.trim())
            .filter(Boolean)
            .map((s: string) => (opts.lower ? s.toLowerCase() : s));
          return Array.from(new Set(out));
        };
        const filtros = {
          tipo_ato_ids: norm(filtrosRaw.tipo_ato_ids),
          setor_slugs: norm(filtrosRaw.setor_slugs, { lower: true }),
          convenio_slugs: norm(filtrosRaw.convenio_slugs, { lower: true }),
          funcoes: norm(filtrosRaw.funcoes),
          doctor_include_ids: norm(filtrosRaw.doctor_include_ids),
          doctor_exclude_ids: norm(filtrosRaw.doctor_exclude_ids),
        };
        let q = supabase
          .from("payment_items")
          .select("id, company_id, doctor_id, doctor_name, doctor_role, payment_type_id, sector_slug, convenio_slug, gross_amount, expected_amount, procedure_date, procedure_name, description, patient_name, agreement_text, attendance_number")
          .eq("payment_id", payment_id)
          .neq("item_origin", "complemento_minimo");
        if (filtros.tipo_ato_ids.length) q = q.in("payment_type_id", filtros.tipo_ato_ids);
        if (filtros.setor_slugs.length)   q = q.in("sector_slug", filtros.setor_slugs);
        if (filtros.convenio_slugs.length) q = q.in("convenio_slug", filtros.convenio_slugs);
        if (filtros.funcoes.length) {
          // case-insensitive: doctor_role do payment_items pode vir com case variável da planilha
          const orExpr = filtros.funcoes.map(f => `doctor_role.ilike.${f.replace(/[,()]/g, "")}`).join(",");
          q = q.or(orExpr);
        }
        if (filtros.doctor_include_ids.length) q = q.in("doctor_id", filtros.doctor_include_ids);
        if (filtros.doctor_exclude_ids.length) q = q.not("doctor_id", "in", `(${filtros.doctor_exclude_ids.join(",")})`);
        const { data: fitems } = await q;
        elig = fitems ?? [];
      } else {
        if (participantCompanyIds.length === 0) { continue; }
        const { data: items } = await supabase
          .from("payment_items")
          .select("id, company_id, gross_amount, expected_amount, procedure_date, procedure_name, description, patient_name, agreement_text, attendance_number")
          .eq("payment_id", payment_id)
          .neq("item_origin", "complemento_minimo")
          .in("company_id", participantCompanyIds);
        elig = items ?? [];
      }

      // Bloqueio de duplicidade: o mesmo item não pode estar em 2 pools na mesma competência
      // (Em escopo filtrado isso é crítico — uma visita só pode ser absorvida por um pool.)
      if (isFiltered && competenceDate && elig.length) {
        const itemIds = elig.map(it => it.id);
        const { data: conflicts } = await supabase
          .from("pool_item_claims")
          .select("payment_item_id, pool_id")
          .in("payment_item_id", itemIds)
          .eq("competence_month", competenceDate)
          .neq("pool_id", pool.id);
        if ((conflicts ?? []).length) {
          // Marca run com erro e segue para o próximo pool
          await supabase.from("pool_calculation_runs").insert({
            payment_id, pool_id: pool.id,
            base_amount: 0, bolo_liquido: 0,
            deductions_applied: [],
            quotas: [],
            competence_month: competenceDate,
            captured_item_ids: itemIds,
            invalidated_at: new Date().toISOString(),
            invalidated_reason: "item_duplicado_em_outro_pool",
            error_detail: { conflicts },
            hospital_id: payment.hospital_id ?? null,
            snapshot: { pool_nome: pool.nome, executed_at: new Date().toISOString() },
            created_by: userId,
          } as any);
          results.push({ pool_id: pool.id, pool_nome: pool.nome, error: "item_duplicado_em_outro_pool", conflicts });
          continue;
        }
      }

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
      const variableValuesUsed: Array<{ deduction_id: string; descricao: string; valor: number; observacao: string | null; competence_month: string }> = [];
      let bolo = base;
      let blockedReason: string | null = null;
      const blockedDetail: any[] = [];

      for (const d of (dedRows ?? [])) {
        // Caso 1: dedução com valor variável por competência
        if (d.valor_variavel) {
          if (!competenceDate) {
            blockedReason = "competencia_nao_definida_para_valor_variavel";
            blockedDetail.push({ deduction_id: d.id, descricao: d.descricao });
            continue;
          }
          const { data: pdv } = await supabase
            .from("pool_deduction_values")
            .select("valor, observacao, competence_month")
            .eq("pool_deduction_id", d.id)
            .eq("competence_month", competenceDate)
            .maybeSingle();
          if (!pdv) {
            blockedReason = "valor_variavel_competencia_nao_cadastrado";
            blockedDetail.push({ deduction_id: d.id, descricao: d.descricao, competence_month: competenceDate });
            continue;
          }
          const v = Number(pdv.valor ?? 0);
          bolo -= v;
          deductionsApplied.push({
            ordem: d.ordem, tipo: d.tipo,
            descricao: `${d.descricao}${pdv.observacao ? ` — ${pdv.observacao}` : ""}`,
            valor: round2(v),
          });
          variableValuesUsed.push({
            deduction_id: d.id, descricao: d.descricao, valor: round2(v),
            observacao: pdv.observacao ?? null, competence_month: competenceDate,
          });
          continue;
        }

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

      // Se houve bloqueio (valor variável faltando), grava run inválido e segue
      if (blockedReason) {
        await supabase.from("pool_calculation_runs").insert({
          payment_id, pool_id: pool.id,
          base_amount: round2(base), bolo_liquido: 0,
          deductions_applied: deductionsApplied,
          quotas: [],
          competence_month: competenceDate,
          captured_item_ids: isFiltered ? elig.map(it => it.id) : null,
          invalidated_at: new Date().toISOString(),
          invalidated_reason: blockedReason,
          error_detail: { items: blockedDetail },
          hospital_id: payment.hospital_id ?? null,
          snapshot: { pool_nome: pool.nome, executed_at: new Date().toISOString() },
          created_by: userId,
        } as any);
        results.push({ pool_id: pool.id, pool_nome: pool.nome, error: blockedReason, detail: blockedDetail });
        continue;
      }

      // Quotas (cálculo natural)
      const quotas: Array<{
        participant_id: string;
        company_id: string | null;
        participant_type: string;
        percentual: number;
        quota: number;
        quota_natural: number;
        piso_aplicado?: number;
        complemento_piso?: number;
        paga: boolean;
      }> = participants.map(p => {
        const quotaNat = round2(bolo * (Number(p.percentual) / 100));
        const isRetido = p.participant_type === "hospital_nao_paga";
        return {
          participant_id: p.id,
          company_id: p.company_id,
          participant_type: p.participant_type,
          percentual: Number(p.percentual),
          quota: quotaNat,
          quota_natural: quotaNat,
          paga: !isRetido,
        };
      });

      // Aplica piso por participante (mínimo garantido dentro do pool)
      let complementoPisoTotal = 0;
      const piso = Number(pool.piso_valor ?? 0);
      if (pool.garante_piso && piso > 0) {
        for (const q of quotas) {
          if (!q.paga) continue;
          if (q.quota < piso) {
            const comp = round2(piso - q.quota);
            q.piso_aplicado = piso;
            q.complemento_piso = comp;
            q.quota = piso;
            complementoPisoTotal = round2(complementoPisoTotal + comp);
          }
        }
        if (complementoPisoTotal > 0) {
          deductionsApplied.push({
            ordem: 9999,
            tipo: "complemento_piso",
            descricao: `Complemento mínimo garantido por PJ (piso R$ ${piso.toFixed(2)}) — bancado pelo hospital`,
            valor: -complementoPisoTotal, // negativo = aumenta o bolo
          });
        }
      }

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

      // Snapshot de rateio em cada payment_item participante (consumido pelo portal médico)
      const itemsByCompany = new Map<string, typeof elig>();
      for (const it of elig) {
        if (!it.company_id) continue;
        const arr = itemsByCompany.get(it.company_id) ?? [];
        arr.push(it);
        itemsByCompany.set(it.company_id, arr);
      }
      for (const q of quotas) {
        if (!q.paga || !q.company_id) continue;
        const compItems = itemsByCompany.get(q.company_id) ?? [];
        if (compItems.length === 0) continue;
        const rateioItens = compItems.map((it: any) => ({
          id: it.id,
          data: it.procedure_date ?? null,
          descricao: it.procedure_name ?? it.description ?? null,
          valor: Number((it as any)[baseField] ?? 0),
          paciente: it.patient_name ?? null,
          convenio: it.agreement_text ?? null,
          guia: it.attendance_number ?? null,
        }));
        const rateioSnapshot = {
          itens: rateioItens,
          quota: {
            percentual: q.percentual,
            valor: q.quota,
            pool_id: pool.id,
            pool_nome: pool.nome,
            base: round2(base),
            bolo_liquido: bolo,
          },
        };
        await supabase
          .from("payment_items")
          .update({
            empresa_tem_pool: true,
            empresa_liquido_total: q.quota,
            rateio: rateioSnapshot,
          })
          .eq("payment_id", payment_id)
          .eq("company_id", q.company_id);
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
      const { data: runRow } = await supabase.from("pool_calculation_runs").insert({
        payment_id, pool_id: pool.id,
        base_amount: round2(base),
        bolo_liquido: bolo,
        deductions_applied: deductionsApplied,
        quotas,
        competence_month: competenceDate,
        captured_item_ids: isFiltered ? elig.map(it => it.id) : null,
        hospital_id: payment.hospital_id ?? null,
        snapshot: {
          pool_nome: pool.nome,
          base_calculo: pool.base_calculo,
          escopo_producao: pool.escopo_producao,
          filtros_captura: pool.filtros_captura ?? {},
          items_count: elig.length,
          variable_values_used: variableValuesUsed,
          executed_at: new Date().toISOString(),
        },
        created_by: userId,
      } as any).select("id").maybeSingle();

      // Reset claims antigos deste pool/competência e regrava (auditoria + bloqueio)
      if (isFiltered && competenceDate && elig.length) {
        await supabase.from("pool_item_claims")
          .delete().eq("pool_id", pool.id).eq("competence_month", competenceDate);
        await supabase.from("pool_item_claims").insert(
          elig.map((it: any) => ({
            payment_item_id: it.id,
            pool_id: pool.id,
            run_id: runRow?.id ?? null,
            competence_month: competenceDate,
            hospital_id: payment.hospital_id ?? null,
          })) as any,
        );
        // Marca itens como absorvidos pelo pool (médico não recebe direto)
        await supabase.from("payment_items")
          .update({ absorbed_by_pool_id: pool.id, absorbed_by_run_id: runRow?.id ?? null })
          .in("id", elig.map((it: any) => it.id));
      }

      // Persiste aplicações novas e incrementa parcelas_pagas (idempotente: skip se já existir)
      for (const app of adjustmentApplications) {
        await supabase.from("company_adjustment_applications").insert({
          adjustment_id: app.adjustment_id,
          payment_id,
          parcela_numero: app.parcela_numero,
          valor_aplicado: app.valor,
          applied_by: userId,
        } as any);
        // incrementa parcelas_pagas com base no número real de aplicações
        const { count } = await supabase
          .from("company_adjustment_applications")
          .select("*", { count: "exact", head: true })
          .eq("adjustment_id", app.adjustment_id);
        await supabase.from("company_financial_adjustments")
          .update({ parcelas_pagas: count ?? app.parcela_numero })
          .eq("id", app.adjustment_id);
      }

      results.push({
        pool_id: pool.id, pool_nome: pool.nome,
        base: round2(base), bolo, quotas_count: quotas.length,
      });
    }

    // Re-computa o snapshot financeiro de cada PJ do pagamento para refletir
    // as deduções/quotas recém-calculadas nos cards (bruto/descontos/líquido).
    const { data: finRows } = await supabase
      .from("payment_company_financials")
      .select("company_id").eq("payment_id", payment_id);
    const companyIdsToRecompute = new Set<string>([
      ...presentCompanyIds,
      ...((finRows ?? []).map((f: any) => f.company_id).filter(Boolean) as string[]),
    ]);
    for (const cid of companyIdsToRecompute) {
      try {
        await supabase.functions.invoke("compute-company-financials", {
          body: { payment_id, company_id: cid },
        });
      } catch (e) {
        console.warn("[recalc-payment-pools] compute-company-financials falhou", cid, e);
      }
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
