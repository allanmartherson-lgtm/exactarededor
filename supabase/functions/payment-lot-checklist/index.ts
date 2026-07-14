// payment-lot-checklist — Checklist único por LOTE (não por empresa).
// Combina sinais determinísticos (regra, divergências, TUSS principal, valor
// em risco, histórico de devolução) com 1 chamada à IA para priorizar
// alertas. Suporta duas audiências:
//  - validator (default): checklist completo para o validador
//  - director: resumo executivo enxuto (só alta/média, foco em risco material)
//
// NÃO altera dados. Apenas orientativo.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sha256Hex, getChecklistCache, saveChecklistCache } from "../_shared/checklistCache.ts";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ChecklistItem {
  text: string;
  priority: "alta" | "media" | "baixa";
  category: string;
  company_name?: string | null;
  source: "deterministic" | "ai";
}

interface CompanyAgg {
  company_name: string;
  group_id: string | null;
  status: string | null;
  total_items: number;
  reprovado: number;
  alerta: number;
  sem_regra: number;
  total_bruto: number;
  total_esperado: number;
  value_at_risk: number; // soma gross de itens reprovado/alerta
  diff_bloqueante: boolean;
  diff_abs: number;
  diff_pct: number;
}

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    const { payment_id, audience = "validator", force_refresh = false } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- 1) Dados base do pagamento + grupos ----
    const [pmtRes, groupsRes, itemsRes, tussRes, threshRes] = await Promise.all([
      supabase
        .from("payments")
        .select("id, reference, analysis_mode, hospital_id, total_amount")
        .eq("id", payment_id)
        .maybeSingle(),
      supabase
        .from("payment_company_groups")
        .select("id, company_name, status, total_amount, items_count")
        .eq("payment_id", payment_id),
      supabase
        .from("payment_items")
        .select("company_name, ai_status, gross_amount, expected_amount, applied_calc_method")
        .eq("payment_id", payment_id)
        .limit(20000),
      // TUSS principal audit é detectado no cliente (sem coluna dedicada);
      // mantemos placeholder para preservar a forma do Promise.all.
      Promise.resolve({ count: 0 }),
      supabase
        .from("system_configurations")
        .select("value")
        .eq("key", "divergence_thresholds")
        .maybeSingle(),
    ]);

    const payment = pmtRes.data;
    if (!payment) {
      return new Response(JSON.stringify({ error: "payment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Modo manual tem comportamento próprio — não emitimos checklist aqui.
    if (payment.analysis_mode === "manual") {
      return new Response(JSON.stringify({ ok: true, items: [], summary: null, skipped: "manual_mode" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groups = (groupsRes.data ?? []) as Array<{
      id: string; company_name: string; status: string | null;
      total_amount: number | null; items_count: number | null;
    }>;
    const items = (itemsRes.data ?? []) as Array<{
      company_name: string | null; ai_status: string | null;
      gross_amount: number | null; expected_amount: number | null; applied_calc_method: string | null;
    }>;
    const tussPending = tussRes.count ?? 0;
    const thresholds = (() => {
      const v = (threshRes.data?.value ?? {}) as Record<string, unknown>;
      return {
        block_pct: Number(v.group_block_pct ?? 0.5),
        block_abs: Number(v.group_block_abs ?? 1.0),
      };
    })();

    // ---- 2) Totais de regra por grupo (view) ----
    const groupIds = groups.map((g) => g.id);
    const ruleTotalsRes = groupIds.length
      ? await supabase
          .from("vw_group_rule_totals")
          .select("group_id, bruto_pedido_total, bruto_regra_total, diferenca, diferenca_pct, itens_sem_regra")
          .in("group_id", groupIds)
      : { data: [] as Array<{ group_id: string; bruto_pedido_total: number; bruto_regra_total: number; diferenca: number; diferenca_pct: number | null; itens_sem_regra: number | null }> };
    const ruleByGroup = new Map<string, { diferenca: number; pct: number; sem_regra: number }>();
    for (const r of ruleTotalsRes.data ?? []) {
      ruleByGroup.set(r.group_id as string, {
        diferenca: Number(r.diferenca ?? 0),
        pct: Number(r.diferenca_pct ?? 0),
        sem_regra: Number(r.itens_sem_regra ?? 0),
      });
    }

    // ---- 3) Histórico de devolução por empresa (últimos 10 lotes) ----
    const companyNames = Array.from(new Set(groups.map((g) => g.company_name)));
    const historyRes = companyNames.length
      ? await supabase
          .from("payment_company_groups")
          .select("company_name, status")
          .in("company_name", companyNames)
          .neq("payment_id", payment_id)
          .in("status", ["devolvido_analista", "rejeitado", "em_questionamento"])
          .limit(500)
      : { data: [] as Array<{ company_name: string; status: string }> };
    const returnsByCompany = new Map<string, number>();
    for (const h of historyRes.data ?? []) {
      returnsByCompany.set(h.company_name, (returnsByCompany.get(h.company_name) ?? 0) + 1);
    }

    // ---- 4) Agregação por empresa ----
    const aggByCompany = new Map<string, CompanyAgg>();
    for (const g of groups) {
      const rt = ruleByGroup.get(g.id) ?? { diferenca: 0, pct: 0, sem_regra: 0 };
      const diffAbs = Math.abs(rt.diferenca);
      const diffPct = Math.abs(rt.pct);
      aggByCompany.set(g.company_name, {
        company_name: g.company_name,
        group_id: g.id,
        status: g.status,
        total_items: g.items_count ?? 0,
        reprovado: 0,
        alerta: 0,
        sem_regra: rt.sem_regra,
        total_bruto: Number(g.total_amount ?? 0),
        total_esperado: 0,
        value_at_risk: 0,
        diff_bloqueante: diffAbs > thresholds.block_abs && diffPct > thresholds.block_pct,
        diff_abs: rt.diferenca,
        diff_pct: rt.pct,
      });
    }
    for (const it of items) {
      const key = it.company_name ?? "";
      const a = aggByCompany.get(key);
      if (!a) continue;
      const gross = Number(it.gross_amount ?? 0);
      if (it.ai_status === "reprovado") { a.reprovado++; a.value_at_risk += gross; }
      else if (it.ai_status === "alerta") { a.alerta++; a.value_at_risk += gross * 0.3; }
      a.total_esperado += Number(it.expected_amount ?? 0);
    }

    // ---- 5) Sinais determinísticos ----
    const det: ChecklistItem[] = [];
    const lotTotal = Number(payment.total_amount ?? 0);
    const lotReprovado = Array.from(aggByCompany.values()).reduce((s, a) => s + a.reprovado, 0);
    const lotAlerta = Array.from(aggByCompany.values()).reduce((s, a) => s + a.alerta, 0);
    const lotSemRegra = Array.from(aggByCompany.values()).reduce((s, a) => s + a.sem_regra, 0);
    const lotValueAtRisk = Array.from(aggByCompany.values()).reduce((s, a) => s + a.value_at_risk, 0);
    const blockingCompanies = Array.from(aggByCompany.values()).filter((a) => a.diff_bloqueante);

    if (tussPending > 0) {
      det.push({
        text: `Resolver ${tussPending} item(ns) na auditoria de TUSS principal — aprovação fica bloqueada até zerar.`,
        priority: "alta", category: "TUSS principal", source: "deterministic",
      });
    }
    for (const c of blockingCompanies) {
      det.push({
        text: `${c.company_name}: divergência bloqueante de ${BRL(c.diff_abs)} (${c.diff_pct.toFixed(2)}%) entre pedido e regra. Liberar com justificativa ou ajustar.`,
        priority: "alta", category: "Conciliação", company_name: c.company_name, source: "deterministic",
      });
    }
    if (lotSemRegra > 0) {
      const top = Array.from(aggByCompany.values())
        .filter((a) => a.sem_regra > 0)
        .sort((a, b) => b.sem_regra - a.sem_regra)
        .slice(0, 2)
        .map((a) => `${a.company_name} (${a.sem_regra})`)
        .join(", ");
      det.push({
        text: `${lotSemRegra} item(ns) sem regra no lote — concentrados em ${top}. Verificar se precisam de cadastro ou se vão pagar como sem acordo.`,
        priority: lotSemRegra > 10 ? "alta" : "media", category: "Sem regra", source: "deterministic",
      });
    }
    if (lotReprovado > 0) {
      det.push({
        text: `${lotReprovado} item(ns) reprovado(s) pela IA — valor em risco ≈ ${BRL(lotValueAtRisk)}. Confirmar tratativa antes de validar.`,
        priority: "alta", category: "Reprovações", source: "deterministic",
      });
    }
    for (const [company, count] of returnsByCompany.entries()) {
      if (count >= 2) {
        det.push({
          text: `${company} foi devolvida/questionada ${count}× nos últimos lotes — revisar mensagens anteriores antes de validar.`,
          priority: "media", category: "Histórico", company_name: company, source: "deterministic",
        });
      }
    }
    if (det.length === 0 && lotAlerta === 0 && lotReprovado === 0 && lotSemRegra === 0 && !blockingCompanies.length && tussPending === 0) {
      det.push({
        text: `Lote sem divergências automáticas — conferir documentação fiscal e anexos antes de liberar.`,
        priority: "baixa", category: "Rotina", source: "deterministic",
      });
    }

    // ---- 5.5) Contexto (usado no cache-hash e no prompt IA) ----
    const contexto = {
      lote: { reference: payment.reference, total: lotTotal, empresas: groups.length },
      sinais_por_empresa: Array.from(aggByCompany.values()).map((a) => ({
        empresa: a.company_name,
        total_bruto: a.total_bruto, itens: a.total_items,
        reprovado: a.reprovado, alerta: a.alerta, sem_regra: a.sem_regra,
        diff_abs: a.diff_abs, diff_pct: a.diff_pct, bloqueante: a.diff_bloqueante,
        devolucoes_anteriores: returnsByCompany.get(a.company_name) ?? 0,
      })),
      tuss_pendentes: tussPending,
      audience,
      det_snapshot: det.map((d) => ({ t: d.text, p: d.priority, c: d.category })),
    };

    const summary = {
      empresas: groups.length,
      total_lote: lotTotal,
      valor_em_risco: lotValueAtRisk,
      reprovado: lotReprovado,
      alerta: lotAlerta,
      sem_regra: lotSemRegra,
      bloqueantes: blockingCompanies.length,
      tuss_pendentes: tussPending,
    };

    // hospital_id vem do payment consultado — nunca do body.
    const hospitalId = payment.hospital_id as string | null;
    const scopeKey = `${payment_id}::${audience}`;
    const inputHash = await sha256Hex(JSON.stringify(contexto));

    if (hospitalId && !force_refresh) {
      const cached = await getChecklistCache<{ items: ChecklistItem[]; summary: typeof summary }>(
        supabase, "payment_lot", hospitalId, scopeKey,
      );
      if (cached && cached.input_hash === inputHash) {
        return new Response(JSON.stringify({
          ok: true,
          items: cached.result?.items ?? [],
          summary: cached.result?.summary ?? summary,
          cached: true,
          updated_at: cached.updated_at,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ---- 6) Resumo IA (1 chamada, opcional — pula se não houver chave) ----
    const aiItems: ChecklistItem[] = [];
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY) {
      const sysPrompt = audience === "director"
        ? `Você é um diretor financeiro revisando um lote de pagamento médico. Produza um RESUMO EXECUTIVO em 2-4 itens — apenas o que importa para decidir aprovar ou devolver. Foco em valor em risco, divergências bloqueantes e histórico ruim. Sem instruções operacionais. Priorize 'alta' para risco material; nada de 'baixa'. category curta.`
        : `Você é auditor sênior de pagamento médico. Produza 2-4 alertas adicionais para o validador, complementando os sinais determinísticos já identificados (não repita o óbvio). Use APENAS dados do contexto. Quando o alerta for sobre uma empresa específica, preencha company_name. category curta (ex.: Concentração, Outlier, Padrão atípico).`;

      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": LOVABLE_API_KEY,
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: `Contexto JSON:\n${JSON.stringify(contexto, null, 2)}` },
            ],
            tools: [{
              type: "function",
              function: {
                name: "emit_checklist",
                description: "Emite alertas priorizados",
                parameters: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          text: { type: "string" },
                          priority: { type: "string", enum: ["alta", "media", "baixa"] },
                          category: { type: "string" },
                          company_name: { type: "string" },
                        },
                        required: ["text", "priority", "category"],
                      },
                    },
                  },
                  required: ["items"],
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "emit_checklist" } },
          }),
        });
        if (aiResp.ok) {
          const data = await aiResp.json();
          const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          const parsed = args ? JSON.parse(args) : null;
          for (const it of (parsed?.items ?? []) as Array<{ text: string; priority: ChecklistItem["priority"]; category: string; company_name?: string }>) {
            aiItems.push({ ...it, source: "ai" });
          }
        } else {
          console.error("payment-lot-checklist AI", aiResp.status, await aiResp.text());
        }
      } catch (e) {
        console.error("payment-lot-checklist AI exception", e);
      }
    }

    // ---- 7) Merge + filtros por audiência ----
    let merged = [...det, ...aiItems];
    if (audience === "director") {
      merged = merged.filter((m) => m.priority !== "baixa").slice(0, 6);
    } else {
      // ordena: alta > media > baixa
      const w = { alta: 0, media: 1, baixa: 2 } as const;
      merged.sort((a, b) => w[a.priority] - w[b.priority]);
      merged = merged.slice(0, 10);
    }

    if (hospitalId) {
      await saveChecklistCache(
        supabase, "payment_lot", hospitalId, scopeKey, inputHash,
        { items: merged, summary }, LOVABLE_API_KEY ? "google/gemini-3-flash-preview" : null,
      );
    }

    return new Response(JSON.stringify({
      ok: true,
      items: merged,
      summary,
      cached: false,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("payment-lot-checklist error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
