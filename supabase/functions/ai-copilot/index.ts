// AI Copilot — single endpoint for all assistive AI features.
// Routes by `task` to the right prompt template.
// Never decides — always returns suggestions/explanations for the user to confirm.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Task =
  | "explain_rule"           // resume regra em linguagem natural
  | "explain_item_status"    // por que item ficou sem_regra / divergente
  | "explain_value"          // narra cálculo passo a passo
  | "summarize_inconsistencies" // resumo após upload
  | "suggest_duplicate"      // possível duplicata no cadastro
  | "disambiguate_entity";   // IA decide se 2 nomes são mesma entidade (etapa 3)

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
    system: "Você é um copiloto que ajuda analistas a entender por que itens de pagamento ficaram com status problemático. Seja direto: 1 frase de diagnóstico + 1 frase de sugestão de ação. PT-BR.",
    user: `Item:\n${JSON.stringify(ctx.item, null, 2)}\n\nRegras candidatas (se houver):\n${JSON.stringify(ctx.candidate_rules ?? [], null, 2)}\n\nPor que esse item ficou com status "${ctx.item_status}"? Que ação o analista deve tomar?`,
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
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
