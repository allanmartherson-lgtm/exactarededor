// explain-alert — Gera explicação interpretativa (IA) para um alerta determinístico.
// NÃO altera valores, status ou regras. Apenas auxilia o analista a entender o alerta.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { item_id } = await req.json();
    if (!item_id || typeof item_id !== "string") {
      return new Response(JSON.stringify({ error: "item_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Carrega item alvo
    const { data: item, error: itemErr } = await supabase
      .from("payment_items")
      .select(`
        id, payment_id, doctor_name, doctor_role, company_name, company_id,
        procedure_code, procedure_name, description, access_route,
        procedure_amount, gross_amount, attendance_number, patient_name,
        procedure_date, quantity, ai_status, ai_findings
      `)
      .eq("id", item_id)
      .maybeSingle();

    if (itemErr || !item) {
      return new Response(JSON.stringify({ error: "item not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const findings = (item.ai_findings ?? {}) as any;
    const alerts: string[] = Array.isArray(findings.alerts) ? findings.alerts : [];
    const matchedRules: string[] = Array.isArray(findings.matched_rules) ? findings.matched_rules : [];
    const expected = findings.expected_amount ?? null;
    const engine = findings.engine ?? {};
    const calcExplanation = findings.calculation_explanation ?? null;

    // 2. Outros itens do mesmo atendimento (multiplicidade / auxiliares)
    let attendanceItems: any[] = [];
    if (item.attendance_number) {
      const { data } = await supabase
        .from("payment_items")
        .select("id, doctor_name, doctor_role, procedure_code, procedure_name, gross_amount")
        .eq("payment_id", item.payment_id)
        .eq("attendance_number", item.attendance_number);
      attendanceItems = data ?? [];
    }

    // 3. Histórico básico do mesmo procedimento (média / contagem)
    let history: { count: number; mean: number | null; min: number | null; max: number | null } = {
      count: 0, mean: null, min: null, max: null,
    };
    if (item.procedure_code) {
      const { data: hist } = await supabase
        .from("payment_items")
        .select("gross_amount")
        .eq("procedure_code", item.procedure_code)
        .neq("id", item.id)
        .limit(500);
      if (hist && hist.length > 0) {
        const vals = hist.map((h: any) => Number(h.gross_amount)).filter((v) => Number.isFinite(v));
        if (vals.length) {
          const sum = vals.reduce((a, b) => a + b, 0);
          history = {
            count: vals.length,
            mean: sum / vals.length,
            min: Math.min(...vals),
            max: Math.max(...vals),
          };
        }
      }
    }

    // 4. Monta contexto p/ IA
    const auxiliaresCount = attendanceItems.filter((x: any) => {
      const role = String(x.doctor_role ?? "").toLowerCase();
      return role.includes("aux") || role.includes("anest");
    }).length;

    const contexto = {
      atendimento: item.attendance_number,
      paciente: item.patient_name,
      empresa: item.company_name,
      medico: item.doctor_name,
      funcao: item.doctor_role,
      procedimento_codigo: item.procedure_code,
      procedimento_nome: item.procedure_name ?? item.description,
      via_acesso: item.access_route,
      valor_convenio: item.procedure_amount,
      valor_pago: item.gross_amount,
      qtde_itens_no_atendimento: attendanceItems.length,
      qtde_auxiliares_no_atendimento: auxiliaresCount,
      motor: {
        status: item.ai_status,
        valor_esperado: expected,
        diff_pct: engine?.diff_pct,
        regra_vencedora: matchedRules[0] ?? null,
        tipo_calculo: engine?.calculation_type_used,
        explicacao_motor: calcExplanation,
        alertas_motor: alerts,
      },
      historico_mesmo_procedimento: history,
    };

    const systemPrompt = `Você é um auditor sênior de pagamentos médicos. Sua tarefa é APENAS interpretar um alerta JÁ gerado por um motor determinístico, ajudando o analista humano a entender o porquê.

REGRAS ABSOLUTAS:
- NUNCA altere valores, status, regras ou tipo de cálculo.
- NUNCA decida manter ou retirar o item — isso é do analista.
- NUNCA invente regras ou números que não estejam no contexto.
- Use linguagem objetiva em pt-BR, técnica mas clara.
- Não repita o motivo do alerta verbatim — explique o significado e levante hipóteses plausíveis.

Sua saída deve conter:
1. Explicação curta (1-2 frases) sobre o que está acontecendo no caso.
2. Lista de possíveis causas (3 a 5), considerando: tipo de atendimento, quantidade de procedimentos, presença de auxiliares, aplicação de pacote/tabela diferenciada, comparação com histórico.
3. Sugestão objetiva do que o analista deveria conferir antes de decidir.`;

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          { role: "user", content: `Contexto do item alertado (JSON):\n${JSON.stringify(contexto, null, 2)}` },
        ],
        tools: [{
          name: "explain_alert",
          description: "Devolve explicação interpretativa do alerta",
          input_schema: {
            type: "object",
            properties: {
              explanation: { type: "string", description: "Explicação curta (1-2 frases)" },
              possible_causes: {
                type: "array",
                items: { type: "string" },
                description: "Lista de 3-5 possíveis causas",
              },
              what_to_check: { type: "string", description: "Sugestão objetiva do que o analista deveria conferir" },
            },
            required: ["explanation", "possible_causes", "what_to_check"],
            additionalProperties: false,
          },
        }],
        tool_choice: { type: "tool", name: "explain_alert" },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições à IA atingido. Tente novamente em instantes." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos no workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("explain-alert AI error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "Falha ao gerar explicação" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const tc = aiData.content?.find((b: any) => b.type === "tool_use");
    let parsed: { explanation: string; possible_causes: string[]; what_to_check: string } | null = null;
    if (tc) {
      parsed = tc.input as any;
    }
    if (!parsed) {
      return new Response(JSON.stringify({ error: "IA não retornou estrutura esperada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        deterministic: {
          status: item.ai_status,
          alerts,
          matched_rule: matchedRules[0] ?? null,
          expected_amount: expected,
          calculation_explanation: calcExplanation,
        },
        ai: parsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("explain-alert error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});