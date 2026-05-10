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
          { role: "system", content: `Você converte texto livre em regras estruturadas para validação de pagamentos médicos.
Cada regra deve ter:
- name: nome curto
- description: descrição clara
- rule_text: texto da regra em português descrevendo a condição
- severity: 'info' | 'aviso' | 'bloqueio' ('bloqueio' impede pagamento; 'aviso' alerta o validador; 'info' é observação)
- scope: 'master' (regra geral, vale para todos quando não há específica) ou 'especifica' (vale apenas para um médico ou empresa)
- sector: 'cirurgia' | 'hemodinamica' | 'parecer' | 'visita' | 'procedimento' | 'consulta' | 'outro' — identifique pelo contexto; use 'outro' se não estiver claro
- target_type: 'medico' | 'empresa' | null — preencha apenas se scope='especifica'
- target_identifier: CPF (médico) ou CNPJ (empresa), apenas se scope='especifica' e mencionado
- target_name: nome do médico ou da empresa, apenas se scope='especifica' e mencionado

- rule_type: 'informativo' | 'pacote' | 'tabela_diferenciada' | 'bonus' | 'complemento'
    * 'pacote': valor fixo para o procedimento todo. Preencha package_amount (R$).
    * 'tabela_diferenciada': pagamento baseado em tabela de referência (ex: CBHPM 2018). Preencha multiplier (ex: 1.5) e/ou deflator_pct (ex: 5 para 5%). Se mencionar uma tabela específica, coloque o nome no campo description.
    * 'bonus': honorário + adicional. Preencha bonus_amount (R$ fixo) OU bonus_pct (%).
    * 'complemento': completa o valor para chegar ao acordado. Preencha target_amount (R$).
    * 'informativo': qualquer regra que apenas alerta/bloqueia (default).
- procedure_codes: array de códigos de procedimento (ex: ["31005497","31005470"]) quando a regra cita códigos específicos. Vazio se não houver.
- package_amount, bonus_amount, bonus_pct, target_amount, multiplier, deflator_pct: numéricos ou null.

Se o texto cita um médico, hospital ou empresa específica, marque como 'especifica'. Caso contrário, 'master'.` },
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
                      scope: { type: "string", enum: ["master", "especifica"] },
                      sector: { type: "string", enum: ["cirurgia", "hemodinamica", "parecer", "visita", "procedimento", "consulta", "outro"] },
                      target_type: { type: ["string", "null"], enum: ["medico", "empresa", null] },
                      target_identifier: { type: ["string", "null"] },
                      target_name: { type: ["string", "null"] },
                      rule_type: { type: "string", enum: ["informativo","pacote","tabela_diferenciada","bonus","complemento"] },
                      package_amount: { type: ["number","null"] },
                      bonus_amount: { type: ["number","null"] },
                      bonus_pct: { type: ["number","null"] },
                      target_amount: { type: ["number","null"] },
                      multiplier: { type: ["number","null"] },
                      deflator_pct: { type: ["number","null"] },
                      procedure_codes: { type: "array", items: { type: "string" } },
                    },
                    required: ["name", "description", "rule_text", "severity", "scope", "sector", "rule_type"],
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
      // Retorna 200 com flag de erro para evitar que supabase-js trate como exceção
      // e quebre a UI. O cliente decide como exibir.
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Limite de uso da IA atingido. Tente novamente em instantes.", code: "RATE_LIMIT" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos em Configurações → Workspace.", code: "CREDITS_EXHAUSTED" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `Falha na IA (${aiResp.status})`, code: "AI_ERROR" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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