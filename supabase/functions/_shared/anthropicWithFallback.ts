// Wrapper para chamadas ao Anthropic (Claude) com fallback automático
// para o modelo mais avançado da OpenAI (openai/gpt-5.5) via Lovable AI Gateway
// quando a chave direta do Claude estiver sem crédito.
//
// Uso: substituir `fetch("https://api.anthropic.com/v1/messages", { ... })`
// por `anthropicFetch(body, { signal })`. O objeto `body` é o payload no
// formato Anthropic (system + messages + tools + tool_choice + max_tokens).
// A resposta devolvida é SEMPRE no shape Anthropic:
//   { content: [{ type: "tool_use", name, input }] }  ou
//   { content: [{ type: "text", text }] }
// Assim os consumidores existentes não precisam mudar o parser.

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

type AnthropicMessage = {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; text?: string }>;
};

type AnthropicBody = {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type: "tool"; name: string } | { type: "auto" } | { type: "any" };
};

type FetchInit = { signal?: AbortSignal };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const FALLBACK_MODEL = "openai/gpt-5.5";

function isCreditExhausted(status: number, text: string): boolean {
  if (status === 402) return true;
  if (status === 400 || status === 403) {
    return /credit\s*balance|insufficient|out of credits|quota|billing/i.test(text);
  }
  return false;
}

function contentToText(content: AnthropicMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("\n");
}

function convertToOpenAI(body: AnthropicBody) {
  const messages: Array<{ role: string; content: string }> = [];
  if (body.system) messages.push({ role: "system", content: body.system });
  for (const m of body.messages) {
    messages.push({ role: m.role, content: contentToText(m.content) });
  }
  const tools = body.tools?.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.input_schema,
    },
  }));
  let tool_choice: unknown;
  if (body.tool_choice) {
    if (body.tool_choice.type === "tool") {
      tool_choice = { type: "function", function: { name: body.tool_choice.name } };
    } else if (body.tool_choice.type === "any") {
      tool_choice = "required";
    } else {
      tool_choice = "auto";
    }
  }
  return {
    model: FALLBACK_MODEL,
    messages,
    max_completion_tokens: body.max_tokens ?? 2048,
    ...(tools ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
  };
}

function convertOpenAIResponseToAnthropic(openai: Record<string, unknown>): Record<string, unknown> {
  const choices = (openai.choices as Array<Record<string, unknown>>) ?? [];
  const msg = (choices[0]?.message ?? {}) as Record<string, unknown>;
  const toolCalls = (msg.tool_calls as Array<Record<string, unknown>>) ?? [];
  const content: Array<Record<string, unknown>> = [];
  for (const tc of toolCalls) {
    const fn = (tc.function ?? {}) as { name?: string; arguments?: string };
    let input: unknown = {};
    try { input = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch { input = {}; }
    content.push({ type: "tool_use", name: fn.name ?? "", input });
  }
  if (content.length === 0 && typeof msg.content === "string") {
    content.push({ type: "text", text: msg.content });
  }
  return {
    content,
    stop_reason: choices[0]?.finish_reason ?? "end_turn",
    model: openai.model ?? FALLBACK_MODEL,
    _fallback: true,
  };
}

async function callFallback(body: AnthropicBody, init?: FetchInit): Promise<Response> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Créditos Claude esgotados e LOVABLE_API_KEY não configurada para fallback." }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }
  const openaiBody = convertToOpenAI(body);
  const resp = await fetch(LOVABLE_GATEWAY_URL, {
    method: "POST",
    signal: init?.signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify(openaiBody),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error("[anthropicWithFallback] gateway fallback falhou", resp.status, t.slice(0, 300));
    return new Response(t || JSON.stringify({ error: "fallback_failed" }), {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const openaiJson = await resp.json();
  const anthropicShape = convertOpenAIResponseToAnthropic(openaiJson);
  return new Response(JSON.stringify(anthropicShape), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Chama Anthropic direto; se detectar crédito esgotado (402 ou 400/403 com
 * mensagem sobre "credit balance"/"insufficient"), faz fallback para
 * openai/gpt-5.5 via Lovable AI Gateway e devolve a resposta no MESMO shape
 * que o Anthropic devolveria. Erros que não são de crédito (429, 5xx, 400
 * genéricos) são repassados como veio para preservar a lógica de retry
 * existente do chamador.
 */
export async function anthropicFetch(body: AnthropicBody, init?: FetchInit): Promise<Response> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    // Sem chave direta: usa gateway direto.
    console.warn("[anthropicWithFallback] ANTHROPIC_API_KEY ausente — usando fallback direto.");
    return callFallback(body, init);
  }
  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: init?.signal,
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Erro de rede/abort: propaga para o chamador tratar (retry).
    throw err;
  }
  if (resp.ok) return resp;

  // Ler corpo para inspecionar. Precisamos reconstruir Response porque body só lê 1x.
  const text = await resp.text().catch(() => "");
  if (isCreditExhausted(resp.status, text)) {
    console.warn(`[anthropicWithFallback] Claude sem crédito (status ${resp.status}) — usando fallback ${FALLBACK_MODEL}.`);
    return callFallback(body, init);
  }
  // Repassa erro original preservando status e corpo.
  return new Response(text, {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") ?? "application/json" },
  });
}
