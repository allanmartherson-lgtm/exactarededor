import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

// Cliente com o token do usuário conectado — RLS decide o que ele enxerga.
function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_payments",
  title: "Listar pagamentos",
  description:
    "Lista lotes de pagamento visíveis para o usuário conectado, mais recentes primeiro. Aceita limite e filtro opcional por status.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("Máximo de lotes."),
    status: z.string().nullable().default(null).describe("Filtra por status exato (ex.: em_analise, aprovado, pago)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("payments")
      .select("id, status, competence_month, created_at, hospital_id, gross_total, net_total")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { payments: data ?? [] },
    };
  },
});
