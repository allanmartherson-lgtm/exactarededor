// Zeev Staging Executor — interpreta pedidos em linguagem natural sobre o
// LOTE EM CONSTRUÇÃO (pré-envio), antes de existir payment_id.
//
// Diferente do zeev-executor:
//   - Não acessa banco. Só LLM. O cliente é quem conhece o estado do staging
//     (buckets/arquivos/linhas suspeitas) e aplica a ação localmente.
//   - Esta função SÓ devolve a intenção estruturada. A confirmação e a
//     execução acontecem no front, sempre com card de preview.
//
// Ações suportadas (v1):
//   - decide_suspicious   payload: { decision: 'discard'|'informative_total'|'keep' }
//                         scope:   { file_name?, reason?, all? }
//   - set_sector_bulk     payload: { sector: 'CC'|'UPA'|'UTI'|...} (rule sector code)
//                         scope:   { file_names?: string[], only_missing?: bool, all?: bool }
//   - unsupported / clarify

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM_PROMPT = [
  "Você é o Zeev — assistente do Exacta. Aqui o analista está montando um LOTE de pagamento (pré-envio).",
  "Sua função: interpretar o pedido e devolver uma AÇÃO estruturada. Você NÃO executa nada — quem aplica é o front, e sempre pede confirmação humana.",
  "",
  "AÇÕES DISPONÍVEIS (v1 do staging):",
  "1) decide_suspicious — aplica uma decisão em lote para as linhas marcadas como suspeitas (totalizadores/rodapé).",
  "   payload.decision: 'discard' | 'informative_total' | 'keep'",
  "   scope.file_name (opcional): nome do arquivo (string) — restringe ao arquivo X",
  "   scope.reason (opcional): 'footer-text' | 'value-without-key' | 'tail-summary'",
  "   scope.all (opcional, bool): true se aplicar em todas as suspeitas pendentes",
  "",
  "2) set_sector_bulk — define o SETOR (RuleSector) em todos/alguns arquivos do lote.",
  "   payload.sector: o código exato do setor (vindo do contexto.available_sectors).",
  "   scope.only_missing (opcional, default true): só aplica em arquivos que ainda NÃO têm setor escolhido (sector_missing=true).",
  "   scope.file_names (opcional): lista de nomes de arquivo para restringir.",
  "   scope.all (opcional): true para aplicar em todos os arquivos (sobrescreve setor já escolhido).",
  "   Use only_missing=true quando o analista disser 'nos que faltam', 'sem setor', 'pendentes'. Use all=true só se ele disser 'em todos' / 'todos os arquivos'.",
  "",
  "REGRAS:",
  "- Se o pedido pede CENTRO DE CUSTOS ou VINCULAR MÉDICO À EMPRESA em lote no PRÉ-ENVIO, devolva action='unsupported' e explique que essas ações ficam disponíveis APÓS o envio do lote, na tela de detalhe do pagamento.",
  "- Se o setor solicitado não existir em context.available_sectors, devolva action='clarify' e liste as opções no summary.",
  "- Se ambíguo, action='clarify' e peça o esclarecimento curto no 'summary'.",
  "- 'summary' = 1 frase em PT-BR, sem números (a contagem é calculada no front).",
  "- Sinônimos de decisão: 'descartar', 'tirar', 'remover' = discard. 'informativo', 'total informativo' = informative_total. 'manter', 'aceitar como item' = keep.",
  "- 'totalizadores', 'rodapé', 'linhas suspeitas', 'totais', 'NF', 'subtotal' → action=decide_suspicious.",
  "- 'setor', 'CC', 'UPA', 'UTI', 'ambulatório', 'pronto socorro' → action=set_sector_bulk.",
].join("\n");

const RESPOND_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["decide_suspicious", "set_sector_bulk", "unsupported", "clarify"],
    },
    scope: {
      type: "object",
      properties: {
        file_name: { type: "string" },
        file_names: { type: "array", items: { type: "string" } },
        reason: { type: "string", enum: ["footer-text", "value-without-key", "tail-summary"] },
        only_missing: { type: "boolean" },
        all: { type: "boolean" },
      },
      additionalProperties: false,
    },
    payload: {
      type: "object",
      properties: {
        decision: { type: "string", enum: ["discard", "informative_total", "keep"] },
        sector: { type: "string" },
      },
      additionalProperties: false,
    },
    summary: { type: "string" },
  },
  required: ["action", "summary"],
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RequestBody {
  prompt: string;
  context?: {
    file_names?: string[];
    suspicious_total?: number;
    pending_total?: number;
    reasons_present?: string[];
    files_missing_sector?: string[];
    available_sectors?: Array<{ code: string; label: string }>;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    if (!LOVABLE_API_KEY) return jsonResp({ error: "LOVABLE_API_KEY missing" }, 500);

    // Auth required — prevents anonymous LLM cost abuse and prompt injection
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await authClient.auth.getUser();
    if (authErr || !authData?.user) return jsonResp({ error: "Unauthorized" }, 401);

    const body = (await req.json()) as RequestBody;
    if (!body.prompt) return jsonResp({ error: "prompt obrigatório" }, 400);

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Contexto do staging:\n${JSON.stringify(body.context ?? {}, null, 2)}\n\nPedido do analista:\n"${body.prompt}"\n\nDevolva via tool 'respond'.`,
          },
        ],
        tools: [{
          type: "function",
          function: { name: "respond", description: "Devolve a proposta estruturada", parameters: RESPOND_SCHEMA },
        }],
        tool_choice: { type: "function", function: { name: "respond" } },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      const status = resp.status === 429 || resp.status === 402 ? resp.status : 500;
      return jsonResp({ error: `ai_gateway_${resp.status}: ${text}` }, status);
    }

    const data = await resp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return jsonResp({ error: "LLM não retornou tool call" }, 500);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(toolCall.function.arguments ?? "{}");
    } catch {
      return jsonResp({ error: "falha ao parsear tool call" }, 500);
    }

    return jsonResp(parsed);
  } catch (err) {
    return jsonResp({ error: (err as Error).message ?? String(err) }, 500);
  }
});
