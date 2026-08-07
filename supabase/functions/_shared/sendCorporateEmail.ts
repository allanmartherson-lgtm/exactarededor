// Helper único de envio de e-mail do sistema.
// Todas as edge functions devem enviar e-mail por aqui — ele chama a função
// `send-email-corporate` (mailbox corporativo Outlook/Gmail via connector gateway)
// com service role, garantindo registro em `notification_deliveries`.

export type CorporateAttachment = {
  filename: string;
  /** Conteúdo do arquivo em base64 (sem prefixo data:) */
  content_base64: string;
  content_type?: string;
};

export type SendCorporateEmailParams = {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: CorporateAttachment[];
  event_key: string;
  template_key?: string;
  user_id?: string;
  payment_id?: string;
  queue_id?: string;
};

export type SendCorporateEmailResult = {
  ok: boolean;
  status: number;
  response: unknown;
  error?: string;
};

export async function sendCorporateEmail(
  params: SendCorporateEmailParams,
): Promise<SendCorporateEmailResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, status: 0, response: null, error: "SUPABASE_URL/SERVICE_ROLE_KEY ausente" };
  }

  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/send-email-corporate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(params),
    });
    const txt = await r.text();
    let parsed: unknown = txt;
    try { parsed = JSON.parse(txt); } catch { /* mantém texto cru */ }
    return {
      ok: r.ok,
      status: r.status,
      response: parsed,
      error: r.ok ? undefined : `send-email-corporate ${r.status}: ${txt.slice(0, 500)}`,
    };
  } catch (e) {
    return { ok: false, status: 0, response: null, error: String(e) };
  }
}
