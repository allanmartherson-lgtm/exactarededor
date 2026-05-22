// company-checklist — Gera checklist dinâmico de validação para uma empresa,
// baseado no histórico de problemas. NÃO altera dados. Apenas orientativo.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ChecklistItem {
  text: string;
  priority: "alta" | "media" | "baixa";
  category: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { company_name, payment_id } = await req.json();
    if (!company_name || !payment_id) {
      return new Response(JSON.stringify({ error: "company_name and payment_id required" }), {
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

    const [itemsRes, obsRes, historyRes] = await Promise.all([
      supabase
        .from("payment_items")
        .select("ai_status, ai_findings, validation_findings, doctor_name, procedure_code, gross_amount, expected_amount")
        .eq("payment_id", payment_id)
        .eq("company_name", company_name)
        .limit(500),
      supabase
        .from("payment_observations")
        .select("message, author_type, observation_type, created_at")
        .eq("payment_id", payment_id)
        .in("author_type", ["analista", "validador", "diretor"])
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("payment_company_groups")
        .select("status, created_at, payment_id")
        .eq("company_name", company_name)
        .neq("payment_id", payment_id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const items = itemsRes.data ?? [];
    const stats = {
      total: items.length,
      reprovado: items.filter((i: any) => i.ai_status === "reprovado").length,
      alerta: items.filter((i: any) => i.ai_status === "alerta").length,
      acatado: items.filter((i: any) => i.ai_status === "acatado").length,
      total_bruto: items.reduce((s: number, i: any) => s + Number(i.gross_amount ?? 0), 0),
      total_esperado: items.reduce((s: number, i: any) => s + Number(i.expected_amount ?? 0), 0),
    };

    const findingsSample: string[] = [];
    for (const it of items.slice(0, 30)) {
      const af = (it as any).ai_findings;
      if (af?.alerts && Array.isArray(af.alerts)) {
        for (const a of af.alerts.slice(0, 2)) {
          if (typeof a === "string") findingsSample.push(a);
          else if (a?.message) findingsSample.push(a.message);
        }
      }
      const vf = (it as any).validation_findings;
      if (Array.isArray(vf)) {
        for (const v of vf.slice(0, 2)) {
          if (v?.message) findingsSample.push(v.message);
        }
      }
    }

    const history = historyRes.data ?? [];
    const historyStats = {
      total_lotes: history.length,
      devolvidos: history.filter((h: any) =>
        ["devolvido_analista", "rejeitado"].includes(h.status),
      ).length,
      em_questionamento: history.filter((h: any) => h.status === "em_questionamento").length,
    };

    const contexto = {
      empresa: company_name,
      lote_atual: stats,
      amostra_alertas: findingsSample.slice(0, 20),
      observacoes_recentes: (obsRes.data ?? []).slice(0, 15).map((o: any) => ({
        autor: o.author_type,
        tipo: o.observation_type,
        mensagem: (o.message ?? "").slice(0, 240),
      })),
      historico: historyStats,
    };

    const systemPrompt = `Você é um auditor de pagamentos médicos. Gere um CHECKLIST de validação para o validador verificar antes de aprovar esta empresa. Baseie-se EXCLUSIVAMENTE nos dados reais do contexto. Retorne exatamente 3 a 6 itens acionáveis e específicos.

Regras:
- Cada item deve ser uma instrução clara e verificável (ex.: "Conferir se os 4 itens reprovados de cirurgia abdominal têm justificativa do médico").
- Priorize "alta" para riscos materiais (volume alto reprovado, devoluções recentes, valores em risco).
- "media" para padrões dignos de atenção. "baixa" para conferências de rotina.
- category curta (ex.: "Reprovações", "Histórico", "Conciliação", "Médicos novos").
- Não invente dados que não estejam no contexto.
- Linguagem objetiva em pt-BR.`;

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          { role: "user", content: `Contexto (JSON):\n${JSON.stringify(contexto, null, 2)}` },
        ],
        tools: [{
          name: "validation_checklist",
          description: "Devolve checklist de validação para a empresa",
          input_schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                minItems: 3,
                maxItems: 6,
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    priority: { type: "string", enum: ["alta", "media", "baixa"] },
                    category: { type: "string" },
                  },
                  required: ["text", "priority", "category"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
        }],
        tool_choice: { type: "tool", name: "validation_checklist" },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições à IA atingido." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("company-checklist AI error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "Falha ao gerar checklist" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const tc = aiData.content?.find((b: { type: string }) => b.type === "tool_use");
    const parsed = tc?.input as { items?: ChecklistItem[] } | undefined;
    const checklist = parsed?.items ?? [];

    return new Response(JSON.stringify({ ok: true, checklist }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("company-checklist error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
