// summarize-payment — Gera resumo executivo de um lote via Claude.
// Não altera valores, status, regras ou itens. Apenas grava o resumo em
// payments.processing_diagnostics.executive_summary.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { anthropicFetch } from "../_shared/anthropicWithFallback.ts";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

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
      .select("id, reference, status, total_amount, bruto_total, liquido_total, competence_month, items_count, processing_diagnostics")
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

    // Rótulos humanos para os códigos técnicos do enum item_ai_status — a IA
    // NÃO deve nunca exibir códigos brutos do banco no resumo final.
    const AI_STATUS_LABELS: Record<string, string> = {
      pendente: "Pendente",
      aprovado: "Aprovado",
      alerta: "Em alerta",
      reprovado: "Reprovado",
      erro_duplicidade_pagamento: "Duplicidade de pagamento",
      erro_duplicidade_calculo: "Duplicidade de cálculo",
      acatado: "Acatado",
      sem_status: "Sem status",
    };
    const labelAiStatus = (code: string) => AI_STATUS_LABELS[code] ?? code;

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
      .select("company_id, company_name, status, total_amount, bruto_total, liquido_total, items_count")
      .eq("payment_id", payment_id);

    // 3b. Composição financeira agregada do lote (pool, glosa, conciliação separados)
    // Só usamos se TODOS os snapshots estiverem computados — caso contrário a soma
    // fica parcial e a IA alucina "divergência bruto vs líquido" comparando o líquido
    // total do lote (completo) contra um bruto agregado incompleto.
    const { data: pcf } = await supabase
      .from("payment_company_financials")
      .select("bruto, debitos, creditos, glosas, pool, conciliacao, liquido, computed_at, company_id")
      .eq("payment_id", payment_id);
    const totalGroups = (groups ?? []).length;
    const pcfRows = pcf ?? [];
    const computedRows = pcfRows.filter((r: any) => r.computed_at != null);
    const composicaoCompleta = totalGroups > 0 && computedRows.length === totalGroups;
    const composicao = computedRows.reduce(
      (acc, r: any) => ({
        bruto: acc.bruto + Number(r.bruto || 0),
        debitos: acc.debitos + Number(r.debitos || 0),
        creditos: acc.creditos + Number(r.creditos || 0),
        glosas: acc.glosas + Number(r.glosas || 0),
        pool: acc.pool + Number(r.pool || 0),
        conciliacao: acc.conciliacao + Number(r.conciliacao || 0),
        liquido: acc.liquido + Number(r.liquido || 0),
      }),
      { bruto: 0, debitos: 0, creditos: 0, glosas: 0, pool: 0, conciliacao: 0, liquido: 0 },
    );
    const reducaoTotal = composicao.bruto - composicao.liquido;
    const reducaoExplicada = composicao.debitos + composicao.glosas + composicao.pool - composicao.creditos - composicao.conciliacao;
    const reducaoNaoExplicada = Math.round((reducaoTotal - reducaoExplicada) * 100) / 100;


    // 4. Últimas observações (analista/validador/diretor)
    // Filtra observações automáticas (reanálise, recálculo, reprocessamento, auditoria do motor)
    // — são operação rotineira de ajuste, não achado financeiro. Sem isso a IA passa a citar
    // "regras reaplicadas N vezes" como sinal de risco.
    const AUTO_OBS_PATTERNS = /reanális|reanalis|reaplic|reprocess|recálcul|recalcul|motor:|auditoria do motor|divergência pós-split|pós-split|pos-split/i;
    const { data: observationsRaw } = await supabase
      .from("payment_observations")
      .select("observation_type, message, created_at, author_type")
      .eq("payment_id", payment_id)
      .in("author_type", ["analista", "validador", "diretor"])
      .order("created_at", { ascending: false })
      .limit(20);
    const observations = (observationsRaw ?? [])
      .filter((o) => !AUTO_OBS_PATTERNS.test(String(o.message ?? "")))
      .slice(0, 5);

    const contexto = {
      lote: {
        referencia: payment.reference ?? "—",
        status: payment.status,
        valor_liquido: Number((payment as any).liquido_total ?? payment.total_amount) || 0,
        valor_bruto: Number((payment as any).bruto_total ?? payment.total_amount) || 0,
        houve_deducoes: Math.abs(
          (Number((payment as any).liquido_total ?? payment.total_amount) || 0) -
          (Number((payment as any).bruto_total ?? payment.total_amount) || 0)
        ) > 0.01,
        competencia: payment.competence_month,
        qtd_itens: payment.items_count ?? totalItems,
      },
      itens: {
        total: totalItems,
        alertas: totalAlerts,
        pct_alertas: totalItems > 0 ? Math.round((totalAlerts / totalItems) * 100) : 0,
        distribuicao_status: Object.fromEntries(
          Object.entries(statusCounts).map(([k, v]) => [labelAiStatus(k), v]),
        ),

      },
      empresas: Object.entries(byCompany)
        .map(([nome, v]) => ({ nome, ...v, pct_alertas: v.count > 0 ? Math.round((v.alerts / v.count) * 100) : 0 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
      grupos_status: (groups ?? []).map((g: any) => ({
        empresa: g.company_name,
        status: g.status,
        valor_liquido: Number(g.liquido_total ?? g.total_amount) || 0,
        itens: g.items_count,
        // NOTA: valor_bruto removido propositalmente. A diferença bruto/líquido
        // de um grupo NÃO é glosa — pode ser pool, débitos contratuais ou
        // créditos. Glosa real só aparece em `glosas_por_empresa` abaixo.
      })),
      observacoes_recentes: (observations ?? []).map((o) => ({
        tipo: o.observation_type,
        autor: o.author_type,
        mensagem: String(o.message ?? "").slice(0, 300),
        data: o.created_at,
      })),
      excecoes_autorizadas: {
        total: excecoesCount,
        impacto_total: excecoesImpacto,
        amostra: excecoesAmostra,
      },
      // Glosa real por empresa — vem direto de payment_company_financials.glosas.
      // Disponível mesmo quando a composição agregada está incompleta, pois cada
      // linha individual é confiável. Se nenhuma empresa tem glosa, manda lista
      // vazia explícita para a IA saber que NÃO HÁ GLOSA no lote.
      glosas_por_empresa: (() => {
        const companyNameById = new Map<string, string>();
        for (const g of groups ?? []) {
          if (g.company_name) companyNameById.set(String((g as any).company_id ?? ""), String(g.company_name));
        }
        return computedRows
          .filter((r: any) => Math.abs(Number(r.glosas || 0)) > 0.01)
          .map((r: any) => ({
            empresa: companyNameById.get(String(r.company_id)) ?? "—",
            glosa: Math.round(Number(r.glosas) * 100) / 100,
          }))
          .sort((a, b) => b.glosa - a.glosa)
          .slice(0, 10);
      })(),
      conciliacao_divergente_por_empresa: (() => {
        const companyNameById = new Map<string, string>();
        for (const g of groups ?? []) {
          if (g.company_name) companyNameById.set(String((g as any).company_id ?? ""), String(g.company_name));
        }
        return computedRows
          .filter((r: any) => Math.abs(Number(r.conciliacao || 0)) > 0.01)
          .map((r: any) => ({
            empresa: companyNameById.get(String(r.company_id)) ?? "—",
            conciliacao: Math.round(Number(r.conciliacao) * 100) / 100,
          }))
          .sort((a, b) => Math.abs(b.conciliacao) - Math.abs(a.conciliacao))
          .slice(0, 10);
      })(),
      composicao_financeira: composicaoCompleta
        ? {
            bruto: Math.round(composicao.bruto * 100) / 100,
            liquido: Math.round(composicao.liquido * 100) / 100,
            reducao_total: Math.round(reducaoTotal * 100) / 100,
            pool_rateio: Math.round(composicao.pool * 100) / 100,
            debitos_contratuais: Math.round(composicao.debitos * 100) / 100,
            creditos: Math.round(composicao.creditos * 100) / 100,
            glosas: Math.round(composicao.glosas * 100) / 100,
            conciliacao: Math.round(composicao.conciliacao * 100) / 100,
            reducao_nao_explicada: reducaoNaoExplicada,
          }
        : {
            indisponivel: true,
            motivo: `Snapshots financeiros incompletos (${computedRows.length}/${totalGroups} empresas) — recompute em andamento. Use 'glosas_por_empresa' e 'conciliacao_divergente_por_empresa' como única fonte de glosa/conciliação.`,
          },
    };


    const generalPrompt = `Você é um auditor sênior de pagamentos médicos. Gere um RESUMO EXECUTIVO objetivo e direto sobre um lote de pagamento, em português do Brasil.

REGRAS GERAIS:
- Seja conciso, técnico e prático. Nada de jargão vago.
- Use somente fatos presentes no contexto JSON. Nunca invente números, regras ou empresas.
- O resumo deve ajudar analista, validador e diretor a entender o lote em <30s.
- Operação de processo (reanálises, recálculos, reprocessamentos do motor) NÃO é achado financeiro: NÃO cite isso.

LINGUAGEM PARA O USUÁRIO FINAL (REGRA INVIOLÁVEL):
- O resumo é lido por pessoal financeiro/operacional, não por desenvolvedores.
- NUNCA mencione nomes técnicos de campos, colunas ou chaves do JSON (ex: NÃO escreva "lote.houve_deducoes", "glosas_por_empresa", "conciliacao_divergente_por_empresa", "ai_status", "true/false"). Traduza para frases naturais.
- NUNCA cite códigos brutos de status entre aspas (ex: NÃO escreva 'erro_duplicidade_pagamento', 'reprovado', 'sem_regra'). Use os rótulos humanos já entregues em 'itens.distribuicao_status' (ex: "Duplicidade de pagamento", "Reprovado", "Em alerta").
- Em vez de "glosas_por_empresa está vazio", escreva "sem glosas registradas". Em vez de "houve_deducoes = true", escreva "houve deduções no líquido".
- Se precisar afirmar que algo não existe nos dados, diga em linguagem comum (ex: "nenhuma exceção autorizada no período"), nunca citando o nome do campo.


ÚNICA FONTE DE GLOSA (REGRA INVIOLÁVEL):
- Glosa SÓ existe se aparecer em 'glosas_por_empresa' com valor > 0, OU em 'composicao_financeira.glosas' > 0 quando composicao_financeira NÃO está indisponível.
- Se 'glosas_por_empresa' está vazio (lista []), NÃO HÁ GLOSA NO LOTE. NUNCA escreva "glosa", "perda por glosa" ou similar em nenhum bullet.
- É TERMINANTEMENTE PROIBIDO inferir glosa a partir da diferença entre bruto e líquido de qualquer empresa ou do lote. Essa diferença normalmente é pool/rateio, débitos contratuais ou créditos — NUNCA presuma que é glosa.
- 'grupos_status' NÃO contém valor_bruto justamente para impedir essa inferência. Não invente bruto por grupo.

ÚNICA FONTE DE CONCILIAÇÃO DIVERGENTE:
- Use apenas 'conciliacao_divergente_por_empresa'. Se vazio, NÃO cite divergência de conciliação.

CLASSIFICAÇÃO DA DIFERENÇA BRUTO → LÍQUIDO (só quando composicao_financeira NÃO está indisponível):
- NEUTRO (não eleva risk_level): pool_rateio, debitos_contratuais, creditos. Pool é modelo contratual legítimo — cite com naturalidade, sem alarme.
- RISCO REAL: glosas > 0, conciliacao ≠ 0, reducao_nao_explicada > 1% do bruto.

PROIBIDO COMPARAR lote.valor_bruto COM composicao_financeira.bruto (REGRA INVIOLÁVEL):
- 'lote.valor_bruto' é o faturamento bruto importado da base hospitalar (referência operacional).
- 'composicao_financeira.bruto' é a base de cálculo de repasse médico produzida pelo motor de regras (já considera função, percentual de acordo, exceções autorizadas, sem_acordo etc.).
- São conceitos DIFERENTES por design. A diferença entre eles NÃO é glosa, NÃO é inconsistência, NÃO é "redução não explicada" e NÃO deve ser citada como risco, alerta ou achado financeiro.
- NUNCA escreva bullets do tipo "diferença entre valor_bruto do lote e bruto da composição financeira", "X% não explicada pela composição", "possível inconsistência no cálculo" baseando-se nessa comparação.
- "Redução não explicada" SÓ se refere ao campo 'composicao_financeira.reducao_nao_explicada' (já calculado), nunca à diferença lote.valor_bruto vs composicao.bruto.

PROIBIDO CITAR HISTÓRICO DE IMPORTAÇÃO/REIMPORTAÇÃO (REGRA INVIOLÁVEL):
- Reimportações, recargas da base, ajustes de escopo e variações de total bruto ao longo do processamento são OPERAÇÃO DE PROCESSO do analista — NÃO são achado financeiro.
- O JSON não traz histórico de importações. Se você não vê esses dados no contexto, é porque ELES NÃO EXISTEM — NUNCA invente datas, contagens de reimportação ou variações temporais de valor bruto.

QUANDO composicao_financeira.indisponivel === true:
- NÃO cite bruto da composição, "redução não explicada", nem compare líquido vs bruto agregado.
- Para bruto/líquido use apenas lote.valor_liquido e lote.valor_bruto.
- Glosa e conciliação SÓ podem ser citados se aparecerem em glosas_por_empresa / conciliacao_divergente_por_empresa.

DEMAIS INSTRUÇÕES:
- Foque em riscos reais: glosas (das listas), conciliação divergente (da lista), itens com ai_status de alerta, exceções autorizadas relevantes.
- NÃO considere concentração de prestadores numa empresa como risco — é normal em hospitais.
- Headline: 1 frase com VALOR LÍQUIDO (lote.valor_liquido), qtd de empresas e principal sinal financeiro REAL. Se não há glosa nem conciliação divergente, diga isso explicitamente (ex: "sem glosas registradas").
- Bullets: 3 a 5. Cada afirmação financeira precisa apontar para um campo concreto do JSON.
- risk_level:
  - baixo: <10% itens em alerta, glosas_por_empresa vazio, conciliação ok
  - medio: 10-30% alertas OU glosa pequena
  - alto: 30-60% alertas OU glosa relevante OU conciliação divergente
  - critico: >60% alertas OU combinação de glosa + conciliação
- recommended_action: 1 frase com a próxima ação concreta.`;


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

    const aiResp = await anthropicFetch({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
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
      // Anthropic devolve 400 "credit balance too low" quando a conta zera —
      // trata como créditos esgotados para o cliente lidar como fallback.
      if (/credit balance is too low/i.test(t)) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos no workspace.", fallback: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Qualquer outra falha upstream: devolve 200 + fallback para NÃO derrubar a UI.
      return new Response(JSON.stringify({ error: "Falha ao gerar resumo", fallback: true, upstream_status: aiResp.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const tc = aiData.content?.find((b: { type: string }) => b.type === "tool_use");
    let summary = (tc?.input ?? null) as ExecutiveSummary | null;
    // Fallback: se o modelo (ex.: gateway OpenAI de fallback) não emitiu tool_use
    // mas devolveu texto, tenta extrair JSON do bloco de texto.
    if (!summary) {
      const textBlock = aiData.content?.find((b: { type: string; text?: string }) => b.type === "text");
      const raw = String(textBlock?.text ?? "").trim();
      if (raw) {
        const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
        const start = cleaned.search(/[\{\[]/);
        const end = cleaned.lastIndexOf("}");
        if (start !== -1 && end > start) {
          try {
            const parsed = JSON.parse(cleaned.slice(start, end + 1));
            if (parsed && typeof parsed === "object" && parsed.headline) {
              summary = parsed as ExecutiveSummary;
            }
          } catch { /* segue para fallback */ }
        }
      }
    }
    if (!summary) {
      console.error("summarize-payment: sem tool_use e sem JSON parseável", JSON.stringify(aiData).slice(0, 500));
      // Não derruba a UI — devolve 200 + fallback para o cliente esconder o card.
      return new Response(
        JSON.stringify({ error: "IA não retornou estrutura esperada", fallback: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
