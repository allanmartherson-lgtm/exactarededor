/**
 * Helpers de lookup / criação idempotente de company_threads.
 *
 * Regras:
 *  - source identifica de onde a thread nasceu: 'manual' | 'campaign_reply' |
 *    'pendencia' | 'lote' | 'nf'.
 *  - Para campanhas, existe UNIQUE INDEX (company_id, campaign_id) que garante
 *    no máximo 1 thread por (empresa, campanha). Usamos esse índice para
 *    upsert seguro e evitar duplicação quando a empresa responde várias vezes.
 */
import { supabase } from "@/integrations/supabase/client";

export type ThreadSource =
  | "manual"
  | "campaign_reply"
  | "pendencia"
  | "lote"
  | "nf";

export const THREAD_SOURCE_LABEL: Record<ThreadSource, string> = {
  manual: "Manual",
  campaign_reply: "Resposta de comunicado",
  pendencia: "Pendência",
  lote: "Lote",
  nf: "Nota fiscal",
};

/**
 * Garante uma thread única para o par (empresa, campanha). Se já existir,
 * apenas retorna o id; se não existir, cria com source='campaign_reply'.
 *
 * O índice único parcial (company_id, campaign_id) WHERE campaign_id IS NOT NULL
 * é nossa rede de segurança contra corrida.
 */
export async function ensureCampaignThread(params: {
  companyId: string;
  campaignId: string;
  subject: string;
  createdByType?: "analista" | "empresa";
  createdByUserId?: string | null;
}): Promise<{ id: string; created: boolean } | { error: string }> {
  const { companyId, campaignId, subject, createdByType = "empresa", createdByUserId = null } = params;

  // 1) tenta achar uma thread já existente
  const existing = (await supabase
    .from("company_threads" as never)
    .select("id")
    .eq("company_id" as never, companyId as never)
    .eq("campaign_id" as never, campaignId as never)
    .maybeSingle()) as { data: { id: string } | null; error: { code?: string; message: string } | null };

  if (existing.error && existing.error.code !== "PGRST116") {
    return { error: existing.error.message };
  }
  if (existing.data) {
    return { id: existing.data.id, created: false };
  }

  // 2) cria — se houver corrida, o índice único barra e relemos
  const insert = (await supabase
    .from("company_threads" as never)
    .insert({
      company_id: companyId,
      campaign_id: campaignId,
      source: "campaign_reply",
      scope: "geral",
      subject: subject.slice(0, 200),
      created_by_type: createdByType,
      created_by_user_id: createdByUserId,
      status: "aberta",
    } as never)
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (insert.error) {
    // conflito de unique → relê
    const retry = (await supabase
      .from("company_threads" as never)
      .select("id")
      .eq("company_id" as never, companyId as never)
      .eq("campaign_id" as never, campaignId as never)
      .maybeSingle()) as { data: { id: string } | null };
    if (retry.data) return { id: retry.data.id, created: false };
    return { error: insert.error.message };
  }

  return { id: insert.data!.id, created: true };
}
