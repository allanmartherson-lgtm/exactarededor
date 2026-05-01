import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RuleRow { id: string; name: string; description: string | null; rule_text: string; severity: string; }
interface ItemRow {
  id: string;
  doctor_name: string;
  doctor_document: string | null;
  doctor_email: string | null;
  description: string | null;
  gross_amount: number;
  raw_data: unknown;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { payment_id } = await req.json();
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const { data: rules } = await supabase.from("rules").select("id,name,description,rule_text,severity").eq("active", true);
    const { data: items } = await supabase.from("payment_items").select("id,doctor_name,doctor_document,doctor_email,description,gross_amount,raw_data").eq("payment_id", payment_id);
    const { data: history } = await supabase
      .from("payment_observations")
      .select("author_type, message")
      .in("author_type", ["validador", "diretor"])
      .order("created_at", { ascending: false })
      .limit(20);

    const rulesText = (rules ?? []).length === 0
      ? "Nenhuma regra cadastrada — apenas verifique consistência básica (valor positivo, dados preenchidos, possíveis duplicatas)."
      : (rules as RuleRow[]).map((r, i) => `R${i + 1} (${r.severity.toUpperCase()}): ${r.name} — ${r.rule_text}${r.description ? ` [${r.description}]` : ""}`).join("\n");

    const historyText = (history ?? []).length === 0
      ? ""
      : "\n\nObservações recentes de validadores/diretor para considerar como contexto:\n" +
        history.map((h: { author_type: string; message: string }) => `- (${h.author_type}) ${h.message}`).join("\n");

    const itemsForAi = (items as ItemRow[]).map((it) => ({
      id: it.id,
      medico: it.doctor_name,
      documento: it.doctor_document,
      descricao: it.description,
      valor_bruto: Number(it.gross_amount),
    }));

    const systemPrompt = `Você é um auditor financeiro de pagamentos médicos. Analise CADA item da lista contra as regras abaixo. Para cada item, retorne:
- status: "aprovado" | "alerta" | "reprovado"
- alerts: array de strings (curtas, em português) descrevendo problemas encontrados; vazio se ok
- matched_rules: nomes das regras violadas/aplicáveis

REGRAS:
${rulesText}${historyText}

Responda APENAS via tool call, sem texto adicional.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Itens a analisar (JSON):\n${JSON.stringify(itemsForAi, null, 2)}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_analysis",
            description: "Reporta análise por item",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Resumo geral em português, 2-3 frases" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      status: { type: "string", enum: ["aprovado", "alerta", "reprovado"] },
                      alerts: { type: "array", items: { type: "string" } },
                      matched_rules: { type: "array", items: { type: "string" } },
                    },
                    required: ["id", "status", "alerts", "matched_rules"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "items"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_analysis" } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("AI error", aiResp.status, txt);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Limite de IA atingido. Tente novamente em instantes." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos no workspace." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");
    const result = JSON.parse(toolCall.function.arguments);

    // Atualiza cada item
    let alerts = 0, blocks = 0;
    for (const r of result.items) {
      await supabase.from("payment_items").update({
        ai_status: r.status,
        ai_findings: { alerts: r.alerts, matched_rules: r.matched_rules },
      }).eq("id", r.id);
      if (r.status === "alerta") alerts++;
      if (r.status === "reprovado") blocks++;
    }

    await supabase.from("payments").update({
      status: "aguardando_validacao",
      ai_summary: result.summary,
    }).eq("id", payment_id);

    await supabase.from("payment_observations").insert({
      payment_id,
      author_type: "ia",
      message: `${result.summary} (${alerts} alertas, ${blocks} reprovações sugeridas)`,
      status_from: "em_analise_ia",
      status_to: "aguardando_validacao",
    });

    return new Response(JSON.stringify({ ok: true, alerts, blocks }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("analyze-payment error", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});