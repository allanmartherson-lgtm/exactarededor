// summarize-payment — Gera resumo executivo de um lote via Claude.
// Não altera valores, status, regras ou itens. Apenas grava o resumo em
// payments.processing_diagnostics.executive_summary.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RiskLevel = "baixo" | "medio" | "alto" | "critico";
interface ExecutiveSummary {
  headline: string;
  bullets: string[];
  risk_level: RiskLevel;
  recommended_action: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { payment_id, mode: rawMode } = await req.json();
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mode: "general" | "director" = rawMode === "director" ? "director" : "general";

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Pagamento
    const { data: payment, error: pErr } = await supabase
      .from("payments")
      .select("id, reference, status, total_amount, competence_month, items_count, processing_diagnostics")
      .eq("id", payment_id)
      .maybeSingle();

    if (pErr || !payment) {
      return new Response(JSON.stringify({ error: "payment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Itens — agrega ai_status e por empresa
    const { data: items } = await supabase
      .from("payment_items")
      .select("ai_status, gross_amount, expected_amount, company_name, doctor_name, sector, authorized_exception, exception_note")
      .eq("payment_id", payment_id)
      .limit(20000);

    const statusCounts: Record<string, number> = {};
    const byCompany: Record<string, { total: number; count: number; alerts: number }> = {};
    let totalItems = 0;
    let totalAlerts = 0;
    let excecoesCount = 0;
    let excecoesImpacto = 0;
    const excecoesAmostra: Array<{ medico: string; empresa: string; valor: number; nota: string }> = [];
    for (const it of items ?? []) {
      totalItems++;
      const st = String(it.ai_status ?? "sem_status");
      statusCounts[st] = (statusCounts[st] ?? 0) + 1;
      const co = it.company_name ?? "—";
      byCompany[co] ||= { total: 0, count: 0, alerts: 0 };
      byCompany[co].total += Number(it.gross_amount) || 0;
      byCompany[co].count += 1;
      const isAlert = ["divergente", "sem_regra", "duplicado", "alerta", "outlier"].some((k) => st.includes(k));
      if (isAlert) {
        totalAlerts++;
        byCompany[co].alerts += 1;
      }
      if (it.authorized_exception) {
        excecoesCount++;
        const impacto = (Number(it.gross_amount) || 0) - (Number(it.expected_amount) || 0);
        excecoesImpacto += impacto;
        if (excecoesAmostra.length < 8) {
          excecoesAmostra.push({
            medico: String(it.doctor_name ?? "—"),
            empresa: String(co),
            valor: impacto,
            nota: String(it.exception_note ?? "").slice(0, 200),
          });
        }
      }
    }

    // 3. Grupos por empresa (status)
    const { data: groups } = await supabase
      .from("payment_company_groups")
      .select("company_name, status, total_amount, items_count")
      .eq("payment_id", payment_id);

    // 4. Últimas observações (analista/validador/diretor)
    const { data: observations } = await supabase
      .from("payment_observations")
      .select("observation_type, message, created_at, author_role")
      .eq("payment_id", payment_id)
      .in("author_role", ["analista", "validador", "diretor"])
      .order("created_at", { ascending: false })
      .limit(5);

    const contexto = {
      lote: {
        referencia: payment.reference ?? payment.title ?? "—",
        status: payment.status,
        valor_total: Number(payment.total_amount) || 0,
        competencia: payment.competence_month,
        qtd_itens: payment.items_count ?? totalItems,
        sla_due_at: payment.sla_due_at ?? null,
      },
      itens: {
        total: totalItems,
        alertas: totalAlerts,
        pct_alertas: totalItems > 0 ? Math.round((totalAlerts / totalItems) * 100) : 0,
        distribuicao_status: statusCounts,
      },
      empresas: Object.entries(byCompany)
        .map(([nome, v]) => ({ nome, ...v, pct_alertas: v.count > 0 ? Math.round((v.alerts / v.count) * 100) : 0 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
      grupos_status: (groups ?? []).map((g) => ({
        empresa: g.company_name,
        status: g.status,
        valor: Number(g.total_amount) || 0,
        itens: g.items_count,
      })),
      observacoes_recentes: (observations ?? []).map((o) => ({
        tipo: o.observation_type,
        autor: o.author_role,
        mensagem: String(o.message ?? "").slice(0, 300),
        data: o.created_at,
      })),
      excecoes_autorizadas: {
        total: excecoesCount,
        impacto_total: excecoesImpacto,
        amostra: excecoesAmostra,
      },
    };

    const generalPrompt = `Você é um auditor sênior de pagamentos médicos. Gere um RESUMO EXECUTIVO objetivo e direto sobre um lote de pagamento, em português do Brasil.

REGRAS:
- Seja conciso, técnico e prático. Nada de jargão vago.
- Use somente fatos presentes no contexto JSON. Nunca invente números, regras ou empresas.
- O resumo deve ajudar analista, validador e diretor a entender o lote em <30s.
- Headline: 1 frase com o valor total, qtd de empresas e principal sinal (ex: "% em alerta").
- Bullets: 3 a 5 pontos com os achados mais relevantes (concentração, riscos, SLA, observações).
- risk_level: classifique baseado em % de alertas, distribuição entre empresas e SLA.
  - baixo: <10% alertas, SLA folgado
  - medio: 10-30% alertas
  - alto: 30-60% alertas OU concentração forte em 1 empresa OU SLA apertado
  - critico: >60% alertas OU SLA vencido OU sinais combinados
- recommended_action: 1 frase com a próxima ação concreta sugerida.`;

    const directorPrompt = `Você é um auditor sênior preparando um BRIEFING DE APROVAÇÃO para o Diretor Financeiro de uma rede hospitalar, em português do Brasil.

CONTEXTO: O lote está em "aguardando_aprovacao". O Diretor precisa decidir entre aprovar, aprovar com ressalva ou devolver ao validador.

REGRAS:
- Tom formal, executivo, orientado à DECISÃO. Nada de jargão técnico desnecessário.
- Use somente fatos presentes no contexto JSON. Nunca invente.
- Headline: 1 frase sintetizando o lote e o nível de confiança para aprovação.
- Bullets (3 a 6): foque em
  1) Exceções autorizadas pelos analistas (quantidade, impacto financeiro, padrões)
  2) Sinais de risco residual (alertas não tratados, concentração em médicos/empresas)
  3) SLA e pendências
  4) Sinal de qualidade da revisão (observações da equipe)
- risk_level (sob a ótica de aprovação):
  - baixo: revisão completa, exceções justificadas, sem sinais críticos → aprovar tranquilo
  - medio: pequenas ressalvas, mas sem bloqueador
  - alto: exceções relevantes sem justificativa clara OU concentração forte → exigir atenção
  - critico: sinais combinados de risco, lote provavelmente deve ser devolvido
- recommended_action: OBRIGATORIAMENTE uma destas frases exatas:
  * "Aprovar o lote"
  * "Aprovar com ressalva"
  * "Devolver ao validador para revisão"`;

    const systemPrompt = mode === "director" ? directorPrompt : generalPrompt;

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 600,
        system: systemPrompt,
        messages: [
          { role: "user", content: `Contexto do lote (JSON):\n${JSON.stringify(contexto, null, 2)}` },
        ],
        tools: [{
          name: "executive_summary",
          description: "Resumo executivo do lote de pagamento",
          input_schema: {
            type: "object",
            properties: {
              headline: { type: "string", description: "Frase-resumo do lote" },
              bullets: {
                type: "array",
                items: { type: "string" },
                description: "3 a 5 bullets com os achados-chave",
              },
              risk_level: {
                type: "string",
                enum: ["baixo", "medio", "alto", "critico"],
              },
              recommended_action: { type: "string" },
            },
            required: ["headline", "bullets", "risk_level", "recommended_action"],
            additionalProperties: false,
          },
        }],
        tool_choice: { type: "tool", name: "executive_summary" },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições à IA atingido. Tente novamente em instantes." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos no workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("summarize-payment AI error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "Falha ao gerar resumo" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const tc = aiData.content?.find((b: { type: string }) => b.type === "tool_use");
    const summary = (tc?.input ?? null) as ExecutiveSummary | null;
    if (!summary) {
      return new Response(JSON.stringify({ error: "IA não retornou estrutura esperada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const generated_at = new Date().toISOString();
    const existingDiag = (payment.processing_diagnostics ?? {}) as Record<string, unknown>;
    const diagKey = mode === "director" ? "director_briefing" : "executive_summary";
    const nextDiag = {
      ...existingDiag,
      [diagKey]: { ...summary, generated_at },
    };

    const { error: updErr } = await supabase
      .from("payments")
      .update({ processing_diagnostics: nextDiag })
      .eq("id", payment_id);

    if (updErr) {
      console.error("summarize-payment update error", updErr);
    }

    return new Response(
      JSON.stringify({ ok: true, summary: { ...summary, generated_at }, mode }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("summarize-payment error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
