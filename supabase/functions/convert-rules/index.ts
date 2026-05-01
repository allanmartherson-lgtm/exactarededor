import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, file } = await req.json();
    // file: { name, mimeType, dataBase64 }
    if (!text && !file) {
      return new Response(JSON.stringify({ error: "Envie texto ou arquivo" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (text && (typeof text !== "string" || text.length > 200_000)) {
      return new Response(JSON.stringify({ error: "Texto inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (file && (!file.mimeType || !file.dataBase64 || file.dataBase64.length > 20_000_000)) {
      return new Response(JSON.stringify({ error: "Arquivo inválido (máx ~15MB)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const userContent: any[] = [];
    if (text) userContent.push({ type: "text", text: `Converta este conteúdo em regras estruturadas:\n\n${text}` });
    if (file) {
      userContent.push({ type: "text", text: `Extraia e estruture todas as regras de validação de pagamento contidas no arquivo anexo (${file.name ?? "arquivo"}).` });
      userContent.push({ type: "image_url", image_url: { url: `data:${file.mimeType};base64,${file.dataBase64}` } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: "Você converte texto livre em regras estruturadas para validação de pagamentos médicos. Cada regra deve ter um nome curto, descrição clara, texto da regra (em português, descrevendo a condição), e severidade ('info', 'aviso' ou 'bloqueio'). 'Bloqueio' impede pagamento; 'aviso' é alerta que validador deve revisar; 'info' é apenas observação." },
          { role: "user", content: userContent },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_rules",
            description: "Extrai regras",
            parameters: {
              type: "object",
              properties: {
                rules: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      rule_text: { type: "string" },
                      severity: { type: "string", enum: ["info", "aviso", "bloqueio"] },
                    },
                    required: ["name", "description", "rule_text", "severity"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["rules"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_rules" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Limite de IA atingido." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "Créditos esgotados." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI: ${aiResp.status}`);
    }
    const data = await aiResp.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) throw new Error("No tool call");
    const parsed = JSON.parse(tc.function.arguments);
    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});