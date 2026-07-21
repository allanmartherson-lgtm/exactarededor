// AI Copilot — single endpoint for all assistive AI features.
// Routes by `task` to the right prompt template.
// Never decides — always returns suggestions/explanations for the user to confirm.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Task =
  | "explain_rule"           // resume regra em linguagem natural
  | "explain_item_status"    // por que item ficou sem_regra / divergente
  | "explain_value"          // narra cálculo passo a passo
  | "summarize_inconsistencies" // resumo após upload
  | "suggest_duplicate"      // possível duplicata no cadastro
  | "disambiguate_entity"    // IA decide se 2 nomes são mesma entidade (etapa 3)
  | "suggest_manual_reason"  // sugere motivo de intervenção manual para itens sem base
  | "zeev_tip";              // dica conversacional do mascote Zeev por contexto de tela


interface CopilotRequest {
  task: Task;
  context: Record<string, unknown>;
  model?: string;
}

const PROMPT_BUILDERS: Record<Task, (ctx: Record<string, unknown>) => { system: string; user: string; jsonSchema?: object }> = {
  explain_rule: (ctx) => ({
    system: "Você é um copiloto de um sistema de repasse médico hospitalar. Explique regras de pagamento em linguagem clara para não-técnicos, em 2-3 frases. Português brasileiro.",
    user: `Regra cadastrada:\n${JSON.stringify(ctx.rule, null, 2)}\n\nExplique o que essa regra faz e em quais casos ela se aplica.`,
  }),
  explain_item_status: (ctx) => ({
    system: [
      "Você é um copiloto especializado em repasse médico hospitalar.",
      "Sua função é EXPLICAR DECISÕES JÁ TOMADAS pelo motor de forma assertiva — NUNCA pedir validação humana redundante.",
      "",
      "REGRAS DE LINGUAGEM (obrigatórias):",
      "- NUNCA escreva: 'valide se está correto', 'confirme antes de aplicar', 'apenas confirme', 'verifique se procede', 'antes de processar o pagamento'.",
      "- NUNCA peça ao analista para reconferir um cálculo que o motor já fechou sem divergência.",
      "- Use tom afirmativo: 'o repasse é de X% porque...', 'a regra Y venceu sobre Z por...', 'não há ação necessária'.",
      "",
      "CONTEÚDO (2-3 frases, PT-BR, sem jargão técnico):",
      "1) Diagnóstico direto: por que o motor chegou nesse status (causa-raiz, regra específica que venceu, parâmetro decisivo).",
      "2) Quando há divergência → ação concreta e específica (não genérica).",
      "3) Quando está conforme → adicione UM insight não-óbvio: comparação com média do convênio para esse procedimento, padrão típico do médico, faixa de valor esperada, ou ponto real de atenção. Se não tiver insight relevante, encerre com 'Nenhuma ação necessária'.",
      "",
      "Proibido: repetir o que o painel já mostra (nome da regra, valor, percentual). Trazer algo que o analista NÃO veria sem você.",
    ].join("\n"),
    user: `Item:\n${JSON.stringify(ctx.item, null, 2)}\n\nRegras candidatas:\n${JSON.stringify(ctx.candidate_rules ?? [], null, 2)}\n\nStatus do motor: "${ctx.item_status}".\n\nExplique a decisão de forma assertiva. Se conforme, traga um insight útil ou diga 'Nenhuma ação necessária'. Se divergente, aponte causa-raiz e ação específica.`,
  }),
  explain_value: (ctx) => ({
    system: "Você narra o cálculo de um repasse médico passo a passo (base × multiplicador × função). Use bullet points curtos. PT-BR.",
    user: `Cálculo:\n${JSON.stringify(ctx.calculation, null, 2)}\n\nExplique como chegou no valor final.`,
  }),
  summarize_inconsistencies: (ctx) => ({
    system: "Você é um copiloto que lê o resultado de validação de planilha e produz um resumo executivo de 3-5 bullets para o analista decidir como proceder. PT-BR.",
    user: `Inconsistências detectadas:\n${JSON.stringify(ctx.inconsistencies, null, 2)}\n\nProduza um resumo executivo com padrões dominantes e sugestões de ação priorizadas.`,
  }),
  suggest_duplicate: (ctx) => ({
    system: "Você verifica se um cadastro novo é provavelmente duplicata de um existente. Retorne JSON estruturado. PT-BR.",
    user: `Cadastro novo: ${JSON.stringify(ctx.new_entity)}\n\nCandidatos existentes:\n${JSON.stringify(ctx.candidates, null, 2)}\n\nAlgum candidato é provavelmente a mesma entidade?`,
    jsonSchema: {
      type: "object",
      properties: {
        is_duplicate: { type: "boolean" },
        candidate_id: { type: "string" },
        confidence: { type: "number" },
        reasoning: { type: "string" },
      },
      required: ["is_duplicate", "confidence", "reasoning"],
    },
  }),
  disambiguate_entity: (ctx) => ({
    system: "Você decide se dois nomes referem-se à mesma entidade (empresa, médico, convênio ou setor) com base em contexto. Retorne JSON. PT-BR.",
    user: `Nome A: ${ctx.name_a}\nNome B: ${ctx.name_b}\nTipo: ${ctx.entity_type}\nContexto: ${JSON.stringify(ctx.shared_context ?? {})}\n\nSão a mesma entidade?`,
    jsonSchema: {
      type: "object",
      properties: {
        same_entity: { type: "boolean" },
        confidence: { type: "number" },
        reasoning: { type: "string" },
      },
      required: ["same_entity", "confidence", "reasoning"],
    },
  }),
  suggest_manual_reason: (ctx) => ({
    system: [
      "Você é o Zeev, copiloto do Exacta. Sua tarefa é sugerir o MELHOR motivo de intervenção manual",
      "para itens de pagamento médico que estão sem base de cálculo (procedure_amount nulo/zerado)",
      "mas foram pagos. Cada item exige uma justificativa antes de ir para validação/aprovação.",
      "",
      "Você recebe (a) a lista de motivos cadastrados disponíveis (code + label + descrição) e",
      "(b) os itens (médico, procedimento TUSS, valor pago, atendimento). Avalie o padrão dominante",
      "e responda em JSON estruturado com o motivo mais provável.",
      "",
      "Heurísticas comuns:",
      "- TUSS 10102019 (visita hospitalar) com valor zerado e gross_amount > 0 → geralmente 'visita_pos_alta' (visita lançada depois da alta).",
      "- TUSS de parecer cobrado várias vezes para mesmo atendimento → 'visita_sequencial_parecer'.",
      "- Valor diferente da tabela combinado → 'valor_negociado'.",
      "- TUSS que cobre múltiplos atos → 'tuss_ambiguo'.",
      "- Se nenhum motivo se encaixa bem com alta confiança → use 'outro_clinico' ou 'outro_financeiro' conforme a natureza.",
      "",
      "ESTRATÉGIA DE VALOR (suggested_value_strategy):",
      "- 'procedure' → acatar valor do convênio/faturamento (sobrescreve gross_amount pelo procedure_amount). Use quando o hospital pagou algo divergente da regra e queremos alinhar ao faturado.",
      "- 'expected' → manter valor da regra. Use quando o motivo é aceite financeiro sem repactuação: aprovamos o item, mas não mexemos no valor pago.",
      "- 'custom' → só sugira se houver forte evidência de que todos os itens devem receber um mesmo valor negociado diferente das duas opções acima. Prefira 'procedure' ou 'expected' quando em dúvida.",
      "",
      "Responda SEMPRE em JSON. PT-BR. Confidence 0-1.",
    ].join("\n"),
    user:
      `Motivos disponíveis:\n${JSON.stringify(ctx.available_reasons ?? [], null, 2)}\n\n` +
      `Itens que precisam de motivo (${(ctx.items as unknown[] | undefined)?.length ?? 0}):\n${JSON.stringify(ctx.items ?? [], null, 2)}\n\n` +
      `Sugira o motivo mais provável para o conjunto e a estratégia de valor. Se os itens forem heterogêneos, escolha o que cobre a maioria e explique no campo 'reasoning'.`,
    jsonSchema: {
      type: "object",
      properties: {
        reason_code: { type: "string", description: "code do motivo sugerido (ex: visita_pos_alta)" },
        confidence: { type: "number" },
        suggested_note: { type: "string", description: "Justificativa curta sugerida para preencher no campo de notas" },
        suggested_value_strategy: {
          type: "string",
          enum: ["procedure", "expected", "custom"],
          description: "Estratégia de valor recomendada",
        },
        reasoning: { type: "string", description: "Por que esse motivo e essa estratégia se aplicam" },
      },
      required: ["reason_code", "confidence", "reasoning"],
    },
  }),
  zeev_tip: (ctx) => ({

    system: [
      "Você é o Zeev, mascote assistente do Exacta (sistema de repasse médico hospitalar da Rede D'Or).",
      "Personalidade: amigável, próximo, direto, levemente bem-humorado — sem ser infantil. Tom de colega experiente que dá uma cutucada útil.",
      "Sempre fala em 1ª pessoa ('eu reparei…', 'olha só…', 'se quiser, posso te mostrar…').",
      "REGRAS:",
      "- Máximo 2 frases curtas. Sem listas, sem markdown pesado, sem emojis exagerados (no máx. 1).",
      "- Use o contexto da página e dos sinais (alertas, contagens) para personalizar a dica.",
      "- Se não há nada urgente, ofereça um insight ou pergunta orientadora — nunca diga só 'tudo certo'.",
      "- NUNCA invente números que não estejam no contexto. NUNCA prometa executar ação no banco.",
      "- PT-BR.",
    ].join("\n"),
    user: `Tela atual: ${ctx.page_label ?? "—"}\nResumo do que está em tela:\n${JSON.stringify(ctx.summary ?? {}, null, 2)}\n\nSinais já detectados (deterministicamente):\n${JSON.stringify(ctx.signals ?? [], null, 2)}\n\nDê UMA dica curta e personalizada para o analista nesta tela agora.`,
  }),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth required — prevents anonymous LLM cost abuse and prompt injection
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await authClient.auth.getUser();
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as CopilotRequest;
    if (!body.task || !PROMPT_BUILDERS[body.task]) {
      return new Response(JSON.stringify({ error: "invalid task" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Feature flag check
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: flag } = await sb
      .from("feature_flags")
      .select("enabled")
      .eq("key", "ai_copilot_enabled")
      .maybeSingle();
    if (flag && flag.enabled === false) {
      return new Response(JSON.stringify({ error: "copilot_disabled" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { system, user, jsonSchema } = PROMPT_BUILDERS[body.task](body.context);
    const model = body.model ?? "google/gemini-3-flash-preview";

    const aiBody: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (jsonSchema) {
      aiBody.tools = [{
        type: "function",
        function: { name: "respond", description: "Respond with structured data", parameters: jsonSchema },
      }];
      aiBody.tool_choice = { type: "function", function: { name: "respond" } };
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify(aiBody),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      const status = aiResp.status === 429 || aiResp.status === 402 ? aiResp.status : 500;
      return new Response(JSON.stringify({ error: "ai_gateway_error", status: aiResp.status, detail: errText }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    let result: unknown;
    if (jsonSchema) {
      const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
      try { result = JSON.parse(toolCall?.function?.arguments ?? "{}"); }
      catch { result = { error: "parse_error", raw: toolCall }; }
    } else {
      result = { text: aiData?.choices?.[0]?.message?.content ?? "" };
    }

    return new Response(JSON.stringify({ task: body.task, result, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
