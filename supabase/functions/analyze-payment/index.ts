import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  rule_text: string;
  severity: string;
  scope: string;
  sector: string;
  target_type: string | null;
  target_identifier: string | null;
  target_name: string | null;
  rule_type: string;
  package_amount: number | null;
  bonus_amount: number | null;
  bonus_pct: number | null;
  target_amount: number | null;
  multiplier: number | null;
  deflator_pct: number | null;
  procedure_codes: string[] | null;
  reference_table_id: string | null;
}
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

    const { data: rules } = await supabase
      .from("rules")
      .select("id,name,description,rule_text,severity,scope,sector,target_type,target_identifier,target_name,rule_type,package_amount,bonus_amount,bonus_pct,target_amount,multiplier,deflator_pct,procedure_codes,reference_table_id")
      .eq("active", true);

    // Carrega itens das tabelas de referência usadas pelas regras
    const refIds = Array.from(new Set((rules ?? []).map((r: any) => r.reference_table_id).filter(Boolean)));
    let refIndex: Record<string, { name: string; items: { code: string; description: string | null; amount: number }[] }> = {};
    if (refIds.length > 0) {
      const { data: refTables } = await supabase.from("reference_tables").select("id,name").in("id", refIds);
      const { data: refItems } = await supabase.from("reference_table_items").select("reference_table_id,code,description,amount").in("reference_table_id", refIds);
      for (const t of refTables ?? []) refIndex[t.id] = { name: t.name, items: [] };
      for (const it of refItems ?? []) {
        const t = refIndex[it.reference_table_id];
        if (t) t.items.push({ code: it.code, description: it.description, amount: Number(it.amount) });
      }
    }
    const { data: items } = await supabase.from("payment_items").select("id,doctor_name,doctor_document,doctor_email,description,gross_amount,raw_data").eq("payment_id", payment_id);
    const { data: history } = await supabase
      .from("payment_observations")
      .select("author_type, message")
      .in("author_type", ["validador", "diretor"])
      .order("created_at", { ascending: false })
      .limit(20);

    const fmtRule = (r: RuleRow, i: number) => {
      const tag = r.scope === "especifica"
        ? `ESPECÍFICA→${r.target_type ?? "?"}:${r.target_name ?? r.target_identifier ?? "?"}`
        : "MASTER";
      const calc: string[] = [];
      if (r.rule_type === "pacote" && r.package_amount != null) calc.push(`PACOTE=R$${r.package_amount}`);
      if (r.rule_type === "tabela_diferenciada") {
        const ref = r.reference_table_id ? refIndex[r.reference_table_id]?.name : null;
        calc.push(`TABELA${ref ? `=${ref}` : ""}${r.multiplier ? ` x${r.multiplier}` : ""}${r.deflator_pct ? ` deflator ${r.deflator_pct}%` : ""}`);
      }
      if (r.rule_type === "bonus") {
        if (r.bonus_amount != null) calc.push(`BONUS=+R$${r.bonus_amount}`);
        if (r.bonus_pct != null) calc.push(`BONUS=+${r.bonus_pct}%`);
      }
      if (r.rule_type === "complemento" && r.target_amount != null) calc.push(`COMPLEMENTO até R$${r.target_amount}`);
      if (r.procedure_codes && r.procedure_codes.length) calc.push(`códigos:${r.procedure_codes.join(",")}`);
      const calcTag = calc.length ? ` {${r.rule_type}: ${calc.join(" | ")}}` : ` {${r.rule_type}}`;
      return `R${i + 1} [${tag}] [setor:${r.sector}] (${r.severity.toUpperCase()})${calcTag}: ${r.name} — ${r.rule_text}${r.description ? ` [${r.description}]` : ""}`;
    };
    const rulesText = (rules ?? []).length === 0
      ? "Nenhuma regra cadastrada — apenas verifique consistência básica (valor positivo, dados preenchidos, possíveis duplicatas)."
      : (rules as RuleRow[]).map(fmtRule).join("\n");

    // Texto compacto das tabelas de referência (limitado para não estourar contexto)
    const refText = Object.keys(refIndex).length === 0 ? "" :
      "\n\nTABELAS DE REFERÊNCIA (código → valor base):\n" +
      Object.entries(refIndex).map(([_id, t]) => {
        const sample = t.items.slice(0, 200).map(i => `${i.code}=R$${i.amount}${i.description ? ` (${i.description})` : ""}`).join("; ");
        return `# ${t.name}\n${sample}${t.items.length > 200 ? ` ...(+${t.items.length-200})` : ""}`;
      }).join("\n");

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
      raw: it.raw_data,
    }));

    const systemPrompt = `Você é um auditor financeiro de pagamentos médicos.
Para CADA item, aplique as regras seguindo este princípio de precedência:
1. Identifique o SETOR do item (cirurgia, hemodinâmica, parecer, visita, procedimento, consulta, outro) a partir da descrição e dos dados brutos.
2. Procure regras ESPECÍFICAS aplicáveis ao médico (CPF/nome) ou empresa (CNPJ/nome) do item, no setor correspondente. Se houver, elas têm prioridade.
3. Se não houver regra específica que cubra o ponto, aplique a regra MASTER do mesmo setor.
4. Regras MASTER de setor "outro" valem para todos os setores como fallback geral.

CÁLCULO DE VALOR ESPERADO (quando a regra tem rule_type diferente de 'informativo'):
- pacote: valor esperado = package_amount.
- tabela_diferenciada: localize o código do procedimento na TABELA DE REFERÊNCIA indicada, pegue o valor base, multiplique por 'multiplier' (default 1) e aplique deflator (-deflator_pct%). Se a tabela não tiver o código, marque como alerta.
- bonus: valor esperado = valor_bruto (do convênio, vindo da planilha) + bonus_amount OU + (valor_bruto * bonus_pct/100).
- complemento: valor esperado = target_amount; "valor a complementar" = target_amount - valor_bruto.
- Se procedure_codes da regra estiver preenchido, ela só se aplica quando o item tiver um desses códigos.

Se calculou um expected_amount, compare com valor_bruto:
- diferença ≤ 1% → status 'aprovado'
- diferença até 10% → 'alerta'
- > 10% ou códigos não encontrados → 'reprovado'

Para cada item, retorne:
- status: "aprovado" | "alerta" | "reprovado"
- alerts: array de strings (curtas, em português) descrevendo problemas encontrados; vazio se ok
- matched_rules: nomes das regras aplicadas/violadas
- expected_amount: número | null (valor esperado calculado, se houver)
- calculation_explanation: string curta explicando o cálculo (ex: "CBHPM 2018 R$1.200 x 1.5 - 5% = R$1.710")

REGRAS:
${rulesText}${refText}${historyText}

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
                      expected_amount: { type: ["number","null"] },
                      calculation_explanation: { type: ["string","null"] },
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
        ai_findings: { alerts: r.alerts, matched_rules: r.matched_rules, expected_amount: r.expected_amount ?? null, calculation_explanation: r.calculation_explanation ?? null },
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