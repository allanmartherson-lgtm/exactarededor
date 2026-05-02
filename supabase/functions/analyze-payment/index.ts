// analyze-payment — Fase 3
// Motor determinístico (TS puro) decide regra vencedora e calcula expected.
// IA roda apenas em itens marcados como `needs_ai_review` (alerta/reprovado)
// e SÓ produz justificativa textual — não muda status, regra ou valor.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  analyzePaymentItems,
  type ItemInput,
  type RuleInput,
  type PaymentContext,
  type AnalysisResult,
} from "../_shared/rulesEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentRow {
  sectors: string[] | null;
  specialties: string[] | null;
  payment_type: string | null;
  payment_due_date: string | null;
  competence_month: string | null;
  analysis_mode: "padrao" | "empresa_prioritaria" | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { payment_id, company_name } = await req.json();
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    // ---------- 1. carrega payment ----------
    const { data: payment } = await supabase
      .from("payments")
      .select("sectors,specialties,payment_type,payment_due_date,competence_month,analysis_mode")
      .eq("id", payment_id)
      .maybeSingle<PaymentRow>();

    const ctx: PaymentContext = {
      sectors: payment?.sectors ?? [],
      specialties: payment?.specialties ?? [],
      payment_type: payment?.payment_type ?? null,
      reference_date: payment?.payment_due_date
        ?? payment?.competence_month
        ?? new Date().toISOString().slice(0, 10),
    };
    const isEmpresaPrioritaria = payment?.analysis_mode === "empresa_prioritaria";

    // ---------- 2. carrega regras (com novos campos do motor) ----------
    const { data: rulesRaw } = await supabase
      .from("rules")
      .select(`
        id,name,rule_text,description,active,severity,scope,sector,sectors,specialties,
        target_type,target_identifier,target_name,target_company_id,
        procedure_codes,applies_payment_types,valid_from,valid_until,
        calculation_type,convenio_percentage,fixed_amount,package_amount,extras_codes,
        rule_type,reference_table_id,multiplier,deflator_pct,repasse_pct,
        apply_access_route,include_auxiliaries,auxiliary_pct
      `)
      .eq("active", true);
    const rules: RuleInput[] = (rulesRaw ?? []) as unknown as RuleInput[];

    // ---------- 3. carrega itens (filtra por empresa se aplicável) ----------
    const itemsQuery = supabase
      .from("payment_items")
      .select(`
        id,doctor_name,doctor_document,company_name,company_id,
        procedure_code,procedure_name,description,access_route,doctor_role,
        procedure_amount,gross_amount,attendance_number,patient_name,procedure_date
      `)
      .eq("payment_id", payment_id);
    if (company_name && typeof company_name === "string") {
      itemsQuery.eq("company_name", company_name);
    }
    const { data: itemsRaw } = await itemsQuery;

    // Carrega CNPJ das empresas referenciadas (para casamento de regras por empresa)
    const companyIds = Array.from(new Set(
      (itemsRaw ?? []).map((it: any) => it.company_id).filter(Boolean),
    )) as string[];
    let companyDocs: Record<string, string | null> = {};
    if (companyIds.length > 0) {
      const { data: cs } = await supabase
        .from("companies")
        .select("id,document")
        .in("id", companyIds);
      for (const c of cs ?? []) companyDocs[c.id as string] = (c.document as string | null) ?? null;
    }

    const items: ItemInput[] = (itemsRaw ?? []).map((it: any) => ({
      id: it.id,
      doctor_name: it.doctor_name,
      doctor_document: it.doctor_document,
      company_name: it.company_name,
      company_id: it.company_id,
      company_document: it.company_id ? (companyDocs[it.company_id] ?? null) : null,
      procedure_code: it.procedure_code,
      procedure_name: it.procedure_name,
      description: it.description,
      access_route: it.access_route,
      doctor_role: it.doctor_role,
      procedure_amount: it.procedure_amount != null ? Number(it.procedure_amount) : null,
      gross_amount: Number(it.gross_amount),
      attendance_number: it.attendance_number,
      patient_name: it.patient_name,
      procedure_date: it.procedure_date,
    }));

    // ---------- 4. MOTOR: decisão + cálculo determinístico ----------
    const results: AnalysisResult[] = analyzePaymentItems(items, rules, ctx);
    const resultById: Record<string, AnalysisResult> = {};
    for (const r of results) resultById[r.item_id] = r;

    // ---------- 5. IA SÓ JUSTIFICA itens com needs_ai_review ----------
    // Em modo empresa_prioritaria, ignoramos histórico de outros pagamentos.
    const itemsToReview = results.filter((r) => r.needs_ai_review);
    let aiJustifications: Record<string, { extra_alerts: string[]; ai_note: string }> = {};

    if (itemsToReview.length > 0 && LOVABLE_API_KEY) {
      const itemsForAi = itemsToReview.map((r) => {
        const it = items.find((i) => i.id === r.item_id)!;
        return {
          id: r.item_id,
          empresa: it.company_name,
          atendimento: it.attendance_number,
          paciente: it.patient_name,
          medico: it.doctor_name,
          funcao: it.doctor_role,
          codigo: it.procedure_code,
          procedimento: it.procedure_name ?? it.description,
          via_acesso: it.access_route,
          valor_convenio: it.procedure_amount,
          valor_pago: it.gross_amount,
          motor: {
            status: r.status,
            valor_esperado: r.expected_amount,
            diff_pct: r.diff_pct,
            regra_vencedora: r.matched_rule_name,
            tipo_calculo: r.calculation_type_used,
            prioridade: r.matched_priority,
            explicacao: r.calculation_explanation,
            alertas_motor: r.alerts,
          },
        };
      });

      const historyText = isEmpresaPrioritaria ? "" : await (async () => {
        const { data: history } = await supabase
          .from("payment_observations")
          .select("author_type, message")
          .in("author_type", ["validador", "diretor"])
          .order("created_at", { ascending: false })
          .limit(20);
        if (!history?.length) return "";
        return "\n\nObservações recentes de validadores/diretor (contexto):\n" +
          history.map((h: any) => `- (${h.author_type}) ${h.message}`).join("\n");
      })();

      const systemPrompt = `Você é um auditor financeiro de pagamentos médicos.
O MOTOR DETERMINÍSTICO já decidiu a regra vencedora, calculou o valor esperado e classificou o status. Sua função é APENAS:
1) Escrever uma observação curta (máx. 2 frases) explicando o porquê do alerta/reprovação para o validador humano.
2) Adicionar alertas EXTRAS que o motor não detectaria (ex.: incoerência entre função do médico e atendimento, suspeita de duplicidade, paciente com múltiplos itens estranhos).
NUNCA mude status, valor esperado, regra ou tipo de cálculo. NUNCA invente regras. Se não houver alerta extra real, retorne extra_alerts vazio.
${isEmpresaPrioritaria ? "MODO EMPRESA_PRIORITÁRIA: analise cada item ISOLADAMENTE. Não cruze com outros pagamentos/meses/histórico." : ""}${historyText}`;

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Itens marcados pelo motor (JSON):\n${JSON.stringify(itemsForAi, null, 2)}` },
          ],
          tools: [{
            type: "function",
            function: {
              name: "report_justifications",
              description: "Justifica cada item já analisado pelo motor",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string", description: "Resumo OBJETIVO em pt-BR, máx. 2 frases, focado no que o gestor precisa decidir." },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        ai_note: { type: "string", description: "Justificativa curta do alerta/reprovação." },
                        extra_alerts: { type: "array", items: { type: "string" }, description: "Alertas EXTRAS que o motor não capturou. Vazio se nada a acrescentar." },
                      },
                      required: ["id", "ai_note", "extra_alerts"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["summary", "items"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "report_justifications" } },
        }),
      });

      if (aiResp.ok) {
        const aiData = await aiResp.json();
        const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (tc) {
          const parsed = JSON.parse(tc.function.arguments);
          for (const it of parsed.items ?? []) {
            aiJustifications[it.id] = {
              extra_alerts: Array.isArray(it.extra_alerts) ? it.extra_alerts : [],
              ai_note: typeof it.ai_note === "string" ? it.ai_note : "",
            };
          }
          (aiJustifications as any).__summary = parsed.summary ?? "";
        }
      } else {
        const txt = await aiResp.text();
        console.error("AI justification error", aiResp.status, txt);
        // Falha de IA não derruba a análise — motor já decidiu tudo.
      }
    }

    // ---------- 6. Caller (para snapshots) ----------
    let triggeredBy: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const jwt = authHeader.replace("Bearer ", "");
        const { data: u } = await supabase.auth.getUser(jwt);
        triggeredBy = u?.user?.id ?? null;
      }
    } catch (_) { /* opcional */ }

    // ---------- 7. Snapshots prévios para diff ----------
    const itemIds = results.map((r) => r.item_id);
    const { data: prevVersions } = await supabase
      .from("ai_analysis_versions")
      .select("item_id, version, ai_status, expected_amount, alerts, matched_rules")
      .in("item_id", itemIds);
    const prevByItem: Record<string, { version: number; ai_status: string; expected_amount: number | null; alerts: string[]; matched_rules: string[] }> = {};
    for (const v of prevVersions ?? []) {
      const cur = prevByItem[v.item_id as string];
      if (!cur || (v.version as number) > cur.version) {
        prevByItem[v.item_id as string] = {
          version: v.version as number,
          ai_status: v.ai_status as string,
          expected_amount: (v.expected_amount as number | null) ?? null,
          alerts: (v.alerts as string[]) ?? [],
          matched_rules: (v.matched_rules as string[]) ?? [],
        };
      }
    }

    // ---------- 8. Persiste resultados ----------
    let alerts = 0, blocks = 0;
    const itemDiffSummaries: { item_id: string; doctor: string; diff: string }[] = [];

    for (const r of results) {
      const it = items.find((i) => i.id === r.item_id);
      const aiJ = aiJustifications[r.item_id];
      const finalAlerts = [...r.alerts, ...(aiJ?.extra_alerts ?? [])];
      const matchedRules = r.matched_rule_name ? [r.matched_rule_name] : [];
      const matchedRuleIds = r.matched_rule_id ? [r.matched_rule_id] : [];

      const findings = {
        alerts: finalAlerts,
        matched_rules: matchedRules,
        matched_rule_ids: matchedRuleIds,
        expected_amount: r.expected_amount,
        calculation_explanation: r.calculation_explanation,
        // Novos campos do motor (consumidos pela UI na Fase 4):
        engine: {
          calculation_type_used: r.calculation_type_used,
          matched_priority: r.matched_priority,
          diff_pct: r.diff_pct,
          ai_note: aiJ?.ai_note ?? null,
        },
      };

      await supabase.from("payment_items").update({
        ai_status: r.status,
        ai_findings: findings,
      }).eq("id", r.item_id);

      if (r.status === "alerta") alerts++;
      if (r.status === "reprovado") blocks++;

      // Snapshot
      const prev = prevByItem[r.item_id];
      const nextVersion = (prev?.version ?? 0) + 1;
      await supabase.from("ai_analysis_versions").insert({
        payment_id,
        item_id: r.item_id,
        version: nextVersion,
        ai_status: r.status,
        alerts: finalAlerts,
        matched_rules: matchedRules,
        matched_rule_ids: matchedRuleIds,
        expected_amount: r.expected_amount,
        calculation_explanation: r.calculation_explanation,
        gross_amount_at_time: it ? it.gross_amount : null,
        model: aiJ ? "engine+gemini-2.5-flash" : "engine",
        triggered_by: triggeredBy,
      });

      // Diff por item
      if (prev) {
        const diffParts: string[] = [];
        if (prev.ai_status !== r.status) diffParts.push(`status: ${prev.ai_status} → ${r.status}`);
        if ((prev.expected_amount ?? null) !== (r.expected_amount ?? null)) {
          diffParts.push(`valor esperado: ${prev.expected_amount ?? "—"} → ${r.expected_amount ?? "—"}`);
        }
        const prevA = new Set(prev.alerts ?? []);
        const newA = new Set(finalAlerts);
        const added = [...newA].filter((a) => !prevA.has(a));
        const removed = [...prevA].filter((a) => !newA.has(a));
        if (added.length) diffParts.push(`+ ${added.length} alerta(s): ${added.slice(0, 2).join("; ")}${added.length > 2 ? "…" : ""}`);
        if (removed.length) diffParts.push(`- ${removed.length} alerta(s) resolvido(s)`);
        const prevR = new Set(prev.matched_rules ?? []);
        const newR = new Set(matchedRules);
        const addedR = [...newR].filter((x) => !prevR.has(x));
        if (addedR.length) diffParts.push(`nova regra: ${addedR.join("; ")}`);
        if (diffParts.length) {
          itemDiffSummaries.push({ item_id: r.item_id, doctor: it?.doctor_name ?? "item", diff: diffParts.join(" · ") });
          await supabase.from("payment_observations").insert({
            payment_id,
            item_id: r.item_id,
            author_type: "ia",
            message: `Reanálise v${nextVersion}: ${diffParts.join(" · ")}`,
          });
        }
      } else {
        const parts: string[] = [`Análise inicial v1 — ${r.status} (${r.matched_priority})`];
        if (r.expected_amount != null) parts.push(`esperado R$ ${r.expected_amount.toFixed(2)}`);
        if (finalAlerts.length) parts.push(`${finalAlerts.length} alerta(s)`);
        await supabase.from("payment_observations").insert({
          payment_id,
          item_id: r.item_id,
          author_type: "ia",
          message: parts.join(" · ") + ` — ${r.calculation_explanation}` + (aiJ?.ai_note ? ` | IA: ${aiJ.ai_note}` : ""),
        });
      }
    }

    // ---------- 9. Resumo do pagamento ----------
    const summary = (aiJustifications as any).__summary
      || `Motor analisou ${results.length} item(ns): ${results.length - alerts - blocks} aprovado(s), ${alerts} alerta(s), ${blocks} reprovado(s).`;

    await supabase.from("payments").update({
      status: "revisao_analista",
      ai_summary: summary,
    }).eq("id", payment_id);

    const consolidatedDiff = itemDiffSummaries.length
      ? `\nMudanças nesta rodada (${itemDiffSummaries.length} item(ns)):\n` +
        itemDiffSummaries.slice(0, 8).map((d) => `• ${d.doctor}: ${d.diff}`).join("\n") +
        (itemDiffSummaries.length > 8 ? `\n…e mais ${itemDiffSummaries.length - 8} item(ns).` : "")
      : "";

    await supabase.from("payment_observations").insert({
      payment_id,
      author_type: "ia",
      message: `${summary} (${alerts} alertas, ${blocks} reprovações)${consolidatedDiff}`,
      status_from: "em_analise_ia",
      status_to: "revisao_analista",
    });

    // ---------- 10. Grupos por empresa ----------
    const groupsMap = new Map<string, { company_id: string | null; company_name: string; items: ItemInput[] }>();
    for (const it of items) {
      const name = (it.company_name ?? "Sem empresa").trim() || "Sem empresa";
      const key = name.toLowerCase();
      const cur = groupsMap.get(key);
      if (cur) cur.items.push(it);
      else groupsMap.set(key, { company_id: it.company_id, company_name: name, items: [it] });
    }
    for (const g of groupsMap.values()) {
      const total = g.items.reduce((s, x) => s + Number(x.gross_amount), 0);
      const { data: existing } = await supabase
        .from("payment_company_groups")
        .select("id")
        .eq("payment_id", payment_id)
        .ilike("company_name", g.company_name)
        .maybeSingle();
      if (existing) {
        await supabase.from("payment_company_groups").update({
          status: "revisao_analista",
          items_count: g.items.length,
          total_amount: total,
          company_id: g.company_id,
        }).eq("id", existing.id);
      } else {
        await supabase.from("payment_company_groups").insert({
          payment_id,
          company_id: g.company_id,
          company_name: g.company_name,
          status: "revisao_analista",
          items_count: g.items.length,
          total_amount: total,
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, alerts, blocks, total: results.length, ai_used: itemsToReview.length > 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("analyze-payment error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
