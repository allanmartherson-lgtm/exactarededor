// classify-observations — Classifica observações de pagamento em categorias
// semânticas usando Claude. Não altera dados. Apenas leitura/classificação.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ObservationInput {
  id: string;
  message: string;
  author_type: string;
}

interface Classified {
  id: string;
  category: string;
  subcategory: string;
  sentiment: "positivo" | "neutro" | "negativo";
}

const CATEGORIES = [
  "Erro de planilha",
  "Exceção contratual",
  "Médico incorreto",
  "Valor divergente",
  "Duplicidade",
  "Devolução",
  "Validação assistencial",
  "NF/Fiscal",
  "Aprovação",
  "Outros",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { observations } = (await req.json()) as { observations: ObservationInput[] };
    if (!Array.isArray(observations) || observations.length === 0) {
      return new Response(JSON.stringify({ error: "observations array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (observations.length > 50) {
      return new Response(JSON.stringify({ error: "max 50 observations per call" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt =
      `Classifique cada observação de pagamento médico na categoria mais apropriada. Use as categorias fornecidas. Retorne exatamente um item classificado para cada id recebido.\n\nCategorias permitidas: ${CATEGORIES.join(", ")}.\n\nA subcategoria deve ser uma frase curta (até 4 palavras) que detalhe melhor o motivo. O sentimento deve refletir o tom da observação.`;

    const payload = observations.map((o) => ({
      id: o.id,
      autor: o.author_type,
      mensagem: (o.message ?? "").slice(0, 600),
    }));

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          { role: "user", content: `Observações (JSON):\n${JSON.stringify(payload, null, 2)}` },
        ],
        tools: [{
          name: "classify_observations",
          description: "Devolve a classificação semântica de cada observação",
          input_schema: {
            type: "object",
            properties: {
              classified: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    category: { type: "string", enum: CATEGORIES },
                    subcategory: { type: "string" },
                    sentiment: { type: "string", enum: ["positivo", "neutro", "negativo"] },
                  },
                  required: ["id", "category", "subcategory", "sentiment"],
                  additionalProperties: false,
                },
              },
            },
            required: ["classified"],
            additionalProperties: false,
          },
        }],
        tool_choice: { type: "tool", name: "classify_observations" },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições à IA atingido." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("classify-observations AI error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "Falha ao classificar observações" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const tc = aiData.content?.find((b: { type: string }) => b.type === "tool_use");
    const parsed = tc?.input as { classified?: Classified[] } | undefined;
    const classified = parsed?.classified ?? [];

    return new Response(JSON.stringify({ ok: true, classified }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-observations error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
