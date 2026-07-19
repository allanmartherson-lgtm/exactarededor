import { c1_passwordRecovery, c2_newUserInvite } from "./emailTemplates/templates.ts";

type PasswordActionKind = "invite" | "recovery";

type SendPasswordActionEmailParams = {
  supabaseUrl: string;
  serviceRoleKey: string;
  to: string;
  fullName?: string | null;
  actionLink: string;
  kind: PasswordActionKind;
};

export function buildPasswordActionLink(params: {
  redirectTo?: string;
  tokenHash?: string | null;
  kind: PasswordActionKind;
  fallbackActionLink?: string | null;
}) {
  if (params.redirectTo && params.tokenHash) {
    return `${params.redirectTo}?token_hash=${encodeURIComponent(params.tokenHash)}&type=${encodeURIComponent(params.kind)}`;
  }
  return params.fallbackActionLink ?? null;
}

export async function sendPasswordActionEmail(params: SendPasswordActionEmailParams) {
  const rendered = params.kind === "invite"
    ? c2_newUserInvite({
        user_name: params.fullName?.trim() || params.to,
        user_email: params.to,
        activation_link: params.actionLink,
      })
    : c1_passwordRecovery({
        user_name: params.fullName?.trim() || params.to,
        reset_link: params.actionLink,
        expiry_hours: 72,
      });


  try {
    const response = await fetch(`${params.supabaseUrl}/functions/v1/send-email-corporate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: params.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        event_key: params.kind === "invite" ? "user_invite" : "password_recovery",
        template_key: params.kind === "invite" ? "user_invite_password" : "admin_password_recovery",
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        sent: false,
        warning: `Não foi possível enviar o e-mail automático (${response.status}). Use o link manual. ${body}`,
      };
    }
    return { sent: true, warning: null as string | null };
  } catch (e) {
    return {
      sent: false,
      warning: `Não foi possível enviar o e-mail automático. Use o link manual. ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
