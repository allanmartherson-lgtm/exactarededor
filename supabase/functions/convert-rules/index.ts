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
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

    const userContent: any[] = [];
    if (text) userContent.push({ type: "text", text: `Converta este conteúdo em regras estruturadas:\n\n${text}` });
    if (file) {
      userContent.push({ type: "text", text: `Extraia e estruture todas as regras de validação de pagamento contidas no arquivo anexo (${file.name ?? "arquivo"}).` });
      const mt = String(file.mimeType ?? "");
      if (mt === "application/pdf") {
        userContent.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: file.dataBase64 },
        });
      } else if (mt.startsWith("image/")) {
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: mt, data: file.dataBase64 },
        });
      } else {
        // texto/plain ou outros: decodifica base64 e injeta como texto
        try {
          const decoded = new TextDecoder().decode(Uint8Array.from(atob(file.dataBase64), (c) => c.charCodeAt(0)));
          userContent.push({ type: "text", text: `Conteúdo do arquivo:\n${decoded}` });
        } catch {
          return new Response(JSON.stringify({ error: `Tipo de arquivo não suportado: ${mt}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    const systemPrompt = `Você converte texto livre em regras estruturadas para validação de pagamentos médicos.
Cada regra deve ter:
- name: nome curto
- description: descrição clara
- rule_text: texto da regra em português descrevendo a condição
- severity: 'info' | 'aviso' | 'bloqueio' ('bloqueio' impede pagamento; 'aviso' alerta o validador; 'info' é observação)
- scope: 'master' (regra geral, vale para todos quando não há específica) ou 'especifica' (vale apenas para um médico ou empresa)
- sectors: array com um ou mais setores: 'cirurgia' | 'hemodinamica' | 'parecer' | 'visita' | 'procedimento' | 'consulta' | 'outro' — identifique pelo contexto; use ['outro'] se não estiver claro
- target_type: 'medico' | 'empresa' | null — preencha apenas se scope='especifica'
- target_identifier: CPF (médico) ou CNPJ (empresa), apenas se scope='especifica' e mencionado
- target_name: nome do médico ou da empresa, apenas se scope='especifica' e mencionado

- calculation_type: 'informativo' | 'pacote' | 'tabela_diferenciada' | 'tabela_referencia' | 'bonus' | 'complemento' | 'percentual_fixo'
    * 'pacote': valor fixo para o procedimento todo. Preencha package_amount (R$).
    * 'tabela_diferenciada' / 'tabela_referencia': pagamento baseado em tabela de referência. Preencha multiplier e/ou deflator_pct. Se mencionar uma tabela específica, coloque o nome no campo description.
    * 'bonus': honorário + adicional. Preencha bonus_amount (R$ fixo) OU bonus_pct (%).
    * 'complemento': completa o valor para chegar ao acordado. Preencha target_amount (R$).
    * 'percentual_fixo': repasse percentual sobre o valor do procedimento.
    * 'informativo': qualquer regra que apenas alerta/bloqueia (default).
- procedure_codes: array de códigos de procedimento (ex: ["31005497","31005470"]) quando a regra cita códigos específicos. Vazio se não houver.
- package_amount, bonus_amount, bonus_pct, target_amount, multiplier, deflator_pct: numéricos ou null.

Se o texto cita um médico, hospital ou empresa específica, marque como 'especifica'. Caso contrário, 'master'.`;

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          { role: "user", content: userContent },
        ],
        tools: [{
          name: "extract_rules",
          description: "Extrai regras",
          input_schema: {
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
                    sectors: { type: "array", items: { type: "string", enum: ["cirurgia", "hemodinamica", "parecer", "visita", "procedimento", "consulta", "outro"] } },
                    target_type: { type: ["string", "null"], enum: ["medico", "empresa", null] },
                    target_identifier: { type: ["string", "null"] },
                    target_name: { type: ["string", "null"] },
                    calculation_type: { type: "string", enum: ["informativo","pacote","tabela_diferenciada","tabela_referencia","bonus","complemento","percentual_fixo"] },
                    package_amount: { type: ["number","null"] },
                    bonus_amount: { type: ["number","null"] },
                    bonus_pct: { type: ["number","null"] },
                    target_amount: { type: ["number","null"] },
                    multiplier: { type: ["number","null"] },
                    deflator_pct: { type: ["number","null"] },
                    procedure_codes: { type: "array", items: { type: "string" } },
                  },
                  required: ["name", "description", "rule_text", "severity", "scope", "sectors", "calculation_type"],
                  additionalProperties: false,
                },
              },
            },
            required: ["rules"],
            additionalProperties: false,
          },
        }],
        tool_choice: { type: "tool", name: "extract_rules" },
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
    const tc = data.content?.find((b: any) => b.type === "tool_use");
    if (!tc) throw new Error("No tool call");
    const parsed = tc.input;
    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});